// lib/scraperDJen.js — DJEN API client (comunicaapi.pje.jus.br)
// API JSON pública, sem autenticação, sem Playwright.
// Cobre todos os tribunais DJEN: TRTs, TRFs, STJ, etc.

const DJEN_BASE = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";

/**
 * Parseia string OAB → { numero, uf }
 * Formatos aceitos: "4001/PA", "PA 4001", "PA-4001", "4001-PA", "PA4001"
 */
export function parsearOAB(oabStr) {
  if (!oabStr?.trim()) return null;
  const clean = oabStr.trim().toUpperCase().replace(/[^A-Z0-9\-\/]/g, "");

  // UF no início: "PA4001", "PA-4001", "PA/4001"
  const m1 = clean.match(/^([A-Z]{2})[\-\/]?(\d+)$/);
  if (m1) return { numero: m1[2], uf: m1[1] };

  // Número no início: "4001PA", "4001-PA", "4001/PA"
  const m2 = clean.match(/^(\d+)[\-\/]?([A-Z]{2})$/);
  if (m2) return { numero: m2[1], uf: m2[2] };

  return null;
}

/**
 * Converte data_disponibilizacao do DJEN → { edicao (YYYYMMDD int), ano }
 * Suporta "2026-03-20" e "2026-03-20T00:00:00Z"
 */
export function parseDJENData(dataStr) {
  if (!dataStr) return null;
  const d = new Date(dataStr.length === 10 ? dataStr + "T12:00:00Z" : dataStr);
  if (isNaN(d)) return null;
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  return { edicao: ano * 10000 + mes * 100 + dia, ano };
}

/**
 * Busca comunicações DJEN para um OAB.
 * Retorna até 100 itens (mais recentes primeiro).
 * @param {string} numeroOab - apenas dígitos (ex: "4001")
 * @param {string} ufOab    - sigla estado (ex: "PA")
 */
export async function buscarDJEN(numeroOab, ufOab) {
  const url = `${DJEN_BASE}?numeroOab=${encodeURIComponent(numeroOab)}&ufOab=${encodeURIComponent(ufOab)}&page=1`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Addere-Monitor/1.0)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[DJEN] HTTP ${res.status} para OAB ${ufOab}${numeroOab}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (e) {
    console.warn(`[DJEN] Erro OAB ${ufOab}${numeroOab}: ${e.message}`);
    return [];
  }
}
