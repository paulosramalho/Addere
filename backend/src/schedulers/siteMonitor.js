/**
 * backend/src/schedulers/siteMonitor.js
 *
 * Site Intelligence Hub — 4 camadas de monitoramento:
 *
 *  L1 · Uptime        — HEAD a cada 5min; alerta WA+email se down/lento (2 falhas consecutivas)
 *  L2 · Lead Digest   — Toda segunda 12h UTC: resumo semanal dos formulários de contato
 *  L3 · GSC Report    — Junto com L2: dados Google Search Console (se GOOGLE_SERVICE_ACCOUNT_KEY)
 *  L4 · Auditoria IA  — Dia 1 do mês 13h UTC: Claude Haiku analisa o conteúdo do site
 */

import prisma from "../lib/prisma.js";
import { sendEmail }    from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppStrict, sendWhatsAppTemplate, _waPhone } from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";
import Anthropic from "@anthropic-ai/sdk";

const SITE_URL        = "https://www.amandaramalho.adv.br";
const SLOW_THRESHOLD  = 5000;   // ms — resposta acima disto = "LENTO"
const THROTTLE_ALERTA = 30 * 60 * 1000; // 30min entre alertas de down

// ── estado em memória ─────────────────────────────────────────────────────────
let _falhasConsecutivas = 0;
let _ultimoAlerta       = 0;
let _historico          = []; // { ms, ok, ts } — últimas 2016 entradas (1 semana @5min)

// ── helpers gerais ────────────────────────────────────────────────────────────

function _hoje() { return new Date().toISOString().slice(0, 10); }
function _fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }
function _fmtPos(n) { return typeof n === "number" ? n.toFixed(1) : "—"; }
function _sinal(n)  { return n >= 0 ? `+${n}` : `${n}`; }

