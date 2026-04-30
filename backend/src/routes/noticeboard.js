import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { upload, _chatFiles, CHAT_FILE_TTL_MS, _safeFilename } from "../lib/upload.js";
import { sendWhatsApp, _mimeToWATipo } from "../lib/whatsapp.js";
import bcrypt from "bcryptjs";

const router = Router();

router.get("/api/noticeboard/usuarios", authenticate, async (req, res) => {
  try {
    const requesterIsAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";

    const usuarios = await prisma.usuario.findMany({
      where: { ativo: true },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        ghostAdmin: true,
        avatarUrl: true,
        tipoUsuario: true,
        presenca: {
          select: {
            online: true,
            digitando: true,
            digitandoPara: true,
            ultimaAtividade: true,
          },
        },
      },
      orderBy: { nome: "asc" },
    });

    res.json(usuarios.map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      // Ghost admin: aparece como USER para não-admins
      role: (!requesterIsAdmin && u.ghostAdmin) ? "USER" : u.role,
      avatarUrl: u.avatarUrl || null,
      tipoUsuario: u.tipoUsuario || null,
      online: u.presenca?.online ?? false,
      digitando: u.presenca?.digitando ?? false,
      digitandoPara: u.presenca?.digitandoPara ?? null,
      ultimaAtividade: u.presenca?.ultimaAtividade ?? null,
    })));
  } catch (error) {
    console.error("❌ Erro ao listar usuários NoticeBoard:", error);
    res.status(500).json({ message: error.message || "Erro ao listar usuários." });
  }
});

// PUT /api/noticeboard/presenca - Atualiza status de presença
router.put("/api/noticeboard/presenca", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { online, digitando, digitandoPara } = req.body;

    const presenca = await prisma.presencaUsuario.upsert({
      where: { usuarioId: userId },
      update: {
        online: online ?? true,
        digitando: digitando ?? false,
        digitandoPara: digitandoPara ?? null,
        ultimaAtividade: new Date(),
      },
      create: {
        usuarioId: userId,
        online: online ?? true,
        digitando: digitando ?? false,
        digitandoPara: digitandoPara ?? null,
      },
    });

    res.json(presenca);
  } catch (error) {
    console.error("❌ Erro ao atualizar presença:", error);
    res.status(500).json({ message: error.message || "Erro ao atualizar presença." });
  }
});

