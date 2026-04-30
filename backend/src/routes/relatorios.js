import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin, getUserAdvogadoId } from "../lib/auth.js";
import { sendEmail } from "../lib/email.js";

const router = Router();

router.get("/api/relatorios/fluxo-caixa/consolidado", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");
    const incluirPrevistos = String(req.query.incluirPrevistos || "0") === "1";

    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);

    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    // contaId pode vir como string ou array
    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];

    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("Todas") || contaIds.includes("todas");
    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    const statusFluxoWhere = incluirPrevistos
      ? { statusFluxo: { in: ["EFETIVADO", "PREVISTO"] } }
      : { statusFluxo: "EFETIVADO" };

    // 1) saldo inicial = tudo antes de dtIni
    const anteriores = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...contaWhere,
        ...statusFluxoWhere,
        data: { lt: dtIni },
      },
      select: { es: true, valorCentavos: true },
    });

    const saldoInicialCentavos = anteriores.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // 2) totais no período
    const noPeriodo = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...contaWhere,
        ...statusFluxoWhere,
        data: { gte: dtIni, lte: dtFim },
      },
      select: { es: true, valorCentavos: true },
    });

    const entradasCentavos = noPeriodo.reduce((acc, l) => (l.es === "E" ? acc + Number(l.valorCentavos || 0) : acc), 0);
    const saidasCentavos = noPeriodo.reduce((acc, l) => (l.es === "S" ? acc + Number(l.valorCentavos || 0) : acc), 0);

    const saldoFinalCentavos = saldoInicialCentavos + entradasCentavos - saidasCentavos;

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      contas: isAll ? "ALL" : contaIds,
      incluirPrevistos,
      saldoInicialCentavos,
      entradasCentavos,
      saidasCentavos,
      saldoFinalCentavos,
      observacao: incluirPrevistos ? "Inclui previstos (efetivo + previsto)." : "Não inclui previstos (somente efetivo).",
    });
  } catch (e) {
    console.error("❌ Erro no relatório Fluxo de Caixa Consolidado:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

// ============================================================
// RELATÓRIO — FLUXO DE CAIXA DIÁRIO (DETALHADO)
// Front chama: GET /relatorios/fluxo-caixa/diario?dtIni=YYYY-MM-DD&dtFim=YYYY-MM-DD&contaId=ALL|<id>&contaId=<id>...&incluirPrevistos=0|1
// Retorna: saldoInicialCentavos + lancamentos do período (ordem cronológica)
// ============================================================
router.get("/api/relatorios/fluxo-caixa/diario", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");
    const incluirPrevistos = String(req.query.incluirPrevistos || "0") === "1";

    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];

    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("Todas") || contaIds.includes("todas");

    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    const statusFluxoWhere = incluirPrevistos
      ? { statusFluxo: { in: ["EFETIVADO", "PREVISTO"] } }
      : { statusFluxo: "EFETIVADO" };

    // 1) saldo inicial = tudo antes de dtIni
    const anteriores = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...contaWhere,
        ...statusFluxoWhere,
        data: { lt: dtIni },
      },
      select: { es: true, valorCentavos: true },
    });

    const saldoInicialCentavos = anteriores.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // 2) lançamentos do período (com detalhes pra rastreabilidade)
    const lancamentos = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...contaWhere,
        ...statusFluxoWhere,
        data: { gte: dtIni, lte: dtFim },
      },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: {
        id: true,
        data: true,
        es: true,
        valorCentavos: true,
        historico: true,
        documento: true,
        clienteFornecedor: true,
        localLabelFallback: true,
        statusFluxo: true,
        contaId: true,
        conta: { select: { id: true, nome: true } },
      },

    });

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      contas: isAll ? "ALL" : contaIds,
      incluirPrevistos,
      saldoInicialCentavos,
      lancamentos: lancamentos.map((l) => ({
        id: l.id,
        data: l.data,
        es: l.es,
        valorCentavos: l.valorCentavos,
        descricao: l.historico || l.documento || l.clienteFornecedor || l.localLabelFallback || "",
        statusFluxo: l.statusFluxo,
        contaId: l.contaId,
        contaNome: l.conta?.nome || "",
      })),

      observacao: incluirPrevistos ? "Inclui previstos (efetivo + previsto)." : "Não inclui previstos (somente efetivo).",
    });
  } catch (e) {
    console.error("❌ Erro no relatório Fluxo de Caixa Diário:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

router.get("/api/relatorios/fluxo-caixa/grafico", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");
    const incluirPrevistos = String(req.query.incluirPrevistos || "0") === "1";

    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);

    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];
    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("todas") || contaIds.includes("Todas");

    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    const statusFluxoWhere = incluirPrevistos
      ? { statusFluxo: { in: ["EFETIVADO", "PREVISTO"] } }
      : { statusFluxo: "EFETIVADO" };

    // saldo inicial
    const anteriores = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, ...statusFluxoWhere, data: { lt: dtIni } },
      select: { es: true, valorCentavos: true, data: true },
    });

    let running = anteriores.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // lançamentos do período (só o necessário)
    const lancs = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, ...statusFluxoWhere, data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true },
    });

    // agrupa por dia (YYYY-MM-DD)
    const byDay = new Map();
    for (const l of lancs) {
      const d = new Date(l.data);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(l);
    }

    const serie = [];
    const days = Array.from(byDay.keys()).sort();
    for (const day of days) {
      const list = byDay.get(day) || [];
      for (const l of list) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") running += v;
        if (l.es === "S") running -= v;
      }
      serie.push({ dia: day, saldoCentavos: running });
    }

    let min = null;
    let max = null;
    for (const p of serie) {
      if (!min || p.saldoCentavos < min.saldoCentavos) min = p;
      if (!max || p.saldoCentavos > max.saldoCentavos) max = p;
    }

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      contas: isAll ? "ALL" : contaIds,
      incluirPrevistos,
      serie,
      min,
      max,
    });
  } catch (e) {
    console.error("❌ Erro no relatório gráfico do caixa:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

router.get("/api/relatorios/fluxo-caixa/por-conta", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");
    const incluirPrevistos = String(req.query.incluirPrevistos || "0") === "1";

    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    // Sempre ALL nesse relatório, mas deixo compatível
    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];
    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("todas") || contaIds.includes("Todas");

    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    const statusFluxoWhere = incluirPrevistos
      ? { statusFluxo: { in: ["EFETIVADO", "PREVISTO"] } }
      : { statusFluxo: "EFETIVADO" };

    const contas = await prisma.livroCaixaConta.findMany({
      where: isAll ? {} : { id: { in: contaWhere.contaId?.in || [] } },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });

    const result = [];

    for (const c of contas) {
      // saldo inicial por conta
      const anteriores = await prisma.livroCaixaLancamento.findMany({
        where: {
          contaId: c.id,
          ...statusFluxoWhere,
          data: { lt: dtIni },
        },
        select: { es: true, valorCentavos: true },
      });

      const saldoInicialCentavos = anteriores.reduce((acc, l) => {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") return acc + v;
        if (l.es === "S") return acc - v;
        return acc;
      }, 0);

      // período
      const periodo = await prisma.livroCaixaLancamento.findMany({
        where: {
          contaId: c.id,
          ...statusFluxoWhere,
          data: { gte: dtIni, lte: dtFim },
        },
        select: { es: true, valorCentavos: true },
      });

      const entradasCentavos = periodo.reduce((acc, l) => (l.es === "E" ? acc + Number(l.valorCentavos || 0) : acc), 0);
      const saidasCentavos = periodo.reduce((acc, l) => (l.es === "S" ? acc + Number(l.valorCentavos || 0) : acc), 0);

      const saldoFinalCentavos = saldoInicialCentavos + entradasCentavos - saidasCentavos;

      result.push({
        contaId: c.id,
        contaNome: c.nome,
        saldoInicialCentavos,
        entradasCentavos,
        saidasCentavos,
        saldoFinalCentavos,
        qtdLancamentos: periodo.length,
      });
    }

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      incluirPrevistos,
      contas: result,
    });
  } catch (e) {
    console.error("❌ Erro no relatório Fluxo por Conta:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

router.get("/api/relatorios/fluxo-caixa/projetado", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");

    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    // contas
    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];
    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("todas") || contaIds.includes("Todas");

    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    // saldo inicial (somente efetivo)
    const anterioresEfetivo = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });

    let runningEfetivo = anterioresEfetivo.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // saldo inicial (efetivo + previsto)
    const anterioresProj = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });

    let runningProjetado = anterioresProj.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // busca lançamentos do período (separa efetivo e previsto)
    const periodoEfetivo = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true },
    });

    const periodoProj = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true },
    });

    const toKey = (date) => {
      const d = new Date(date);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    const byDayEf = new Map();
    for (const l of periodoEfetivo) {
      const k = toKey(l.data);
      if (!byDayEf.has(k)) byDayEf.set(k, []);
      byDayEf.get(k).push(l);
    }

    const byDayProj = new Map();
    for (const l of periodoProj) {
      const k = toKey(l.data);
      if (!byDayProj.has(k)) byDayProj.set(k, []);
      byDayProj.get(k).push(l);
    }

    // lista de dias completos no intervalo (mesmo sem lançamentos)
    const days = [];
    {
      let cur = new Date(dtIni);
      while (cur <= dtFim) {
        days.push(toKey(cur));
        cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    const serie = [];
    let minEf = null, maxEf = null, minPr = null, maxPr = null;
    const diasRiscoEf = [];
    const diasRiscoPr = [];

    for (const day of days) {
      const listEf = byDayEf.get(day) || [];
      for (const l of listEf) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runningEfetivo += v;
        if (l.es === "S") runningEfetivo -= v;
      }

      const listPr = byDayProj.get(day) || [];
      for (const l of listPr) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runningProjetado += v;
        if (l.es === "S") runningProjetado -= v;
      }

      const row = {
        dia: day,
        saldoEfetivoCentavos: runningEfetivo,
        saldoProjetadoCentavos: runningProjetado,
      };
      serie.push(row);

      if (!minEf || row.saldoEfetivoCentavos < minEf.saldoEfetivoCentavos) minEf = { dia: day, saldoCentavos: row.saldoEfetivoCentavos };
      if (!maxEf || row.saldoEfetivoCentavos > maxEf.saldoEfetivoCentavos) maxEf = { dia: day, saldoCentavos: row.saldoEfetivoCentavos };
      if (!minPr || row.saldoProjetadoCentavos < minPr.saldoCentavos) minPr = { dia: day, saldoCentavos: row.saldoProjetadoCentavos };
      if (!maxPr || row.saldoProjetadoCentavos > maxPr.saldoCentavos) maxPr = { dia: day, saldoCentavos: row.saldoProjetadoCentavos };

      if (row.saldoEfetivoCentavos < 0) diasRiscoEf.push(day);
      if (row.saldoProjetadoCentavos < 0) diasRiscoPr.push(day);
    }

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      contas: isAll ? "ALL" : contaIds,
      serie,
      minEfetivo: minEf,
      maxEfetivo: maxEf,
      minProjetado: minPr,
      maxProjetado: maxPr,
      diasRiscoEfetivo: diasRiscoEf,
      diasRiscoProjetado: diasRiscoPr,
    });
  } catch (e) {
    console.error("❌ Erro no relatório Fluxo Projetado:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

router.get("/api/relatorios/fluxo-caixa/comparativo", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");

    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    // contas
    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];
    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("todas") || contaIds.includes("Todas");

    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    const toKey = (date) => {
      const d = new Date(date);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    // saldo inicial efetivo
    const anterioresEf = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });

    let runningEf = anterioresEf.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // saldo inicial projetado (efetivo + previsto)
    const anterioresPr = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });

    let runningPr = anterioresPr.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // período efetivo e projetado
    const periodoEf = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true },
    });

    const periodoPr = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true, statusFluxo: true },
    });

    const byDayEf = new Map();
    for (const l of periodoEf) {
      const k = toKey(l.data);
      if (!byDayEf.has(k)) byDayEf.set(k, []);
      byDayEf.get(k).push(l);
    }

    const byDayPr = new Map();
    for (const l of periodoPr) {
      const k = toKey(l.data);
      if (!byDayPr.has(k)) byDayPr.set(k, []);
      byDayPr.get(k).push(l);
    }

    // days full range
    const days = [];
    {
      let cur = new Date(dtIni);
      while (cur <= dtFim) {
        days.push(toKey(cur));
        cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    let diasRiscoEf = 0;
    let diasRiscoPr = 0;

    // contagem previstos no período
    const previstosNoPeriodo = periodoPr.filter((l) => l.statusFluxo === "PREVISTO");
    const totalPrevistosCentavos = previstosNoPeriodo.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // série compacta (1 ponto por dia)
    const serie = [];
    for (const day of days) {
      const listEf = byDayEf.get(day) || [];
      for (const l of listEf) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runningEf += v;
        if (l.es === "S") runningEf -= v;
      }

      const listPr = byDayPr.get(day) || [];
      for (const l of listPr) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runningPr += v;
        if (l.es === "S") runningPr -= v;
      }

      if (runningEf < 0) diasRiscoEf += 1;
      if (runningPr < 0) diasRiscoPr += 1;

      serie.push({ dia: day, saldoEfetivoCentavos: runningEf, saldoProjetadoCentavos: runningPr });
    }

    const saldoFinalEfetivoCentavos = serie.length ? serie[serie.length - 1].saldoEfetivoCentavos : runningEf;
    const saldoFinalProjetadoCentavos = serie.length ? serie[serie.length - 1].saldoProjetadoCentavos : runningPr;

    const diferencaCentavos = saldoFinalProjetadoCentavos - saldoFinalEfetivoCentavos;

    const impactoPercentual = saldoFinalEfetivoCentavos === 0
      ? null
      : Math.round((diferencaCentavos / saldoFinalEfetivoCentavos) * 10000) / 100; // 2 casas

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      contas: isAll ? "ALL" : contaIds,
      saldoFinalEfetivoCentavos,
      saldoFinalProjetadoCentavos,
      diferencaCentavos,
      impactoPercentual, // pode ser null
      diasRiscoEfetivo: diasRiscoEf,
      diasRiscoProjetado: diasRiscoPr,
      totalPrevistosCentavos,
      serie,
    });
  } catch (e) {
    console.error("❌ Erro no relatório Comparativo Efetivo x Projetado:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

router.get("/api/relatorios/fluxo-caixa/desempenho", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");
    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    // contas
    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];
    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("todas") || contaIds.includes("Todas");
    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    const toKey = (date) => {
      const d = new Date(date);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    // saldo inicial efetivo
    const anterioresEf = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });
    let runningEf = anterioresEf.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // saldo inicial projetado (efetivo+previsto)
    const anterioresPr = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });
    let runningPr = anterioresPr.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    const periodoEf = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true },
    });

    const periodoPr = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true },
    });

    const byDay = (rows) => {
      const m = new Map();
      for (const l of rows) {
        const k = toKey(l.data);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(l);
      }
      return m;
    };

    const byDayEf = byDay(periodoEf);
    const byDayPr = byDay(periodoPr);

    // days full range
    const days = [];
    {
      let cur = new Date(dtIni);
      while (cur <= dtFim) {
        days.push(toKey(cur));
        cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    let minEf = null, maxEf = null, minPr = null, maxPr = null;
    let diasNegEf = 0, diasNegPr = 0;

    const serie = [];

    for (const day of days) {
      const listEf = byDayEf.get(day) || [];
      for (const l of listEf) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runningEf += v;
        if (l.es === "S") runningEf -= v;
      }

      const listPr = byDayPr.get(day) || [];
      for (const l of listPr) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runningPr += v;
        if (l.es === "S") runningPr -= v;
      }

      const row = { dia: day, saldoEfetivoCentavos: runningEf, saldoProjetadoCentavos: runningPr };
      serie.push(row);

      if (!minEf || row.saldoEfetivoCentavos < minEf.saldoCentavos) minEf = { dia: day, saldoCentavos: row.saldoEfetivoCentavos };
      if (!maxEf || row.saldoEfetivoCentavos > maxEf.saldoCentavos) maxEf = { dia: day, saldoCentavos: row.saldoEfetivoCentavos };

      if (!minPr || row.saldoProjetadoCentavos < minPr.saldoCentavos) minPr = { dia: day, saldoCentavos: row.saldoProjetadoCentavos };
      if (!maxPr || row.saldoProjetadoCentavos > maxPr.saldoCentavos) maxPr = { dia: day, saldoCentavos: row.saldoProjetadoCentavos };

      if (row.saldoEfetivoCentavos < 0) diasNegEf += 1;
      if (row.saldoProjetadoCentavos < 0) diasNegPr += 1;
    }

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      contas: isAll ? "ALL" : contaIds,
      serie,
      minEfetivo: minEf,
      maxEfetivo: maxEf,
      minProjetado: minPr,
      maxProjetado: maxPr,
      diasNegativosEfetivo: diasNegEf,
      diasNegativosProjetado: diasNegPr,
    });
  } catch (e) {
    console.error("❌ Erro no relatório Desempenho do Caixa:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

router.get("/api/relatorios/fluxo-caixa/saude", authenticate, async (req, res) => {
  try {
    const dtIniStr = String(req.query.dtIni || "");
    const dtFimStr = String(req.query.dtFim || "");
    if (!dtIniStr || !dtFimStr) {
      return res.status(400).json({ message: "Parâmetros 'dtIni' e 'dtFim' são obrigatórios (YYYY-MM-DD)." });
    }

    const [yI, mI, dI] = dtIniStr.split("-").map(Number);
    const [yF, mF, dF] = dtFimStr.split("-").map(Number);
    const dtIni = new Date(yI, mI - 1, dI, 0, 0, 0, 0);
    const dtFim = new Date(yF, mF - 1, dF, 23, 59, 59, 999);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      return res.status(400).json({ message: "Datas inválidas. Use YYYY-MM-DD." });
    }
    if (dtFim < dtIni) {
      return res.status(400).json({ message: "'dtFim' deve ser >= 'dtIni'." });
    }

    // contas
    const contaIdRaw = req.query.contaId;
    const contaIds = Array.isArray(contaIdRaw) ? contaIdRaw.map(String) : [String(contaIdRaw || "ALL")];
    const isAll = contaIds.includes("ALL") || contaIds.includes("all") || contaIds.includes("todas") || contaIds.includes("Todas");
    const contaWhere = isAll
      ? {}
      : { contaId: { in: contaIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)) } };

    const toKey = (date) => {
      const d = new Date(date);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    // saldo inicial efetivo
    const anterioresEf = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });

    let saldoInicialEf = anterioresEf.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // saldo inicial projetado (efetivo + previsto)
    const anterioresPr = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { lt: dtIni } },
      select: { es: true, valorCentavos: true },
    });

    let saldoInicialPr = anterioresPr.reduce((acc, l) => {
      const v = Number(l.valorCentavos || 0);
      if (l.es === "E") return acc + v;
      if (l.es === "S") return acc - v;
      return acc;
    }, 0);

    // período efetivo
    const periodoEf = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: "EFETIVADO", data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true },
    });

    // período efetivo + previsto
    const periodoPr = await prisma.livroCaixaLancamento.findMany({
      where: { ...contaWhere, statusFluxo: { in: ["EFETIVADO", "PREVISTO"] }, data: { gte: dtIni, lte: dtFim } },
      orderBy: [{ data: "asc" }, { id: "asc" }],
      select: { data: true, es: true, valorCentavos: true, statusFluxo: true },
    });

    const entradasEf = periodoEf.reduce((acc, l) => (l.es === "E" ? acc + Number(l.valorCentavos || 0) : acc), 0);
    const saidasEf = periodoEf.reduce((acc, l) => (l.es === "S" ? acc + Number(l.valorCentavos || 0) : acc), 0);

    const entradasPr = periodoPr.reduce((acc, l) => (l.es === "E" ? acc + Number(l.valorCentavos || 0) : acc), 0);
    const saidasPr = periodoPr.reduce((acc, l) => (l.es === "S" ? acc + Number(l.valorCentavos || 0) : acc), 0);

    // net dos previstos (somente PREVISTO no período)
    const previstosNet = periodoPr
      .filter((l) => l.statusFluxo === "PREVISTO")
      .reduce((acc, l) => {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") return acc + v;
        if (l.es === "S") return acc - v;
        return acc;
      }, 0);

    const saldoFinalEf = saldoInicialEf + entradasEf - saidasEf;
    const saldoFinalPr = saldoInicialPr + entradasPr - saidasPr;

    // dias no vermelho (efetivo vs projetado)
    const byDay = (rows) => {
      const m = new Map();
      for (const l of rows) {
        const k = toKey(l.data);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(l);
      }
      return m;
    };
    const mapEf = byDay(periodoEf);
    const mapPr = byDay(periodoPr);

    const days = [];
    {
      let cur = new Date(dtIni);
      while (cur <= dtFim) {
        days.push(toKey(cur));
        cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    let runEf = saldoInicialEf;
    let runPr = saldoInicialPr;

    let diasNoVermelhoEf = 0;
    let diasNoVermelhoPr = 0;

    let menorEf = { dia: null, saldoCentavos: null };
    let maiorEf = { dia: null, saldoCentavos: null };

    let menorPr = { dia: null, saldoCentavos: null };
    let maiorPr = { dia: null, saldoCentavos: null };

    for (const day of days) {
      const listEf = mapEf.get(day) || [];
      for (const l of listEf) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runEf += v;
        if (l.es === "S") runEf -= v;
      }

      const listPr = mapPr.get(day) || [];
      for (const l of listPr) {
        const v = Number(l.valorCentavos || 0);
        if (l.es === "E") runPr += v;
        if (l.es === "S") runPr -= v;
      }

      if (runEf < 0) diasNoVermelhoEf += 1;
      if (runPr < 0) diasNoVermelhoPr += 1;

      if (menorEf.saldoCentavos === null || runEf < menorEf.saldoCentavos) menorEf = { dia: day, saldoCentavos: runEf };
      if (maiorEf.saldoCentavos === null || runEf > maiorEf.saldoCentavos) maiorEf = { dia: day, saldoCentavos: runEf };

      if (menorPr.saldoCentavos === null || runPr < menorPr.saldoCentavos) menorPr = { dia: day, saldoCentavos: runPr };
      if (maiorPr.saldoCentavos === null || runPr > maiorPr.saldoCentavos) maiorPr = { dia: day, saldoCentavos: runPr };
    }

    const totalDias = days.length;
    const percNegEf = totalDias ? Math.round((diasNoVermelhoEf / totalDias) * 10000) / 100 : 0;
    const percNegPr = totalDias ? Math.round((diasNoVermelhoPr / totalDias) * 10000) / 100 : 0;

    const dependenciaPrevistosPerc = saldoFinalEf === 0
      ? null
      : Math.round(((saldoFinalPr - saldoFinalEf) / saldoFinalEf) * 10000) / 100;

    res.json({
      periodo: { dtIni: dtIniStr, dtFim: dtFimStr },
      contas: isAll ? "ALL" : contaIds,
      totalDias,
      efetivo: {
        saldoInicialCentavos: saldoInicialEf,
        entradasCentavos: entradasEf,
        saidasCentavos: saidasEf,
        saldoFinalCentavos: saldoFinalEf,
        diasNoVermelho: diasNoVermelhoEf,
        percNoVermelho: percNegEf,
        menorSaldo: menorEf,
        maiorSaldo: maiorEf,
      },
      projetado: {
        saldoInicialCentavos: saldoInicialPr,
        entradasCentavos: entradasPr,
        saidasCentavos: saidasPr,
        saldoFinalCentavos: saldoFinalPr,
        diasNoVermelho: diasNoVermelhoPr,
        percNoVermelho: percNegPr,
        menorSaldo: menorPr,
        maiorSaldo: maiorPr,
      },
      previstosNetCentavos: previstosNet,
      dependenciaPrevistosPerc,
    });
  } catch (e) {
    console.error("❌ Erro no relatório Saúde Financeira:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

// ============================================================
// RELATÓRIO CLIENTES/FORNECEDORES
// ============================================================

// GET /api/relatorios/clientes-fornecedores
router.get("/api/relatorios/clientes-fornecedores", authenticate, async (req, res) => {
  try {
    const { tipo, clienteId, dataInicio, dataFim, statusFluxo } = req.query;

    // Build where clause
    const where = {};

    // Filter by clienteFornecedor if specified
    if (clienteId) {
      const cliente = await prisma.cliente.findUnique({
        where: { id: Number(clienteId) },
        select: { nomeRazaoSocial: true },
      });
      if (cliente) {
        where.clienteFornecedor = { contains: cliente.nomeRazaoSocial, mode: "insensitive" };
      }
    }

    // Filter by date range
    if (dataInicio || dataFim) {
      where.data = {};
      if (dataInicio) {
        where.data.gte = new Date(dataInicio);
      }
      if (dataFim) {
        const fim = new Date(dataFim);
        fim.setHours(23, 59, 59, 999);
        where.data.lte = fim;
      }
    }

    // Filter by statusFluxo
    if (statusFluxo) {
      where.statusFluxo = statusFluxo;
    }

    // Filter by E/S based on tipo (C=Cliente receives, F=Fornecedor pays)
    if (tipo === "C") {
      where.es = "E"; // Entradas = recebimentos de clientes
    } else if (tipo === "F") {
      where.es = "S"; // Saídas = pagamentos a fornecedores
    }
    // tipo "A" = all, no filter on es

    // Query lancamentos
    const lancamentos = await prisma.livroCaixaLancamento.findMany({
      where: {
        ...where,
        clienteFornecedor: where.clienteFornecedor || { not: null },
      },
      orderBy: { data: "desc" },
      select: {
        id: true,
        data: true,
        es: true,
        documento: true,
        clienteFornecedor: true,
        historico: true,
        valorCentavos: true,
        statusFluxo: true,
        conta: {
          select: { nome: true },
        },
      },
    });

    res.json({
      total: lancamentos.length,
      lancamentos,
    });
  } catch (e) {
    console.error("❌ Erro no relatório clientes/fornecedores:", e);
    res.status(400).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

// ============================================================
// NOVOS ENDPOINTS - PARCELAS FIXAS NO LIVRO CAIXA
// Adicionar no server.js após os endpoints de Livro Caixa (linha ~6500)
// ============================================================

// ============================================================
// 1. POST /api/livro-caixa/gerar-parcelas-fixas-mes
// Gera lançamentos PREVISTOS de parcelas fixas para todos advogados
// ============================================================
router.post("/api/livro-caixa/gerar-parcelas-fixas-mes", authenticate, requireAdmin, async (req, res) => {
  try {
    const { ano, mes } = req.body;

    if (!ano || !mes) {
      return res.status(400).json({ message: "ano e mes são obrigatórios" });
    }

    console.log(`\n🔄 Gerando parcelas fixas para ${mes}/${ano}...`);

    // Buscar advogados com parcela fixa ativa
    const advogados = await prisma.advogado.findMany({
      where: { parcelaFixaAtiva: true },
      select: {
        id: true,
        nome: true,
        parcelaFixaValor: true,
        parcelaFixaNome: true,
      },
    });

    console.log(`📋 ${advogados.length} advogados com parcela fixa ativa`);

    if (advogados.length === 0) {
      return res.json({ 
        message: "Nenhum advogado com parcela fixa ativa",
        gerados: 0,
        ignorados: 0,
      });
    }

    let gerados = 0;
    let ignorados = 0;

    for (const adv of advogados) {
      const referenciaOrigem = `PARCELA_FIXA_${adv.id}_${ano}_${mes}`;

      // Verificar se já existe
      const existe = await prisma.livroCaixaLancamento.findFirst({
        where: {
          origem: "PARCELA_FIXA_AUTOMATICA",
          referenciaOrigem,
        },
      });

      if (existe) {
        console.log(`  ⏭️  ${adv.nome}: Já existe`);
        ignorados++;
        continue;
      }

      // Criar lançamento PREVISTO
      const valorCentavos = Math.round(parseFloat(adv.parcelaFixaValor) * 100);
      
      await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno: parseInt(ano),
          competenciaMes: parseInt(mes),
          data: new Date(Date.UTC(Number(ano), Number(mes) - 1, 5, 12, 0, 0)), // Dia 5 do mês T12Z
          documento: null,
          es: "S",
          clienteFornecedor: adv.nome,
          historico: adv.parcelaFixaNome || "Pró Labore",
          valorCentavos,
          contaId: null,
          ordemDia: 0,
          origem: "PARCELA_FIXA_AUTOMATICA",
          status: "PENDENTE_CONTA",
          statusFluxo: "PREVISTO",
          localLabelFallback: null,
          referenciaOrigem,
        },
      });

      console.log(`  ✅ ${adv.nome}: R$ ${(valorCentavos / 100).toFixed(2)}`);
      gerados++;
    }

    console.log(`\n✅ Concluído: ${gerados} gerados, ${ignorados} ignorados\n`);

    res.json({
      message: `${gerados} parcela(s) fixa(s) gerada(s) com sucesso`,
      gerados,
      ignorados,
      total: advogados.length,
    });

  } catch (error) {
    console.error("❌ Erro ao gerar parcelas fixas:", error);
    res.status(500).json({ 
      message: "Erro ao gerar parcelas fixas",
      error: error.message,
    });
  }
});

// ============================================================
// 2. POST /api/livro-caixa/confirmar-parcela-fixa
// Confirma parcela fixa: PREVISTO → EFETIVADO
// ============================================================
router.post("/api/livro-caixa/confirmar-parcela-fixa", authenticate, requireAdmin, async (req, res) => {
  try {
    const { lancamentoId, contaId, data } = req.body;

    console.log(`\n✓ Confirmando parcela fixa: ${lancamentoId}`);

    if (!lancamentoId || !contaId || !data) {
      return res.status(400).json({ 
        message: "lancamentoId, contaId e data são obrigatórios" 
      });
    }

    // Buscar lançamento
    const lancamento = await prisma.livroCaixaLancamento.findUnique({
      where: { id: parseInt(lancamentoId) },
    });

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado" });
    }

    if (lancamento.statusFluxo !== "PREVISTO") {
      return res.status(400).json({ 
        message: "Apenas lançamentos PREVISTOS podem ser confirmados" 
      });
    }

    if (lancamento.origem !== "PARCELA_FIXA_AUTOMATICA") {
      return res.status(400).json({ 
        message: "Este lançamento não é uma parcela fixa automática" 
      });
    }

    // Parse data DD/MM/AAAA
    const [dia, mes, ano] = data.split("/");
    const dataEfetivacao = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));

    if (isNaN(dataEfetivacao.getTime())) {
      return res.status(400).json({ message: "Data inválida (use DD/MM/AAAA)" });
    }

    // Atualizar: PREVISTO → EFETIVADO
    const atualizado = await prisma.livroCaixaLancamento.update({
      where: { id: parseInt(lancamentoId) },
      data: {
        statusFluxo: "EFETIVADO",
        contaId: parseInt(contaId),
        data: dataEfetivacao,
        status: "OK",
      },
    });

    console.log(`✅ Parcela fixa confirmada: ${lancamento.historico}`);

    res.json({
      message: "Parcela fixa confirmada com sucesso",
      lancamento: atualizado,
    });

  } catch (error) {
    console.error("❌ Erro ao confirmar parcela fixa:", error);
    res.status(500).json({ 
      message: "Erro ao confirmar parcela fixa",
      error: error.message,
    });
  }
});

