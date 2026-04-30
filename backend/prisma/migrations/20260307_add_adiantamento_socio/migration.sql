-- CreateTable
CREATE TABLE "AdiantamentoSocio" (
    "id" SERIAL NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "competenciaAno" INTEGER NOT NULL,
    "competenciaMes" INTEGER NOT NULL,
    "valorPrevistoCentavos" INTEGER NOT NULL,
    "valorAdiantadoCentavos" INTEGER NOT NULL,
    "valorDevolvidoCentavos" INTEGER NOT NULL DEFAULT 0,
    "quitado" BOOLEAN NOT NULL DEFAULT false,
    "dataRegistro" TIMESTAMP(3) NOT NULL,
    "dataQuitacao" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdiantamentoSocio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdiantamentoSocio_advogadoId_idx" ON "AdiantamentoSocio"("advogadoId");

-- CreateIndex
CREATE INDEX "AdiantamentoSocio_competenciaAno_competenciaMes_idx" ON "AdiantamentoSocio"("competenciaAno", "competenciaMes");

-- AddForeignKey
ALTER TABLE "AdiantamentoSocio" ADD CONSTRAINT "AdiantamentoSocio_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdiantamentoSocio" ADD CONSTRAINT "AdiantamentoSocio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
