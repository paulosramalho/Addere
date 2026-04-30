import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";

const router = Router();

// ============================================================
// AUDITORIA — listagem (admin only)
// GET /api/auditoria
// ============================================================
router.get("/api/auditoria", authenticate, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const skip = (page - 1) * pageSize;

    const where = {};
    if (req.query.usuarioId) where.usuarioId = Number(req.query.usuarioId);
    if (req.query.acao) where.acao = req.query.acao;
    if (req.query.entidadeId) where.entidadeId = Number(req.query.entidadeId);
    if (req.query.dataInicio || req.query.dataFim) {
      where.createdAt = {};
      if (req.query.dataInicio) where.createdAt.gte = new Date(req.query.dataInicio);
      if (req.query.dataFim) {
        const fim = new Date(req.query.dataFim);
        fim.setHours(23, 59, 59, 999);
        where.createdAt.lte = fim;
      }
    }

    const [total, data] = await Promise.all([
      prisma.auditoriaLog.count({ where }),
      prisma.auditoriaLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: { usuario: { select: { nome: true, email: true } } },
      }),
    ]);

    res.json({ total, page, pageSize, data });
  } catch (e) {
    console.error("❌ Erro ao listar auditoria:", e);
    res.status(500).json({ message: "Erro ao listar auditoria." });
  }
});

export default router;
