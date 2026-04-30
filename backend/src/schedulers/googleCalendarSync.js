/**
 * Google Calendar Sync — motor de sincronização bidirecional
 *
 * GCal → Addere: busca eventos novos/alterados/deletados desde o último sync
 * Addere → GCal: hooks nas rotas de agenda (ver routes/agenda.js)
 *
 * Roda a cada 15 minutos para todos os advogados com token ativo.
 * Usa syncToken incremental — apenas deltas desde o último sync.
 * Renova push notification channels que estão prestes a expirar.
 */

import prisma from "../lib/prisma.js";
import { gcalListEvents, gcalRegisterWatch, gCalToAmr } from "../lib/googleCalendar.js";

// Lock em memória para evitar syncs paralelos do mesmo advogado
const _syncInProgress = new Set();

// IDs de eventos recém-sincronizados do GCal — usado para evitar loop Addere→GCal
export const _gcalSyncedIds = new Set(); // googleEventId

/**
 * Sincroniza o calendário de um advogado específico (GCal → Addere)
 */
// Chave de lock: "adv:123" ou "usr:456"
function _lockKey(advogadoId, usuarioId) { return advogadoId ? `adv:${advogadoId}` : `usr:${usuarioId}`; }

export async function syncAdvogadoCalendar(advogadoId, usuarioId) {
  const key = _lockKey(advogadoId, usuarioId);
  if (_syncInProgress.has(key)) return;
  _syncInProgress.add(key);
  try {
    await _doSync(advogadoId, usuarioId);
  } finally {
    _syncInProgress.delete(key);
  }
}

async function _doSync(advogadoId, usuarioId) {
  // Resolver o usuarioId do sistema (criadoPorId para eventos novos)
  let criadoPorId = usuarioId;
  if (advogadoId && !criadoPorId) {
    const adv = await prisma.advogado.findUnique({
      where: { id: advogadoId },
      select: { usuario: { select: { id: true } } },
    });
    if (!adv?.usuario?.id) {
      console.warn(`⚠️ GCal sync: advogado ${advogadoId} sem usuário vinculado — skip`);
      return;
    }
    criadoPorId = adv.usuario.id;
  }
  if (!criadoPorId) { console.warn(`⚠️ GCal sync: sem usuarioId resolvido — skip`); return; }

  const result = await gcalListEvents(advogadoId, usuarioId);
  if (!result) return;

  const { items, nextSyncToken } = result;
  let criados = 0, atualizados = 0, deletados = 0;

  function _lembreteKey(usuarioId, antecedenciaMin, canal) {
    return `${usuarioId || 0}|${Number(antecedenciaMin) || 60}|${canal || "APP"}`;
  }

  // Sincroniza lembretes GCal → Addere para um evento, somente quando há overrides explícitos
  async function _syncLembretes(eventoId, usuarioId, lembretes, dataInicio) {
    if (!lembretes || lembretes.length === 0) return;

    const existentes = await prisma.agendaLembrete.findMany({
      where: { eventoId, usuarioId },
      select: { antecedenciaMin: true, canal: true, disparadoEm: true },
    });

    // Mapa por chave exata (canal + antecedência)
    const prevByKey = new Map();
    // Mapa de fallback por antecedência apenas — resolve mismatch de canal entre GCal ("APP") e BD ("EMAIL"/"WHATSAPP")
    // Se o lembrete já foi disparado por qualquer canal com essa antecedência, preserva disparadoEm
    const prevByMin = new Map();
    for (const e of existentes) {
      const k = _lembreteKey(usuarioId, e.antecedenciaMin, e.canal);
      const prev = prevByKey.get(k);
      if (!prev || (!prev.disparadoEm && e.disparadoEm)) prevByKey.set(k, e);
      // fallback: preserva o disparadoEm mais recente para cada antecedência, qualquer canal
      if (!prevByMin.has(e.antecedenciaMin) || e.disparadoEm) {
        prevByMin.set(e.antecedenciaMin, e.disparadoEm ?? null);
      }
    }

    // Apaga APENAS lembretes ainda não disparados — preserva os já enviados intactos
    await prisma.agendaLembrete.deleteMany({ where: { eventoId, usuarioId, disparadoEm: null } });

    const now = new Date();
    const seen = new Set();
    const data = [];
    for (const l of lembretes) {
      const antecedenciaMin = Number(l.antecedenciaMin) || 60;
      const canal = l.canal || "APP";
      const k = _lembreteKey(usuarioId, antecedenciaMin, canal);
      if (seen.has(k)) continue;
      seen.add(k);

      const prev = prevByKey.get(k);
      // Usa chave exata primeiro; se não bateu (canal diferente), usa fallback por antecedência
      let disparadoEm = prev?.disparadoEm ?? prevByMin.get(antecedenciaMin) ?? null;

      if (!disparadoEm && dataInicio) {
        // Se o horário de disparo já passou, marca como disparado para não reenviar
        const disparoEm = new Date(dataInicio.getTime() - antecedenciaMin * 60 * 1000);
        if (disparoEm <= now) disparadoEm = now;
      }

      data.push({ eventoId, usuarioId, antecedenciaMin, canal, disparadoEm });
    }

    if (!data.length) return;
    await prisma.agendaLembrete.createMany({ data, skipDuplicates: true });
  }

  for (const gEvent of items) {
    const googleEventId = gEvent.id;
    if (!googleEventId) continue;

    // Evento deletado no GCal
    if (gEvent.status === "cancelled") {
      const existing = await prisma.agendaEvento.findFirst({
        where: { googleEventId },
        select: { id: true, syncSource: true },
      });
      if (existing && existing.syncSource !== "AMR") {
        // Só deleta no Addere se o evento veio do GCal (não o contrário)
        await prisma.agendaEvento.delete({ where: { id: existing.id } }).catch(() => {});
        deletados++;
      }
      continue;
    }

    const dados = gCalToAmr(gEvent);
    if (!dados.dataInicio) continue;

    // Marcar que este googleEventId está sendo sincronizado (evitar loop)
    _gcalSyncedIds.add(googleEventId);
    setTimeout(() => _gcalSyncedIds.delete(googleEventId), 30000);

    // Verificar se evento já existe no Addere
    const existing = await prisma.agendaEvento.findFirst({
      where: { googleEventId },
      select: { id: true, syncSource: true, updatedAt: true },
    });

    if (existing) {
      // Atualizar apenas se veio do GCal (não sobrescrever eventos originados no Addere
      // a menos que tenham sido modificados externamente no GCal)
      await prisma.agendaEvento.update({
        where: { id: existing.id },
        data: {
          titulo:      dados.titulo,
          descricao:   dados.descricao,
          dataInicio:  dados.dataInicio,
          dataFim:     dados.dataFim,
        },
      });
      await _syncLembretes(existing.id, criadoPorId, dados.lembretes, dados.dataInicio);
      atualizados++;
    } else {
      // Criar novo evento no Addere
      // Verificar se é um evento que o Addere já criou no GCal (extendedProperties)
      const amrId = gEvent.extendedProperties?.private?.amrEventoId;
      if (amrId) {
        // Evento que o Addere criou e o GCal retornou — vincular googleEventId e sincronizar lembretes
        const amrEvento = await prisma.agendaEvento.findUnique({
          where: { id: parseInt(amrId) },
          select: { id: true },
        });
        if (amrEvento) {
          await prisma.agendaEvento.update({
            where: { id: amrEvento.id },
            data: { googleEventId, googleCalId: "primary" },
          });
          await _syncLembretes(amrEvento.id, criadoPorId, dados.lembretes, dados.dataInicio);
          atualizados++;
          continue;
        }
      }

      // Evento novo que veio só do GCal
      const novoEvento = await prisma.agendaEvento.create({
        data: {
          titulo:       dados.titulo,
          descricao:    dados.descricao,
          dataInicio:   dados.dataInicio,
          dataFim:      dados.dataFim,
          tipo:         "COMPROMISSO",
          prioridade:   "NORMAL",
          status:       "PENDENTE",
          criadoPorId:  criadoPorId,
          googleEventId,
          googleCalId:  "primary",
          syncSource:   "GOOGLE",
        },
      });
      await _syncLembretes(novoEvento.id, criadoPorId, dados.lembretes, dados.dataInicio);
      criados++;
    }
  }

  // Salvar novo syncToken
  if (nextSyncToken) {
    const where = advogadoId ? { advogadoId } : { usuarioId };
    await prisma.googleCalendarToken.update({ where, data: { syncToken: nextSyncToken } });
  }

  if (criados + atualizados + deletados > 0) {
    console.log(`📅 GCal sync (adv:${advogadoId}/usr:${usuarioId}): +${criados} criados, ~${atualizados} atualizados, -${deletados} deletados`);
  }
}

