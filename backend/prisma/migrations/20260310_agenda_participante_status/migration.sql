-- AddColumns AgendaParticipante: status, motivoRecusa, dataAlternativaSugerida
ALTER TABLE "AgendaParticipante"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS "motivoRecusa" TEXT,
  ADD COLUMN IF NOT EXISTS "dataAlternativaSugerida" TIMESTAMP(3);
