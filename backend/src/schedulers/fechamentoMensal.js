// backend/src/schedulers/fechamentoMensal.js
// Fechamento Mensal — último dia do mês, 17h BRT (20h UTC)
// Envia resumo financeiro do mês que encerra para os admins.

import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp } from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";

const IS_TEST = process.env.NODE_ENV === "test";

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

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
               "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function _isUltimoDiaDoMes(d) {
  const amanha = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return amanha.getUTCDate() === 1;
}

// ── Busca de dados do mês ─────────────────────────────────────────────────────
async function _fetchDadosMes(ano, mes) {
  // Primeiro e último dia do mês (UTC)
  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 0, 0, 0));
  const fim = new Date(Date.UTC(ano, mes, 0, 23, 59, 59)); // dia 0 do mês seguinte = último dia do mês atual

  const [entradasAgg, saidasAgg, parcelasRecebidas, parcelasVencidas,
         contasCents, totalEntradasAgg, totalSaidasAgg, repassesMes] = await Promise.all([

    // Entradas do mês
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "E", statusFluxo: "EFETIVADO", data: { gte: inicio, lte: fim } },
      _sum: { valorCentavos: true },
    }),

    // Saídas do mês
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "S", statusFluxo: "EFETIVADO", data: { gte: inicio, lte: fim } },
      _sum: { valorCentavos: true },
    }),

    // Parcelas recebidas no mês
    prisma.parcelaContrato.findMany({
      where: { status: { in: ["RECEBIDA", "REPASSE_EFETUADO"] }, dataRecebimento: { gte: inicio, lte: fim } },
      select: { valorRecebido: true, contrato: { select: { cliente: { select: { nomeRazaoSocial: true } } } } },
    }),

    // Parcelas que venceram no mês e ainda estão abertas (inadimplência do mês)
    prisma.parcelaContrato.count({
      where: { status: "PREVISTA", vencimento: { gte: inicio, lte: fim } },
    }),

    // Saldo total acumulado
    prisma.livroCaixaConta.findMany({ where: { ativa: true }, select: { saldoInicialCent: true } }),
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "E", statusFluxo: "EFETIVADO" },
      _sum: { valorCentavos: true },
    }),
    prisma.livroCaixaLancamento.aggregate({
      where: { es: "S", statusFluxo: "EFETIVADO" },
      _sum: { valorCentavos: true },
    }),

    // Repasses realizados no mês
    prisma.repasseRealizado.aggregate({
      where: { criadoEm: { gte: inicio, lte: fim } },
      _sum: { valorPago: true },
      _count: { id: true },
    }).catch(() => ({ _sum: { valorPago: null }, _count: { id: 0 } })),
  ]);

  const totalEntradas = Number(entradasAgg._sum.valorCentavos || 0);
  const totalSaidas = Number(saidasAgg._sum.valorCentavos || 0);
  const resultado = totalEntradas - totalSaidas;

  // Saldo total
  const saldoBase = contasCents.reduce((s, c) => s + (c.saldoInicialCent || 0), 0);
  const saldoTotal = saldoBase + Number(totalEntradasAgg._sum.valorCentavos || 0) - Number(totalSaidasAgg._sum.valorCentavos || 0);

  // Top 5 clientes por valor recebido
  const porCliente = new Map();
  for (const p of parcelasRecebidas) {
    const cn = p.contrato?.cliente?.nomeRazaoSocial || "Sem nome";
    const val = Number(p.valorRecebido || 0) * 100;
    porCliente.set(cn, (porCliente.get(cn) || 0) + val);
  }
  const topClientes = [...porCliente.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const totalRepassesCent = Number(repassesMes._sum.valorPago || 0) * 100;

  return {
    mes: MESES[mes - 1], ano,
    totalEntradas, totalSaidas, resultado, saldoTotal,
    parcelasRecebidas: parcelasRecebidas.length,
    parcelasEmAberto: parcelasVencidas,
    topClientes,
    repassesQtd: repassesMes._count.id,
    totalRepassesCent,
  };
}

