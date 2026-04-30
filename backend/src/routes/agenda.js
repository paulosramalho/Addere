import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, getUserAdvogadoId } from "../lib/auth.js";
import { gcalCreateEvent, gcalUpdateEvent, gcalDeleteEvent } from "../lib/googleCalendar.js";
import { _gcalSyncedIds } from "../schedulers/googleCalendarSync.js";
import { _enviarDigestDiario } from "../schedulers/agenda.js";
import { sendWhatsAppTemplate, _waPhone } from "../lib/whatsapp.js";

const router = Router();

// Verifica se o usuário tem GCal conectado e o evento não veio do GCal (evita loop)
async function _gcalHook(userId, evento, action) {
  try {
    if (evento.googleEventId && _gcalSyncedIds.has(evento.googleEventId)) return;

    // Tentar via advogado primeiro; se não houver, usar userId diretamente
    const advogadoId = await getUserAdvogadoId(userId);
    const where = advogadoId ? { advogadoId } : { usuarioId: userId };
    const hasToken = await prisma.googleCalendarToken.findUnique({ where, select: { id: true } });
    if (!hasToken) return;

    const usuarioId = advogadoId ? null : userId;

    if (action === "create") {
      const googleId = await gcalCreateEvent(advogadoId, evento, usuarioId);
      if (googleId) {
        await prisma.agendaEvento.update({ where: { id: evento.id }, data: { googleEventId: googleId, googleCalId: "primary", syncSource: "AMR" } });
      }
    } else if (action === "update" && evento.googleEventId) {
      await gcalUpdateEvent(advogadoId, evento.googleEventId, evento, usuarioId);
    } else if (action === "delete" && evento.googleEventId) {
      await gcalDeleteEvent(advogadoId, evento.googleEventId, usuarioId);
    }
  } catch (e) {
    console.error(`❌ GCal hook (${action}) userId ${userId}:`, e.message);
  }
}

function _agendaWhere(userId, isAdmin) {
  if (isAdmin) return {};
  return { OR: [{ criadoPorId: userId }, { participantes: { some: { usuarioId: userId } } }] };
}

