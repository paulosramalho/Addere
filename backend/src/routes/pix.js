// backend/src/routes/pix.js
// Rotas de Pix: envio, listagem, sincronização de status, recebidos

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { logAuditoria } from "../lib/audit.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppTemplate, _waPhone } from "../lib/whatsapp.js";
import { enviarPix, consultarPix, listarExtrato, detectarTipoChave, INTER_MODE } from "../lib/interPix.js";

const router = Router();

const fmtBRL = (c) =>
  (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── POST /api/pix/enviar ──────────────────────────────────────────────────────

router.post("/api/pix/enviar", authenticate, requireAdmin, async (req, res) => {
  try {
    console.log("🔵 [POST /api/pix/enviar] body recebido:", JSON.stringify(req.body || {}, null, 2));

    const {
      chavePix,
      valorCentavos,
      descricao,
      favorecidoNome,
      advogadoId,
      contaId,
      cpfCnpjFavorecido,
    } = req.body || {};

    if (!chavePix)          return res.status(400).json({ message: "chavePix é obrigatório" });
    if (!favorecidoNome?.trim()) return res.status(400).json({ message: "Nome do favorecido é obrigatório" });
    if (!valorCentavos || Number(valorCentavos) <= 0)
      return res.status(400).json({ message: "valorCentavos deve ser > 0" });

    const tipoChave = detectarTipoChave(chavePix);
    const valCents  = parseInt(valorCentavos, 10);
    const advId     = advogadoId ? parseInt(advogadoId, 10) : null;
    const cntId     = contaId    ? parseInt(contaId, 10)    : null;

    // Chamar Inter API — payload tipo CHAVE: só precisa de chave + valor + descricao
    const interResp = await enviarPix({
      chavePix,
      valorCentavos: valCents,
      descricao:     descricao || null,
      favorecidoNome: favorecidoNome.trim(), // mantido para mock e DB
    });

    // Persistir
    const pix = await prisma.pixPagamento.create({
      data: {
        codigoSolicitacao: interResp.codigoSolicitacao || null, // retornado pelo POST Inter
        endToEndId:        interResp.endToEndId || null,        // disponível após processamento
        chavePix,
        tipoChave,
        favorecidoNome: favorecidoNome.trim(),
        valorCentavos:  valCents,
        descricao:      descricao || null,
        status:         interResp.status || "PROCESSANDO",
        advogadoId:     advId,
        contaId:        cntId,
        usuarioId:      req.user.id,
        dataPagamento:  interResp.status === "REALIZADO" ? new Date() : null,
      },
    });

    // Criar lançamento de saída no Livro Caixa (se contaId informada)
    if (cntId) {
      const hoje = new Date();
      const efetivado = interResp.status === "REALIZADO";
      await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno:    hoje.getFullYear(),
          competenciaMes:    hoje.getMonth() + 1,
          data:              hoje,
          es:                "S",
          clienteFornecedor: favorecidoNome.trim(),
          historico:         descricao?.trim() || `Pix para ${favorecidoNome.trim()}`,
          valorCentavos:     valCents,
          contaId:           cntId,
          origem:            "MANUAL",
          referenciaOrigem:  `PIX_${pix.id}`,
          status:            "OK",
          statusFluxo:       efetivado ? "EFETIVADO" : "PREVISTO",
        },
      }).catch(e => console.error("⚠️ LC Pix saída não criado:", e.message));
    }

    logAuditoria(req, "PIX_ENVIAR", "PixPagamento", pix.id, null, {
      chavePix, valorCentavos: valCents, endToEndId: pix.endToEndId,
    }).catch(() => {});

    // Notificações fire-and-forget
    _notificarPixEnviado(pix).catch(() => {});

    res.json({ pix });
  } catch (err) {
    console.error("❌ POST /api/pix/enviar:", err.message);
    res.status(500).json({ message: err.message || "Erro ao enviar Pix" });
  }
});

// ── GET /api/pix/pagamentos ───────────────────────────────────────────────────