// GET /api/noticeboard/mensagens - Lista mensagens do chat
router.get("/api/noticeboard/mensagens", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { destinatarioId, tipoMensagem, limit = 50, since } = req.query;

    let where = tipoMensagem
      ? { tipoMensagem }
      : { tipoMensagem: { in: ["CHAT", "CADASTRO"] } };
    if (destinatarioId) {
      // Conversa privada entre dois usuários
      const destId = Number(destinatarioId);
      where = {
        ...where,
        OR: [
          { remetenteId: userId, destinatarioId: destId },
          { remetenteId: destId, destinatarioId: userId },
        ],
      };
    } else {
      // Todas as mensagens que o usuário pode ver (broadcast ou destinadas a ele ou enviadas por ele)
      where = {
        ...where,
        OR: [
          { destinatarioId: null }, // broadcast
          { destinatarioId: userId }, // para o usuário
          { remetenteId: userId }, // do usuário
        ],
      };
    }

    const requesterIsAdminMsg = String(req.user?.role || "").toUpperCase() === "ADMIN";

    // Polling incremental: só mensagens após 'since'
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate)) where.createdAt = { gt: sinceDate };
    }

    const mensagens = await prisma.mensagemChat.findMany({
      where,
      orderBy: { createdAt: "desc" },
      // since: sem limite (poucas msgs entre polls); initial load: máx 50
      take: since ? undefined : Math.min(Number(limit), 50),
      include: {
        remetente: {
          // avatarUrl excluído — frontend busca do /noticeboard/usuarios (evita repetir base64 por msg)
          select: { id: true, nome: true, email: true, role: true, tipoUsuario: true, ghostAdmin: true },
        },
        destinatario: {
          select: { id: true, nome: true, email: true, role: true, ghostAdmin: true },
        },
        leituras: {
          where: { usuarioId: userId },
        },
        replyTo: {
          select: {
            id: true,
            conteudo: true,
            remetente: { select: { id: true, nome: true } },
          },
        },
        reacoes: {
          include: { usuario: { select: { id: true, nome: true } } },
        },
      },
    });

    // Para mensagens privadas ENVIADAS pelo usuário: verificar se foram lidas pelo destinatário
    const mySentPrivateIds = mensagens
      .filter(m => m.remetenteId === userId && m.destinatarioId != null)
      .map(m => m.id);
    const readByDestSet = new Set();
    if (mySentPrivateIds.length > 0) {
      const readRecords = await prisma.mensagemLeitura.findMany({
        where: { mensagemId: { in: mySentPrivateIds }, usuarioId: { not: userId } },
        select: { mensagemId: true },
      });
      for (const r of readRecords) readByDestSet.add(r.mensagemId);
    }

    res.json(mensagens.reverse().map((m) => {
      // Mask ghost admin role for non-admin requesters
      const rem = m.remetente ? { ...m.remetente } : null;
      const dest = m.destinatario ? { ...m.destinatario } : null;
      if (!requesterIsAdminMsg) {
        if (rem?.ghostAdmin) rem.role = "USER";
        if (dest?.ghostAdmin) dest.role = "USER";
      }
      if (rem) delete rem.ghostAdmin;
      if (dest) delete dest.ghostAdmin;
      return {
        ...m,
        remetente: rem,
        destinatario: dest,
        mencionados: m.mencionados ? (() => { try { return JSON.parse(m.mencionados); } catch { return []; } })() : [],
        lidoPorMim: m.leituras.length > 0,
        confirmadoPorMim: m.leituras.some((l) => l.confirmadaEm !== null),
        lidoPeloDestinatario: m.remetenteId === userId && m.destinatarioId != null
          ? readByDestSet.has(m.id)
          : undefined,
      };
    })); // Ordena do mais antigo para o mais recente
  } catch (error) {
    console.error("❌ Erro ao listar mensagens:", error);
    res.status(500).json({ message: error.message || "Erro ao listar mensagens." });
  }
});

// POST /api/noticeboard/mensagens - Envia uma mensagem
router.post("/api/noticeboard/mensagens", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { conteudo, destinatarioId, requerConfirmacao, replyToId } = req.body;

    if (!conteudo || !conteudo.trim()) {
      return res.status(400).json({ message: "Conteúdo da mensagem é obrigatório." });
    }

    // Parse @mentions from content
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(conteudo)) !== null) {
      mentions.push(match[1]);
    }

    // Find user IDs for mentions
    let mencionadosIds = [];
    if (mentions.length > 0) {
      const usuariosMencionados = await prisma.usuario.findMany({
        where: {
          OR: mentions.map((m) => ({
            nome: { contains: m, mode: "insensitive" },
          })),
        },
        select: { id: true },
      });
      mencionadosIds = usuariosMencionados.map((u) => u.id);
    }

    const mensagem = await prisma.mensagemChat.create({
      data: {
        remetenteId: userId,
        destinatarioId: destinatarioId ? Number(destinatarioId) : null,
        conteudo: conteudo.trim(),
        tipoMensagem: "CHAT",
        mencionados: mencionadosIds.length > 0 ? JSON.stringify(mencionadosIds) : null,
        requerConfirmacao: !!requerConfirmacao,
        replyToId: replyToId ? Number(replyToId) : null,
      },
      include: {
        remetente: {
          select: { id: true, nome: true, email: true, role: true, tipoUsuario: true },
        },
        destinatario: {
          select: { id: true, nome: true, email: true, role: true },
        },
      },
    });

    // Atualiza presença para parar de digitar
    await prisma.presencaUsuario.upsert({
      where: { usuarioId: userId },
      update: { digitando: false, digitandoPara: null, ultimaAtividade: new Date() },
      create: { usuarioId: userId, online: true },
    });

    res.status(201).json({
      ...mensagem,
      mencionados: mencionadosIds,
    });
  } catch (error) {
    console.error("❌ Erro ao enviar mensagem:", error);
    res.status(500).json({ message: error.message || "Erro ao enviar mensagem." });
  }
});