async function _admins() {
  return prisma.usuario.findMany({
    where: { ativo: true, role: "ADMIN" },
    select: { email: true, whatsapp: true, telefone: true },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// L1 — UPTIME
// ═════════════════════════════════════════════════════════════════════════════

async function _tentativaFetch(timeoutMs) {
  const t0 = Date.now();
  try {
    const res = await fetch(SITE_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, ms: Date.now() - t0, status: res.status };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, status: 0, err: err.message };
  }
}

async function _checkUptime() {
  const r1 = await _tentativaFetch(8000);

  // Registra no histórico (circular 2016 = 1 semana)
  const entry = { ms: r1.ms, ok: r1.ok && r1.ms <= SLOW_THRESHOLD, ts: Date.now() };
  _historico.push(entry);
  if (_historico.length > 2016) _historico.shift();

  if (r1.ok && r1.ms <= SLOW_THRESHOLD) {
    // Recuperação
    if (_falhasConsecutivas >= 2) {
      const admins = await _admins();
      const msg = `✅ *Site Addere normalizado* — respondendo em ${r1.ms}ms`;
      for (const a of admins) await sendWhatsApp(_waPhone(a.whatsapp || a.telefone), msg);
    }
    _falhasConsecutivas = 0;
    return;
  }

  // Falha: incrementa contador
  _falhasConsecutivas++;

  // Só alarma após 2 falhas consecutivas (evita falso positivo de cold start)
  if (_falhasConsecutivas < 2) return;

  // Retry único após 90s antes de alarmar (cobre cold start do Render)
  if (_falhasConsecutivas === 2) {
    await new Promise(r => setTimeout(r, 90_000));
    const r2 = await _tentativaFetch(10_000);
    if (r2.ok && r2.ms <= SLOW_THRESHOLD) {
      _falhasConsecutivas = 0;
      return;
    }
  }

  // Throttle: máximo 1 alerta a cada 30 min
  const agora = Date.now();
  if (agora - _ultimoAlerta < THROTTLE_ALERTA) return;
  _ultimoAlerta = agora;

  const tipo   = !r1.ok ? "FORA DO AR" : "LENTO";
  const emoji  = !r1.ok ? "🔴" : "🟡";
  const detalhe = r1.err ? r1.err.slice(0, 80) : (r1.status ? `HTTP ${r1.status}` : `${r1.ms}ms`);

  const admins = await _admins();
  const msg = `${emoji} *Site Addere ${tipo}*\n${detalhe}\n${SITE_URL}`;
  for (const a of admins) {
    const phone = _waPhone(a.whatsapp || a.telefone);
    // Tenta mensagem livre; se janela 24h expirada (131047), usa template como fallback
    try {
      await sendWhatsAppStrict(phone, msg);
    } catch {
      await sendWhatsAppTemplate(phone, "transferencia_conversa");
    }
    await sendEmail({
      to: a.email,
      subject: `${emoji} Site Addere ${tipo} — ${detalhe}`,
      html: `<p style="font-family:Arial;font-size:14px">${msg.replace(/\n/g, "<br>")}</p>`,
    });
  }

  console.warn(`[siteMonitor] Alerta enviado: ${tipo} — ${detalhe}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// L3 — GOOGLE SEARCH CONSOLE
// ═════════════════════════════════════════════════════════════════════════════

async function _fetchGSC() {
  const clientId     = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  let google;
  try { ({ google } = await import("googleapis")); }
  catch { console.warn("[siteMonitor] googleapis não instalado"); return null; }

  const siteUrl = process.env.GOOGLE_SITE_URL || "https://www.amandaramalho.adv.br/";
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const sc = google.searchconsole({ version: "v1", auth });

  const now       = new Date();
  const endDate   = new Date(now - 2 * 86_400_000);  // -2d (delay GSC)
  const startDate = new Date(now - 9 * 86_400_000);  // janela 7 dias
  const prevEnd   = new Date(now - 9 * 86_400_000);
  const prevStart = new Date(now - 16 * 86_400_000);
  const fmt = d => d.toISOString().slice(0, 10);

  try {
    const [qRes, pRes, tRes, ptRes] = await Promise.all([
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(startDate), endDate: fmt(endDate),
          dimensions: ["query"], rowLimit: 10,
          orderBy: [{ fieldName: "clicks", sortOrder: "DESCENDING" }],
        },
      }),
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(startDate), endDate: fmt(endDate),
          dimensions: ["page"], rowLimit: 5,
          orderBy: [{ fieldName: "clicks", sortOrder: "DESCENDING" }],
        },
      }),
      sc.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: fmt(startDate), endDate: fmt(endDate), rowLimit: 1 },
      }),
      sc.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: fmt(prevStart), endDate: fmt(prevEnd), rowLimit: 1 },
      }),
    ]);

    return {
      period:    `${fmt(startDate)} → ${fmt(endDate)}`,
      totals:    tRes.data.rows?.[0]  || { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      prevTotals:ptRes.data.rows?.[0] || null,
      queries:   qRes.data.rows || [],
      pages:     pRes.data.rows || [],
    };
  } catch (err) {
    console.error("[siteMonitor] GSC erro:", err.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// L2+L3 — WEEKLY DIGEST
// ═════════════════════════════════════════════════════════════════════════════

async function _weeklyDigest() {
  const hoje = _hoje();
  if (!(await _schedulerShouldRun("siteMonitor_weekly", hoje))) return;
  await _schedulerMarkRun("siteMonitor_weekly", hoje);

  const since7  = new Date(Date.now() -  7 * 86_400_000);
  const since14 = new Date(Date.now() - 14 * 86_400_000);

  const [leads, prevLeads, gsc] = await Promise.all([
    prisma.contatoSite.findMany({ where: { createdAt: { gte: since7  } }, orderBy: { createdAt: "desc" } }),
    prisma.contatoSite.findMany({ where: { createdAt: { gte: since14, lt: since7 } } }),
    _fetchGSC(),
  ]);

  const admins = await _admins();
  if (!admins.length) return;

  const html = _buildDigestHtml(leads, prevLeads, gsc);
  const wa   = _buildDigestWA(leads, prevLeads, gsc);

  for (const a of admins) {
    await sendEmail({ to: a.email, subject: "📊 Resumo Semanal — Site Addere", html });
    await sendWhatsApp(_waPhone(a.whatsapp || a.telefone), wa);
  }

  console.log(`[siteMonitor] Digest semanal: ${leads.length} leads | GSC: ${gsc ? "✓" : "✗"}`);
}

// ── HTML Email ────────────────────────────────────────────────────────────────

function _buildDigestHtml(leads, prev, gsc) {
  const delta  = leads.length - prev.length;
  const urgent = leads.filter(l => l.urgencia === "Urgente").length;
  const byArea = {};
  for (const l of leads) {
    const k = l.area || "Não informada";
    byArea[k] = (byArea[k] || 0) + 1;
  }

  const th = v => `<td style="padding:5px 10px;font-size:11px;color:#888;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #1a2a4a;white-space:nowrap">${v}</td>`;
  const td = v => `<td style="padding:5px 10px;font-size:12px;color:#444;border-bottom:1px solid #eee;vertical-align:top">${v ?? "—"}</td>`;

  const card = (label, value, sub, subColor) => `
    <div style="flex:1;min-width:110px;border:1px solid #e2e8f0;padding:14px;text-align:center;background:#fff">
      <div style="font-size:26px;color:#1a2a4a;font-weight:300;line-height:1">${value}</div>
      <div style="font-size:9px;color:#999;letter-spacing:.1em;text-transform:uppercase;margin-top:4px">${label}</div>
      ${sub ? `<div style="font-size:11px;color:${subColor || "#888"};margin-top:3px">${sub}</div>` : ""}
    </div>`;

  let html = `
<div style="font-family:Arial,sans-serif;max-width:660px;margin:0 auto;background:#f5f5f0">
  <!-- Header -->
  <div style="background:#1a2a4a;padding:28px 32px;text-align:center">
    <p style="color:#b8a06a;font-size:10px;letter-spacing:.25em;text-transform:uppercase;margin:0 0 6px">Site Addere</p>
    <h1 style="color:#fff;font-size:20px;font-weight:300;letter-spacing:.12em;margin:0;text-transform:uppercase">Resumo Semanal</h1>
    <p style="color:rgba(255,255,255,.4);font-size:11px;margin:8px 0 0">${new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" })}</p>
  </div>

  <!-- Leads -->
  <div style="padding:28px 32px;background:#fff;margin-bottom:4px">
    <h2 style="color:#1a2a4a;font-size:13px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;margin:0 0 18px;padding-bottom:8px;border-bottom:2px solid #1a2a4a">
      📬 Formulário de Contato
    </h2>
    <div style="display:flex;gap:10px;margin-bottom:22px;flex-wrap:wrap">
      ${card("Esta semana", leads.length, delta !== 0 ? `${_sinal(delta)} vs anterior` : "igual à anterior", delta >= 0 ? "#16a34a" : "#dc2626")}
      ${urgent ? card("Urgentes 🔴", urgent, null, null) : ""}
      ${Object.entries(byArea).sort((a,b) => b[1]-a[1]).slice(0, 2).map(([k,v]) => card(k, v, null, null)).join("")}
    </div>`;

  if (leads.length) {
    html += `
    <table style="width:100%;border-collapse:collapse">
      <tr>${["Data","Nome","E-mail","Área","Urgência","Mensagem"].map(th).join("")}</tr>
      ${leads.map(l => `<tr>
        ${td(new Date(l.createdAt).toLocaleDateString("pt-BR"))}
        ${td(l.nome)}
        ${td(`<a href="mailto:${l.email}" style="color:#1a2a4a;text-decoration:none">${l.email}</a>`)}
        ${td(l.area)}
        ${td(l.urgencia === "Urgente"
          ? `<span style="background:#dc2626;color:#fff;padding:2px 6px;border-radius:3px;font-size:10px">URGENTE</span>`
          : l.urgencia)}
        ${td(String(l.mensagem || "").slice(0, 90) + (l.mensagem?.length > 90 ? "…" : ""))}
      </tr>`).join("")}
    </table>`;
  } else {
    html += `<p style="color:#bbb;font-size:13px;text-align:center;padding:16px 0">Nenhum contato recebido esta semana.</p>`;
  }
  html += `</div>`;

  // GSC
  if (gsc) {
    const t  = gsc.totals;
    const pt = gsc.prevTotals;
    const dc = pt ? t.clicks - pt.clicks : null;

    html += `
  <div style="padding:28px 32px;background:#f8f9fa;margin-bottom:4px;border-top:3px solid #b8a06a">
    <h2 style="color:#1a2a4a;font-size:13px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;margin:0 0 4px;padding-bottom:8px;border-bottom:2px solid #1a2a4a">
      🔍 Busca Orgânica (Google)
    </h2>
    <p style="color:#999;font-size:11px;margin:0 0 18px">${gsc.period}</p>
    <div style="display:flex;gap:10px;margin-bottom:22px;flex-wrap:wrap">
      ${card("Cliques",       t.clicks,          dc !== null ? `${_sinal(dc)} vs ant.` : null, dc >= 0 ? "#16a34a" : "#dc2626")}
      ${card("Impressões",    t.impressions,      null, null)}
      ${card("CTR",           _fmtPct(t.ctr),     null, null)}
      ${card("Posição média", _fmtPos(t.position),null, null)}
    </div>`;

    if (gsc.queries.length) {
      html += `
    <h3 style="color:#1a2a4a;font-size:11px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px">Top Termos de Busca</h3>
    <table style="width:100%;border-collapse:collapse">
      <tr>${["Termo","Cliques","Impressões","CTR","Posição"].map(th).join("")}</tr>
      ${gsc.queries.map(r => `<tr>
        ${td(r.keys[0])}
        ${td(r.clicks)}
        ${td(r.impressions)}
        ${td(_fmtPct(r.ctr))}
        ${td(_fmtPos(r.position))}
      </tr>`).join("")}
    </table>`;
    }
    html += `</div>`;
  } else {
    html += `
  <div style="padding:12px 32px;background:#f8f9fa;border-top:1px solid #eee">
    <p style="color:#ccc;font-size:11px;text-align:center;margin:0">
      Dados do Google Search Console indisponíveis esta semana.
    </p>
  </div>`;
  }

  // Uptime summary
  if (_historico.length > 10) {
    const ok    = _historico.filter(r => r.ok).length;
    const uptime = (ok / _historico.length * 100).toFixed(1);
    const avgMs  = ok ? Math.round(_historico.filter(r => r.ok).reduce((s,r) => s + r.ms, 0) / ok) : 0;
    html += `
  <div style="padding:20px 32px;background:#fff;border-top:1px solid #eee">
    <h2 style="color:#1a2a4a;font-size:13px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;margin:0 0 12px">🌐 Disponibilidade</h2>
    <div style="display:flex;gap:16px">
      ${card("Uptime 7 dias", `${uptime}%`, null, null)}
      ${card("Resposta média", `${avgMs}ms`, null, null)}
    </div>
  </div>`;
  }

  // Footer
  html += `
  <div style="background:#1a2a4a;padding:14px 32px;text-align:center">
    <p style="color:rgba(255,255,255,.3);font-size:10px;margin:0;letter-spacing:.08em">Addere On · Site Monitor Automático</p>
  </div>
</div>`;

  return html;
}

// ── WA summary ────────────────────────────────────────────────────────────────

function _buildDigestWA(leads, prev, gsc) {
  const delta  = leads.length - prev.length;
  const urgent = leads.filter(l => l.urgencia === "Urgente").length;
  const byArea = {};
  for (const l of leads) {
    const k = l.area || "Não informada";
    byArea[k] = (byArea[k] || 0) + 1;
  }
  const topAreas = Object.entries(byArea).sort((a,b) => b[1]-a[1]).slice(0, 3);

  let msg = `📊 *Resumo Semanal — Site Addere*\n\n`;
  msg += `📬 *Contatos:* ${leads.length}`;
  if (delta !== 0) msg += ` (${_sinal(delta)} vs sem. ant.)`;
  msg += "\n";
  if (urgent) msg += `🔴 *Urgentes:* ${urgent}\n`;
  if (topAreas.length) {
    msg += `\nÁreas:\n${topAreas.map(([k,v]) => `  • ${k}: ${v}`).join("\n")}\n`;
  }

  if (gsc) {
    const t  = gsc.totals;
    const pt = gsc.prevTotals;
    const dc = pt ? t.clicks - pt.clicks : null;
    msg += `\n🔍 *Google (${gsc.period})*\n`;
    msg += `  Cliques: ${t.clicks}${dc !== null ? ` (${_sinal(dc)})` : ""}\n`;
    msg += `  Impressões: ${t.impressions} · CTR: ${_fmtPct(t.ctr)}\n`;
    msg += `  Posição média: ${_fmtPos(t.position)}\n`;
    if (gsc.queries.length) {
      msg += `\nTop buscas:\n${gsc.queries.slice(0,5).map((r,i) => `  ${i+1}. ${r.keys[0]} (${r.clicks} cliques)`).join("\n")}\n`;
    }
  }

  if (_historico.length > 10) {
    const ok = _historico.filter(r => r.ok).length;
    msg += `\n🌐 Uptime: ${(ok / _historico.length * 100).toFixed(1)}%`;
  }

  return msg;
}

// ═════════════════════════════════════════════════════════════════════════════
// L4 — AUDITORIA IA (Claude Haiku)
// ═════════════════════════════════════════════════════════════════════════════

async function _auditoriaIA() {
  if (!process.env.ANTHROPIC_API_KEY) return;

  const hoje = _hoje();
  if (!(await _schedulerShouldRun("siteMonitor_audit", hoje))) return;
  await _schedulerMarkRun("siteMonitor_audit", hoje);

  // Captura HTML do site (SSR do Next.js entrega conteúdo completo)
  let pageText = "";
  try {
    const res = await fetch(SITE_URL, { signal: AbortSignal.timeout(15_000) });
    const raw = await res.text();
    pageText = raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 7000);
  } catch (err) {
    console.error("[siteMonitor] auditoriaIA fetch:", err.message);
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `Você é especialista em SEO e marketing digital para escritórios de advocacia no Brasil.

Analise o conteúdo extraído do site "${SITE_URL}" (escritório Addere, Belém/PA) e forneça:

## 1. Pontos Fortes (2–3 itens)
O que está funcionando bem no conteúdo atual.

## 2. Problemas Identificados (até 4 itens)
Lacunas de SEO, informações ausentes, textos pouco persuasivos, inconsistências.

## 3. Top 3 Melhorias Prioritárias
Impacto estimado (alto/médio/baixo) + sugestão concreta de texto ou ação.

## 4. Palavras-chave Sugeridas
Termos para advocacia empresarial em Belém/PA que ainda não estão sendo trabalhados.

Seja objetivo e prático. Máximo 500 palavras.

CONTEÚDO:
${pageText}`,
    }],
  }).catch(err => { console.error("[siteMonitor] Claude:", err.message); return null; });

  if (!response) return;

  const analysis = response.content[0]?.text || "";

  const html = `
<div style="font-family:Arial,sans-serif;max-width:660px;margin:0 auto;background:#f5f5f0">
  <div style="background:#1a2a4a;padding:28px 32px;text-align:center">
    <p style="color:#b8a06a;font-size:10px;letter-spacing:.25em;text-transform:uppercase;margin:0 0 6px">Site Addere</p>
    <h1 style="color:#fff;font-size:20px;font-weight:300;letter-spacing:.12em;margin:0;text-transform:uppercase">Auditoria Mensal — IA</h1>
    <p style="color:rgba(255,255,255,.4);font-size:11px;margin:8px 0 0">${new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric" })}</p>
  </div>
  <div style="padding:28px 32px;background:#fff;font-size:14px;line-height:1.75;color:#333;white-space:pre-wrap">
${analysis.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
  </div>
  <div style="background:#1a2a4a;padding:14px 32px;text-align:center">
    <p style="color:rgba(255,255,255,.3);font-size:10px;margin:0">Gerado por Claude Haiku · Addere On</p>
  </div>
</div>`;

  const admins = await _admins();
  for (const a of admins) {
    await sendEmail({ to: a.email, subject: "🔍 Auditoria Mensal IA — Site Addere", html });
    try {
      await sendWhatsAppTemplate(_waPhone(a.whatsapp || a.telefone), "relatorio_mensal_site");
    } catch (err) {
      console.warn("[siteMonitor] WA auditoria:", err.message);
    }
  }

  console.log("[siteMonitor] Auditoria IA enviada (email + WA)");
}

// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════

/** Disparo manual do digest (bypassa SchedulerLock — para testes/admin). */
export async function triggerDigestNow() {
  const since7  = new Date(Date.now() -  7 * 86_400_000);
  const since14 = new Date(Date.now() - 14 * 86_400_000);

  const [leads, prevLeads, gsc] = await Promise.all([
    prisma.contatoSite.findMany({ where: { createdAt: { gte: since7  } }, orderBy: { createdAt: "desc" } }),
    prisma.contatoSite.findMany({ where: { createdAt: { gte: since14, lt: since7 } } }),
    _fetchGSC(),
  ]);

  const admins = await _admins();
  if (!admins.length) throw new Error("Nenhum admin encontrado.");

  const html = _buildDigestHtml(leads, prevLeads, gsc);
  const wa   = _buildDigestWA(leads, prevLeads, gsc);

  for (const a of admins) {
    await sendEmail({ to: a.email, subject: "📊 [TESTE] Resumo Semanal — Site Addere", html });
    await sendWhatsApp(_waPhone(a.whatsapp || a.telefone), `[TESTE]\n${wa}`);
  }

  return { leads: leads.length, gsc: !!gsc, admins: admins.length };
}

/** Disparo manual do check de uptime. */
export async function triggerUptimeNow() {
  await _checkUptime();
  const last = _historico[_historico.length - 1];
  return { status: _siteStatus, ms: last?.ms ?? null };
}

export function startSiteMonitorScheduler() {
  // L1 — uptime a cada 5 minutos
  // Primeiro check adiado 3min para não sobrecarregar o startup junto com os demais schedulers
  setTimeout(() => {
    _checkUptime().catch(() => {});
    setInterval(
      () => _checkUptime().catch(e => console.error("[siteMonitor] uptime:", e.message)),
      5 * 60 * 1000,
    );
  }, 3 * 60 * 1000);

  // Tick a cada hora para as tarefas agendadas
  setInterval(() => {
    const now  = new Date();
    const day  = now.getUTCDay();   // 1 = segunda
    const hour = now.getUTCHours();
    const date = now.getUTCDate();

    // L2+L3 — Digest semanal: segunda 12h UTC (9h BRT)
    if (day === 1 && hour === 12) {
      _weeklyDigest().catch(e => console.error("[siteMonitor] digest:", e.message));
    }

    // L4 — Auditoria IA: dia 1 do mês 13h UTC (10h BRT)
    if (date === 1 && hour === 13) {
      _auditoriaIA().catch(e => console.error("[siteMonitor] auditoria:", e.message));
    }
  }, 60 * 60 * 1000);

  console.log("✅ Site Monitor iniciado (uptime/5min · digest/seg · auditoria/mensal)");
}