router.get("/api/pix/pagamentos", authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      status,
      advogadoId,
      nome,
      de,
      ate,
      page = "1",
      limit = "20",
    } = req.query;

    const where = {};
    if (status)     where.status     = status;
    if (advogadoId) where.advogadoId = parseInt(advogadoId, 10);
    if (nome)       where.favorecidoNome = { contains: nome, mode: "insensitive" };
    if (de || ate) {
      where.createdAt = {};
      if (de)  where.createdAt.gte = new Date(de  + "T00:00:00");
      if (ate) where.createdAt.lte = new Date(ate + "T23:59:59");
    }

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    const [total, pagamentos] = await Promise.all([
      prisma.pixPagamento.count({ where }),
      prisma.pixPagamento.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
        include: {
          advogado: { select: { id: true, nome: true } },
        },
      }),
    ]);

    res.json({
      pagamentos,
      total,
      pages: Math.ceil(total / limitNum),
      page:  pageNum,
    });
  } catch (err) {
    console.error("❌ GET /api/pix/pagamentos:", err.message);
    res.status(500).json({ message: "Erro ao listar pagamentos Pix" });
  }
});

// ── GET /api/pix/pagamentos/:id ───────────────────────────────────────────────

router.get("/api/pix/pagamentos/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pix = await prisma.pixPagamento.findUnique({
      where: { id },
      include: { advogado: { select: { id: true, nome: true } } },
    });
    if (!pix) return res.status(404).json({ message: "Pix não encontrado" });
    res.json({ pix });
  } catch (err) {
    console.error("❌ GET /api/pix/pagamentos/:id:", err.message);
    res.status(500).json({ message: "Erro ao buscar Pix" });
  }
});

// ── POST /api/pix/pagamentos/:id/sincronizar ──────────────────────────────────

// Mapeamento de status Inter → status interno
function _normalizeInterStatus(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase();
  if (s === "REALIZADO" || s === "APROVADO" || s === "PAGO") return "REALIZADO";
  if (s === "DEVOLVIDO" || s === "CANCELADO" || s === "REJEITADO" || s === "REPROVADO") return "DEVOLVIDO";
  if (s === "ERRO" || s === "FALHA") return "ERRO";
  if (s === "EM_APROVACAO" || s === "AGUARDANDO_APROVACAO" || s === "AGUARDANDO" || s === "PROCESSANDO") return "EM_APROVACAO";
  return raw; // desconhecido — preservar
}

router.post("/api/pix/pagamentos/:id/sincronizar", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pix = await prisma.pixPagamento.findUnique({ where: { id } });
    if (!pix) return res.status(404).json({ message: "Pix não encontrado" });

    // Já finalizado — não precisa consultar
    if (["REALIZADO", "DEVOLVIDO", "ERRO"].includes(pix.status)) {
      return res.json({ pix, sincronizado: false, message: "Status já finalizado" });
    }

    if (!pix.codigoSolicitacao) {
      return res.json({ pix, sincronizado: false, message: "codigoSolicitacao não disponível — use 'Marcar Realizado' se o pagamento foi confirmado" });
    }

    const interResp = await consultarPix(pix.codigoSolicitacao);
    console.log("🔵 [Pix sync] resposta Inter:", JSON.stringify(interResp));

    const rawStatus = interResp.status;
    const novoStatus = _normalizeInterStatus(rawStatus) || pix.status;

    const updated = await prisma.pixPagamento.update({
      where: { id },
      data: {
        status:        novoStatus,
        endToEndId:    interResp.endToEndId || pix.endToEndId || null,
        dataPagamento: novoStatus === "REALIZADO" && !pix.dataPagamento ? new Date() : pix.dataPagamento,
        erro:          novoStatus === "ERRO" ? (interResp.descricaoErro || "Erro reportado pelo Inter") : null,
        updatedAt:     new Date(),
      },
      include: { advogado: { select: { id: true, nome: true } } },
    });

    if (novoStatus === "REALIZADO" && pix.status !== "REALIZADO") {
      _notificarPixRealizado(updated).catch(() => {});
      prisma.livroCaixaLancamento.updateMany({
        where: { referenciaOrigem: `PIX_${id}`, statusFluxo: "PREVISTO" },
        data:  { statusFluxo: "EFETIVADO" },
      }).catch(() => {});
    }

    res.json({ pix: updated, sincronizado: true, statusInter: rawStatus });
  } catch (err) {
    console.error("❌ POST /api/pix/pagamentos/:id/sincronizar:", err.message);
    res.status(500).json({ message: err.message || "Erro ao sincronizar Pix" });
  }
});

