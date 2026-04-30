// backend/src/routes/interPagamentos.js
// Rotas de pagamento de boletos via Banco Inter (banking/v2/pagamento)

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { pagarBoleto, listarPagamentosInter, cancelarPagamentoInter, pagarDarf } from "../lib/interPagamentos.js";
import { INTER_MODE } from "../lib/interBoleto.js";

const router = Router();

const fmtBRL = (c) =>
  (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Próximo dia útil (Mon-Fri) em BRT, a partir de amanhã */
function proximoDiaUtil() {
  const nowBRT = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Belem" }));
  const d = new Date(nowBRT);
  d.setDate(d.getDate() + 1);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── POST /api/inter/pagamentos/pagar ─────────────────────────────────────────
// Paga boleto/convênio/tributo por código de barras ou linha digitável.

router.post("/api/inter/pagamentos/pagar", authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      codBarraLinhaDigitavel,
      valorCentavos,
      dataPagamento,        // YYYY-MM-DD (opcional: omitir = paga hoje)
      dataVencimento,       // YYYY-MM-DD (vencimento real do boleto — obrigatório na Inter)
      cpfCnpjBeneficiario,  // opcional — validação extra na Inter
      favorecidoNome,
      historico,
      contaId,
    } = req.body || {};

    // ── Validação ────────────────────────────────────────────────────────────
    if (!codBarraLinhaDigitavel?.trim())
      return res.status(400).json({ message: "codBarraLinhaDigitavel é obrigatório" });

    const digits = codBarraLinhaDigitavel.replace(/\D/g, "");
    if (![44, 47, 48].includes(digits.length))
      return res.status(400).json({ message: "Código de barras ou linha digitável inválido (esperado 44, 47 ou 48 dígitos)" });

    if (!valorCentavos || Number(valorCentavos) <= 0)
      return res.status(400).json({ message: "valorCentavos deve ser > 0" });

    if (!dataVencimento)
      return res.status(400).json({ message: "dataVencimento é obrigatório (vencimento do boleto, YYYY-MM-DD)" });

    const valCents = parseInt(valorCentavos, 10);
    const cntId    = contaId ? parseInt(contaId, 10) : null;

    // ── Chamar Inter API ─────────────────────────────────────────────────────
    let interResp;
    try {
      interResp = await pagarBoleto({
        codBarraLinhaDigitavel: codBarraLinhaDigitavel.trim(),
        valorCentavos: valCents,
        dataPagamento:        dataPagamento       || undefined,
        dataVencimento,
        cpfCnpjBeneficiario:  cpfCnpjBeneficiario || undefined,
      });
    } catch (interErr) {
      // Horário bancário encerrado → sugere próximo dia útil
      const msg = interErr.message || "";
      console.error(`❌ [InterPag] Inter rejeitou:`, msg);

      // Horário bancário encerrado → agendar para próximo dia útil
      if (/hor[aá]rio.*transa[cç][aã]o.*excedido|hor[aá]rio.*encerrado/i.test(msg)) {
        const dataSugerida = proximoDiaUtil();
        return res.status(422).json({
          code:          "HORARIO_EXCEDIDO",
          message:       "O horário bancário para transações foi encerrado.",
          detail:        "Pagamentos imediatos não são mais aceitos hoje. Deseja agendar para o próximo dia útil?",
          dataSugerida,
        });
      }

      // Boleto vencido — API Inter não suporta; orientar uso do Internet Banking
      if (/data.*vencimento|campo.*inv[aá]lido.*vencimento|boleto.*vencido/i.test(msg)) {
        return res.status(422).json({
          code:    "BOLETO_VENCIDO",
          message: "Boleto vencido: pagamento via API não é suportado pelo Banco Inter.",
          detail:  "Para boletos vencidos, use o Internet Banking Inter ou o aplicativo. O banco permite o pagamento diretamente pelo canal web.",
        });
      }

      throw interErr;
    }

    const codigoTransacao = interResp.codigoTransacao || null;
    const statusInter     = interResp.status || "PROCESSANDO";

    // ── Persistir ────────────────────────────────────────────────────────────
    // dataPagamento é opcional (omitido = pagamento imediato hoje). Para persistência,
    // usamos hoje em BRT como fallback.
    const _nowBRT  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Belem" }));
    const _todayBRT = `${_nowBRT.getFullYear()}-${String(_nowBRT.getMonth() + 1).padStart(2, "0")}-${String(_nowBRT.getDate()).padStart(2, "0")}`;
    const dataPagStr = dataPagamento || _todayBRT;

    const pagamento = await prisma.pagamentoBoleto.create({
      data: {
        codigoTransacao,
        codBarraLinhaDigitavel: codBarraLinhaDigitavel.trim(),
        valorCentavos:  valCents,
        dataPagamento:  new Date(dataPagStr + "T12:00:00Z"),
        dataVencimento: dataVencimento ? new Date(dataVencimento + "T12:00:00Z") : null,
        favorecidoNome: favorecidoNome?.trim() || null,
        historico:      historico?.trim()      || null,
        status:         INTER_MODE === "mock" ? "MOCK" : statusInter,
        tipoOperacao:   "BOLETO",
        contaId:        cntId,
        usuarioId:      req.user.id,
      },
    });

    // ── Lançamento no Livro Caixa (saída) ────────────────────────────────────
    if (cntId) {
      const hoje     = new Date();
      const pagData  = new Date(dataPagStr + "T12:00:00Z");
      // Qualquer pagamento aceito pelo Inter (imediato ou agendado) → EFETIVADO
      // O banco já comprometeu a saída; só MOCK fica PREVISTO
      const efetivado = pagamento.status !== "MOCK";

      await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno:    pagData.getUTCFullYear(),
          competenciaMes:    pagData.getUTCMonth() + 1,
          data:              pagData,
          es:                "S",
          clienteFornecedor: favorecidoNome?.trim() || "Pagamento boleto",
          historico:         historico?.trim() || `Pagamento boleto ${fmtBRL(valCents)}`,
          valorCentavos:     valCents,
          contaId:           cntId,
          origem:            "MANUAL",
          referenciaOrigem:  `PAG_BOLETO_${pagamento.id}`,
          status:            "OK",
          statusFluxo:       efetivado ? "EFETIVADO" : "PREVISTO",
        },
      }).catch((e) => console.error("⚠️ LC pagamento boleto não criado:", e.message));
    }

    console.log(`✅ [InterPag] pagar #${pagamento.id}: ${fmtBRL(valCents)} → ${pagamento.status}`);
    res.json({ pagamento });
  } catch (err) {
    console.error("❌ POST /api/inter/pagamentos/pagar:", err.message);
    res.status(500).json({ message: err.message || "Erro ao realizar pagamento" });
  }
});

