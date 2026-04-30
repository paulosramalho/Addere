/**
 * Google Calendar — OAuth flow + webhook de push notifications
 *
 * Rotas:
 *   GET  /api/google-calendar/auth/:advogadoId    — redireciona para Google OAuth
 *   GET  /api/google-calendar/callback            — recebe code, salva tokens
 *   GET  /api/google-calendar/status/:advogadoId  — verifica conexão
 *   DELETE /api/google-calendar/disconnect/:advogadoId — revoga e remove tokens
 *   POST /api/google-calendar/webhook             — recebe push notifications do Google
 */

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import {
  createOAuthClient, getAuthUrl, getAuthClientForAdvogado,
  gcalListEvents, gcalRegisterWatch, gcalStopWatch,
  GCAL_CLIENT_ID,
} from "../lib/googleCalendar.js";
import { syncAdvogadoCalendar } from "../schedulers/googleCalendarSync.js";

const router = Router();

// ── Iniciar fluxo OAuth ───────────────────────────────────────────────────────
// /auth/:advogadoId  — para advogados com vínculo
// /auth/me           — para qualquer usuário sem vínculo (admin, secretária, etc.)
router.get("/api/google-calendar/auth/:advogadoId", authenticate, async (req, res) => {
  try {
    if (!GCAL_CLIENT_ID) return res.status(501).json({ message: "Google Calendar não configurado no servidor" });

    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";

    // Rota especial: /auth/me — usa o próprio userId
    if (req.params.advogadoId === "me") {
      const url = getAuthUrl(null, req.user.id);
      return res.json({ url });
    }

    const advogadoId = parseInt(req.params.advogadoId);
    if (isNaN(advogadoId)) return res.status(400).json({ message: "advogadoId inválido" });

    if (!isAdmin) {
      const adv = await prisma.advogado.findFirst({
        where: { id: advogadoId, usuario: { id: req.user.id } },
      });
      if (!adv) return res.status(403).json({ message: "Acesso negado" });
    }

    const url = getAuthUrl(advogadoId, null);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Callback OAuth ────────────────────────────────────────────────────────────
router.get("/api/google-calendar/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const FRONTEND_URL = process.env.FRONTEND_URL || "https://addere.vercel.app";

  if (error) {
    console.warn("⚠️ GCal OAuth cancelado:", error);
    return res.redirect(`${FRONTEND_URL}/advogados?gcal=cancelled`);
  }

  // state formato: "adv:123" ou "usr:456"
  if (!code || !state) return res.redirect(`${FRONTEND_URL}/advogados?gcal=error`);
  const [kind, idStr] = state.split(":");
  const parsedId = parseInt(idStr);
  if (!["adv", "usr"].includes(kind) || isNaN(parsedId)) {
    return res.redirect(`${FRONTEND_URL}/advogados?gcal=error`);
  }
  const advogadoId = kind === "adv" ? parsedId : null;
  const usuarioId  = kind === "usr" ? parsedId : null;

  try {
    const oauth2 = createOAuthClient();
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      console.warn(`⚠️ GCal callback sem refresh_token (${state}) — pedir prompt=consent`);
      return res.redirect(`${FRONTEND_URL}/advogados?gcal=no_refresh_token`);
    }

    const expiresAt = new Date(tokens.expiry_date || Date.now() + 3600000);
    const where  = advogadoId ? { advogadoId } : { usuarioId };
    const create = advogadoId
      ? { advogadoId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt, calendarId: "primary" }
      : { usuarioId,  accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt, calendarId: "primary" };

    await prisma.googleCalendarToken.upsert({
      where,
      create,
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        syncToken: null,
        channelId: null,
        channelExpiry: null,
        channelResource: null,
      },
    });

    console.log(`✅ GCal conectado (${state})`);

    setImmediate(async () => {
      try {
        await syncAdvogadoCalendar(advogadoId, usuarioId);
        await gcalRegisterWatch(advogadoId, usuarioId);
      } catch (e) {
        console.error(`❌ GCal post-connect sync error (${state}):`, e.message);
      }
    });

    res.redirect(`${FRONTEND_URL}/advogados?gcal=connected`);
  } catch (e) {
    console.error("❌ GCal callback error:", e.message);
    res.redirect(`${FRONTEND_URL}/advogados?gcal=error`);
  }
});

