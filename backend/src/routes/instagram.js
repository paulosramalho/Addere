/**
 * Instagram Messaging API — Inbox + Webhook
 *
 * Pré-requisitos (Meta):
 *  - Conta @amradvogados_ como Instagram Professional (Business/Creator)
 *  - Facebook Page vinculada ao Instagram
 *  - Meta App com produto "Instagram" habilitado
 *  - Permissões: instagram_manage_messages, instagram_basic
 *  - Webhook subscription: "messages" dentro do produto Instagram
 *
 * Env vars:
 *   IG_PAGE_ACCESS_TOKEN  — Page Access Token com permissões IG
 *   IG_VERIFY_TOKEN       — Token livre para verificação do webhook
 *   IG_APP_SECRET         — App Secret para validação HMAC (opcional mas recomendado)
 */

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { sendWhatsApp, sendWhatsAppTemplate } from "../lib/whatsapp.js";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const IG_TOKEN = (process.env.IG_PAGE_ACCESS_TOKEN || "").replace(/\s/g, "");
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;
const IG_APP_SECRET = process.env.IG_APP_SECRET;
const IG_ACCOUNT_ID = process.env.IG_ACCOUNT_ID || "17841403945970110"; // @amradvogados_
const IG_API = "https://graph.instagram.com/v21.0";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

console.log(`📸 IG init: token_len=${IG_TOKEN.length} account=${IG_ACCOUNT_ID}`);

const router = Router();

// ── Helpers de envio ──────────────────────────────────────────────────────────

async function _igSend(igUserId, text) {
  if (!IG_TOKEN) { console.warn("⚠️ IG_PAGE_ACCESS_TOKEN não configurado"); return false; }
  try {
    const res = await fetch(`${IG_API}/${IG_ACCOUNT_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${IG_TOKEN}` },
      body: JSON.stringify({
        recipient: { id: igUserId },
        message: { text },
        messaging_type: "RESPONSE",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`❌ IG send error para ${igUserId}:`, JSON.stringify(err?.error || err));
      return false;
    }
    return true;
  } catch (e) {
    console.error(`❌ IG send exception:`, e.message);
    return false;
  }
}

// Busca perfil do usuário via Graph API (best-effort, cache em conversa)
// Nota: para IGSID do Messaging API, os campos disponíveis são name e profile_pic.
// "username" NÃO é suportado para IGSID — apenas para IG Business Account ID.
async function _igGetProfile(igUserId) {
  if (!IG_TOKEN) return {};
  try {
    const res = await fetch(`${IG_API}/${igUserId}?fields=name,profile_pic`, { headers: { "Authorization": `Bearer ${IG_TOKEN}` } });
    const data = await res.json();
    if (data.error) {
      console.warn(`⚠️ IG profile fetch erro para ${igUserId}:`, data.error.message);
      return {};
    }
    console.log(`📸 IG profile de ${igUserId}:`, JSON.stringify(data));
    return {
      username:   null, // não disponível via IGSID no Messaging API
      nome:       data.name || null,
      fotoPerfil: data.profile_pic || null,
    };
  } catch (e) {
    console.warn(`⚠️ IG profile fetch exception ${igUserId}:`, e.message);
    return {};
  }
}

// Compat (usado em lugares antigos)
async function _igGetUsername(igUserId) {
  const p = await _igGetProfile(igUserId);
  return p.username || null;
}

// ── Bot cliente (Claude) ───────────────────────────────────────────────────────

