import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, getUserAdvogadoId } from "../lib/auth.js";

const router = Router();

// ============================================================
// FUNÇÃO AUXILIAR: Converter Decimal/String para Centavos
// ============================================================

function toCentsFromDecimal(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") {
    return Math.round(v * 100);
  }
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// ============================================================
// FUNÇÃO AUXILIAR: Calcular Resumo Financeiro do Contrato
// ============================================================

function calcResumoContratoJSON(contrato) {
  const parcelas = contrato?.parcelas || [];

  const isPago = (st) => st === "RECEBIDA" || st === "REPASSE_EFETUADO";
  const isCancelado = (p) => p.status === "CANCELADA" || !!p.canceladaEm;

  const pagos = parcelas.filter((p) => isPago(p.status));
  const cancelados = parcelas.filter((p) => isCancelado(p));
  const emAberto = parcelas.filter((p) => !isPago(p.status) && !isCancelado(p));

  const sum = (arr, field) =>
    arr.reduce((acc, p) => acc + toCentsFromDecimal(p?.[field]), 0);

  const totalContrato = toCentsFromDecimal(contrato?.valorTotal);

  const totalPagoRecebido = sum(pagos, "valorRecebido");
  const totalPagoPrevisto = sum(pagos, "valorPrevisto");
  const totalPago = totalPagoRecebido || totalPagoPrevisto;

  const totalEmAberto = sum(emAberto, "valorPrevisto");
  const totalCancelado = sum(cancelados, "valorPrevisto");

  const percPago = totalContrato > 0
    ? Math.round((totalPago / totalContrato) * 100)
    : 0;

  const percEmAberto = totalContrato > 0
    ? Math.round((totalEmAberto / totalContrato) * 100)
    : 0;

  return {
    totalContrato,
    totalPago,
    totalEmAberto,
    totalCancelado,
    percPago,
    percEmAberto,
    qtdParcelas: parcelas.length,
    qtdParcelasPagas: pagos.length,
    qtdParcelasEmAberto: emAberto.length,
    qtdParcelasCanceladas: cancelados.length,
  };
}

// ============================================================
// FUNÇÃO AUXILIAR: Carregar Cadeia de Contratos (JSON)
// ============================================================

