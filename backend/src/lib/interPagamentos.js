// backend/src/lib/interPagamentos.js
// Camada de abstração para API de Pagamentos do Banco Inter (banking/v2/pagamento)
// Escopos: pagamento-boleto.write pagamento-boleto.read pagamento-darf.write
// Credenciais: INTER_PAG_CLIENT_ID / INTER_PAG_CLIENT_SECRET
//              INTER_PAG_CERT_B64  / INTER_PAG_KEY_B64
//              (fallback para INTER_CLIENT_ID etc. se variáveis PAG não definidas)

import crypto from "crypto";
import https  from "https";
import { INTER_MODE } from "./interBoleto.js";

const BASE_URLS = {
  sandbox:    "https://cdpj-sandbox.partners.uatinter.co",
  production: "https://cdpj.partners.bancointer.com.br",
};

// ── Token caches ─────────────────────────────────────────────────────────────

let _pagTokenCache  = { token: null, expiresAt: 0 };
let _darfTokenCache = { token: null, expiresAt: 0 };

function _clientId()     { return process.env.INTER_PAG_CLIENT_ID     || process.env.INTER_CLIENT_ID; }
function _clientSecret() { return process.env.INTER_PAG_CLIENT_SECRET || process.env.INTER_CLIENT_SECRET; }

function _getCertKey() {
  const certB64 = process.env.INTER_PAG_CERT_B64 || process.env.INTER_CERT_B64;
  const keyB64  = process.env.INTER_PAG_KEY_B64  || process.env.INTER_KEY_B64;
  if (certB64 && keyB64) {
    return {
      cert: Buffer.from(certB64, "base64"),
      key:  Buffer.from(keyB64,  "base64"),
    };
  }
  throw new Error(
    "Inter Pagamentos: configure INTER_PAG_CERT_B64 + INTER_PAG_KEY_B64 " +
    "(ou INTER_CERT_B64 + INTER_KEY_B64 como fallback)"
  );
}

function _contaHeader() {
  return process.env.INTER_CONTA_CORRENTE
    ? { "x-conta-corrente": process.env.INTER_CONTA_CORRENTE }
    : {};
}

function _checkEnvVars() {
  const id  = _clientId();
  const sec = _clientSecret();
  if (!id || !sec) {
    throw new Error(
      "Inter Pagamentos: configure INTER_PAG_CLIENT_ID + INTER_PAG_CLIENT_SECRET"
    );
  }
  _getCertKey(); // lança se certs faltarem
}

