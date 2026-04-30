// backend/src/lib/interBoleto.js
// Camada de abstração para API de Cobranças do Banco Inter
// Controle via INTER_MODE=mock|sandbox|production (default: mock)

import crypto from "crypto";
import https  from "https";
import fs     from "fs";

export const INTER_MODE = process.env.INTER_MODE || "mock";

const BASE_URLS = {
  sandbox:    "https://cdpj-sandbox.partners.uatinter.co",
  production: "https://cdpj.partners.bancointer.com.br",
};

// ── Mock ──────────────────────────────────────────────────────────────────────

function _rand(len) {
  // len dígitos decimais aleatórios
  // crypto.randomInt exige safe integer (≤ 2^53-1 ≈ 9e15), então len > 15 divide em chunks
  if (len <= 15) {
    const min = 10 ** (len - 1);
    const max = 10 ** len - 1;
    return String(crypto.randomInt(min, max));
  }
  return Array.from({ length: len }, () => crypto.randomInt(0, 10)).join("");
}

function _randHex(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len).toUpperCase();
}

function _mockEmitir({ seuNumero, valorCentavos, dataVencimento }) {
  const nossoNumero  = "0" + _rand(9);                      // 10 dígitos
  const valorStr     = String(valorCentavos).padStart(10, "0");
  const fator        = _rand(4);                            // fator de vencimento

  // Código de barras: banco 077, moeda 9, 44 dígitos
  const campoLivre   = _rand(25);
  const codigoBarras = `0779${fator}${valorStr}${campoLivre}`;

  // Linha digitável formatada (3 campos + DV + fator+valor)
  const c1 = `07790.${_rand(5)}`;
  const c2 = `${_rand(5)}.${_rand(6)}`;
  const c3 = `${_rand(5)}.${_rand(6)}`;
  const dv = _rand(1);
  const linhaDigitavel = `${c1} ${c2} ${c3} ${dv} ${fator}${valorStr}`;

  // Pix Copia e Cola (EMV mock — não escaneável, mas realista visualmente)
  const txid   = _randHex(25).toLowerCase();
  const valor  = (valorCentavos / 100).toFixed(2);
  const pixKey = `pix.inter.co/qr/v2/${txid}`;
  const pixCopiaECola =
    `00020126${String(14 + pixKey.length + 4).padStart(2, "0")}` +
    `0014BR.GOV.BCB.PIX01${String(pixKey.length).padStart(2, "0")}${pixKey}` +
    `520400005303986` +
    `54${String(valor.length).padStart(2, "0")}${valor}` +
    `5802BR5910Addere Advog6009Belem PA` +
    `62290525${txid}` +
    `6304${_randHex(4)}`;

  return {
    nossoNumero,
    seuNumero,
    codigoBarras,
    linhaDigitavel,
    pixCopiaECola,
    qrCodeImagem: null,
    pdfUrl:       null,
    status:       "EMITIDO",
    modo:         "mock",
  };
}

// ── Real (sandbox / production) ───────────────────────────────────────────────

let _tokenCache = { token: null, expiresAt: 0 };

/**
 * Retorna { cert, key } como Buffer.
 * Prioridade: INTER_CERT_B64 / INTER_KEY_B64 (base64, ideal para Render)
 *             INTER_CERT_PATH / INTER_KEY_PATH (caminho de arquivo, para local/dev)
 */
function _getCertKey() {
  if (process.env.INTER_CERT_B64 && process.env.INTER_KEY_B64) {
    return {
      cert: Buffer.from(process.env.INTER_CERT_B64, "base64"),
      key:  Buffer.from(process.env.INTER_KEY_B64,  "base64"),
    };
  }
  if (process.env.INTER_CERT_PATH && process.env.INTER_KEY_PATH) {
    return {
      cert: fs.readFileSync(process.env.INTER_CERT_PATH),
      key:  fs.readFileSync(process.env.INTER_KEY_PATH),
    };
  }
  throw new Error(
    "Inter API: configure INTER_CERT_B64 + INTER_KEY_B64 (Render) " +
    "ou INTER_CERT_PATH + INTER_KEY_PATH (local)"
  );
}

/** Cabeçalho opcional de conta corrente (quando há múltiplas contas no mesmo CNPJ) */
function _contaHeader() {
  return process.env.INTER_CONTA_CORRENTE
    ? { "x-conta-corrente": process.env.INTER_CONTA_CORRENTE }
    : {};
}

