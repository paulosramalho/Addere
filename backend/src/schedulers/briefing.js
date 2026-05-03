// backend/src/schedulers/briefing.js
// Briefing Executivo Semanal — toda segunda-feira, 9h BRT (12h UTC)

import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp } from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";

const IS_TEST = process.env.NODE_ENV === "test";

// Conta Clientes (id=5) representa dinheiro de clientes — excluir do saldo da firma
const CONTA_CLIENTES_ID = 5;

// Destinatário extra (Amanda) configurado via env vars
// Configurar no Render: EXTRA_NOTIFY_EMAIL, EXTRA_NOTIFY_PHONE, EXTRA_NOTIFY_NAME
function _extraRecipient() {
  const email = process.env.EXTRA_NOTIFY_EMAIL?.trim();
  const phone = process.env.EXTRA_NOTIFY_PHONE?.trim();
  const nome  = process.env.EXTRA_NOTIFY_NAME?.trim() || "Amanda";
  return email ? { email, phone, nome } : null;
}

function _waPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 11 || d.length === 10) return "55" + d;
  return d.length >= 8 ? "55" + d : null;
}

const fmtBRL = (c) =>
  (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function _fmtDate(d) {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(String(d).includes("T") ? d : `${d}T12:00:00`);
  if (isNaN(dt)) return "—";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

// ── Construção do HTML ────────────────────────────────────────────────────────
function buildEmailBriefing(nome, data) {
  const {
    saldoTotal, entradasSemana, saidasSemana, resultadoSemana,
    parcelasVencer, totalVencer, inadimplentes, processosMovidos,
    semanaLabel,
  } = data;

  const saldoColor = saldoTotal >= 0 ? "#16a34a" : "#dc2626";
  const resultColor = resultadoSemana >= 0 ? "#16a34a" : "#dc2626";

  const rowInad = inadimplentes.map(({ nome: cn, total, dias }) =>
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${cn}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#dc2626;font-weight:600">${fmtBRL(total)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#94a3b8">${dias}d</td>
    </tr>`
  ).join("");

  const rowProc = processosMovidos.map(({ numero, andamentos }) =>
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">${numero}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b">${andamentos} andamento(s)</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <!-- Header -->
  <tr><td style="background:#111d35;padding:24px 32px">
    <div style="color:#b8a06a;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere On</div>
    <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px">📊 Briefing Semanal</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:2px">${semanaLabel}</div>
  </td></tr>

  <!-- Saldo atual -->
  <tr><td style="padding:24px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Saldo total das contas</div>
    <div style="font-size:32px;font-weight:800;color:${saldoColor}">${fmtBRL(saldoTotal)}</div>
  </td></tr>

  <!-- Semana passada -->
  <tr><td style="padding:20px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Semana passada</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#f0fdf4;border-radius:8px;padding:12px 16px;width:32%">
          <div style="font-size:10px;color:#16a34a;font-weight:600">ENTRADAS</div>
          <div style="font-size:17px;font-weight:700;color:#16a34a">${fmtBRL(entradasSemana)}</div>
        </td>
        <td width="8"></td>
        <td style="background:#fef2f2;border-radius:8px;padding:12px 16px;width:32%">
          <div style="font-size:10px;color:#dc2626;font-weight:600">SAÍDAS</div>
          <div style="font-size:17px;font-weight:700;color:#dc2626">${fmtBRL(saidasSemana)}</div>
        </td>
        <td width="8"></td>
        <td style="background:#f8fafc;border-radius:8px;padding:12px 16px;width:32%">
          <div style="font-size:10px;color:#64748b;font-weight:600">RESULTADO</div>
          <div style="font-size:17px;font-weight:700;color:${resultColor}">${fmtBRL(resultadoSemana)}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Vencimentos desta semana -->
  <tr><td style="padding:20px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Vencimentos esta semana</div>
    <div style="background:#eff6ff;border-radius:8px;padding:14px 16px">
      <span style="font-size:22px;font-weight:700;color:#1d4ed8">${parcelasVencer}</span>
      <span style="font-size:13px;color:#3b82f6;margin-left:8px">parcela(s) · ${fmtBRL(totalVencer)}</span>
    </div>
  </td></tr>

  ${inadimplentes.length > 0 ? `
  <!-- Inadimplentes -->
  <tr><td style="padding:20px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Top inadimplentes</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1f5f9;border-radius:8px;overflow:hidden">
      <tr style="background:#f8fafc">
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;font-weight:600">Cliente</th>
        <th style="padding:6px 8px;text-align:right;font-size:11px;color:#64748b;font-weight:600">Em aberto</th>
        <th style="padding:6px 8px;text-align:right;font-size:11px;color:#64748b;font-weight:600">Atraso</th>
      </tr>
      ${rowInad}
    </table>
  </td></tr>` : ""}

  ${processosMovidos.length > 0 ? `
  <!-- Processos -->
  <tr><td style="padding:20px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Processos com movimentação</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1f5f9;border-radius:8px;overflow:hidden">
      ${rowProc}
    </table>
  </td></tr>` : ""}

  <!-- Footer -->
  <tr><td style="padding:24px 32px;border-top:1px solid #f1f5f9;margin-top:24px">
    <p style="font-size:11px;color:#94a3b8;margin:0">
      Olá, ${nome}. Este é o briefing automático do sistema Addere — gerado toda segunda-feira às 9h.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ── Busca de dados ────────────────────────────────────────────────────────────
async function _fetchBriefingData() {
  const agora = new Date();

  // Semana passada: seg → dom
  const diaSemana = agora.getUTCDay(); // 0=dom, 1=seg...
  const diasDesdeSegPassada = diaSemana === 0 ? 6 : diaSemana + 6;
  const segPassada = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - diasDesdeSegPassada, 0, 0, 0));
  const domPassada = new Date(Date.UTC(segPassada.getUTCFullYear(), segPassada.getUTCMonth(), segPassada.getUTCDate() + 6, 23, 59, 59));

  // Esta semana: seg → dom
  const hoje = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 0, 0, 0));
  const fimSemana = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + 6, 23, 59, 59));

  const semanaLabel = `${_fmtDate(segPassada)} a ${_fmtDate(domPassada)} · semana passada`;

  const [contas, entradasAgg, saidasAgg, entradasSemAgg, saidasSemAgg, parcelasVencer, parcelasVencidas, processosComMovim] = await Promise.all([
    // Saldo da firma: exclui conta Clientes (id=5) — representa dinheiro de clientes, não da firma
    prisma.livroCaixaConta.findMany({
      where: { ativa: true, id: { not: CONTA_CLIENTES_ID } },
      select: { saldoInicialCent: true },
    }),

    prisma.livroCaixaLancamento.aggregate({
      where: { es: "E", statusFluxo: "EFETIVADO", contaId: { not: CONTA_CLIENTES_ID } },
      _sum: { valorCentavos: true },
    }),
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "S", statusFluxo: "EFETIVADO", contaId: { not: CONTA_CLIENTES_ID } },
      _sum: { valorCentavos: true },
    }),

    // Entradas/saídas da semana passada
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "E", statusFluxo: "EFETIVADO", data: { gte: segPassada, lte: domPassada } },
      _sum: { valorCentavos: true },
    }),
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "S", statusFluxo: "EFETIVADO", data: { gte: segPassada, lte: domPassada } },
      _sum: { valorCentavos: true },
    }),

    // Parcelas a vencer nesta semana
    prisma.parcelaContrato.findMany({
      where: { status: "PREVISTA", vencimento: { gte: hoje, lte: fimSemana } },
      select: { valorPrevisto: true },
    }),

    // Inadimplentes (parcelas vencidas, top 5 por valor)
    prisma.parcelaContrato.findMany({
      where: { status: "PREVISTA", vencimento: { lt: hoje } },
      include: { contrato: { select: { cliente: { select: { nomeRazaoSocial: true } } } } },
    }),

    // Processos com andamento na semana passada
    prisma.processoAndamento.findMany({
      where: { createdAt: { gte: segPassada, lte: domPassada } },
      include: { processo: { select: { numeroProcesso: true } } },
    }),
  ]);

  // Saldo total
  const saldoBase = contas.reduce((s, c) => s + (c.saldoInicialCent || 0), 0);
  const totalE = Number(entradasAgg._sum.valorCentavos || 0);
  const totalS = Number(saidasAgg._sum.valorCentavos || 0);
  const saldoTotal = saldoBase + totalE - totalS;

  // Semana passada
  const entradasSemana = Number(entradasSemAgg._sum.valorCentavos || 0);
  const saidasSemana = Number(saidasSemAgg._sum.valorCentavos || 0);
  const resultadoSemana = entradasSemana - saidasSemana;

  // Vencimentos desta semana
  const parcelasVencerCount = parcelasVencer.length;
  const totalVencer = parcelasVencer.reduce((s, p) => s + (Number(p.valorPrevisto || 0) * 100), 0);

  // Inadimplentes agrupados por cliente, top 5
  const porCliente = new Map();
  const hoje2 = Date.now();
  for (const p of parcelasVencidas) {
    const cn = p.contrato?.cliente?.nomeRazaoSocial || "Sem nome";
    const val = Number(p.valorPrevisto || 0) * 100;
    const dias = Math.floor((hoje2 - new Date(p.vencimento).getTime()) / 86400000);
    const cur = porCliente.get(cn) || { nome: cn, total: 0, dias: 0 };
    porCliente.set(cn, { nome: cn, total: cur.total + val, dias: Math.max(cur.dias, dias) });
  }
  const inadimplentes = [...porCliente.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Processos agrupados por número
  const porProcesso = new Map();
  for (const a of processosComMovim) {
    const num = a.processo?.numeroProcesso || `#${a.processoId}`;
    porProcesso.set(num, (porProcesso.get(num) || 0) + 1);
  }
  const processosMovidos = [...porProcesso.entries()]
    .map(([numero, andamentos]) => ({ numero, andamentos }))
    .slice(0, 5);

  return {
    saldoTotal, entradasSemana, saidasSemana, resultadoSemana,
    parcelasVencer: parcelasVencerCount, totalVencer,
    inadimplentes, processosMovidos, semanaLabel,
  };
}

// ── Montagem do texto WA ──────────────────────────────────────────────────────
function _buildWABriefing(data) {
  const { saldoTotal, entradasSemana, saidasSemana, resultadoSemana,
    parcelasVencer, totalVencer, inadimplentes, processosMovidos } = data;
  const sign = (v) => v >= 0 ? "+" : "";
  return [
    `📊 *Briefing Semanal — Addere*`,
    ``,
    `💰 Saldo atual: *${fmtBRL(saldoTotal)}*`,
    ``,
    `*Semana passada:*`,
    `↑ Entradas: ${fmtBRL(entradasSemana)}`,
    `↓ Saídas: ${fmtBRL(saidasSemana)}`,
    `= Resultado: ${sign(resultadoSemana)}${fmtBRL(resultadoSemana)}`,
    ``,
    `📅 Vencimentos esta semana: *${parcelasVencer} parcela(s)* · ${fmtBRL(totalVencer)}`,
    inadimplentes.length > 0
      ? `\n⚠️ *Top inadimplentes:*\n` + inadimplentes.map(i => `  • ${i.nome}: ${fmtBRL(i.total)} (${i.dias}d)`).join("\n")
      : "",
    processosMovidos.length > 0
      ? `\n⚖️ *Processos com movimentação:* ${processosMovidos.length}`
      : "",
  ].filter(Boolean).join("\n");
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
let _ultimoBriefing = null;

export function startBriefingScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    const agora = new Date();

    // Segunda-feira (UTC day === 1), 12h UTC = 9h BRT
    if (agora.getUTCDay() !== 1) return;
    if (agora.getUTCHours() !== 12) return;

    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoBriefing === hoje) return;
    if (!await _schedulerShouldRun("briefing_semanal", hoje)) { _ultimoBriefing = hoje; return; }
    _ultimoBriefing = hoje;
    await _schedulerMarkRun("briefing_semanal", hoje);

    try {
      console.log("📊 [Briefing] Gerando briefing semanal...");
      const dados = await _fetchBriefingData();

      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { email: true, nome: true, whatsapp: true, telefone: true },
      });

      // E-mail para cada admin
      await Promise.allSettled(admins.map(admin =>
        sendEmail({
          to: admin.email,
          subject: `📊 Addere — Briefing Semanal · Saldo ${fmtBRL(dados.saldoTotal)}`,
          html: buildEmailBriefing(admin.nome || "Gestor", dados),
        })
      ));

      // WhatsApp para cada admin
      const waMsg = _buildWABriefing(dados);
      for (const admin of admins) {
        const phone = _waPhone(admin.whatsapp || admin.telefone);
        if (phone) sendWhatsApp(phone, waMsg).catch(() => {});
      }

      // Destinatário extra (ex: Amanda) via env vars
      const extra = _extraRecipient();
      if (extra) {
        sendEmail({
          to: extra.email,
          subject: `📊 Addere — Briefing Semanal · Saldo ${fmtBRL(dados.saldoTotal)}`,
          html: buildEmailBriefing(extra.nome, dados),
        }).catch(() => {});
        const extraPhone = _waPhone(extra.phone);
        if (extraPhone) sendWhatsApp(extraPhone, waMsg).catch(() => {});
      }

      console.log(`📊 [Briefing] Enviado para ${admins.length} admin(s)${extra ? " + " + extra.nome : ""}.`);
    } catch (err) {
      console.error("❌ [Briefing] Erro ao gerar briefing:", err.message);
    }
  }, 60 * 60 * 1000);
}
