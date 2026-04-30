/**
 * Google Calendar — helpers de autenticação e CRUD de eventos
 *
 * Env vars necessárias:
 *   GOOGLE_CLIENT_ID        — Client ID do Google Cloud Project (pode ser o mesmo do Gmail)
 *   GOOGLE_CLIENT_SECRET    — Client Secret
 *   GOOGLE_CALENDAR_REDIRECT_URI — ex: https://backend.onrender.com/api/google-calendar/callback
 *   BACKEND_URL             — URL pública do backend (para push notification webhook)
 */

import { google } from "googleapis";
import prisma from "./prisma.js";

export const GCAL_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || process.env.GMAIL_CLIENT_ID;
export const GCAL_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
export const GCAL_REDIRECT_URI  = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
export const GCAL_SCOPES        = ["https://www.googleapis.com/auth/calendar.events"];

// ── OAuth2 client factory ─────────────────────────────────────────────────────

export function createOAuthClient() {
  return new google.auth.OAuth2(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REDIRECT_URI);
}

// state: "adv:123" para advogado, "usr:456" para usuário direto
export function getAuthUrl(advogadoId, usuarioId) {
  const oauth2 = createOAuthClient();
  const state = advogadoId ? `adv:${advogadoId}` : `usr:${usuarioId}`;
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GCAL_SCOPES,
    state,
  });
}

// ── Token management ──────────────────────────────────────────────────────────

/**
 * Retorna um OAuth2Client autenticado.
 * Aceita advogadoId OU usuarioId — um dos dois deve ser fornecido.
 */
export async function getAuthClientForAdvogado(advogadoId, usuarioId) {
  const where = advogadoId ? { advogadoId } : { usuarioId };
  const token = await prisma.googleCalendarToken.findUnique({ where });
  if (!token) return null;

  const oauth2 = createOAuthClient();
  oauth2.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiresAt.getTime(),
  });

  if (token.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      const newExpiry = new Date(credentials.expiry_date || Date.now() + 3600000);
      await prisma.googleCalendarToken.update({
        where,
        data: { accessToken: credentials.access_token, expiresAt: newExpiry },
      });
      oauth2.setCredentials(credentials);
    } catch (e) {
      console.error(`❌ GCal refresh token error (adv:${advogadoId}/usr:${usuarioId}):`, e.message);
      return null;
    }
  }

  return oauth2;
}

// ── Conversor de formatos ─────────────────────────────────────────────────────

/**
 * Converte AgendaEvento Addere → Google Calendar Event
 * lembretes: array de { antecedenciaMin, canal } — opcional
 */
export function amrToGCal(evento, lembretes = []) {
  const start = evento.dataInicio instanceof Date ? evento.dataInicio : new Date(evento.dataInicio);
  const end   = evento.dataFim
    ? (evento.dataFim instanceof Date ? evento.dataFim : new Date(evento.dataFim))
    : new Date(start.getTime() + 60 * 60 * 1000); // +1h default

  // Converter lembretes Addere → overrides GCal (máx 5, minutos entre 0 e 40320)
  const overrides = lembretes
    .filter((l) => l.antecedenciaMin > 0 && l.antecedenciaMin <= 40320)
    .slice(0, 5)
    .map((l) => ({ method: l.canal === "EMAIL" ? "email" : "popup", minutes: l.antecedenciaMin }));

  return {
    summary: evento.titulo,
    description: evento.descricao || undefined,
    start: { dateTime: start.toISOString(), timeZone: "America/Belem" },
    end:   { dateTime: end.toISOString(),   timeZone: "America/Belem" },
    reminders: overrides.length > 0 ? { useDefault: false, overrides } : { useDefault: true },
    // Manter ID extendido para evitar duplicatas
    extendedProperties: {
      private: { amrEventoId: String(evento.id) },
    },
  };
}

/**
 * Converte Google Calendar Event → dados para AgendaEvento Addere
 * Inclui lembretes explícitos (useDefault=false) como array { canal, antecedenciaMin }
 */
