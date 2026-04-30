// routes/indicadores.js — Indicadores gerenciais (admin only)
// Receita = ParcelaContrato.status="RECEBIDA" (exclui alvarás, CC clientes, transferências)

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";

const router = Router();

router.get("/api/indicadores", authenticate, requireAdmin, async (req, res) => {
  try {
    const hoje = new Date();
    const ano  = Number(req.query.ano) || hoje.getUTCFullYear();

    const dtIni  = new Date(Date.UTC(ano, 0, 1));
    const dtFim  = new Date(Date.UTC(ano, 11, 31, 23, 59, 59, 999));
    const dtHoje = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 3, 0, 0));

    // ── 1. RECEITA MENSAL (parcelas RECEBIDA — usa dataRecebimento; fallback: vencimento) ─
    // Parcelas RECEBIDA com dataRecebimento=null são agrupadas pelo vencimento (dados históricos
    // sem dataRecebimento preenchida, e.g. confirmadas por fluxo alternativo).
    // RECEBIDA e REPASSE_EFETUADO são equivalentes para fins de receita
    const STATUS_RECEBIDA = { in: ["RECEBIDA", "REPASSE_EFETUADO"] };
    const whereRecebidaAno = {
      status: STATUS_RECEBIDA,
      OR: [
        { dataRecebimento: { gte: dtIni, lte: dtFim } },
        { dataRecebimento: null, vencimento: { gte: dtIni, lte: dtFim } },
      ],
    };
    const [parcelasConf, parcelasPrev] = await Promise.all([
      prisma.parcelaContrato.findMany({
        where: whereRecebidaAno,
        select: { dataRecebimento: true, vencimento: true, valorRecebido: true, valorPrevisto: true },
      }),
      prisma.parcelaContrato.findMany({
        where: { status: { in: ["PREVISTA", "PENDENTE"] }, vencimento: { gte: dtIni, lte: dtFim } },
        select: { vencimento: true, valorPrevisto: true },
      }),
    ]);

    const MESES_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    const receitaMensal = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1, ano, label: MESES_PT[i], confirmadaCentavos: 0, previstaCentavos: 0,
    }));
    parcelasConf.forEach(p => {
      const effectiveDate = p.dataRecebimento || p.vencimento;
      const m = new Date(effectiveDate).getUTCMonth();
      receitaMensal[m].confirmadaCentavos += Math.round(Number(p.valorRecebido || p.valorPrevisto || 0) * 100);
    });
    parcelasPrev.forEach(p => {
      const m = new Date(p.vencimento).getUTCMonth();
      receitaMensal[m].previstaCentavos += Math.round(Number(p.valorPrevisto || 0) * 100);
    });

    // ── 2. HONORÁRIOS POR ADVOGADO ────────────────────────────────────────────
    const parcelasAdv = await prisma.parcelaContrato.findMany({
      where: whereRecebidaAno,
      select: {
        valorRecebido: true, valorPrevisto: true,
        contrato: {
          select: {
            repasseAdvogadoPrincipalId: true,
            repasseAdvogadoPrincipal: { select: { nome: true } },
          },
        },
      },
    });

    const advMap = new Map();
    parcelasAdv.forEach(p => {
      const advId  = p.contrato.repasseAdvogadoPrincipalId ?? 0;
      const nome   = p.contrato.repasseAdvogadoPrincipal?.nome || "Sem advogado";
      const valor  = Math.round(Number(p.valorRecebido || p.valorPrevisto || 0) * 100);
      if (!advMap.has(advId)) advMap.set(advId, { advogadoId: advId, nome, totalCentavos: 0, parcelas: 0 });
      const e = advMap.get(advId);
      e.totalCentavos += valor;
      e.parcelas++;
    });
    const honorariosPorAdvogado = [...advMap.values()].sort((a, b) => b.totalCentavos - a.totalCentavos);

    // ── 3. TICKET MÉDIO POR ADVOGADO ──────────────────────────────────────────
    const contratosTk = await prisma.contratoPagamento.findMany({
      where: { repasseAdvogadoPrincipalId: { not: null } },
      select: {
        id: true,
        repasseAdvogadoPrincipalId: true,
        repasseAdvogadoPrincipal: { select: { nome: true } },
        parcelas: {
          where: {
            status: STATUS_RECEBIDA,
            OR: [
              { dataRecebimento: { gte: dtIni, lte: dtFim } },
              { dataRecebimento: null, vencimento: { gte: dtIni, lte: dtFim } },
            ],
          },
          select: { valorRecebido: true, valorPrevisto: true },
        },
      },
    });
    const tkMap = new Map();
    contratosTk.forEach(c => {
      const receita = c.parcelas.reduce(
        (s, p) => s + Math.round(Number(p.valorRecebido || p.valorPrevisto || 0) * 100), 0
      );
      if (receita === 0) return;
      const advId = c.repasseAdvogadoPrincipalId;
      const nome  = c.repasseAdvogadoPrincipal?.nome || "Desconhecido";
      if (!tkMap.has(advId)) tkMap.set(advId, { advogadoId: advId, nome, totalCentavos: 0, contratos: 0 });
      const e = tkMap.get(advId);
      e.totalCentavos += receita;
      e.contratos++;
    });
    const ticketMedio = [...tkMap.values()]
      .map(e => ({ ...e, ticketMedioCentavos: Math.round(e.totalCentavos / e.contratos) }))
      .sort((a, b) => b.ticketMedioCentavos - a.ticketMedioCentavos);

    // ── 4. INADIMPLÊNCIA ──────────────────────────────────────────────────────
    const [vencidas, todasAtivas] = await Promise.all([
      prisma.parcelaContrato.findMany({
        where: { status: { in: ["PREVISTA", "PENDENTE"] }, vencimento: { lt: dtHoje } },
        select: { valorPrevisto: true, contrato: { select: { clienteId: true } } },
      }),
      prisma.parcelaContrato.aggregate({
        where: { status: { in: ["PREVISTA", "PENDENTE"] } },
        _sum: { valorPrevisto: true },
      }),
    ]);
    const valorVencido    = vencidas.reduce((s, p) => s + Math.round(Number(p.valorPrevisto) * 100), 0);
    const totalPrevisto   = Math.round(Number(todasAtivas._sum?.valorPrevisto || 0) * 100);
    const inadimplencia   = {
      valorCentavos: valorVencido,
      totalCentavos: totalPrevisto,
      taxa: totalPrevisto > 0 ? Math.round((valorVencido / totalPrevisto) * 10000) / 100 : 0,
      clientesCount: new Set(vencidas.map(p => p.contrato.clienteId)).size,
      parcelasCount: vencidas.length,
    };

    // ── 5. PROCESSOS POR STATUS ───────────────────────────────────────────────
    const processosPorStatus = await prisma.processoJudicial.groupBy({
      by: ["status"],
      _count: { _all: true },
      orderBy: { _count: { status: "desc" } },
    });

    // ── 6. PROCESSOS POR TRIBUNAL (top 10 ativos) ─────────────────────────────
    const processosPorTribunal = await prisma.processoJudicial.groupBy({
      by: ["tribunal"],
      where: { status: "ATIVO" },
      _count: { _all: true },
      orderBy: { _count: { tribunal: "desc" } },
      take: 10,
    });

    // ── 7. ANDAMENTOS POR MÊS (últimos 6 meses) ───────────────────────────────
    const dtSeis = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 5, 1));
    const todosAnd = await prisma.processoAndamento.findMany({
      where: { createdAt: { gte: dtSeis } },
      select: { createdAt: true },
    });
    const andamentosPorMes = Array.from({ length: 6 }, (_, i) => {
      const d    = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (5 - i), 1));
      const ano_ = d.getUTCFullYear();
      const mes_ = d.getUTCMonth();
      return {
        label: `${MESES_PT[mes_]}/${String(ano_).slice(2)}`,
        mes: mes_ + 1,
        ano: ano_,
        count: todosAnd.filter(a => {
          const ad = new Date(a.createdAt);
          return ad.getUTCFullYear() === ano_ && ad.getUTCMonth() === mes_;
        }).length,
      };
    });

    // ── 8. PROCESSOS POR ADVOGADO (ativos) ────────────────────────────────────
    const procAdv = await prisma.processoJudicial.groupBy({
      by: ["advogadoId"],
      where: { status: "ATIVO" },
      _count: { _all: true },
      orderBy: { _count: { advogadoId: "desc" } },
      take: 15,
    });
    const advIds  = procAdv.map(r => r.advogadoId).filter(Boolean);
    const advRows = await prisma.advogado.findMany({
      where: { id: { in: advIds } },
      select: { id: true, nome: true },
    });
    const advNomeMap = new Map(advRows.map(a => [a.id, a.nome]));
    const processosPorAdvogado = procAdv.map(r => ({
      advogadoId: r.advogadoId,
      nome: r.advogadoId ? (advNomeMap.get(r.advogadoId) || "Desconhecido") : "Sem advogado",
      count: r._count._all,
    }));

    // ── 9. NOVOS CLIENTES POR MÊS ─────────────────────────────────────────────
    const clientesAno = await prisma.cliente.findMany({
      where: { createdAt: { gte: dtIni, lte: dtFim } },
      select: { createdAt: true },
    });
    const novosClientesMensal = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1, ano, label: MESES_PT[i], count: 0,
    }));
    clientesAno.forEach(c => {
      novosClientesMensal[new Date(c.createdAt).getUTCMonth()].count++;
    });

    // ── 10. CONTRATOS STATUS ──────────────────────────────────────────────────
    const [contratosAtivos, contratosEncerrados] = await Promise.all([
      prisma.contratoPagamento.count({ where: { ativo: true } }),
      prisma.contratoPagamento.count({ where: { ativo: false } }),
    ]);

    // ── SUMÁRIO ───────────────────────────────────────────────────────────────
    const receitaAno    = receitaMensal.reduce((s, m) => s + m.confirmadaCentavos, 0);
    const previstaTot   = receitaMensal.reduce((s, m) => s + m.previstaCentavos, 0);
    const processosAtivos = processosPorStatus.find(r => r.status === "ATIVO")?._count._all || 0;

    res.json({
      ano,
      sumario: {
        receitaAnoCentavos: receitaAno,
        previstaTotalCentavos: previstaTot,
        processosAtivos,
        totalProcessos: processosPorStatus.reduce((s, r) => s + r._count._all, 0),
        contratosAtivos,
        contratosEncerrados,
        inadimplencia,
      },
      receitaMensal,
      honorariosPorAdvogado,
      ticketMedio,
      inadimplencia,
      processosPorStatus: processosPorStatus.map(r => ({ status: r.status, count: r._count._all })),
      processosPorTribunal: processosPorTribunal.map(r => ({ tribunal: r.tribunal, count: r._count._all })),
      andamentosPorMes,
      processosPorAdvogado,
      novosClientesMensal,
      contratos: { ativos: contratosAtivos, encerrados: contratosEncerrados },
    });

  } catch (e) {
    console.error("GET /api/indicadores:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/indicadores/parcelas?ano=&mes=&tipo= ─────────────────────────────
// tipo: "recebida" | "prevista" | omitido = ambas
router.get("/api/indicadores/parcelas", authenticate, requireAdmin, async (req, res) => {
  try {
    const ano  = Number(req.query.ano)  || new Date().getUTCFullYear();
    const mes  = Number(req.query.mes)  || (new Date().getUTCMonth() + 1);
    const tipo = req.query.tipo || "ambas"; // "recebida" | "prevista" | "ambas"

    const dtIni = new Date(Date.UTC(ano, mes - 1, 1));
    const dtFim = new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));

    const select = {
      id: true,
      numero: true,
      valorPrevisto: true,
      valorRecebido: true,
      vencimento: true,
      dataRecebimento: true,
      meioRecebimento: true,
      status: true,
      contrato: {
        select: {
          numeroContrato: true,
          cliente: { select: { nomeRazaoSocial: true } },
          repasseAdvogadoPrincipal: { select: { nome: true } },
        },
      },
    };

    const STATUS_RECEBIDA_MES = { in: ["RECEBIDA", "REPASSE_EFETUADO"] };
    const whereRecebidaMes = {
      status: STATUS_RECEBIDA_MES,
      OR: [
        { dataRecebimento: { gte: dtIni, lte: dtFim } },
        { dataRecebimento: null, vencimento: { gte: dtIni, lte: dtFim } },
      ],
    };
    const recebidas = (tipo === "recebida" || tipo === "ambas")
      ? await prisma.parcelaContrato.findMany({
          where: whereRecebidaMes,
          select,
          orderBy: { vencimento: "asc" },
        })
      : [];

    const previstas = (tipo === "prevista" || tipo === "ambas")
      ? await prisma.parcelaContrato.findMany({
          where: { status: { in: ["PREVISTA", "PENDENTE"] }, vencimento: { gte: dtIni, lte: dtFim } },
          select,
          orderBy: { vencimento: "asc" },
        })
      : [];

    function mapP(p, tipoRow) {
      return {
        id: p.id,
        numero: p.numero,
        tipo: tipoRow,
        cliente: p.contrato.cliente.nomeRazaoSocial,
        contrato: p.contrato.numeroContrato,
        advogado: p.contrato.repasseAdvogadoPrincipal?.nome || "—",
        vencimento: p.vencimento,
        dataRecebimento: p.dataRecebimento,
        meioRecebimento: p.meioRecebimento || "—",
        valorPrevistoC: Math.round(Number(p.valorPrevisto || 0) * 100),
        valorRecebidoC: p.valorRecebido ? Math.round(Number(p.valorRecebido) * 100) : null,
        status: p.status,
      };
    }

    const parcelas = [
      ...recebidas.map(p => mapP(p, "recebida")),
      ...previstas.map(p => mapP(p, "prevista")),
    ];

    const totalRecebidoC = recebidas.reduce(
      (s, p) => s + Math.round(Number(p.valorRecebido || p.valorPrevisto || 0) * 100), 0
    );
    const totalPrevistoC = previstas.reduce(
      (s, p) => s + Math.round(Number(p.valorPrevisto || 0) * 100), 0
    );

    res.json({ parcelas, totalRecebidoC, totalPrevistoC, mes, ano });
  } catch (e) {
    console.error("GET /api/indicadores/parcelas:", e.message);
    res.status(500).json({ message: e.message });
  }
});

export default router;