// ============================================================
// 3. PUT /api/livro-caixa/editar-parcela-fixa
// Edita valor e confirma parcela fixa
// ============================================================
router.put("/api/livro-caixa/editar-parcela-fixa", authenticate, requireAdmin, async (req, res) => {
  try {
    const { lancamentoId, novoValor, contaId, data } = req.body;

    console.log(`\n✏️ Editando parcela fixa: ${lancamentoId}`);

    if (!lancamentoId || !novoValor || !contaId || !data) {
      return res.status(400).json({ 
        message: "lancamentoId, novoValor, contaId e data são obrigatórios" 
      });
    }

    // Buscar lançamento
    const lancamento = await prisma.livroCaixaLancamento.findUnique({
      where: { id: parseInt(lancamentoId) },
    });

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado" });
    }

    if (lancamento.statusFluxo !== "PREVISTO") {
      return res.status(400).json({ 
        message: "Apenas lançamentos PREVISTOS podem ser editados" 
      });
    }

    if (lancamento.origem !== "PARCELA_FIXA_AUTOMATICA") {
      return res.status(400).json({ 
        message: "Este lançamento não é uma parcela fixa automática" 
      });
    }

    // Validar valor
    const valorNum = parseFloat(novoValor);
    if (isNaN(valorNum) || valorNum <= 0) {
      return res.status(400).json({ message: "Valor inválido" });
    }

    const valorCentavos = Math.round(valorNum * 100);

    // Parse data DD/MM/AAAA
    const [dia, mes, ano] = data.split("/");
    const dataEfetivacao = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));

    if (isNaN(dataEfetivacao.getTime())) {
      return res.status(400).json({ message: "Data inválida (use DD/MM/AAAA)" });
    }

    // Atualizar valor e status
    const atualizado = await prisma.livroCaixaLancamento.update({
      where: { id: parseInt(lancamentoId) },
      data: {
        valorCentavos,
        statusFluxo: "EFETIVADO",
        contaId: parseInt(contaId),
        data: dataEfetivacao,
        status: "OK",
      },
    });

    console.log(`✅ Parcela fixa editada: ${lancamento.historico} - Novo valor: R$ ${(valorCentavos / 100).toFixed(2)}`);

    res.json({
      message: "Parcela fixa editada e confirmada com sucesso",
      lancamento: atualizado,
    });

  } catch (error) {
    console.error("❌ Erro ao editar parcela fixa:", error);
    res.status(500).json({ 
      message: "Erro ao editar parcela fixa",
      error: error.message,
    });
  }
});