const _agendaInclude = {
  criadoPor: { select: { id: true, nome: true } },
  participantes: {
    include: { usuario: { select: { id: true, nome: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  },
  lembretes: true,
};

async function _notificarConviteAgenda(ev, remetenteId, destinatarioIds) {
  const dtStr = ev.dataInicio.toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" });
  for (const pid of destinatarioIds) {
    if (pid === remetenteId) continue;
    try {
      await prisma.mensagemChat.create({
        data: {
          remetenteId,
          destinatarioId: pid,
          conteudo: `🗓️ Você foi convidado para o evento **"${ev.titulo}"** em ${dtStr}. Acesse a Agenda para confirmar sua presença.`,
          tipoMensagem: "CHAT",
        },
      });
    } catch (e) { console.error("❌ Notif convite agenda:", e.message); }
  }
}

// ── Recorrência — geração de instâncias ───────────────────────────────────────

const RECORRENCIA_LIMITES = { DIARIA: 60, SEMANAL: 52, QUINZENAL: 26, MENSAL: 12, ANUAL: 3 };

function _proximaData(d, recorrencia) {
  const n = new Date(d);
  if      (recorrencia === "DIARIA")    n.setDate(n.getDate() + 1);
  else if (recorrencia === "SEMANAL")   n.setDate(n.getDate() + 7);
  else if (recorrencia === "QUINZENAL") n.setDate(n.getDate() + 14);
  else if (recorrencia === "MENSAL")    n.setMonth(n.getMonth() + 1);
  else if (recorrencia === "ANUAL")     n.setFullYear(n.getFullYear() + 1);
  return n;
}

function _gerarDatas(dataBase, recorrencia, recorrenciaFim) {
  const limite = RECORRENCIA_LIMITES[recorrencia] || 0;
  const fim    = recorrenciaFim ? new Date(recorrenciaFim) : null;
  const datas  = [];
  let atual = new Date(dataBase);
  for (let i = 0; i < limite; i++) {
    const proxima = _proximaData(atual, recorrencia);
    if (fim && proxima > fim) break;
    datas.push(proxima);
    atual = proxima;
  }
  return datas;
}

function _normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function _lembreteKey({ usuarioId, emailExterno, antecedenciaMin, canal }) {
  return `${usuarioId || 0}|${_normEmail(emailExterno)}|${Number(antecedenciaMin) || 60}|${canal || "APP"}`;
}

async function _criarParticipantesLembretes(eventoId, participantes, lembretes, criadoPorId) {
  if (participantes.length > 0) {
    await prisma.agendaParticipante.createMany({
      data: participantes.map((p) => ({
        eventoId, usuarioId: p.usuarioId || null,
        emailExterno: p.emailExterno || null, nomeExterno: p.nomeExterno || null,
        whatsappExterno: p.whatsappExterno || null,
        status: p.usuarioId === criadoPorId ? "ACEITO" : "PENDENTE",
      })),
      skipDuplicates: true,
    });
  }
  if (lembretes.length > 0) {
    const seen = new Set();
    const itens = [];
    for (const l of lembretes) {
      const row = {
        eventoId,
        usuarioId: l.usuarioId || null,
        emailExterno: l.emailExterno || null,
        antecedenciaMin: Number(l.antecedenciaMin) || 60,
        canal: l.canal || "APP",
        disparadoEm: null,
      };
      const k = _lembreteKey(row);
      if (seen.has(k)) continue;
      seen.add(k);
      itens.push(row);
    }
    if (itens.length === 0) return;
    await prisma.agendaLembrete.createMany({
      data: itens,
      skipDuplicates: true,
    });
  }
}

async function _replaceLembretesPreservandoDisparo(eventoId, lembretes, dataInicioRef = null) {
  const existentes = await prisma.agendaLembrete.findMany({
    where: { eventoId },
    select: { usuarioId: true, emailExterno: true, antecedenciaMin: true, canal: true, disparadoEm: true },
  });

  const mapExistentes = new Map();
  for (const e of existentes) {
    const k = _lembreteKey(e);
    const atual = mapExistentes.get(k);
    if (!atual || (!atual.disparadoEm && e.disparadoEm)) {
      mapExistentes.set(k, e);
    }
  }

  await prisma.agendaLembrete.deleteMany({ where: { eventoId } });
  if (!lembretes.length) return;

  let dataInicio = dataInicioRef;
  if (!dataInicio) {
    const ev = await prisma.agendaEvento.findUnique({
      where: { id: eventoId },
      select: { dataInicio: true },
    });
    dataInicio = ev?.dataInicio || null;
  }

  const now = new Date();
  const seen = new Set();
  const toCreate = [];
  for (const l of lembretes) {
    const rowBase = {
      usuarioId: l.usuarioId || null,
      emailExterno: l.emailExterno || null,
      antecedenciaMin: Number(l.antecedenciaMin) || 60,
      canal: l.canal || "APP",
    };
    const k = _lembreteKey(rowBase);
    if (seen.has(k)) continue;
    seen.add(k);

    const prev = mapExistentes.get(k);
    let disparadoEm = prev?.disparadoEm || null;
    if (!disparadoEm && prev && dataInicio) {
      const disparoEm = new Date(dataInicio.getTime() - rowBase.antecedenciaMin * 60 * 1000);
      if (disparoEm <= now) disparadoEm = now;
    }

    toCreate.push({
      eventoId,
      ...rowBase,
      disparadoEm,
    });
  }

  if (!toCreate.length) return;
  await prisma.agendaLembrete.createMany({
    data: toCreate,
    skipDuplicates: true,
  });
}

// ── GET /api/agenda/contagem — badge polling ──────────────────────────────────

router.get("/api/agenda/contagem", authenticate, async (req, res) => {
  try {
    const userId  = req.user.id;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const agora   = new Date();
    const brtAgora    = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
    const inicioDia   = new Date(Date.UTC(brtAgora.getUTCFullYear(), brtAgora.getUTCMonth(), brtAgora.getUTCDate(), 3, 0, 0));
    const fimDia      = new Date(inicioDia.getTime() + 24 * 60 * 60 * 1000 - 1);
    const [hoje, lembretes, convitesPendentes] = await Promise.all([
      prisma.agendaEvento.count({
        where: { ..._agendaWhere(userId, isAdmin), status: "PENDENTE", dataInicio: { gte: inicioDia, lte: fimDia } },
      }),
      prisma.agendaLembrete.count({
        where: { usuarioId: userId, canal: "APP", disparadoEm: null, evento: { status: "PENDENTE", dataInicio: { gte: agora } } },
      }),
      prisma.agendaParticipante.count({
        where: { usuarioId: userId, status: "PENDENTE", evento: { criadoPorId: { not: userId }, status: "PENDENTE" } },
      }),
    ]);
    res.json({ hoje, lembretesPendentes: lembretes, convitesPendentes });
  } catch (e) {
    console.error("❌ Agenda contagem:", e);
    res.status(500).json({ message: "Erro." });
  }
});

// ── GET /api/agenda/lembretes/pendentes ───────────────────────────────────────

router.get("/api/agenda/lembretes/pendentes", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const agora  = new Date();
    const em2h   = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
    const lembretes = await prisma.agendaLembrete.findMany({
      where: { usuarioId: userId, canal: "APP", disparadoEm: null, evento: { status: "PENDENTE", dataInicio: { gte: agora, lte: em2h } } },
      include: { evento: { select: { id: true, titulo: true, dataInicio: true, tipo: true } } },
      orderBy: { evento: { dataInicio: "asc" } },
    });
    const paraDisparar = lembretes.filter((lem) => {
      const disparoEm = new Date(lem.evento.dataInicio.getTime() - lem.antecedenciaMin * 60 * 1000);
      return agora >= disparoEm;
    });
    res.json(paraDisparar);
  } catch (e) {
    console.error("❌ Agenda lembretes pendentes:", e);
    res.status(500).json({ message: "Erro." });
  }
});

// ── PATCH /api/agenda/lembretes/:id/dispensar ─────────────────────────────────

router.patch("/api/agenda/lembretes/:id/dispensar", authenticate, async (req, res) => {
  try {
    const id  = Number(req.params.id);
    const lem = await prisma.agendaLembrete.findUnique({ where: { id } });
    if (!lem) return res.status(404).json({ message: "Não encontrado." });
    if (lem.usuarioId !== req.user.id) return res.status(403).json({ message: "Acesso negado." });
    await prisma.agendaLembrete.update({ where: { id }, data: { disparadoEm: new Date() } });
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ Dispensar lembrete:", e);
    res.status(500).json({ message: "Erro." });
  }
});

// ── GET /api/agenda ───────────────────────────────────────────────────────────

router.get("/api/agenda", authenticate, async (req, res) => {
  try {
    const userId  = req.user.id;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const { dataInicio, dataFim, tipo, status, page = 1, pageSize = 200 } = req.query;
    const where = { ..._agendaWhere(userId, isAdmin) };
    if (dataInicio || dataFim) {
      where.dataInicio = {};
      if (dataInicio) where.dataInicio.gte = new Date(dataInicio);
      if (dataFim) { const fim = new Date(dataFim); fim.setHours(23, 59, 59, 999); where.dataInicio.lte = fim; }
    }
    if (tipo)   where.tipo   = tipo;
    if (status) where.status = status;
    const skip = (Number(page) - 1) * Number(pageSize);
    const [total, items] = await Promise.all([
      prisma.agendaEvento.count({ where }),
      prisma.agendaEvento.findMany({ where, skip, take: Number(pageSize), orderBy: { dataInicio: "asc" }, include: _agendaInclude }),
    ]);
    res.json({ total, page: Number(page), pageSize: Number(pageSize), items });
  } catch (e) {
    console.error("❌ Listar agenda:", e);
    res.status(500).json({ message: "Erro ao listar agenda." });
  }
});

// ── GET /api/agenda/:id ───────────────────────────────────────────────────────

router.get("/api/agenda/:id", authenticate, async (req, res) => {
  try {
    const id      = Number(req.params.id);
    const userId  = req.user.id;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const ev = await prisma.agendaEvento.findUnique({ where: { id }, include: _agendaInclude });
    if (!ev) return res.status(404).json({ message: "Não encontrado." });
    if (!isAdmin && ev.criadoPorId !== userId && !ev.participantes.some((p) => p.usuarioId === userId))
      return res.status(403).json({ message: "Acesso negado." });
    res.json(ev);
  } catch (e) {
    console.error("❌ GET agenda/:id:", e);
    res.status(500).json({ message: "Erro." });
  }
});

// ── POST /api/agenda ──────────────────────────────────────────────────────────

router.post("/api/agenda", authenticate, async (req, res) => {
  try {
    const {
      titulo, descricao, dataInicio, dataFim, tipo, prioridade,
      participantes = [], lembretes = [],
      recorrencia = "NENHUMA", recorrenciaFim,
    } = req.body;
    if (!titulo?.trim()) return res.status(400).json({ message: "Título é obrigatório." });
    if (!dataInicio)     return res.status(400).json({ message: "Data/hora é obrigatória." });

    const rec = ["NENHUMA","DIARIA","SEMANAL","QUINZENAL","MENSAL","ANUAL"].includes(recorrencia)
      ? recorrencia : "NENHUMA";

    // Cria primeiro evento (ou único)
    const ev = await prisma.agendaEvento.create({
      data: {
        titulo: titulo.trim(), descricao: descricao?.trim() || null,
        dataInicio: new Date(dataInicio), dataFim: dataFim ? new Date(dataFim) : null,
        tipo: tipo || "COMPROMISSO", prioridade: prioridade || "NORMAL", status: "PENDENTE",
        criadoPorId: req.user.id,
        recorrencia: rec,
        recorrenciaFim: recorrenciaFim ? new Date(recorrenciaFim) : null,
      },
    });

    await _criarParticipantesLembretes(ev.id, participantes, lembretes, req.user.id);

    // Notificar participantes (exceto criador)
    const idsNotificar = participantes.filter((p) => p.usuarioId && p.usuarioId !== req.user.id).map((p) => p.usuarioId);

    // Gerar instâncias de recorrência
    if (rec !== "NENHUMA") {
      // Usa o ID do primeiro evento como grupoId
      await prisma.agendaEvento.update({ where: { id: ev.id }, data: { recorrenciaGrupoId: ev.id } });

      const duracaoMs = dataFim
        ? new Date(dataFim).getTime() - new Date(dataInicio).getTime()
        : null;
      const datasExtras = _gerarDatas(new Date(dataInicio), rec, recorrenciaFim);

      for (const dataInst of datasExtras) {
        const inst = await prisma.agendaEvento.create({
          data: {
            titulo: titulo.trim(), descricao: descricao?.trim() || null,
            dataInicio: dataInst,
            dataFim: duracaoMs !== null ? new Date(dataInst.getTime() + duracaoMs) : null,
            tipo: tipo || "COMPROMISSO", prioridade: prioridade || "NORMAL", status: "PENDENTE",
            criadoPorId: req.user.id,
            recorrencia: rec,
            recorrenciaFim: recorrenciaFim ? new Date(recorrenciaFim) : null,
            recorrenciaGrupoId: ev.id,
          },
        });
        await _criarParticipantesLembretes(inst.id, participantes, lembretes, req.user.id);
      }
    }

    const created = await prisma.agendaEvento.findUnique({ where: { id: ev.id }, include: _agendaInclude });
    if (idsNotificar.length > 0) await _notificarConviteAgenda(created, req.user.id, idsNotificar);
    // GCal hook (async, não bloqueia resposta)
    setImmediate(() => _gcalHook(req.user.id, created, "create"));
    res.status(201).json(created);
  } catch (e) {
    console.error("❌ POST agenda:", e);
    res.status(500).json({ message: "Erro ao criar evento." });
  }
});

// ── PUT /api/agenda/:id ───────────────────────────────────────────────────────
// escopo (body): "este" | "futuros" | "todos"

router.put("/api/agenda/:id", authenticate, async (req, res) => {
  try {
    const id      = Number(req.params.id);
    const userId  = req.user.id;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const existente = await prisma.agendaEvento.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ message: "Não encontrado." });
    if (!isAdmin && existente.criadoPorId !== userId) return res.status(403).json({ message: "Apenas o criador pode editar." });

    const {
      titulo, descricao, dataInicio, dataFim, tipo, prioridade,
      participantes = [], lembretes = [],
      escopo = "este",
    } = req.body;
    if (!titulo?.trim()) return res.status(400).json({ message: "Título é obrigatório." });

    const isRecorrente = !!existente.recorrenciaGrupoId;

    if (!isRecorrente || escopo === "este") {
      // ── Editar só este evento (desvincula da série se for recorrente) ────────
      await prisma.agendaEvento.update({
        where: { id },
        data: {
          titulo: titulo.trim(), descricao: descricao?.trim() || null,
          dataInicio: dataInicio ? new Date(dataInicio) : existente.dataInicio,
          dataFim: dataFim ? new Date(dataFim) : null,
          tipo: tipo || existente.tipo, prioridade: prioridade || existente.prioridade,
          // Desvincula da série
          ...(isRecorrente ? { recorrencia: "NENHUMA", recorrenciaGrupoId: null, recorrenciaFim: null } : {}),
        },
      });

      // Participantes: smart diff
      await _atualizarParticipantes(id, participantes, userId, existente);
      // Lembretes: replace preservando disparos já realizados
      const novoInicio = dataInicio ? new Date(dataInicio) : existente.dataInicio;
      await _replaceLembretesPreservandoDisparo(id, lembretes, novoInicio);
    } else {
      // ── Editar futuros ou todos ──────────────────────────────────────────────
      const grupoId = existente.recorrenciaGrupoId;
      const whereGrupo = {
        recorrenciaGrupoId: grupoId,
        ...(escopo === "futuros" ? { dataInicio: { gte: existente.dataInicio } } : {}),
      };
      const eventosGrupo = await prisma.agendaEvento.findMany({
        where: whereGrupo, select: { id: true },
      });
      const idsGrupo = eventosGrupo.map((e) => e.id);

      // Atualiza campos comuns (sem datas — cada instância mantém sua data)
      await prisma.agendaEvento.updateMany({
        where: { id: { in: idsGrupo } },
        data: {
          titulo: titulo.trim(), descricao: descricao?.trim() || null,
          tipo: tipo || existente.tipo, prioridade: prioridade || existente.prioridade,
        },
      });
      // Data do evento atual (este específico)
      if (dataInicio) {
        await prisma.agendaEvento.update({
          where: { id },
          data: { dataInicio: new Date(dataInicio), dataFim: dataFim ? new Date(dataFim) : null },
        });
      }
      // Participantes e lembretes de todos os eventos do grupo
      for (const evId of idsGrupo) {
        const ev = await prisma.agendaEvento.findUnique({ where: { id: evId } });
        await _atualizarParticipantes(evId, participantes, userId, ev);
        let dataInicioEvento = ev?.dataInicio || null;
        if (dataInicio && evId === id) {
          dataInicioEvento = new Date(dataInicio);
        }
        await _replaceLembretesPreservandoDisparo(evId, lembretes, dataInicioEvento);
      }
    }

    const updated = await prisma.agendaEvento.findUnique({ where: { id }, include: _agendaInclude });
    setImmediate(() => _gcalHook(req.user.id, updated, "update"));
    res.json(updated);
  } catch (e) {
    console.error("❌ PUT agenda/:id:", e);
    res.status(500).json({ message: "Erro ao atualizar evento." });
  }
});

