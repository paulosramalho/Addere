// backend/src/schedulers/boletosSincronizador.js
// Fallback de conciliacao para boletos de cobranca Inter ainda EMITIDOS.

import prisma from "../lib/prisma.js";
import { INTER_MODE } from "../lib/interBoleto.js";
import { sincronizarBoletoComInter } from "../lib/boletoSync.js";

const IS_TEST = process.env.NODE_ENV === "test";
const INTERVALO_MS = 30 * 60 * 1000;
const MIN_IDADE_MS = 5 * 60 * 1000;
const LOOKBACK_DIAS = 90;
const LOOKAHEAD_DIAS = 60;

let _running = false;

export async function runBoletosSincronizador({ limit = 50 } = {}) {
  if (INTER_MODE === "mock") return { verificados: 0, atualizados: 0, erros: 0 };

  const agora = Date.now();
  const vencDe = new Date(agora - LOOKBACK_DIAS * 24 * 60 * 60 * 1000);
  const vencAte = new Date(agora + LOOKAHEAD_DIAS * 24 * 60 * 60 * 1000);

  const boletos = await prisma.boletInter.findMany({
    where: {
      status: "EMITIDO",
      modo: { not: "mock" },
      codigoSolicitacao: { not: null },
      createdAt: { lte: new Date(agora - MIN_IDADE_MS) },
      dataVencimento: { gte: vencDe, lte: vencAte },
    },
    orderBy: { dataVencimento: "asc" },
    take: limit,
  });

  if (!boletos.length) return { verificados: 0, atualizados: 0, erros: 0 };

  console.log(`[BoletosSync] ${boletos.length} boleto(s) EMITIDO a verificar`);

  let atualizados = 0;
  let erros = 0;
  for (const boleto of boletos) {
    try {
      const result = await sincronizarBoletoComInter(boleto);
      if (result.sincronizado) {
        atualizados++;
        console.log(`[BoletosSync] #${boleto.id}: ${result.statusAnterior} -> ${result.boleto.status}`);
      }
    } catch (e) {
      erros++;
      console.error(`[BoletosSync] #${boleto.id}:`, e.message);
    }
  }

  return { verificados: boletos.length, atualizados, erros };
}

export function startBoletosSincronizadorScheduler() {
  if (IS_TEST) return;

  console.log("[BoletosSync] Scheduler iniciado (intervalo: 30min)");

  const tick = async () => {
    if (_running) return;
    _running = true;
    try {
      await runBoletosSincronizador();
    } catch (e) {
      console.error("[BoletosSync]", e.message);
    } finally {
      _running = false;
    }
  };

  setTimeout(tick, 60 * 1000);
  setInterval(tick, INTERVALO_MS);
}
