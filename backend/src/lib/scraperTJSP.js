// lib/scraperTJSP.js — Scraper do portal ESAJ TJSP via Playwright
import { chromium } from "playwright";

const ESAJ_BASE = "https://esaj.tjsp.jus.br";

// Cooldown em memória: evita rodar em todo acesso (reseta no restart)
const _lastSync = new Map(); // processoId → timestamp
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 horas

export function shouldSyncPortal(processoId) {
  const last = _lastSync.get(processoId);
  if (!last) return true;
  return Date.now() - last > COOLDOWN_MS;
}

export function markSynced(processoId) {
  _lastSync.set(processoId, Date.now());
}

export function resetCooldown(processoId) {
  _lastSync.delete(processoId);
}

function _extractForo(numeroProcesso) {
  // "1018255-13.2022.8.26.0068" → "0068" (com zeros, como o ESAJ espera)
  const m = String(numeroProcesso).match(/\.(\d{4})$/);
  return m ? m[1] : null;
}

function _extractNumDigitoAno(numeroProcesso) {
  // "1018255-13.2022.8.26.0068" → { ndan: "1018255-13.2022", foro: "0068" }
  const m = String(numeroProcesso).match(/^(\d+-\d+\.\d+)\.\d+\.\d+\.(\d{4})$/);
  if (!m) return null;
  return { ndan: m[1], foro: m[2] };
}

function _parseDataBR(dataBR) {
  // "15/09/2025" → Date
  const m = String(dataBR).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00.000Z`);
}

/**
 * Busca movimentações do processo diretamente no portal ESAJ TJSP.
 * Retorna array de { dataAndamento: Date, descricao: string, conteudo: string|null }
 */
export async function scraperTJSP(numeroProcesso) {
  const foroRaw = _extractForo(numeroProcesso);
  if (!foroRaw) {
    console.warn(`[scraperTJSP] Foro não extraído de "${numeroProcesso}"`);
    return [];
  }

  // URL principal: search.do (mesmo formato que o navegador usa)
  const parsed = _extractNumDigitoAno(numeroProcesso);
  const urlSearch = parsed
    ? `${ESAJ_BASE}/cpopg/search.do?cbPesquisa=NUMPROC&numeroDigitoAnoUnificado=${encodeURIComponent(parsed.ndan)}&foroNumeroUnificado=${parsed.foro}`
    : null;

  // URL alternativa: show.do direto
  const foroNum = parseInt(foroRaw, 10).toString(); // remove zeros à esquerda
  const urlShow = `${ESAJ_BASE}/cpopg/show.do?processo.numero=${encodeURIComponent(numeroProcesso)}&processo.foro=${foroNum}`;

  const urlsToTry = [urlSearch, urlShow].filter(Boolean);
  console.log(`[scraperTJSP] Iniciando scrape de "${numeroProcesso}"`);

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      timeout: 60000,
    });

    for (const url of urlsToTry) {
      console.log(`[scraperTJSP] Tentando URL: ${url}`);
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        "Accept-Language": "pt-BR,pt;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

        // Aguarda um pouco para JS carregar
        await page.waitForTimeout(3000);

        const title = await page.title();
        console.log(`[scraperTJSP] Título da página: "${title}"`);

        // Tentar clicar em "Todas as Movimentações" se disponível
        try {
          const linkTodas = await page.$(
            "a#linkTodasMovimentacoes, a[href*='todas'], a:has-text('Todas as movimentações'), a:has-text('Ver todas')"
          );
          if (linkTodas) {
            console.log(`[scraperTJSP] Clicando em "Todas as movimentações"`);
            await linkTodas.click();
            await page.waitForTimeout(3000);
          }
        } catch { /* link pode não existir */ }

        // Verificar se existe tabela de movimentações
        const tabelaExiste = await page.$("table[id*='ovimentacoes'], table[id*='Movimentacoes']");
        if (!tabelaExiste) {
          console.warn(`[scraperTJSP] Tabela de movimentações não encontrada em: ${url}`);
          await page.close();
          continue; // tenta próxima URL
        }

        // Extrair movimentações do DOM
        const movimentos = await page.evaluate(() => {
          const movs = [];

          // Localizar a tabela (vários seletores possíveis)
          const table =
            document.getElementById("tabelaTodasMovimentacoes") ||
            document.getElementById("tabelaUltimasMovimentacoes") ||
            document.querySelector("table[id*='ovimentacoes']") ||
            document.querySelector("table[id*='Movimentacoes']");

          if (!table) return movs;

          let current = null;

          for (const row of table.querySelectorAll("tr")) {
            const cells = row.querySelectorAll("td");
            if (cells.length === 0) continue;

            // Pegar texto de todas as células disponíveis
            const c0 = cells.length >= 1 ? (cells[0].innerText || "").trim() : "";
            const c1 = cells.length >= 2 ? (cells[1].innerText || "").trim() : "";
            const c2 = cells.length >= 3 ? (cells[2].innerText || "").trim() : "";

            // Detecta se a primeira célula contém uma data DD/MM/YYYY
            const dateMatch = c0.match(/(\d{2}\/\d{2}\/\d{4})/);

            if (dateMatch) {
              if (current) movs.push(current);

              // A descrição pode estar em c1 ou c2 (algumas tabelas têm 3 colunas)
              // Também pode ser multiline — pegar a primeira linha como descricao
              const fullDesc = (c1 || c2 || "").replace(/\s+\n\s+/g, "\n").trim();
              const lines = fullDesc.split("\n").map(l => l.trim()).filter(Boolean);
              const descricao = lines[0] || fullDesc;
              const restLines = lines.slice(1).join("\n").trim();

              current = {
                data: dateMatch[1],
                descricao,
                conteudo: restLines || "",
              };
            } else if (current) {
              // Linha de continuação: adiciona como conteúdo da movimentação atual
              const extra = (c1 || c0 || "").trim();
              if (extra) {
                current.conteudo += (current.conteudo ? "\n" : "") + extra;
              }
            }
          }

          if (current) movs.push(current);
          return movs;
        });

        console.log(`[scraperTJSP] ${movimentos.length} movimentações extraídas de ${url}`);
        await page.close();

        if (movimentos.length > 0) {
          return movimentos
            .map(m => ({
              dataAndamento: _parseDataBR(m.data),
              descricao: m.descricao,
              conteudo: m.conteudo.trim() || null,
            }))
            .filter(m => m.dataAndamento && m.descricao);
        }
        // Se não encontrou nada, tenta a próxima URL
      } catch (pageErr) {
        console.warn(`[scraperTJSP] Erro na URL ${url}: ${pageErr.message}`);
        await page.close().catch(() => {});
      }
    }

    console.warn(`[scraperTJSP] Nenhuma movimentação encontrada para "${numeroProcesso}"`);
    return [];
  } catch (e) {
    console.error(`[scraperTJSP] Erro ao fazer scrape de ${numeroProcesso}:`, e.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
