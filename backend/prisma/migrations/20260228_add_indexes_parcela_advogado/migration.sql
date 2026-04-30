-- CreateIndex
CREATE INDEX "ParcelaContrato_status_idx" ON "ParcelaContrato"("status");

-- CreateIndex
CREATE INDEX "ParcelaContrato_status_vencimento_idx" ON "ParcelaContrato"("status", "vencimento");

-- CreateIndex
CREATE INDEX "Advogado_ativo_idx" ON "Advogado"("ativo");
