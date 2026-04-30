import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import path from "path";

const router = Router();

// ============================================================
// COMPROVANTES RECEBIDOS (respostas de clientes via Gmail)
// ============================================================

function _safeFilename(name) {
  const base = path.basename(String(name || "arquivo").replace(/\\/g, "/"));
  return base.replace(/[\x00-\x1f<>:"/|?*]/g, "_") || "arquivo";
}

// GET /api/comprovantes — lista todos (admin)
router.get("/api/comprovantes", authenticate, requireAdmin, async (req, res) => {
  try {
    const { revisado } = req.query;
    const where = revisado !== undefined ? { revisado: revisado === "true" } : {};
    const rows = await prisma.comprovanteRespostaCliente.findMany({
      where,
      orderBy: { recebidoEm: "desc" },
      include: {
        cliente: { select: { id: true, nomeRazaoSocial: true, email: true } },
        parcela: { select: { id: true, numero: true, contrato: { select: { numeroContrato: true } } } },
        anexos:  { select: { id: true, nomeArquivo: true, mimeType: true, tamanhoBytes: true } },
      },
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/comprovantes/contagem-pendentes — badge para o menu
router.get("/api/comprovantes/contagem-pendentes", authenticate, requireAdmin, async (req, res) => {
  try {
    const count = await prisma.comprovanteRespostaCliente.count({ where: { revisado: false } });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Palavras-chave do Gmail poller ────────────────────────────────────────────

// GET /api/admin/gmail-palavras — lista todas
router.get("/api/admin/gmail-palavras", authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await prisma.gmailPalavraChave.findMany({ orderBy: { palavra: "asc" } });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/gmail-palavras — adiciona (ou reativa se já existia)
router.post("/api/admin/gmail-palavras", authenticate, requireAdmin, async (req, res) => {
  try {
    const palavra = String(req.body.palavra || "").trim().toLowerCase();
    if (!palavra) return res.status(400).json({ message: "Palavra obrigatória." });
    const row = await prisma.gmailPalavraChave.upsert({
      where: { palavra },
      update: { ativo: true },
      create: { palavra },
    });
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/gmail-palavras/:id — ativa ou desativa
router.patch("/api/admin/gmail-palavras/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { ativo } = req.body;
    const row = await prisma.gmailPalavraChave.update({ where: { id }, data: { ativo: !!ativo } });
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/gmail-palavras/:id — exclui
router.delete("/api/admin/gmail-palavras/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.gmailPalavraChave.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/comprovantes/:id/revisado — marca como revisado
router.patch("/api/comprovantes/:id/revisado", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = await prisma.comprovanteRespostaCliente.update({
      where: { id },
      data: { revisado: true, revisadoEm: new Date() },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/comprovantes/:id/vincular — vincula manualmente a uma parcela
router.patch("/api/comprovantes/:id/vincular", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { parcelaId } = req.body;
    const updated = await prisma.comprovanteRespostaCliente.update({
      where: { id },
      data: { parcelaId: parcelaId ? parseInt(parcelaId) : null },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/comprovantes/anexo/:anexoId — download de arquivo
router.get("/api/comprovantes/anexo/:anexoId", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.anexoId);
    const anexo = await prisma.comprovanteAnexo.findUnique({ where: { id } });
    if (!anexo) return res.status(404).json({ message: "Anexo não encontrado." });
    res.set("Content-Type", anexo.mimeType);
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(_safeFilename(anexo.nomeArquivo))}"`);
    res.send(anexo.conteudo);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
