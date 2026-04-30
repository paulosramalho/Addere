-- CreateEnum
CREATE TYPE "LivroCaixaOrigem" AS ENUM ('MANUAL', 'REPASSES_REALIZADOS');

-- CreateEnum
CREATE TYPE "LivroCaixaStatus" AS ENUM ('OK', 'PENDENTE_CONTA');

-- CreateTable
CREATE TABLE "LivroCaixaConta" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivroCaixaConta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivroCaixaSaldoInicial" (
    "id" SERIAL NOT NULL,
    "competenciaAno" INTEGER NOT NULL,
    "competenciaMes" INTEGER NOT NULL,
    "saldoInicialCent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivroCaixaSaldoInicial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivroCaixaLancamento" (
    "id" SERIAL NOT NULL,
    "competenciaAno" INTEGER NOT NULL,
    "competenciaMes" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "documento" TEXT,
    "es" TEXT NOT NULL,
    "clienteFornecedor" TEXT,
    "historico" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "contaId" INTEGER,
    "ordemDia" INTEGER NOT NULL DEFAULT 0,
    "origem" "LivroCaixaOrigem" NOT NULL DEFAULT 'MANUAL',
    "referenciaOrigem" TEXT,
    "status" "LivroCaixaStatus" NOT NULL DEFAULT 'OK',
    "localLabelFallback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivroCaixaLancamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LivroCaixaSaldoInicial_competenciaAno_competenciaMes_key" ON "LivroCaixaSaldoInicial"("competenciaAno", "competenciaMes");

-- CreateIndex
CREATE INDEX "LivroCaixaLancamento_competenciaAno_competenciaMes_idx" ON "LivroCaixaLancamento"("competenciaAno", "competenciaMes");

-- CreateIndex
CREATE INDEX "LivroCaixaLancamento_data_idx" ON "LivroCaixaLancamento"("data");

-- CreateIndex
CREATE INDEX "LivroCaixaLancamento_status_idx" ON "LivroCaixaLancamento"("status");

-- AddForeignKey
ALTER TABLE "LivroCaixaLancamento" ADD CONSTRAINT "LivroCaixaLancamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "LivroCaixaConta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
