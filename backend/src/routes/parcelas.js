import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { logAuditoria } from "../lib/audit.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppTemplate, _waPhone } from "../lib/whatsapp.js";
import { syncParcelaComLivroCaixa, toCentsFromDecimal } from "../lib/livroCaixaSync.js";
import { parseDateDDMMYYYY, formatDateBR } from "../lib/contratoHelpers.js";
import {
  _dispararAvisoImediatoParcelas,
  buildEmailRecebimentoCliente,
} from "../schedulers/vencimentos.js";

const router = Router();

// ── GET /api/parcelas — busca para emissão de boleto ─────────────────────────
// Suporta: ?q=texto (cliente ou contrato), ?status=PREVISTA, ?limit=10

router.get("/api/parcelas", authenticate, async (req, res) => {
  try {
    const { q, status, limit = 10 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { contrato: { cliente: { nomeRazaoSocial: { contains: q, mode: "insensitive" } } } },
        { contrato: { numeroContrato: { contains: q, mode: "insensitive" } } },
        { contrato: { cliente: { cpfCnpj: { contains: q, mode: "insensitive" } } } },
      ];
    }
    const parcelas = await prisma.parcelaContrato.findMany({
      where,
      take: Number(limit),
      orderBy: { vencimento: "asc" },
      include: {
        contrato: {
          select: {
            numeroContrato: true,
            cliente: { select: { id: true, nomeRazaoSocial: true, cpfCnpj: true, email: true, telefone: true } },
          },
        },
      },
    });
    res.json({ parcelas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ── Confirmar recebimento de parcela ─────────────────────────────────────────
router.patch("/api/parcelas/:id/confirmar", authenticate, requireAdmin, async (req, res) => {
  try {
    const parcelaId = Number(req.params.id);
    if (!parcelaId || Number.isNaN(parcelaId)) {
      return res.status(400).json({ message: "ID da parcela inválido." });
    }

    const { dataRecebimento, meioRecebimento, valorRecebido, contaId } = req.body || {};

    const dt = parseDDMMYYYYToDate(dataRecebimento);
    if (!dt) {
      return res.status(400).json({ message: "Data de recebimento inválida (DD/MM/AAAA)." });
    }

    const cents = Number(String(valorRecebido || "0").replace(/\D/g, ""));
    if (!cents || cents <= 0) {
      return res.status(400).json({ message: "Informe o valor recebido." });
    }

    const contaIdNum = Number(contaId);
    if (!contaIdNum || Number.isNaN(contaIdNum)) {
      return res.status(400).json({ message: "contaId é obrigatório para receber parcela." });
    }

    // (opcional, mas recomendo) valida se a conta existe
    const contaExiste = await prisma.livroCaixaConta.findUnique({
      where: { id: contaIdNum },
      select: { id: true, ativa: true },
    });
    if (!contaExiste) {
      return res.status(400).json({ message: "contaId inválido (conta não encontrada)." });
    }
    if (contaExiste.ativa === false) {
      return res.status(400).json({ message: "Conta inativa. Selecione outra conta." });
    }

    const valorRecebidoDecimal = Number((cents / 100).toFixed(2));

    const parcela = await prisma.parcelaContrato.findUnique({
      where: { id: parcelaId },
      select: { id: true, status: true },
    });

    if (!parcela) {
      return res.status(404).json({ message: "Parcela não encontrada." });
    }

    // ✅ Atualizar em transação
    await prisma.$transaction(async (tx) => {
      // 1. Atualizar parcela
      const parcelaAtualizada = await tx.parcelaContrato.update({
        where: { id: parcelaId },
        data: {
          status: "RECEBIDA",
          dataRecebimento: dt,
          meioRecebimento: String(meioRecebimento || "PIX"),
          valorRecebido: valorRecebidoDecimal,
          cancelamentoMotivo: null,
          canceladaEm: null,
          canceladaPorId: null,
        }
      });

      // 2. SINCRONIZAR COM LIVRO CAIXA
      await syncParcelaComLivroCaixa(tx, parcelaAtualizada, 'PAGAR');

      // 3. Atualizar contaId no lançamento
      await tx.livroCaixaLancamento.updateMany({
        where: {
          origem: 'PARCELA_PREVISTA',
          referenciaOrigem: String(parcelaId),
        },
        data: {
          contaId: contaIdNum,
        },
      });

      console.log(`✅ Parcela ${parcelaId} paga e sincronizada`);
    });

    logAuditoria(req, "CONFIRMAR_PARCELA", "ParcelaContrato", parcelaId,
      { status: parcela.status },
      { status: "RECEBIDA", dataRecebimento, meioRecebimento, valorRecebido: valorRecebidoDecimal }
    ).catch(() => {});

    // WhatsApp — pagamento_confirmado para cliente
    prisma.parcelaContrato.findUnique({
      where: { id: parcelaId },
      include: {
        contrato: {
          include: {
            cliente: { select: { nomeRazaoSocial: true, telefone: true } },
          },
        },
      },
    }).then(async (p) => {
      if (!p) return;
      const fmtVal = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
      const clienteNome = p.contrato?.cliente?.nomeRazaoSocial || "";
      const valor = fmtVal(valorRecebidoDecimal);
      const numContrato = p.contrato?.numeroContrato || "";

      // → Cliente
      const phoneCliente = _waPhone(p.contrato?.cliente?.telefone);
      if (phoneCliente) {
        sendWhatsAppTemplate(phoneCliente, "cliente_pagamento_confirmado", "pt_BR", [{
          type: "body",
          parameters: [
            { type: "text", text: clienteNome },
            { type: "text", text: valor },
            { type: "text", text: numContrato },
          ],
        }]).catch(() => {});
      }

    }).catch(() => {});

    // E-mail de confirmação ao cliente (fire-and-forget)
    prisma.parcelaContrato.findUnique({
      where: { id: parcelaId },
      include: {
        contrato: {
          select: {
            numeroContrato: true,
            cliente: { select: { nomeRazaoSocial: true, email: true, naoEnviarEmails: true } },
          },
        },
      },
    }).then(async (p) => {
      const c = p?.contrato?.cliente;
      if (!c?.email || c.naoEnviarEmails) return;
      await sendEmail({
        to: c.email,
        subject: `✅ Pagamento recebido — Addere`,
        html: buildEmailRecebimentoCliente(c.nomeRazaoSocial, {
          numeroContrato: p.contrato?.numeroContrato,
          numeroParcela: p.numero,
          dataRecebimento,
          valorRecebido: valorRecebidoDecimal,
          meioRecebimento: String(meioRecebimento || "PIX"),
        }),
      });
    }).catch(() => {});

    return res.json({ message: "Recebimento confirmado.", parcela: { id: parcelaId, status: "RECEBIDA" } });
  } catch (error) {
    console.error("❌ Erro ao confirmar recebimento da parcela:", error);
    return res.status(500).json({
      message: error?.message ? `Erro ao confirmar recebimento: ${error.message}` : "Erro ao confirmar recebimento.",
    });
  }
});

// ── Corrigir data de recebimento (admin — parcelas já RECEBIDA com data incorreta) ──
router.patch("/api/parcelas/:id/corrigir-data", authenticate, requireAdmin, async (req, res) => {
  try {
    const parcelaId = Number(req.params.id);
    if (!parcelaId || Number.isNaN(parcelaId)) {
      return res.status(400).json({ message: "ID da parcela inválido." });
    }

    const dt = parseDDMMYYYYToDate(req.body?.dataRecebimento);
    if (!dt) {
      return res.status(400).json({ message: "dataRecebimento inválida (DD/MM/AAAA)." });
    }

    const parcela = await prisma.parcelaContrato.findUnique({
      where: { id: parcelaId },
      select: { id: true, status: true },
    });
    if (!parcela) return res.status(404).json({ message: "Parcela não encontrada." });
    if (parcela.status !== "RECEBIDA" && parcela.status !== "REPASSE_EFETUADO") {
      return res.status(400).json({ message: "Parcela não está RECEBIDA. Use a confirmação normal." });
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.parcelaContrato.update({
        where: { id: parcelaId },
        data: { dataRecebimento: dt },
      });
      await syncParcelaComLivroCaixa(tx, updated, "PAGAR");
    });

    return res.json({ ok: true, message: "Data de recebimento corrigida." });
  } catch (e) {
    console.error("PATCH /parcelas/:id/corrigir-data:", e.message);
    return res.status(500).json({ message: e.message });
  }
});

// ── Cancelar parcela ──────────────────────────────────────────────────────────
router.patch("/api/parcelas/:id/cancelar", authenticate, requireAdmin, async (req, res) => {
  try {
    const parcelaId = Number(req.params.id);
    if (!parcelaId || Number.isNaN(parcelaId)) {
      return res.status(400).json({ message: "ID da parcela inválido." });
    }

    const motivo = String(req.body?.motivo || "").trim();
    if (!motivo) {
      return res.status(400).json({ message: "Motivo do cancelamento é obrigatório." });
    }

    const parcela = await prisma.parcelaContrato.findUnique({
      where: { id: parcelaId },
      select: { id: true, status: true },
    });

    if (!parcela) {
      return res.status(404).json({ message: "Parcela não encontrada." });
    }

    const updated = await prisma.parcelaContrato.update({
      where: { id: parcelaId },
      data: {
        status: "CANCELADA",
        cancelamentoMotivo: motivo,
      },
    });

    logAuditoria(req, "CANCELAR_PARCELA", "ParcelaContrato", parcelaId,
      { status: parcela.status },
      { status: "CANCELADA", motivo }
    ).catch(() => {});

    return res.json({ message: "Parcela cancelada.", parcela: updated });
  } catch (error) {
    console.error("❌ Erro ao cancelar parcela:", error);
    return res.status(500).json({ message: "Erro ao cancelar parcela.", error: error.message });
  }
});

// ── Retificar parcela (vencimento e/ou valorPrevisto), mantendo o total do contrato ──
router.post("/api/parcelas/:id/retificar", authenticate, requireAdmin, async (req, res) => {
  try {
    const parcelaId = Number(req.params.id);
    if (!parcelaId || Number.isNaN(parcelaId)) {
      return res.status(400).json({ message: "ID da parcela inválido." });
    }

    const { motivo, patch, ratearEntreDemais, valoresOutrasParcelas } = req.body || {};
    const motivoTxt = String(motivo || "").trim();
    if (!motivoTxt) {
      return res.status(400).json({ message: "Informe o motivo da retificação." });
    }

    const patchObj = patch && typeof patch === "object" ? patch : {};
    const querVenc = patchObj.vencimento !== undefined && String(patchObj.vencimento || "").trim() !== "";
    const querValor = patchObj.valorPrevisto !== undefined && String(patchObj.valorPrevisto || "").trim() !== "";

    if (!querVenc && !querValor) {
      return res.status(400).json({ message: "Nada para retificar." });
    }

    // Buscar parcela + contrato + parcelas
    const parcela = await prisma.parcelaContrato.findUnique({
      where: { id: parcelaId },
      include: {
        contrato: {
          include: {
            parcelas: { orderBy: { numero: "asc" } },
          },
        },
      },
    });

    if (!parcela) {
      return res.status(404).json({ message: "Parcela não encontrada." });
    }

    // Não permitir retificar parcela já recebida/cancelada
    if (parcela.status === "RECEBIDA" || parcela.status === "CANCELADA") {
      return res.status(400).json({ message: "Não é permitido retificar parcela RECEBIDA ou CANCELADA." });
    }

    const contrato = parcela.contrato;

    // Helpers

    const toDecimalFromDigitsCents = (digits) => {
      const cents = Number(String(digits || "0").replace(/\D/g, "")) || 0;
      return Number((cents / 100).toFixed(2));
    };

    // Soma antes (considera parcelas não canceladas)
    const parcelasAtivas = (contrato.parcelas || []).filter((p) => p.status !== "CANCELADA");
    const somaAntes = parcelasAtivas.reduce((acc, p) => acc + toCentsFromDecimal(p.valorPrevisto), 0);

    // Construir updates
    const updates = [];

    // (1) Atualiza vencimento se vier
    let vencDate = null;
    if (querVenc) {
      vencDate = parseDDMMYYYYToDate(patchObj.vencimento);
      if (!vencDate) {
        return res.status(400).json({ message: "Vencimento inválido (DD/MM/AAAA)." });
      }
    }

    // (2) Atualiza valorPrevisto se vier
    let novoValorDecimal = null;
    let deltaCents = 0;
    if (querValor) {
      novoValorDecimal = toDecimalFromDigitsCents(patchObj.valorPrevisto);
      const atualCents = toCentsFromDecimal(parcela.valorPrevisto);
      const novoCents = Math.round(novoValorDecimal * 100);
      deltaCents = novoCents - atualCents;
    }

    // Retificação: parcela alvo
    updates.push({
      id: parcelaId,
      data: {
        ...(querVenc ? { vencimento: vencDate } : {}),
        ...(querValor ? { valorPrevisto: novoValorDecimal } : {}),
      },
    });

    // Se alterou valor, precisa compensar nas demais para manter total
    if (querValor && deltaCents !== 0) {
      const outrasPrevistas = (contrato.parcelas || [])
        .filter((p) => p.id !== parcelaId && p.status !== "CANCELADA" && p.status !== "RECEBIDA")
        .sort((a, b) => (a.numero || 0) - (b.numero || 0));

      if (!outrasPrevistas.length) {
        return res.status(400).json({ message: "Não há outras parcelas elegíveis para compensação." });
      }

      if (ratearEntreDemais) {
        // Rateio real: distribui a compensação igualmente entre TODAS as outras parcelas previstas.
        // A diferença que sobrar (resto da divisão em centavos) é absorvida pela primeira parcela.
        const N = outrasPrevistas.length;
        const totalToRedistribute = -deltaCents; // sinal oposto ao delta do alvo
        const baseShare = Math.trunc(totalToRedistribute / N); // Math.trunc para lidar com sinais negativos
        const remainder = totalToRedistribute - baseShare * N;

        // Pré-validação: nenhuma parcela pode virar <= 0 após o ajuste
        for (let i = 0; i < N; i++) {
          const p = outrasPrevistas[i];
          const before = toCentsFromDecimal(p.valorPrevisto);
          const adjustment = baseShare + (i === 0 ? remainder : 0);
          const after = before + adjustment;
          if (after <= 0) {
            return res.status(400).json({
              message: `A compensação tornaria a parcela ${p.numero} <= 0. Ajuste manualmente ou renegocie.`,
            });
          }
        }

        // Aplica os ajustes
        for (let i = 0; i < N; i++) {
          const p = outrasPrevistas[i];
          const before = toCentsFromDecimal(p.valorPrevisto);
          const adjustment = baseShare + (i === 0 ? remainder : 0);
          const after = before + adjustment;
          updates.push({
            id: p.id,
            data: { valorPrevisto: Number((after / 100).toFixed(2)) },
          });
        }
      } else {
        // Modo manual: recebe mapa { [parcelaId]: "centavosDigits" }
        const mapa = valoresOutrasParcelas && typeof valoresOutrasParcelas === "object" ? valoresOutrasParcelas : null;
        if (!mapa) {
          return res.status(400).json({
            message: "Informe os valores das demais parcelas para retificação manual.",
          });
        }

        for (const p of outrasPrevistas) {
          const digits = mapa[p.id];
          if (digits === undefined) continue; // se não veio, mantém
          const dec = toDecimalFromDigitsCents(digits);
          updates.push({ id: p.id, data: { valorPrevisto: dec } });
        }
      }
    }

    // Executar em transação + escrever observações
    const result = await prisma.$transaction(async (tx) => {
      // Atualiza parcelas
      for (const u of updates) {
        await tx.parcelaContrato.update({
          where: { id: u.id },
          data: u.data,
        });
      }

      // Recalcula soma depois
      const parcelasDepois = await tx.parcelaContrato.findMany({
        where: { contratoId: contrato.id },
      });

      const ativasDepois = parcelasDepois.filter((p) => p.status !== "CANCELADA");
      const somaDepois = ativasDepois.reduce((acc, p) => acc + toCentsFromDecimal(p.valorPrevisto), 0);

      if (somaDepois !== somaAntes) {
        throw new Error("Soma das parcelas não fecha com o total do contrato após a retificação.");
      }

      // Log no campo observacoes do contrato (não cria colunas novas)
      const stamp = formatDateBR(new Date());
      const obsAtual = String(contrato.observacoes || "");
      const novaLinha = `[RETIFICAÇÃO ${stamp}] ${motivoTxt}`;
      const obsNova = obsAtual ? `${obsAtual}\n${novaLinha}` : novaLinha;

      await tx.contratoPagamento.update({
        where: { id: contrato.id },
        data: { observacoes: obsNova },
      });

      // ============================================================
      // SINCRONIZAR PARCELAS RETIFICADAS COM LIVRO CAIXA
      // ============================================================
      console.log(`📋 Retificação: Sincronizando ${updates.length} parcela(s) com Livro Caixa`);

      // Buscar parcelas atualizadas com dados completos
      const parcelasRetificadas = await tx.parcelaContrato.findMany({
        where: {
          id: { in: updates.map(u => u.id) },
        },
      });

      // Sincronizar cada parcela retificada
      for (const parcela of parcelasRetificadas) {
        await syncParcelaComLivroCaixa(tx, parcela, 'ATUALIZAR', {
          motivoRetificacao: motivoTxt,
        });
      }

      console.log(`✅ ${parcelasRetificadas.length} parcela(s) retificada(s) e sincronizada(s)`);

      return parcela;
    });

    logAuditoria(req, "RETIFICAR_PARCELA", "ParcelaContrato", parcelaId,
      { status: parcela.status, vencimento: parcela.vencimento, valorPrevisto: parcela.valorPrevisto },
      { patch, motivo: motivoTxt }
    ).catch(() => {});

    res.json({ ok: true, parcela: result });
  } catch (e) {
    console.error("Erro ao retificar parcela:", e);
    res.status(e.message?.includes("não") ? 400 : 500).json({ message: e.message || "Erro ao retificar parcela." });
  }
});

export default router;