export function gCalToAmr(gEvent) {
  const dataInicio = gEvent.start?.dateTime
    ? new Date(gEvent.start.dateTime)
    : gEvent.start?.date
    ? new Date(gEvent.start.date + "T00:00:00")
    : null;

  const dataFim = gEvent.end?.dateTime
    ? new Date(gEvent.end.dateTime)
    : gEvent.end?.date
    ? new Date(gEvent.end.date + "T00:00:00")
    : null;

  const lembretes = (!gEvent.reminders?.useDefault && gEvent.reminders?.overrides?.length)
    ? gEvent.reminders.overrides.map((o) => ({
        canal: o.method === "email" ? "EMAIL" : "APP",
        antecedenciaMin: o.minutes,
      }))
    : [];

  return {
    titulo: gEvent.summary || "(sem título)",
    descricao: gEvent.description || null,
    dataInicio,
    dataFim,
    googleEventId: gEvent.id,
    syncSource: "GOOGLE",
    lembretes,
  };
}

// ── CRUD de eventos no Google Calendar ───────────────────────────────────────

export async function gcalCreateEvent(advogadoId, evento, usuarioId) {
  const auth = await getAuthClientForAdvogado(advogadoId, usuarioId);
  if (!auth) return null;
  const where = advogadoId ? { advogadoId } : { usuarioId };
  const token = await prisma.googleCalendarToken.findUnique({ where, select: { calendarId: true } });
  const calendarId = token?.calendarId || "primary";

  const lembretes = evento.id
    ? await prisma.agendaLembrete.findMany({ where: { eventoId: evento.id }, select: { antecedenciaMin: true, canal: true } })
    : [];

  try {
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.insert({
      calendarId,
      requestBody: amrToGCal(evento, lembretes),
    });
    console.log(`📅 GCal evento criado para advogado ${advogadoId}: ${res.data.id}`);
    return res.data.id; // retorna googleEventId
  } catch (e) {
    console.error(`❌ GCal create event error advogado ${advogadoId}:`, e.message);
    return null;
  }
}

export async function gcalUpdateEvent(advogadoId, googleEventId, evento, usuarioId) {
  const auth = await getAuthClientForAdvogado(advogadoId, usuarioId);
  if (!auth) return;
  const where = advogadoId ? { advogadoId } : { usuarioId };
  const token = await prisma.googleCalendarToken.findUnique({ where, select: { calendarId: true } });
  const calendarId = token?.calendarId || "primary";

  const lembretes = evento.id
    ? await prisma.agendaLembrete.findMany({ where: { eventoId: evento.id }, select: { antecedenciaMin: true, canal: true } })
    : [];

  try {
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.patch({
      calendarId,
      eventId: googleEventId,
      requestBody: amrToGCal(evento, lembretes),
    });
    console.log(`📅 GCal evento atualizado para advogado ${advogadoId}: ${googleEventId}`);
  } catch (e) {
    if (e.code === 404) {
      console.warn(`⚠️ GCal evento ${googleEventId} não encontrado — recriando`);
      const newId = await gcalCreateEvent(advogadoId, evento);
      if (newId) {
        await prisma.agendaEvento.update({ where: { id: evento.id }, data: { googleEventId: newId } });
      }
    } else {
      console.error(`❌ GCal update event error advogado ${advogadoId}:`, e.message);
    }
  }
}

export async function gcalDeleteEvent(advogadoId, googleEventId, usuarioId) {
  const auth = await getAuthClientForAdvogado(advogadoId, usuarioId);
  if (!auth) return;
  const where = advogadoId ? { advogadoId } : { usuarioId };
  const token = await prisma.googleCalendarToken.findUnique({ where, select: { calendarId: true } });
  const calendarId = token?.calendarId || "primary";

  try {
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId, eventId: googleEventId });
    console.log(`📅 GCal evento deletado: ${googleEventId}`);
  } catch (e) {
    if (e.code !== 404 && e.code !== 410) {
      console.error(`❌ GCal delete event error advogado ${advogadoId}:`, e.message);
    }
  }
}

