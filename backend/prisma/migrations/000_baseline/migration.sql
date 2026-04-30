-- CreateTable
CREATE TABLE "Advogado" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "oab" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "chavePix" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Advogado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aliquota" (
    "id" SERIAL NOT NULL,
    "mes" INTEGER NOT NULL,
    "ano" INTEGER NOT NULL,
    "percentualBp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Aliquota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" SERIAL NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "nomeRazaoSocial" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoPagamento" (
    "id" SERIAL NOT NULL,
    "numeroContrato" TEXT NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "formaPagamento" TEXT NOT NULL,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "modeloDistribuicaoId" INTEGER,
    "usaSplitSocio" BOOLEAN NOT NULL DEFAULT false,
    "repasseAdvogadoPrincipalId" INTEGER,
    "repasseIndicacaoAdvogadoId" INTEGER,
    "isentoTributacao" BOOLEAN NOT NULL DEFAULT false,
    "contratoOrigemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratoPagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoRepasseSplitAdvogado" (
    "id" SERIAL NOT NULL,
    "contratoId" INTEGER NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "percentualBp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContratoRepasseSplitAdvogado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloDistribuicao" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL DEFAULT 'REPASSE',
    "periodicidade" TEXT NOT NULL DEFAULT 'INCIDENTAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloDistribuicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloDistribuicaoItem" (
    "id" SERIAL NOT NULL,
    "modeloId" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "origem" TEXT NOT NULL,
    "periodicidade" TEXT NOT NULL,
    "destinoTipo" TEXT NOT NULL,
    "destinatario" TEXT,
    "percentualBp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloDistribuicaoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelaContrato" (
    "id" SERIAL NOT NULL,
    "contratoId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valorPrevisto" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVISTA',
    "dataRecebimento" TIMESTAMP(3),
    "valorRecebido" DECIMAL(12,2),
    "meioRecebimento" TEXT,
    "observacoes" TEXT,
    "canceladaEm" TIMESTAMP(3),
    "canceladaPorId" INTEGER,
    "cancelamentoMotivo" TEXT,
    "modeloDistribuicaoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelaContrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelaSplitAdvogado" (
    "id" SERIAL NOT NULL,
    "parcelaId" INTEGER NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "percentualBp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelaSplitAdvogado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepasseCompetencia" (
    "id" SERIAL NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "fechadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepasseCompetencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepasseLinha" (
    "id" SERIAL NOT NULL,
    "competenciaId" INTEGER NOT NULL,
    "contratoId" INTEGER NOT NULL,
    "parcelaId" INTEGER NOT NULL,
    "valorBrutoCentavos" INTEGER NOT NULL,
    "aliquotaUsadaBp" INTEGER NOT NULL,
    "impostoCentavos" INTEGER NOT NULL,
    "liquidoCentavos" INTEGER NOT NULL,
    "escritorioCentavos" INTEGER NOT NULL,
    "fundoReservaCentavos" INTEGER NOT NULL,
    "socioTotalCentavos" INTEGER NOT NULL,
    "confirmadoEm" TIMESTAMP(3),
    "confirmadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepasseLinha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepasseLinhaAdvogado" (
    "id" SERIAL NOT NULL,
    "repasseLinhaId" INTEGER NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "percentualBp" INTEGER NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepasseLinhaAdvogado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepassePagamento" (
    "id" SERIAL NOT NULL,
    "competenciaId" INTEGER NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "valorPrevisto" DECIMAL(12,2) NOT NULL,
    "valorEfetivado" DECIMAL(12,2),
    "saldoGerado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoUsado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dataRepasse" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepassePagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaldoDestinatario" (
    "id" SERIAL NOT NULL,
    "destinoTipo" TEXT NOT NULL,
    "destinoId" INTEGER NOT NULL,
    "saldoCentavos" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaldoDestinatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tipoUsuario" TEXT NOT NULL DEFAULT 'USUARIO',
    "cpf" TEXT,
    "telefone" TEXT,
    "advogadoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repasses_lancamentos" (
    "id" SERIAL NOT NULL,
    "repasseRealizadoId" INTEGER NOT NULL,
    "parcelaId" INTEGER NOT NULL,
    "contratoId" INTEGER NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "valorBrutoCentavos" INTEGER NOT NULL,
    "impostoCentavos" INTEGER NOT NULL,
    "liquidoCentavos" INTEGER NOT NULL,
    "valorRepasseCentavos" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repasses_lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repasses_realizados" (
    "id" SERIAL NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "competenciaAno" INTEGER NOT NULL,
    "competenciaMes" INTEGER NOT NULL,
    "referenciaAno" INTEGER NOT NULL,
    "referenciaMes" INTEGER NOT NULL,
    "valorPrevistoTotalCentavos" INTEGER NOT NULL,
    "valorEfetivadoCentavos" INTEGER NOT NULL,
    "dataRepasse" TIMESTAMP(3) NOT NULL,
    "observacoes" TEXT,
    "saldoAnteriorCentavos" INTEGER NOT NULL DEFAULT 0,
    "saldoGeradoCentavos" INTEGER NOT NULL DEFAULT 0,
    "saldoConsumidoCentavos" INTEGER NOT NULL DEFAULT 0,
    "saldoPosteriorCentavos" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repasses_realizados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repasses_saldos" (
    "id" SERIAL NOT NULL,
    "advogadoId" INTEGER NOT NULL,
    "saldoCentavos" INTEGER NOT NULL DEFAULT 0,
    "ultimaAtualizacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repasses_saldos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Advogado_cpf_key" ON "Advogado"("cpf" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Advogado_oab_key" ON "Advogado"("oab" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Aliquota_mes_ano_key" ON "Aliquota"("mes" ASC, "ano" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_cpfCnpj_key" ON "Cliente"("cpfCnpj" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ContratoPagamento_numeroContrato_key" ON "ContratoPagamento"("numeroContrato" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ContratoRepasseSplitAdvogado_contratoId_advogadoId_key" ON "ContratoRepasseSplitAdvogado"("contratoId" ASC, "advogadoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDistribuicao_codigo_key" ON "ModeloDistribuicao"("codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDistribuicaoItem_modeloId_ordem_key" ON "ModeloDistribuicaoItem"("modeloId" ASC, "ordem" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ParcelaContrato_contratoId_numero_key" ON "ParcelaContrato"("contratoId" ASC, "numero" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ParcelaSplitAdvogado_parcelaId_advogadoId_key" ON "ParcelaSplitAdvogado"("parcelaId" ASC, "advogadoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RepasseCompetencia_ano_mes_key" ON "RepasseCompetencia"("ano" ASC, "mes" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RepasseLinha_competenciaId_parcelaId_key" ON "RepasseLinha"("competenciaId" ASC, "parcelaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RepasseLinhaAdvogado_repasseLinhaId_advogadoId_key" ON "RepasseLinhaAdvogado"("repasseLinhaId" ASC, "advogadoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RepassePagamento_competenciaId_advogadoId_key" ON "RepassePagamento"("competenciaId" ASC, "advogadoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SaldoDestinatario_destinoTipo_destinoId_key" ON "SaldoDestinatario"("destinoTipo" ASC, "destinoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_advogadoId_key" ON "Usuario"("advogadoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email" ASC);

-- CreateIndex
CREATE INDEX "repasses_lancamentos_advogadoId_idx" ON "repasses_lancamentos"("advogadoId" ASC);

-- CreateIndex
CREATE INDEX "repasses_lancamentos_contratoId_idx" ON "repasses_lancamentos"("contratoId" ASC);

-- CreateIndex
CREATE INDEX "repasses_lancamentos_parcelaId_idx" ON "repasses_lancamentos"("parcelaId" ASC);

-- CreateIndex
CREATE INDEX "repasses_lancamentos_repasseRealizadoId_idx" ON "repasses_lancamentos"("repasseRealizadoId" ASC);

-- CreateIndex
CREATE INDEX "repasses_realizados_advogadoId_idx" ON "repasses_realizados"("advogadoId" ASC);

-- CreateIndex
CREATE INDEX "repasses_realizados_competenciaAno_competenciaMes_idx" ON "repasses_realizados"("competenciaAno" ASC, "competenciaMes" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "repasses_saldos_advogadoId_key" ON "repasses_saldos"("advogadoId" ASC);

-- AddForeignKey
ALTER TABLE "ContratoPagamento" ADD CONSTRAINT "ContratoPagamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoPagamento" ADD CONSTRAINT "ContratoPagamento_contratoOrigemId_fkey" FOREIGN KEY ("contratoOrigemId") REFERENCES "ContratoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoPagamento" ADD CONSTRAINT "ContratoPagamento_modeloDistribuicaoId_fkey" FOREIGN KEY ("modeloDistribuicaoId") REFERENCES "ModeloDistribuicao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoPagamento" ADD CONSTRAINT "ContratoPagamento_repasseAdvogadoPrincipalId_fkey" FOREIGN KEY ("repasseAdvogadoPrincipalId") REFERENCES "Advogado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoPagamento" ADD CONSTRAINT "ContratoPagamento_repasseIndicacaoAdvogadoId_fkey" FOREIGN KEY ("repasseIndicacaoAdvogadoId") REFERENCES "Advogado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoRepasseSplitAdvogado" ADD CONSTRAINT "ContratoRepasseSplitAdvogado_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoRepasseSplitAdvogado" ADD CONSTRAINT "ContratoRepasseSplitAdvogado_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ContratoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDistribuicaoItem" ADD CONSTRAINT "ModeloDistribuicaoItem_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloDistribuicao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaContrato" ADD CONSTRAINT "ParcelaContrato_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ContratoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaContrato" ADD CONSTRAINT "ParcelaContrato_modeloDistribuicaoId_fkey" FOREIGN KEY ("modeloDistribuicaoId") REFERENCES "ModeloDistribuicao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaSplitAdvogado" ADD CONSTRAINT "ParcelaSplitAdvogado_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaSplitAdvogado" ADD CONSTRAINT "ParcelaSplitAdvogado_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "ParcelaContrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepasseLinha" ADD CONSTRAINT "RepasseLinha_competenciaId_fkey" FOREIGN KEY ("competenciaId") REFERENCES "RepasseCompetencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepasseLinha" ADD CONSTRAINT "RepasseLinha_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ContratoPagamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepasseLinha" ADD CONSTRAINT "RepasseLinha_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "ParcelaContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepasseLinhaAdvogado" ADD CONSTRAINT "RepasseLinhaAdvogado_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepasseLinhaAdvogado" ADD CONSTRAINT "RepasseLinhaAdvogado_repasseLinhaId_fkey" FOREIGN KEY ("repasseLinhaId") REFERENCES "RepasseLinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepassePagamento" ADD CONSTRAINT "RepassePagamento_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepassePagamento" ADD CONSTRAINT "RepassePagamento_competenciaId_fkey" FOREIGN KEY ("competenciaId") REFERENCES "RepasseCompetencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_lancamentos" ADD CONSTRAINT "repasses_lancamentos_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_lancamentos" ADD CONSTRAINT "repasses_lancamentos_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ContratoPagamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_lancamentos" ADD CONSTRAINT "repasses_lancamentos_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "ParcelaContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_lancamentos" ADD CONSTRAINT "repasses_lancamentos_repasseRealizadoId_fkey" FOREIGN KEY ("repasseRealizadoId") REFERENCES "repasses_realizados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_realizados" ADD CONSTRAINT "repasses_realizados_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses_saldos" ADD CONSTRAINT "repasses_saldos_advogadoId_fkey" FOREIGN KEY ("advogadoId") REFERENCES "Advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