// ============================================================
// 4. DELETE /api/livro-caixa/remover-parcela-fixa/:id
// Remove parcela fixa PREVISTA
// ============================================================
router.delete("/api/livro-caixa/remover-parcela-fixa/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`\n❌ Removendo parcela fixa: ${id}`);

    // Buscar lançamento
    const lancamento = await prisma.livroCaixaLancamento.findUnique({
      where: { id: parseInt(id) },
    });

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado" });
    }

    if (lancamento.statusFluxo !== "PREVISTO") {
      return res.status(400).json({ 
        message: "Apenas lançamentos PREVISTOS podem ser removidos. Lançamentos EFETIVADOS são permanentes." 
      });
    }

    if (lancamento.origem !== "PARCELA_FIXA_AUTOMATICA") {
      return res.status(400).json({ 
        message: "Este lançamento não é uma parcela fixa automática" 
      });
    }

    // Deletar
    await prisma.livroCaixaLancamento.delete({
      where: { id: parseInt(id) },
    });

    console.log(`✅ Parcela fixa removida: ${lancamento.historico}`);

    res.json({
      message: "Parcela fixa removida com sucesso",
    });

  } catch (error) {
    console.error("❌ Erro ao remover parcela fixa:", error);
    res.status(500).json({ 
      message: "Erro ao remover parcela fixa",
      error: error.message,
    });
  }
});