// PUT /api/noticeboard/mensagens/marcar-lidas - Marca várias mensagens como lidas (batch)
router.put("/api/noticeboard/mensagens/marcar-lidas", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { mensagemIds } = req.body;
    if (!Array.isArray(mensagemIds) || mensagemIds.length === 0) {
      return res.json({ marcadas: 0 });
    }
    const ids = mensagemIds.map(Number).filter(Boolean);

    // Só pode marcar mensagens destinadas ao usuário (privadas) ou broadcast (destinatarioId = null)
    const validas = await prisma.mensagemChat.findMany({
      where: {
        id: { in: ids },
        OR: [{ destinatarioId: userId }, { destinatarioId: null }],
      },
      select: { id: true },
    });

    await Promise.all(validas.map(m =>
      prisma.mensagemLeitura.upsert({
        where: { mensagemId_usuarioId: { mensagemId: m.id, usuarioId: userId } },
        update: {},
        create: { mensagemId: m.id, usuarioId: userId },
      })
    ));

    res.json({ marcadas: validas.length });
  } catch (error) {
    console.error("❌ Erro ao marcar mensagens como lidas:", error);
    res.status(500).json({ message: "Erro ao marcar mensagens como lidas" });
  }
});

// PUT /api/noticeboard/mensagens/:id/lida - Marca mensagem como lida
router.put("/api/noticeboard/mensagens/:id/lida", authenticate, async (req, res) => {
  try {
    const mensagemId = Number(req.params.id);
    const userId = req.user.id;

    const mensagem = await prisma.mensagemChat.findUnique({
      where: { id: mensagemId },
    });

    if (!mensagem) {
      return res.status(404).json({ message: "Mensagem não encontrada." });
    }

    // Só marca como lida se for destinatário
    if (mensagem.destinatarioId !== userId && mensagem.destinatarioId !== null) {
      return res.status(403).json({ message: "Sem permissão para marcar esta mensagem como lida." });
    }

    const updated = await prisma.mensagemChat.update({
      where: { id: mensagemId },
      data: { lida: true },
    });

    res.json(updated);
  } catch (error) {
    console.error("❌ Erro ao marcar mensagem como lida:", error);
    res.status(500).json({ message: error.message || "Erro ao marcar mensagem como lida." });
  }
});

