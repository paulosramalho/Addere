// backend/src/lib/interPix.js
// Camada de abstração para API de Pagamentos Pix do Banco Inter
// Controle via INTER_MODE=mock|sandbox|production (default: mock)
//
// IMPORTANTE: Requer escopos distintos dos boletos na integração Inter PJ:
//   pagamento-pix.write   → enviar Pix
//   pagamento-pix.read    → consultar status
//   extrato.read          → ver extrato (Pix recebidos)
//
// Env vars (usa PIX-específicas se presentes, senão cai nos vars do boleto):
//   INTER_PIX_CLIENT_ID      (fallback: INTER_CLIENT_ID)
//   INTER_PIX_CLIENT_SECRET  (fallback: INTER_CLIENT_SECRET)
//   INTER_PIX_CERT_B64       (fallback: INTER_CERT_B64)
//   INTER_PIX_KEY_B64        (fallback: INTER_KEY_B64)
//   INTER_CERT_PATH / INTER_KEY_PATH (alternativa arquivo para dev local)
//   INTER_CONTA_CORRENTE     (opcional — mesma var do boleto)

import crypto from "crypto";
import https  from "https";
import fs     from "fs";

// Reutiliza o mesmo INTER_MODE configurado para boletos
export const INTER_MODE = process.env.INTER_MODE || "mock";

const BASE_URLS = {
  sandbox:    "https://cdpj-sandbox.partners.uatinter.co",
  production: "https://cdpj.partners.bancointer.com.br",
};

// ── Token cache separado do boleto (escopos diferentes) ───────────────────────
let _pixTokenCache = { token: null, expiresAt: 0 };

// ── Helpers internos (espelham interBoleto.js) ────────────────────────────────

function _getClientCredentials() {
  return {
    clientId:     process.env.INTER_PIX_CLIENT_ID     || process.env.INTER_CLIENT_ID,
    clientSecret: process.env.INTER_PIX_CLIENT_SECRET || process.env.INTER_CLIENT_SECRET,
  };
}

function _getCertKey() {
  const certB64 = process.env.INTER_PIX_CERT_B64 || process.env.INTER_CERT_B64;
  const keyB64  = process.env.INTER_PIX_KEY_B64  || process.env.INTER_KEY_B64;

  if (certB64 && keyB64) {
    return {
      cert: Buffer.from(certB64, "base64"),
      key:  Buffer.from(keyB64,  "base64"),
    };
  }
  if (process.env.INTER_CERT_PATH && process.env.INTER_KEY_PATH) {
    return {
      cert: fs.readFileSync(process.env.INTER_CERT_PATH),
      key:  fs.readFileSync(process.env.INTER_KEY_PATH),
    };
  }
  throw new Error(
    "Inter Pix: configure INTER_PIX_CERT_B64 + INTER_PIX_KEY_B64 " +
    "(ou INTER_CERT_B64 + INTER_KEY_B64, ou INTER_CERT_PATH + INTER_KEY_PATH)"
  );
}

function _contaHeader() {
  return process.env.INTER_CONTA_CORRENTE
    ? { "x-conta-corrente": process.env.INTER_CONTA_CORRENTE }
    : {};
}

function _checkEnvVars() {
  const { clientId, clientSecret } = _getClientCredentials();
  const missing = [];
  if (!clientId)     missing.push("INTER_PIX_CLIENT_ID (ou INTER_CLIENT_ID)");
  if (!clientSecret) missing.push("INTER_PIX_CLIENT_SECRET (ou INTER_CLIENT_SECRET)");

  const certB64 = process.env.INTER_PIX_CERT_B64 || process.env.INTER_CERT_B64;
  const keyB64  = process.env.INTER_PIX_KEY_B64  || process.env.INTER_KEY_B64;
  const hasCertFile = process.env.INTER_CERT_PATH && process.env.INTER_KEY_PATH;
  if (!certB64 && !keyB64 && !hasCertFile) {
    missing.push("INTER_PIX_CERT_B64 + INTER_PIX_KEY_B64 (ou variantes)");
  }

  if (missing.length) {
    throw new Error(`Inter Pix: variáveis ausentes: ${missing.join(", ")}`);
  }
}

