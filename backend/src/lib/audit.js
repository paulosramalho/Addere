import prisma from "./prisma.js";

export async function logAuditoria(req, acao, entidade, entidadeId, dadosAntes, dadosDepois) {
  try {
    await prisma.auditoriaLog.create({
      data: {
        usuarioId: req.user.id,
        acao,
        entidade,
        entidadeId: Number(entidadeId),
        dadosAntes: dadosAntes ?? undefined,
        dadosDepois: dadosDepois ?? undefined,
        ip: req.ip || null,
      },
    });
  } catch (_) { /* fire-and-forget */ }
}