/**
 * Renova push channels que expiram em menos de 24h
 */
async function _renovarChannels() {
  const expirando = await prisma.googleCalendarToken.findMany({
    where: {
      channelExpiry: { lte: new Date(Date.now() + 24 * 3600 * 1000) },
      refreshToken: { not: "" },
    },
    select: { advogadoId: true, usuarioId: true },
  });

  for (const { advogadoId, usuarioId } of expirando) {
    try {
      await gcalRegisterWatch(advogadoId, usuarioId);
    } catch (e) {
      console.warn(`⚠️ GCal renovar channel (adv:${advogadoId}/usr:${usuarioId}):`, e.message);
    }
  }
}

/**
 * Sync de todos os advogados conectados (roda a cada 15min)
 */
export async function syncAllCalendars() {
  const tokens = await prisma.googleCalendarToken.findMany({
    select: { advogadoId: true, usuarioId: true },
  });

  if (!tokens.length) return;

  for (const { advogadoId, usuarioId } of tokens) {
    try {
      await syncAdvogadoCalendar(advogadoId, usuarioId);
    } catch (e) {
      console.error(`❌ GCal sync error (adv:${advogadoId}/usr:${usuarioId}):`, e.message);
    }
  }

  await _renovarChannels();
}

/**
 * Inicia o scheduler de sync (chamado em server.js)
 */
export function startGoogleCalendarSync() {
  const INTERVAL = 15 * 60 * 1000; // 15 minutos

  // Primeiro sync após 30s (deixar o servidor iniciar)
  setTimeout(() => {
    syncAllCalendars().catch(e => console.error("❌ GCal sync inicial:", e.message));
    setInterval(() => {
      syncAllCalendars().catch(e => console.error("❌ GCal sync periódico:", e.message));
    }, INTERVAL);
  }, 30000);

  console.log("📅 Google Calendar Sync scheduler iniciado (intervalo: 15min)");
}