// ── Listagem incremental (syncToken) ─────────────────────────────────────────

/**
 * Busca eventos novos/alterados/deletados desde o último sync.
 * Na primeira vez (sem syncToken), busca todos os eventos futuros.
 * Retorna { items, nextSyncToken }
 */
export async function gcalListEvents(advogadoId, usuarioId) {
  const auth = await getAuthClientForAdvogado(advogadoId, usuarioId);
  if (!auth) return null;
  const where = advogadoId ? { advogadoId } : { usuarioId };
  const tokenRow = await prisma.googleCalendarToken.findUnique({ where });
  if (!tokenRow) return null;
  const calendarId = tokenRow.calendarId || "primary";

  const calendar = google.calendar({ version: "v3", auth });
  const params = {
    calendarId,
    singleEvents: true,
    maxResults: 250,
  };

  if (tokenRow.syncToken) {
    params.syncToken = tokenRow.syncToken;
  } else {
    // First sync: buscar eventos a partir de hoje
    params.timeMin = new Date().toISOString();
    params.orderBy = "startTime";
  }

  try {
    const res = await calendar.events.list(params);
    return { items: res.data.items || [], nextSyncToken: res.data.nextSyncToken };
  } catch (e) {
    if (e.code === 410) {
      // syncToken expirou — full resync
      console.warn(`⚠️ GCal syncToken expirado para advogado ${advogadoId} — full resync`);
      await prisma.googleCalendarToken.update({ where, data: { syncToken: null } });
      const res2 = await calendar.events.list({
        calendarId,
        singleEvents: true,
        maxResults: 250,
        timeMin: new Date().toISOString(),
        orderBy: "startTime",
      });
      return { items: res2.data.items || [], nextSyncToken: res2.data.nextSyncToken };
    }
    console.error(`❌ GCal list events error advogado ${advogadoId}:`, e.message);
    return null;
  }
}

// ── Push Notifications (watch channel) ───────────────────────────────────────

export async function gcalRegisterWatch(advogadoId, usuarioId) {
  const auth = await getAuthClientForAdvogado(advogadoId, usuarioId);
  if (!auth) return;
  const where = advogadoId ? { advogadoId } : { usuarioId };
  const tokenRow = await prisma.googleCalendarToken.findUnique({ where });
  if (!tokenRow) return;
  const calendarId = tokenRow.calendarId || "primary";
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return; // sem URL pública, não registra

  const calendar = google.calendar({ version: "v3", auth });
  const channelId = `amr-${advogadoId}-${Date.now()}`;
  const ttl = 7 * 24 * 3600; // 7 dias em segundos (máximo do Google)

  try {
    const res = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: "web_hook",
        address: `${backendUrl}/api/google-calendar/webhook`,
        expiration: String(Date.now() + ttl * 1000),
      },
    });
    await prisma.googleCalendarToken.update({
      where,
      data: {
        channelId: res.data.id,
        channelExpiry: new Date(Number(res.data.expiration)),
        channelResource: res.data.resourceId,
      },
    });
    console.log(`📅 GCal watch channel registrado (adv:${advogadoId}/usr:${usuarioId}): ${channelId}`);
  } catch (e) {
    console.warn(`⚠️ GCal watch channel falhou para advogado ${advogadoId}:`, e.message);
  }
}

export async function gcalStopWatch(advogadoId, usuarioId) {
  const auth = await getAuthClientForAdvogado(advogadoId, usuarioId);
  if (!auth) return;
  const where = advogadoId ? { advogadoId } : { usuarioId };
  const tokenRow = await prisma.googleCalendarToken.findUnique({ where });
  if (!tokenRow?.channelId || !tokenRow.channelResource) return;

  const calendar = google.calendar({ version: "v3", auth });
  try {
    await calendar.channels.stop({
      requestBody: { id: tokenRow.channelId, resourceId: tokenRow.channelResource },
    });
    console.log(`📅 GCal watch channel parado para advogado ${advogadoId}`);
  } catch (_) {}
}
