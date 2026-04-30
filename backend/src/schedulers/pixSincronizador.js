// backend/src/schedulers/pixSincronizador.js
// Sincroniza status de pagamentos Pix PROCESSANDO com a API Inter
// Roda a cada 15 minutos — atualiza status, dispara notificações e alerta admins

import prisma from "../lib/prisma.js";
import { consultarPix, INTER_MODE } from "../lib/interPix.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp, _waPhone } from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";

const IS_TEST = process.env.NODE_ENV === "test";
const INTERVALO_MS     = 15 * 60 * 1000; // 15 min
const TIMEOUT_ALERTA   = 30 * 60 * 1000; // 30 min = começar a alertar admins
const MIN_IDADE_MS     = 5  * 60 * 1000; // aguardar 5min após criação antes de consultar

const fmtBRL = (c) =>
  (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function _extraAdmins() {
  const email = process.env.EXTRA_NOTIFY_EMAIL?.trim();
  const phone = process.env.EXTRA_NOTIFY_PHONE?.trim();
  const nome  = process.env.EXTRA_NOTIFY_NAME?.trim() || "Amanda";
  return email ? { email, phone, nome } : null;
}

async function sincronizarPix() {
  if (INTER_MODE === "mock") return; // mock não precisa sincronizar

  const agora = Date.now();

  // Buscar Pix PROCESSANDO com endToEndId definido e com mais de 5min de idade
  const pendentes = await prisma.pixPagamento.findMany({
    where: {
      status: "PROCESSANDO",
      endToEndId: { not: null },
      createdAt:  { lte: new Date(agora - MIN_IDADE_MS) },
    },
    take: 50,
    orderBy: { createdAt: "asc" },
    include: { advogado: { select: { nome: true } } },
  });

  if (pendentes.length === 0) return;

  console.log(`🔄 [PixSincronizador] ${pendentes.length} Pix PROCESSANDO a verificar`);

  const admins = await prisma.usuario.findMany({
    where: { role: "ADMIN", ativo: true },
    select: { email: true },
  });
  const extra = _extraAdmins();
  const adminEmails = [
    ...admins.map(a => a.email),
    ...(extra?.email ? [extra.email] : []),
  ].filter(Boolean);

  for (const pix of pendentes) {
    try {
      const resp = await consultarPix(pix.endToEndId);
      const novoStatus = resp.status || pix.status;

      if (novoStatus === pix.status) {
        // Sem mudança — verificar se está PROCESSANDO há mais de 30min
        const idadeMin = (agora - new Date(pix.createdAt).getTime()) / 60000;
        if (idadeMin >= 30) {
          console.warn(`⚠️ [PixSincronizador] Pix #${pix.id} PROCESSANDO há ${idadeMin.toFixed(0)}min`);
          await _alertarAdmin(adminEmails, extra, pix, idadeMin);
        }
        continue;
      }

      // Status mudou — atualizar
      await prisma.pixPagamento.update({
        where:  { id: pix.id },
        data: {
          status:       novoStatus,
          dataPagamento: novoStatus === "REALIZADO" ? new Date() : undefined,
          erro:         novoStatus === "ERRO"
            ? (resp.descricaoErro || "Erro reportado pelo Inter")
            : null,
          updatedAt:    new Date(),
        },
      });

      console.log(`✅ [PixSincronizador] Pix #${pix.id} → ${novoStatus}`);

      if (novoStatus === "REALIZADO") {
        // Importar dinâmico para evitar circular dependency
        const { default: pixRouter } = await import("../routes/pix.js").catch(() => ({ default: null }));
        // Notificar via helper interno (reexportado como função)
        // Como é arquivo de rota, use abordagem direta:
        await _notificarRealizadoSimples(pix, admins, extra);
      }

      if (novoStatus === "ERRO") {
        await _alertarErro(adminEmails, extra, pix, resp.descricaoErro);
      }
    } catch (e) {
      console.error(`❌ [PixSincronizador] Pix #${pix.id}:`, e.message);
    }
  }
}

async function _alertarAdmin(adminEmails, extra, pix, idadeMin) {
  // Evitar spam: só alerta se for múltiplo de 30min de idade (30, 60, 90...)
  if (idadeMin % 30 > 5) return; // tolerância 5min

  const msg = `⚠️ *Addere — Pix aguardando há ${idadeMin.toFixed(0)}min*\n\nID: #${pix.id}\nChave: ${pix.chavePix}\nValor: ${fmtBRL(pix.valorCentavos)}\nE2E: ${pix.endToEndId}\n\nVerifique manualmente no Inter PJ.`;

  const extraPhone = _waPhone(extra?.phone);
  if (extraPhone) {
    await sendWhatsApp(extraPhone, msg).catch(() => {});
  }
}

async function _alertarErro(adminEmails, extra, pix, erro) {
  const valor = fmtBRL(pix.valorCentavos);
  const subject = `❌ Addere — Erro em Pix: ${valor} para ${pix.chavePix}`;
  const html = `<p>O Pix #${pix.id} de <strong>${valor}</strong> para <strong>${pix.chavePix}</strong> retornou erro:</p>
<p><code>${erro || "Sem detalhe"}</code></p>
<p>E2E: ${pix.endToEndId}</p>`;

  for (const email of adminEmails) {
    await sendEmail({ to: email, subject, html }).catch(() => {});
  }

  const extraPhone = _waPhone(extra?.phone);
  if (extraPhone) {
    await sendWhatsApp(extraPhone,
      `❌ *Addere — Pix com ERRO*\n\nValor: ${valor}\nChave: ${pix.chavePix}\nErro: ${erro || "Desconhecido"}`
    ).catch(() => {});
  }
}

async function _notificarRealizadoSimples(pix, admins, extra) {
  const valor   = fmtBRL(pix.valorCentavos);
  const dest    = pix.favorecidoNome || pix.chavePix;
  const subject = `✅ Addere — Pix realizado: ${valor} para ${dest}`;
  const html = `<p>O Pix de <strong>${valor}</strong> para <strong>${dest}</strong> (chave: ${pix.chavePix}) foi <strong>realizado</strong> com sucesso.</p>
<p>E2E: ${pix.endToEndId}</p>`;

  for (const admin of admins) {
    if (admin.email) await sendEmail({ to: admin.email, subject, html }).catch(() => {});
  }

  const extraPhone = _waPhone(extra?.phone);
  if (extraPhone) {
    await sendWhatsApp(extraPhone,
      `✅ *Addere — Pix Realizado*\n\nValor: ${valor}\nDestinatário: ${dest}\nChave: ${pix.chavePix}\nE2E: ${pix.endToEndId}`
    ).catch(() => {});
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startPixSincronizadorScheduler() {
  if (IS_TEST) return;

  console.log("🔄 [PixSincronizador] Scheduler iniciado (intervalo: 15min)");

  setInterval(async () => {
    try {
      const pode = await _schedulerShouldRun("pix_sincronizador", INTERVALO_MS);
      if (!pode) return;
      await _schedulerMarkRun("pix_sincronizador");
      await sincronizarPix();
    } catch (e) {
      console.error("❌ [PixSincronizador]", e.message);
    }
  }, INTERVALO_MS);
}