// ── GET /api/inter/beneficiarios?q= ──────────────────────────────────────────
// Autocomplete: combina tabela Cliente + clienteFornecedor distintos do LC.

router.get("/api/inter/beneficiarios", authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json([]);

    const [clientes, lc] = await Promise.all([
      // Clientes/fornecedores cadastrados
      prisma.cliente.findMany({
        where: {
          ativo: true,
          nomeRazaoSocial: { contains: q, mode: "insensitive" },
        },
        select: { id: true, nomeRazaoSocial: true, tipo: true },
        orderBy: { nomeRazaoSocial: "asc" },
        take: 15,
      }),
      // Nomes distintos do Livro Caixa (saídas — favorecidos reais)
      prisma.livroCaixaLancamento.findMany({
        where: {
          es: "S",
          clienteFornecedor: { contains: q, mode: "insensitive" },
        },
        select: { clienteFornecedor: true },
        distinct: ["clienteFornecedor"],
        orderBy: { clienteFornecedor: "asc" },
        take: 15,
      }),
    ]);

    // Nomes dos clientes cadastrados
    const cadastrados = clientes.map((c) => ({
      nome: c.nomeRazaoSocial,
      tipo: c.tipo === "C" ? "Cliente" : c.tipo === "F" ? "Fornecedor" : "Ambos",
      fonte: "cadastro",
    }));

    // Nomes do LC que não estão já nos cadastrados
    const nomesJa = new Set(cadastrados.map((c) => c.nome.toLowerCase()));
    const doLC = lc
      .map((l) => l.clienteFornecedor)
      .filter((n) => n && !nomesJa.has(n.toLowerCase()))
      .map((nome) => ({ nome, tipo: null, fonte: "lc" }));

    res.json([...cadastrados, ...doLC].slice(0, 20));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/inter/pagamentos ─────────────────────────────────────────────────

router.get("/api/inter/pagamentos", authenticate, requireAdmin, async (req, res) => {
  try {
    const { status, de, ate, q, page = "1", limit = "20" } = req.query;

    const where = {};
    if (status) where.status = status;
    if (q)      where.OR = [
      { favorecidoNome: { contains: q, mode: "insensitive" } },
      { historico:      { contains: q, mode: "insensitive" } },
    ];
    if (de || ate) {
      where.dataPagamento = {};
      if (de)  where.dataPagamento.gte = new Date(de  + "T00:00:00Z");
      if (ate) where.dataPagamento.lte = new Date(ate + "T23:59:59Z");
    }

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const [total, pagamentos] = await Promise.all([
      prisma.pagamentoBoleto.count({ where }),
      prisma.pagamentoBoleto.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (pageNum - 1) * limitNum,
        take:    limitNum,
      }),
    ]);

    res.json({ pagamentos, total, pages: Math.ceil(total / limitNum), page: pageNum });
  } catch (err) {
    console.error("❌ GET /api/inter/pagamentos:", err.message);
    res.status(500).json({ message: "Erro ao listar pagamentos" });
  }
});

