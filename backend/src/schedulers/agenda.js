import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsAppTemplate } from "../lib/whatsapp.js";

const IS_TEST = process.env.NODE_ENV === "test";

// ── Helpers ───────────────────────────────────────────────────────────────────

function _waPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 11 || d.length === 10) return "55" + d;
  return d.length >= 8 ? "55" + d : null;
}

function _fmtAntecedencia(min) {
  if (min < 60) return `${min} minuto${min === 1 ? "" : "s"}`;
  if (min < 1440) return `${Math.round(min / 60)} hora${min === 60 ? "" : "s"}`;
  return `${Math.round(min / 1440)} dia${min === 1440 ? "" : "s"}`;
}

function _fmtHora(d) {
  return new Date(d).toLocaleString("pt-BR", { timeStyle: "short", timeZone: "America/Belem" });
}

function _fmtDataHora(d) {
  return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Belem" });
}

function _fmtDataCurta(d) {
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Belem" });
}

// ── E-mail lembrete individual ─────────────────────────────────────────────────

function buildEmailLembreteAgenda(nome, evento, antecedenciaMin) {
  const fmtDH = (d) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Belem" });
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center">
        <h2 style="margin:0;font-size:18px">🗓️ Lembrete de Agenda</h2>
        <p style="margin:4px 0 0;font-size:12px;opacity:.8">Addere</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none">
        <p style="margin:0 0 12px">Olá, <strong>${nome}</strong>!</p>
        <p style="margin:0 0 12px;color:#374151">Você tem um evento em breve:</p>
        <div style="background:#f0f7ff;border-left:4px solid #2563eb;padding:16px;border-radius:0 8px 8px 0;margin:0 0 16px">
          <div style="font-size:17px;font-weight:bold;margin-bottom:8px;color:#1e3a5f">${evento.titulo}</div>
          <div style="color:#374151;font-size:13px;line-height:1.8">
            <div>📅 <strong>Data/Hora:</strong> ${fmtDH(evento.dataInicio)}</div>
            <div>🏷️ <strong>Tipo:</strong> ${evento.tipo}</div>
            ${evento.descricao ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #dbeafe">📝 ${evento.descricao}</div>` : ""}
          </div>
        </div>
        <p style="color:#6b7280;font-size:12px;margin:0">
          Este lembrete foi configurado para ser enviado com <strong>${_fmtAntecedencia(antecedenciaMin)}</strong> de antecedência.
        </p>
      </div>
      <div style="background:#f9fafb;padding:12px;text-align:center;font-size:11px;color:#9ca3af;border-radius:0 0 8px 8px">
        Addere — Sistema de Gestão Financeira
      </div>
    </div>
  `;
}

// ── WA: helpers de envio via template ────────────────────────────────────────

function _sendWaLembrete(phone, evento, antecedenciaMin) {
  // Template: lembrete_agenda · {{1}} = título · {{2}} = data/hora
  return sendWhatsAppTemplate(phone, "lembrete_agenda", "pt_BR", [{
    type: "body",
    parameters: [
      { type: "text", text: evento.titulo },
      { type: "text", text: _fmtDataHora(evento.dataInicio) },
    ],
  }], { maxAttempts: 1 });
}

function _sendWaDigest(phone, nome, eventos) {
  // Template: agenda_diaria · {{1}} = nome · {{2}} = lista de eventos
  const lista = eventos.map((ev) => `• ${_fmtHora(ev.dataInicio)} — ${ev.titulo}`).join("\n");
  return sendWhatsAppTemplate(phone, "agenda_diaria", "pt_BR", [{
    type: "body",
    parameters: [
      { type: "text", text: nome },
      { type: "text", text: lista },
    ],
  }], { maxAttempts: 1 });
}

// ── Digest diário às 08:00 BRT ────────────────────────────────────────────────

// Inicializar com data de hoje se já passamos da janela 08:04 BRT no startup,
// evitando reenvio duplo quando o backend é reiniciado dentro da janela.
function _initLastDigestDate() {
  const brtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Belem" }));
  const hora = brtNow.getHours();
  const min  = brtNow.getMinutes();
  // Se já passou de 08:04, marca hoje para não disparar novamente
  if (hora > 8 || (hora === 8 && min >= 5)) {
    return `${brtNow.getFullYear()}-${brtNow.getMonth()}-${brtNow.getDate()}`;
  }
  return "";
}

let _lastDigestDate = _initLastDigestDate();

async function _enviarDigestDiario() {
  const agora = new Date();
  const brtNow = new Date(agora.toLocaleString("en-US", { timeZone: "America/Belem" }));
  // Janela do dia em UTC: 00:00 BRT = 03:00 UTC
  const inicioDia = new Date(Date.UTC(
    brtNow.getFullYear(), brtNow.getMonth(), brtNow.getDate(), 3, 0, 0
  ));
  const fimDia = new Date(inicioDia.getTime() + 24 * 60 * 60 * 1000);

  const eventos = await prisma.agendaEvento.findMany({
    where: { status: "PENDENTE", dataInicio: { gte: inicioDia, lt: fimDia } },
    include: {
      criadoPor: {
        select: { id: true, nome: true, telefone: true, advogado: { select: { telefone: true } } },
      },
      participantes: {
        include: {
          usuario: { select: { id: true, nome: true, telefone: true, advogado: { select: { telefone: true } } } },
        },
      },
    },
    orderBy: { dataInicio: "asc" },
  });

  if (!eventos.length) return;

  // Agrupar por usuário (deduplicando eventos)
  const porUsuario = new Map(); // userId → { nome, phone, eventoIds: Set, eventos: [] }

  function _addEvento(userId, nome, phone, ev) {
    if (!phone) return;
    if (!porUsuario.has(userId)) {
      porUsuario.set(userId, { nome, phone, eventoIds: new Set(), eventos: [] });
    }
    const entry = porUsuario.get(userId);
    if (!entry.eventoIds.has(ev.id)) {
      entry.eventoIds.add(ev.id);
      entry.eventos.push(ev);
    }
  }

  for (const ev of eventos) {
    if (ev.criadoPor) {
      const phone = _waPhone(ev.criadoPor.advogado?.telefone || ev.criadoPor.telefone);
      _addEvento(ev.criadoPor.id, ev.criadoPor.nome, phone, ev);
    }
    for (const p of ev.participantes) {
      if (!p.usuario || p.status === "RECUSADO") continue;
      const phone = _waPhone(p.usuario.advogado?.telefone || p.usuario.telefone);
      _addEvento(p.usuario.id, p.usuario.nome, phone, ev);
    }
  }

  let enviados = 0;
  for (const [, { nome, phone, eventos: evs }] of porUsuario) {
    await _sendWaDigest(phone, nome, evs).catch(() => {});
    enviados++;
  }

  if (enviados) console.log(`📅 Digest diário WA enviado para ${enviados} usuário(s)`);
}

// ── Scheduler principal ───────────────────────────────────────────────────────

let _agendaLembretesRunning = false;
let _agendaLastRun = 0;

export function startAgendaScheduler() {
  if (IS_TEST) return;

  // Tick a cada 1 min
  setInterval(async () => {
    const agora = new Date();
    const brtNow = new Date(agora.toLocaleString("en-US", { timeZone: "America/Belem" }));
    const horaBRT = brtNow.getHours();
    const minBRT  = brtNow.getMinutes();

    // ── a) Digest diário às 08:00–08:04 BRT ──────────────────────────────────
    const hoje = `${brtNow.getFullYear()}-${brtNow.getMonth()}-${brtNow.getDate()}`;
    if (horaBRT === 8 && minBRT < 5 && _lastDigestDate !== hoje) {
      _lastDigestDate = hoje;
      _enviarDigestDiario().catch((e) => console.error("❌ Digest diário WA:", e.message));
    }

    // ── b) Lembretes individuais (5min diurno / 30min noturno) ───────────────
    const isNoturno = horaBRT >= 20 || horaBRT < 6;
    const intervalo = isNoturno ? 30 * 60 * 1000 : 5 * 60 * 1000;
    if (Date.now() - _agendaLastRun < intervalo) return;
    if (_agendaLembretesRunning) return;
    _agendaLembretesRunning = true;
    _agendaLastRun = Date.now();

    try {
      const lembretes = await prisma.agendaLembrete.findMany({
        where: {
          disparadoEm: null,
          // Isola notificações do app — eventos sincronizados do Google Calendar
          // têm lembretes gerenciados pelo próprio GCal; não enviamos WA por eles.
          evento: { syncSource: { not: "GOOGLE" } },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          eventoId: true,
          usuarioId: true,
          emailExterno: true,
          antecedenciaMin: true,
          canal: true,
          usuario: {
            select: {
              id: true, nome: true, email: true, telefone: true,
              advogado: { select: { telefone: true } },
            },
          },
        },
      });
      if (!lembretes.length) return;

      const eventoIds = [...new Set(lembretes.map((l) => l.eventoId).filter(Boolean))];
      const eventos = await prisma.agendaEvento.findMany({
        where: { id: { in: eventoIds }, status: "PENDENTE" },
        select: { id: true, titulo: true, dataInicio: true, descricao: true, tipo: true },
      });
      const eventoById = new Map(eventos.map((e) => [e.id, e]));

      let enviados = 0;
      const sentEmailKeys = new Set();
      const sentWaKeys = new Set();

      for (const lem of lembretes) {
        const evento = eventoById.get(lem.eventoId);
        if (!evento) continue; // órfão/cancelado/concluído

        const disparoEm = new Date(evento.dataInicio.getTime() - lem.antecedenciaMin * 60 * 1000);
        if (agora < disparoEm) continue;

        // ── Claim atômico: marcar ANTES de enviar ───────────────────────────────
        // Se outro processo/instância já marcou, count === 0 → pular
        const claimed = await prisma.agendaLembrete.updateMany({
          where: { id: lem.id, disparadoEm: null },
          data:  { disparadoEm: agora },
        });
        if (claimed.count === 0) continue; // já processado

        const nome = lem.usuario?.nome || "Participante";

        // E-mail (somente canal EMAIL), deduplicado por evento+antecedência+destino
        if (lem.canal === "EMAIL") {
          const to = lem.usuario?.email || lem.emailExterno;
          if (to) {
            const emailKey = `${evento.id}|${lem.antecedenciaMin}|${String(to).trim().toLowerCase()}`;
            if (!sentEmailKeys.has(emailKey)) {
              sentEmailKeys.add(emailKey);
              try {
                await sendEmail({
                  to,
                  subject: `🗓️ Lembrete: ${evento.titulo}`,
                  html: buildEmailLembreteAgenda(nome, evento, lem.antecedenciaMin),
                });
                enviados++;
                if (enviados % 2 === 0) await new Promise((r) => setTimeout(r, 1100));
              } catch (eEmail) {
                console.error("❌ Email lembrete agenda:", eEmail.message);
              }
            }
          }
        }

        // WhatsApp — sempre, independente do canal (dedupe por evento+antecedência+telefone)
        const phone = _waPhone(lem.usuario?.advogado?.telefone || lem.usuario?.telefone);
        if (phone) {
          const waKey = `${evento.id}|${lem.antecedenciaMin}|${phone}`;
          if (!sentWaKeys.has(waKey)) {
            sentWaKeys.add(waKey);
            await _sendWaLembrete(phone, evento, lem.antecedenciaMin).catch(() => {});
          }
        }

        enviados++;
      }
    } catch (e) {
      console.error("❌ Scheduler agenda lembretes:", e.message);
    } finally {
      _agendaLembretesRunning = false;
    }
  }, 60 * 1000);
}

export { buildEmailLembreteAgenda, _enviarDigestDiario };
