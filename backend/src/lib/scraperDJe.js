// lib/scraperDJe.js — Scraper multi-tribunal do DJe
// Tribunais suportados: TJPA (por edição), TJSP, TJAM (por data + caderno)

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// ── Configuração dos tribunais ────────────────────────────────────────────────

export const TRIBUNAIS_DJE = {
  tjpa: { nome: "TJPA", tipo: "edicao" },
  tjsp: { nome: "TJSP", tipo: "data", cadernos: [1, 2] },
  tjam: { nome: "TJAM", tipo: "data", cadernos: [1, 2] },
};

// Âncora TJPA: edição 8266 = 2026-03-06
const TJPA_ANCHOR_EDICAO = 8266;
const TJPA_ANCHOR_DATE   = new Date("2026-03-06T12:00:00.000Z");

// ── Helpers internos ──────────────────────────────────────────────────────────

function _fmtDMY(date) {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getUTCFullYear()}`;
}

function _djUrl(tribunal, params) {
  switch (tribunal) {
    case "tjpa":
      return `https://dje.tjpa.jus.br/DJEletronico/rest/DJEletronicoService/publicacao/buscarDiarioAssinado/${params.edicao}-${params.ano}`;
    case "tjsp":
      return `https://dje.tjsp.jus.br/cdje/downloadCaderno.do?dtDiario=${_fmtDMY(params.data)}&cdCaderno=${params.caderno}`;
    case "tjam":
      return `https://consultasaj.tjam.jus.br/cdje/downloadCaderno.do?dtDiario=${_fmtDMY(params.data)}&cdCaderno=${params.caderno}`;
    default:
      return null;
  }
}

// ── Exports públicos ──────────────────────────────────────────────────────────

/** Estima a edição TJPA correspondente a uma data */
export function estimarEdicaoTJPA(date = new Date()) {
  const diffMs   = date - TJPA_ANCHOR_DATE;
  const diffDias = diffMs / (1000 * 60 * 60 * 24);
  return TJPA_ANCHOR_EDICAO + Math.round(diffDias * 5 / 7);
}

// Alias para compatibilidade com código existente
export const estimarEdicao = estimarEdicaoTJPA;

/**
 * Gera a chave de SchedulerLock para uma tarefa DJe.
 * TJPA: "dje-tjpa-{edicao}-{ano}"
 * Outros: "dje-{tribunal}-{yyyy-mm-dd}-cad{N}"
 */
export function lockKeyDJe(tribunal, params) {
  if (tribunal === "tjpa") return `dje-tjpa-${params.edicao}-${params.ano}`;
  const dateStr = params.data.toISOString().slice(0, 10);
  return `dje-${tribunal}-${dateStr}-cad${params.caderno}`;
}

/**
 * Gera as tarefas a tentar hoje para cada tribunal.
 * TJPA: últimas 5 edições estimadas.
 * Data-based: últimos 5 dias úteis × cadernos configurados.
 */
export function gerarTarefas(tribunal, agora = new Date()) {
  if (tribunal === "tjpa") {
    const ano = agora.getUTCFullYear();
    const est = estimarEdicaoTJPA(agora);
    return [0, 1, 2, 3, 4].map(i => ({ edicao: est - i, ano }));
  }

  const cadernos = TRIBUNAIS_DJE[tribunal]?.cadernos || [1];
  const tarefas  = [];
  for (let i = 0; i < 7 && tarefas.length < 5 * cadernos.length; i++) {
    const data = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - i));
    const dow  = data.getUTCDay();
    if (dow === 0 || dow === 6) continue; // pula fim de semana
    for (const caderno of cadernos) tarefas.push({ data, caderno });
  }
  return tarefas;
}

/**
 * Para tribunais data-based: converte params.data em inteiro YYYYMMDD
 * para armazenar no campo `edicao` da tabela Intimacao.
 */
export function paramsToEdicao(tribunal, params) {
  if (tribunal === "tjpa") return { edicao: params.edicao, ano: params.ano };
  const d = params.data;
  const edicao = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  return { edicao, ano: d.getUTCFullYear() };
}

/**
 * Inverso: formata para exibição amigável.
 * TJPA: "Edição 8266/2026"
 * Outros: "21/03/2026 cad.1"
 */
export function formatarEdicao(tribunal, edicao, ano) {
  if (tribunal === "tjpa") return `Edição ${edicao}/${ano}`;
  // edicao = YYYYMMDD
  const s = String(edicao).padStart(8, "0");
  return `${s.slice(6)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}

/**
 * Baixa o PDF de uma edição/data do DJe.
 * Retorna Buffer ou null se não disponível / não é PDF.
 */
export async function downloadDJe(tribunal, params) {
  const url = _djUrl(tribunal, params);
  if (!url) return null;

  const label = tribunal === "tjpa"
    ? `ed.${params.edicao}/${params.ano}`
    : `${_fmtDMY(params.data)} cad${params.caderno}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(60000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Addere-Monitor/1.0)",
        "Accept": "application/pdf, */*",
      },
    });

    if (!res.ok) return null;

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("pdf") && !ct.includes("octet-stream")) {
      console.warn(`[DJe] ${tribunal.toUpperCase()} ${label}: Content-Type: ${ct}`);
      return null;
    }

    const buf = await res.arrayBuffer();
    const b = Buffer.from(buf);

    if (b.length < 5 || b.slice(0, 5).toString("ascii") !== "%PDF-") {
      console.warn(`[DJe] ${tribunal.toUpperCase()} ${label}: resposta não é PDF`);
      return null;
    }

    return b;
  } catch (e) {
    console.warn(`[DJe] ${tribunal.toUpperCase()} ${label}: ${e.message}`);
    return null;
  }
}

/** Extrai texto completo de um PDF Buffer usando pdfjs-dist */
export async function extrairTextoDJe(pdfBuffer) {
  const ab = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(ab),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const partes = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    partes.push(content.items.map(item => item.str).join(" "));
  }
  return partes.join("\n");
}

/**
 * Busca termos no texto e retorna trechos com contexto.
 * Agrupa matches próximos (mesmo bloco de 300 chars) para evitar duplicatas.
 */
export function buscarTrechos(texto, termos, janelaChars = 500) {
  const resultado = [];
  const lower = texto.toLowerCase();

  for (const { termo, advogadoId } of termos) {
    if (!termo?.trim()) continue;
    const t = termo.toLowerCase().trim();
    let pos = 0;
    const blocos = new Set();

    while ((pos = lower.indexOf(t, pos)) !== -1) {
      const bloco = Math.floor(pos / 300);
      const chave = `${advogadoId}|${bloco}`;
      if (!blocos.has(chave)) {
        blocos.add(chave);
        const start = Math.max(0, pos - janelaChars);
        const end   = Math.min(texto.length, pos + t.length + janelaChars);
        resultado.push({
          advogadoId,
          termoBusca: termo,
          trecho: texto.slice(start, end).replace(/\s+/g, " ").trim(),
        });
      }
      pos += t.length;
    }
  }

  return resultado;
}
