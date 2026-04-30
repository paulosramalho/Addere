// ============================================================
// lib/datajud.js — Integração com API pública do DataJud (CNJ)
// ============================================================

const DATAJUD_BASE = "https://api-publica.datajud.cnj.jus.br";
const DATAJUD_WIKI_URL = "https://datajud-wiki.cnj.jus.br/api-publica/acesso/";

// Chave em memória — mutável para auto-renovação
let _datajudKey = process.env.DATAJUD_API_KEY
  || "cDZHYzlZa0JadVREZDJCendFbGFscU9tbVZXeU9Pek9GY2pIUUVtUEd";

export const getDatajudKey = () => _datajudKey;
export const setDatajudKey = (k) => { _datajudKey = k; };

// Tribunais padrão; sobrescrever via DATAJUD_TRIBUNAIS=trt8,trf1,stj no .env
// NOTA: TJPA não indexa o campo "partes" na API pública do DataJud —
// busca por OAB retorna 0 resultados. Use os tribunais federais disponíveis.
export const DATAJUD_TRIBUNAIS_DEFAULT = (process.env.DATAJUD_TRIBUNAIS || "trt8,trf1,stj")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Tribunais que NÃO indexam partes/advogados no DataJud público
export const TRIBUNAIS_SEM_PARTES = new Set(["tjpa"]);

/**
 * Extrai número e UF de uma string OAB.
 * Suporta: "12345/PA", "12345 PA", "12345PA", "PA 12345", "PA/12345"
 */
export function _parseOAB(oab) {
  if (!oab) return null;
  // Remove separadores de milhar (ponto e vírgula) antes de parsear: "38.153/PA" → "38153/PA"
  const s = String(oab).trim().toUpperCase().replace(/\s+/g, "").replace(/[.,](?=\d)/g, "");
  let m = s.match(/^(\d+)\/?([A-Z]{2})$/);
  if (m) return { numero: m[1], uf: m[2] };
  m = s.match(/^([A-Z]{2})\/?(\d+)$/);
  if (m) return { numero: m[2], uf: m[1] };
  m = s.match(/^(\d+)$/);
  if (m) return { numero: m[1], uf: (process.env.DATAJUD_UF || "PA").toUpperCase() };
  return null;
}

/**
 * POST na API DataJud de um tribunal específico.
 */
export async function _datajudFetchPublic(tribunal, body) { return _datajudFetch(tribunal, body); }

