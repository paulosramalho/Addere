import { Router } from "express";
import prisma from "../lib/prisma.js";
import bcrypt from "bcryptjs";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { sendEmail, ADMIN_WHATSAPP, buildWhatsAppLink } from "../lib/email.js";

const router = Router();
const TIPOS_USUARIO_PERMITIDOS = new Set(["USUARIO", "ESTAGIARIO", "SECRETARIA_VIRTUAL", "EXTERNO", "INTERNO"]);

function normalizarTipoUsuario(value, fallback = "INTERNO") {
  const tipo = String(value || fallback).trim().toUpperCase();
  return TIPOS_USUARIO_PERMITIDOS.has(tipo) ? tipo : fallback;
}

// ============================================================
// USUÁRIOS
// ============================================================

// ✅ Perfil do usuário logado (para manutenção de dados pessoais)
router.get("/api/usuarios/me", authenticate, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, nome: true, email: true, telefone: true, cpf: true,
        tipoUsuario: true, role: true, ativo: true,
      },
    });
    if (!usuario) return res.status(404).json({ message: "Usuário não encontrado." });
    res.json(usuario);
  } catch (error) {
    console.error("Erro ao buscar perfil:", error);
    res.status(500).json({ message: "Erro ao buscar perfil." });
  }
});

router.patch("/api/usuarios/me", authenticate, async (req, res) => {
  try {
    const { telefone, senhaAtual, novaSenha, confirmarNovaSenha } = req.body;

    const data = {};
    if (telefone !== undefined) data.telefone = telefone.trim();

    // Troca de senha (opcional)
    if (novaSenha) {
      if (!senhaAtual) return res.status(400).json({ message: "Informe a senha atual." });
      if (novaSenha !== confirmarNovaSenha) return res.status(400).json({ message: "Nova senha e confirmação não coincidem." });
      if (novaSenha.length < 6) return res.status(400).json({ message: "A nova senha deve ter no mínimo 6 caracteres." });

      const usuario = await prisma.usuario.findUnique({ where: { id: req.user.id } });
      const senhaOk = await bcrypt.compare(senhaAtual, usuario.senha);
      if (!senhaOk) return res.status(400).json({ message: "Senha atual incorreta." });

      data.senha = await bcrypt.hash(novaSenha, 12);
    }

    await prisma.usuario.update({ where: { id: req.user.id }, data });
    res.json({ message: "Perfil atualizado com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    res.status(500).json({ message: "Erro ao atualizar perfil." });
  }
});

router.get("/api/usuarios", authenticate, requireAdmin, async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cpf: true,
        role: true,
        tipoUsuario: true,
        ghostAdmin: true,
        deveTrocarSenha: true,
        ativo: true,
        createdAt: true,
      },
      orderBy: { nome: "asc" },
    });
    res.json(usuarios);
  } catch (error) {
    console.error("Erro ao buscar usuários:", error);
    res.status(500).json({ message: "Erro ao buscar usuários." });
  }
});

