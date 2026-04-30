import { Router } from "express";
import prisma from "../lib/prisma.js";
import { WA_API_URL } from "../lib/whatsapp.js";

const router = Router();

// ============================================================
// HEALTH CHECK (keep-alive / uptime monitors)
// ============================================================
router.get("/api/health", async (req, res) => {
  const checks = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
  ]);
  const dbOk = checks[0].status === "fulfilled";
  const status = dbOk ? "ok" : "degraded";

  // resend and anthropic are not accessible here from server.js scope;
  // we check env vars instead as a proxy
  const resendConfigured = !!process.env.RESEND_API_KEY;
  const anthropicConfigured = !!process.env.ANTHROPIC_API_KEY;

  res.status(dbOk ? 200 : 503).json({
    status,
    ts: new Date().toISOString(),
    db: dbOk ? "ok" : "error",
    wa: WA_API_URL ? "configured" : "not_configured",
    email: resendConfigured ? "configured" : "not_configured",
    anthropic: anthropicConfigured ? "configured" : "not_configured",
  });
});

export default router;
