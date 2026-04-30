// backend/src/schedulers/andamentosIA.js
// Análise de Andamentos com IA — diário, 10h30 BRT (13h30 UTC)
// Usa Claude Haiku para classificar andamentos das últimas 24h
// e envia digest enriquecido por advogado.

import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp } from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";
import Anthropic from "@anthropic-ai/sdk";

const IS_TEST = process.env.NODE_ENV === "test";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function _waPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 11 || d.length === 10) return "55" + d;
  return d.length >= 8 ? "55" + d : null;
}

function _fmtDate(d) {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(String(d).includes("T") ? d : `${d}T12:00:00`);
  if (isNaN(dt)) return "—";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

// ── Classificação IA de um andamento ──────────────────────────────────────────
const TIPOS_VALIDOS = ["PRAZO", "AUDIENCIA", "DECISAO_FAVORAVEL", "DECISAO_DESFAVORAVEL", "DESPACHO", "NEUTRO"];

async function _classificarAndamento(descricao) {
  if (!anthropic) return { tipo: "NEUTRO", resumo: descricao.slice(0, 120), prazo: null };

  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: `Você é um assistente jurídico. Analise movimentações processuais e retorne APENAS um JSON no formato:
{"tipo":"TIPO","resumo":"resumo em até 80 chars","prazo":"DD/MM/AAAA ou null"}

TIPO deve ser um de: PRAZO, AUDIENCIA, DECISAO_FAVORAVEL, DECISAO_DESFAVORAVEL, DESPACHO, NEUTRO.
- PRAZO: menciona prazo, intimação, citação, data limite
- AUDIENCIA: designa audiência, sessão de julgamento, data de audiência
- DECISAO_FAVORAVEL: deferimento, procedente, julgamento favorável ao advogado
- DECISAO_DESFAVORAVEL: indeferimento, improcedente, julgamento desfavorável
- DESPACHO: despacho de mero expediente, juntada, vista
- NEUTRO: tudo o mais

Extraia prazo somente se houver data explícita mencionada. Resumo em português simples.`,
      messages: [{ role: "user", content: descricao.slice(0, 800) }],
    });

    const raw = resp.content[0]?.text?.trim() || "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { tipo: "NEUTRO", resumo: descricao.slice(0, 80), prazo: null };
    const parsed = JSON.parse(match[0]);
    return {
      tipo: TIPOS_VALIDOS.includes(parsed.tipo) ? parsed.tipo : "NEUTRO",
      resumo: String(parsed.resumo || descricao.slice(0, 80)),
      prazo: parsed.prazo && parsed.prazo !== "null" ? parsed.prazo : null,
    };
  } catch (_) {
    return { tipo: "NEUTRO", resumo: descricao.slice(0, 80), prazo: null };
  }
}

const TIPO_ICON = {
  PRAZO: "⏰",
  AUDIENCIA: "⚖️",
  DECISAO_FAVORAVEL: "✅",
  DECISAO_DESFAVORAVEL: "❌",
  DESPACHO: "📋",
  NEUTRO: "📄",
};

const TIPO_LABEL = {
  PRAZO: "Prazo",
  AUDIENCIA: "Audiência",
  DECISAO_FAVORAVEL: "Decisão Favorável",
  DECISAO_DESFAVORAVEL: "Decisão Desfavorável",
  DESPACHO: "Despacho",
  NEUTRO: "Andamento",
};

