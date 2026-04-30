// backend/src/schedulers/preAudiencia.js
// Checklist de Pré-Audiência — roda a cada 30min
// Detecta audiências nas próximas 24h e 2h e envia checklist para os participantes.

import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp } from "../lib/whatsapp.js";

const IS_TEST = process.env.NODE_ENV === "test";

// Tipos de evento reconhecidos como audiência
const TIPOS_AUDIENCIA = ["AUDIENCIA", "AUDIÊNCIA", "JULGAMENTO", "SESSAO", "SESSÃO"];

function _waPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 11 || d.length === 10) return "55" + d;
  return d.length >= 8 ? "55" + d : null;
}

function _fmtDateHour(d) {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  // BRT = UTC-3
  const brt = new Date(dt.getTime() - 3 * 60 * 60 * 1000);
  return `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()} às ${pad(brt.getUTCHours())}h${pad(brt.getUTCMinutes())}`;
}

// Checklists por antecedência
const CHECKLIST_24H = [
  "Revisar o processo e andamentos recentes",
  "Verificar documentos a apresentar em audiência",
  "Confirmar presença do cliente e informá-lo do horário e local",
  "Consultar a pauta no site do tribunal (CNJ/e-SAJ/PJe)",
  "Preparar argumentação e quesitos (se aplicável)",
  "Verificar procuração e habilitação nos autos",
];

const CHECKLIST_2H = [
  "Confirmar horário e sala com o tribunal",
  "Checar se o cliente está a caminho",
  "Revisar últimas peças e provas",
  "Certificar-se de ter os documentos físicos necessários",
];

function _buildEmailPreAudiencia(nomeAdv, evento, antecedencia) {
  const checklist = antecedencia === "24h" ? CHECKLIST_24H : CHECKLIST_2H;
  const titulo = antecedencia === "24h"
    ? `⚖️ Audiência amanhã — Checklist`
    : `⚖️ Audiência em 2h — Confirmar preparação`;

  const items = checklist.map(i =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">
      <span style="color:#22c55e;margin-right:8px">☐</span>${i}
    </td></tr>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#111d35;padding:20px 28px">
    <div style="color:#b8a06a;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere · Agenda</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">${titulo}</div>
  </td></tr>
  <tr><td style="padding:20px 28px 0">
    <div style="background:#eff6ff;border-radius:8px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#3b82f6;font-weight:600;margin-bottom:4px">EVENTO</div>
      <div style="font-size:15px;font-weight:700;color:#111">${evento.titulo}</div>
      <div style="font-size:13px;color:#64748b;margin-top:3px">📅 ${_fmtDateHour(evento.dataInicio)}</div>
      ${evento.descricao ? `<div style="font-size:12px;color:#64748b;margin-top:4px">${evento.descricao}</div>` : ""}
    </div>
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Checklist</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1f5f9;border-radius:8px;overflow:hidden">
      ${items}
    </table>
  </td></tr>
  <tr><td style="padding:16px 28px">
    <p style="font-size:11px;color:#94a3b8;margin:0">Olá, ${nomeAdv}. Checklist automático enviado pelo sistema Addere.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Controle de alertas já enviados (em memória — evita duplicatas na mesma execução)
const _alertasEnviados = new Set();

function _alertaKey(eventoId, antecedencia) {
  const hoje = new Date().toISOString().slice(0, 10);
  return `${eventoId}:${antecedencia}:${hoje}`;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
export function startPreAudienciaScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    try {
      const agora = new Date();
      const agoraBRT = new Date(agora.getTime() - 3 * 60 * 60 * 1000); // UTC-3

      // Só roda entre 6h e 22h BRT
      const horaBRT = agoraBRT.getUTCHours();
      if (horaBRT < 6 || horaBRT > 22) return;

      // Janelas: eventos nas próximas 2h ±15min e 24h ±15min
      const MARGEM = 15 * 60 * 1000;
      const em2h = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
      const em24h = new Date(agora.getTime() + 24 * 60 * 60 * 1000);

      const [eventos2h, eventos24h] = await Promise.all([
        prisma.agendaEvento.findMany({
          where: {
            status: { not: "CANCELADO" },
            tipo: { in: TIPOS_AUDIENCIA },
            dataInicio: { gte: new Date(em2h.getTime() - MARGEM), lte: new Date(em2h.getTime() + MARGEM) },
          },
          include: { participantes: { include: { usuario: { select: { nome: true, email: true, whatsapp: true, telefone: true } } } } },
        }),
        prisma.agendaEvento.findMany({
          where: {
            status: { not: "CANCELADO" },
            tipo: { in: TIPOS_AUDIENCIA },
            dataInicio: { gte: new Date(em24h.getTime() - MARGEM), lte: new Date(em24h.getTime() + MARGEM) },
          },
          include: { participantes: { include: { usuario: { select: { nome: true, email: true, whatsapp: true, telefone: true } } } } },
        }),
      ]);

      const processar = async (eventos, antecedencia) => {
        for (const ev of eventos) {
          const key = _alertaKey(ev.id, antecedencia);
          if (_alertasEnviados.has(key)) continue;
          _alertasEnviados.add(key);

          console.log(`⚖️ [PreAudiência] Alertando ${antecedencia} antes: "${ev.titulo}"`);

          for (const part of ev.participantes) {
            if (part.status === "RECUSADO") continue;
            const u = part.usuario;
            if (!u) continue;

            // E-mail
            if (u.email) {
              sendEmail({
                to: u.email,
                subject: `⚖️ Addere — Audiência ${antecedencia === "24h" ? "amanhã" : "em 2h"}: ${ev.titulo}`,
                html: _buildEmailPreAudiencia(u.nome || "Advogado", ev, antecedencia),
              }).catch(() => {});
            }

            // WhatsApp
            const phone = _waPhone(u.whatsapp || u.telefone);
            if (phone) {
              const waMsg = antecedencia === "24h"
                ? `⚖️ *Lembrete — Audiência amanhã*\n\n📋 *${ev.titulo}*\n📅 ${_fmtDateHour(ev.dataInicio)}\n\nNão esqueça de revisar o processo e confirmar presença do cliente. Checklist completo enviado por e-mail.`
                : `⚖️ *Atenção — Audiência em 2 horas!*\n\n📋 *${ev.titulo}*\n📅 ${_fmtDateHour(ev.dataInicio)}\n\nConfira o checklist enviado por e-mail. Boa audiência!`;
              sendWhatsApp(phone, waMsg).catch(() => {});
            }
          }
        }
      };

      await processar(eventos2h, "2h");
      await processar(eventos24h, "24h");

      // Limpa cache antigo (> 500 entradas)
      if (_alertasEnviados.size > 500) _alertasEnviados.clear();

    } catch (err) {
      console.error("❌ [PreAudiência] Erro:", err.message);
    }
  }, 30 * 60 * 1000); // a cada 30min
}
