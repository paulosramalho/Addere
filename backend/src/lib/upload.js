import multer from "multer";
import { createWorker as _tesseractCreateWorker } from "tesseract.js";
import path from "path";

const IS_TEST = process.env.NODE_ENV === "test";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

/** Extrai texto de imagem PNG/JPG via OCR (Tesseract, idioma pt) */
export async function _extrairTextoImagem(buf) {
  const worker = await _tesseractCreateWorker("por");
  try {
    const { data: { text } } = await worker.recognize(buf);
    return text || "";
  } finally {
    await worker.terminate();
  }
}

// In-memory file store (chat attachments, session-limited)
export const _chatFiles = new Map(); // fileId -> { buffer, originalName, mimeType, size, uploaderId, createdAt }
export const CHAT_FILE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

// Limpeza periódica de arquivos expirados
if (!IS_TEST) setInterval(() => {
  const now = Date.now();
  for (const [fileId, meta] of _chatFiles.entries()) {
    if (now - meta.createdAt > CHAT_FILE_TTL_MS) _chatFiles.delete(fileId);
  }
}, 5 * 60 * 1000);

/**
 * Sanitiza mensagem de erro para logs — redige connection strings, tokens e senhas.
 */
export function _sanitizeErrMsg(err) {
  if (!err) return "Erro desconhecido";
  const raw = err?.message || String(err);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"']*/gi, "[DB_URL_REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "[TOKEN_REDACTED]")
    .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[REDACTED]"');
}

/**
 * Sanitiza nome de arquivo para uso em Content-Disposition (evita path traversal).
 */
export function _safeFilename(name) {
  const base = path.basename(String(name || "arquivo").replace(/\\/g, "/"));
  return base.replace(/[\x00-\x1f<>:"/|?*]/g, "_") || "arquivo";
}
