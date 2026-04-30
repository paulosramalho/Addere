// lib/cryptoSeed.js — Criptografia AES-256-GCM para SEED PJe
// Chave derivada do JWT_SECRET via scrypt — sem env var adicional.

import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from "crypto";

function _key() {
  const secret = process.env.JWT_SECRET || "fallback-insecure-key";
  return scryptSync(secret, "amr-pje-seed-v1", 32);
}

/**
 * Criptografa o SEED PJe para armazenamento no banco.
 * Formato: base64( IV[12] + AuthTag[16] + Ciphertext )
 */
export function encryptSeed(plaintext) {
  const iv     = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", _key(), iv);
  const enc    = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Descriptografa o SEED armazenado no banco.
 * Retorna null se falhar (chave errada, dado corrompido).
 */
export function decryptSeed(ciphertext) {
  try {
    const buf      = Buffer.from(ciphertext, "base64");
    const iv       = buf.subarray(0, 12);
    const tag      = buf.subarray(12, 28);
    const enc      = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", _key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
