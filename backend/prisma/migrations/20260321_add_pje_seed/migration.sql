-- Migration: adiciona campo pjeSeed ao Advogado
-- SEED PJe criptografado (AES-256-GCM) para geração automática de TOTP

ALTER TABLE "Advogado" ADD COLUMN IF NOT EXISTS "pjeSeed" TEXT;