// ── HTML do fechamento ─────────────────────────────────────────────────────────
function _buildEmailFechamento(nomeAdmin, d) {
  const { mes, ano, totalEntradas, totalSaidas, resultado, saldoTotal,
    parcelasRecebidas, parcelasEmAberto, topClientes, repassesQtd, totalRepassesCent } = d;

  const resultColor = resultado >= 0 ? "#16a34a" : "#dc2626";
  const resultSign = resultado >= 0 ? "+" : "";

  const topRows = topClientes.map(({ nome, total }) =>
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px">${nome}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;font-size:13px">${fmtBRL(total)}</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <!-- Header -->
  <tr><td style="background:#111d35;padding:24px 32px">
    <div style="color:#b8a06a;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere On · Fechamento</div>
    <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px">📅 Fechamento de ${mes} ${ano}</div>
  </td></tr>

  <!-- Resultado do mês -->
  <tr><td style="padding:24px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Resultado do mês</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#f0fdf4;border-radius:8px;padding:14px 16px;width:32%">
          <div style="font-size:10px;color:#16a34a;font-weight:600">ENTRADAS</div>
          <div style="font-size:17px;font-weight:700;color:#16a34a">${fmtBRL(totalEntradas)}</div>
        </td>
        <td width="8"></td>
        <td style="background:#fef2f2;border-radius:8px;padding:14px 16px;width:32%">
          <div style="font-size:10px;color:#dc2626;font-weight:600">SAÍDAS</div>
          <div style="font-size:17px;font-weight:700;color:#dc2626">${fmtBRL(totalSaidas)}</div>
        </td>
        <td width="8"></td>
        <td style="background:#f8fafc;border-radius:8px;padding:14px 16px;width:32%">
          <div style="font-size:10px;color:#64748b;font-weight:600">RESULTADO</div>
          <div style="font-size:17px;font-weight:700;color:${resultColor}">${resultSign}${fmtBRL(resultado)}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Saldo e indicadores -->
  <tr><td style="padding:20px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Indicadores</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#f8fafc;border-radius:8px;padding:12px 16px;width:48%">
          <div style="font-size:10px;color:#64748b">Saldo total acumulado</div>
          <div style="font-size:20px;font-weight:800;color:${saldoTotal >= 0 ? "#111" : "#dc2626"}">${fmtBRL(saldoTotal)}</div>
        </td>
        <td width="8"></td>
        <td style="background:#f8fafc;border-radius:8px;padding:12px 16px;width:48%">
          <div style="font-size:10px;color:#64748b">Repasses realizados</div>
          <div style="font-size:20px;font-weight:800;color:#111">${repassesQtd}</div>
          <div style="font-size:12px;color:#64748b">${fmtBRL(totalRepassesCent)}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Parcelas -->
  <tr><td style="padding:16px 32px 0">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#eff6ff;border-radius:8px;padding:12px 16px;width:48%">
          <div style="font-size:10px;color:#3b82f6">Parcelas recebidas</div>
          <div style="font-size:22px;font-weight:800;color:#1d4ed8">${parcelasRecebidas}</div>
        </td>
        <td width="8"></td>
        <td style="background:${parcelasEmAberto > 0 ? "#fef2f2" : "#f0fdf4"};border-radius:8px;padding:12px 16px;width:48%">
          <div style="font-size:10px;color:${parcelasEmAberto > 0 ? "#dc2626" : "#16a34a"}">Inadimplentes no mês</div>
          <div style="font-size:22px;font-weight:800;color:${parcelasEmAberto > 0 ? "#dc2626" : "#16a34a"}">${parcelasEmAberto}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  ${topClientes.length > 0 ? `
  <!-- Top clientes -->
  <tr><td style="padding:20px 32px 0">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Top clientes (entradas)</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1f5f9;border-radius:8px;overflow:hidden">
      <tr style="background:#f8fafc">
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;font-weight:600">Cliente</th>
        <th style="padding:6px 8px;text-align:right;font-size:11px;color:#64748b;font-weight:600">Recebido</th>
      </tr>
      ${topRows}
    </table>
  </td></tr>` : ""}

  <!-- Ações sugeridas -->
  <tr><td style="padding:20px 32px 0">
    <div style="background:#fffbeb;border-radius:8px;padding:14px 16px;border-left:4px solid #f59e0b">
      <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px">📋 Ações recomendadas</div>
      <ul style="font-size:12px;color:#78350f;margin:0;padding-left:16px;line-height:1.7">
        <li>Emitir e arquivar o Livro Caixa de ${mes} em PDF</li>
        <li>Conferir e fechar os repasses do mês</li>
        <li>Revisar ${parcelasEmAberto} parcela(s) em aberto do mês</li>
        <li>Registrar competência ${mes}/${ano} no controle de alíquotas se necessário</li>
      </ul>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 32px">
    <p style="font-size:11px;color:#94a3b8;margin:0">Olá, ${nomeAdmin}. Este relatório é gerado automaticamente no último dia do mês às 17h.</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
let _ultimoFechamento = null;

export function startFechamentoMensalScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    const agora = new Date();
    if (agora.getUTCHours() !== 20) return; // 20h UTC = 17h BRT
    if (!_isUltimoDiaDoMes(agora)) return;

    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoFechamento === hoje) return;
    if (!await _schedulerShouldRun("fechamento_mensal", hoje)) { _ultimoFechamento = hoje; return; }
    _ultimoFechamento = hoje;
    await _schedulerMarkRun("fechamento_mensal", hoje);

    try {
      const ano = agora.getUTCFullYear();
      const mes = agora.getUTCMonth() + 1;
      console.log(`📅 [FechamentoMensal] Gerando fechamento de ${MESES[mes - 1]} ${ano}...`);

      const dados = await _fetchDadosMes(ano, mes);

      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { email: true, nome: true, whatsapp: true, telefone: true },
      });

      // E-mail com resumo completo
      await Promise.allSettled(admins.map(admin =>
        sendEmail({
          to: admin.email,
          subject: `📅 Addere — Fechamento de ${MESES[mes - 1]} ${ano} · ${dados.resultado >= 0 ? "+" : ""}${fmtBRL(dados.resultado)}`,
          html: _buildEmailFechamento(admin.nome || "Gestor", dados),
        })
      ));

      // WhatsApp resumido
      const waMsg = [
        `📅 *Fechamento de ${MESES[mes - 1]} ${ano} — Addere*`,
        ``,
        `💰 Entradas: ${fmtBRL(dados.totalEntradas)}`,
        `💸 Saídas: ${fmtBRL(dados.totalSaidas)}`,
        `📊 Resultado: ${dados.resultado >= 0 ? "+" : ""}${fmtBRL(dados.resultado)}`,
        ``,
        `🏦 Saldo acumulado: *${fmtBRL(dados.saldoTotal)}*`,
        `✅ Parcelas recebidas: ${dados.parcelasRecebidas}`,
        dados.parcelasEmAberto > 0 ? `⚠️ Inadimplentes: ${dados.parcelasEmAberto}` : ``,
        ``,
        `Acesse o sistema para emitir o Livro Caixa do mês.`,
      ].filter(Boolean).join("\n");

      for (const admin of admins) {
        const phone = _waPhone(admin.whatsapp || admin.telefone);
        if (phone) sendWhatsApp(phone, waMsg).catch(() => {});
      }

      console.log(`📅 [FechamentoMensal] Fechamento de ${MESES[mes - 1]} enviado para ${admins.length} admin(s).`);
    } catch (err) {
      console.error("❌ [FechamentoMensal] Erro:", err.message);
    }
  }, 60 * 60 * 1000);
}