// ── HTML do digest ─────────────────────────────────────────────────────────────
function _buildEmailDigest(nomeAdv, processos) {
  const rows = processos.map(({ numero, andamentos }) => {
    const andRows = andamentos.map(a => {
      const icon = TIPO_ICON[a.tipo] || "📄";
      const label = TIPO_LABEL[a.tipo] || "Andamento";
      const prazoHtml = a.prazo
        ? `<div style="margin-top:4px;font-size:11px;color:#b45309;font-weight:600">⏰ Prazo: ${a.prazo}</div>`
        : "";
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top">
          <div style="font-size:11px;color:#64748b;margin-bottom:2px">${icon} ${label} · ${_fmtDate(a.dataAndamento)}</div>
          <div style="font-size:13px;color:#111">${a.resumo}</div>
          ${prazoHtml}
        </td>
      </tr>`;
    }).join("");

    return `<div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#111d35;margin-bottom:6px">⚖️ ${numero}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        ${andRows}
      </table>
    </div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#111d35;padding:20px 28px">
    <div style="color:#b8a06a;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere · Processos</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">⚖️ Andamentos de hoje</div>
    <div style="color:#94a3b8;font-size:12px;margin-top:2px">Análise automática por IA</div>
  </td></tr>
  <tr><td style="padding:20px 28px 0">
    <p style="font-size:13px;color:#64748b;margin:0 0 16px">Olá, ${nomeAdv}. Novos andamentos foram detectados nos seus processos:</p>
    ${rows}
  </td></tr>
  <tr><td style="padding:16px 28px">
    <p style="font-size:11px;color:#94a3b8;margin:0">Resumos gerados automaticamente por IA. Verifique o sistema para o texto completo.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
let _ultimoAndamentosIA = null;

export function startAndamentosIAScheduler() {
  if (IS_TEST) return;
  if (!anthropic) {
    console.warn("⚠️ [AndamentosIA] ANTHROPIC_API_KEY não configurada — scheduler desabilitado.");
    return;
  }

  setInterval(async () => {
    const agora = new Date();
    if (agora.getUTCHours() !== 13) return; // 13h UTC = 10h BRT

    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoAndamentosIA === hoje) return;
    if (!await _schedulerShouldRun("andamentos_ia", hoje)) { _ultimoAndamentosIA = hoje; return; }
    _ultimoAndamentosIA = hoje;
    await _schedulerMarkRun("andamentos_ia", hoje);

    try {
      console.log("🤖 [AndamentosIA] Buscando andamentos das últimas 24h...");

      const limite = new Date(Date.UTC(
        agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - 1, 0, 0, 0
      ));

      // Andamentos criados nas últimas 24h, com processo e advogado
      const andamentos = await prisma.processoAndamento.findMany({
        where: { createdAt: { gte: limite } },
        include: {
          processo: {
            select: {
              numeroProcesso: true,
              advogadoId: true,
              advogado: {
                select: { id: true, nome: true, email: true, whatsapp: true, telefone: true, ativo: true },
              },
            },
          },
        },
        orderBy: { processoId: "asc" },
      });

      if (andamentos.length === 0) {
        console.log("🤖 [AndamentosIA] Nenhum andamento novo.");
        return;
      }

      console.log(`🤖 [AndamentosIA] ${andamentos.length} andamento(s) para analisar...`);

      // Classificar com IA (em série para não sobrecarregar)
      const classificados = [];
      for (const a of andamentos) {
        const analise = await _classificarAndamento(a.descricao || "");
        classificados.push({ ...a, ...analise });
        await new Promise(r => setTimeout(r, 300)); // rate limit Anthropic
      }

      // Agrupar por advogado → processo
      const porAdvogado = new Map();
      for (const a of classificados) {
        const adv = a.processo?.advogado;
        if (!adv || !adv.ativo) continue;

        const advKey = adv.id;
        if (!porAdvogado.has(advKey)) {
          porAdvogado.set(advKey, { adv, processos: new Map() });
        }
        const { processos } = porAdvogado.get(advKey);
        const num = a.processo.numeroProcesso || `#${a.processoId}`;
        if (!processos.has(num)) processos.set(num, []);
        processos.get(num).push(a);
      }

      // Enviar digest para cada advogado
      for (const { adv, processos } of porAdvogado.values()) {
        // Filtrar processos com andamentos não-NEUTRO prioritariamente
        const processosArr = [...processos.entries()].map(([numero, ands]) => ({ numero, andamentos: ands }));
        const temImportante = processosArr.some(p => p.andamentos.some(a => a.tipo !== "NEUTRO"));

        if (!adv.email && !adv.whatsapp && !adv.telefone) continue;

        // E-mail com digest completo
        if (adv.email) {
          const html = _buildEmailDigest(adv.nome, processosArr);
          const urgente = temImportante ? "⚠️ " : "";
          await sendEmail({
            to: adv.email,
            subject: `${urgente}Addere — ${andamentos.filter(a => a.processo.advogadoId === adv.id).length} andamento(s) em seus processos`,
            html,
          }).catch(() => {});
        }

        // WhatsApp: só se houver andamento importante
        if (temImportante) {
          const phone = _waPhone(adv.whatsapp || adv.telefone);
          if (phone) {
            const importantesCount = processosArr.flatMap(p => p.andamentos).filter(a => a.tipo !== "NEUTRO").length;
            const waMsg = [
              `⚖️ *Andamentos — Addere*`,
              `Olá, ${adv.nome}! ${importantesCount} andamento(s) importante(s) detectado(s) hoje:`,
              ...processosArr.flatMap(({ numero, andamentos: ands }) =>
                ands.filter(a => a.tipo !== "NEUTRO").map(a =>
                  `${TIPO_ICON[a.tipo]} *${numero}*: ${a.resumo}${a.prazo ? ` (prazo: ${a.prazo})` : ""}`
                )
              ),
              `\nAcesse o sistema para ver todos os andamentos.`,
            ].join("\n");
            sendWhatsApp(phone, waMsg).catch(() => {});
          }
        }
      }

      console.log(`🤖 [AndamentosIA] Digest enviado para ${porAdvogado.size} advogado(s).`);
    } catch (err) {
      console.error("❌ [AndamentosIA] Erro:", err.message);
    }
  }, 60 * 60 * 1000);
}
