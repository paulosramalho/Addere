import { Router } from "express";
import prisma from "../lib/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import QRCode from "qrcode";
import { authenticate, JWT_SECRET } from "../lib/auth.js";
import { totpGenerate, totpVerify, totpSecret, totpKeyUri } from "../lib/totp.js";
import { upload } from "../lib/upload.js";
import { sendEmail, buildWhatsAppLink, ADMIN_WHATSAPP } from "../lib/email.js";

const router = Router();

function maskEmailForLog(email) {
  const value = String(email || "");
  const [local, domain] = value.split("@");
  if (!local || !domain) return "(email-invalido)";
  return `${local.slice(0, 2)}***@${domain}`;
}

// ============================================================
// AUTH
// ============================================================

router.post("/api/auth/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    const emailNorm = String(email || "").trim().toLowerCase();

    const usuario = await prisma.usuario.findUnique({
      where: { email: emailNorm },
    });

    if (!usuario) {
      console.warn(`[auth] Login 401: usuario nao encontrado (${maskEmailForLog(emailNorm)})`);
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    if (!usuario.ativo) {
      console.warn(`[auth] Login 401: usuario inativo (${maskEmailForLog(emailNorm)})`);
      return res.status(401).json({ message: "Usuário inativo." });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);

    if (!senhaValida) {
      console.warn(`[auth] Login 401: senha invalida (${maskEmailForLog(emailNorm)})`);
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    // 2FA: se habilitado, emite tempToken e solicita código TOTP
    if (usuario.totpEnabled && usuario.totpSecret) {
      const tempToken = jwt.sign(
        { id: usuario.id, scope: "2fa" },
        JWT_SECRET,
        { expiresIn: "5m" }
      );
      return res.json({ requires2fa: true, tempToken });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        email: usuario.email,
        role: usuario.role,
        tipoUsuario: usuario.tipoUsuario,
        // ghostAdmin incluso para rastreabilidade nos logs de auditoria (#18)
        ghostAdmin: usuario.ghostAdmin || false,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        tipoUsuario: usuario.tipoUsuario,
        deveTrocarSenha: usuario.deveTrocarSenha,
        avatarUrl: usuario.avatarUrl,
      },
    });
  } catch (error) {
    console.error("Erro no login:", error?.message || String(error));
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

// ============================================================
// 2FA — TOTP (Google Authenticator / Authy)
// ============================================================

// POST /api/auth/2fa/verify-login — valida código TOTP após login (tempToken)
router.post("/api/auth/2fa/verify-login", async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ message: "Dados insuficientes." });

    let payload;
    try {
      payload = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Token expirado ou inválido. Faça login novamente." });
    }
    if (payload.scope !== "2fa") return res.status(401).json({ message: "Token inválido." });

    const usuario = await prisma.usuario.findUnique({ where: { id: payload.id } });
    if (!usuario || !usuario.ativo || !usuario.totpEnabled || !usuario.totpSecret) {
      return res.status(401).json({ message: "Autenticação inválida." });
    }

    const valid = totpVerify(code, usuario.totpSecret);
    if (!valid) return res.status(401).json({ message: "Código inválido ou expirado." });

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, role: usuario.role, tipoUsuario: usuario.tipoUsuario, ghostAdmin: usuario.ghostAdmin || false },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role, tipoUsuario: usuario.tipoUsuario, deveTrocarSenha: usuario.deveTrocarSenha, avatarUrl: usuario.avatarUrl },
    });
  } catch (e) {
    console.error("Erro 2FA verify-login:", e);
    res.status(500).json({ message: "Erro interno." });
  }
});

// POST /api/auth/2fa/setup — gera secret + QR code (admin autenticado)
router.post("/api/auth/2fa/setup", authenticate, async (req, res) => {
  try {
    if (String(req.user?.role || "").toUpperCase() !== "ADMIN") {
      return res.status(403).json({ message: "Apenas administradores podem configurar 2FA." });
    }
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user.id } });
    if (!usuario) return res.status(404).json({ message: "Usuário não encontrado." });
    if (usuario.totpEnabled) return res.status(400).json({ message: "2FA já está ativado. Desative antes de reconfigurar." });

    const secret = totpSecret();
    const otpAuthUrl = totpKeyUri(usuario.email, "Addere On", secret);
    const qrCodeUrl = await QRCode.toDataURL(otpAuthUrl);

    // Salva secret provisório (não habilitado ainda)
    await prisma.usuario.update({ where: { id: req.user.id }, data: { totpSecret: secret, totpEnabled: false } });

    res.json({ secret, qrCodeUrl });
  } catch (e) {
    console.error("Erro 2FA setup:", e);
    res.status(500).json({ message: "Erro interno." });
  }
});

