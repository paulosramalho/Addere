import prisma from "./prisma.js";

// ── Helpers matemáticos ───────────────────────────────────────────────────────

/** Divide totalCents em N parcelas ajustando centavos residuais */
export function splitCents(totalCents, n) {
  const base = Math.floor(totalCents / n);
  const resto = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

export function moneyToCents(value) {
  if (typeof value === "number") return Math.round(value * 100);
  if (typeof value === "string") {
    const clean = value.replace(/[^\d,.-]/g, "").replace(",", ".");
    return Math.round(parseFloat(clean) * 100);
  }
  return 0;
}

export function onlyDigits(v = "") {
  return String(v ?? "").replace(/\D/g, "");
}

export function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}

export function bpToPercent(bp) {
  return (bp / 100).toFixed(2);
}

export function percentToBp(percent) {
  return Math.round(parseFloat(percent) * 100);
}

export function formatDateBR(date) {
  if (!date) return "";
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function parseDateDDMMYYYY(s) {
  const raw = String(s || "").trim();
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0, 0));
  if (!Number.isFinite(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== yyyy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return dt;
}

export function addMonthsKeepDay(dateObj, monthsToAdd) {
  const d = new Date(dateObj);
  const day = d.getDate();
  d.setMonth(d.getMonth() + monthsToAdd);
  if (d.getDate() !== day) d.setDate(0);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Converte valor do formulário para decimal (suporta formato BR e centavos inteiros) */
export function convertValueToDecimal(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const only = value.trim();
    if (/^\d+$/.test(only)) return Number(only) / 100;
    let clean = only.replace(/[^\d,.-]/g, "");
    if (clean.includes(",") && clean.includes(".")) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else if (clean.includes(",")) {
      clean = clean.replace(",", ".");
    }
    return parseFloat(clean);
  }
  return 0;
}

// ── Geração de número de contrato ─────────────────────────────────────────────

/**
 * Gera número de contrato no formato AAAAMMDDSSS.
 * @param {Date} dataBase - data base (default: hoje)
 * @param {object} client - cliente Prisma (default: singleton, aceita tx)
 */
export async function gerarNumeroContrato(dataBase = new Date(), client = prisma) {
  const d = new Date(dataBase);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  const prefixo = `${ano}${mes}${dia}`;

  const ultimoContrato = await client.contratoPagamento.findFirst({
    where: { numeroContrato: { startsWith: prefixo } },
    orderBy: { numeroContrato: "desc" },
  });

  const sequencia = ultimoContrato ? parseInt(ultimoContrato.numeroContrato.slice(-3), 10) + 1 : 1;
  return `${prefixo}${String(sequencia).padStart(3, "0")}`;
}

/**
 * Gera número de contrato com prefixo (ex: "AV-AAAAMMDD###").
 */
export async function gerarNumeroContratoComPrefixo(dataBase, prefixoExtra = "") {
  const d = new Date(dataBase || new Date());
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  const inicio = `${prefixoExtra}${ano}${mes}${dia}`;

  const ultimoContrato = await prisma.contratoPagamento.findFirst({
    where: { numeroContrato: { startsWith: inicio } },
    orderBy: { numeroContrato: "desc" },
  });

  const sequencia = ultimoContrato ? parseInt(ultimoContrato.numeroContrato.slice(-3), 10) + 1 : 1;
  return `${inicio}${String(sequencia).padStart(3, "0")}`;
}
