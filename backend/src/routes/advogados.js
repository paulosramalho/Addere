import { Router } from "express";
import prisma from "../lib/prisma.js";
import bcrypt from "bcryptjs";
import { authenticate, requireAdmin, getUserAdvogadoId, invalidateAdvogadoIdCache } from "../lib/auth.js";
import { logAuditoria } from "../lib/audit.js";
import { encryptSeed, decryptSeed } from "../lib/cryptoSeed.js";

const router = Router();

// ============================================================
// ADVOGADOS
// ============================================================

// ✅ Perfil do advogado vinculado ao usuário logado
router.get("/api/advogados/me", authenticate, async (req, res) => {
  try {
    const advogadoId = await getUserAdvogadoId(req.user?.id);
    if (!advogadoId) {
      return res.status(404).json({ message: "Nenhum advogado vinculado a este usuário." });
    }
    const adv = await prisma.advogado.findUnique({
      where: { id: advogadoId },
      select: { id: true, nome: true, email: true, telefone: true, cpf: true, oab: true, chavePix: true, ehSocio: true, pjeSeed: true },
    });
    if (!adv) return res.status(404).json({ message: "Advogado não encontrado." });
    const { pjeSeed, ...advSafe } = adv;
    res.json({ ...advSafe, hasPjeSeed: !!pjeSeed });
  } catch (error) {
    console.error("Erro ao buscar perfil advogado:", error);
    res.status(500).json({ message: "Erro ao buscar perfil." });
  }
});