// ── GET /api/inter/pagamentos/:id ─────────────────────────────────────────────

router.get("/api/inter/pagamentos/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const pagamento = await prisma.pagamentoBoleto.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!pagamento) return res.status(404).json({ message: "Pagamento não encontrado" });
    res.json({ pagamento });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/inter/pagamentos/:id/cancelar ─────────────────────────────────

router.delete("/api/inter/pagamentos/:id/cancelar", authenticate, requireAdmin, async (req, res) => {
  try {
    const pagamento = await prisma.pagamentoBoleto.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!pagamento) return res.status(404).json({ message: "Pagamento não encontrado" });

    if (!["PROCESSANDO", "AGENDADO"].includes(pagamento.status)) {
      return res.status(400).json({ message: `Pagamento com status ${pagamento.status} não pode ser cancelado` });
    }

    if (pagamento.status !== "MOCK" && pagamento.codigoTransacao) {
      try {
        await cancelarPagamentoInter(pagamento.codigoTransacao);
      } catch (e) {
        if (!/CANCELADO/i.test(e.message)) throw e;
      }
    }

    const updated = await prisma.pagamentoBoleto.update({
      where: { id: pagamento.id },
      data:  { status: "CANCELADO", updatedAt: new Date() },
    });

    // Cancela LC associada
    await prisma.livroCaixaLancamento.updateMany({
      where: { referenciaOrigem: `PAG_BOLETO_${pagamento.id}`, statusFluxo: "PREVISTO" },
      data:  { statusFluxo: "CANCELADO" },
    }).catch(() => {});

    res.json({ pagamento: updated });
  } catch (err) {
    console.error("❌ DELETE /api/inter/pagamentos/:id/cancelar:", err.message);
    res.status(500).json({ message: err.message || "Erro ao cancelar pagamento" });
  }
});

// ── POST /api/inter/pagamentos/darf ──────────────────────────────────────────