function _checkEnvVars() {
  const missing = ["INTER_CLIENT_ID", "INTER_CLIENT_SECRET"].filter((v) => !process.env[v]);
  const hasCertB64   = process.env.INTER_CERT_B64   && process.env.INTER_KEY_B64;
  const hasCertPath  = process.env.INTER_CERT_PATH  && process.env.INTER_KEY_PATH;
  if (!hasCertB64 && !hasCertPath) {
    missing.push("INTER_CERT_B64 + INTER_KEY_B64 (ou INTER_CERT_PATH + INTER_KEY_PATH)");
  }
  if (missing.length) {
    throw new Error(`Inter API: variáveis ausentes: ${missing.join(", ")}`);
  }
}

async function _getToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const { cert, key } = _getCertKey();

  const body = new URLSearchParams({
    client_id:     process.env.INTER_CLIENT_ID,
    client_secret: process.env.INTER_CLIENT_SECRET,
    grant_type:    "client_credentials",
    scope:         "boleto-cobranca.write boleto-cobranca.read",
  }).toString();

  const data = await _httpsRequest(`${base}/oauth/v2/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cert, key,
  }, body);

  _tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _tokenCache.token;
}

async function _realEmitir({ seuNumero, valorCentavos, dataVencimento, pagador, multaPerc, moraPercMes, validadeDias }) {
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  const cpfCnpj = (pagador.cpfCnpj || "").replace(/\D/g, "");

  // Telefone: DDD (2 dígitos) + número (até 9 dígitos)
  const telDigits = (pagador.telefone || "").replace(/\D/g, "");
  const ddd       = telDigits.length >= 11 ? telDigits.slice(0, 2) : (telDigits.length >= 10 ? telDigits.slice(0, 2) : "");
  const telNum    = telDigits.length >= 10 ? telDigits.slice(2) : telDigits;

  const payload = {
    seuNumero,
    dataVencimento,
    valorNominal:  valorCentavos / 100,
    numDiasAgenda: validadeDias ?? 60,
    multa: {
      codigo: "PERCENTUAL",
      taxa:   Number(multaPerc  ?? 2),
    },
    mora: {
      codigo: "TAXAMENSAL",
      taxa:   Number(moraPercMes ?? 1),
    },
    pagador: {
      cpfCnpj:    cpfCnpj,
      tipoPessoa: cpfCnpj.length === 11 ? "FISICA" : "JURIDICA",
      nome:       pagador.nome,
      email:      pagador.email   || "",
      ddd:        ddd             || "91",
      telefone:   telNum          || "",
      cep:        (pagador.cep || "66000000").replace(/\D/g, ""),
      endereco:   pagador.endereco || "NAO INFORMADO",
      numero:     pagador.numero   || "S/N",
      bairro:     pagador.bairro   || "NAO INFORMADO",
      cidade:     pagador.cidade   || "BELEM",
      uf:         pagador.uf       || "PA",
    },
  };

  const postResp = await _httpsRequest(`${base}/cobranca/v3/cobrancas`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      ..._contaHeader(),
    },
    cert, key,
  }, JSON.stringify(payload));

  // Inter v3 retorna apenas { codigoSolicitacao } — nossoNumero é atribuído async.
  const codigoSolicitacao = postResp.codigoSolicitacao;
  if (!codigoSolicitacao) throw new Error(`Inter: resposta inesperada na emissão: ${JSON.stringify(postResp)}`);

  console.log(`🏦 [Inter] codigoSolicitacao=${codigoSolicitacao}`);

  // Retorna imediatamente com codigoSolicitacao — nossoNumero será preenchido em background
  return {
    nossoNumero:        null,
    codigoSolicitacao,
    seuNumero,
    codigoBarras:       null,
    linhaDigitavel:     null,
    pixCopiaECola:      null,
    qrCodeImagem:       null,
    pdfUrl:             null,
    status:             "EMITIDO",
    modo:               INTER_MODE,
    _pendente:          true, // sinaliza que nossoNumero precisa ser buscado em background
    _base:              base,
    _dataVencimento:    dataVencimento,
  };
}

/**
 * Após o POST assíncrono do Inter v3, busca o boleto na listagem do dia
 * filtrando por seuNumero. Tenta até 6x com 2s de intervalo (máx 12s).
 */
async function _buscarBoletoEmitido(base, token, cert, key, seuNumero, codigoSolicitacao, dataVencimento) {
  const hoje    = new Date().toISOString().slice(0, 10);
  const vencStr = (dataVencimento || hoje).slice(0, 10);
  const dInicial = hoje <= vencStr ? hoje : vencStr;
  const dFinal   = hoje >= vencStr ? hoje : vencStr;

  for (let attempt = 1; attempt <= 8; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));

    try {
      const params = new URLSearchParams({
        filtrarDataBy: "EMISSAO",
        dataInicial:   dInicial,
        dataFinal:     dFinal,
        size:          "100",
      });

      const resp = await _httpsRequest(
        `${base}/cobranca/v3/cobrancas?${params}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}`, ..._contaHeader() }, cert, key }
      );

      const lista = resp.cobrancas || resp.content || (Array.isArray(resp) ? resp : []);

      // Estrutura: { cobranca: { seuNumero, codigoSolicitacao }, boleto: { nossoNumero, ... }, pix: {} }
      const found = lista.find(
        (b) => b.cobranca?.seuNumero === seuNumero ||
               b.cobranca?.codigoSolicitacao === codigoSolicitacao
      );

      if (found?.boleto?.nossoNumero) return found;

      console.log(`⏳ [Inter] tentativa ${attempt}/8 — ${lista.length} item(s), ${seuNumero} ainda não disponível`);
    } catch (e) {
      console.warn(`⚠️ [Inter] tentativa ${attempt}/8 falhou: ${e.message}`);
    }
  }

  throw new Error(`Inter: boleto ${seuNumero} não ficou disponível após 16s`);
}

async function _realConsultar(nossoNumero) {
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  return _httpsRequest(`${base}/cobranca/v3/cobrancas/${nossoNumero}`, {
    method:  "GET",
    headers: { Authorization: `Bearer ${token}`, ..._contaHeader() },
    cert, key,
  });
}

async function _realCancelar(codigoSolicitacao, motivo = "ACERTOS") {
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  return _httpsRequest(`${base}/cobranca/v3/cobrancas/${codigoSolicitacao}/cancelar`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      ..._contaHeader(),
    },
    cert, key,
  }, JSON.stringify({ motivoCancelamento: motivo }));
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
      headers:  {
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
        // 204 No Content (e.g. PATCH alterar, POST cancelar) — sem body, é sucesso
        if (!raw.trim()) {
          if (res.statusCode >= 400) {
            reject(new Error(`Inter API ${res.statusCode}: sem corpo`));
          } else {
            resolve({});
          }
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

// ── HTTPS binário (PDF) com mTLS ──────────────────────────────────────────────

function _httpsRequestBinary(url, { method, headers, cert, key }) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method,
      headers,
      cert,
      key,
      rejectUnauthorized: true,
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          reject(new Error(`Inter API ${res.statusCode}: ${buf.toString("utf8").slice(0, 200)}`));
        } else {
          resolve(buf);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Emite um boleto.
 * @param {{ seuNumero: string, valorCentavos: number, dataVencimento: string,
 *           pagador: { cpfCnpj, nome, email?, telefone?, cep? } }} dados
 */
export async function emitirBoleto(dados) {
  if (INTER_MODE === "mock") return _mockEmitir(dados);
  return _realEmitir(dados); // passa multaPerc/moraPercMes via spread
}

/**
 * Consulta status de um boleto no Inter.
 * @param {string} codigoSolicitacao  UUID retornado na emissão (não o nossoNumero)
 */
export async function consultarBoleto(codigoSolicitacao) {
  if (INTER_MODE === "mock") return { codigoSolicitacao, situacao: "EMITIDO" };
  return _realConsultar(codigoSolicitacao);
}

/**
 * Cancela um boleto no Inter.
 * @param {string} nossoNumero
 * @param {string} [motivo] ACERTOS | PAGADOR_SOLICITOU | OUTROS
 * @param {string} [boletoModo] modo gravado no boleto ("mock"|"production"|"sandbox")
 *   Quando fornecido, prevalece sobre INTER_MODE — garante que boletos emitidos
 *   em produção sejam sempre cancelados na API real, independente do env atual.
 */
export async function cancelarBoleto(codigoSolicitacao, motivo = "ACERTOS", boletoModo = null) {
  const modo = boletoModo || INTER_MODE;
  if (modo === "mock") return { codigoSolicitacao, cancelado: true };
  return _realCancelar(codigoSolicitacao, motivo);
}

/**
 * Altera dados de um boleto EMITIDO no Inter.
 * @param {string} codigoSolicitacao  UUID retornado na emissão
 * @param {{ dataVencimento?: string, multaPerc?: number, moraPercMes?: number }} alteracoes
 * @param {string} [boletoModo] modo gravado no boleto — ver cancelarBoleto
 */
export async function alterarBoleto(codigoSolicitacao, alteracoes = {}, boletoModo = null) {
  const modo = boletoModo || INTER_MODE;
  if (modo === "mock") return { codigoSolicitacao, alterado: true };
  return _realAlterar(codigoSolicitacao, alteracoes);
}

/**
 * Resolve nossoNumero de um boleto pendente (chamado em background após emissão).
 * Atualiza o registro no banco de dados quando encontrado.
 * @param {number} boletoId  ID do BoletInter no banco
 * @param {string} codigoSolicitacao
 * @param {string} seuNumero
 * @param {string} dataVencimento  YYYY-MM-DD
 */
export async function resolverNossoNumero(boletoId, codigoSolicitacao, seuNumero, dataVencimento) {
  if (INTER_MODE === "mock") return;
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  // GET direto por codigoSolicitacao — mais rápido e confiável que listagem
  for (let attempt = 1; attempt <= 8; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const item = await _httpsRequest(
        `${base}/cobranca/v3/cobrancas/${codigoSolicitacao}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}`, ..._contaHeader() }, cert, key }
      );

      // Estrutura pode ser aninhada { cobranca, boleto, pix } ou plana
      const nossoNumero = item.boleto?.nossoNumero || item.nossoNumero;
      if (!nossoNumero) {
        console.log(`⏳ [Inter] tentativa ${attempt}/8 — nossoNumero ainda não disponível`);
        continue;
      }

      const { default: prisma } = await import("./prisma.js");
      await prisma.boletInter.update({
        where: { id: boletoId },
        data: {
          nossoNumero,
          codigoSolicitacao,
          codigoBarras:   item.boleto?.codigoBarras   || item.codigoBarras   || null,
          linhaDigitavel: item.boleto?.linhaDigitavel || item.linhaDigitavel || null,
          pixCopiaECola:  item.pix?.pixCopiaECola     || item.pixCopiaECola  || null,
          qrCodeImagem:   item.pix?.imagemQrCode      || null,
          updatedAt:      new Date(),
        },
      });
      console.log(`✅ [Inter] nossoNumero=${nossoNumero} gravado no boleto #${boletoId}`);
      return nossoNumero;
    } catch (e) {
      console.warn(`⚠️ [Inter] tentativa ${attempt}/8 GET falhou: ${e.message}`);
    }
  }

  console.error(`❌ [Inter] resolverNossoNumero boleto #${boletoId}: não disponível após 16s`);
  return null;
}

