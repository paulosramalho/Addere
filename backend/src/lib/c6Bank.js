// backend/src/lib/c6Bank.js
// Camada de abstração para integração com C6 Bank (boletos / cobrança).
// Modo controlado por C6_MODE=mock|sandbox|production (default: mock).
//
// ATENÇÃO: as APIs de cobrança / Open Finance do C6 Bank exigem contrato
// corporativo. Este módulo está em modo SCAFFOLD: apenas o fluxo mock
// está implementado. Os modos sandbox e production retornam erro claro
// até que as credenciais e endpoints sejam fornecidos.

import crypto from "crypto";

export const C6_MODE = process.env.C6_MODE || "mock";

// Endpoints reais (a confirmar com a documentação fornecida pelo C6 Bank)
const BASE_URLS = {
  sandbox:    process.env.C6_SANDBOX_URL    || "https://baas-api-sandbox.c6bank.com.br",
  production: process.env.C6_PRODUCTION_URL || "https://baas-api.c6bank.com.br",
};

function _checkEnvVars() {
  const missing = [];
  if (!process.env.C6_CLIENT_ID) missing.push("C6_CLIENT_ID");
  if (!process.env.C6_CLIENT_SECRET) missing.push("C6_CLIENT_SECRET");
  if (missing.length > 0) {
    throw new Error(`C6 Bank: variáveis de ambiente ausentes: ${missing.join(", ")}`);
  }
}

// ── Mock — funcional para dev/teste sem credencial ────────────────────────────

function _rand(len) {
  if (len <= 15) {
    const min = 10 ** (len - 1);
    const max = 10 ** len - 1;
    return String(crypto.randomInt(min, max));
  }
  return Array.from({ length: len }, () => crypto.randomInt(0, 10)).join("");
}

function _mockEmitir({ seuNumero, valorCentavos }) {
  const nossoNumero  = "0" + _rand(9);
  const valorStr     = String(valorCentavos).padStart(10, "0");
  const fator        = _rand(4);
  // Banco C6: código 336 (códigos FEBRABAN)
  const codigoBarras = `3369${fator}${valorStr}${_rand(25)}`;
  const linhaDigitavel =
    `33690.${_rand(5)} ${_rand(5)}.${_rand(6)} ${_rand(5)}.${_rand(6)} ${_rand(1)} ${fator}${valorStr}`;
  return {
    nossoNumero,
    seuNumero,
    codigoBarras,
    linhaDigitavel,
    pixCopiaECola: null,
    qrCodeImagem: null,
    pdfUrl: null,
    status: "EMITIDO",
    modo: "mock",
  };
}

// ── Real (sandbox / production) — STUB ────────────────────────────────────────

let _tokenCache = { token: null, expiresAt: 0 };

async function _getToken() {
  _checkEnvVars();
  const now = Date.now();
  if (_tokenCache.token && _tokenCache.expiresAt > now + 30 * 1000) {
    return _tokenCache.token;
  }
  // TODO: substituir pelo fluxo OAuth 2.0 client_credentials real do C6
  // quando a documentação e credenciais forem fornecidas.
  throw new Error(
    "C6 Bank em modo " + C6_MODE +
    ": fluxo de autenticação ainda não implementado. " +
    "Configure C6_MODE=mock para usar o stub local enquanto não há contrato."
  );
}

async function _realEmitir(_payload) {
  await _getToken(); // só dispara quando _getToken() existir de fato
  throw new Error("C6 Bank: emitirBoleto ainda não implementado para modo real.");
}

async function _realConsultar(_codigoSolicitacao) {
  await _getToken();
  throw new Error("C6 Bank: consultarBoleto ainda não implementado para modo real.");
}

async function _realCancelar(_codigoSolicitacao, _motivo) {
  await _getToken();
  throw new Error("C6 Bank: cancelarBoleto ainda não implementado para modo real.");
}

// ── API pública ──────────────────────────────────────────────────────────────

export async function emitirBoleto(payload) {
  if (C6_MODE === "mock") return _mockEmitir(payload);
  return _realEmitir(payload);
}

export async function consultarBoleto(codigoSolicitacao) {
  if (C6_MODE === "mock") return { codigoSolicitacao, situacao: "EMITIDO", modo: "mock" };
  return _realConsultar(codigoSolicitacao);
}

export async function cancelarBoleto(codigoSolicitacao, motivo = "ACERTOS", modo = null) {
  const m = modo || C6_MODE;
  if (m === "mock") return { codigoSolicitacao, cancelado: true, modo: "mock" };
  return _realCancelar(codigoSolicitacao, motivo);
}