async function _atualizarParticipantes(eventoId, participantes, userId, existente) {
  const existingParts = await prisma.agendaParticipante.findMany({ where: { eventoId } });
  const existingByKey = new Map();
  for (const p of existingParts) {
    if (p.usuarioId) existingByKey.set(`u:${p.usuarioId}`, p);
    else if (p.emailExterno) existingByKey.set(`e:${p.emailExterno}`, p);
  }
  const newKeys  = new Set();
  const toCreate = [];
  for (const np of participantes) {
    const key = np.usuarioId ? `u:${np.usuarioId}` : (np.emailExterno ? `e:${np.emailExterno}` : null);
    if (!key) continue;
    newKeys.add(key);
    if (!existingByKey.has(key)) toCreate.push(np);
  }
  const toDeleteIds = existingParts
    .filter((p) => { const k = p.usuarioId ? `u:${p.usuarioId}` : (p.emailExterno ? `e:${p.emailExterno}` : null); return !k || !newKeys.has(k); })
    .map((p) => p.id);
  if (toDeleteIds.length > 0) await prisma.agendaParticipante.deleteMany({ where: { id: { in: toDeleteIds } } });
  if (toCreate.length > 0) {
    await prisma.agendaParticipante.createMany({
      data: toCreate.map((p) => ({
        eventoId, usuarioId: p.usuarioId || null,
        emailExterno: p.emailExterno || null, nomeExterno: p.nomeExterno || null,
        whatsappExterno: p.whatsappExterno || null,
        status: p.usuarioId === userId ? "ACEITO" : "PENDENTE",
      })),
      skipDuplicates: true,
    });
  }
}

