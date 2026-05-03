// backend/src/schedulers/boletosAgendados.js
// Emissão automática de boletos — 1 dia antes do alerta D-7 ao cliente
// Rodada diária às 7h UTC (4h BRT), antes do alerta de vencimentos das 8h BRT

import prisma                          from "../lib/prisma.js";
import { emitirBoleto }                from "../lib/interBoleto.js";
import { processarPosBoleto }          from "../lib/boletoNotificacoes.js";
import { sendEmail }                   from "../lib/email.js";
import { sendWhatsApp }                from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";

// Admin a notificar (apenas Paulo)
const NOTIFY_EMAIL = process.env.BOLETO_NOTIFY_EMAIL || "financeiro@amandaramalho.adv.br";
const NOTIFY_PHONE = process.env.BOLETO_NOTIFY_PHONE || "5591981348026";

// ── Helpers ───────────────────────────────────────────────────────────────────

function _waPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 11 || d.length === 10) return "55" + d;
  return d.length >= 8 ? "55" + d : null;
}

function _fmtBRL(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function _fmtDate(d) {
  const s = d instanceof Date ? d.toISOString() : String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/**
 * Gera N° do Documento (idêntico ao helper em routes/boletos.js).
 * Parcela: {ini}{nn}/{tt}Addere  ex: PSR01/03Addere
 */
function _gerarDocNum(nomeCliente, parcela, totalParcelas, dataVencimento) {
  const words = String(nomeCliente || "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  let ini = words.map((w) => w[0]).join("").slice(0, 3);
  if (ini.length < 3 && words[0]) ini = (ini + words[0]).slice(0, 3);
  ini = ini.padEnd(3, "X");

  if (parcela && totalParcelas != null) {
    const nn = String(parcela.numero).padStart(2, "0").slice(-2);
    const tt = String(totalParcelas).padStart(2, "0").slice(-2);
    return `${ini}${nn}/${tt}ADD`;
  }

  const venc = dataVencimento instanceof Date ? dataVencimento : new Date(dataVencimento);
  const mm   = String(venc.getUTCMonth() + 1).padStart(2, "0");
  const yy   = String(venc.getUTCFullYear()).slice(-2);
  return `${ini}${mm}/${yy}ADD`;
}

// ── E-mail de notificação ao admin ───────────────────────────────────────────

function _buildEmailResumo(resultados) {
  const { emitidos, jaExistentes, erros, detalhes, dataVenc } = resultados;
  const total = emitidos + jaExistentes + erros.length;

  const linhasEmitidos = detalhes
    .filter((d) => d.acao === "emitido")
    .map((d) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px">${d.clienteNome}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">#${d.parcelaNumero}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${_fmtDate(d.vencimento)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600">${_fmtBRL(d.valorCentavos)}</td>
      </tr>`).join("");

  const linhasExistentes = detalhes
    .filter((d) => d.acao === "ja_existia")
    .map((d) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px">${d.clienteNome}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">#${d.parcelaNumero}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${_fmtDate(d.vencimento)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600">${_fmtBRL(d.valorCentavos)}</td>
      </tr>`).join("");

  const linhasErros = detalhes
    .filter((d) => d.acao === "erro")
    .map((d) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #fca5a5;font-size:13px">${d.clienteNome}</td>
        <td style="padding:8px;border-bottom:1px solid #fca5a5;font-size:13px;text-align:center">#${d.parcelaNumero}</td>
        <td colspan="2" style="padding:8px;border-bottom:1px solid #fca5a5;font-size:13px;color:#dc2626">${d.erro}</td>
      </tr>`).join("");

  const tblHeader = `
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px;font-size:11px;font-weight:700;color:#64748b;text-align:left;border-bottom:2px solid #e5e7eb">Cliente</th>
        <th style="padding:8px;font-size:11px;font-weight:700;color:#64748b;text-align:center;border-bottom:2px solid #e5e7eb">Parcela</th>
        <th style="padding:8px;font-size:11px;font-weight:700;color:#64748b;text-align:center;border-bottom:2px solid #e5e7eb">Vencimento</th>
        <th style="padding:8px;font-size:11px;font-weight:700;color:#64748b;text-align:right;border-bottom:2px solid #e5e7eb">Valor</th>
      </tr></thead><tbody>`;

  const secEmitidos = emitidos > 0 ? `
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:6px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:700;color:#15803d;margin-bottom:10px">✅ Boletos emitidos e enviados ao cliente (${emitidos})</div>
      ${tblHeader}${linhasEmitidos}</tbody></table>
    </div>` : "";

  const secExistentes = jaExistentes > 0 ? `
    <div style="background:#fefce8;border-left:4px solid #eab308;border-radius:6px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:700;color:#854d0e;margin-bottom:10px">⚠️ Boleto já existia — Drive/envio omitidos (${jaExistentes})</div>
      ${tblHeader}${linhasExistentes}</tbody></table>
    </div>` : "";

  const secErros = erros.length > 0 ? `
    <div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:6px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:700;color:#b91c1c;margin-bottom:10px">❌ Erros na emissão (${erros.length})</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#fee2e2">
          <th style="padding:8px;font-size:11px;font-weight:700;color:#64748b;text-align:left;border-bottom:2px solid #fca5a5">Cliente</th>
          <th style="padding:8px;font-size:11px;font-weight:700;color:#64748b;text-align:center;border-bottom:2px solid #fca5a5">Parcela</th>
          <th colspan="2" style="padding:8px;font-size:11px;font-weight:700;color:#64748b;text-align:left;border-bottom:2px solid #fca5a5">Erro</th>
        </tr></thead><tbody>${linhasErros}</tbody>
      </table>
    </div>` : "";

  const nada = total === 0 ? `<p style="color:#64748b;font-size:13px">Nenhuma parcela com vencimento em ${_fmtDate(dataVenc)} encontrada.</p>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
  <div style="max-width:640px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="background:#1e3a5f;padding:24px 28px">
      <div style="color:#fff;font-size:22px;font-weight:700">Addere</div>
      <div style="color:#93c5fd;font-size:14px;margin-top:4px">Boletos Agendados — ${new Date().toLocaleDateString("pt-BR")}</div>
    </div>
    <div style="padding:24px 28px">
      <p style="color:#334155;margin:0 0 4px 0;font-size:15px">Emissão automática de boletos concluída.</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 20px 0">
        Parcelas com vencimento em <strong>${_fmtDate(dataVenc)}</strong> (em 8 dias) —
        ${emitidos} emitido(s), ${jaExistentes} já existia(m), ${erros.length} erro(s).
      </p>
      ${secEmitidos}${secExistentes}${secErros}${nada}
    </div>
    <div style="padding:16px 28px;background:#f1f5f9;text-align:center;font-size:11px;color:#94a3b8">
      Addere On — notificação automática (boletos agendados)
    </div>
  </div>
</body></html>`;
}

// ── Lógica principal ─────────────────────────────────────────────────────────

export async function runBoletosAgendadosAgora() {
  const agora = new Date();

  // Parcelas com vencimento exatamente em 8 dias (D-8 a partir de hoje)
  const d8     = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 8));
  const d8Fim  = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 8, 23, 59, 59, 999));

  const parcelas = await prisma.parcelaContrato.findMany({
    where: {
      status: "PREVISTA",
      vencimento: { gte: d8, lte: d8Fim },
    },
    include: {
      contrato: { include: { cliente: true } },
      boletos: {
        where:   { status: { not: "CANCELADO" } },
        select:  { id: true, status: true, pdfUrl: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const resultados = {
    dataVenc:     d8,
    total:        parcelas.length,
    emitidos:     0,
    jaExistentes: 0,
    erros:        [],
    detalhes:     [],
  };

  for (const parcela of parcelas) {
    const cliente      = parcela.contrato.cliente;
    const boletoAtivo  = parcela.boletos?.[0];
    const valorCentavos = Math.round(Number(parcela.valorPrevisto) * 100);

    if (boletoAtivo) {
      // Boleto já foi emitido manualmente — não regrava Drive nem reenvia ao cliente
      resultados.jaExistentes++;
      resultados.detalhes.push({
        acao:          "ja_existia",
        parcelaId:     parcela.id,
        parcelaNumero: parcela.numero,
        clienteNome:   cliente.nomeRazaoSocial,
        vencimento:    parcela.vencimento,
        valorCentavos,
      });
      continue;
    }

    try {
      const totalParcelas = await prisma.parcelaContrato.count({
        where: { contratoId: parcela.contratoId },
      });

      const vencFinal = parcela.vencimento.toISOString().slice(0, 10);
      const seuNumero = `ADD-P${parcela.id}`;
      const docNum    = _gerarDocNum(cliente.nomeRazaoSocial, parcela, totalParcelas, vencFinal);

      const result = await emitirBoleto({
        seuNumero,
        valorCentavos,
        dataVencimento: vencFinal,
        multaPerc:      2,
        moraPercMes:    1,
        pagador: {
          cpfCnpj:  cliente.cpfCnpj,
          nome:     cliente.nomeRazaoSocial,
          email:    cliente.email    || "",
          telefone: cliente.telefone || "",
        },
      });

      const boleto = await prisma.boletInter.create({
        data: {
          nossoNumero:    result.nossoNumero,
          seuNumero:      result.seuNumero,
          valorCentavos,
          dataVencimento: new Date(vencFinal),
          status:         "EMITIDO",
          codigoBarras:   result.codigoBarras   ?? null,
          linhaDigitavel: result.linhaDigitavel  ?? null,
          pixCopiaECola:  result.pixCopiaECola   ?? null,
          qrCodeImagem:   result.qrCodeImagem    ?? null,
          parcelaId:      parcela.id,
          clienteId:      cliente.id,
          pagadorNome:    cliente.nomeRazaoSocial,
          pagadorCpfCnpj: cliente.cpfCnpj,
          pagadorEmail:   cliente.email          ?? null,
          historico:      "Honorários advocatícios",
          multaPerc:      2,
          moraPercMes:    1,
          validadeDias:   30,
          docNum,
          modo:           result.modo,
        },
      });

      // PDF → Drive → e-mail + WA ao cliente (assíncrono)
      processarPosBoleto(boleto.id).catch((e) => {
        console.error(`❌ [BoletosAgend] processarPosBoleto #${boleto.id}:`, e.message);
      });

      resultados.emitidos++;
      resultados.detalhes.push({
        acao:          "emitido",
        parcelaId:     parcela.id,
        parcelaNumero: parcela.numero,
        clienteNome:   cliente.nomeRazaoSocial,
        vencimento:    parcela.vencimento,
        valorCentavos,
        boletoId:      boleto.id,
      });
    } catch (e) {
      console.error(`❌ [BoletosAgend] parcela #${parcela.id}:`, e.message);
      resultados.erros.push({ parcelaId: parcela.id, erro: e.message });
      resultados.detalhes.push({
        acao:          "erro",
        parcelaId:     parcela.id,
        parcelaNumero: parcela.numero,
        clienteNome:   cliente.nomeRazaoSocial,
        vencimento:    parcela.vencimento,
        valorCentavos,
        erro:          e.message,
      });
    }
  }

  // Notificar Paulo somente se houve atividade
  if (resultados.total > 0) {
    await _notificarAdminPaulo(resultados);
  }

  console.log(
    `🏦 [BoletosAgend] ${resultados.emitidos} emitido(s), ` +
    `${resultados.jaExistentes} já existia(m), ${resultados.erros.length} erro(s). ` +
    `Venc: ${_fmtDate(d8)}`
  );

  return resultados;
}