// GET /api/noticeboard/vencimentos - Parcelas e lançamentos pendentes (admin only)
router.get("/api/noticeboard/vencimentos", authenticate, requireAdmin, async (req, res) => {
  try {
    const nowUTC = new Date();
    const brtNow = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);
    const hoje = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), brtNow.getUTCDate(), 3, 0, 0)); // meia-noite BRT
    const em5Dias = new Date(hoje.getTime() + 5 * 24 * 60 * 60 * 1000);

    // Parcelas próximas, hoje ou atrasadas
    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "PREVISTA",
        vencimento: {
          lte: em5Dias,
        },
      },
      include: {
        contrato: {
          include: {
            cliente: {
              select: { id: true, nomeRazaoSocial: true, tipo: true },
            },
          },
        },
      },
      orderBy: { vencimento: "asc" },
    });

    // Lançamentos manuais pendentes (statusFluxo = PREVISTO), excluindo PARCELA_PREVISTA (já listada acima)
    const lancamentosManuais = await prisma.livroCaixaLancamento.findMany({
      where: {
        statusFluxo: "PREVISTO",
        origem: { not: "PARCELA_PREVISTA" },
        data: {
          lte: em5Dias,
        },
      },
      include: {
        conta: true,
      },
      orderBy: { data: "asc" },
    });

    const hojeStr = hoje.toISOString().split("T")[0];

    // Mapeia parcelas
    const resultadoParcelas = parcelas.map((p) => {
      const vencStr = new Date(p.vencimento).toISOString().split("T")[0];
      let grupo = "";

      if (vencStr < hojeStr) {
        grupo = "Atrasada";
      } else if (vencStr === hojeStr) {
        grupo = "Vencimento hoje";
      } else {
        grupo = "Próximo do vencimento";
      }

      return {
        id: p.id,
        tipo: "parcela",
        contratoId: p.contratoId,
        numeroContrato: p.contrato.numeroContrato,
        numero: p.numero,
        vencimento: p.vencimento,
        valorPrevisto: p.valorPrevisto,
        status: p.status,
        cliente: p.contrato.cliente,
        grupo,
      };
    });

    // Mapeia lançamentos manuais
    const resultadoLancamentos = lancamentosManuais.map((l) => {
      const dataStr = new Date(l.data).toISOString().split("T")[0];
      let grupo = "";

      if (dataStr < hojeStr) {
        grupo = "Atrasada";
      } else if (dataStr === hojeStr) {
        grupo = "Vencimento hoje";
      } else {
        grupo = "Próximo do vencimento";
      }

      return {
        id: `lanc-${l.id}`,
        tipo: "lancamento",
        vencimento: l.data,
        valorPrevisto: l.valorCentavos / 100,
        historico: l.historico,
        es: l.es,
        cliente: { nomeRazaoSocial: l.clienteFornecedor || l.historico },
        conta: l.conta?.nome,
        grupo,
      };
    });

    // Combina resultados
    const resultado = [...resultadoParcelas, ...resultadoLancamentos];
    resultado.sort((a, b) => new Date(a.vencimento) - new Date(b.vencimento));

    // Agrupa
    const grupos = {
      "Atrasada": resultado.filter((r) => r.grupo === "Atrasada"),
      "Vencimento hoje": resultado.filter((r) => r.grupo === "Vencimento hoje"),
      "Próximo do vencimento": resultado.filter((r) => r.grupo === "Próximo do vencimento"),
    };

    res.json({
      total: resultado.length,
      grupos,
      parcelas: resultado,
    });
  } catch (error) {
    console.error("❌ Erro ao buscar vencimentos:", error);
    res.status(500).json({ message: error.message || "Erro ao buscar vencimentos." });
  }
});

// GET /api/noticeboard/vencimentos-hoje - Parcelas e lançamentos do dia para modal de login (admin only)
router.get("/api/noticeboard/vencimentos-hoje", authenticate, requireAdmin, async (req, res) => {
  try {
    // Usa data de "hoje" no fuso horário do Brasil (UTC-3)
    const nowUTC = new Date();
    const brtNow = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);
    const hoje = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), brtNow.getUTCDate(), 3, 0, 0));
    const amanha = new Date(hoje.getTime() + 24 * 60 * 60 * 1000);

    // Parcelas de contratos
    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "PREVISTA",
        vencimento: {
          gte: hoje,
          lt: amanha,
        },
      },
      include: {
        contrato: {
          include: {
            cliente: {
              select: { id: true, nomeRazaoSocial: true },
            },
          },
        },
      },
      orderBy: { vencimento: "asc" },
    });

    // Lançamentos manuais pendentes do dia (exclui espelhos de parcela já listados acima)
    const lancamentosManuais = await prisma.livroCaixaLancamento.findMany({
      where: {
        statusFluxo: "PREVISTO",
        origem: { not: "PARCELA_PREVISTA" },
        data: {
          gte: hoje,
          lt: amanha,
        },
      },
      include: {
        conta: true,
      },
      orderBy: { data: "asc" },
    });

    // Mapeia parcelas
    const resultParcelas = parcelas.map((p) => ({
      id: p.id,
      tipo: "parcela",
      contratoId: p.contratoId,
      numeroContrato: p.contrato.numeroContrato,
      numero: p.numero,
      vencimento: p.vencimento,
      valorPrevisto: p.valorPrevisto,
      cliente: p.contrato.cliente?.nomeRazaoSocial || "—",
    }));

    // Mapeia lançamentos manuais
    const resultLancamentos = lancamentosManuais.map((l) => ({
      id: `lanc-${l.id}`,
      tipo: "lancamento",
      vencimento: l.data,
      valorPrevisto: l.valorCentavos / 100,
      cliente: l.clienteFornecedor || l.historico || "—",
      es: l.es,
      historico: l.historico,
      conta: l.conta?.nome,
    }));

    // Combina resultados
    const todosPendentes = [...resultParcelas, ...resultLancamentos];

    res.json({
      total: todosPendentes.length,
      parcelas: todosPendentes,
    });
  } catch (error) {
    console.error("❌ Erro ao buscar vencimentos do dia:", error);
    res.status(500).json({ message: error.message || "Erro ao buscar vencimentos do dia." });
  }
});

