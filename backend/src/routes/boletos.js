// backend/src/routes/boletos.js
// Boletos Inter — emissão, consulta, cancelamento e webhook

import { Router }                                   from "express";
import prisma                                       from "../lib/prisma.js";
import { authenticate, requireAdmin }               from "../lib/auth.js";
import { emitirBoleto, cancelarBoleto, alterarBoleto, resolverNossoNumero, INTER_MODE } from "../lib/interBoleto.js";
import { processarPosBoleto, notificarAlteracaoBoleto, notificarCancelamentoBoleto } from "../lib/boletoNotificacoes.js";
import {
  aplicarStatusBoleto,
  extrairEventosWebhookBoleto,
  sincronizarBoletoComInter,
} from "../lib/boletoSync.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Gera N° do Documento para o PDF do boleto.
 * Formato parcela : {ini}{nn}/{tt}Addere  ex: PSR01/03Addere  (11 chars)
 * Formato avulso  : {ini}{mm}/{yy}Addere  ex: PSR04/26Addere  (11 chars)
 * Máximo: 12 chars.
 */
function _gerarDocNum(nomeCliente, parcela, totalParcelas, dataVencimento) {
  // Iniciais: primeira letra de cada palavra, até 3
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

// ── POST /api/boletos/emitir ──────────────────────────────────────────────────
// Emite um boleto vinculado a parcela ou avulso.
// Body: { parcelaId?, clienteId?, valorCentavos?, dataVencimento?, descricao? }
// Se parcelaId informado, cliente/valor/vencimento são lidos da parcela.

router.post("/boletos/emitir", authenticate, async (req, res) => {
  try {
    const {
      parcelaId,
      clienteId,
      valorCentavos,
      dataVencimento,
      descricao,
      historico,
      multaPerc,
      moraPercMes,
      validadeDias,
    } = req.body;

    if (!historico || !String(historico).trim())
      return res.status(400).json({ error: "historico é obrigatório" });

    const multaFinal    = multaPerc   != null ? Number(multaPerc)   : 2;
    const moraFinal     = moraPercMes != null ? Number(moraPercMes) : 1;
    const validadeFinal = validadeDias != null
      ? Math.min(60, Math.max(1, Number(validadeDias)))
      : 30;

    let cliente      = null;
    let valorFinal   = valorCentavos ? Number(valorCentavos) : null;
    let vencFinal    = dataVencimento || null;
    let seuNumero    = descricao || null;
    let parcelaIdFinal = parcelaId ? Number(parcelaId) : null;

    let parcelaObj    = null;
    let totalParcelas = null;

    if (parcelaIdFinal) {
      // Vincular a parcela
      parcelaObj = await prisma.parcelaContrato.findUnique({
        where:   { id: parcelaIdFinal },
        include: { contrato: { include: { cliente: true } } },
      });
      if (!parcelaObj) return res.status(404).json({ error: "Parcela não encontrada" });

      cliente       = parcelaObj.contrato.cliente;
      valorFinal    = valorFinal ?? Math.round(Number(parcelaObj.valorPrevisto) * 100);
      vencFinal     = vencFinal  ?? parcelaObj.vencimento.toISOString().slice(0, 10);
      seuNumero     = seuNumero  ?? `ADD-P${parcelaIdFinal}`;
      totalParcelas = await prisma.parcelaContrato.count({
        where: { contratoId: parcelaObj.contratoId },
      });
    } else {
      // Avulso
      if (!clienteId)  return res.status(400).json({ error: "clienteId obrigatório" });
      if (!valorFinal) return res.status(400).json({ error: "valorCentavos obrigatório" });
      if (!vencFinal)  return res.status(400).json({ error: "dataVencimento obrigatório (YYYY-MM-DD)" });

      cliente   = await prisma.cliente.findUnique({ where: { id: Number(clienteId) } });
      if (!cliente) return res.status(404).json({ error: "Cliente não encontrado" });

      seuNumero = seuNumero ?? `ADD-${Date.now()}`;
    }

    const docNum = _gerarDocNum(
      cliente.nomeRazaoSocial,
      parcelaObj,
      totalParcelas,
      vencFinal,
    );

    const result = await emitirBoleto({
      seuNumero,
      valorCentavos: valorFinal,
      dataVencimento: vencFinal,
      multaPerc:   multaFinal,
      moraPercMes: moraFinal,
      pagador: {
        cpfCnpj:  cliente.cpfCnpj,
        nome:     cliente.nomeRazaoSocial,
        email:    cliente.email    || "",
        telefone: cliente.telefone || "",
        cep:      cliente.cep      || "",
        endereco: cliente.endereco || "",
        numero:   cliente.numero   || "",
        bairro:   cliente.bairro   || "",
        cidade:   cliente.cidade   || "",
        uf:       cliente.uf       || "",
      },
    });

    const boleto = await prisma.boletInter.create({
      data: {
        nossoNumero:        result.nossoNumero        ?? null,
        codigoSolicitacao:  result.codigoSolicitacao  ?? null,
        seuNumero:          result.seuNumero,
        valorCentavos:  valorFinal,
        dataVencimento: new Date(vencFinal),
        status:         "EMITIDO",
        codigoBarras:   result.codigoBarras   ?? null,
        linhaDigitavel: result.linhaDigitavel ?? null,
        pixCopiaECola:  result.pixCopiaECola  ?? null,
        qrCodeImagem:   result.qrCodeImagem   ?? null,
        parcelaId:      parcelaIdFinal        ?? null,
        clienteId:      cliente.id,
        pagadorNome:    cliente.nomeRazaoSocial,
        pagadorCpfCnpj: cliente.cpfCnpj,
        pagadorEmail:   cliente.email         ?? null,
        historico:      String(historico).trim(),
        multaPerc:      multaFinal,
        moraPercMes:    moraFinal,
        validadeDias:   validadeFinal,
        docNum,
        modo:           result.modo,
      },
    });

    // Se pendente (Inter v3 assíncrono): busca nossoNumero em background, depois processa PDF/Drive/WA
    if (result._pendente && result.codigoSolicitacao) {
      (async () => {
        const nossoNumero = await resolverNossoNumero(
          boleto.id, result.codigoSolicitacao, result.seuNumero, vencFinal
        );
        if (nossoNumero) processarPosBoleto(boleto.id).catch(() => {});
      })();
    } else {
      // Pós-processamento assíncrono (PDF, Drive, e-mail, WA) — não bloqueia resposta
      processarPosBoleto(boleto.id).catch(() => {});
    }

    res.json(boleto);
  } catch (err) {
    console.error("❌ [Boletos] emitir:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/boletos ──────────────────────────────────────────────────────────
// Lista boletos com paginação e filtros opcionais.

router.get("/boletos", authenticate, async (req, res) => {
  try {
    const { clienteId, parcelaId, status, q, vencDe, vencAte, page = 1, limit = 20 } = req.query;
    const where = {};
    if (clienteId) where.clienteId = Number(clienteId);
    if (parcelaId) where.parcelaId = Number(parcelaId);
    if (status)    where.status    = status;
    if (q)         where.pagadorNome = { contains: q, mode: "insensitive" };
    if (vencDe || vencAte) {
      where.dataVencimento = {};
      if (vencDe) where.dataVencimento.gte = new Date(vencDe);
      if (vencAte) where.dataVencimento.lte = new Date(vencAte + "T23:59:59Z");
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [boletos, total] = await Promise.all([
      prisma.boletInter.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
        include: {
          cliente: { select: { id: true, nomeRazaoSocial: true, cpfCnpj: true } },
          parcela: {
            select: {
              id:         true,
              numero:     true,
              vencimento: true,
              contratoId: true,
              contrato:   { select: { numeroContrato: true } },
            },
          },
        },
      }),
      prisma.boletInter.count({ where }),
    ]);

    res.json({
      boletos,
      total,
      page:  Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/boletos/config/modo ──────────────────────────────────────────────

router.get("/boletos/config/modo", authenticate, requireAdmin, (_req, res) => {
  res.json({ modo: INTER_MODE });
});

// ── GET /api/boletos/:id ──────────────────────────────────────────────────────

router.get("/boletos/:id", authenticate, async (req, res) => {
  try {
    const boleto = await prisma.boletInter.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        cliente: { select: { id: true, nomeRazaoSocial: true, cpfCnpj: true } },
        parcela: {
          select: {
            id:         true,
            numero:     true,
            vencimento: true,
            contratoId: true,
            contrato:   { select: { numeroContrato: true } },
          },
        },
      },
    });
    if (!boleto) return res.status(404).json({ error: "Boleto não encontrado" });
    res.json(boleto);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/boletos/:id ────────────────────────────────────────────────────
// Altera vencimento (e opcionalmente multa/mora) de um boleto EMITIDO.
// Body: { dataVencimento, multaPerc?, moraPercMes? }

router.patch("/boletos/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { dataVencimento, multaPerc, moraPercMes } = req.body || {};
    if (!dataVencimento) return res.status(400).json({ error: "dataVencimento é obrigatório (YYYY-MM-DD)" });

    const boleto = await prisma.boletInter.findUnique({ where: { id: Number(req.params.id) } });
    if (!boleto)                    return res.status(404).json({ error: "Boleto não encontrado" });
    if (boleto.status !== "EMITIDO") return res.status(400).json({ error: `Boleto já está ${boleto.status} — não é possível alterar` });

    if (boleto.codigoSolicitacao && boleto.modo !== "mock") {
      try {
        const resp = await alterarBoleto(boleto.codigoSolicitacao, {
          dataVencimento,
          multaPerc:   multaPerc   != null ? Number(multaPerc)   : undefined,
          moraPercMes: moraPercMes != null ? Number(moraPercMes) : undefined,
        }, boleto.modo);
        console.log(`✅ [Boletos] alterar Inter #${boleto.id}:`, JSON.stringify(resp));
      } catch (e) {
        console.error(`❌ [Boletos] alterar Inter #${boleto.id}:`, e.message);
        throw new Error(`Inter API: ${e.message}`);
      }
    } else if (boleto.modo !== "mock") {
      console.warn(`⚠️ [Boletos] alterar #${boleto.id}: codigoSolicitacao ausente — Inter não chamado`);
    }

    const data = {
      dataVencimento: new Date(dataVencimento),
      updatedAt:      new Date(),
    };
    if (multaPerc   != null) data.multaPerc   = Number(multaPerc);
    if (moraPercMes != null) data.moraPercMes = Number(moraPercMes);

    const updated = await prisma.boletInter.update({ where: { id: boleto.id }, data });

    notificarAlteracaoBoleto(boleto.id, dataVencimento).catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error("❌ [Boletos] alterar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/boletos/:id/cancelar ────────────────────────────────────────────

router.post("/boletos/:id/cancelar", authenticate, requireAdmin, async (req, res) => {
  try {
    const boleto = await prisma.boletInter.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!boleto)                  return res.status(404).json({ error: "Boleto não encontrado" });
    if (boleto.status !== "EMITIDO")
      return res.status(400).json({ error: `Boleto já está ${boleto.status}` });

    if (boleto.codigoSolicitacao && boleto.modo !== "mock") {
      try {
        const resp = await cancelarBoleto(boleto.codigoSolicitacao, req.body?.motivo, boleto.modo);
        console.log(`✅ [Boletos] cancelar Inter #${boleto.id}:`, JSON.stringify(resp));
      } catch (e) {
        // Se a Inter já cancelou o boleto (ex: cancelado direto no IB),
        // trata como sucesso e sincroniza o status local.
        if (/CANCELADO/i.test(e.message)) {
          console.log(`ℹ️ [Boletos] cancelar #${boleto.id}: já CANCELADO na Inter — sincronizando status local`);
        } else {
          console.error(`❌ [Boletos] cancelar Inter #${boleto.id}:`, e.message);
          throw e;
        }
      }
    } else if (boleto.modo !== "mock") {
      console.warn(`⚠️ [Boletos] cancelar #${boleto.id}: codigoSolicitacao ausente — Inter não chamado`);
    }

    const updated = await prisma.boletInter.update({
      where: { id: boleto.id },
      data:  { status: "CANCELADO", updatedAt: new Date() },
    });

    notificarCancelamentoBoleto(boleto.id).catch(() => {});

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/boletos/:id/sincronizar ─────────────────────────────────────────
// Consulta o status atual na Inter e atualiza o registro local se diferente.

router.post("/boletos/:id/sincronizar", authenticate, requireAdmin, async (req, res) => {
  try {
    const boleto = await prisma.boletInter.findUnique({ where: { id: Number(req.params.id) } });
    if (!boleto) return res.status(404).json({ error: "Boleto não encontrado" });

    const result = await sincronizarBoletoComInter(boleto).catch((e) => {
      throw Object.assign(new Error(`Erro ao consultar Inter: ${e.message}`), { statusCode: 502 });
    });

    if (result.sincronizado) {
      console.log(`🔄 [Boletos] sincronizar #${boleto.id}: ${result.statusAnterior} → ${result.boleto.status}`);
    }

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── POST /api/boletos/webhook ─────────────────────────────────────────────────
// Inter notifica pagamento/expiração. Responder 200 imediatamente.

router.post("/boletos/webhook", async (req, res) => {
  res.sendStatus(200); // confirmar antes de qualquer processamento

  try {
    const eventos = extrairEventosWebhookBoleto(req.body || {});
    if (!eventos.length) return;

    for (const evento of eventos) {
      if (!evento.novoStatus) continue;

      const boleto = await prisma.boletInter.findFirst({
        where: evento.nossoNumero
          ? { nossoNumero: evento.nossoNumero }
          : { codigoSolicitacao: evento.codigoSolicitacao },
      });
      if (!boleto) continue;

      const result = await aplicarStatusBoleto(boleto, evento.novoStatus, {
        dataPagamento: evento.dataPagamento || undefined,
        valorPagoCent: evento.valorPagoCent ?? undefined,
      });

      if (result.sincronizado) {
        console.log(`🏦 [Boletos] Webhook: #${boleto.id} ${result.statusAnterior} → ${result.boleto.status}`);
      }
    }
  } catch (err) {
    console.error("❌ [Boletos] webhook:", err.message);
  }
});

export default router;
