// schedulers/intimacoes.js — Sync diário DJe (multi-tribunal) + DJEN (por OAB)
// Roda às 8h BRT (11h UTC).
// DJe: baixa PDFs de TJPA/TJSP/TJAM e busca nomes/OABs dos advogados.
// DJEN: consulta API JSON por OAB para TRTs, TRFs e demais tribunais PJe.

import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp } from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";
import {
  TRIBUNAIS_DJE,
  gerarTarefas,
  lockKeyDJe,
  paramsToEdicao,
  downloadDJe,
  extrairTextoDJe,
  buscarTrechos,
} from "../lib/scraperDJe.js";
import { parsearOAB, parseDJENData, buscarDJEN } from "../lib/scraperDJen.js";

const IS_TEST = process.env.NODE_ENV === "test";

/** Verifica se uma tarefa já foi processada (SchedulerLock permanente) */
async function _jaProcessado(lockKey) {
  try {
    const rows = await prisma.$queryRaw`SELECT key FROM "SchedulerLock" WHERE key = ${lockKey}`;
    return rows.length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Processa uma tarefa DJe: baixa o PDF, extrai texto, busca advogados, salva intimações.
 * Exportado para uso na rota de sync manual.
 *
 * @param {string} tribunal - "tjpa" | "tjsp" | "tjam"
 * @param {object} params   - { edicao, ano } (tjpa) ou { data, caderno } (outros)
 * @param {Array}  advogados
 */
export async function processarDJe(tribunal, params, advogados) {
  const lockKey = lockKeyDJe(tribunal, params);

  if (await _jaProcessado(lockKey)) {
    return { tribunal, params, novos: 0, skipped: true };
  }

  const label = tribunal === "tjpa"
    ? `ed.${params.edicao}/${params.ano}`
    : `${params.data.toISOString().slice(0, 10)} cad${params.caderno}`;

  console.log(`[DJe] ${tribunal.toUpperCase()} ${label}: baixando...`);
  const buffer = await downloadDJe(tribunal, params);
  if (!buffer) {
    const hoje = new Date().toISOString().slice(0, 10);
    await _schedulerMarkRun(lockKey, hoje);
    return { tribunal, params, novos: 0, skipped: false };
  }

  const sizeKB = (buffer.length / 1024).toFixed(0);
  console.log(`[DJe] ${tribunal.toUpperCase()} ${label}: extraindo texto (${sizeKB} KB)...`);
  const texto = await extrairTextoDJe(buffer);

  const termos = advogados.flatMap(adv => [
    { termo: adv.nome, advogadoId: adv.id },
    { termo: adv.oab,  advogadoId: adv.id },
  ]);

  const trechos = buscarTrechos(texto, termos);
  console.log(`[DJe] ${tribunal.toUpperCase()} ${label}: ${trechos.length} ocorrência(s)`);

  const { edicao, ano } = paramsToEdicao(tribunal, params);
  let novos = 0;

  for (const t of trechos) {
    try {
      await prisma.intimacao.create({
        data: {
          tribunal,
          edicao,
          ano,
          texto:      t.trecho,
          termoBusca: t.termoBusca,
          advogadoId: t.advogadoId,
        },
      });
      novos++;
    } catch (e) {
      if (!e.message?.includes("Unique")) {
        console.warn(`[DJe] Erro ao salvar intimação:`, e.message);
      }
    }
  }

  const hoje = new Date().toISOString().slice(0, 10);
  await _schedulerMarkRun(lockKey, hoje);

  return { tribunal, params, novos, skipped: false };
}

// Alias para compatibilidade com rota legada
export async function processarEdicao(edicao, ano, advogados) {
  return processarDJe("tjpa", { edicao, ano }, advogados);
}

/**
 * Processa DJEN via API JSON por OAB.
 * Exportado para uso na rota de sync manual.
 *
 * @param {Array} advogados - lista de advogados ativos com campo oab
 * @returns {{ novos: number, novosPorAdv: Map<number, number> }}
 */
export async function processarDJEN(advogados) {
  const hoje = new Date().toISOString().slice(0, 10);
  let novos = 0;
  const novosPorAdv = new Map(); // advogadoId → count

  for (const adv of advogados) {
    const oab = parsearOAB(adv.oab);
    if (!oab) {
      console.warn(`[DJEN] OAB inválida para ${adv.nome}: "${adv.oab}"`);
      continue;
    }

    const lockKey = `djen-oab-${adv.id}-${hoje}`;
    if (await _jaProcessado(lockKey)) continue;

    console.log(`[DJEN] OAB ${oab.uf}${oab.numero} (${adv.nome}): buscando...`);
    const items = await buscarDJEN(oab.numero, oab.uf);

    if (items.length === 0) {
      await _schedulerMarkRun(lockKey, hoje);
      continue;
    }

    // Busca IDs DJEN já armazenados para este advogado (evita N+1)
    const existingSet = new Set(
      (await prisma.intimacao.findMany({
        where: { advogadoId: adv.id, termoBusca: { startsWith: "DJEN:" } },
        select: { termoBusca: true },
      })).map(r => r.termoBusca)
    );

    let novosAdv = 0;
    for (const item of items) {
      const termoBusca = `DJEN:${item.id}`;
      if (existingSet.has(termoBusca)) continue;

      const daten = parseDJENData(item.data_disponibilizacao);
      if (!daten) continue;

      const tribunal = (item.siglaTribunal || "DJEN").toLowerCase();

      // Texto: prioriza campo texto, fallback descritivo
      const texto = item.texto?.trim() ||
        [
          item.tipoComunicacao,
          item.nomeOrgao,
          item.numero_processo ? `Processo: ${item.numero_processo}` : null,
          item.nomeClasse,
        ].filter(Boolean).join(" — ") ||
        "Comunicação sem texto";

      // Vincula ao processo existente se possível
      let processoId = null;
      if (item.numero_processo) {
        const proc = await prisma.processoJudicial.findFirst({
          where: { numeroProcesso: item.numero_processo },
          select: { id: true },
        });
        processoId = proc?.id || null;
      }

      try {
        await prisma.intimacao.create({
          data: {
            tribunal,
            edicao:     daten.edicao,
            ano:        daten.ano,
            texto,
            termoBusca,
            advogadoId: adv.id,
            processoId,
          },
        });
        novosAdv++;
        novos++;
      } catch (e) {
        if (!e.message?.includes("Unique")) {
          console.warn(`[DJEN] Erro ao salvar:`, e.message);
        }
      }
    }

    if (novosAdv > 0) {
      novosPorAdv.set(adv.id, (novosPorAdv.get(adv.id) || 0) + novosAdv);
      console.log(`[DJEN] ${adv.nome}: ${novosAdv} nova(s)`);
    }

    await _schedulerMarkRun(lockKey, hoje);
  }

  console.log(`[DJEN] Total: ${novos} comunicação(ões), ${novosPorAdv.size} advogado(s)`);
  return { novos, novosPorAdv };
}

export function startIntimacoesScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();
    // 8h BRT = 11h UTC
    if (utcHour !== 11 || utcMin > 5) return;

    const hoje = now.toISOString().slice(0, 10);
    if (!(await _schedulerShouldRun("intimacoes-dje", hoje))) return;
    await _schedulerMarkRun("intimacoes-dje", hoje);

    console.log("[Intimacoes] Scheduler iniciando — DJe:", Object.keys(TRIBUNAIS_DJE).join(", "), "/ DJEN");

    try {
      const advogados = await prisma.advogado.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, oab: true, email: true, whatsapp: true, telefone: true },
      });

      const novosPorAdv = new Map(); // advogadoId → count

      // ── DJe (PDF) ──────────────────────────────────────────────────────────
      for (const tribunal of Object.keys(TRIBUNAIS_DJE)) {
        const tarefas = gerarTarefas(tribunal, now);

        for (const params of tarefas) {
          try {
            const r = await processarDJe(tribunal, params, advogados);
            if (r.novos > 0) {
              const { edicao, ano } = paramsToEdicao(tribunal, params);
              const intimacoes = await prisma.intimacao.findMany({
                where: { tribunal, edicao, ano, notificado: false },
                select: { advogadoId: true },
              });
              for (const i of intimacoes) {
                if (i.advogadoId) {
                  novosPorAdv.set(i.advogadoId, (novosPorAdv.get(i.advogadoId) || 0) + 1);
                }
              }
            }
          } catch (e) {
            console.warn(`[DJe] ${tribunal} erro:`, e.message);
          }
        }
      }

      // ── DJEN (JSON por OAB) ────────────────────────────────────────────────
      try {
        const { novosPorAdv: djenMap } = await processarDJEN(advogados);
        for (const [advId, qtd] of djenMap) {
          novosPorAdv.set(advId, (novosPorAdv.get(advId) || 0) + qtd);
        }
      } catch (e) {
        console.warn("[DJEN] Scheduler erro:", e.message);
      }

      // ── Notificações ────────────────────────────────────────────────────────
      for (const [advId, qtd] of novosPorAdv) {
        const adv = advogados.find(a => a.id === advId);
        if (!adv) continue;

        const phone = adv.telefone;
        const primeiroNome = adv.nome.split(" ")[0];
        const waMsg = `⚖️ *Addere — Nova(s) intimação(ões)*\n\nOlá ${primeiroNome}, identificamos *${qtd} intimação(ões)* publicada(s) no Diário da Justiça.\n\nAcesse o sistema em *Jurídico → Intimações* para visualizar.`;
        const emailHtml = `<p>Olá <b>${adv.nome}</b>,</p><p>Identificamos <b>${qtd} intimação(ões)</b> publicada(s) no Diário da Justiça.</p><p>Acesse o sistema em <b>Jurídico → Intimações</b> para visualizar os detalhes.</p>`;

        await Promise.allSettled([
          adv.email ? sendEmail({
            to:      adv.email,
            subject: `Addere — ${qtd} nova(s) intimação(ões)`,
            html:    emailHtml,
          }) : Promise.resolve(),
          phone ? sendWhatsApp(phone, waMsg) : Promise.resolve(),
        ]);

        await prisma.intimacao.updateMany({
          where: { advogadoId: advId, notificado: false },
          data:  { notificado: true },
        });
      }

      const total = [...novosPorAdv.values()].reduce((a, b) => a + b, 0);
      console.log(`[Intimacoes] Scheduler concluído: ${total} intimações, ${novosPorAdv.size} advogado(s) notificado(s)`);
    } catch (e) {
      console.error("[Intimacoes] Scheduler erro:", e.message);
    }
  }, 5 * 60 * 1000);
}
