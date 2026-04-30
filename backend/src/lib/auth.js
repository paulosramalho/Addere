import jwt from "jsonwebtoken";
import prisma from "./prisma.js";

export const JWT_SECRET = process.env.JWT_SECRET;

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token não fornecido." });
  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token inválido." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Autenticação necessária." });
  if (String(req.user.role || "").toUpperCase() !== "ADMIN") {
    return res.status(403).json({ message: "Acesso negado. Requer permissão de administrador." });
  }
  next();
}

export const authenticateToken = authenticate;
export const requireAuth = authenticate;

// Cache simples para advogadoId do usuário (evita queries repetidas em polling)
const _advogadoIdCache = new Map();

export async function getUserAdvogadoId(userId) {
  const key = Number(userId);
  if (!key) return null;
  const cached = _advogadoIdCache.get(key);
  if (cached && Date.now() - cached.ts < 60_000) return cached.val;
  const u = await prisma.usuario.findUnique({ where: { id: key }, select: { advogadoId: true } });
  const val = u?.advogadoId ?? null;
  _advogadoIdCache.set(key, { val, ts: Date.now() });
  return val;
}

/** Invalida cache de advogadoId para um usuário específico */
export function invalidateAdvogadoIdCache(userId) {
  _advogadoIdCache.delete(Number(userId));
}