async function _datajudFetch(tribunal, body) {
  const url = `${DATAJUD_BASE}/api_publica_${tribunal}/_search`;

  const _doFetch = (key) => fetch(url, {
    method: "POST",
    headers: { "Authorization": `APIKey ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  let res = await _doFetch(_datajudKey);

  // Chave expirada — tenta renovar automaticamente e retentar uma vez
  if (res.status === 401 || res.status === 403) {
    console.warn(`⚠️  DataJud ${tribunal}: ${res.status} — chave inválida, tentando renovar...`);
    const renovacao = await verificarChaveDatajud();
    if (renovacao.changed) {
      console.log(`✅ DataJud: chave renovada (${renovacao.newKey.slice(0, 8)}...) — retentando ${tribunal}`);
      res = await _doFetch(_datajudKey);
    }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DataJud ${tribunal}: HTTP ${res.status} — ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Busca processos por OAB em múltiplos tribunais em paralelo.
 */
export async function consultarProcessosPorOAB(oabRaw, tribunais = DATAJUD_TRIBUNAIS_DEFAULT) {
  const parsed = _parseOAB(oabRaw);
  if (!parsed) return [];

  const oabQuery = `${parsed.numero}${parsed.uf}`;
  console.log(`⚖️  DataJud query OAB: "${oabRaw}" → "${oabQuery}" em [${tribunais.join(",")}] chave=${_datajudKey.slice(0, 8)}...`);

  const SOURCE = ["numeroProcesso", "classe", "assuntos", "dataAjuizamento", "movimentos", "tribunal", "partes"];
  const SORT   = [{ dataAjuizamento: { order: "desc" } }];

  // Query duplo-nested (maioria dos tribunais)
  const bodyNested = {
    query: {
      nested: {
        path: "partes",
        query: {
          nested: {
            path: "partes.advogados",
            query: { match: { "partes.advogados.OabAdvogado": oabQuery } },
          },
        },
      },
    },
    size: 100, _source: SOURCE, sort: SORT,
  };

  // Fallback: alguns tribunais (ex: TJPA) indexam partes como object, não nested
  const bodyFlat = {
    query: { match: { "partes.advogados.OabAdvogado": oabQuery } },
    size: 100, _source: SOURCE, sort: SORT,
  };

  const resultados = await Promise.allSettled(
    tribunais.map(async t => {
      if (TRIBUNAIS_SEM_PARTES.has(t)) {
        console.log(`⚖️  DataJud [${t}]: não indexa partes/OAB — ignorado na busca por advogado`);
        return [];
      }
      let data;
      try {
        data = await _datajudFetch(t, bodyNested);
      } catch (e) {
        // 400 com "nested" = índice não usa nested mapping — tenta query plana
        if (e.message.includes("400") && e.message.includes("nested")) {
          console.log(`⚖️  DataJud [${t}]: nested não suportado, tentando query plana...`);
          data = await _datajudFetch(t, bodyFlat);
        } else {
          throw e;
        }
      }
      const total = data?.hits?.total?.value ?? data?.hits?.total ?? 0;
      const hits  = data?.hits?.hits || [];
      console.log(`⚖️  DataJud [${t}] OAB=${oabQuery}: total=${total} hits=${hits.length}`);
      return hits.map(hit => _mapProcesso(hit, t));
    })
  );

  return resultados
    .filter(r => {
      if (r.status === "rejected") console.warn("⚖️  DataJud tribunal falhou:", r.reason?.message);
      return r.status === "fulfilled";
    })
    .flatMap(r => r.value);
}

function _mapProcesso(hit, tribunal) {
  const s = hit._source || {};
  const movimentos = Array.isArray(s.movimentos) ? s.movimentos : [];
  const sorted = [...movimentos].sort((a, b) =>
    new Date(b.dataHora || 0) - new Date(a.dataHora || 0)
  );
  const ultimo = sorted[0];
  return {
    numeroProcesso: s.numeroProcesso || hit._id,
    tribunal: String(s.tribunal || tribunal).toLowerCase(),
    classe: s.classe?.nome || null,
    assunto: (s.assuntos || []).map(a => a.nome).filter(Boolean).join(", ") || null,
    dataAjuizamento: s.dataAjuizamento && !isNaN(new Date(s.dataAjuizamento)) ? new Date(s.dataAjuizamento) : null,
    ultimoAndamento: ultimo
      ? [ultimo.nome, ultimo.complementosNaoPadronizados].filter(Boolean).join(" — ")
      : null,
    ultimaDataAnd: ultimo?.dataHora ? new Date(ultimo.dataHora) : null,
    movimentos: sorted.map(m => ({
      dataHora: m.dataHora ? new Date(m.dataHora) : null,
      descricao: [m.nome, m.complementosNaoPadronizados].filter(Boolean).join(" — "),
    })),
    partes: Array.isArray(s.partes) ? s.partes : [],
  };
}

/**
 * A partir do array de partes do DataJud, identifica o cliente
 * (parte do polo oposto ao advogado do escritório).
 *
 * @param {Array}  partes       - array `partes` do _source DataJud
 * @param {string} oabAdvogado  - OAB do advogado (ex: "12345/PA")
 * @returns {{ nome: string, cpfCnpj: string|null } | null}
 */
export function _extrairClienteDePartes(partes, oabAdvogado) {
  if (!Array.isArray(partes) || !partes.length) return null;
  const parsed = _parseOAB(oabAdvogado);
  if (!parsed) return null;

  // Descobre o polo em que o advogado está presente
  let poloAdv = null;
  for (const parte of partes) {
    const advs = Array.isArray(parte.advogados) ? parte.advogados : [];
    const achou = advs.some(a =>
      String(a.OabAdvogado || "").replace(/\D/g, "").includes(parsed.numero)
    );
    if (achou) { poloAdv = String(parte.polo || "").toUpperCase(); break; }
  }
  if (!poloAdv) return null;

  // Polo oposto = cliente
  const opposite = poloAdv === "AT" ? "PA" : "AT";
  const clienteParte = partes.find(p => String(p.polo || "").toUpperCase() === opposite);
  if (!clienteParte?.nome) return null;

  return {
    nome: String(clienteParte.nome).trim(),
    cpfCnpj: clienteParte.documento?.numero || null,
  };
}

/**
 * Busca um processo específico pelo número CNJ em um tribunal.
 * Retorna { processo, movimentos } ou null se não encontrado.
 */
export async function consultarProcessoPorNumero(numeroProcesso, tribunal) {
  const numeroLimpo = String(numeroProcesso).replace(/[.\-]/g, "");
  const body = {
    query: {
      bool: {
        should: [
          { match: { "numeroProcesso": numeroProcesso } },
          { match: { "numeroProcesso": numeroLimpo } },
        ],
        minimum_should_match: 1,
      },
    },
    size: 1,
    _source: ["numeroProcesso", "classe", "assuntos", "dataAjuizamento", "movimentos", "tribunal", "partes"],
  };

  let data;
  try {
    data = await _datajudFetch(tribunal, body);
  } catch (e) {
    console.warn(`⚖️  DataJud [${tribunal}] busca por número ${numeroProcesso}: ${e.message}`);
    return null;
  }

  const hits = data?.hits?.hits || [];
  if (!hits.length) return null;

  return _mapProcesso(hits[0], tribunal);
}

// ============================================================
// MONITORAMENTO AUTOMÁTICO DA CHAVE
// ============================================================

/**
 * Testa se a chave atual está válida fazendo uma query mínima no TJPA.
 * Retorna true se OK, false se 401/403.
 */
export async function _testDatajudKey(key = _datajudKey) {
  try {
    const url = `${DATAJUD_BASE}/api_publica_tjpa/_search`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `APIKey ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { match_all: {} }, size: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    // 200 ou 400 (query ruim mas autenticado) = chave válida
    return res.status !== 401 && res.status !== 403;
  } catch (_) {
    return true; // erro de rede: não invalida a chave
  }
}

/**
 * Raspa a página do wiki do CNJ buscando a chave pública atual.
 * Procura strings de 40–60 chars alfanuméricos próximas a "APIKey".
 */
export async function _scrapeDatajudKey() {
  try {
    const res = await fetch(DATAJUD_WIKI_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Addere-Monitor/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Busca padrão: string alfanumérica longa próxima a "APIKey" ou "chave"
    const matches = html.match(/[A-Za-z0-9]{40,60}/g) || [];
    // Filtra prováveis chaves (base64url sem +/ para evitar UUIDs e hashes genéricos)
    const candidates = matches.filter(m =>
      m.length >= 44 && /^[A-Za-z0-9]+$/.test(m) && !/^[0-9]+$/.test(m)
    );
    return candidates[0] || null;
  } catch (_) {
    return null;
  }
}

/**
 * Atualiza a env var DATAJUD_API_KEY no Render via API.
 * DESABILITADO: o PUT do Render substitui TODAS as vars — risco de apagar
 * DATABASE_URL, JWT_SECRET, etc. que só existem no dashboard e não são
 * retornadas pelo GET da API. A chave é mantida apenas em memória.
 */
export async function _updateRenderEnvVar(_newKey) {
  return false;
}

/**
 * Rotina completa de verificação: testa chave, raspa nova se inválida,
 * atualiza memória e Render. Retorna { changed, newKey } ou { changed: false }.
 */
export async function verificarChaveDatajud() {
  const keyAtual = _datajudKey;
  const valida = await _testDatajudKey(keyAtual);
  if (valida) return { changed: false };

  console.warn("⚠️  DataJud: chave atual inválida — buscando nova chave no wiki...");
  const novaChave = await _scrapeDatajudKey();
  if (!novaChave || novaChave === keyAtual) {
    console.warn("⚠️  DataJud: não foi possível obter nova chave do wiki.");
    return { changed: false };
  }

  // Valida a nova chave antes de aplicar
  const novaValida = await _testDatajudKey(novaChave);
  if (!novaValida) {
    console.warn("⚠️  DataJud: nova chave raspada também inválida.");
    return { changed: false };
  }

  // Aplica em memória imediatamente
  setDatajudKey(novaChave);
  console.log(`✅ DataJud: chave atualizada em memória (${novaChave.slice(0, 8)}...)`);

  // Tenta persistir no Render
  const renderOk = await _updateRenderEnvVar(novaChave);
  if (renderOk) {
    console.log("✅ DataJud: chave atualizada no Render (DATAJUD_API_KEY).");
  } else {
    console.warn("⚠️  DataJud: chave NÃO atualizada no Render (RENDER_API_KEY/RENDER_SERVICE_ID não configurados ou erro).");
  }

  return { changed: true, newKey: novaChave, renderOk };
}
