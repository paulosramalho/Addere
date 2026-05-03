// backend/src/schedulers/saudeCaixa.js
// Monitor de Saúde do Caixa — diário, 9h BRT (12h UTC)
// Dispara alerta WA apenas quando alguma condição crítica é detectada.

import prisma from "../lib/prisma.js";
import { sendWhatsApp } from "../lib/whatsapp.js";
import { sendEmail } from "../lib/email.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";

// Exportada para trigger manual via rota admin
export async function runSaudeCaixaAgora() {
  const { alertas, saldoTotal } = await _verificarSaude();
  if (alertas.length === 0) {
    console.log("🏥 [SaúdeCaixa] Caixa saudável — sem alertas.");
    return { alertas: [], saldoTotal, enviado: false };
  }
  const admins = await prisma.usuario.findMany({
    where: { role: "ADMIN", ativo: true },
    select: { email: true, nome: true, whatsapp: true, telefone: true },
  });
  const waMsg = _buildMsgAlerta(alertas, saldoTotal);
  for (const admin of admins) {
    const phone = _waPhone(admin.whatsapp || admin.telefone);
    if (phone) sendWhatsApp(phone, waMsg).catch(() => {});
    sendEmail({
      to: admin.email,
      subject: `🏥 Addere — ${alertas.length} alerta(s) de caixa detectado(s)`,
      html: _buildEmailAlerta(admin.nome || "Gestor", alertas, saldoTotal),
    }).catch(() => {});
  }
  // Destinatário extra (Amanda)
  const extra = _extraRecipient();
  if (extra) {
    sendEmail({
      to: extra.email,
      subject: `🏥 Addere — ${alertas.length} alerta(s) de caixa detectado(s)`,
      html: _buildEmailAlerta(extra.nome, alertas, saldoTotal),
    }).catch(() => {});
    const extraPhone = _waPhone(extra.phone);
    if (extraPhone) sendWhatsApp(extraPhone, waMsg).catch(() => {});
  }
  return { alertas, saldoTotal, enviado: true };
}

const IS_TEST = process.env.NODE_ENV === "test";

// Destinatário extra (Amanda) via env vars — mesmas vars do briefing
function _extraRecipient() {
  const email = process.env.EXTRA_NOTIFY_EMAIL?.trim();
  const phone = process.env.EXTRA_NOTIFY_PHONE?.trim();
  const nome  = process.env.EXTRA_NOTIFY_NAME?.trim() || "Amanda";
  return email ? { email, phone, nome } : null;
}

// Threshold de saldo mínimo: R$ 5.000 (ajustar conforme necessidade)
const SALDO_MINIMO_CENT = 500000;
// Dias sem entrada que aciona alerta
const DIAS_SEM_ENTRADA = 5;

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

// ── Diagnóstico ───────────────────────────────────────────────────────────────
async function _verificarSaude() {
  const agora = new Date();
  const alertas = [];

  // ── 1. Saldo atual total (somente contas ATIVAS; exclui conta Clientes id=5) ──
  const CONTA_CLIENTES_ID = 5;
  const contasAtivas = await prisma.livroCaixaConta.findMany({
    where: { ativa: true, id: { not: CONTA_CLIENTES_ID } },
    select: { id: true, saldoInicialCent: true },
  });
  const idsAtivos = contasAtivas.map(c => c.id);

  const [entradasAgg, saidasAgg] = await Promise.all([
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "E", statusFluxo: "EFETIVADO", contaId: { in: idsAtivos } },
      _sum: { valorCentavos: true },
    }),
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "S", statusFluxo: "EFETIVADO", contaId: { in: idsAtivos } },
      _sum: { valorCentavos: true },
    }),
  ]);

  const saldoBase = contasAtivas.reduce((s, c) => s + (c.saldoInicialCent || 0), 0);
  const totalE = Number(entradasAgg._sum.valorCentavos || 0);
  const totalS = Number(saidasAgg._sum.valorCentavos || 0);
  const saldoTotal = saldoBase + totalE - totalS;

  if (saldoTotal < SALDO_MINIMO_CENT) {
    alertas.push({
      nivel: "CRITICO",
      titulo: "Saldo abaixo do mínimo",
      detalhe: `Saldo atual: *${fmtBRL(saldoTotal)}* (mínimo configurado: ${fmtBRL(SALDO_MINIMO_CENT)})`,
    });
  }

  // ── 2. Saldo negativo ─────────────────────────────────────────────────────
  if (saldoTotal < 0) {
    alertas.push({
      nivel: "CRITICO",
      titulo: "Caixa negativo",
      detalhe: `Saldo total está negativo: *${fmtBRL(saldoTotal)}*`,
    });
  }

  // ── 3. Sem entradas nos últimos N dias úteis ──────────────────────────────
  const limiteEntrada = new Date(Date.UTC(
    agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - DIAS_SEM_ENTRADA, 0, 0, 0
  ));
  const ultimaEntrada = await prisma.livroCaixaLancamento.findFirst({
    where: { es: "E", statusFluxo: "EFETIVADO", data: { gte: limiteEntrada }, contaId: { not: CONTA_CLIENTES_ID } },
    orderBy: { data: "desc" },
    select: { data: true },
  });
  if (!ultimaEntrada) {
    alertas.push({
      nivel: "ATENCAO",
      titulo: `Sem entradas nos últimos ${DIAS_SEM_ENTRADA} dias`,
      detalhe: `Nenhuma entrada efetivada registrada nos últimos ${DIAS_SEM_ENTRADA} dias.`,
    });
  }

  // ── 4. Muitos vencidos (LC PREVISTO vencido há mais de 30 dias) ──────────
  const limite30 = new Date(Date.UTC(
    agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - 30, 0, 0, 0
  ));
  const vencidos30 = await prisma.livroCaixaLancamento.count({
    where: { statusFluxo: "PREVISTO", data: { lt: limite30 }, contaId: { not: CONTA_CLIENTES_ID } },
  });
  if (vencidos30 >= 5) {
    alertas.push({
      nivel: "ATENCAO",
      titulo: "Muitos lançamentos vencidos",
      detalhe: `*${vencidos30} lançamento(s)* com mais de 30 dias de atraso no Livro Caixa.`,
    });
  }

  return { alertas, saldoTotal };
}