// ============================================================
// SECRETÁRIA VIRTUAL - AVISOS E CADASTRO
// ============================================================

// GET /api/noticeboard/avisos - Lista avisos (mensagens tipo AVISO)
router.get("/api/noticeboard/avisos", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50 } = req.query;

    const avisos = await prisma.mensagemChat.findMany({
      where: {
        tipoMensagem: "AVISO",
        OR: [
          { destinatarioId: null }, // broadcast
          { destinatarioId: userId }, // para o usuário
        ],
      },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      include: {
        remetente: {
          select: { id: true, nome: true, role: true },
        },
        leituras: {
          where: { usuarioId: userId },
        },
      },
    });

    res.json(avisos.reverse().map((a) => ({
      ...a,
      lidoPorMim: a.leituras.length > 0,
      confirmadoPorMim: a.leituras.some((l) => l.confirmadaEm !== null),
      mencionados: a.mencionados ? (() => { try { return JSON.parse(a.mencionados); } catch { return []; } })() : [],
    })));
  } catch (error) {
    console.error("❌ Erro ao listar avisos:", error);
    res.status(500).json({ message: error.message || "Erro ao listar avisos." });
  }
});

// POST /api/noticeboard/avisos - Criar aviso (todos os usuários)
router.post("/api/noticeboard/avisos", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { conteudo, mencionados, requerConfirmacao } = req.body;

    if (!conteudo || !conteudo.trim()) {
      return res.status(400).json({ message: "Conteúdo do aviso é obrigatório." });
    }

    // Parse mencionados do conteúdo (@nome)
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(conteudo)) !== null) {
      mentions.push(match[1]);
    }

    // Encontrar IDs dos usuários mencionados
    let mencionadosIds = mencionados || [];
    if (mentions.length > 0) {
      const usuariosMencionados = await prisma.usuario.findMany({
        where: {
          OR: mentions.map((m) => ({
            nome: { contains: m, mode: "insensitive" },
          })),
        },
        select: { id: true },
      });
      mencionadosIds = [...new Set([...mencionadosIds, ...usuariosMencionados.map((u) => u.id)])];
    }

    const aviso = await prisma.mensagemChat.create({
      data: {
        remetenteId: userId,
        destinatarioId: null, // broadcast
        conteudo: conteudo.trim(),
        tipoMensagem: "AVISO",
        mencionados: mencionadosIds.length > 0 ? JSON.stringify(mencionadosIds) : null,
        requerConfirmacao: !!requerConfirmacao,
      },
      include: {
        remetente: {
          select: { id: true, nome: true, role: true },
        },
      },
    });

    res.status(201).json(aviso);
  } catch (error) {
    console.error("❌ Erro ao criar aviso:", error);
    res.status(500).json({ message: error.message || "Erro ao criar aviso." });
  }
});