router.post("/api/inter/pagamentos/darf", authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      cnpjCpf, codigoReceita, dataVencimento, periodoApuracao,
      descricao, nomeEmpresa, referencia, telefoneEmpresa,
      valorPrincipalCents, valorJurosCents, valorMultaCents,
      historico, contaId,
    } = req.body || {};

    // ── Validação ────────────────────────────────────────────────────────────
    if (!cnpjCpf?.trim())
      return res.status(400).json({ message: "cnpjCpf é obrigatório" });
    const cpfCnpjDigits = cnpjCpf.replace(/\D/g, "");
    if (![11, 14].includes(cpfCnpjDigits.length))
      return res.status(400).json({ message: "CNPJ deve ter 14 dígitos ou CPF 11 dígitos" });

    if (!codigoReceita?.trim() || codigoReceita.trim().length !== 4)
      return res.status(400).json({ message: "codigoReceita deve ter exatamente 4 dígitos" });

    if (!dataVencimento)
      return res.status(400).json({ message: "dataVencimento é obrigatório (YYYY-MM-DD)" });

    if (!periodoApuracao)
      return res.status(400).json({ message: "periodoApuracao é obrigatório (YYYY-MM-DD)" });

    if (!nomeEmpresa?.trim())
      return res.status(400).json({ message: "nomeEmpresa é obrigatório" });

    if (!referencia?.trim() || !/^\d+$/.test(referencia.trim()) || referencia.trim().length > 30)
      return res.status(400).json({ message: "referencia é obrigatória, somente dígitos, até 30 caracteres" });

    if (!valorPrincipalCents || Number(valorPrincipalCents) <= 0)
      return res.status(400).json({ message: "valorPrincipal deve ser > 0" });

    const cntId   = contaId ? parseInt(contaId, 10) : null;
    const vPrinc  = parseInt(valorPrincipalCents, 10);
    const vJuros  = parseInt(valorJurosCents  || 0, 10);
    const vMulta  = parseInt(valorMultaCents  || 0, 10);
    const vTotal  = vPrinc + vJuros + vMulta;

    // ── Chamar Inter API ─────────────────────────────────────────────────────
    let interResp;
    try {
      interResp = await pagarDarf({
        cnpjCpf: cnpjCpf.trim(),
        codigoReceita: codigoReceita.trim(),
        dataVencimento,
        periodoApuracao,
        descricao: descricao?.trim() || historico?.trim() || "Pagamento DARF",
        nomeEmpresa: nomeEmpresa.trim(),
        referencia: referencia.trim(),
        telefoneEmpresa: telefoneEmpresa?.trim() || undefined,
        valorPrincipalCents: vPrinc,
        valorJurosCents:     vJuros,
        valorMultaCents:     vMulta,
      });
    } catch (interErr) {
      console.error(`❌ [InterDarf] Inter rejeitou:`, interErr.message);
      throw interErr;
    }

    const codigoTransacao = interResp.codigoTransacao || null;
    const statusInter     = interResp.status || "PROCESSANDO";

    // ── Data de pagamento = hoje em BRT (DARF é sempre imediato) ────────────
    const _nowBRT   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Belem" }));
    const _todayBRT = `${_nowBRT.getFullYear()}-${String(_nowBRT.getMonth() + 1).padStart(2, "0")}-${String(_nowBRT.getDate()).padStart(2, "0")}`;
    const pagData   = new Date(_todayBRT + "T12:00:00Z");

    // ── Persistir ────────────────────────────────────────────────────────────
    const pagamento = await prisma.pagamentoDarf.create({
      data: {
        codigoTransacao,
        cnpjCpf:        cnpjCpf.trim(),
        codigoReceita:  codigoReceita.trim(),
        dataPagamento:  pagData,
        dataVencimento: new Date(dataVencimento  + "T12:00:00Z"),
        periodoApuracao: new Date(periodoApuracao + "T12:00:00Z"),
        descricao:      descricao?.trim() || null,
        nomeEmpresa:    nomeEmpresa.trim(),
        telefoneEmpresa: telefoneEmpresa?.trim() || null,
        referencia:     referencia.trim(),
        valorPrincipal: vPrinc,
        valorJuros:     vJuros,
        valorMulta:     vMulta,
        status:         INTER_MODE === "mock" ? "MOCK" : statusInter,
        historico:      historico?.trim() || null,
        contaId:        cntId,
        usuarioId:      req.user.id,
      },
    });

    // ── Lançamento no Livro Caixa (saída) ────────────────────────────────────
    if (cntId) {
      await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno:    pagData.getUTCFullYear(),
          competenciaMes:    pagData.getUTCMonth() + 1,
          data:              pagData,
          es:                "S",
          clienteFornecedor: nomeEmpresa.trim(),
          historico:         historico?.trim() || `DARF ${codigoReceita.trim()} ${fmtBRL(vTotal)}`,
          valorCentavos:     vTotal,
          contaId:           cntId,
          origem:            "MANUAL",
          referenciaOrigem:  `PAG_DARF_${pagamento.id}`,
          status:            "OK",
          statusFluxo:       pagamento.status !== "MOCK" ? "EFETIVADO" : "PREVISTO",
        },
      }).catch((e) => console.error("⚠️ LC DARF não criado:", e.message));
    }

    console.log(`✅ [InterDarf] darf #${pagamento.id}: ${fmtBRL(vTotal)} → ${pagamento.status}`);
    res.json({ pagamento });
  } catch (err) {
    console.error("❌ POST /api/inter/pagamentos/darf:", err.message);
    res.status(500).json({ message: err.message || "Erro ao realizar pagamento DARF" });
  }
});

