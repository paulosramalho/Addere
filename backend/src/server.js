// =============================================================
// SERVER.JS — entrada principal do backend Addere Control
// Versão limpa: helpers extraídos para lib/ e schedulers/
// =============================================================

import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── lib ───────────────────────────────────────────────────────────────────────
import prisma from "./lib/prisma.js";
import { _sanitizeErrMsg } from "./lib/upload.js";

// ── Route modules ─────────────────────────────────────────────────────────────
import healthRouter from "./routes/health.js";
import auditoriaRouter from "./routes/auditoria.js";
import authRouter from "./routes/auth.js";
import comprovantesRouter from "./routes/comprovantes.js";
import clientesRouter from "./routes/clientes.js";
import usuariosRouter from "./routes/usuarios.js";
import adminRouter from "./routes/admin.js";
import contratosRouter from "./routes/contratos.js";
import parcelasRouter from "./routes/parcelas.js";
import dashboardRouter from "./routes/dashboard.js";
import historicoRouter from "./routes/historico.js";
import contaCorrenteRouter from "./routes/contaCorrente.js";
import relatoriosRouter from "./routes/relatorios.js";
import livroCaixaRouter from "./routes/livroCaixa.js";
import noticeboardRouter from "./routes/noticeboard.js";
import agendaRouter from "./routes/agenda.js";
import whatsappRouter from "./routes/whatsapp.js";
import instagramRouter from "./routes/instagram.js";
import documentosRouter from "./routes/documentos.js";
import processosRouter from "./routes/processos.js";
import intimacoesRouter from "./routes/intimacoes.js";
import indicadoresRouter from "./routes/indicadores.js";
import { getOrCreatePessoaByNomeETipo } from "./routes/livroCaixa.js";
import siteRouter from "./routes/site.js";
import mercadoRouter from "./routes/mercado.js";

// ── Scheduler starters ────────────────────────────────────────────────────────
import { startVencimentosScheduler } from "./schedulers/vencimentos.js";
import { startVencidosScheduler } from "./schedulers/vencidos.js";
import { startGmailScheduler } from "./schedulers/gmail.js";
import { startAgendaScheduler } from "./schedulers/agenda.js";
import { startProcessosScheduler } from "./schedulers/processos.js";
import { startIntimacoesScheduler } from "./schedulers/intimacoes.js";
import { startBriefingScheduler } from "./schedulers/briefing.js";
import { startSaudeCaixaScheduler } from "./schedulers/saudeCaixa.js";
import { startAndamentosIAScheduler } from "./schedulers/andamentosIA.js";
import { startSiteMonitorScheduler }  from "./schedulers/siteMonitor.js";
import { startGoogleCalendarSync }    from "./schedulers/googleCalendarSync.js";
import { startBoletosAgendadosScheduler } from "./schedulers/boletosAgendados.js";
import { startBoletosSincronizadorScheduler } from "./schedulers/boletosSincronizador.js";
import { startPixSincronizadorScheduler } from "./schedulers/pixSincronizador.js";
import { startInterPagamentosConfirmarScheduler } from "./schedulers/interPagamentosConfirmar.js";
import googleCalendarRouter           from "./routes/googleCalendar.js";
import boletosRouter                 from "./routes/boletos.js";
import pixRouter                     from "./routes/pix.js";
import interPagamentosRouter         from "./routes/interPagamentos.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// SETUP
// ============================================================

// ── Validação de variáveis de ambiente obrigatórias ──────────────────────────
{
  const missing = ["DATABASE_URL", "JWT_SECRET"].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Variáveis de ambiente obrigatórias ausentes: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ── Sentry (opt-in via SENTRY_DSN) ───────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.05,
  });
}

const app = express();
// Render.com / proxies reversos: confiar na primeira camada de proxy para req.ip correto
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const IS_TEST = process.env.NODE_ENV === "test";

// Validação global de parâmetros de rota que devem ser inteiros positivos (#11)
// Dispara antes de qualquer handler que use esses parâmetros
for (const paramName of ["id", "clienteId", "contratoId", "parcelaId", "contaId", "lancamentoId", "userId", "eventoId", "logId"]) {
  app.param(paramName, (req, res, next, val) => {
    if (!/^\d+$/.test(val) || parseInt(val, 10) <= 0) {
      return res.status(400).json({ message: `Parâmetro '${paramName}' inválido.` });
    }
    next();
  });
}

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(helmet({
  // CSP mínima para API pura (não serve HTML/scripts — retorna apenas JSON/PDF binário)
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  // HSTS: força HTTPS por 1 ano
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
}));