async function _igBotReply(texto, historico) {
  if (!anthropic) return null;

  // Tentar identificar cliente por CPF ou nome no histórico
  let clienteId = null;
  const textos = historico.map(m => m.conteudo).concat(texto);
  for (const t of textos) {
    const digits = String(t || "").replace(/\D/g, "");
    const cpfMatch = digits.match(/\d{11}/);
    if (cpfMatch) {
      const c = await prisma.cliente.findFirst({
        where: { cpfCnpj: { contains: cpfMatch[0] }, ativo: true },
        select: { id: true },
      });
      if (c) { clienteId = c.id; break; }
    }
  }
  if (!clienteId) {
    for (const t of textos) {
      const words = String(t || "").trim().split(/\s+/).filter(w => w.length >= 2 && /^[A-Za-zÀ-ÿ]/.test(w));
      if (words.length < 2) continue;
      const busca = words.slice(0, 4).join(" ");
      const cs = await prisma.cliente.findMany({
        where: { nomeRazaoSocial: { contains: busca, mode: "insensitive" }, ativo: true },
        select: { id: true },
        take: 1,
      });
      if (cs.length) { clienteId = cs[0].id; break; }
    }
  }

  // Contexto de parcelas se cliente identificado
  let ctxParcelas = "";
  if (clienteId) {
    const [cliente, pendentes, pagas] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { nomeRazaoSocial: true } }),
      prisma.parcelaContrato.findMany({
        where: { contrato: { clienteId }, status: { in: ["PREVISTA", "PENDENTE"] } },
        orderBy: { vencimento: "asc" }, take: 4,
        select: { numero: true, vencimento: true, valorPrevisto: true },
      }),
      prisma.parcelaContrato.findMany({
        where: { contrato: { clienteId }, status: "RECEBIDA" },
        orderBy: { dataRecebimento: "desc" }, take: 3,
        select: { numero: true, dataRecebimento: true, valorRecebido: true },
      }),
    ]);
    const fmt = v => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const fmtD = d => d ? new Date(d).toLocaleDateString("pt-BR") : "?";
    ctxParcelas = cliente
      ? `\nCliente identificado: ${cliente.nomeRazaoSocial}\nParcelas pendentes: ${pendentes.map(p => `Parc.${p.numero} venc.${fmtD(p.vencimento)} ${fmt(p.valorPrevisto)}`).join(", ") || "nenhuma"}\nÚltimos pagamentos: ${pagas.map(p => `Parc.${p.numero} em ${fmtD(p.dataRecebimento)} ${fmt(p.valorRecebido)}`).join(", ") || "nenhum"}`
      : "";
  }

  const systemPrompt = `Você é a assistente virtual de Addere respondendo mensagens no Instagram.
Seja cordial, profissional e concisa (máx. 3 parágrafos).
NÃO forneça aconselhamento jurídico específico.
NÃO invente informações sobre processos ou valores.
Se a solicitação exigir atendimento humano, responda exatamente: [ESCALATE]
${ctxParcelas}`;

  // Montar histórico no formato Claude (máx 8 msgs, alternância garantida)
  const msgs = [];
  let lastRole = null;
  for (const m of historico.slice(-8)) {
    const role = m.direcao === "IN" ? "user" : "assistant";
    if (role === lastRole) continue;
    msgs.push({ role, content: m.conteudo });
    lastRole = role;
  }
  if (lastRole !== "user") msgs.push({ role: "user", content: texto });
  else msgs[msgs.length - 1] = { role: "user", content: texto };

  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: systemPrompt,
      messages: msgs,
    });
    const resposta = resp.content?.[0]?.text?.trim() || null;
    if (!resposta) return null;
    if (resposta.includes("[ESCALATE]")) return { escalate: true };
    return { resposta };
  } catch (e) {
    console.error("❌ IG bot Claude error:", e.message);
    return null;
  }
}

// ── Rate limit simples (bot) ───────────────────────────────────────────────────
const _igRateMap = new Map(); // igUserId → [timestamps]
function _igCheckRate(igUserId) {
  const now = Date.now();
  const window = 5 * 60 * 1000;
  const limit = 10;
  const hits = (_igRateMap.get(igUserId) || []).filter(t => now - t < window);
  if (hits.length >= limit) return false;
  hits.push(now);
  _igRateMap.set(igUserId, hits);
  return true;
}

// ── SSE ───────────────────────────────────────────────────────────────────────
const _igSSEClients = new Map();

function _igSSEBroadcast(event) {
  const data = `event: ig\ndata: ${JSON.stringify(event)}\n\n`;
  for (const [id, client] of _igSSEClients) {
    try { client.res.write(data); }
    catch (_) { _igSSEClients.delete(id); }
  }
}

