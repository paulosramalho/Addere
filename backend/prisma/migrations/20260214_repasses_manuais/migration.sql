-- CreateEnum
CREATE TYPE "RepasseManualTipo" AS ENUM ('ADVOGADO', 'INDICACAO');

-- CreateTable
CREATE TABLE "repasses_manuais_lancamentos" (
    "id" SERIAL NOT NULL,
    "contratoId" INTEGER NOT NULL,
    "parcelaId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "tipo" "RepasseManualTipo" NOT NULL DEFAULT 'ADVOGADO',
    "competenciaAno" INTEGER NOT NULL,
    "competenciaMes" INTEGER NOT NULL,
    "valorPrevistoCentavos" INTEGER NOT NULL,
    "valorEfetivadoCentavos" INTEGER,
    "repasseRealizadoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repasses_manuais_lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repasses_manuais_lancamentos_competenciaAno_competenciaMes_idx" ON "repasses_manuais_lancamentos"("competenciaAno", "competenciaMes");

-- CreateIndex
CREATE INDEX "repasses_manuais_lancamentos_advogadoId_idx" ON "repasses_manuais_lancamentos"("advogadoId");

-- CreateIndex
CREATE INDEX "repasses_manuais_lancamentos_parcelaId_idx" ON "repasses_manuais_lancamentos"("parcelaId");

-- AddForeignKey
ALTER TABLE "repasses_manuais_lancamentos" ADD CONSTRAINT "repasses_manuais_lancamentos_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ContratoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_manuais_lancamentos" ADD CONSTRAINT "repasses_manuais_lancamentos_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "ParcelaContrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_manuais_lancamentos" ADD CONSTRAINT "repasses_manuais_lancamentos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_manuais_lancamentos" ADD CONSTRAINT "repasses_manuais_lancamentos_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_manuais_lancamentos" ADD CONSTRAINT "repasses_manuais_lancamentos_repasseRealizadoId_fkey" FOREIGN KEY ("repasseRealizadoId") REFERENCES "repasses_realizados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