// POST /api/noticeboard/mensagens/:id/reagir - Adiciona/remove reação emoji
router.post("/api/noticeboard/mensagens/:id/reagir", authenticate, async (req, res) => {
  try {
    const mensagemId = Number(req.params.id);
    const usuarioId  = req.user.id;
    const { emoji }  = req.body;
    if (!emoji || typeof emoji !== "string" || emoji.length > 20)
      return res.status(400).json({ message: "Emoji inválido." });
    const existing = await prisma.mensagemReacao.findUnique({
      where: { mensagemId_usuarioId_emoji: { mensagemId, usuarioId, emoji } },
    });
    if (existing) {
      await prisma.mensagemReacao.delete({ where: { id: existing.id } });
      return res.json({ acao: "removida", emoji });
    }
    await prisma.mensagemReacao.create({ data: { mensagemId, usuarioId, emoji } });
    res.json({ acao: "adicionada", emoji });
  } catch (error) {
    console.error("❌ Erro ao reagir:", error);
    res.status(500).json({ message: error.message || "Erro ao reagir." });
  }
});

// POST /api/noticeboard/mensagens/:id/confirmar - Confirmar leitura de mensagem
router.post("/api/noticeboard/mensagens/:id/confirmar", authenticate, async (req, res) => {
  try {
    const mensagemId = Number(req.params.id);
    const userId = req.user.id;

    const mensagem = await prisma.mensagemChat.findUnique({
      where: { id: mensagemId },
    });

    if (!mensagem) {
      return res.status(404).json({ message: "Mensagem não encontrada." });
    }

    const leitura = await prisma.mensagemLeitura.upsert({
      where: {
        mensagemId_usuarioId: { mensagemId, usuarioId: userId },
      },
      update: {
        confirmadaEm: new Date(),
      },
      create: {
        mensagemId,
        usuarioId: userId,
        confirmadaEm: new Date(),
      },
    });

    res.json(leitura);
  } catch (error) {
    console.error("❌ Erro ao confirmar leitura:", error);
    res.status(500).json({ message: error.message || "Erro ao confirmar leitura." });
  }
});

// GET /api/noticeboard/mensagens/:id/leituras - Obter leituras de uma mensagem
router.get("/api/noticeboard/mensagens/:id/leituras", authenticate, async (req, res) => {
  try {
    const mensagemId = Number(req.params.id);

    const leituras = await prisma.mensagemLeitura.findMany({
      where: { mensagemId },
      include: {
        usuario: {
          select: { id: true, nome: true },
        },
      },
      orderBy: { lidaEm: "asc" },
    });

    res.json(leituras);
  } catch (error) {
    console.error("❌ Erro ao buscar leituras:", error);
    res.status(500).json({ message: error.message || "Erro ao buscar leituras." });
  }
});

// POST /api/noticeboard/cadastro-cliente - Cadastrar cliente via chat (Secretária Virtual)
router.post("/api/noticeboard/cadastro-cliente", authenticate, async (req, res) => {
  try {
    const { nome, email, telefone, cpfCnpj, chavePix } = req.body;

    if (!nome || !cpfCnpj) {
      return res.status(400).json({ message: "Nome e CPF/CNPJ são obrigatórios." });
    }

    // Verificar se já existe
    const existente = await prisma.cliente.findUnique({
      where: { cpfCnpj: cpfCnpj.replace(/\D/g, "") },
    });

    if (existente) {
      return res.status(400).json({ message: "Cliente já cadastrado com este CPF/CNPJ." });
    }

    const cliente = await prisma.cliente.create({
      data: {
        nomeRazaoSocial: nome.trim(),
        cpfCnpj: cpfCnpj.replace(/\D/g, ""),
        email: email || null,
        telefone: telefone || null,
        observacoes: chavePix ? `PIX: ${chavePix}` : null,
        tipo: "C", // Cliente
      },
    });

    res.status(201).json(cliente);
  } catch (error) {
    console.error("❌ Erro ao cadastrar cliente:", error);
    res.status(500).json({ message: error.message || "Erro ao cadastrar cliente." });
  }
});

