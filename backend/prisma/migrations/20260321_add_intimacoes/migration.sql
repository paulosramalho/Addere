-- CreateTable Intimacao (idempotente)
CREATE TABLE IF NOT EXISTS "Intimacao" (
  "id"         SERIAL NOT NULL,
  "tribunal"   TEXT NOT NULL DEFAULT 'tjpa',
  "edicao"     INTEGER NOT NULL,
  "ano"        INTEGER NOT NULL,
  "texto"      TEXT NOT NULL,
  "termoBusca" TEXT NOT NULL,
  "advogadoId" INTEGER,
  "processoId" INTEGER,
  "lida"       BOOLEAN NOT NULL DEFAULT false,
  "notificado" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Intimacao_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "Intimacao_edicao_ano_idx"   ON "Intimacao"("edicao", "ano");
CREATE INDEX IF NOT EXISTS "Intimacao_advogadoId_idx"   ON "Intimacao"("advogadoId");
CREATE INDEX IF NOT EXISTS "Intimacao_lida_idx"         ON "Intimacao"("lida");
CREATE INDEX IF NOT EXISTS "Intimacao_notificado_idx"   ON "Intimacao"("notificado");

-- ForeignKeys (idempotente)
DO $$ BEGIN
  ALTER TABLE "Intimacao"
    ADD CONSTRAINT "Intimacao_advogadoId_fkey"
    FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Intimacao"
    ADD CONSTRAINT "Intimacao_processoId_fkey"
    FOREIGN KEY ("processoId") REFERENCES "ProcessoJudicial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
