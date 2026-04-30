// lib/scraperPJe.js — Captura de processos em segredo de justiça via PJe (Playwright)
// Uso exclusivamente manual: o advogado fornece credenciais em tempo real.
// Credenciais NÃO são salvas em nenhum momento.

import { chromium } from "playwright";
import { createRequire } from "module";
const { authenticator } = createRequire(import.meta.url)("otplib");

// ── Configuração dos tribunais ─────────────────────────────────────────────────

const PJE_CONFIG = {
  tjpa: {
    nome: "TJPA",
    instancias: {
      "1G": "https://pje.tjpa.jus.br/pje/",
      "2G": "https://pje2g.tjpa.jus.br/pje/",
    },
  },
  trf1: {
    nome: "TRF 1ª Região",
    instancias: {
      "1G": "https://pje1g.trf1.jus.br/pje/",
      "2G": "https://pje2g.trf1.jus.br/pje/",
    },
  },
  trt8: {
    nome: "TRT 8ª Região",
    instancias: {
      "1G": "https://pje.trt8.jus.br/pje/",
      "2G": "https://pje.trt8.jus.br/segundograu/",
    },
  },
  tjam: {
    nome: "TJAM",
    instancias: {
      "1G": "https://consultasaj.tjam.jus.br/pje/",
    },
  },
  tjsp: {
    nome: "TJSP",
    instancias: {
      "1G": "https://pje1g.tjsp.jus.br/pje/",
      "2G": "https://pje2g.tjsp.jus.br/pje/",
    },
  },
};