// ── PATCH /api/inter/pagamentos/:id/confirmar ────────────────────────────────
// Marca boleto como REALIZADO e efetiva o lançamento no LC.

router.patch("/api/inter/pagamentos/:id/confirmar", authenticate, requireAdmin, async (req, res) => {
  try {
    const pagamento = await prisma.pagamentoBoleto.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!pagamento) return res.status(404).json({ message: "Pagamento não encontrado" });

    if (!["PROCESSANDO", "AGENDADO"].includes(pagamento.status)) {
      return res.status(400).json({ message: `Status ${pagamento.status} não pode ser confirmado` });
    }

    const updated = await prisma.pagamentoBoleto.update({
      where: { id: pagamento.id },
      data:  { status: "REALIZADO", updatedAt: new Date() },
    });

    await prisma.livroCaixaLancamento.updateMany({
      where: { referenciaOrigem: `PAG_BOLETO_${pagamento.id}` },
      data:  { statusFluxo: "EFETIVADO" },
    }).catch(() => {});

    console.log(`✅ [InterPag] confirmar #${pagamento.id}: REALIZADO`);
    res.json({ pagamento: updated });
  } catch (err) {
    console.error("❌ PATCH /api/inter/pagamentos/:id/confirmar:", err.message);
    res.status(500).json({ message: err.message || "Erro ao confirmar pagamento" });
  }
});

// ── GET /api/inter/pagamentos/darf ────────────────────────────────────────────

router.get("/api/inter/pagamentos/darf", authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const pageNum  = Math.max(1, parseInt(page,  10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const [total, pagamentos] = await Promise.all([
      prisma.pagamentoDarf.count(),
      prisma.pagamentoDarf.findMany({
        orderBy: { createdAt: "desc" },
        skip:    (pageNum - 1) * limitNum,
        take:    limitNum,
      }),
    ]);

    res.json({ pagamentos, total, pages: Math.ceil(total / limitNum), page: pageNum });
  } catch (err) {
    console.error("❌ GET /api/inter/pagamentos/darf:", err.message);
    res.status(500).json({ message: "Erro ao listar DARFs" });
  }
});

export default router;
