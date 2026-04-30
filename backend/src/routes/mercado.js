/**
 * GET /api/mercado
 * Retorna bolsas (IBOVESPA, Dow Jones, Nasdaq) e câmbio (USD-BRL, EUR-BRL).
 * Cache em memória de 5 minutos para não abusar das APIs externas.
 *
 * Bolsas: Yahoo Finance v8/chart (query2) — mais confiável que v7/query1 em servidores
 * Câmbio: AwesomeAPI (gratuita, sem CORS)
 */
import { Router } from "express";

const router = Router();

const CACHE_TTL = 5 * 60 * 1000; // 5 min

let _cache = null;
let _cacheAt = 0;

// Headers que imitam browser — Yahoo Finance bloqueia User-Agents de servidor genéricos
const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://finance.yahoo.com/",
  "Origin": "https://finance.yahoo.com",
};

/** Busca meta de um símbolo via Yahoo Finance chart API (query2 + v8). */
async function _yfChart(symbol) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const res = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) { console.warn(`[mercado] Yahoo ${symbol} HTTP ${res.status}`); return null; }
  const data = await res.json();
  return data?.chart?.result?.[0]?.meta ?? null;
}

async function fetchYahooIndex(symbol) {
  const meta = await _yfChart(symbol);
  if (!meta) return null;
  const price = meta.regularMarketPrice;
  const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const change    = price - prev;
  const changePct = prev !== 0 ? (change / prev) * 100 : 0;
  return { symbol, price, change, changePct, marketState: meta.marketState ?? null };
}

/** Retorna câmbio no formato { bid, ask, high, low, pctChange } via Yahoo Finance. */
async function fetchYahooForex(symbol) {
  const meta = await _yfChart(symbol);
  if (!meta) return null;
  const price = meta.regularMarketPrice;
  const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const pctChange = prev !== 0 ? ((price - prev) / prev * 100).toFixed(4) : "0";
  return {
    bid:       String(price),
    ask:       String(meta.regularMarketPrice ?? price),
    high:      String(meta.regularMarketDayHigh ?? price),
    low:       String(meta.regularMarketDayLow  ?? price),
    pctChange: String(pctChange),
  };
}

router.get("/api/mercado", async (req, res) => {
  // Serve cache se ainda válido
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) {
    return res.json({ ..._cache, cached: true });
  }

  // Promise.allSettled garante que uma falha não cancela as demais
  const [ibovR, djiR, ixicR, usdR, eurR] = await Promise.allSettled([
    fetchYahooIndex("^BVSP"),
    fetchYahooIndex("^DJI"),
    fetchYahooIndex("^IXIC"),
    fetchYahooForex("USDBRL=X"),
    fetchYahooForex("EURBRL=X"),
  ]);

  const ibov = ibovR.status === "fulfilled" ? ibovR.value : null;
  const dji  = djiR.status  === "fulfilled" ? djiR.value  : null;
  const ixic = ixicR.status === "fulfilled" ? ixicR.value : null;
  const usd  = usdR.status  === "fulfilled" ? usdR.value  : null;
  const eur  = eurR.status  === "fulfilled" ? eurR.value  : null;

  if (ibovR.status === "rejected") console.warn("[mercado] IBOV:", ibovR.reason?.message);
  if (djiR.status  === "rejected") console.warn("[mercado] DJI:",  djiR.reason?.message);
  if (ixicR.status === "rejected") console.warn("[mercado] IXIC:", ixicR.reason?.message);
  if (usdR.status  === "rejected") console.warn("[mercado] USD:",  usdR.reason?.message);
  if (eurR.status  === "rejected") console.warn("[mercado] EUR:",  eurR.reason?.message);

  // Se absolutamente nada veio, retorna cache expirado ou 502
  if (!ibov && !dji && !ixic && !usd && !eur) {
    console.error("[mercado] Todas as fontes falharam.");
    if (_cache) return res.json({ ..._cache, cached: true, stale: true });
    return res.status(502).json({ error: "Dados de mercado temporariamente indisponíveis." });
  }

  const payload = {
    indices: { ibov, dji, ixic },
    forex:   { usd, eur },
    updatedAt: new Date().toISOString(),
    cached: false,
  };

  _cache  = payload;
  _cacheAt = Date.now();
  return res.json(payload);
});

export default router;