// PUT /api/auth/trocar-senha - Trocar senha (para primeiro acesso)
router.put("/api/auth/trocar-senha", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { senhaAtual, novaSenha } = req.body;

    if (!novaSenha || novaSenha.length < 6) {
      return res.status(400).json({ message: "Nova senha deve ter pelo menos 6 caracteres." });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: userId } });
    if (!usuario) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    // Se deveTrocarSenha é true, não precisa validar senha atual
    if (!usuario.deveTrocarSenha) {
      if (!senhaAtual) {
        return res.status(400).json({ message: "Senha atual é obrigatória." });
      }
      const senhaValida = await bcrypt.compare(senhaAtual, usuario.senhaHash);
      if (!senhaValida) {
        return res.status(401).json({ message: "Senha atual incorreta." });
      }
    }

    const novaHash = await bcrypt.hash(novaSenha, 10);

    await prisma.usuario.update({
      where: { id: userId },
      data: {
        senhaHash: novaHash,
        deveTrocarSenha: false,
      },
    });

    res.json({ message: "Senha alterada com sucesso." });
  } catch (error) {
    console.error("❌ Erro ao trocar senha:", error);
    res.status(500).json({ message: error.message || "Erro ao trocar senha." });
  }
});

// POST /api/noticeboard/setup-secretaria - Criar usuário Secretária Virtual (admin only)
router.post("/api/noticeboard/setup-secretaria", authenticate, requireAdmin, async (req, res) => {
  try {
    const email = "secretaria@amr.com.br";

    // Verificar se já existe
    let secretaria = await prisma.usuario.findUnique({ where: { email } });

    if (secretaria) {
      return res.json({ message: "Secretária Virtual já existe.", usuario: secretaria });
    }

    // Criar a Secretária Virtual
    const senhaHash = await bcrypt.hash("Teste123", 10);

    secretaria = await prisma.usuario.create({
      data: {
        nome: "Secretária Virtual",
        email,
        senhaHash,
        role: "USER",
        tipoUsuario: "SECRETARIA_VIRTUAL",
        deveTrocarSenha: true,
        ativo: true,
      },
    });

    res.status(201).json({
      message: "Secretária Virtual criada com sucesso.",
      usuario: {
        id: secretaria.id,
        nome: secretaria.nome,
        email: secretaria.email,
        tipoUsuario: secretaria.tipoUsuario,
      },
    });
  } catch (error) {
    console.error("❌ Erro ao criar Secretária Virtual:", error);
    res.status(500).json({ message: error.message || "Erro ao criar Secretária Virtual." });
  }
});

// ============================================================
// CHAT FILE UPLOAD / DOWNLOAD (session-limited, in-memory)
// ============================================================

// POST /api/noticeboard/upload - Upload de arquivo para chat
router.post("/api/noticeboard/upload", authenticate, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Nenhum arquivo enviado." });
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (req.file.size > MAX_SIZE) {
      return res.status(400).json({ message: "Arquivo muito grande. Máximo 10MB." });
    }

    const fileId = crypto.randomUUID();
    _chatFiles.set(fileId, {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploaderId: req.user.id,
      createdAt: Date.now(),
    });

    res.status(201).json({
      fileId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (error) {
    console.error("❌ Erro ao fazer upload:", error);
    res.status(500).json({ message: error.message || "Erro ao fazer upload." });
  }
});

// GET /api/noticeboard/files/:fileId - Download de arquivo do chat
router.get("/api/noticeboard/files/:fileId", authenticate, (req, res) => {
  try {
    const { fileId } = req.params;
    const meta = _chatFiles.get(fileId);

    if (!meta) {
      return res.status(404).json({ message: "Arquivo não encontrado ou expirado." });
    }

    res.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(_safeFilename(meta.originalName))}"`);
    res.setHeader("Content-Length", meta.size);
    res.send(meta.buffer);
  } catch (error) {
    console.error("❌ Erro ao baixar arquivo:", error);
    res.status(500).json({ message: error.message || "Erro ao baixar arquivo." });
  }
});

export default router;
