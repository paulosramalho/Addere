import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { gerarNumeroContratoComPrefixo, convertValueToDecimal } from "../lib/contratoHelpers.js";
import { enviarEmailNovoLancamentoAdvogados } from "../schedulers/vencimentos.js";

const router = Router();

// ── Helper local ──────────────────────────────────────────────────────────────

function parseDDMMYYYYToDate(s) {
  const str = String(s || "").trim();
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) return null;
  return dt;
}

// POST /api/pagamentos-avulsos
// Cria um contrato com 1 parcela já RECEBIDA (sem mexer em layout/telas existentes)
router.post("/api/pagamentos-avulsos", authenticate, async (req, res) => {
  try {
    const {
      clienteId,
      contaId,
      descricao,
      dataRecebimento,     // "DD/MM/AAAA"
      valorRecebido,       // "R$ 1.234,56" (ou qualquer máscara) - frontend manda assim
      meioRecebimento,     // "PIX" | ...
      isentoTributacao,
      modeloDistribuicaoId,
      advogadoPrincipalId,
      advogadoIndicacaoId,
      usaSplitSocio,
      splits,              // [{ advogadoId, percentual: "20,00" }, ...]
      lcExistenteId,       // opcional: ID de LC já existente → vincula ao invés de criar novo
    } = req.body || {};

    if (!clienteId) {
      return res.status(400).json({ message: "clienteId é obrigatório." });
    }
    if (!dataRecebimento) {
      return res.status(400).json({ message: "dataRecebimento é obrigatória (DD/MM/AAAA)." });
    }
    if (!valorRecebido) {
      return res.status(400).json({ message: "valorRecebido é obrigatório." });
    }

    if (!contaId) {
      return res.status(400).json({ message: "contaId é obrigatório." });
    }

    // Helpers já existem no seu server.js (você usa em contratos e retificação):
    // - parseDDMMYYYYToDate
    // - convertValueToDecimal
    const dt = parseDDMMYYYYToDate(String(dataRecebimento));
    if (!dt) {
      return res.status(400).json({ message: "dataRecebimento inválida (DD/MM/AAAA)." });
    }

    const valorDec = convertValueToDecimal(valorRecebido);
    if (!Number.isFinite(valorDec) || valorDec <= 0) {
      return res.status(400).json({ message: "valorRecebido inválido." });
    }

    // Converte splits percentuais "20,00" -> bp (2000)
    const splitsArr = Array.isArray(splits) ? splits : [];
    const splitsToCreate = splitsArr
      .filter((s) => s && s.advogadoId)
      .map((s) => {
        const raw = String(s.percentual || "")
          .replace("%", "")
          .trim()
          .replace(/\./g, "")
          .replace(",", ".");
        const n = Number(raw);
        const bp = Number.isFinite(n) ? Math.round(n * 100) : 0; // 20,00 -> 2000
        return { advogadoId: Number(s.advogadoId), percentualBp: bp };
      });

    // Se usaSplitSocio, exige splits
    if (usaSplitSocio) {
      if (!splitsToCreate.length) {
        return res.status(400).json({ message: "Quando usaSplitSocio=true, informe splits." });
      }
    }

    // ✅ Se o modelo de distribuição tiver INDICAÇÃO, exigir advogadoIndicacaoId
    if (modeloDistribuicaoId) {
      const itensModelo = await prisma.modeloDistribuicaoItem.findMany({
        where: { modeloId: Number(modeloDistribuicaoId) },
        select: { destinoTipo: true, destinatario: true, percentualBp: true },
      });

      const temIndicacao = (itensModelo || []).some((it) => {
        const a = String(it.destinoTipo || "").toUpperCase();
        const b = String(it.destinatario || "").toUpperCase();
        const c = String(it.destino || "").toUpperCase();
        const bp = Number(it.percentualBp) || 0;
        if (bp <= 0) return false;
        return (
          a === "INDICACAO" ||
          a === "INDICACAO_ADVOGADO" ||
          b === "INDICACAO" ||
          c === "INDICACAO"
        );
      });

      if (temIndicacao && !advogadoIndicacaoId) {
        return res.status(400).json({ message: "Quando o modelo tem Indicação, informe advogadoIndicacaoId." });
      }
    }

    const numeroContrato = await gerarNumeroContratoComPrefixo(dt, "AV-");

    // Buscar nome do cliente para o Livro Caixa
    const cliente = await prisma.cliente.findUnique({
      where: { id: Number(clienteId) },
      select: { nomeRazaoSocial: true },
    });

    // Cria contrato + 1 parcela recebida
    const created = await prisma.contratoPagamento.create({
      data: {
        clienteId: Number(clienteId),
        observacoes: String(descricao || "").trim() || "Recebimento avulso",
        formaPagamento: "AVISTA",
        valorTotal: valorDec,
        numeroContrato: numeroContrato,

        isentoTributacao: !!isentoTributacao,
        modeloDistribuicaoId: modeloDistribuicaoId ? Number(modeloDistribuicaoId) : null,
        repasseAdvogadoPrincipalId: advogadoPrincipalId ? Number(advogadoPrincipalId) : null,
        repasseIndicacaoAdvogadoId: advogadoIndicacaoId ? Number(advogadoIndicacaoId) : null,
        usaSplitSocio: !!usaSplitSocio,

        // Splits (se houver)
        ...(splitsToCreate.length
          ? { splits: { createMany: { data: splitsToCreate } } }
          : {}),

        // Parcela única já recebida
        parcelas: {
          create: {
            numero: 1,
            vencimento: dt,
            status: "RECEBIDA",
            valorPrevisto: valorDec,
            valorRecebido: valorDec,
            dataRecebimento: dt,
            meioRecebimento: String(meioRecebimento || "PIX"),
          },
        },
      },
      include: {
        parcelas: true,
        splits: true,
      },
    });

    // ✅ Criar ou vincular lançamento no Livro Caixa
    const parcela = created.parcelas?.[0];
    const competenciaAno = dt.getFullYear();
    const competenciaMes = dt.getMonth() + 1;
    const valorCentavos = Math.round(valorDec * 100);

    let livroCaixaLancamento;
    const lcIdNum = lcExistenteId ? Number(lcExistenteId) : null;

    if (lcIdNum) {
      // Vincula LC existente ao novo contrato (sem criar duplicata)
      livroCaixaLancamento = await prisma.livroCaixaLancamento.update({
        where: { id: lcIdNum },
        data: {
          clienteFornecedor: cliente?.nomeRazaoSocial || null,
          historico: String(descricao || "").trim() || `Pagamento referente contrato ${numeroContrato}`,
          origem: "PAGAMENTO_RECEBIDO",
          referenciaOrigem: parcela ? `PARCELA_${parcela.id}` : null,
        },
      });
    } else {
      livroCaixaLancamento = await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno,
          competenciaMes,
          data: dt,
          documento: null,
          es: "E",
          clienteFornecedor: cliente?.nomeRazaoSocial || null,
          historico: String(descricao || "").trim() || `Pagamento referente contrato ${numeroContrato}`,
          valorCentavos,
          contaId: Number(contaId),
          ordemDia: 0,
          origem: "PAGAMENTO_RECEBIDO",
          status: "OK",
          statusFluxo: "EFETIVADO",
          referenciaOrigem: parcela ? `PARCELA_${parcela.id}` : null,
        },
      });
    }

    // ✅ retorno compatível com o front (contratoId / parcelaId)
    const parcelaCriada = created.parcelas?.[0] || null;

    // Notificar advogados com participação (fire-and-forget)
    if (parcelaCriada?.id) {
      enviarEmailNovoLancamentoAdvogados(parcelaCriada.id, {
        data: dt,
        clienteFornecedor: cliente?.nomeRazaoSocial || null,
        historico: String(descricao || "").trim() || `Pagamento referente contrato ${created.numeroContrato}`,
        valorCentavos,
        competenciaAno,
        competenciaMes,
      }).catch(() => {});
    }

    return res.status(201).json({
      ok: true,
      tipo: "PAGAMENTO_AVULSO",

      // ✅ o que o utilitário precisa para vincular
      contratoId: created.id,
      parcelaId: parcelaCriada?.id || null,
      numeroContrato: created.numeroContrato,

      // ✅ também devolve em formato "aninhado" (se o front quiser usar resp.contrato.id etc.)
      contrato: { id: created.id, numeroContrato: created.numeroContrato },
      parcela: parcela ? { id: parcela.id } : null,

      // ✅ mantém o payload antigo para não quebrar outras telas
      ...created,

      livroCaixaLancamentoId: livroCaixaLancamento.id,
    });

  } catch (e) {
    console.error("Prisma error message:", e?.message);
    console.error("Prisma meta:", e?.meta);
    return res.status(500).json({ message: "Erro ao criar pagamento avulso." });
  }
});

