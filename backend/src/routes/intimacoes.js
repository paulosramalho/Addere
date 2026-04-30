// routes/intimacoes.js — CRUD de Intimações DJe (multi-tribunal)
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { processarDJe, processarDJEN } from "../schedulers/intimacoes.js";
import { TRIBUNAIS_DJE, estimarEdicaoTJPA, gerarTarefas, lockKeyDJe } from "../lib/scraperDJe.js";

const router = Router();

// ── GET /api/intimacoes — lista intimações ────────────────────────────────────
router.get("/api/intimacoes", authenticate, async (req, res) => {
  try {
    const { advogadoId, lida, tribunal, page = 1, limit = 30 } = req.query;
    const where = {};
    if (advogadoId) where.advogadoId = parseInt(advogadoId);
    if (tribunal)   where.tribunal   = tribunal;
    if (lida !== undefined && lida !== "") where.lida = lida === "true";

    const [items, total] = await Promise.all([
      prisma.intimacao.findMany({
        where,
        include: {
          advogado: { select: { id: true, nome: true } },
          processo: { select: { id: true, numeroProcesso: true, tribunal: true } },
        },
        orderBy: [{ ano: "desc" }, { edicao: "desc" }, { id: "desc" }],
        skip:  (parseInt(page) - 1) * parseInt(limit),
        take:  parseInt(limit),
      }),
      prisma.intimacao.count({ where }),
    ]);

    res.json({ items, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/intimacoes/count — total não lidas (badge) ──────────────────────
router.get("/api/intimacoes/count", authenticate, async (req, res) => {
  try {
    const total = await prisma.intimacao.count({ where: { lida: false } });
    res.json({ total });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/intimacoes/:id — marcar lida / vincular processo ───────────────
router.patch("/api/intimacoes/:id", authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { lida, processoId } = req.body;
    const data = {};
    if (lida !== undefined)       data.lida      = Boolean(lida);
    if (processoId !== undefined) data.processoId = processoId ? parseInt(processoId) : null;

    const updated = await prisma.intimacao.update({ where: { id }, data });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── DELETE /api/intimacoes/:id — excluir (admin) ──────────────────────────────
router.delete("/api/intimacoes/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.intimacao.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/intimacoes/sync — disparo manual (admin) ───────────────────────
// Body:
//   TJPA:  { tribunal: "tjpa", edicao?: number, ano?: number }
//   Outros: { tribunal: "tjsp"|"tjam", data?: "YYYY-MM-DD", caderno?: number }
//   Sem body: usa TJPA com edição estimada
router.post("/api/intimacoes/sync", authenticate, requireAdmin, async (req, res) => {
  try {
    const tribunal = req.body?.tribunal || "tjpa";

    if (!TRIBUNAIS_DJE[tribunal]) {
      return res.status(400).json({ message: `Tribunal não suportado: ${tribunal}` });
    }

    const advogados = await prisma.advogado.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, oab: true, email: true, whatsapp: true, telefone: true },
    });

    let params;
    if (TRIBUNAIS_DJE[tribunal].tipo === "data") {
      const dataStr = req.body?.data || new Date().toISOString().slice(0, 10);
      params = {
        data:    new Date(dataStr + "T12:00:00.000Z"),
        caderno: parseInt(req.body?.caderno) || 1,
      };
    } else {
      const ano    = parseInt(req.body?.ano)    || new Date().getUTCFullYear();
      const edicao = parseInt(req.body?.edicao) || estimarEdicaoTJPA();
      params = { edicao, ano };
    }

    console.log(`[DJe sync manual] tribunal=${tribunal}`, params);

    // Resetar lock para permitir re-sync manual (remove da SchedulerLock)
    if (req.query.forcar === "1") {
      const lockKey = lockKeyDJe(tribunal, params);
      await prisma.$executeRaw`DELETE FROM "SchedulerLock" WHERE key = ${lockKey}`.catch(() => {});
    }

    const r = await processarDJe(tribunal, params, advogados);
    res.json({ ok: true, tribunal, ...r });
  } catch (e) {
    console.error("[DJe sync manual]", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/intimacoes/sync-djen — sync DJEN por OAB (admin) ───────────────
router.post("/api/intimacoes/sync-djen", authenticate, requireAdmin, async (req, res) => {
  try {
    const { advogadoId } = req.body || {};
    const where = { ativo: true };
    if (advogadoId) where.id = parseInt(advogadoId);

    const advogados = await prisma.advogado.findMany({
      where,
      select: { id: true, nome: true, oab: true, email: true, whatsapp: true, telefone: true },
    });

    // Reset locks de hoje se ?forcar=1
    if (req.query.forcar === "1") {
      const hoje = new Date().toISOString().slice(0, 10);
      for (const adv of advogados) {
        const lockKey = `djen-oab-${adv.id}-${hoje}`;
        await prisma.$executeRaw`DELETE FROM "SchedulerLock" WHERE key = ${lockKey}`.catch(() => {});
      }
    }

    const r = await processarDJEN(advogados);
    res.json({ ok: true, novos: r.novos, advogados: r.novosPorAdv.size });
  } catch (e) {
    console.error("[DJEN sync manual]", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/intimacoes/tribunais — lista tribunais suportados ────────────────
router.get("/api/intimacoes/tribunais", authenticate, (req, res) => {
  res.json(Object.entries(TRIBUNAIS_DJE).map(([key, cfg]) => ({
    key,
    nome: cfg.nome,
    tipo: cfg.tipo,
    cadernos: cfg.cadernos || null,
  })));
});

export default router;