async function _getToken() {
  if (_pixTokenCache.token && Date.now() < _pixTokenCache.expiresAt - 60_000) {
    return _pixTokenCache.token;
  }

  _checkEnvVars();
  const { clientId, clientSecret } = _getClientCredentials();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const { cert, key } = _getCertKey();

  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    "client_credentials",
    scope:         "pagamento-pix.write pagamento-pix.read extrato.read",
  }).toString();

  const data = await _httpsRequest(`${base}/oauth/v2/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cert, key,
  }, body);

  _pixTokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _pixTokenCache.token;
}

// ── HTTPS helpers (idênticos ao interBoleto.js) ───────────────────────────────

function _httpsRequest(url, { method, headers, cert, key }, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method,
      headers:  {
        ...headers,
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
      cert, key,
      rejectUnauthorized: true,
    };

    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        console.log(`🔵 [Inter Pix] ${opts.method} ${opts.path} → HTTP ${res.statusCode}`);
        if (raw.trim()) console.log("🔵 [Inter Pix] resposta:", raw.slice(0, 800));

        if (!raw.trim()) {
          if (res.statusCode >= 400) {
            reject(new Error(`Inter Pix ${res.statusCode}: sem corpo`));
          } else {
            resolve({});
          }
          return;
        }
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`Inter Pix ${res.statusCode}: ${JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Inter Pix resposta inesperada (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Mock ──────────────────────────────────────────────────────────────────────

function _mockEnviar({ chavePix, valorCentavos, descricao, favorecidoNome }) {
  const endToEndId = `MOCK_E${Date.now()}${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;
  console.log(`🔵 [Inter Pix MOCK] enviarPix chave=${chavePix} valor=${valorCentavos} endToEndId=${endToEndId}`);
  return { endToEndId, status: "REALIZADO" };
}

function _mockConsultar(endToEndId) {
  return {
    endToEndId,
    status: "REALIZADO",
    dataPagamento: new Date().toISOString(),
    valor: null,
  };
}

function _mockListarRecebidos() {
  return { transacoes: [], totalElementos: 0 };
}

// ── Real ──────────────────────────────────────────────────────────────────────

async function _realEnviar({ chavePix, valorCentavos, descricao }) {
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  // Payload correto conforme documentação Inter:
  // destinatario.tipo = "CHAVE" + destinatario.chave = <chave pix>
  // O Inter resolve nome/CPF pelo DICT — não enviar esses campos para tipo CHAVE.
  const payload = {
    valor:        (valorCentavos / 100).toFixed(2),
    destinatario: { tipo: "CHAVE", chave: chavePix },
    ...(descricao ? { descricao } : {}),
  };

  const idempotencyKey = crypto.randomUUID();

  console.log("🔵 [Inter Pix] POST /banking/v2/pix — payload enviado:");
  console.log(JSON.stringify(payload, null, 2));

  return _httpsRequest(`${base}/banking/v2/pix`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      "x-id-idempotente": idempotencyKey,
      ..._contaHeader(),
    },
    cert, key,
  }, JSON.stringify(payload));
}

async function _realConsultar(codigoSolicitacao) {
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  return _httpsRequest(`${base}/banking/v2/pix/${codigoSolicitacao}`, {
    method:  "GET",
    headers: { Authorization: `Bearer ${token}`, ..._contaHeader() },
    cert, key,
  });
}

async function _realListarRecebidos({ dataInicio, dataFim, pagina = 0, tamanhoPagina = 50 }) {
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  const params = new URLSearchParams({
    dataInicio,
    dataFim,
    pagina:       String(pagina),
    tamanhoPagina: String(tamanhoPagina),
  });

  return _httpsRequest(`${base}/banking/v2/extrato?${params}`, {
    method:  "GET",
    headers: { Authorization: `Bearer ${token}`, ..._contaHeader() },
    cert, key,
  });
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Envia um Pix para uma chave.
 * @param {{ chavePix: string, valorCentavos: number, descricao?: string, favorecidoNome?: string }} dados
 * @returns {{ endToEndId: string, status: string }}
 * Nota: favorecidoNome/cpfCnpjFavorecido são usados apenas no mock e no registro DB —
 * o payload real para tipo CHAVE só precisa de chavePix, valorCentavos e descricao.
 */
export async function enviarPix({ chavePix, valorCentavos, descricao, favorecidoNome, cpfCnpjFavorecido }) {
  const dados = { chavePix, valorCentavos, descricao, favorecidoNome, cpfCnpjFavorecido };
  if (INTER_MODE === "mock") return _mockEnviar(dados);
  return _realEnviar({ chavePix, valorCentavos, descricao });
}

/**
 * Consulta o status de um Pix pelo codigoSolicitacao (retornado no POST).
 * @param {string} codigoSolicitacao
 */
export async function consultarPix(codigoSolicitacao) {
  if (INTER_MODE === "mock") return _mockConsultar(codigoSolicitacao);
  return _realConsultar(codigoSolicitacao);
}

/**
 * Lista transações do extrato Inter (inclui Pix recebidos).
 * @param {{ dataInicio: string, dataFim: string, pagina?: number, tamanhoPagina?: number }} opts
 * Datas no formato YYYY-MM-DD.
 */
export async function listarExtrato({ dataInicio, dataFim, pagina = 0, tamanhoPagina = 50 }) {
  if (INTER_MODE === "mock") return _mockListarRecebidos();
  return _realListarRecebidos({ dataInicio, dataFim, pagina, tamanhoPagina });
}

/**
 * Detecta o tipo de uma chave Pix.
 * @param {string} chave
 * @returns {"CPF"|"CNPJ"|"TELEFONE"|"EMAIL"|"EVP"|null}
 */
export function detectarTipoChave(chave) {
  if (!chave) return null;
  const s = String(chave).trim();
  const digits = s.replace(/\D/g, "");
  if (/^\d{11}$/.test(digits) && !/^5511/.test(digits)) return "CPF";
  if (/^\d{14}$/.test(digits)) return "CNPJ";
  if (/^(\+55)?\d{10,11}$/.test(digits) || /^\+55\d{10,11}$/.test(s)) return "TELEFONE";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "EMAIL";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "EVP";
  return null;
}
