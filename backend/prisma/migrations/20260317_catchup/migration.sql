-- ============================================================
-- Catch-up migration: alterações aplicadas via SQL direto no
-- Neon entre 10/03/2026 e 17/03/2026.
-- Todos os comandos usam IF NOT EXISTS / IF EXISTS para ser
-- idempotentes caso a alteração já tenha sido aplicada.
-- ============================================================

-- 1. LivroCaixaConta: agencia e conta
ALTER TABLE "LivroCaixaConta"
  ADD COLUMN IF NOT EXISTS "agencia" TEXT,
  ADD COLUMN IF NOT EXISTS "conta"   TEXT;

-- 2. LivroCaixaLancamento: índices de performance
CREATE INDEX IF NOT EXISTS "LivroCaixaLancamento_origem_idx"
  ON "LivroCaixaLancamento"("origem");

CREATE INDEX IF NOT EXISTS "LivroCaixaLancamento_referenciaOrigem_idx"
  ON "LivroCaixaLancamento"("referenciaOrigem");

CREATE INDEX IF NOT EXISTS "LivroCaixaLancamento_es_statusFluxo_data_idx"
  ON "LivroCaixaLancamento"("es", "statusFluxo", "data");

-- 3. Usuario: 2FA TOTP
ALTER TABLE "Usuario"
  ADD COLUMN IF NOT EXISTS "totpSecret"  TEXT,
  ADD COLUMN IF NOT EXISTS "totpEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. WhatsAppBotState: estado do bot por telefone
CREATE TABLE IF NOT EXISTS "WhatsAppBotState" (
  "phone"      TEXT        NOT NULL PRIMARY KEY,
  "nivel"      INTEGER     NOT NULL DEFAULT 0,
  "aguardando" TEXT,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. SchedulerLock: evita dupla execução de schedulers após restart
CREATE TABLE IF NOT EXISTS "SchedulerLock" (
  "key"     TEXT NOT NULL PRIMARY KEY,
  "lastRun" DATE NOT NULL
);