const _corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
// Origens permitidas: env CORS_ORIGINS (comma-separated) + defaults de desenvolvimento
const _corsAllowed = new Set([
  ..._corsOrigins,
  "https://addere-frontend.vercel.app",
  "https://addere.vercel.app",
  "https://addere-paulosramalho.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
]);
const _corsOptions = {
  origin: (origin, cb) => {
    // Permitir requests sem origin (ex: mobile, Postman em dev)
    if (!origin) return cb(null, true);
    if (_corsAllowed.has(origin) || [..._corsAllowed].some(o => origin.endsWith(".vercel.app") && o.includes("vercel.app"))) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origem não permitida — ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};
app.use(cors(_corsOptions));
app.options("*", cors(_corsOptions));

// Captura rawBody para validação HMAC-SHA256 do webhook WhatsApp (S2)
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.use(morgan("dev"));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Login: máximo 10 tentativas por IP a cada 15 minutos
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Aguarde 15 minutos." },
});
// API geral: 600 req/IP por 15 minutos (health check isento)
const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em alguns minutos." },
  skip: (req) => req.path === "/api/health",
});
app.use("/api/", apiRateLimit);
app.use("/api/auth/login", loginRateLimit);
app.use("/api/auth/forgot-password", rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: "Limite atingido. Aguarde 15 minutos." } }));

// ── Route modules ─────────────────────────────────────────────────────────────
app.use(healthRouter);
app.use(authRouter);
app.use(auditoriaRouter);
app.use(comprovantesRouter);
app.use(clientesRouter);
app.use(usuariosRouter);

const removedModules = [
  "/api/advogados",
  "/api/modelo-distribuicao",
  "/api/modelos-distribuicao",
  "/api/pagamentos-avulsos",
  "/api/repasses",
  "/api/repasses-pdf",
  "/api/contratos/:id/splits",
  "/api/contratos/:id/repasse-config",
  "/api/util/repasses-manuais",
  "/api/relatorios/repasses",
  "/api/livro-caixa/teste/simular-repasse",
  "/api/livro-caixa/gerar-parcelas-fixas-mes",
  "/api/livro-caixa/confirmar-parcela-fixa",
  "/api/livro-caixa/parcelas-fixas",
];
app.use(removedModules, (_req, res) => {
  res.status(410).json({ message: "Módulo removido da Addere." });
});

app.use(adminRouter);
app.use(contratosRouter);
app.use(parcelasRouter);
app.use(dashboardRouter);
app.use(historicoRouter);
app.use(contaCorrenteRouter);
app.use(relatoriosRouter);
app.use(livroCaixaRouter);
app.use(noticeboardRouter);
app.use(agendaRouter);
app.use(googleCalendarRouter);
app.use(whatsappRouter);
app.use(instagramRouter);
app.use(documentosRouter);
app.use(processosRouter);
app.use(intimacoesRouter);
app.use(indicadoresRouter);
app.use(siteRouter);
app.use(mercadoRouter);
app.use("/api", boletosRouter);
app.use(pixRouter);
app.use(interPagamentosRouter);

// ── Multer buffer cleanup (libera buffers após resposta para garantir GC imediato #21) ──
app.use((req, res, next) => {
  res.on("finish", () => {
    if (req.file?.buffer) req.file.buffer = null;
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
      files.forEach(f => { if (f?.buffer) f.buffer = null; });
    }
  });
  next();
});

// ── SchedulerLock table (N2 — lock persistido no BD, sobrevive a reinícios) ──
prisma.$executeRaw`
  CREATE TABLE IF NOT EXISTS "SchedulerLock" (
    "key"        TEXT PRIMARY KEY,
    "lastRun"    DATE NOT NULL,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW()
  )
`.catch(e => console.warn("⚠️ SchedulerLock table:", e.message));