async function loadContratoChainJSON(tx, contratoId) {
  const visited = new Set();
  const chain = [];

  async function walk(id) {
    const nid = Number(id);
    if (!nid || visited.has(nid)) return;
    visited.add(nid);

    const contrato = await tx.contratoPagamento.findUnique({
      where: { id: nid },
      include: {
        cliente: {
          select: {
            id: true,
            nomeRazaoSocial: true,
            cpfCnpj: true,
          },
        },
        parcelas: {
          orderBy: { numero: "asc" },
          select: {
            id: true,
            numero: true,
            vencimento: true,
            dataRecebimento: true,
            valorPrevisto: true,
            valorRecebido: true,
            status: true,
            meioRecebimento: true,
            canceladaEm: true,
            canceladaPorId: true,
            cancelamentoMotivo: true,
          },
        },
        contratosFilhos: {
          select: {
            id: true,
            numeroContrato: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        contratoOrigem: {
          select: {
            id: true,
            numeroContrato: true,
          },
        },
      },
    });

    if (!contrato) return;

    const resumo = calcResumoContratoJSON(contrato);

    const retificacoes = [];
    const obsStr = String(contrato.observacoes || "");
    const reLines = obsStr.split("\n").filter((l) => l.includes("[RETIFICAÇÃO"));
    for (const line of reLines) {
      const m = line.match(/\[RETIFICAÇÃO\s+(.+?)\]\s*(.*)/);
      if (m) retificacoes.push({ data: m[1].trim(), motivo: m[2].trim() });
    }

    const contratoObj = {
      id: contrato.id,
      numero: contrato.numeroContrato,
      valorTotal: toCentsFromDecimal(contrato.valorTotal),
      dataAssinatura: contrato.dataAssinatura,
      isRenegociacao: !!contrato.contratoOrigemId,
      contratoOrigemId: contrato.contratoOrigemId,
      contratoOrigemNumero: contrato.contratoOrigem?.numeroContrato || null,
      createdAt: contrato.createdAt,
      resumo,
      retificacoes,
      parcelas: contrato.parcelas.map((p) => ({
        id: p.id,
        numero: p.numero,
        dataVencimento: p.vencimento,
        dataRecebimento: p.dataRecebimento,
        valorPrevisto: toCentsFromDecimal(p.valorPrevisto),
        valorRecebido: toCentsFromDecimal(p.valorRecebido),
        status: p.status,
        meioRecebimento: p.meioRecebimento,
        canceladaEm: p.canceladaEm,
        canceladaPorId: p.canceladaPorId,
        cancelamentoMotivo: p.cancelamentoMotivo,
      })),
      quantidadeFilhos: contrato.contratosFilhos?.length || 0,
    };

    chain.push(contratoObj);

    for (const filho of contrato.contratosFilhos || []) {
      await walk(filho.id);
    }
  }

  await walk(contratoId);
  return chain;
}

// ============================================================
// HISTÓRICO — DOSSIÊ DE PAGAMENTOS (DADOS)
// GET /api/historico/dossie-dados?clienteId=123&contratoId=456
// ============================================================

router.get("/api/historico/dossie-dados", authenticate, async (req, res) => {
  try {
    const { clienteId, contratoId } = req.query;
    const cid = Number(clienteId);
    const ctid = Number(contratoId);

    console.log('📋 Dossiê - Requisição:', { clienteId: cid, contratoId: ctid });

    if (!cid || !ctid) {
      return res.status(400).json({
        message: "clienteId e contratoId são obrigatórios",
      });
    }

    const contratoBase = await prisma.contratoPagamento.findFirst({
      where: { id: ctid, clienteId: cid },
      select: {
        id: true,
        numeroContrato: true,
        valorTotal: true,
        createdAt: true,
        contratoOrigemId: true,
        repasseAdvogadoPrincipalId: true,
        repasseIndicacaoAdvogadoId: true,
        cliente: {
          select: {
            id: true,
            nomeRazaoSocial: true,
            cpfCnpj: true,
          },
        },
      },
    });

    if (!contratoBase) {
      console.warn('⚠️ Dossiê - Contrato não encontrado:', { clienteId: cid, contratoId: ctid });
      return res.status(404).json({
        message: "Contrato/pagamento avulso não encontrado para este cliente.",
      });
    }

    // Isolamento por role: USER só acessa dossiê de contratos vinculados ao seu advogado
    const roleStrDossie = String(req.user?.role || "").toUpperCase();
    if (roleStrDossie !== "ADMIN") {
      const myAdvIdDossie = await getUserAdvogadoId(req.user?.id);
      if (myAdvIdDossie) {
        const advIds = new Set([
          contratoBase.repasseAdvogadoPrincipalId,
          contratoBase.repasseIndicacaoAdvogadoId,
        ]);
        if (!advIds.has(myAdvIdDossie)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }
    }

    console.log('✅ Dossiê - Contrato base encontrado:', contratoBase.numeroContrato);

    const cadeia = await loadContratoChainJSON(prisma, ctid);

    if (!cadeia || cadeia.length === 0) {
      return res.status(404).json({
        message: "Nenhum dado encontrado para o dossiê.",
      });
    }

    console.log(`✅ Dossiê - Cadeia carregada: ${cadeia.length} contrato(s)`);

    const userId = req.user?.id;
    let geradoPorNome = "Usuário";
    if (userId) {
      const usuarioDb = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { nome: true, email: true },
      });
      geradoPorNome = usuarioDb?.nome || usuarioDb?.email || "Usuário";
    }
    const geradoEm = new Date().toISOString();

    const tipo = contratoBase.numeroContrato?.toUpperCase().startsWith("AV-")
      ? "Pagamento Avulso"
      : "Contrato";

    const response = {
      cliente: {
        id: contratoBase.cliente.id,
        nome: contratoBase.cliente.nomeRazaoSocial,
        cpfCnpj: contratoBase.cliente.cpfCnpj,
      },
      contratoBase: {
        id: contratoBase.id,
        numero: contratoBase.numeroContrato,
        tipo,
        valorTotal: toCentsFromDecimal(contratoBase.valorTotal),
        createdAt: contratoBase.createdAt,
        isRenegociacao: !!contratoBase.contratoOrigemId,
      },
      cadeia,
      metadata: {
        geradoEm,
        geradoPor: geradoPorNome,
        geradoPorNome,
        totalContratos: cadeia.length,
      },
    };

    console.log('✅ Dossiê - Dados retornados com sucesso');
    res.json(response);

  } catch (e) {
    console.error("❌ Erro ao buscar dados do dossiê:", e);
    res.status(500).json({
      message: "Erro ao buscar dados do dossiê",
      error: e.message,
    });
  }
});

export default router;
