import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";

const router = Router();

// ============================================================
// DASHBOARD FINANCEIRO - Visão Geral Completa
// GET /api/dashboard/financeiro?ano=YYYY&mes=MM
// ============================================================
router.get("/api/dashboard/financeiro", authenticate, async (req, res) => {
  try {
    const hoje = new Date();
    const ano = Number(req.query.ano) || hoje.getFullYear();
    const mesParam = req.query.mes;
    const mes = mesParam === "0" || mesParam === "" ? 0 : (Number(mesParam) || (hoje.getMonth() + 1));
    const anoCompleto = mes === 0;

    console.log(`📊 Dashboard Financeiro: ${anoCompleto ? "Ano completo" : mes}/${ano}`);

    // Datas do período em UTC (evita desvio de fuso horário no servidor)
    const dtIniAno = new Date(Date.UTC(ano, 0, 1));
    const dtFimAno = new Date(Date.UTC(ano, 11, 31, 23, 59, 59, 999));
    const dtIniMes = anoCompleto ? dtIniAno : new Date(Date.UTC(ano, mes - 1, 1));
    const dtFimMes = anoCompleto ? dtFimAno : new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));
    const competenciaFimMes = anoCompleto ? 12 : mes;
    const fimPeriodoExclusivo = new Date(Date.UTC(ano, competenciaFimMes, 1));
    const competenciaAtePeriodoWhere = {
      OR: [
        { competenciaAno: { lt: ano } },
        { competenciaAno: ano, competenciaMes: { lte: competenciaFimMes } },
      ],
    };
    const competenciaPeriodoWhere = anoCompleto
      ? { competenciaAno: ano }
      : { competenciaAno: ano, competenciaMes: mes };

    // 1) SALDO DO PERÍODO (saldos iniciais de contas abertas até fim do período + lançamentos efetivados até fim do período)
    const todasContasAtivas = await prisma.livroCaixaConta.findMany({
      where: { ativa: true },
      select: { id: true, nome: true, tipo: true, saldoInicialCent: true, dataInicial: true },
      orderBy: { ordem: "asc" },
    });
    const contasAtivasIds = new Set(todasContasAtivas.map((conta) => conta.id));
    const contaAtivaWhere = { contaId: { in: todasContasAtivas.map((conta) => conta.id) } };
    const saldoInicialTotal = todasContasAtivas
      .filter(c => c.saldoInicialCent && c.dataInicial && new Date(c.dataInicial) < fimPeriodoExclusivo)
      .reduce((acc, c) => acc + (c.saldoInicialCent || 0), 0);

    const lancamentosAtePeriodo = await prisma.livroCaixaLancamento.findMany({
      where: {
        statusFluxo: "EFETIVADO",
        es: { in: ["E", "S"] },
        ...competenciaAtePeriodoWhere,
      },
      select: { es: true, valorCentavos: true, contaId: true, status: true },
    });

    const movimentosPorConta = new Map();
    const semConta = { count: 0, entradasCentavos: 0, saidasCentavos: 0 };
    const foraContasAtivas = { count: 0, entradasCentavos: 0, saidasCentavos: 0 };
    const statusDiferenteOk = { count: 0, entradasCentavos: 0, saidasCentavos: 0, porStatus: {} };
    let entradasSaldoCentavos = 0;
    let saidasSaldoCentavos = 0;
    let lancamentosConsideradosCount = 0;

    for (const l of lancamentosAtePeriodo) {
      const v = Number(l.valorCentavos || 0);

      if (l.status !== "OK") {
        statusDiferenteOk.count += 1;
        const porStatus = statusDiferenteOk.porStatus[l.status] || { count: 0, entradasCentavos: 0, saidasCentavos: 0 };
        porStatus.count += 1;
        if (l.es === "E") {
          statusDiferenteOk.entradasCentavos += v;
          porStatus.entradasCentavos += v;
        } else if (l.es === "S") {
          statusDiferenteOk.saidasCentavos += v;
          porStatus.saidasCentavos += v;
        }
        statusDiferenteOk.porStatus[l.status] = porStatus;
        continue;
      }

      if (!l.contaId) {
        semConta.count += 1;
        if (l.es === "E") semConta.entradasCentavos += v;
        else if (l.es === "S") semConta.saidasCentavos += v;
        continue;
      }

      if (!contasAtivasIds.has(l.contaId)) {
        foraContasAtivas.count += 1;
        if (l.es === "E") foraContasAtivas.entradasCentavos += v;
        else if (l.es === "S") foraContasAtivas.saidasCentavos += v;
        continue;
      }

      const resumoConta = movimentosPorConta.get(l.contaId) || { count: 0, entradasCentavos: 0, saidasCentavos: 0 };
      if (l.es === "E") {
        entradasSaldoCentavos += v;
        resumoConta.entradasCentavos += v;
      } else if (l.es === "S") {
        saidasSaldoCentavos += v;
        resumoConta.saidasCentavos += v;
      }

      resumoConta.count += 1;
      movimentosPorConta.set(l.contaId, resumoConta);
      lancamentosConsideradosCount += 1;
    }

    const saldoAtualCentavos = saldoInicialTotal + entradasSaldoCentavos - saidasSaldoCentavos;

    // 2) TOTAIS DO MÊS (entradas e saídas — exclui transferências entre contas)
    const lancamentosMes = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...competenciaPeriodoWhere,
        ...contaAtivaWhere,
        status: "OK",
        statusFluxo: "EFETIVADO",
        es: { in: ["E", "S"] },
      },
      select: { es: true, valorCentavos: true, historico: true, clienteFornecedor: true, origem: true },
    });
    const entradasMesCentavos = lancamentosMes.filter(l => l.es === "E").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);
    const saidasMesCentavos = lancamentosMes.filter(l => l.es === "S").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);
    const resultadoMesCentavos = entradasMesCentavos - saidasMesCentavos;

    // 3) TOTAIS DO ANO (entradas e saídas — exclui transferências entre contas)
    const lancamentosAno = await prisma.livroCaixaLancamento.findMany({
      where: {
        competenciaAno: ano,
        ...contaAtivaWhere,
        status: "OK",
        statusFluxo: "EFETIVADO",
        es: { in: ["E", "S"] },
      },
      select: { es: true, valorCentavos: true },
    });
    const entradasAnoCentavos = lancamentosAno.filter(l => l.es === "E").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);
    const saidasAnoCentavos = lancamentosAno.filter(l => l.es === "S").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);
    const resultadoAnoCentavos = entradasAnoCentavos - saidasAnoCentavos;

    // 4) TOP 5 ENTRADAS DO MÊS (por cliente/fornecedor)
    const entradasMesDetalhado = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...competenciaPeriodoWhere,
        ...contaAtivaWhere,
        status: "OK",
        statusFluxo: "EFETIVADO",
        es: "E",
      },
      orderBy: { valorCentavos: "desc" },
      take: 5,
      select: {
        id: true,
        data: true,
        valorCentavos: true,
        historico: true,
        clienteFornecedor: true,
        origem: true,
        documento: true,
      },
    });

    // 5) TOP 5 SAÍDAS DO MÊS
    const saidasMesDetalhado = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...competenciaPeriodoWhere,
        ...contaAtivaWhere,
        status: "OK",
        statusFluxo: "EFETIVADO",
        es: "S",
      },
      orderBy: { valorCentavos: "desc" },
      take: 5,
      select: {
        id: true,
        data: true,
        valorCentavos: true,
        historico: true,
        clienteFornecedor: true,
        origem: true,
      },
    });

    // 6) PENDÊNCIAS (lançamentos com status PENDENTE_CONTA)
    const pendencias = await prisma.livroCaixaLancamento.count({
      where: { status: "PENDENTE_CONTA" },
    });

    // 7) PREVISTOS (lançamentos futuros)
    const previstos = await prisma.livroCaixaLancamento.findMany({
      where: { statusFluxo: "PREVISTO" },
      select: { es: true, valorCentavos: true },
    });
    const previstosEntradasCentavos = previstos.filter(l => l.es === "E").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);
    const previstosSaidasCentavos = previstos.filter(l => l.es === "S").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);

    // 8) CONTRATOS ATIVOS (campo correto: ativo)
    const contratosAtivos = await prisma.contratoPagamento.count({
      where: { ativo: true },
    });

    // 9) PARCELAS PENDENTES (model correto: parcelaContrato; campo correto: vencimento)
    const parcelasPendentes = await prisma.parcelaContrato.count({
      where: {
        status: { in: ["PENDENTE", "ATRASADA"] },
        vencimento: { gte: hoje },
      },
    });

    // 11) PARCELAS EM ATRASO
    const parcelasAtrasadas = await prisma.parcelaContrato.count({
      where: { status: "ATRASADA" },
    });

    const parcelasAtrasadasValor = await prisma.parcelaContrato.aggregate({
      where: { status: "ATRASADA" },
      _sum: { valorPrevisto: true },
    });

    // 12) HISTÓRICO MENSAL (últimos 6 meses ou 12 meses do ano se anoCompleto)
    const historicoMensal = [];
    const mesesHistorico = anoCompleto ? 12 : 6;
    const mesBase = anoCompleto ? 12 : mes;
    for (let i = mesesHistorico - 1; i >= 0; i--) {
      const m = anoCompleto
        ? new Date(ano, i, 1)
        : new Date(ano, mesBase - 1 - i, 1);
      const mFim = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59, 999);

      const lancsDoMes = await prisma.livroCaixaLancamento.findMany({
        where: {
          competenciaAno: m.getFullYear(),
          competenciaMes: m.getMonth() + 1,
          ...contaAtivaWhere,
          status: "OK",
          statusFluxo: "EFETIVADO",
          es: { in: ["E", "S"] },
        },
        select: { es: true, valorCentavos: true },
      });

      const entradas = lancsDoMes.filter(l => l.es === "E").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);
      const saidas = lancsDoMes.filter(l => l.es === "S").reduce((acc, l) => acc + Number(l.valorCentavos || 0), 0);

      historicoMensal.push({
        label: `${String(m.getMonth() + 1).padStart(2, "0")}/${m.getFullYear()}`,
        mes: m.getMonth() + 1,
        ano: m.getFullYear(),
        entradasCentavos: entradas,
        saidasCentavos: saidas,
        resultadoCentavos: entradas - saidas,
      });
    }

    // 13) TOTAIS POR ORIGEM (do mês)
    const totaisPorOrigem = {};
    lancamentosMes.forEach(l => {
      const key = l.origem || "OUTROS";
      if (!totaisPorOrigem[key]) {
        totaisPorOrigem[key] = { entradas: 0, saidas: 0, count: 0 };
      }
      if (l.es === "E") {
        totaisPorOrigem[key].entradas += Number(l.valorCentavos || 0);
      } else if (l.es === "S") {
        totaisPorOrigem[key].saidas += Number(l.valorCentavos || 0);
      }
      totaisPorOrigem[key].count++;
    });

    // 14-A) INADIMPLÊNCIA — parcelas vencidas (PREVISTA/PENDENTE + vencimento < hoje)
    const inicioDiaHoje = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 3, 0, 0));
    const parcelasVencidasRaw = await prisma.parcelaContrato.findMany({
      where: { status: { in: ["PREVISTA", "PENDENTE"] }, vencimento: { lt: inicioDiaHoje } },
      select: { valorPrevisto: true, contrato: { select: { clienteId: true } } },
    });
    const valorInadimpCentavos = parcelasVencidasRaw.reduce((s, p) => s + Math.round(Number(p.valorPrevisto) * 100), 0);
    const clientesInadimplentesCount = new Set(parcelasVencidasRaw.map(p => p.contrato.clienteId)).size;
    const totalPrevistoAgg = await prisma.parcelaContrato.aggregate({
      where: { status: { in: ["PREVISTA", "PENDENTE"] } },
      _sum: { valorPrevisto: true },
    });
    const totalPrevistoCentavos = Math.round(Number(totalPrevistoAgg._sum?.valorPrevisto || 0) * 100);
    const taxaInadimplencia = totalPrevistoCentavos > 0
      ? Math.round((valorInadimpCentavos / totalPrevistoCentavos) * 10000) / 100
      : 0;

    // 14-B) PRÓXIMAS A VENCER (próximos 30 dias)
    const trinta = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + 30, 3, 0, 0));
    const proximasVencerRaw = await prisma.parcelaContrato.findMany({
      where: { status: { in: ["PREVISTA", "PENDENTE"] }, vencimento: { gte: inicioDiaHoje, lt: trinta } },
      include: { contrato: { select: { numeroContrato: true, cliente: { select: { nomeRazaoSocial: true } } } } },
      orderBy: { vencimento: "asc" },
      take: 10,
    });

    // 14) SALDO POR CONTA (até fim do período selecionado)
    const saldoPorConta = todasContasAtivas.map((conta) => {
      const saldoInicial = (conta.saldoInicialCent && conta.dataInicial && new Date(conta.dataInicial) < fimPeriodoExclusivo)
        ? (conta.saldoInicialCent || 0)
        : 0;
      const movimentos = movimentosPorConta.get(conta.id) || { count: 0, entradasCentavos: 0, saidasCentavos: 0 };
      const saldo = saldoInicial + movimentos.entradasCentavos - movimentos.saidasCentavos;
      return {
        id: conta.id,
        nome: conta.nome,
        tipo: conta.tipo,
        dataInicial: conta.dataInicial,
        saldoInicialCentavos: saldoInicial,
        entradasCentavos: movimentos.entradasCentavos,
        saidasCentavos: movimentos.saidasCentavos,
        lancamentosCount: movimentos.count,
        saldoCentavos: saldo,
      };
    });
    const saldoContasAtivasCentavos = saldoPorConta.reduce((acc, conta) => acc + conta.saldoCentavos, 0);

    const saldoAtualComposicao = {
      dataFinal: dtFimMes.toISOString(),
      regra: "Somente status OK, fluxo EFETIVADO e contas ativas do Livro Caixa.",
      saldoInicialCentavos: saldoInicialTotal,
      entradasCentavos: entradasSaldoCentavos,
      saidasCentavos: saidasSaldoCentavos,
      totalCentavos: saldoAtualCentavos,
      lancamentosCount: lancamentosConsideradosCount,
      lancamentosAuditadosCount: lancamentosAtePeriodo.length,
      saldoContasAtivasCentavos,
      diferencaSaldoContasCentavos: saldoAtualCentavos - saldoContasAtivasCentavos,
      semConta: {
        ...semConta,
        liquidoCentavos: semConta.entradasCentavos - semConta.saidasCentavos,
      },
      foraContasAtivas: {
        ...foraContasAtivas,
        liquidoCentavos: foraContasAtivas.entradasCentavos - foraContasAtivas.saidasCentavos,
      },
      statusDiferenteOk: {
        ...statusDiferenteOk,
        liquidoCentavos: statusDiferenteOk.entradasCentavos - statusDiferenteOk.saidasCentavos,
        porStatus: Object.entries(statusDiferenteOk.porStatus).map(([status, v]) => ({
          status,
          ...v,
          liquidoCentavos: v.entradasCentavos - v.saidasCentavos,
        })),
      },
    };

    res.json({
      periodo: {
        ano,
        mes,
        anoCompleto,
        label: anoCompleto ? `Ano ${ano}` : `${String(mes).padStart(2, "0")}/${ano}`,
      },

      // Saldos
      saldoAtualCentavos,
      saldoAtualComposicao,
      saldoPorConta,

      // Período selecionado (mês ou ano)
      mesSumario: {
        entradasCentavos: entradasMesCentavos,
        saidasCentavos: saidasMesCentavos,
        resultadoCentavos: resultadoMesCentavos,
        quantidadeLancamentos: lancamentosMes.length,
      },

      // Ano
      anoSumario: {
        entradasCentavos: entradasAnoCentavos,
        saidasCentavos: saidasAnoCentavos,
        resultadoCentavos: resultadoAnoCentavos,
      },

      // Top lançamentos
      topEntradas: entradasMesDetalhado.map(l => ({
        id: l.id,
        data: l.data,
        valorCentavos: l.valorCentavos,
        descricao: l.historico || l.clienteFornecedor || "—",
        origem: l.origem,
        documento: l.documento,
      })),
      topSaidas: saidasMesDetalhado.map(l => ({
        id: l.id,
        data: l.data,
        valorCentavos: l.valorCentavos,
        descricao: l.historico || l.clienteFornecedor || "—",
        origem: l.origem,
      })),

      // Status
      pendencias,
      previstos: {
        entradasCentavos: previstosEntradasCentavos,
        saidasCentavos: previstosSaidasCentavos,
        count: previstos.length,
      },

      // Contratos e parcelas
      contratosAtivos,
      parcelas: {
        pendentes: parcelasPendentes,
        atrasadas: parcelasAtrasadas,
        valorAtrasadoCentavos: Math.round(Number(parcelasAtrasadasValor._sum?.valorPrevisto || 0) * 100),
      },

      // Inadimplência
      inadimplencia: {
        clientesCount: clientesInadimplentesCount,
        parcelasCount: parcelasVencidasRaw.length,
        valorCentavos: valorInadimpCentavos,
        taxaPercent: taxaInadimplencia,
      },

      // Próximas a vencer (30 dias)
      proximasVencer: proximasVencerRaw.map(p => ({
        id: p.id,
        numero: p.numero,
        vencimento: p.vencimento,
        valorPrevistoCentavos: Math.round(Number(p.valorPrevisto) * 100),
        numeroContrato: p.contrato.numeroContrato,
        clienteNome: p.contrato.cliente.nomeRazaoSocial,
      })),

      // Histórico
      historicoMensal,
      totaisPorOrigem: Object.entries(totaisPorOrigem).map(([origem, v]) => ({
        origem,
        entradasCentavos: v.entradas,
        saidasCentavos: v.saidas,
        count: v.count,
      })),
    });

  } catch (error) {
    console.error("❌ Erro no Dashboard Financeiro:", error);
    res.status(500).json({ message: error.message || "Erro ao gerar dashboard financeiro" });
  }
});

export default router;