function _buildMsgAlerta(alertas, saldoTotal) {
  const icons = { CRITICO: "🔴", ATENCAO: "🟡" };
  const linhas = alertas.map(a => `${icons[a.nivel] || "⚠️"} *${a.titulo}*\n${a.detalhe}`);
  return [
    `🏥 *Saúde do Caixa — Addere*`,
    `Saldo atual: *${fmtBRL(saldoTotal)}*`,
    ``,
    ...linhas,
    ``,
    `Acesse o sistema para mais detalhes.`,
  ].join("\n");
}

function _buildEmailAlerta(nomeAdmin, alertas, saldoTotal) {
  const icons = { CRITICO: "🔴", ATENCAO: "🟡" };
  const rows = alertas.map(a =>
    `<tr>
      <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9">
        <div style="font-size:14px;font-weight:700;color:#111">${icons[a.nivel] || "⚠️"} ${a.titulo}</div>
        <div style="font-size:13px;color:#64748b;margin-top:3px">${a.detalhe.replace(/\*/g, "")}</div>
      </td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#7f1d1d;padding:20px 28px">
    <div style="color:#fca5a5;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere On · Alerta</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">🏥 Saúde do Caixa</div>
  </td></tr>
  <tr><td style="padding:20px 28px 0">
    <div style="font-size:12px;color:#64748b">Saldo atual</div>
    <div style="font-size:28px;font-weight:800;color:${saldoTotal >= 0 ? "#16a34a" : "#dc2626"}">${fmtBRL(saldoTotal)}</div>
  </td></tr>
  <tr><td style="padding:16px 28px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Alertas detectados</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fee2e2;border-radius:8px;overflow:hidden">
      ${rows}
    </table>
  </td></tr>
  <tr><td style="padding:20px 28px">
    <p style="font-size:11px;color:#94a3b8;margin:0">Olá, ${nomeAdmin}. Acesse o sistema para mais detalhes. Este alerta é enviado apenas quando condições críticas são detectadas.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
let _ultimoSaude = null;

export function startSaudeCaixaScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    const agora = new Date();
    if (agora.getUTCHours() !== 12) return; // 12h UTC = 9h BRT

    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoSaude === hoje) return;
    if (!await _schedulerShouldRun("saude_caixa", hoje)) { _ultimoSaude = hoje; return; }
    _ultimoSaude = hoje;
    await _schedulerMarkRun("saude_caixa", hoje);

    try {
      const { alertas, saldoTotal } = await _verificarSaude();

      if (alertas.length === 0) {
        console.log("🏥 [SaúdeCaixa] Caixa saudável — sem alertas.");
        return;
      }

      console.log(`🏥 [SaúdeCaixa] ${alertas.length} alerta(s) detectado(s).`);

      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { email: true, nome: true, whatsapp: true, telefone: true },
      });

      const waMsg = _buildMsgAlerta(alertas, saldoTotal);

      for (const admin of admins) {
        // WA imediato (alerta urgente)
        const phone = _waPhone(admin.whatsapp || admin.telefone);
        if (phone) sendWhatsApp(phone, waMsg).catch(() => {});

        // Email com detalhes
        sendEmail({
          to: admin.email,
          subject: `🏥 Addere — ${alertas.length} alerta(s) de caixa detectado(s)`,
          html: _buildEmailAlerta(admin.nome || "Gestor", alertas, saldoTotal),
        }).catch(() => {});
      }

      // Destinatário extra (Amanda)
      const extra = _extraRecipient();
      if (extra) {
        sendEmail({
          to: extra.email,
          subject: `🏥 Addere — ${alertas.length} alerta(s) de caixa detectado(s)`,
          html: _buildEmailAlerta(extra.nome, alertas, saldoTotal),
        }).catch(() => {});
        const extraPhone = _waPhone(extra.phone);
        if (extraPhone) sendWhatsApp(extraPhone, waMsg).catch(() => {});
      }
    } catch (err) {
      console.error("❌ [SaúdeCaixa] Erro:", err.message);
    }
  }, 60 * 60 * 1000);
}