// POST /api/auth/2fa/verify-setup — confirma código e ativa 2FA
router.post("/api/auth/2fa/verify-setup", authenticate, async (req, res) => {
  try {
    if (String(req.user?.role || "").toUpperCase() !== "ADMIN") {
      return res.status(403).json({ message: "Apenas administradores podem configurar 2FA." });
    }
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Informe o código." });

    const usuario = await prisma.usuario.findUnique({ where: { id: req.user.id } });
    if (!usuario?.totpSecret) return res.status(400).json({ message: "Inicie o setup primeiro." });
    if (usuario.totpEnabled) return res.status(400).json({ message: "2FA já está ativado." });

    const valid = totpVerify(code, usuario.totpSecret);
    if (!valid) return res.status(400).json({ message: "Código inválido. Tente novamente." });

    await prisma.usuario.update({ where: { id: req.user.id }, data: { totpEnabled: true } });
    res.json({ message: "2FA ativado com sucesso." });
  } catch (e) {
    console.error("Erro 2FA verify-setup:", e);
    res.status(500).json({ message: "Erro interno." });
  }
});

// POST /api/auth/2fa/disable — desativa 2FA (exige código TOTP atual)
router.post("/api/auth/2fa/disable", authenticate, async (req, res) => {
  try {
    if (String(req.user?.role || "").toUpperCase() !== "ADMIN") {
      return res.status(403).json({ message: "Apenas administradores podem configurar 2FA." });
    }
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Informe o código atual do autenticador." });

    const usuario = await prisma.usuario.findUnique({ where: { id: req.user.id } });
    if (!usuario?.totpEnabled || !usuario?.totpSecret) {
      return res.status(400).json({ message: "2FA não está ativado." });
    }

    const valid = totpVerify(code, usuario.totpSecret);
    if (!valid) return res.status(400).json({ message: "Código inválido." });

    await prisma.usuario.update({ where: { id: req.user.id }, data: { totpEnabled: false, totpSecret: null } });
    res.json({ message: "2FA desativado." });
  } catch (e) {
    console.error("Erro 2FA disable:", e);
    res.status(500).json({ message: "Erro interno." });
  }
});

// GET /api/auth/2fa/status — retorna se 2FA está ativo para o usuário logado
router.get("/api/auth/2fa/status", authenticate, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      select: { totpEnabled: true },
    });
    res.json({ totpEnabled: usuario?.totpEnabled || false });
  } catch (e) {
    res.status(500).json({ message: "Erro interno." });
  }
});

