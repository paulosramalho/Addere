-- =============================================================
-- PIX INTER — SQL para Neon (rodar no SQL Editor do Neon)
-- Criado em: 2026-04-13
-- =============================================================

-- 1. Campo interContaId na tabela LivroCaixaConta
--    Identifica contas bancárias que são Banco Inter PJ.
--    Preencher com o ID da conta corrente no portal Inter PJ.
ALTER TABLE "LivroCaixaConta"
  ADD COLUMN IF NOT EXISTS "interContaId" TEXT;

-- 2. Tabela PixPagamento
CREATE TABLE IF NOT EXISTS "PixPagamento" (
  "id"                SERIAL PRIMARY KEY,
  "codigoSolicitacao" TEXT UNIQUE,           -- retornado pelo POST /banking/v2/pix (usado na consulta)
  "endToEndId"        TEXT,                  -- E2E ID Pix (disponível após processamento)
  "chavePix"          TEXT NOT NULL,
  "tipoChave"         TEXT,
  "favorecidoNome"    TEXT,
  "valorCentavos"     INT NOT NULL,
  "descricao"         TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PROCESSANDO',
  "repasseId"         INT,
  "advogadoId"        INT,
  "contaId"           INT REFERENCES "LivroCaixaConta"("id") ON DELETE SET NULL,
  "usuarioId"         INT NOT NULL,
  "erro"              TEXT,
  "dataPagamento"     TIMESTAMPTZ,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "PixPagamento_status_idx"     ON "PixPagamento"("status");
CREATE INDEX IF NOT EXISTS "PixPagamento_advogadoId_idx" ON "PixPagamento"("advogadoId");
CREATE INDEX IF NOT EXISTS "PixPagamento_createdAt_idx"  ON "PixPagamento"("createdAt" DESC);

-- Migração para tabela já existente (rodar se a tabela já foi criada sem codigoSolicitacao):
ALTER TABLE "PixPagamento"
  ADD COLUMN IF NOT EXISTS "codigoSolicitacao" TEXT UNIQUE,
  DROP CONSTRAINT IF EXISTS "PixPagamento_endToEndId_key";

-- =============================================================
-- APÓS rodar o SQL:
-- 1. No Render, adicionar env vars:
--    INTER_PIX_CLIENT_ID     = (id da integração Pix no Inter PJ)
--    INTER_PIX_CLIENT_SECRET = (secret da integração Pix no Inter PJ)
--    Os certificados podem ser os mesmos do boleto (INTER_CERT_B64 / INTER_KEY_B64).
--    Se a integração Pix usar certificados diferentes, adicionar:
--    INTER_PIX_CERT_B64 e INTER_PIX_KEY_B64.
--
-- 2. No portal Inter PJ, criar integração com escopos:
--    pagamento-pix.write  pagamento-pix.read  extrato.read
--
-- 3. Em Livro Caixa → Contas, preencher "ID Conta Inter" na conta
--    do Banco Inter PJ para habilitar Pix automático nos repasses.
--
-- 4. Em Advogados, preencher o campo "Chave Pix" de cada advogado.
-- =============================================================

Ajustes PIX Inter / Boleto Inter

Operações Bco. Inter
                   |
                   |__ Emitir Boleto
                   |
                   |__ Enviar Pix
                   |
         Verificar + posibilidade de desenvolvimento
         |         |                               |
         v         v                               v
                   |__ Pagar Boleto (código de barras)
                   |
                   |__ Pagar Darf


Início 📁 pix

Pix
Envio e recebimento de Pix via Banco Inter PJ

Enviados | Recebidos
|
|__Filtros (nome, período) Manter select Advogados e abrir textbox para pesquisa de clientes/fornecedores


===========================================================================================================
Para depois


Pagamento https://developers.inter.co/references/banking#tag/Pagamento/operation/pagarBoleto
Incluir pagamento com código de barras
Método para inclusão de um pagamento imediato ou agendamento do pagamento de boleto, convênio ou tributo com código de barras.

Importante: Dependendo das configurações da conta, este pagamento pode exigir aprovação manual antes da execução.
As configurações de aprovação podem ser ajustadas pelo usuário master via Internet Banking. Menu Superior > Aprovar > Gestão de Aprovações.

Escopo requerido: pagamento-boleto.write
Rate limite:
 120 chamadas por minuto
 10 chamadas por minuto
Obs: O token tem validade de 60 minutos e deverá ser reutilizado nas requisições.

cURL
#!/bin/zsh
  
URL_OAUTH="https://cdpj.partners.bancointer.com.br/oauth/v2/token"
  
D1="client_id=<clientId de sua aplicação>"
D2="client_secret=<clientSecret de sua aplicação>"
D3="scope=pagamento-boleto.write"
D4="grant_type=client_credentials"
DADOS=$D1\&$D2\&$D3\&$D4
  
OAUTH_TOKEN_RESPONSE=$(curl \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --cert <nome arquivo certificado>.crt \
  --key <nome arquivo chave privada>.key \
  -d $DADOS \
  $URL_OAUTH)
  
echo $OAUTH_TOKEN_RESPONSE
  
if [[ -z OAUTH_TOKEN_RESPONSE ]]
then
  echo Sem resposta do servico de OAuth, provavelmente estourou limite de chamadas por minuto...
  exit 1
fi
  
LINHA_TOKEN=$(echo $OAUTH_TOKEN_RESPONSE | grep -o '"[^"]*"\s*:\s*"*[^,"]*"*' | \
grep -E '^"(access_token)"' | \
tr '\n' ',' | \
sed 's/,$//')
  
TOKEN=$(echo $LINHA_TOKEN | cut -c18-53)
  
# ------------------------------------
# Pagar Boleto...
# ------------------------------------
  
URL_PAGAMENTO_BOLETO="https://cdpj.partners.bancointer.com.br/banking/v2/pagamento"
  
CORPO='{
    "codBarraLinhaDigitavel": "<linha digitável do boleto>",
    "valorPagar": 100.00,
    "dataPagamento": "2024-04-14",
    "dataVencimento": "2024-05-01"
}'
echo Corpo = $CORPO
  
BOLETO_PAGO=$(curl \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-conta-corrente: <conta corrente selecionada>" \
  --cert <nome arquivo certificado>.crt \
  --key <nome arquivo chave privada>.key \
  -d $CORPO \
  $URL_PAGAMENTO_BOLETO)
  
echo $BOLETO_PAGO
  
exit 0

++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

Incluir pagamento de DARF https://developers.inter.co/references/banking#tag/Pagamento/operation/pagamentosDarf
Método para inclusão de um pagamento imediato de DARF sem código de barras.

Importante: Dependendo das configurações da conta, este pagamento pode exigir aprovação manual antes da execução.
As configurações de aprovação podem ser ajustadas pelo usuário master via Internet Banking. Menu Superior > Aprovar > Gestão de Aprovações.

Escopo requerido: pagamento-darf.write
Rate limite:
 10 chamadas por minuto
 10 chamadas por minuto
Obs: O token tem validade de 60 minutos e deverá ser reutilizado nas requisições.