async function _ensureAgendaLembreteHardening() {
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'AgendaLembrete_eventoId_fkey'
        ) THEN
          ALTER TABLE public."AgendaLembrete"
            ADD CONSTRAINT "AgendaLembrete_eventoId_fkey"
            FOREIGN KEY ("eventoId")
            REFERENCES public."AgendaEvento"(id)
            ON DELETE CASCADE
            ON UPDATE CASCADE;
        END IF;
      END
      $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'AgendaLembrete_usuarioId_fkey'
        ) THEN
          ALTER TABLE public."AgendaLembrete"
            ADD CONSTRAINT "AgendaLembrete_usuarioId_fkey"
            FOREIGN KEY ("usuarioId")
            REFERENCES public."Usuario"(id)
            ON DELETE SET NULL
            ON UPDATE CASCADE;
        END IF;
      END
      $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_agendalembrete_evento_usuario_antecedencia_canal"
      ON public."AgendaLembrete" ("eventoId", "usuarioId", "antecedenciaMin", canal)
      WHERE "usuarioId" IS NOT NULL
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_agendalembrete_evento_email_antecedencia_canal"
      ON public."AgendaLembrete" ("eventoId", LOWER(BTRIM("emailExterno")), "antecedenciaMin", canal)
      WHERE "usuarioId" IS NULL AND "emailExterno" IS NOT NULL
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_agendalembrete_evento_sem_destino_antecedencia_canal"
      ON public."AgendaLembrete" ("eventoId", "antecedenciaMin", canal)
      WHERE "usuarioId" IS NULL AND "emailExterno" IS NULL
    `);
  } catch (e) {
    console.warn("⚠️ AgendaLembrete hardening:", e.message);
  }
}

await _ensureAgendaLembreteHardening();

// ── Start schedulers ──────────────────────────────────────────────────────────
if (!IS_TEST && process.env.SCHEDULERS_ENABLED === "true") {
  startVencimentosScheduler();
  startVencidosScheduler();
  startGmailScheduler();
  startAgendaScheduler();
  startProcessosScheduler();
  startIntimacoesScheduler();
  startBriefingScheduler();
  startSaudeCaixaScheduler();
  startAndamentosIAScheduler();
  startSiteMonitorScheduler();
  startGoogleCalendarSync();
  startBoletosAgendadosScheduler();
  startBoletosSincronizadorScheduler();
  startPixSincronizadorScheduler();
  startInterPagamentosConfirmarScheduler();
}

// ============================================================
// SERVE FRONTEND (built React app — local tunnel only)
// ============================================================

const frontendDist = path.join(__dirname, "../../frontend/dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  // All non-API routes → SPA index.html
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// ============================================================
// ERROR HANDLERS
// ============================================================

app.use((req, res) => {
  res.status(404).json({ message: "Rota não encontrada." });
});

// Sentry error handler v8 (deve ficar após todas as rotas, antes do handler genérico)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use((err, req, res, next) => {
  // _sanitizeErrMsg redige connection strings/tokens antes de logar (#23)
  console.error("Erro não tratado:", _sanitizeErrMsg(err), process.env.NODE_ENV !== "production" ? err?.stack : "");
  res.status(500).json({ message: "Erro interno do servidor." });
});


// ============================================================
// START SERVER
// ============================================================

if (!IS_TEST) app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Servidor rodando na porta: ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);

  // ── Avisos de segurança na inicialização ──────────────────────────────────
  if (!process.env.WA_APP_SECRET) {
    console.warn("⚠️  SEGURANÇA: WA_APP_SECRET não configurado — webhook do WhatsApp aceita requisições sem validação de assinatura HMAC. Configure WA_APP_SECRET no .env para produção.");
  }

  // ── One-time data migrations ──────────────────────────────────────────────
  // 1) Padroniza nomes de contas: "Aplicação" → "Apl" (alinha com abreviação do PDF)
  try {
    const r = await prisma.$executeRaw`
      UPDATE "LivroCaixaConta"
      SET "nome" = REPLACE("nome", 'Aplicação', 'Apl')
      WHERE "nome" LIKE '%Aplicação%'
    `;
    if (r > 0) console.log(`✅ Contas renomeadas: ${r} (Aplicação → Apl)`);
  } catch (e) {
    console.warn("⚠️ Migration Apl rename:", e.message);
  }

  // 2) Garante que contas APLICACAO e BANCO existam em Clientes como tipo "A"
  //    (necessário para seleção em lançamentos manuais de rendimentos/taxas)
  try {
    const contasAB = await prisma.livroCaixaConta.findMany({
      where: { tipo: { in: ["APLICACAO", "BANCO"] }, ativa: true },
      select: { nome: true },
    });
    for (const c of contasAB) {
      await getOrCreatePessoaByNomeETipo(c.nome, "A");
    }
    if (contasAB.length > 0) {
      console.log(`✅ Clientes Apl/Banco garantidos: ${contasAB.map((c) => c.nome).join(", ")}`);
    }
  } catch (e) {
    console.warn("⚠️ Migration Apl/Banco clientes:", e.message);
  }

});

export default app;