// ============================================================
// POST /api/auth/forgot-password - Solicitar recuperação de senha
// ============================================================
router.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: "Informe o e-mail." });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const usuario = await prisma.usuario.findUnique({
      where: { email: emailNorm },
    });

    // Sempre retorna sucesso para não revelar se o email existe
    if (!usuario || !usuario.ativo) {
      return res.json({
        success: true,
        message: "Se o e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.",
      });
    }

    // Gera senha temporária (8 caracteres alfanuméricos — criptograficamente seguro)
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const randomBytes = crypto.randomBytes(8);
    let tempPassword = "";
    for (let i = 0; i < 8; i++) {
      tempPassword += chars.charAt(randomBytes[i] % chars.length);
    }

    // Atualiza a senha e marca para trocar no próximo login
    const senhaHash = await bcrypt.hash(tempPassword, 10);
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        senhaHash,
        deveTrocarSenha: true,
      },
    });

    console.log(`🔑 Senha temporária gerada para ${usuario.email}`);

    // Criar notificação para admin (mensagem interna + e-mail)
    try {
      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { id: true, email: true },
      });

      const waLink = buildWhatsAppLink(`Olá, solicitei recuperação de senha no sistema Addere. Meu e-mail: ${usuario.email}`);

      for (const admin of admins) {
        try {
          await prisma.mensagemChat.create({
            data: {
              remetenteId: usuario.id,
              destinatarioId: admin.id,
              conteudo: `🔑 Solicitação de recuperação de senha.\n\nUsuário: ${usuario.nome}\nE-mail: ${usuario.email}\nSenha temporária: ${tempPassword}\n\n⚠️ O usuário deverá trocar a senha no próximo login.`,
              tipoMensagem: "CADASTRO",
            },
          });
        } catch (chatErr) {
          console.error("Erro ao criar mensagem chat (forgot-password):", chatErr);
        }

        // E-mail para admin
        await sendEmail({
          to: admin.email,
          subject: `🔑 Recuperação de senha - ${usuario.nome}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <h2 style="color:#1e3a5f;">Addere - Recuperação de Senha</h2>
              <p>O usuário <strong>${usuario.nome}</strong> (${usuario.email}) solicitou recuperação de senha.</p>
              <div style="background:#f8f9fa;border-left:4px solid #f59e0b;padding:15px;margin:15px 0;border-radius:4px;">
                <p style="margin:0;"><strong>Senha temporária:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:3px;">${tempPassword}</code></p>
              </div>
              <p style="color:#6b7280;font-size:14px;">O usuário deverá trocar a senha no próximo login.</p>
              ${waLink ? `<p style="margin-top:15px;"><a href="${waLink}" style="background:#25D366;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">💬 WhatsApp do Usuário</a></p>` : ""}
            </div>
          `,
        });
      }
    } catch (msgErr) {
      console.error("Erro ao notificar admins:", msgErr);
    }

    // E-mail para o solicitante confirmando o pedido
    await sendEmail({
      to: usuario.email,
      subject: "🔑 Recuperação de senha - Addere On",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e3a5f;">Addere - Recuperação de Senha</h2>
          <p>Olá <strong>${usuario.nome}</strong>,</p>
          <p>Recebemos sua solicitação de recuperação de senha.</p>
          <p>Uma senha temporária foi gerada e enviada ao administrador do sistema. Assim que aprovada, você poderá acessar o sistema com a nova senha.</p>
          <p style="color:#6b7280;font-size:14px;">Ao entrar, você será solicitado a criar uma nova senha.</p>
          ${ADMIN_WHATSAPP ? `<p style="margin-top:15px;">Precisa de ajuda? <a href="${buildWhatsAppLink("Olá, solicitei recuperação de senha no Addere.")}" style="color:#25D366;font-weight:bold;">Entre em contato via WhatsApp</a></p>` : ""}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p style="color:#9ca3af;font-size:12px;">Addere - Sistema de Gestão Financeira</p>
        </div>
      `,
    });

    res.json({
      success: true,
      message: "Solicitação enviada! Verifique seu e-mail para mais informações.",
    });
  } catch (error) {
    console.error("Erro ao recuperar senha:", error);
    res.status(500).json({ message: "Erro ao processar solicitação." });
  }
});

// ============================================================
// POST /api/auth/register - Solicitar cadastro de novo usuário
// ============================================================
router.post("/api/auth/register", async (req, res) => {
  try {
    const { nome, email, senha, telefone } = req.body;

    // Validações
    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ message: "Informe o nome completo." });
    }
    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: "Informe o e-mail." });
    }
    if (!senha || String(senha).length < 6) {
      return res.status(400).json({ message: "A senha deve ter no mínimo 6 caracteres." });
    }

    const emailNorm = String(email).trim().toLowerCase();

    // Verifica se email já existe
    const existente = await prisma.usuario.findUnique({
      where: { email: emailNorm },
    });

    if (existente) {
      return res.status(400).json({ message: "Este e-mail já está cadastrado." });
    }

    // Cria usuário INATIVO (precisa aprovação do admin)
    const senhaHash = await bcrypt.hash(senha, 10);
    const novoUsuario = await prisma.usuario.create({
      data: {
        nome: String(nome).trim(),
        email: emailNorm,
        senhaHash,
        telefone: telefone ? String(telefone).trim() : null,
        role: "USER",
        tipoUsuario: "EXTERNO",
        ativo: false, // Aguarda aprovação
        deveTrocarSenha: false,
      },
    });

    // Notifica admins sobre novo cadastro (mensagem interna + e-mail)
    try {
      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { id: true, email: true },
      });

      const waLink = buildWhatsAppLink(`Olá, acabei de solicitar cadastro no sistema Addere. Meu nome: ${novoUsuario.nome}, e-mail: ${novoUsuario.email}`);

      // Mensagem broadcast no chat (visível para todos na sala principal)
      try {
        await prisma.mensagemChat.create({
          data: {
            remetenteId: novoUsuario.id,
            destinatarioId: null, // broadcast - aparece na sala principal
            conteudo: `👤 Nova solicitação de cadastro.\n\nNome: ${novoUsuario.nome}\nE-mail: ${novoUsuario.email}\nTelefone: ${novoUsuario.telefone || "Não informado"}\n\n⚠️ Aguardando aprovação. Acesse Configurações > Usuários para ativar.`,
            tipoMensagem: "CADASTRO",
          },
        });
      } catch (chatErr) {
        console.error("Erro ao criar mensagem chat (register):", chatErr);
      }

      for (const admin of admins) {
        // E-mail para admin
        await sendEmail({
          to: admin.email,
          subject: `👤 Novo cadastro - ${novoUsuario.nome}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <h2 style="color:#1e3a5f;">Addere - Nova Solicitação de Cadastro</h2>
              <p>Um novo usuário solicitou cadastro no sistema:</p>
              <div style="background:#f8f9fa;border-left:4px solid #3b82f6;padding:15px;margin:15px 0;border-radius:4px;">
                <p style="margin:5px 0;"><strong>Nome:</strong> ${novoUsuario.nome}</p>
                <p style="margin:5px 0;"><strong>E-mail:</strong> ${novoUsuario.email}</p>
                <p style="margin:5px 0;"><strong>Telefone:</strong> ${novoUsuario.telefone || "Não informado"}</p>
              </div>
              <p style="color:#f59e0b;font-weight:bold;">⚠️ Aguardando aprovação.</p>
              <p>Acesse <strong>Configurações &gt; Usuários</strong> no sistema para ativar este usuário.</p>
              ${waLink ? `<p style="margin-top:15px;"><a href="${waLink}" style="background:#25D366;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">💬 WhatsApp do Usuário</a></p>` : ""}
            </div>
          `,
        });
      }
    } catch (msgErr) {
      console.error("Erro ao notificar admins:", msgErr);
    }

    // E-mail de confirmação para o solicitante
    await sendEmail({
      to: novoUsuario.email,
      subject: "👤 Cadastro solicitado - Addere On",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e3a5f;">Addere - Cadastro Recebido</h2>
          <p>Olá <strong>${novoUsuario.nome}</strong>,</p>
          <p>Sua solicitação de cadastro foi recebida com sucesso!</p>
          <p>O administrador será notificado e ativará sua conta em breve. Você receberá acesso assim que o cadastro for aprovado.</p>
          ${ADMIN_WHATSAPP ? `<p style="margin-top:15px;">Precisa de ajuda? <a href="${buildWhatsAppLink("Olá, acabei de solicitar cadastro no Addere.")}" style="color:#25D366;font-weight:bold;">Entre em contato via WhatsApp</a></p>` : ""}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p style="color:#9ca3af;font-size:12px;">Addere - Sistema de Gestão Financeira</p>
        </div>
      `,
    });

    console.log(`👤 Novo cadastro solicitado: ${novoUsuario.nome} (${novoUsuario.email})`);

    res.status(201).json({
      success: true,
      message: "Cadastro solicitado com sucesso! Verifique seu e-mail para confirmação.",
    });
  } catch (error) {
    console.error("Erro ao registrar usuário:", error);
    res.status(500).json({ message: "Erro ao processar cadastro." });
  }
});

