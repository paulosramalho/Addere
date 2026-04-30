// lib/scraperTJPA.js — Scraper do portal TJPA (Consulta Unificada) via Playwright
import { chromium } from "playwright";

const CONSULTA_BASE = "https://consultas.tjpa.jus.br/consultaunificada/consulta";
const PRINCIPAL_URL = `${CONSULTA_BASE}/principal`;

// Cooldown em memória
const _lastSync = new Map();
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function shouldSyncPortalTJPA(processoId) {
  const last = _lastSync.get(processoId);
  if (!last) return true;
  return Date.now() - last > COOLDOWN_MS;
}
export function markSyncedTJPA(processoId) { _lastSync.set(processoId, Date.now()); }
export function resetCooldownTJPA(processoId) { _lastSync.delete(processoId); }

function _parseDataBR(str) {
  const m = String(str).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00.000Z`);
}

// Determina a instância pelo número CNJ (último segmento = foro/comarca)
// Retorna "1G", "2G" ou "1G" como default
function _instancia(numeroProcesso) {
  // Heurística simples: processos 2G costumam ter foro >=9000 no TJPA
  // Por ora, sempre tenta 1G primeiro
  return "1G";
}

/**
 * Busca movimentações do processo no portal TJPA Consulta Unificada.
 * Retorna array de { dataAndamento: Date, descricao: string, conteudo: string|null }
 */
export async function scraperTJPA(numeroProcesso) {
  console.log(`[scraperTJPA] Iniciando scrape de "${numeroProcesso}"`);

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      timeout: 60000,
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    // ── 1. Abrir portal principal ────────────────────────────────────────────
    console.log(`[scraperTJPA] Navegando para ${PRINCIPAL_URL}`);
    await page.goto(PRINCIPAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    console.log(`[scraperTJPA] Título: "${await page.title()}" | URL: ${page.url()}`);

    // ── 2. Carregar aba 1º Grau via AJAX ────────────────────────────────────
    // O portal carrega cada aba com carregaDiv() ao clicar — simular clique na aba
    try {
      await page.evaluate(() => {
        if (typeof carregaDiv === "function") {
          carregaDiv("#div1Grau", "/consultaunificada/consulta/aba1Grau.action");
        }
      });
    } catch { /* função pode não existir */ }

    // Aguarda o iframe/div carregar
    await page.waitForTimeout(4000);

    // Verificar se o campo de busca existe direto na página
    let inputCNJ = await page.$("#inputTextPorNumProcessoCNJ");

    // Se não está na página principal, pode estar em iframe
    if (!inputCNJ) {
      const frames = page.frames();
      console.log(`[scraperTJPA] Frames na página: ${frames.length}`);
      for (const frame of frames) {
        try {
          inputCNJ = await frame.$("#inputTextPorNumProcessoCNJ");
          if (inputCNJ) {
            console.log(`[scraperTJPA] Campo encontrado em frame: ${frame.url()}`);
            break;
          }
        } catch { /* ignora */ }
      }
    }

    // Se ainda não encontrou, tenta navegar direto para aba1Grau
    if (!inputCNJ) {
      console.log(`[scraperTJPA] Campo não encontrado na principal — navegando para aba1Grau diretamente`);
      await page.goto(`${CONSULTA_BASE}/aba1Grau.action`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      inputCNJ = await page.$("#inputTextPorNumProcessoCNJ");
    }

    if (!inputCNJ) {
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input")).map(i => ({
          id: i.id, name: i.name, type: i.type, placeholder: i.placeholder,
        }))
      );
      console.warn(`[scraperTJPA] Campo CNJ não encontrado. Inputs: ${JSON.stringify(inputs)}`);
      return [];
    }

    // ── 3. Selecionar rádio "Por número CNJ" e preencher ────────────────────
    try {
      const radio = await page.$("#radioPorNumProcessoCNJ");
      if (radio) await radio.click();
    } catch { /* ignora */ }

    await inputCNJ.click({ clickCount: 3 });
    await inputCNJ.fill(numeroProcesso);
    console.log(`[scraperTJPA] Número preenchido: "${numeroProcesso}"`);
    await page.waitForTimeout(500);

    // ── 4. Verificar CAPTCHA ─────────────────────────────────────────────────
    const captcha = await page.$("#textCaptcha");
    if (captcha && await captcha.isVisible()) {
      console.warn(`[scraperTJPA] CAPTCHA detectado — scraping bloqueado para busca por número`);
      // Tenta verificar se está visível mesmo (alguns sites ocultam o CAPTCHA para buscas por número)
      const captchaVisible = await page.evaluate(() => {
        const el = document.getElementById("textCaptcha");
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && el.offsetHeight > 0;
      });
      if (captchaVisible) {
        console.warn(`[scraperTJPA] CAPTCHA visível — não é possível continuar sem solução`);
        return [];
      }
    }

    // ── 5. Clicar em Pesquisar ───────────────────────────────────────────────
    const btnPesquisar = await page.$("#buttonPesquisar");
    if (btnPesquisar) {
      console.log(`[scraperTJPA] Clicando em Pesquisar`);
      await btnPesquisar.click();
    } else {
      console.log(`[scraperTJPA] Botão não encontrado — pressionando Enter`);
      await inputCNJ.press("Enter");
    }

    await page.waitForTimeout(5000);
    console.log(`[scraperTJPA] URL após busca: ${page.url()}`);

    // ── 6. Clicar no resultado ───────────────────────────────────────────────
    const linkSelectors = [
      "a[href*='processo']",
      "td a:first-of-type",
      "tbody tr:first-child a",
      "a[onclick*='processo']",
      ".linkProcesso",
    ];

    let clicou = false;
    for (const sel of linkSelectors) {
      const link = await page.$(sel);
      if (link) {
        const txt = (await link.textContent())?.trim();
        console.log(`[scraperTJPA] Clicando no resultado: "${txt}" (${sel})`);
        await link.click();
        clicou = true;
        break;
      }
    }

    if (!clicou) {
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 800));
      console.warn(`[scraperTJPA] Nenhum resultado clicável. Conteúdo:\n${pageText}`);
      return [];
    }

    await page.waitForTimeout(5000);
    console.log(`[scraperTJPA] URL detalhe: ${page.url()}`);

    // ── 7. Aba/seção de movimentos ───────────────────────────────────────────
    const abaMovSelectors = [
      "a:has-text('Movimentos')",
      "a:has-text('Andamentos')",
      "a[href*='movimento']",
      "a[onclick*='movimento']",
      "#abaMovimentos",
      "li:has-text('Movimentos') a",
    ];
    for (const sel of abaMovSelectors) {
      try {
        const aba = await page.$(sel);
        if (aba) {
          console.log(`[scraperTJPA] Clicando aba movimentos: ${sel}`);
          await aba.click();
          await page.waitForTimeout(3000);
          break;
        }
      } catch { /* ignora */ }
    }

    // ── 8. Extrair movimentos ────────────────────────────────────────────────
    const movimentos = await page.evaluate(() => {
      const movs = [];

      // Tenta vários seletores de tabela
      const tableSelectors = [
        "table[id*='movimento']",
        "table[id*='andamento']",
        "table[id*='Movimento']",
        "#tabelaMovimentos",
        "#tabelaAndamentos",
        ".tabela-movimentos",
        "table.rich-table",
        "table",
      ];

      let table = null;
      for (const sel of tableSelectors) {
        const t = document.querySelector(sel);
        if (t && t.querySelectorAll("tr").length > 1) {
          table = t;
          break;
        }
      }

      if (!table) return movs;

      for (const row of table.querySelectorAll("tbody tr, tr")) {
        const cells = Array.from(row.querySelectorAll("td")).map(c => (c.innerText || "").trim());
        if (cells.length < 2) continue;

        for (let i = 0; i < cells.length; i++) {
          const dateMatch = cells[i].match(/(\d{2}\/\d{2}\/\d{4})/);
          if (dateMatch) {
            const descricao = (cells[i + 1] || cells[i + 2] || "").split("\n")[0].trim();
            const conteudo  = cells[i + 2] || null;
            if (descricao) movs.push({ data: dateMatch[1], descricao, conteudo: conteudo?.trim() || null });
            break;
          }
        }
      }

      return movs;
    });

    console.log(`[scraperTJPA] ${movimentos.length} movimentos extraídos`);

    if (movimentos.length === 0) {
      const pageSnippet = await page.evaluate(() => document.body.innerText.slice(0, 1000));
      console.warn(`[scraperTJPA] Nenhum movimento. Página:\n${pageSnippet}`);
    }

    return movimentos
      .map(m => ({
        dataAndamento: _parseDataBR(m.data),
        descricao: m.descricao,
        conteudo: m.conteudo || null,
      }))
      .filter(m => m.dataAndamento && m.descricao);

  } catch (e) {
    console.error(`[scraperTJPA] Erro fatal:`, e.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