// ── Helpers internos para resolver where ─────────────────────────────────────
function _resolveWhere(paramId, userId) {
  if (paramId === "me") return { usuarioId: userId };
  const advogadoId = parseInt(paramId);
  if (!isNaN(advogadoId)) return { advogadoId };
  return null;
}

// ── Status da conexão ─────────────────────────────────────────────────────────
router.get("/api/google-calendar/status/:advogadoId", authenticate, async (req, res) => {
  try {
    const where = _resolveWhere(req.params.advogadoId, req.user.id);
    if (!where) return res.status(400).json({ message: "Parâmetro inválido" });

    const token = await prisma.googleCalendarToken.findUnique({
      where,
      select: { criadoEm: true, calendarId: true, channelExpiry: true },
    });

    res.json({
      conectado: !!token,
      calendarId: token?.calendarId || null,
      desde: token?.criadoEm || null,
      pushAtivo: !!(token?.channelExpiry && new Date(token.channelExpiry) > new Date()),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Sync manual (full resync de hoje em diante) ───────────────────────────────
router.post("/api/google-calendar/sync/:advogadoId", authenticate, async (req, res) => {
  try {
    const where = _resolveWhere(req.params.advogadoId, req.user.id);
    if (!where) return res.status(400).json({ message: "Parâmetro inválido" });

    // Limpar syncToken força full resync (timeMin = hoje)
    await prisma.googleCalendarToken.update({ where, data: { syncToken: null } });

    const advId = where.advogadoId || null;
    const usrId = where.usuarioId  || null;
    await syncAdvogadoCalendar(advId, usrId);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Desconectar ───────────────────────────────────────────────────────────────
router.delete("/api/google-calendar/disconnect/:advogadoId", authenticate, async (req, res) => {
  try {
    const where = _resolveWhere(req.params.advogadoId, req.user.id);
    if (!where) return res.status(400).json({ message: "Parâmetro inválido" });

    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    // Não-admin só pode desconectar a si mesmo
    if (!isAdmin && !where.usuarioId) return res.status(403).json({ message: "Acesso negado" });

    const advId = where.advogadoId || null;
    const usrId = where.usuarioId  || null;

    await gcalStopWatch(advId, usrId);

    const auth = await getAuthClientForAdvogado(advId, usrId);
    if (auth) {
      const tokenRow = await prisma.googleCalendarToken.findUnique({ where, select: { refreshToken: true } });
      if (tokenRow?.refreshToken) {
        try { await auth.revokeToken(tokenRow.refreshToken); } catch (_) {}
      }
    }

    await prisma.googleCalendarToken.delete({ where });
    console.log(`✅ GCal desconectado (${JSON.stringify(where)})`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Webhook — push notifications do Google ────────────────────────────────────
// Google envia headers: X-Goog-Channel-ID, X-Goog-Resource-State ("sync" | "exists")
router.post("/api/google-calendar/webhook", async (req, res) => {
  res.sendStatus(200); // responde imediatamente (requisito do Google)

  const channelId     = req.headers["x-goog-channel-id"];
  const resourceState = req.headers["x-goog-resource-state"];

  if (!channelId || resourceState === "sync") return; // "sync" = confirmação de registro

  const tokenRow = await prisma.googleCalendarToken.findFirst({
    where: { channelId },
    select: { advogadoId: true, usuarioId: true },
  });

  if (!tokenRow) {
    console.warn(`⚠️ GCal webhook: channelId desconhecido ${channelId}`);
    return;
  }

  console.log(`📅 GCal push notification (adv:${tokenRow.advogadoId}/usr:${tokenRow.usuarioId}) state:${resourceState}`);

  setImmediate(async () => {
    try {
      await syncAdvogadoCalendar(tokenRow.advogadoId, tokenRow.usuarioId);
    } catch (e) {
      console.error(`❌ GCal webhook sync error:`, e.message);
    }
  });
});

export default router;