router.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        tipoUsuario: true,
        ativo: true,
        deveTrocarSenha: true,
        avatarUrl: true,
      },
    });

    if (!usuario) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    res.json(usuario);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar usuário." });
  }
});

// PUT /api/auth/avatar - Upload de avatar do usuário
router.put("/api/auth/avatar", authenticate, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Nenhum arquivo enviado." });
    }

    // Verifica se é uma imagem
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: "Tipo de arquivo não permitido. Use JPG, PNG, GIF ou WebP." });
    }

    // Converte para base64 data URL
    const base64 = req.file.buffer.toString("base64");
    const avatarUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Atualiza o usuário
    const usuario = await prisma.usuario.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        tipoUsuario: true,
        avatarUrl: true,
      },
    });

    res.json({ message: "Avatar atualizado com sucesso.", usuario });
  } catch (error) {
    console.error("Erro ao atualizar avatar:", error);
    res.status(500).json({ message: "Erro ao atualizar avatar." });
  }
});

// DELETE /api/auth/avatar - Remove avatar do usuário
router.delete("/api/auth/avatar", authenticate, async (req, res) => {
  try {
    await prisma.usuario.update({
      where: { id: req.user.id },
      data: { avatarUrl: null },
    });

    res.json({ message: "Avatar removido com sucesso." });
  } catch (error) {
    console.error("Erro ao remover avatar:", error);
    res.status(500).json({ message: "Erro ao remover avatar." });
  }
});

export default router;