async function _notificarAdminPaulo(resultados) {
  const { emitidos, jaExistentes, erros } = resultados;

  try {
    await sendEmail({
      to:      NOTIFY_EMAIL,
      subject: `🏦 Boletos agendados: ${emitidos} emitido(s), ${jaExistentes} já existia(m)${erros.length > 0 ? `, ${erros.length} erro(s)` : ""}`,
      html:    _buildEmailResumo(resultados),
    });
  } catch (e) {
    console.error("❌ [BoletosAgend] e-mail admin:", e.message);
  }

  const phone = _waPhone(NOTIFY_PHONE);
  if (phone) {
    const msg = [
      `🏦 *Boletos Agendados — ${new Date().toLocaleDateString("pt-BR")}*`,
      ``,
      `✅ Emitidos: *${emitidos}*`,
      `⚠️ Já existiam: *${jaExistentes}*`,
      erros.length > 0 ? `❌ Erros: *${erros.length}*` : null,
    ].filter(Boolean).join("\n");
    sendWhatsApp(phone, msg).catch(() => {});
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _ultimoRun = null;

export function startBoletosAgendadosScheduler() {
  if (process.env.NODE_ENV === "test") return;

  setInterval(async () => {
    const agora = new Date();
    if (agora.getUTCHours() !== 7) return; // 7h UTC = 4h BRT (antes do alerta D-7 das 8h)
    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoRun === hoje) return;
    if (!await _schedulerShouldRun("boletos_agendados", hoje)) { _ultimoRun = hoje; return; }
    _ultimoRun = hoje;
    await _schedulerMarkRun("boletos_agendados", hoje);

    await runBoletosAgendadosAgora();
  }, 60 * 60 * 1000);
}
