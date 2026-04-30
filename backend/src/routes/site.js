/**
 * backend/src/routes/site.js
 *
 * Endpoints públicos consumidos pelo site institucional (amandaramalho.adv.br).
 * Autenticados por shared secret via header x-site-secret.
 */

import { Router } from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { triggerDigestNow, triggerUptimeNow } from "../schedulers/siteMonitor.js";

const router = Router();

/** Verifica shared secret com comparação segura contra timing attacks. */
function _verifySecret(req) {
  const secret = process.env.SITE_SECRET;
  if (!secret) return true; // dev: sem secret configurado, passa
  const header = String(req.headers["x-site-secret"] || "");
  if (!header || header.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * POST /api/site/lead
 * Chamado pelo formulário de contato do site após o envio do e-mail via Resend.
 * Fire-and-forget do lado do website — falhas aqui não afetam o usuário.
 */
router.post("/api/site/lead", async (req, res) => {
  if (!_verifySecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { nome, email, telefone, area, urgencia, mensagem } = req.body || {};
    if (!nome || !email || !mensagem) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes." });
    }

    const ip =
      String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.ip ||
      null;

    await prisma.contatoSite.create({
      data: {
        nome:     String(nome).slice(0, 200),
        email:    String(email).slice(0, 200),
        telefone: telefone ? String(telefone).slice(0, 30)  : null,
        area:     area      ? String(area).slice(0, 100)    : null,
        urgencia: urgencia  ? String(urgencia).slice(0, 50) : null,
        mensagem: String(mensagem).slice(0, 2000),
        ip,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[site/lead]", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * POST /api/admin/site-monitor/digest  — dispara digest imediatamente (admin)
 * POST /api/admin/site-monitor/uptime  — executa check de uptime agora (admin)
 */
router.post("/api/admin/site-monitor/digest", authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await triggerDigestNow();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[site-monitor/digest]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/site-monitor/uptime", authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await triggerUptimeNow();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[site-monitor/uptime]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
