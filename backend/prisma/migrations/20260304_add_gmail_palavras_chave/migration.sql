CREATE TABLE "GmailPalavraChave" (
    "id"       SERIAL PRIMARY KEY,
    "palavra"  TEXT NOT NULL,
    "ativo"    BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GmailPalavraChave_palavra_key" UNIQUE ("palavra")
);

-- Seed: palavras-chave padrão
INSERT INTO "GmailPalavraChave" ("palavra") VALUES
  ('comprovante'),
  ('pagamento'),
  ('pix'),
  ('transferência'),
  ('recibo'),
  ('depósito'),
  ('quitação'),
  ('boleto');