// ── PATCH /api/agenda/:id/status ──────────────────────────────────────────────

router.patch("/api/agenda/:id/status", authenticate, async (req, res) => {
  try {
    const id      = Number(req.params.id);
    const userId  = req.user.id;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const { status } = req.body;
    if (!["PENDENTE","CONCLUIDO","CANCELADO"].includes(status))
      return res.status(400).json({ message: "Status inválido." });
    const existente = await prisma.agendaEvento.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ message: "Não encontrado." });
    if (!isAdmin && existente.criadoPorId !== userId) return res.status(403).json({ message: "Acesso negado." });
    const updated = await prisma.agendaEvento.update({ where: { id }, data: { status } });
    res.json(updated);
  } catch (e) {
    console.error("❌ PATCH agenda/:id/status:", e);
    res.status(500).json({ message: "Erro." });
  }
});

// ── PATCH /api/agenda/participantes/:id/responder ─────────────────────────────

router.patch("/api/agenda/participantes/:id/responder", authenticate, async (req, res) => {
  try {
    const partId = Number(req.params.id);
    const userId = req.user.id;
    const { aceita, motivo, dataAlternativa } = req.body;

    const part = await prisma.agendaParticipante.findUnique({
      where: { id: partId },
      include: { evento: { include: { criadoPor: { select: { id: true, nome: true } } } }, usuario: { select: { id: true, nome: true } } },
    });
    if (!part) return res.status(404).json({ message: "Participação não encontrada." });
    if (part.usuarioId !== userId) return res.status(403).json({ message: "Acesso negado." });
    if (part.evento.status === "CANCELADO") return res.status(400).json({ message: "Evento cancelado." });

    const novoStatus = aceita ? "ACEITO" : "RECUSADO";
    await prisma.agendaParticipante.update({
      where: { id: partId },
      data: {
        status: novoStatus,
        motivoRecusa: aceita ? null : (motivo?.trim() || null),
        dataAlternativaSugerida: (!aceita && dataAlternativa) ? new Date(dataAlternativa) : null,
      },
    });

    const dtStr      = part.evento.dataInicio.toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" });
    const nomePart   = part.usuario?.nome || "Participante";
    let conteudo;
    if (aceita) {
      conteudo = `✅ **${nomePart}** aceitou o evento **"${part.evento.titulo}"** (${dtStr}).`;
    } else {
      conteudo = `❌ **${nomePart}** recusou o evento **"${part.evento.titulo}"** (${dtStr}).`;
      if (motivo) conteudo += ` Motivo: ${motivo.trim()}`;
      if (dataAlternativa) {
        const altStr = new Date(dataAlternativa).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" });
        conteudo += ` Sugere: ${altStr}.`;
      }
    }
    if (part.evento.criadoPorId !== userId) {
      try {
        await prisma.mensagemChat.create({
          data: { remetenteId: userId, destinatarioId: part.evento.criadoPorId, conteudo, tipoMensagem: "CHAT" },
        });
      } catch (e) { console.error("❌ Chat resposta agenda:", e.message); }
    }
    res.json({ ok: true, status: novoStatus });
  } catch (e) {
    console.error("❌ Responder convite agenda:", e);
    res.status(500).json({ message: "Erro ao registrar resposta." });
  }
});