// ── POST /api/pix/pagamentos/:id/marcar-realizado ─────────────────────────────
// Marca manualmente como REALIZADO (para pagamentos aprovados no banco sem sync automático)

router.post("/api/pix/pagamentos/:id/marcar-realizado", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pix = await prisma.pixPagamento.findUnique({ where: { id } });
    if (!pix) return res.status(404).json({ message: "Pix não encontrado" });

    if (pix.status === "REALIZADO") {
      return res.json({ pix, message: "Já está como REALIZADO" });
    }

    const updated = await prisma.pixPagamento.update({
      where: { id },
      data: {
        status:        "REALIZADO",
        dataPagamento: pix.dataPagamento || new Date(),
        updatedAt:     new Date(),
      },
      include: { advogado: { select: { id: true, nome: true } } },
    });

    // Efetivar LC associado
    await prisma.livroCaixaLancamento.updateMany({
      where: { referenciaOrigem: `PIX_${id}`, statusFluxo: "PREVISTO" },
      data:  { statusFluxo: "EFETIVADO" },
    });

    logAuditoria(req, "PIX_MARCAR_REALIZADO", "PixPagamento", id, { status: pix.status }, { status: "REALIZADO" }).catch(() => {});

    res.json({ pix: updated });
  } catch (err) {
    console.error("❌ POST /api/pix/pagamentos/:id/marcar-realizado:", err.message);
    res.status(500).json({ message: err.message || "Erro ao marcar Pix como realizado" });
  }
});

// ── GET /api/pix/recebidos ────────────────────────────────────────────────────

router.get("/api/pix/recebidos", authenticate, requireAdmin, async (req, res) => {
  try {
    const hoje  = new Date().toISOString().slice(0, 10);
    const { de = hoje, ate = hoje } = req.query;

    const extrato = await listarExtrato({ dataInicio: de, dataFim: ate });

    // Normalizar estrutura (Inter v2: { transacoes:[...] } ou array direto)
    const transacoes = extrato?.transacoes || extrato?.content || (Array.isArray(extrato) ? extrato : []);

    // Retorna tudo — frontend filtra/exibe por tipoOperacao (C/D) e tipoTransacao
    res.json({ transacoes, total: transacoes.length });
  } catch (err) {
    console.error("❌ GET /api/pix/recebidos:", err.message);
    res.status(500).json({ message: err.message || "Erro ao buscar Pix recebidos" });
  }
});

// ── Helpers de notificação ────────────────────────────────────────────────────

