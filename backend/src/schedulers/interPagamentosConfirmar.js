// backend/src/schedulers/interPagamentosConfirmar.js
// Confirma automaticamente boletos agendados/processando cuja data de pagamento
// já passou, transitando status → REALIZADO e LC statusFluxo → EFETIVADO.
// Roda diariamente às 13h UTC (10h BRT), após processamento bancário matinal.

import prisma from "../lib/prisma.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";

function _todayBRT() {
  const brt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Belem" }));
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, "0")}-${String(brt.getDate()).padStart(2, "0")}`;
}

export async function runInterPagamentosConfirmar() {
  const hoje = _todayBRT();
  const limite = new Date(hoje + "T23:59:59Z");

  const pendentes = await prisma.pagamentoBoleto.findMany({
    where: {
      status:       { in: ["PROCESSANDO", "AGENDADO"] },
      dataPagamento: { lte: limite },
    },
    select: { id: true, favorecidoNome: true, valorCentavos: true, dataPagamento: true },
  });

  if (!pendentes.length) return;

  for (const pag of pendentes) {
    await prisma.pagamentoBoleto.update({
      where: { id: pag.id },
      data:  { status: "REALIZADO", updatedAt: new Date() },
    });

    await prisma.livroCaixaLancamento.updateMany({
      where: { referenciaOrigem: `PAG_BOLETO_${pag.id}` },
      data:  { statusFluxo: "EFETIVADO" },
    }).catch(() => {});

    console.log(`✅ [InterConfirmar] #${pag.id} ${pag.favorecidoNome || "—"} → REALIZADO`);
  }

  console.log(`🏦 [InterConfirmar] ${pendentes.length} pagamento(s) confirmado(s) automaticamente.`);
}

let _ultimoRun = null;

export function startInterPagamentosConfirmarScheduler() {
  if (process.env.NODE_ENV === "test") return;

  setInterval(async () => {
    const agora = new Date();
    if (agora.getUTCHours() !== 13) return; // 13h UTC = 10h BRT
    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoRun === hoje) return;
    if (!await _schedulerShouldRun("inter_pagamentos_confirmar", hoje)) { _ultimoRun = hoje; return; }
    _ultimoRun = hoje;
    await _schedulerMarkRun("inter_pagamentos_confirmar", hoje);

    await runInterPagamentosConfirmar().catch((e) =>
      console.error("[InterConfirmar]", e.message)
    );
  }, 60 * 60 * 1000);
}