// ── PATCH /api/agenda/:id/reagendar ──────────────────────────────────────────

router.patch("/api/agenda/:id/reagendar", authenticate, async (req, res) => {
  try {
    const id      = Number(req.params.id);
    const userId  = req.user.id;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const { dataInicio, dataFim } = req.body;
    if (!dataInicio) return res.status(400).json({ message: "Nova data/hora é obrigatória." });

    const ev = await prisma.agendaEvento.findUnique({ where: { id }, include: _agendaInclude });
    if (!ev) return res.status(404).json({ message: "Não encontrado." });
    if (!isAdmin && ev.criadoPorId !== userId) return res.status(403).json({ message: "Apenas o criador pode reagendar." });

    await prisma.agendaEvento.update({
      where: { id },
      data: { dataInicio: new Date(dataInicio), dataFim: dataFim ? new Date(dataFim) : null },
    });
    await prisma.agendaParticipante.updateMany({
      where: { eventoId: id, usuarioId: { not: userId } },
      data: { status: "PENDENTE", motivoRecusa: null, dataAlternativaSugerida: null },
    });

    const updated  = await prisma.agendaEvento.findUnique({ where: { id }, include: _agendaInclude });
    setImmediate(() => _gcalHook(req.user.id, updated, "update"));
    const dtStr    = new Date(dataInicio).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" });
    const nomeCriador = ev.criadoPor?.nome || "Criador";
    const idsNotificar = ev.participantes.filter((p) => p.usuarioId && p.usuarioId !== userId).map((p) => p.usuarioId);
    for (const pid of idsNotificar) {
      try {
        await prisma.mensagemChat.create({
          data: {
            remetenteId: userId, destinatarioId: pid,
            conteudo: `🗓️ **${nomeCriador}** reagendou o evento **"${ev.titulo}"** para ${dtStr}. Confirme sua presença na Agenda.`,
            tipoMensagem: "CHAT",
          },
        });
      } catch (e) { console.error("❌ Chat reagendar:", e.message); }
    }
    res.json(updated);
  } catch (e) {
    console.error("❌ Reagendar evento:", e);
    res.status(500).json({ message: "Erro ao reagendar evento." });
  }
});

