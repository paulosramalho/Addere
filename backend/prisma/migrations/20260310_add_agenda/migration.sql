-- CreateTable AgendaEvento (idempotente)
CREATE TABLE IF NOT EXISTS "AgendaEvento" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3),
    "tipo" TEXT NOT NULL DEFAULT 'COMPROMISSO',
    "prioridade" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "criadoPorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgendaEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable AgendaParticipante (idempotente)
CREATE TABLE IF NOT EXISTS "AgendaParticipante" (
    "id" SERIAL NOT NULL,
    "eventoId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "emailExterno" TEXT,
    "nomeExterno" TEXT,
    "whatsappExterno" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgendaParticipante_pkey" PRIMARY KEY ("id")
);

-- CreateTable AgendaLembrete (idempotente)
CREATE TABLE IF NOT EXISTS "AgendaLembrete" (
    "id" SERIAL NOT NULL,
    "eventoId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "emailExterno" TEXT,
    "antecedenciaMin" INTEGER NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'APP',
    "disparadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgendaLembrete_pkey" PRIMARY KEY ("id")
);

-- Indexes (idempotente)
CREATE INDEX IF NOT EXISTS "AgendaEvento_dataInicio_idx" ON "AgendaEvento"("dataInicio");
CREATE INDEX IF NOT EXISTS "AgendaEvento_status_idx" ON "AgendaEvento"("status");
CREATE INDEX IF NOT EXISTS "AgendaEvento_criadoPorId_idx" ON "AgendaEvento"("criadoPorId");
CREATE INDEX IF NOT EXISTS "AgendaLembrete_disparadoEm_idx" ON "AgendaLembrete"("disparadoEm");
CREATE INDEX IF NOT EXISTS "AgendaLembrete_eventoId_idx" ON "AgendaLembrete"("eventoId");

-- UniqueConstraint (idempotente)
DO $$ BEGIN
  ALTER TABLE "AgendaParticipante"
    ADD CONSTRAINT "AgendaParticipante_eventoId_usuarioId_key" UNIQUE ("eventoId", "usuarioId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ForeignKeys (idempotente)
DO $$ BEGIN
  ALTER TABLE "AgendaEvento"
    ADD CONSTRAINT "AgendaEvento_criadoPorId_fkey"
    FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AgendaParticipante"
    ADD CONSTRAINT "AgendaParticipante_eventoId_fkey"
    FOREIGN KEY ("eventoId") REFERENCES "AgendaEvento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AgendaParticipante"
    ADD CONSTRAINT "AgendaParticipante_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AgendaLembrete"
    ADD CONSTRAINT "AgendaLembrete_eventoId_fkey"
    FOREIGN KEY ("eventoId") REFERENCES "AgendaEvento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AgendaLembrete"
    ADD CONSTRAINT "AgendaLembrete_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
