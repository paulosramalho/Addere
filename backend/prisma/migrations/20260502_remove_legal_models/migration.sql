-- Remoção de models jurídicos remanescentes do AMR (Fase 3.A)
-- Aplicar via Render Shell: `npx prisma migrate deploy` na raiz do backend.
-- IDEMPOTENTE: usa IF EXISTS / DROP CASCADE para tolerar estados parciais.

-- 1. Drop FK e colunas em ContratoPagamento
ALTER TABLE "ContratoPagamento"
  DROP COLUMN IF EXISTS "modeloDistribuicaoId";

-- 2. Drop FK e colunas em ParcelaContrato
ALTER TABLE "ParcelaContrato"
  DROP COLUMN IF EXISTS "modeloDistribuicaoId";

-- 3. Drop tabelas dependentes (em ordem reversa de dependência)
DROP TABLE IF EXISTS "Intimacao" CASCADE;
DROP TABLE IF EXISTS "ParcelaRepasseOverride" CASCADE;
DROP TABLE IF EXISTS "RepasseLinhaAdvogado" CASCADE;
DROP TABLE IF EXISTS "RepasseLinha" CASCADE;
DROP TABLE IF EXISTS "repasses_lancamentos" CASCADE;
DROP TABLE IF EXISTS "repasses_saldos" CASCADE;
DROP TABLE IF EXISTS "SaldoDestinatario" CASCADE;
DROP TABLE IF EXISTS "ContratoRepasseSplitAdvogado" CASCADE;
DROP TABLE IF EXISTS "ModeloDistribuicaoItem" CASCADE;
DROP TABLE IF EXISTS "ModeloDistribuicao" CASCADE;