// ── DELETE /api/agenda/:id ────────────────────────────────────────────────────
// escopo (query): "este" | "futuros" | "todos"

router.delete("/api/agenda/:id", authenticate, async (req, res) => {
  try {
    const id      = Number(req.params.id);
    const userId  = req.user.id;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const escopo  = req.query.escopo || "este"; // "este" | "futuros" | "todos"

    const existente = await prisma.agendaEvento.findUnique({
      where: { id },
      include: { participantes: true, criadoPor: { select: { nome: true } } },
    });
    if (!existente) return res.status(404).json({ message: "Não encontrado." });
    if (!isAdmin && existente.criadoPorId !== userId) return res.status(403).json({ message: "Apenas o criador pode excluir." });

    let idsParaDeletar = [id];

    if (existente.recorrenciaGrupoId && escopo !== "este") {
      const whereGrupo = {
        recorrenciaGrupoId: existente.recorrenciaGrupoId,
        ...(escopo === "futuros" ? { dataInicio: { gte: existente.dataInicio } } : {}),
      };
      const outros = await prisma.agendaEvento.findMany({ where: whereGrupo, select: { id: true } });
      idsParaDeletar = outros.map((e) => e.id);
      if (!idsParaDeletar.includes(id)) idsParaDeletar.push(id);
    }

    // Notifica participantes dos eventos que serão deletados
    const nomeCriador = existente.criadoPor?.nome || "Criador";
    for (const evId of idsParaDeletar) {
      const ev = evId === id
        ? existente
        : await prisma.agendaEvento.findUnique({ where: { id: evId }, include: { participantes: true } });
      if (!ev) continue;
      const idsNotificar = ev.participantes.filter((p) => p.usuarioId && p.usuarioId !== userId).map((p) => p.usuarioId);
      for (const pid of idsNotificar) {
        try {
          await prisma.mensagemChat.create({
            data: {
              remetenteId: userId, destinatarioId: pid,
              conteudo: `🗓️ O evento **"${ev.titulo}"** foi cancelado por ${nomeCriador}.`,
              tipoMensagem: "CHAT",
            },
          });
        } catch (e) { console.error("❌ Chat cancelar:", e.message); }
      }
    }

    // GCal hooks antes de deletar (precisamos dos googleEventIds)
    const eventsParaGCal = await prisma.agendaEvento.findMany({
      where: { id: { in: idsParaDeletar }, googleEventId: { not: null } },
      select: { id: true, googleEventId: true, criadoPorId: true },
    });
    await prisma.agendaEvento.deleteMany({ where: { id: { in: idsParaDeletar } } });
    setImmediate(() => {
      for (const ev of eventsParaGCal) {
        _gcalHook(ev.criadoPorId, ev, "delete");
      }
    });
    res.json({ ok: true, deletados: idsParaDeletar.length });
  } catch (e) {
    console.error("❌ DELETE agenda/:id:", e);
    res.status(500).json({ message: "Erro ao excluir evento." });
  }
});