/** Lista de tribunais suportados para o frontend */
export const TRIBUNAIS_PJE = Object.entries(PJE_CONFIG).map(([key, cfg]) => ({
  key,
  nome: cfg.nome,
  instancias: Object.keys(cfg.instancias),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parseDataBR(str) {
  const m = String(str || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00.000Z`);
}

/** Tenta preencher um campo usando múltiplos seletores. Retorna true se conseguiu. */
async function _fill(page, sels, value, timeout = 4000) {
  for (const sel of sels) {
    try {
      await page.fill(sel, value, { timeout });
      return true;
    } catch { /* tenta próximo */ }
  }
  return false;
}

/** Tenta clicar em um elemento usando múltiplos seletores. Retorna true se conseguiu. */
async function _click(page, sels, timeout = 4000) {
  for (const sel of sels) {
    try {
      await page.click(sel, { timeout });
      return true;
    } catch { /* tenta próximo */ }
  }
  return false;
}

// ── Extração de andamentos (tenta múltiplos layouts do PJe) ──────────────────

async function _extrairAndamentos(page) {
  return page.evaluate(() => {
    const results = [];

    // Layout 1: cards de andamento (PJe 2.x)
    const cards = document.querySelectorAll(".card-andamento, .movimentacao-item, .timeline-item");
    cards.forEach(card => {
      const dataEl  = card.querySelector("[class*='data'], .data-andamento, .data-movimentacao");
      const descEl  = card.querySelector("[class*='descri'], .descricao, .complemento");
      const data    = (dataEl?.innerText || "").trim();
      const descricao = (descEl?.innerText || "").trim() || card.innerText.trim();
      if (data || descricao) results.push({ data, descricao });
    });

    if (results.length > 0) return results;

    // Layout 2: tabela linear (PJe 1.x e algumas instâncias)
    document.querySelectorAll("table.rich-table tr, table tr").forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return;
      const col0 = cells[0].innerText.trim();
      const col1 = cells[1].innerText.trim();
      if (/\d{2}\/\d{2}\/\d{4}/.test(col0) && col1.length > 5) {
        results.push({ data: col0, descricao: col1 });
      }
    });

    if (results.length > 0) return results;

    // Layout 3: lista de movimentos (#linear ou .listagem-linear)
    document.querySelectorAll("#linear li, .listagem-linear li, .movimento").forEach(li => {
      const text = li.innerText.trim();
      const match = text.match(/^(\d{2}\/\d{2}\/\d{4})\s+([\s\S]+)/);
      if (match) results.push({ data: match[1], descricao: match[2].trim() });
    });

    return results;
  });
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Captura andamentos de um processo em segredo de justiça via PJe.
 * Credenciais usadas apenas durante esta chamada — não são persistidas.
 *
 * @param {object} opts
 * @param {string} opts.tribunal       - "tjpa" | "trf1" | "trt8" | ...
 * @param {string} opts.instancia      - "1G" | "2G"
 * @param {string} opts.numeroProcesso - número CNJ completo
 * @param {string} opts.login          - CPF do advogado (sem pontos/traços)
 * @param {string} opts.senha          - senha do portal PJe
 * @param {string} [opts.token]        - código TOTP manual (ignorado se opts.seed fornecido)
 * @param {string} [opts.seed]         - SEED PJe (32 char base32) para geração automática de TOTP
 *
 * @returns {Promise<Array<{dataAndamento: Date, descricao: string}>>}
 */
export async function capturarSegredoPJe({ tribunal, instancia = "1G", numeroProcesso, login, senha, token, seed }) {
  // Se SEED disponível, gera TOTP automaticamente
  const totpCode = seed
    ? authenticator.generate(seed.replace(/\s+/g, "").toUpperCase())
    : (token || null);
  const cfg = PJE_CONFIG[tribunal];
  if (!cfg) throw new Error(`Tribunal não suportado para captura PJe: ${tribunal}`);

  const baseUrl = cfg.instancias[instancia];
  if (!baseUrl) throw new Error(`Instância ${instancia} não configurada para ${cfg.nome}`);

  console.log(`[PJe] ${cfg.nome} ${instancia} — capturando ${numeroProcesso}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--single-process",
      ],
      timeout: 60000,
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "pt-BR",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);

    // ── 1. Login ────────────────────────────────────────────────────────────
    const loginUrl = `${baseUrl}login.seam`;
    console.log(`[PJe] Navegando → ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const userFilled = await _fill(page, [
      "#username", "#j_username", "input[name='username']", "input[name='j_username']",
      "input[type='text']:visible",
    ], login);
    if (!userFilled) throw new Error("Campo de usuário não encontrado na página de login do PJe.");

    const passFilled = await _fill(page, [
      "#password", "#j_password", "input[name='password']", "input[name='j_password']",
      "input[type='password']:visible",
    ], senha);
    if (!passFilled) throw new Error("Campo de senha não encontrado na página de login do PJe.");

    const loginClicked = await _click(page, [
      "button[type='submit']", "input[type='submit']",
      "#btn-login", "button:has-text('Entrar')", "button:has-text('Login')",
      "a:has-text('Entrar')",
    ]);
    if (!loginClicked) throw new Error("Botão de login não encontrado.");

    await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
    await page.waitForTimeout(1500);

    // ── 2. Token 2FA (se solicitado) ─────────────────────────────────────────
    const tokenInput = await page.$("input[id*='token' i], input[id*='otp' i], input[placeholder*='token' i], input[placeholder*='código' i]").catch(() => null);
    if (tokenInput) {
      if (!totpCode) throw new Error("Este portal requer token 2FA. Informe o código do seu autenticador (6 dígitos) ou configure o SEED PJe no seu perfil.");
      await tokenInput.fill(totpCode);
      await _click(page, ["button[type='submit']", "#btn-confirmar", "button:has-text('Confirmar')", "button:has-text('Entrar')"]);
      await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
      await page.waitForTimeout(1500);
    }

    // ── 3. Verifica login ────────────────────────────────────────────────────
    const urlAtual = page.url();
    if (urlAtual.includes("login.seam") || urlAtual.includes("login.jsf")) {
      const errTxt = await page.$eval(
        ".rich-message-text, .alert-danger, #error-message, .ui-messages-error-summary, .errors",
        el => el.innerText.trim()
      ).catch(() => "");
      throw new Error(`Login falhou${errTxt ? ": " + errTxt : ". Verifique as credenciais."}`);
    }

    console.log(`[PJe] Login OK → ${urlAtual}`);

    // ── 4. Navega para o processo ────────────────────────────────────────────
    // Tenta URL direta com número do processo
    const numLimpo = numeroProcesso.replace(/[^0-9.\-]/g, "").trim();
    const searchCandidates = [
      `${baseUrl}paginacao.seam?paginaConsulta=1&processo.numero=${encodeURIComponent(numeroProcesso)}`,
      `${baseUrl}ConsultaProcessual/listView.seam?processo.numero=${encodeURIComponent(numeroProcesso)}`,
    ];

    let andamentos = [];

    for (const url of searchCandidates) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);

        // Tenta preencher campo de busca se ainda não está no detalhe
        const searchInput = await page.$(
          "input[id*='numero' i]:visible, input[placeholder*='número' i], input[placeholder*='processo' i]"
        ).catch(() => null);

        if (searchInput) {
          await searchInput.fill(numeroProcesso);
          await _click(page, ["button:has-text('Pesquisar')", "button:has-text('Buscar')", "button[type='submit']"]);
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
          await page.waitForTimeout(2000);
        }

        // Clica no processo se apareceu em lista
        const linkProcesso = await page.$(
          `a[href*='${numLimpo.slice(0, 12)}'], td:has-text('${numLimpo.slice(0, 12)}')`
        ).catch(() => null);
        if (linkProcesso) {
          await linkProcesso.click();
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
          await page.waitForTimeout(2000);
        }

        andamentos = await _extrairAndamentos(page);
        if (andamentos.length > 0) break;
      } catch (e) {
        console.warn(`[PJe] Tentativa ${url} falhou: ${e.message}`);
      }
    }

    console.log(`[PJe] ${andamentos.length} andamento(s) extraído(s) para ${numeroProcesso}`);

    return andamentos
      .map(a => ({
        dataAndamento: _parseDataBR(a.data) || new Date(),
        descricao: a.descricao.replace(/\s+/g, " ").trim().slice(0, 2000),
      }))
      .filter(a => a.descricao.length > 3);

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
