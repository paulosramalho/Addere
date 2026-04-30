-- prisma/migrations/XXXXXX_add_status_fluxo_livro_caixa/migration.sql

-- Step 1: Adicionar coluna statusFluxo (aceita NULL temporariamente)
ALTER TABLE "LivroCaixaLancamento" 
ADD COLUMN "statusFluxo" TEXT;

-- Step 2: Preencher valores padrão baseado na origem
UPDATE "LivroCaixaLancamento"
SET "statusFluxo" = CASE
  -- Pagamentos recebidos são sempre EFETIVADO
  WHEN "origem"::text = 'PAGAMENTO_RECEBIDO' THEN 'EFETIVADO'
  
  -- Repasses realizados são sempre EFETIVADO
  WHEN "origem"::text = 'REPASSES_REALIZADOS' THEN 'EFETIVADO'
  
  -- Manual assume EFETIVADO (usuário lançou o que já aconteceu)
  WHEN "origem"::text = 'MANUAL' THEN 'EFETIVADO'
  
  -- Qualquer outro caso (futuro) começa como PREVISTO
  ELSE 'PREVISTO'
END;

-- Step 3: Tornar coluna obrigatória
ALTER TABLE "LivroCaixaLancamento" 
ALTER COLUMN "statusFluxo" SET NOT NULL;

-- Step 4: Criar índice para performance
CREATE INDEX "LivroCaixaLancamento_statusFluxo_idx" 
ON "LivroCaixaLancamento"("statusFluxo");

-- Step 5: Criar índice composto para queries comuns
CREATE INDEX "LivroCaixaLancamento_competencia_status_idx" 
ON "LivroCaixaLancamento"("competenciaAno", "competenciaMes", "statusFluxo");

-- ✅ IMPORTANTE: Atualizar schema.prisma também:
-- 
-- model LivroCaixaLancamento {
--   ...
--   statusFluxo String @default("PREVISTO") // "PREVISTO" | "EFETIVADO"
--   ...
-- }