// ── POST /api/admin/agenda/test-wa — disparo manual para diagnóstico ──────────
router.post("/api/admin/agenda/test-wa", authenticate, async (req, res) => {
  try {
    const { tipo = "digest" } = req.body || {};

    if (tipo === "digest") {
      await _enviarDigestDiario();
      return res.json({ ok: true, msg: "Digest disparado — verifique o WA." });
    }

    if (tipo === "lembrete") {
      // Aceita telefone direto no body ou busca do advogado do usuário logado
      let phone = _waPhone(req.body?.phone);
      if (!phone) {
        const usr = await prisma.usuario.findUnique({
          where: { id: req.user.id },
          select: { advogado: { select: { telefone: true } } },
        });
        phone = _waPhone(usr?.advogado?.telefone);
      }
      if (!phone) return res.status(400).json({ message: "Informe 'phone' no body ou configure o telefone do advogado." });

      await sendWhatsAppTemplate(phone, "lembrete_agenda", "pt_BR", [{
        type: "body",
        parameters: [
          { type: "text", text: "Evento de Teste" },
          { type: "text", text: new Date().toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" }) },
        ],
      }]);
      return res.json({ ok: true, msg: `Template lembrete_agenda enviado para ${phone}.` });
    }

    res.status(400).json({ message: "tipo deve ser 'digest' ou 'lembrete'" });
  } catch (e) {
    console.error("❌ test-wa:", e.message);
    res.status(500).json({ message: e.message });
  }
});

export default router;