router.patch("/api/advogados/me", authenticate, async (req, res) => {
  try {
    const advogadoId = await getUserAdvogadoId(req.user?.id);
    if (!advogadoId) {
      return res.status(404).json({ message: "Nenhum advogado vinculado a este usuário." });
    }

    const { telefone, chavePix, senhaAtual, novaSenha, confirmarNovaSenha, pjeSeed } = req.body;

    // Monta update do advogado
    const advUpdate = {
      ...(telefone !== undefined ? { telefone: telefone.trim() } : {}),
      ...(chavePix !== undefined ? { chavePix: chavePix || null } : {}),
    };

    // SEED PJe — criptografa antes de salvar; string vazia limpa o campo
    if (pjeSeed !== undefined) {
      const seedClean = String(pjeSeed).replace(/\s+/g, "").toUpperCase();
      advUpdate.pjeSeed = seedClean ? encryptSeed(seedClean) : null;
    }

    // Atualiza dados do advogado
    await prisma.advogado.update({
      where: { id: advogadoId },
      data: advUpdate,
    });

    // Troca de senha (opcional)
    if (novaSenha) {
      if (!senhaAtual) return res.status(400).json({ message: "Informe a senha atual." });
      if (novaSenha !== confirmarNovaSenha) return res.status(400).json({ message: "Nova senha e confirmação não coincidem." });
      if (novaSenha.length < 6) return res.status(400).json({ message: "A nova senha deve ter no mínimo 6 caracteres." });

      const usuario = await prisma.usuario.findUnique({ where: { id: req.user.id } });
      const senhaOk = await bcrypt.compare(senhaAtual, usuario.senhaHash);
      if (!senhaOk) return res.status(400).json({ message: "Senha atual incorreta." });

      const hash = await bcrypt.hash(novaSenha, 12);
      await prisma.usuario.update({ where: { id: req.user.id }, data: { senhaHash: hash } });
    }

    res.json({ message: "Perfil atualizado com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar perfil advogado:", error);
    res.status(500).json({ message: "Erro ao atualizar perfil." });
  }
});

router.get("/api/advogados", authenticate, async (req, res) => {
  try {
    const advogados = await prisma.advogado.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        cpf: true,
        oab: true,
        email: true,
        telefone: true,
        chavePix: true,
        ativo: true,
        // ✅ NOVOS CAMPOS
        ehSocio: true,
        parcelaFixaAtiva: true,
        parcelaFixaValor: true,
        parcelaFixaTipo: true,
        parcelaFixaNome: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(advogados);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar advogados." });
  }
});

router.post("/api/advogados", authenticate, async (req, res) => {
  try {
    const {
      nome,
      cpf,
      oab,
      email,
      telefone,
      chavePix,
      // ✅ NOVOS CAMPOS
      ehSocio,
      parcelaFixaAtiva,
      parcelaFixaValor,
      parcelaFixaTipo,
      parcelaFixaNome,
      // ✅ CRIAÇÃO DE USUÁRIO
      criarUsuario,
      senha,
      confirmarSenha,
    } = req.body;

    // Validações de usuário antes de criar qualquer coisa
    if (criarUsuario) {
      if (!senha || String(senha).length < 6) {
        return res.status(400).json({ message: "Senha deve ter no mínimo 6 caracteres." });
      }
      if (senha !== confirmarSenha) {
        return res.status(400).json({ message: "Senha e confirmação não coincidem." });
      }
      const emailNorm = String(email || "").trim().toLowerCase();
      const emailExistente = await prisma.usuario.findUnique({ where: { email: emailNorm } });
      if (emailExistente) {
        return res.status(400).json({ message: "Já existe um usuário com este e-mail." });
      }
    }

    const advogado = await prisma.advogado.create({
      data: {
        nome,
        cpf,
        oab,
        email,
        telefone,
        chavePix,
        // ✅ NOVOS CAMPOS
        ehSocio: ehSocio ?? false,
        parcelaFixaAtiva: parcelaFixaAtiva ?? false,
        parcelaFixaValor: parcelaFixaValor ? parseFloat(parcelaFixaValor) : null,
        parcelaFixaTipo: parcelaFixaTipo || null,
        parcelaFixaNome: parcelaFixaNome || null,
      },
    });

    let usuario = null;
    if (criarUsuario) {
      const senhaHash = await bcrypt.hash(String(senha), 10);
      usuario = await prisma.usuario.create({
        data: {
          nome: String(nome).trim(),
          email: String(email).trim().toLowerCase(),
          senhaHash,
          role: "USER",
          tipoUsuario: "ADVOGADO",
          telefone: telefone ? String(telefone) : null,
          cpf: cpf ? String(cpf) : null,
          advogadoId: advogado.id,
          ativo: true,
        },
        select: {
          id: true,
          nome: true,
          email: true,
          role: true,
          tipoUsuario: true,
          advogadoId: true,
        },
      });
    }

    res.status(201).json({ ...advogado, usuario });
  } catch (error) {
    console.error("Erro ao criar advogado:", error);
    res.status(500).json({ message: "Erro ao criar advogado." });
  }
});

router.put("/api/advogados/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome,
      cpf,
      oab,
      email,
      telefone,
      chavePix,
      ehSocio,
      parcelaFixaAtiva,
      parcelaFixaValor,
      parcelaFixaTipo,
      parcelaFixaNome,
      senha,
      confirmarSenha,
    } = req.body;

    const antes = await prisma.advogado.findUnique({ where: { id: parseInt(id) }, select: { nome: true, cpf: true, oab: true, email: true, telefone: true, chavePix: true, ehSocio: true } });

    const advogado = await prisma.advogado.update({
      where: { id: parseInt(id) },
      data: {
        nome,
        cpf,
        oab,
        email,
        telefone,
        chavePix,
        ehSocio: ehSocio ?? false,
        parcelaFixaAtiva: parcelaFixaAtiva ?? false,
        parcelaFixaValor: parcelaFixaValor ? parseFloat(parcelaFixaValor) : null,
        parcelaFixaTipo: parcelaFixaTipo || null,
        parcelaFixaNome: parcelaFixaNome || null,
      },
    });

    // Atualizar senha do usuário vinculado (admin pode trocar senha de qualquer advogado)
    if (senha) {
      if (String(senha).length < 6) return res.status(400).json({ message: "A senha deve ter no mínimo 6 caracteres." });
      if (senha !== confirmarSenha) return res.status(400).json({ message: "Senha e confirmação não coincidem." });

      const adv = await prisma.advogado.findUnique({
        where: { id: parseInt(id) },
        select: { usuario: { select: { id: true } } },
      });
      if (adv?.usuario?.id) {
        const senhaHash = await bcrypt.hash(String(senha), 10);
        await prisma.usuario.update({ where: { id: adv.usuario.id }, data: { senhaHash } });
      }
    }

    logAuditoria(req, "EDITAR_ADVOGADO", "Advogado", advogado.id, antes, { nome, cpf, oab, email, telefone, chavePix, ehSocio }).catch(() => {});

    res.json(advogado);
  } catch (error) {
    console.error("Erro ao atualizar advogado:", error);
    res.status(500).json({ message: "Erro ao atualizar advogado." });
  }
});

router.patch("/api/advogados/:id/status", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { ativo } = req.body;
    if (typeof ativo !== "boolean") {
      return res.status(400).json({ message: "Informe { ativo: true/false }." });
    }
    const advogado = await prisma.advogado.update({
      where: { id: parseInt(id) },
      data: { ativo },
    });
    res.json(advogado);
  } catch (error) {
    console.error("Erro ao alterar status do advogado:", error);
    if (error.code === "P2025") return res.status(404).json({ message: "Advogado não encontrado." });
    res.status(500).json({ message: "Erro ao alterar status do advogado." });
  }
});

router.delete("/api/advogados/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.advogado.update({
      where: { id: parseInt(id) },
      data: { ativo: false },
    });

    res.json({ message: "Advogado desativado com sucesso." });
  } catch (error) {
    console.error("Erro ao desativar advogado:", error);
    res.status(500).json({ message: "Erro ao desativar advogado." });
  }
});

export default router;