router.get("/api/instagram/events", (req, res) => {
  const rawToken = req.headers.authorization?.split(" ")[1] || req.query.token;
  if (!rawToken) return res.status(401).end();
  let user;
  try { user = jwt.verify(rawToken, JWT_SECRET); }
  catch (_) { return res.status(401).end(); }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const clientId = `${Date.now()}_${user.id}`;
  _igSSEClients.set(clientId, { res, userId: user.id });

  const hb = setInterval(() => { try { res.write(": hb\n\n"); } catch (_) {} }, 25000);
  req.on("close", () => { clearInterval(hb); _igSSEClients.delete(clientId); });
});

// ── Webhook — verificação (GET) ───────────────────────────────────────────────
router.get("/api/instagram/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === IG_VERIFY_TOKEN) {
    console.log("✅ Webhook Instagram verificado pela Meta");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Webhook — recebimento (POST) ───────────────────────────────────────────────
router.post("/api/instagram/webhook", async (req, res) => {
  // Validar HMAC se APP_SECRET configurado
  if (IG_APP_SECRET) {
    const sig = req.headers["x-hub-signature-256"];
    if (!sig) { console.warn("⚠️ Webhook IG rejeitado: assinatura ausente"); return res.sendStatus(403); }
    const hmac = crypto.createHmac("sha256", IG_APP_SECRET).update(req.rawBody || "").digest("hex");
    const expected = `sha256=${hmac}`;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        console.warn("⚠️ Webhook IG rejeitado: HMAC inválida"); return res.sendStatus(403);
      }
    } catch { return res.sendStatus(403); }
  }

  const body = req.body;
  // Instagram webhook usa object="instagram" com entry[].messaging[]
  if (body.object !== "instagram") return res.sendStatus(200);

  const mensagensSalvas = [];
  const TIPOS_MIDIA = new Set(["image", "video", "audio", "file", "story_mention", "story_reply"]);

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      const igUserId = event.sender?.id;
      const msg = event.message;
      if (!igUserId || !msg || msg.is_echo) continue; // ignorar eco das próprias mensagens
      const igMid = msg.mid;
      if (!igMid) continue;

      // Deduplicação
      const existe = await prisma.instagramMensagem.findUnique({ where: { igMid } }).catch(() => null);
      if (existe) { console.log(`📸 IG msg duplicada ignorada mid:${igMid?.slice(-8)}`); continue; }

      // Determinar tipo e conteúdo
      let tipo = "text";
      let conteudo = msg.text || "";
      let mediaUrl = null;
      let mediaId = null;

      if (msg.attachments?.length) {
        const att = msg.attachments[0];
        tipo = att.type || "file"; // image | video | audio | file | story_mention | story_reply
        mediaUrl = att.payload?.url || null;
        mediaId = att.payload?.sticker_id ? String(att.payload.sticker_id) : null;
        conteudo = msg.text || `[${tipo}]`;
        if (!TIPOS_MIDIA.has(tipo)) tipo = "file";
      }

      if (!conteudo && !mediaUrl) continue;

      // Buscar/criar conversa + perfil
      let conversa = await prisma.instagramConversa.findUnique({ where: { igUserId } });
      let igUsername = conversa?.igUsername || null;
      if (!conversa) {
        const perfil = await _igGetProfile(igUserId);
        conversa = await prisma.instagramConversa.create({
          data: { igUserId, igUsername: null, nomeCompleto: perfil.nome, fotoPerfil: perfil.fotoPerfil },
        });
      } else if (!conversa.nomeCompleto) {
        // Re-buscar perfil para conversas existentes sem dados de perfil
        const perfil = await _igGetProfile(igUserId);
        if (perfil.nome || perfil.fotoPerfil) {
          await prisma.instagramConversa.update({
            where: { igUserId },
            data: { nomeCompleto: perfil.nome, fotoPerfil: perfil.fotoPerfil },
          });
          conversa = { ...conversa, nomeCompleto: perfil.nome, fotoPerfil: perfil.fotoPerfil };
        }
      }

      console.log(`📸 IG msg recebida de ${igUsername || igUserId} tipo:${tipo} mid:${igMid?.slice(-8)}`);

      await prisma.instagramMensagem.create({
        data: { igMid, igUserId, igUsername, direcao: "IN", conteudo, lida: false, tipo, mediaUrl, mediaId },
      });

      _igSSEBroadcast({ type: "new_message", igUserId, igUsername });

      // WA para admins se ninguém estiver no app
      if (_igSSEClients.size === 0) {
        const remetente = conversa?.nomeCompleto || igUsername || igUserId;
        const preview   = conteudo.length > 100 ? conteudo.slice(0, 97) + "…" : conteudo;
        prisma.usuario.findMany({
          where: { role: "ADMIN", ativo: true, telefone: { not: null } },
          select: { telefone: true },
        }).then(admins => {
          for (const { telefone } of admins) {
            sendWhatsAppTemplate(telefone, "novo_dm_instagram", "pt_BR", [
              { type: "body", parameters: [
                { type: "text", text: remetente },
                { type: "text", text: preview },
              ]},
            ]).catch(() => {
              const msgWa = `Nova mensagem de ${remetente}: "${preview}". Acesse o inbox do Addere para responder.`;
              sendWhatsApp(telefone, msgWa);
            });
          }
        }).catch(() => {});
      }

      if (tipo === "text") {
        mensagensSalvas.push({ igUserId, igUsername, conteudo });
      }
    }
  }

  res.sendStatus(200);

  // ── Bot assíncrono ──
  if (mensagensSalvas.length) {
    (async () => {
      for (const { igUserId, igUsername, conteudo } of mensagensSalvas) {
        try {
          if (!anthropic) { console.warn("🤖 IG bot desativado — ANTHROPIC_API_KEY não configurada"); continue; }

          // Modo humano: silenciar bot se houve resposta humana nas últimas 8h
          const modoHumano = await prisma.instagramMensagem.findFirst({
            where: { igUserId, direcao: "OUT", respondidoPor: "HUMANO", criadoEm: { gte: new Date(Date.now() - 8 * 3600000) } },
          });
          if (modoHumano) { console.log(`🤖 IG bot silenciado (modo humano) — ${igUserId}`); continue; }

          if (!_igCheckRate(igUserId)) { console.warn(`🚦 Rate limit bot IG — ${igUserId}`); continue; }

          const historicoRaw = await prisma.instagramMensagem.findMany({
            where: { igUserId, conteudo: { not: "" } },
            orderBy: { criadoEm: "desc" },
            take: 16,
            select: { direcao: true, conteudo: true },
          });
          const historico = historicoRaw.reverse();

          const resultado = await _igBotReply(conteudo, historico);
          if (!resultado) continue;

          const { resposta, escalate } = resultado;

          if (escalate) {
            const msgAguarde = "Olá! Obrigada pela mensagem. Nossa equipe irá retornar em breve. 🙏";
            const ok = await _igSend(igUserId, msgAguarde);
            if (ok) {
              await prisma.instagramMensagem.create({
                data: { igUserId, igUsername, direcao: "OUT", conteudo: msgAguarde, respondidoPor: "BOT_ESCALOU" },
              });
            }
          } else if (resposta) {
            const ok = await _igSend(igUserId, resposta);
            if (ok) {
              await prisma.instagramMensagem.create({
                data: { igUserId, igUsername, direcao: "OUT", conteudo: resposta, respondidoPor: "BOT" },
              });
            }
          }
        } catch (e) {
          console.error(`❌ IG bot error para ${igUserId}:`, e.message);
        }
      }
    })();
  }
});