async function _notificarPixEnviado(pix) {
  try {
    const admins = await prisma.usuario.findMany({
      where: { role: "ADMIN", ativo: true },
      select: { email: true, telefone: true },
    });

    const valor = fmtBRL(pix.valorCentavos);
    const dest  = pix.favorecidoNome || pix.chavePix;
    const statusLabel = pix.status === "REALIZADO" ? "✅ Realizado" : "⏳ Processando";
    const subject = `💸 Addere — Pix ${pix.status === "REALIZADO" ? "realizado" : "enviado"}: ${valor} para ${dest}`;

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
  <div style="background:#1e40af;padding:20px 24px">
    <div style="font-size:18px;font-weight:700;color:#fff">Addere — Pix Enviado</div>
  </div>
  <div style="padding:20px 24px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;width:140px">STATUS</td>
          <td style="padding:6px 0;font-size:14px;font-weight:700">${statusLabel}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600">VALOR</td>
          <td style="padding:6px 0;font-size:18px;font-weight:700;color:#1e40af">${valor}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600">DESTINATÁRIO</td>
          <td style="padding:6px 0;font-size:14px">${dest}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600">CHAVE</td>
          <td style="padding:6px 0;font-size:14px">${pix.chavePix} (${pix.tipoChave || "—"})</td></tr>
      ${pix.endToEndId ? `<tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600">E2E ID</td>
          <td style="padding:6px 0;font-size:12px;color:#64748b">${pix.endToEndId}</td></tr>` : ""}
      ${pix.descricao ? `<tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600">DESCRIÇÃO</td>
          <td style="padding:6px 0;font-size:14px">${pix.descricao}</td></tr>` : ""}
    </table>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8">
    Addere Control — notificação automática
  </div>
</div></body></html>`;

    for (const admin of admins) {
      if (admin.email) {
        await sendEmail({ to: admin.email, subject, html }).catch(() => {});
      }
    }

    // WA admin
    const extraPhone = _waPhone(process.env.EXTRA_NOTIFY_PHONE);
    if (extraPhone) {
      const msg = `💸 *Addere — Pix ${pix.status === "REALIZADO" ? "Realizado" : "Enviado"}*\n\nValor: *${valor}*\nDestinatário: ${dest}\nChave: ${pix.chavePix}\nStatus: ${statusLabel}`;
      await sendWhatsApp(extraPhone, msg).catch(() => {});
    }
  } catch (e) {
    console.error("❌ _notificarPixEnviado:", e.message);
  }
}

async function _notificarPixRealizado(pix) {
  try {
    // Notificar advogado se houver vínculo
    if (pix.advogadoId) {
      const advogado = await prisma.advogado.findUnique({
        where: { id: pix.advogadoId },
        select: { nome: true, email: true, telefone: true, ativo: true },
      });
      if (advogado?.ativo) {
        const valor = fmtBRL(pix.valorCentavos);
        if (advogado.email) {
          const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
  <div style="background:#1e40af;padding:20px 24px">
    <div style="font-size:18px;font-weight:700;color:#fff">Addere</div>
    <div style="font-size:13px;color:#bfdbfe;margin-top:4px">Pix recebido</div>
  </div>
  <div style="padding:20px 24px">
    <p style="font-size:14px;color:#0f172a">Olá, ${advogado.nome}.</p>
    <p style="font-size:14px;color:#0f172a">Um Pix de <strong>${valor}</strong> foi enviado para a sua chave <strong>${pix.chavePix}</strong>.</p>
    ${pix.descricao ? `<p style="font-size:13px;color:#64748b">${pix.descricao}</p>` : ""}
  </div>
  <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8">Addere Control</div>
</div></body></html>`;
          await sendEmail({
            to: advogado.email,
            subject: `✅ Addere — Pix de ${valor} confirmado`,
            html,
          }).catch(() => {});
        }
        const phone = _waPhone(advogado.telefone);
        if (phone) {
          const valor100 = (pix.valorCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
          try {
            await sendWhatsAppTemplate(phone, "realizado_repasse", "pt_BR", [{
              type: "body",
              parameters: [
                { type: "text", text: advogado.nome },
                { type: "text", text: pix.descricao || "—" },
                { type: "text", text: new Date().getMonth() + 1 > 9
                    ? String(new Date().getMonth() + 1)
                    : "0" + (new Date().getMonth() + 1) },
                { type: "text", text: valor100 },
              ],
            }]);
          } catch {
            await sendWhatsApp(phone, `✅ *Addere — Pix confirmado*\n\nOlá, ${advogado.nome}!\nPix de *R$ ${valor100}* foi confirmado para sua chave ${pix.chavePix}.`).catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    console.error("❌ _notificarPixRealizado:", e.message);
  }
}

export default router;