// ============================================================
// 5. PUT /api/livro-caixa/lancamentos/:id/documento
// Edita campo documento (NFS-e/NF/CF/RC)
// ============================================================
router.put("/api/livro-caixa/lancamentos/:id/documento", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { documento } = req.body;

    console.log(`\n📝 Editando documento do lançamento: ${id}`);

    // Buscar lançamento
    const lancamento = await prisma.livroCaixaLancamento.findUnique({
      where: { id: parseInt(id) },
    });

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado" });
    }

    if (lancamento.statusFluxo !== "EFETIVADO") {
      return res.status(400).json({ 
        message: "Apenas lançamentos EFETIVADOS podem ter o documento editado" 
      });
    }

    // Atualizar documento
    const atualizado = await prisma.livroCaixaLancamento.update({
      where: { id: parseInt(id) },
      data: {
        documento: documento || null,
      },
    });

    console.log(`✅ Documento atualizado: "${documento || "(vazio)"}"`);

    res.json({
      message: "Documento atualizado com sucesso",
      lancamento: atualizado,
    });

  } catch (error) {
    console.error("❌ Erro ao editar documento:", error);
    res.status(500).json({ 
      message: "Erro ao editar documento",
      error: error.message,
    });
  }
});


router.get("/api/relatorios/inadimplencia", authenticate, async (req, res) => {
  try {
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const diasMinimos = Math.max(0, parseInt(req.query.diasMinimos || "0", 10) || 0);
    const filterAdvogadoId = req.query.advogadoId ? parseInt(req.query.advogadoId, 10) : null;

    const hoje = new Date();
    const inicioDia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 3, 0, 0));

    let advogadoIdFiltro = filterAdvogadoId;
    if (!isAdmin) {
      advogadoIdFiltro = await getUserAdvogadoId(req.user?.id);
      if (!advogadoIdFiltro) {
        return res.json({ clientes: [], totais: { clientesCount: 0, parcelasCount: 0, valorTotalCentavos: 0, maiorAtraso: 0 } });
      }
    }

    let parcelas = await prisma.parcelaContrato.findMany({
      where: { status: { in: ["PREVISTA", "PENDENTE"] }, vencimento: { lt: inicioDia } },
      include: {
        contrato: {
          select: {
            id: true,
            numeroContrato: true,
            repasseAdvogadoPrincipalId: true,
            cliente: { select: { id: true, nomeRazaoSocial: true, cpfCnpj: true, telefone: true } },
          },
        },
        ...(advogadoIdFiltro
          ? { splits: { where: { advogadoId: advogadoIdFiltro }, select: { advogadoId: true } } }
          : {}),
      },
      orderBy: { vencimento: "asc" },
    });

    if (advogadoIdFiltro) {
      parcelas = parcelas.filter(p =>
        p.contrato.repasseAdvogadoPrincipalId === advogadoIdFiltro ||
        (p.splits && p.splits.length > 0)
      );
    }

    const agora = Date.now();
    const RISCO_ORD = { DUVIDOSO: 4, ALTO_RISCO: 3, ATENCAO: 2, NORMAL: 1 };

    const enriched = parcelas.map(p => {
      const diasEmAtraso = Math.floor((agora - new Date(p.vencimento).getTime()) / 86400000);
      let risco;
      if (diasEmAtraso <= 30) risco = "NORMAL";
      else if (diasEmAtraso <= 60) risco = "ATENCAO";
      else if (diasEmAtraso <= 90) risco = "ALTO_RISCO";
      else risco = "DUVIDOSO";
      return { ...p, diasEmAtraso, risco, valorPrevistoCentavos: Math.round(Number(p.valorPrevisto) * 100) };
    });

    const filtradas = diasMinimos > 0 ? enriched.filter(p => p.diasEmAtraso >= diasMinimos) : enriched;

    const clienteMap = new Map();
    for (const p of filtradas) {
      const cId = p.contrato.cliente.id;
      if (!clienteMap.has(cId)) {
        clienteMap.set(cId, { cliente: p.contrato.cliente, parcelas: [], totalDevidoCentavos: 0, maiorAtraso: 0 });
      }
      const entry = clienteMap.get(cId);
      entry.parcelas.push({
        id: p.id, numero: p.numero, contratoId: p.contratoId,
        numeroContrato: p.contrato.numeroContrato, vencimento: p.vencimento,
        diasEmAtraso: p.diasEmAtraso, risco: p.risco, valorPrevistoCentavos: p.valorPrevistoCentavos,
      });
      entry.totalDevidoCentavos += p.valorPrevistoCentavos;
      if (p.diasEmAtraso > entry.maiorAtraso) entry.maiorAtraso = p.diasEmAtraso;
    }

    const clientes = [...clienteMap.values()].map(e => ({
      ...e,
      riscoDominante: e.parcelas.reduce(
        (w, p) => RISCO_ORD[p.risco] > RISCO_ORD[w] ? p.risco : w,
        "NORMAL"
      ),
    })).sort((a, b) => b.totalDevidoCentavos - a.totalDevidoCentavos);

    res.json({
      clientes,
      totais: {
        clientesCount: clientes.length,
        parcelasCount: filtradas.length,
        valorTotalCentavos: filtradas.reduce((s, p) => s + p.valorPrevistoCentavos, 0),
        maiorAtraso: filtradas.length > 0 ? Math.max(...filtradas.map(p => p.diasEmAtraso)) : 0,
      },
    });
  } catch (e) {
    console.error("❌ Erro ao gerar relatório de inadimplência:", e);
    res.status(500).json({ message: e.message });
  }
});

export default router;