/**
 * Baixa o PDF oficial do boleto direto da API Inter (produção/sandbox).
 * Retorna um Buffer com o PDF pronto para uso.
 * Em modo mock retorna null (não há PDF real).
 */
export async function baixarPdfInter(codigoSolicitacao) {
  if (INTER_MODE === "mock") return null;
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  const buf = await _httpsRequestBinary(`${base}/cobranca/v3/cobrancas/${codigoSolicitacao}/pdf`, {
    method:  "GET",
    headers: { Authorization: `Bearer ${token}`, ..._contaHeader() },
    cert, key,
  });

  // Inter pode retornar JSON { "pdf": "<base64>" } em vez de binário direto
  if (buf[0] === 0x7B) { // '{'
    try {
      const json = JSON.parse(buf.toString("utf8"));
      const b64  = json.pdf || json.base64 || json.content;
      if (b64) return Buffer.from(b64, "base64");
    } catch { /* não era JSON — usa buf original */ }
  }

  return buf; // PDF binário direto (começa com %PDF)
}

async function _realAlterar(codigoSolicitacao, { dataVencimento, multaPerc, moraPercMes }) {
  _checkEnvVars();
  const base          = BASE_URLS[INTER_MODE] || BASE_URLS.production;
  const token         = await _getToken();
  const { cert, key } = _getCertKey();

  const payload = {};
  if (dataVencimento) payload.dataVencimento = dataVencimento;

  if (dataVencimento && (multaPerc != null || moraPercMes != null)) {
    const venc1d = new Date(dataVencimento + "T00:00:00Z");
    venc1d.setUTCDate(venc1d.getUTCDate() + 1);
    const venc1dStr = venc1d.toISOString().slice(0, 10);
    if (multaPerc   != null) payload.multa = { tipo: "PERCENTUAL", valor: Number(multaPerc),   data: venc1dStr };
    if (moraPercMes != null) payload.mora  = { tipo: "TAXA_MENSAL", valor: Number(moraPercMes), data: venc1dStr };
  }

  return _httpsRequest(`${base}/cobranca/v3/cobrancas/${codigoSolicitacao}`, {
    method:  "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      ..._contaHeader(),
    },
    cert, key,
  }, JSON.stringify(payload));
}
