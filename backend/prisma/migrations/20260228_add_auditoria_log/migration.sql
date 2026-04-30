-- CreateTable
CREATE TABLE "AuditoriaLog" (
    "id"          SERIAL NOT NULL,
    "usuarioId"   INTEGER NOT NULL,
    "acao"        TEXT NOT NULL,
    "entidade"    TEXT NOT NULL,
    "entidadeId"  INTEGER NOT NULL,
    "dadosAntes"  JSONB,
    "dadosDepois" JSONB,
    "ip"          TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditoriaLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AuditoriaLog" ADD CONSTRAINT "AuditoriaLog_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AuditoriaLog_createdAt_idx" ON "AuditoriaLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditoriaLog_usuarioId_idx" ON "AuditoriaLog"("usuarioId");

-- CreateIndex
CREATE INDEX "AuditoriaLog_acao_idx" ON "AuditoriaLog"("acao");