router.post("/api/usuarios", authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      nome,
      email,
      senha,
      senhaConfirmacao,
      role,
      tipoUsuario,
      telefone,
      cpf,
      ghostAdmin,
      deveTrocarSenha,
    } = req.body || {};

    if (!nome || !email || !senha) {
      return res.status(400).json({
        message: "Nome, email e senha são obrigatórios",
      });
    }

    if (senha.length < 8) {
      return res.status(400).json({ message: "Senha deve ter no mínimo 8 caracteres." });
    }
    if (senhaConfirmacao && senha !== senhaConfirmacao) {
      return res.status(400).json({ message: "As senhas não conferem." });
    }

    const emailNorm = String(email).trim().toLowerCase();

    const existente = await prisma.usuario.findUnique({
      where: { email: emailNorm },
    });

    if (existente) {
      return res.status(400).json({
        message: "Este email já está em uso",
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const usuario = await prisma.usuario.create({
      data: {
        nome: String(nome).trim(),
        email: emailNorm,
        senhaHash,
        role: role || "USER",
        tipoUsuario: normalizarTipoUsuario(tipoUsuario),
        telefone: telefone ? String(telefone) : null,
        cpf: cpf ? String(cpf) : null,
        ghostAdmin: typeof ghostAdmin === "boolean" ? ghostAdmin : false,
        deveTrocarSenha: typeof deveTrocarSenha === "boolean" ? deveTrocarSenha : false,
        ativo: true,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cpf: true,
        role: true,
        tipoUsuario: true,
        ghostAdmin: true,
        deveTrocarSenha: true,
        ativo: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      message: "Usuário criado com sucesso",
      usuario,
    });
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    res.status(500).json({ message: "Erro ao criar usuário" });
  }
});

// ✅ ATUALIZAR USUÁRIO
router.put("/api/usuarios/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido." });

    const {
      nome,
      email,
      telefone,
      cpf,
      tipoUsuario,
      role,
      senha,
      senhaConfirmacao,
      ghostAdmin,
      deveTrocarSenha,
    } = req.body || {};

    const existente = await prisma.usuario.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ message: "Usuário não encontrado." });

    // validações básicas
    if (!nome || !String(nome).trim()) return res.status(400).json({ message: "Informe o nome." });
    if (!email || !String(email).trim()) return res.status(400).json({ message: "Informe o e-mail." });

    const emailNorm = String(email).trim().toLowerCase();

    // se mudou e-mail, checar unicidade
    if (emailNorm !== String(existente.email || "").toLowerCase()) {
      const outro = await prisma.usuario.findUnique({ where: { email: emailNorm } });
      if (outro) return res.status(400).json({ message: "Este email já está em uso" });
    }

    // senha (opcional na edição)
    let senhaHash = null;
    if (senha || senhaConfirmacao) {
      if (!senha || String(senha).length < 8) {
        return res.status(400).json({ message: "Nova senha deve ter no mínimo 8 caracteres." });
      }
      if (senha !== senhaConfirmacao) {
        return res.status(400).json({ message: "As senhas não conferem." });
      }
      senhaHash = await bcrypt.hash(String(senha), 10);
    }

    const usuario = await prisma.usuario.update({
      where: { id },
      data: {
        nome: String(nome).trim(),
        email: emailNorm,
        telefone: telefone ? String(telefone) : null,
        cpf: cpf ? String(cpf) : null,
        tipoUsuario: normalizarTipoUsuario(tipoUsuario, normalizarTipoUsuario(existente.tipoUsuario, "INTERNO")),
        role: role || existente.role,
        advogadoId: null,
        ghostAdmin: typeof ghostAdmin === "boolean" ? ghostAdmin : existente.ghostAdmin,
        deveTrocarSenha: typeof deveTrocarSenha === "boolean" ? deveTrocarSenha : existente.deveTrocarSenha,
        ...(senhaHash ? { senhaHash } : {}),
      },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cpf: true,
        tipoUsuario: true,
        role: true,
        ghostAdmin: true,
        deveTrocarSenha: true,
        ativo: true,
        createdAt: true,
      },
    });

    return res.json({
      message: "Usuário atualizado com sucesso", usuario });
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    return res.status(500).json({ message: "Erro ao atualizar usuário" });
  }
});

// ✅ ATIVAR / INATIVAR USUÁRIO
router.patch("/api/usuarios/:id/ativo", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido." });

    const { ativo } = req.body || {};
    if (typeof ativo !== "boolean") {
      return res.status(400).json({ message: "Campo 'ativo' deve ser boolean." });
    }

    // Busca status atual antes de atualizar
    const antes = await prisma.usuario.findUnique({
      where: { id },
      select: { ativo: true },
    });

    const usuario = await prisma.usuario.update({
      where: { id },
      data: { ativo },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        tipoUsuario: true,
        ativo: true,
      },
    });

    // Envia e-mail de ativação quando conta passa de inativa para ativa
    if (ativo && antes && !antes.ativo) {
      const waSnippet = ADMIN_WHATSAPP
        ? `<p style="margin-top:15px;">Precisa de ajuda? <a href="${buildWhatsAppLink("Olá, minha conta foi ativada no Addere On.")}" style="color:#25D366;font-weight:bold;">Entre em contato via WhatsApp</a></p>`
        : "";
      sendEmail({
        to: usuario.email,
        subject: "Conta ativada - Addere - Controles Financeiros",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
            <h2 style="color:#1e293b;">Bem-vindo(a) ao Addere - Controles Financeiro !</h2>
            <p>Olá <strong>${usuario.nome}</strong>,</p>
            <p>Sua conta foi ativada com sucesso. Você já pode acessar o sistema com o e-mail e senha cadastrados.</p>
            <p>Envie: CPF | OAB | Chave Pix, via chat, ao Administrador, no Notice Board do App, para completar seu cadastro.</p>
            ${waSnippet}
            <p style="margin-top:20px;color:#64748b;font-size:12px;">Este é um e-mail automático, não responda.</p>
          </div>
        `,
      }).catch(() => {}); // fire-and-forget
    }

    return res.json({ message: "Status atualizado com sucesso", usuario });
  } catch (error) {
    console.error("Erro ao alterar status do usuário:", error);
    return res.status(500).json({ message: "Erro ao alterar status do usuário" });
  }
});

export default router;