// GET /api/pagamentos-avulsos?ano=2026&mes=2
router.get("/api/pagamentos-avulsos", authenticate, async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);
    if (!ano || !mes) return res.status(400).json({ message: "Informe ano e mes." });

    const inicio = new Date(ano, mes - 1, 1);
    const fim = new Date(ano, mes, 1);

    const rows = await prisma.contratoPagamento.findMany({
      where: {
        parcelas: {
          some: {
            dataRecebimento: { gte: inicio, lt: fim },
          },
        },
      },
      include: {
        cliente: true,
        parcelas: { orderBy: { numero: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const mapped = rows.map((c) => {
      const p = c.parcelas?.[0] || null;
      return {
        contratoId: c.id,
        numeroContrato: c.numeroContrato,
        clienteId: c.clienteId,
        clienteNome: c.cliente?.nomeRazaoSocial || null,
        parcelaId: p?.id || null,
        dataRecebimentoISO: p?.dataRecebimento ? p.dataRecebimento.toISOString().slice(0, 10) : null,
        valorRecebido: p?.valorRecebido ?? null,
        valorRecebidoCentavos:
          p?.valorRecebido != null ? Math.round(Number(p.valorRecebido) * 100) : null,
      };
    });

    return res.json(mapped);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Falha ao listar pagamentos avulsos." });
  }
});

export default router;