// ── Inbox — helpers ───────────────────────────────────────────────────────────
function _igIsStaff(req) {
  const role = String(req.user?.role || "").toUpperCase();
  const tipo = String(req.user?.tipoUsuario || "").toUpperCase();
  return role === "ADMIN" || tipo === "SECRETARIA_VIRTUAL";
}

// ── Contagem de não lidas ─────────────────────────────────────────────────────
router.get("/api/instagram/unread", authenticate, async (req, res) => {
  try {
    const where = { direcao: "IN", lida: false };
    if (!_igIsStaff(req)) {
      // Advogado: apenas conversas atribuídas
      const convs = await prisma.instagramConversa.findMany({
        where: { responsavelId: req.user.id }, select: { igUserId: true },
      });
      const ids = convs.map(c => c.igUserId);
      if (!ids.length) return res.json({ count: 0 });
      where.igUserId = { in: ids };
    }
    const count = await prisma.instagramMensagem.count({ where });
    res.json({ count });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Lista de conversas ────────────────────────────────────────────────────────
router.get("/api/instagram/conversas", authenticate, async (req, res) => {
  try {
    const LIMIT = 50;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const skip = (page - 1) * LIMIT;

    let igUserIdFilter = null;
    if (!_igIsStaff(req)) {
      const convs = await prisma.instagramConversa.findMany({
        where: { responsavelId: req.user.id }, select: { igUserId: true },
      });
      igUserIdFilter = convs.map(c => c.igUserId);
      if (!igUserIdFilter.length) return res.json({ conversas: [], total: 0, page, totalPages: 0 });
    }

    const where = igUserIdFilter ? { igUserId: { in: igUserIdFilter } } : undefined;

    const [totalGroups, igUserIds] = await Promise.all([
      prisma.instagramMensagem.groupBy({ by: ["igUserId"], where, _count: { igUserId: true } }),
      prisma.instagramMensagem.findMany({
        distinct: ["igUserId"],
        orderBy: { criadoEm: "desc" },
        where,
        select: { igUserId: true },
        take: LIMIT,
        skip,
      }),
    ]);

    const total = totalGroups.length;
    const totalPages = Math.ceil(total / LIMIT);

    const conversas = await Promise.all(igUserIds.map(async ({ igUserId }) => {
      const [ultima, unread, escalou, ultimoHumano, conv] = await Promise.all([
        prisma.instagramMensagem.findFirst({
          where: { igUserId }, orderBy: { criadoEm: "desc" },
          select: { direcao: true, conteudo: true, criadoEm: true, respondidoPor: true, igUsername: true, tipo: true },
        }),
        prisma.instagramMensagem.count({ where: { igUserId, direcao: "IN", lida: false } }),
        prisma.instagramMensagem.findFirst({
          where: { igUserId, direcao: "OUT", respondidoPor: "BOT_ESCALOU" },
          orderBy: { criadoEm: "desc" }, select: { criadoEm: true },
        }),
        prisma.instagramMensagem.findFirst({
          where: { igUserId, direcao: "OUT", respondidoPor: "HUMANO" },
          orderBy: { criadoEm: "desc" }, select: { criadoEm: true },
        }),
        prisma.instagramConversa.findUnique({ where: { igUserId } }),
      ]);
      const aguardaHumano = escalou && (!ultimoHumano || ultimoHumano.criadoEm < escalou.criadoEm);
      return {
        igUserId,
        igUsername:    ultima?.igUsername || conv?.igUsername || igUserId,
        nomeCompleto:  conv?.nomeCompleto || null,
        fotoPerfil:    conv?.fotoPerfil || null,
        ultimaMensagem: ultima?.conteudo || "",
        ultimaMensagemTipo: ultima?.tipo || "text",
        ultimaAtividade: ultima?.criadoEm || null,
        ultimaDirecao: ultima?.direcao || null,
        ultimoRespondidoPor: ultima?.respondidoPor || null,
        unread,
        aguardaHumano,
        responsavelId: conv?.responsavelId || null,
      };
    }));

    res.json({ conversas, total, page, totalPages });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Mensagens de uma conversa ─────────────────────────────────────────────────
router.get("/api/instagram/conversas/:igUserId", authenticate, async (req, res) => {
  try {
    const { igUserId } = req.params;
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const before = req.query.before ? new Date(req.query.before) : undefined;

    if (!_igIsStaff(req)) {
      const conv = await prisma.instagramConversa.findUnique({ where: { igUserId } });
      if (conv?.responsavelId !== req.user.id) return res.status(403).json({ message: "Acesso negado" });
    }

    const where = { igUserId, ...(before ? { criadoEm: { lt: before } } : {}) };
    const [msgs, conv] = await Promise.all([
      prisma.instagramMensagem.findMany({
        where, orderBy: { criadoEm: "desc" }, take: limit,
        select: { id: true, igUserId: true, igUsername: true, direcao: true, conteudo: true, respondidoPor: true, lida: true, criadoEm: true, tipo: true, mediaUrl: true },
      }),
      prisma.instagramConversa.findUnique({
        where: { igUserId },
        select: { igUserId: true, igUsername: true, nomeCompleto: true, fotoPerfil: true, responsavelId: true },
      }),
    ]);

    // Marcar como lidas
    await prisma.instagramMensagem.updateMany({
      where: { igUserId, direcao: "IN", lida: false },
      data: { lida: true },
    });

    res.json({ mensagens: msgs.reverse(), conversa: conv });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Resposta humana ───────────────────────────────────────────────────────────
router.post("/api/instagram/conversas/:igUserId/reply", authenticate, async (req, res) => {
  try {
    const { igUserId } = req.params;
    const { texto } = req.body;
    if (!texto?.trim()) return res.status(400).json({ message: "Texto obrigatório" });

    if (!_igIsStaff(req)) {
      const conv = await prisma.instagramConversa.findUnique({ where: { igUserId } });
      if (conv?.responsavelId !== req.user.id) return res.status(403).json({ message: "Acesso negado" });
    }

    const ok = await _igSend(igUserId, texto.trim());
    if (!ok) return res.status(502).json({ message: "Falha ao enviar mensagem pelo Instagram" });

    // Recuperar username para salvar junto
    const conv = await prisma.instagramConversa.findUnique({ where: { igUserId }, select: { igUsername: true } });

    const salva = await prisma.instagramMensagem.create({
      data: {
        igUserId,
        igUsername: conv?.igUsername || null,
        direcao: "OUT",
        conteudo: texto.trim(),
        respondidoPor: "HUMANO",
        enviadoPorId: req.user.id,
        lida: true,
      },
    });

    _igSSEBroadcast({ type: "new_message", igUserId, igUsername: conv?.igUsername });
    res.json({ mensagem: salva });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Transferir conversa para advogado ─────────────────────────────────────────
router.post("/api/instagram/conversas/:igUserId/transferir", authenticate, async (req, res) => {
  try {
    if (!_igIsStaff(req)) return res.status(403).json({ message: "Apenas staff pode transferir" });
    const { igUserId } = req.params;
    const { responsavelId } = req.body; // null = devolver ao pool

    const conv = await prisma.instagramConversa.upsert({
      where: { igUserId },
      create: { igUserId, responsavelId: responsavelId || null },
      update: { responsavelId: responsavelId || null },
    });

    // Notificar o destinatário via WA
    if (responsavelId) {
      const [usuario, ultimaMsg] = await Promise.all([
        prisma.usuario.findUnique({ where: { id: responsavelId }, select: { telefone: true, nome: true } }),
        prisma.instagramMensagem.findFirst({
          where: { igUserId, direcao: "IN" },
          orderBy: { criadoEm: "desc" },
          select: { conteudo: true },
        }),
      ]);
      const phone = usuario?.telefone;
      if (phone) {
        const remetente = conv.nomeCompleto || conv.igUsername || igUserId;
        const preview   = (ultimaMsg?.conteudo || "").slice(0, 80);
        const msgWa = `📸 *Conversa do Instagram transferida para você*\nDe: ${remetente}\n"${preview}"\n\nAcesse: ${process.env.FRONTEND_URL || ""}/instagram-inbox`;
        sendWhatsApp(phone, msgWa);
      }
    }

    res.json({ conversa: conv });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Refresh de perfil manual ──────────────────────────────────────────────────
router.post("/api/instagram/conversas/:igUserId/refresh-profile", authenticate, async (req, res) => {
  try {
    if (!_igIsStaff(req)) return res.status(403).json({ message: "Acesso negado" });
    const { igUserId } = req.params;
    const perfil = await _igGetProfile(igUserId);
    await prisma.instagramConversa.updateMany({
      where: { igUserId },
      data: { nomeCompleto: perfil.nome, fotoPerfil: perfil.fotoPerfil },
    });
    res.json({ perfil });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Lista advogados disponíveis para transferência ───────────────────────────
router.get("/api/instagram/advogados", authenticate, async (req, res) => {
  try {
    if (!_igIsStaff(req)) return res.status(403).json({ message: "Acesso negado" });
    const advs = await prisma.advogado.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, usuario: { select: { id: true } } },
      orderBy: { nome: "asc" },
    });
    res.json({ advogados: advs });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

export default router;