async function _getToken() {
  if (_pagTokenCache.token && Date.now() < _pagTokenCache.expiresAt - 60_000) {
    return _pagTokenCache.token;
  }

  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const { cert, key } = _getCertKey();

  const body = new URLSearchParams({
    client_id:     _clientId(),
    client_secret: _clientSecret(),
    grant_type:    "client_credentials",
    scope:         "pagamento-boleto.write pagamento-boleto.read",
  }).toString();

  const data = await _httpsRequest(`${base}/oauth/v2/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cert, key,
  }, body);

  _pagTokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _pagTokenCache.token;
}

// ── HTTPS com mTLS ────────────────────────────────────────────────────────────

function _httpsRequest(url, { method, headers, cert, key }, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
      cert,
      key,
      rejectUnauthorized: true,
    };

    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        if (!raw.trim()) {
          if (res.statusCode >= 400) reject(new Error(`Inter API ${res.statusCode}: sem corpo`));
          else resolve({});
          return;
        }
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`Inter API ${res.statusCode}: ${JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Inter API resposta inesperada (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Mock ──────────────────────────────────────────────────────────────────────

function _mockPagar(valorCentavos) {
  return {
    codigoTransacao: `MOCK-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
    status:          "AGENDADO",
    valorPagar:      valorCentavos / 100,
    mock:            true,
  };
}

// ── Funções exportadas ────────────────────────────────────────────────────────

/**
 * Paga um boleto/convênio/tributo por código de barras ou linha digitável.
 * @param {{ codBarraLinhaDigitavel: string, valorCentavos: number,
 *           dataPagamento?: string, dataVencimento: string, cpfCnpjBeneficiario?: string }} dados
 */
export async function pagarBoleto({ codBarraLinhaDigitavel, valorCentavos, dataPagamento, dataVencimento, cpfCnpjBeneficiario }) {
  if (INTER_MODE === "mock") return _mockPagar(valorCentavos);

  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  // valorPagar: string com 2 casas decimais (spec Inter)
  const valorPagar = (valorCentavos / 100).toFixed(2);

  // dataVencimento: obrigatório, deve ser o vencimento real do boleto
  // dataPagamento: opcional — omitir para pagamento imediato, enviar YYYY-MM-DD para agendamento
  const payload = {
    codBarraLinhaDigitavel,
    valorPagar,
    dataVencimento,
    ...(dataPagamento         ? { dataPagamento }         : {}),
    ...(cpfCnpjBeneficiario   ? { cpfCnpjBeneficiario }   : {}),
  };

  console.log(`📤 [InterPag] payload → dataPagamento=${dataPagamento || "(hoje)"} dataVencimento=${payload.dataVencimento} valorPagar=${valorPagar}`);

  return _httpsRequest(`${base}/banking/v2/pagamento`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      ..._contaHeader(),
    },
    cert, key,
  }, JSON.stringify(payload));
}

/**
 * Lista pagamentos registrados na Inter.
 * @param {{ filtrarDataPor?: string, dataInicio: string, dataFim: string }} params
 */
export async function listarPagamentosInter({ filtrarDataPor = "INCLUSAO", dataInicio, dataFim }) {
  if (INTER_MODE === "mock") return { pagamentos: [] };

  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  const qs = new URLSearchParams({ filtrarDataPor, dataInicio, dataFim }).toString();

  return _httpsRequest(`${base}/banking/v2/pagamento?${qs}`, {
    method:  "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ..._contaHeader(),
    },
    cert, key,
  });
}

// ── DARF token (escopo pagamento-darf.write — separado para não contaminar boleto) ──

async function _getDarfToken() {
  if (_darfTokenCache.token && Date.now() < _darfTokenCache.expiresAt - 60_000) {
    return _darfTokenCache.token;
  }

  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const { cert, key } = _getCertKey();

  const body = new URLSearchParams({
    client_id:     _clientId(),
    client_secret: _clientSecret(),
    grant_type:    "client_credentials",
    scope:         "pagamento-darf.write",
  }).toString();

  const data = await _httpsRequest(`${base}/oauth/v2/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cert, key,
  }, body);

  _darfTokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _darfTokenCache.token;
}

/**
 * Paga DARF sem código de barras (pagamento imediato).
 * @param {{ cnpjCpf, codigoReceita, dataVencimento, periodoApuracao,
 *           descricao, nomeEmpresa, referencia,
 *           valorPrincipalCents, valorJurosCents?, valorMultaCents?,
 *           telefoneEmpresa? }} dados
 */
export async function pagarDarf({
  cnpjCpf, codigoReceita, dataVencimento, periodoApuracao,
  descricao, nomeEmpresa, referencia,
  valorPrincipalCents, valorJurosCents = 0, valorMultaCents = 0,
  telefoneEmpresa,
}) {
  if (INTER_MODE === "mock") {
    return {
      codigoTransacao: `MOCK-DARF-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
      status: "PROCESSANDO",
      mock: true,
    };
  }

  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getDarfToken();
  const { cert, key } = _getCertKey();

  const payload = {
    cnpjCpf:        cnpjCpf.replace(/\D/g, ""),
    codigoReceita,
    dataVencimento,
    periodoApuracao,
    descricao,
    nomeEmpresa,
    referencia,
    valorPrincipal: Number((valorPrincipalCents / 100).toFixed(2)),
    valorJuros:     Number((valorJurosCents     / 100).toFixed(2)),
    valorMulta:     Number((valorMultaCents     / 100).toFixed(2)),
    ...(telefoneEmpresa ? { telefoneEmpresa } : {}),
  };

  console.log(`📤 [InterDarf] payload → cnpjCpf=${payload.cnpjCpf} receita=${codigoReceita} principal=${payload.valorPrincipal}`);

  return _httpsRequest(`${base}/banking/v2/pagamento/darf`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      ..._contaHeader(),
    },
    cert, key,
  }, JSON.stringify(payload));
}

/**
 * Cancela um agendamento de pagamento.
 * @param {string} codigoTransacao  Código retornado no POST de pagamento
 */
export async function cancelarPagamentoInter(codigoTransacao) {
  if (INTER_MODE === "mock") return {};

  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  return _httpsRequest(`${base}/banking/v2/pagamento/${codigoTransacao}`, {
    method:  "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      ..._contaHeader(),
    },
    cert, key,
  });
}
