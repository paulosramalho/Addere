import prisma from "./prisma.js";
import { consultarBoleto, INTER_MODE } from "./interBoleto.js";
import { syncParcelaComLivroCaixa } from "./livroCaixaSync.js";

function _norm(s) {
  return String(s || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function normalizarStatusBoletoInter(raw) {
  const s = _norm(raw);
  if (!s) return null;
  if (["PAGO", "RECEBIDO", "LIQUIDADO"].includes(s)) return "PAGO";
  if (["CANCELADO", "CANCELADA"].includes(s)) return "CANCELADO";
  if (["EXPIRADO", "EXPIRADA"].includes(s)) return "EXPIRADO";
  if (["EMITIDO", "ATIVO", "A_RECEBER", "VENCIDO"].includes(s)) return "EMITIDO";
  return null;
}

export function extrairStatusBoletoInter(dados) {
  return [
    dados?.situacao,
    dados?.status,
    dados?.codigoSituacao,
    dados?.cobranca?.situacao,
    dados?.cobranca?.status,
    dados?.cobranca?.codigoSituacao,
    dados?.boleto?.situacao,
    dados?.boleto?.status,
    dados?.recebimento?.situacao,
    dados?.recebimento?.status,
  ].find(Boolean) || null;
}

function _parseDateMaybe(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00Z`);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    return new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function _centavosMaybe(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Math.round(value * 100);
  const s = String(value).trim().replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const n = s.includes(",")
    ? Number(s.replace(/\./g, "").replace(",", "."))
    : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function extrairPagamentoBoletoInter(dados) {
  const dataPagamento = [
    dados?.dataPagamento,
    dados?.dataRecebimento,
    dados?.dataLiquidacao,
    dados?.cobranca?.dataPagamento,
    dados?.cobranca?.dataRecebimento,
    dados?.boleto?.dataPagamento,
    dados?.boleto?.dataRecebimento,
    dados?.recebimento?.dataRecebimento,
    dados?.recebimento?.dataPagamento,
  ].map(_parseDateMaybe).find(Boolean) || null;

  const valorPagoCent = [
    dados?.valorTotalRecebido,
    dados?.valorRecebido,
    dados?.valorPago,
    dados?.cobranca?.valorTotalRecebido,
    dados?.cobranca?.valorRecebido,
    dados?.boleto?.valorTotalRecebido,
    dados?.recebimento?.valorTotalRecebido,
    dados?.recebimento?.valorRecebido,
  ].map(_centavosMaybe).find((v) => v != null) ?? null;

  return { dataPagamento, valorPagoCent };
}

async function _carregarBoleto(boletoOrId, tx = prisma) {
  if (boletoOrId && typeof boletoOrId === "object") return boletoOrId;
  return tx.boletInter.findUnique({ where: { id: Number(boletoOrId) } });
}

export async function aplicarStatusBoleto(boletoOrId, novoStatus, opcoes = {}) {
  const boleto = await _carregarBoleto(boletoOrId);
  if (!boleto) throw new Error("Boleto nao encontrado");

  const status = normalizarStatusBoletoInter(novoStatus) || novoStatus;
  if (!status) {
    return { boleto, sincronizado: false, motivo: "status desconhecido" };
  }

  const dataPagamento = status === "PAGO"
    ? (opcoes.dataPagamento || boleto.dataPagamento || new Date())
    : null;
  const valorPagoCent = status === "PAGO"
    ? (opcoes.valorPagoCent ?? boleto.valorPagoCent ?? boleto.valorCentavos)
    : null;

  const precisaAtualizarPagamento =
    status === "PAGO" && (!boleto.dataPagamento || !boleto.valorPagoCent);
  if (boleto.status === status && !precisaAtualizarPagamento) {
    return { boleto, sincronizado: false, statusAnterior: boleto.status, statusNovo: status };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const boletoAtualizado = await tx.boletInter.update({
      where: { id: boleto.id },
      data: {
        status,
        ...(status === "PAGO" && {
          dataPagamento,
          valorPagoCent,
        }),
        updatedAt: new Date(),
      },
    });

    if (status === "PAGO" && boleto.parcelaId) {
      const parcela = await tx.parcelaContrato.findUnique({
        where: { id: boleto.parcelaId },
      });

      if (parcela && !["RECEBIDA", "REPASSE_EFETUADO"].includes(parcela.status)) {
        const valorRecebido = Number((Number(valorPagoCent || boleto.valorCentavos) / 100).toFixed(2));
        const parcelaAtualizada = await tx.parcelaContrato.update({
          where: { id: parcela.id },
          data: {
            status: "RECEBIDA",
            dataRecebimento: dataPagamento,
            meioRecebimento: opcoes.meioRecebimento || "BOLETO_INTER",
            valorRecebido,
            cancelamentoMotivo: null,
            canceladaEm: null,
            canceladaPorId: null,
          },
        });

        await syncParcelaComLivroCaixa(tx, parcelaAtualizada, "PAGAR");
      }
    }

    return boletoAtualizado;
  });

  return {
    boleto: updated,
    sincronizado: true,
    statusAnterior: boleto.status,
    statusNovo: status,
  };
}

export async function sincronizarBoletoComInter(boletoOrId) {
  const boleto = await _carregarBoleto(boletoOrId);
  if (!boleto) throw new Error("Boleto nao encontrado");

  if (!boleto.codigoSolicitacao || boleto.modo === "mock" || INTER_MODE === "mock") {
    return { boleto, sincronizado: false, motivo: "mock ou sem codigoSolicitacao" };
  }

  const dados = await consultarBoleto(boleto.codigoSolicitacao);
  const statusInter = extrairStatusBoletoInter(dados);
  const novoStatus = normalizarStatusBoletoInter(statusInter);
  if (!novoStatus) {
    return { boleto, sincronizado: false, statusInter, motivo: "status Inter desconhecido" };
  }

  const pagamento = extrairPagamentoBoletoInter(dados);
  const result = await aplicarStatusBoleto(boleto, novoStatus, pagamento);
  return { ...result, statusInter };
}

function _first(...values) {
  return values.find((v) => v != null && v !== "") ?? null;
}

function _eventFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const statusInter = _first(
    obj.codigoSituacao,
    obj.situacao,
    obj.status,
    obj.cobranca?.codigoSituacao,
    obj.cobranca?.situacao,
    obj.cobranca?.status,
    obj.boleto?.codigoSituacao,
    obj.boleto?.situacao,
    obj.boleto?.status,
  );

  const nossoNumero = _first(
    obj.nossoNumero,
    obj.boleto?.nossoNumero,
    obj.cobranca?.nossoNumero,
  );

  const codigoSolicitacao = _first(
    obj.codigoSolicitacao,
    obj.cobranca?.codigoSolicitacao,
    obj.boleto?.codigoSolicitacao,
  );

  if (!statusInter || (!nossoNumero && !codigoSolicitacao)) return null;

  return {
    nossoNumero,
    codigoSolicitacao,
    statusInter,
    novoStatus: normalizarStatusBoletoInter(statusInter),
    ...extrairPagamentoBoletoInter(obj),
  };
}

export function extrairEventosWebhookBoleto(payload) {
  const eventos = [];
  const visitados = new Set();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (visitados.has(value)) return;
    visitados.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const evento = _eventFromObject(value);
    if (evento) eventos.push(evento);

    for (const key of ["cobranca", "boleto", "recebimento", "data", "payload", "body"]) {
      if (value[key]) visit(value[key]);
    }
    for (const key of ["cobrancas", "items", "content", "eventos", "notifications"]) {
      if (Array.isArray(value[key])) visit(value[key]);
    }
  }

  visit(payload);
  return eventos;
}
