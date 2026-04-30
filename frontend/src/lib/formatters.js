// ============================================================
// src/lib/formatters.js
// Funções utilitárias de formatação — compartilhadas entre páginas
// ============================================================

/**
 * Converte centavos (Int) para string BRL.
 * Ex.: 123456 → "R$ 1.234,56"
 */
export function brlFromCentavos(c) {
  const n = Number(c || 0);
  return (n / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

/**
 * Alias de brlFromCentavos — compatível com usos que chamam centsToBRL.
 */
export const centsToBRL = brlFromCentavos;

/**
 * Converte Decimal/float (reais, não centavos) para string BRL.
 * Ex.: 1234.56 → "R$ 1.234,56"
 */
export function formatBRLFromDecimal(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

/**
 * Formata uma data ISO ou Date para DD/MM/AAAA.
 * Retorna "—" se inválido.
 */
export function fmtDate(iso) {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d)) return "—";
  // Usa partes UTC para evitar desvio de fuso
  const str = typeof iso === "string" ? iso : iso.toISOString();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return d.toLocaleDateString("pt-BR");
}

/**
 * Converte um valor tipo Date | string ISO | "DD/MM/AAAA" para "DD/MM/AAAA".
 */
export function toDDMMYYYY(dateLike) {
  if (!dateLike) return "";
  const s = String(dateLike);
  // já está no formato DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // ISO ou Date
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

/**
 * Retorna a data de hoje no formato DD/MM/AAAA.
 */
export function todayBR() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Retorna abreviação "Mmm/AAAA" a partir de uma string ISO AAAA-MM-DD.
 * Ex.: "2026-03-01" → "Mar/2026"
 */
export function mesCurto(isoYYYYMMDD) {
  const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  if (!isoYYYYMMDD) return "";
  const [yyyy, mm] = String(isoYYYYMMDD).split("-");
  const idx = Number(mm) - 1;
  if (idx < 0 || idx > 11) return "";
  return `${MESES[idx]}/${yyyy}`;
}

/**
 * Converte dígitos brutos de porcentagem para decimal.
 * Ex.: "4500" → 0.45   "647" → 0.0647
 * (Complementa PercentageInputBR)
 */
export function percentDigitsToDecimal(digits) {
  return Number(digits || 0) / 10000;
}

/**
 * Converte decimal para dígitos brutos de porcentagem.
 * Ex.: 0.45 → "4500"   0.0647 → "647"
 */
export function decimalToPercentDigits(dec) {
  return Math.round((dec || 0) * 10000).toString();
}

/**
 * Converte "DD/MM/AAAA" para "AAAA-MM-DD" (usado em inputs date).
 */
export function parseDateDDMMYYYY(str) {
  if (!str) return "";
  const [dd, mm, yyyy] = String(str).split("/");
  if (!dd || !mm || !yyyy) return str;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
