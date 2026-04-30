-- AddColumn monitorado em ProcessoJudicial
ALTER TABLE "ProcessoJudicial"
  ADD COLUMN IF NOT EXISTS "monitorado" BOOLEAN NOT NULL DEFAULT true;
