import { chromium } from "playwright";

/**
 * Gera HTML com paginação MANUAL: Hoje, na hora que e
 * - 1 página "intro" por advogado (nome/competência + resumo + últimos 6)
 * - N páginas de detalhamento (chunks)
 * - última página do detalhamento inclui saldo (ou intro inclui saldo se não houver detalhe)
 */
function buildHtml({ ano, mes, advViews }) {
  const competenciaLabelLong = (ano, mes) => {
    const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    return `${MESES[(mes || 1) - 1] || "—"}/${String(ano).slice(-2)}`;
  };

  const brlFromCentavos = (v) => (Number(v || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pad2 = (n) => String(n).padStart(2, "0");
  const brDate = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

  const pickCliente = (it) => it?.cliente ?? it?.clienteNome ?? it?.cliente?.nome ?? it?.cliente?.razaoSocial ?? "—";
  const pickContrato = (it) => it?.contrato ?? it?.contratoNumero ?? it?.contrato?.numeroContrato ?? it?.contrato?.numero ?? "—";
  const pickDateBR = (it) => {
    const raw = it?.dataRecebimento ?? it?.data_recebimento ?? it?.data ?? it?.createdAt ?? it?.created_at;
    if (!raw) return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    return brDate(d);
  };

  const tendenciaEmoji = (dir) => dir === "up" ? "🔼" : dir === "down" ? "🔽" : "➖";

  // CSS “de PDF” (isolado e previsível)
  const css = `
    @page { size: A4 portrait; margin: 12mm; }
    html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; }
    * { box-sizing: border-box; }

    .header {
      position: fixed; top: 0; left: 0; right: 0;
      padding: 10mm 12mm 4mm 12mm;
      background: #fff;
    }
    .header .line { border-top: 2px solid #000; margin-top: 10px; }

    .footer {
      position: fixed; bottom: 0; left: 0; right: 0;
      padding: 4mm 12mm 10mm 12mm;
      background: #fff;
      font-size: 11px; color: #444;
    }
    .footer .line { border-top: 2px solid #000; margin-bottom: 6px; }

    /* “página lógica” controlada por nós (não pelo Chrome) */
    .page {
      padding-top: 32mm;     /* espaço do header */
      padding-bottom: 30mm;  /* espaço do footer */
      break-after: page;
      page-break-after: always;
      width: 100%;
    }
    .page:last-child { break-after: auto; page-break-after: auto; }

    .container { padding: 0 0; }

    .meta { font-size: 12px; margin-top: 2px; margin-bottom: 6px; }
    .sep { border-top: 1px solid #000; margin: 6px 0 10px; }

    h3 { margin: 0 0 6px 0; font-size: 13px; letter-spacing: .2px; }
    .note { font-size: 11px; margin-top: 6px; color: #444; }

    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px; }
    th { background: #f4f4f4; font-size: 12px; text-align: left; }
    td { font-size: 11px; }

    .right { text-align: right; }
    .center { text-align: center; }

    /* Repetição de cabeçalho de tabela quando quebrar naturalmente (raramente, pq estamos chunkando) */
    thead { display: table-header-group; }
  `;

  const now = new Date();
  const competencia = competenciaLabelLong(ano, mes);

  // Monta páginas
  const pages = [];

  for (const p of (advViews || [])) {
    const advogado = p.advogadoNome ?? "—";

    const repassesDetalhe = (p.repasses || []).filter((it) => {
      const cli = pickCliente(it);
      const ctr = pickContrato(it);
      return !(cli === "—" && ctr === "—");
    });

    const total = repassesDetalhe.reduce((acc, it) => acc + Number(it?.valorRecebidoCentavos ?? 0), 0);

    const t6 = (p.tendencia6m && p.tendencia6m.length ? p.tendencia6m : []).slice(0, 6);

    // Chunk do detalhamento
    const ROWS_PER_PAGE = 22; // calibrado p/ A4 com header/footer
    const chunks = [];
    for (let i = 0; i < repassesDetalhe.length; i += ROWS_PER_PAGE) {
      chunks.push(repassesDetalhe.slice(i, i + ROWS_PER_PAGE));
    }

    // Página 1 (intro)
    pages.push(`
      <section class="page">
        <div class="container">
          <div class="meta">
            <div><b>Advogada(o):</b> ${escapeHtml(advogado)}</div>
            <div style="margin-top:2px"><b>Competência de emissão:</b> ${escapeHtml(competencia)}</div>
          </div>
          <div class="sep"></div>

          <div style="margin-top:10px">
            <h3>RESUMO DA COMPETÊNCIA</h3>
            <table>
              <tbody>
                <tr>
                  <td style="font-size:12px">Repasses</td>
                  <td class="right" style="font-weight:800; font-size:12px">R$ ${brlFromCentavos(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style="margin-top:12px">
            <h3>ÚLTIMOS 6 REPASSES (DESEMPENHO)</h3>
            <table>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th class="right">Valor do repasse</th>
                  <th class="center">Tendência</th>
                </tr>
              </thead>
              <tbody>
                ${t6.map((t) => `
                  <tr>
                    <td>${escapeHtml(t?.competencia || "—")}</td>
                    <td class="right">R$ ${brlFromCentavos(t?.valorRepasseCentavos ?? t?.valorCentavos ?? t?.valorCent ?? 0)}</td>
                    <td class="center">${tendenciaEmoji(t?.dir)}</td>
                  </tr>
                `).join("") || `
                  <tr>
                    <td colspan="3" style="color:#666">Sem histórico disponível.</td>
                  </tr>
                `}
              </tbody>
            </table>
            <div class="note">🔎 • 🔼 maior • ➖ igual • 🔽 menor</div>
          </div>

          ${chunks.length === 0 ? `
            <div style="margin-top:12px">
              <h3>DETALHAMENTO DA COMPETÊNCIA</h3>
              <table>
                <tbody>
                  <tr><td style="color:#666">Sem repasses variáveis na competência.</td></tr>
                </tbody>
              </table>
            </div>

            <div style="margin-top:12px">
              <h3>SALDO (CONTROLE)</h3>
              <table>
                <tbody>
                  <tr>
                    <td style="font-size:12px">Saldo atual após os repasses</td>
                    <td class="right" style="font-weight:800; font-size:12px">
                      R$ ${brlFromCentavos(Number(p.saldoPosteriorCentavos ?? 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ` : ``}
        </div>
      </section>
    `);

    // Páginas do detalhamento
    if (chunks.length) {
      chunks.forEach((chunk, pageIdx) => {
        const isLast = pageIdx === chunks.length - 1;
        pages.push(`
          <section class="page">
            <div class="container">
              <div class="meta">
                <div><b>Advogada(o):</b> ${escapeHtml(advogado)}</div>
                <div style="margin-top:2px"><b>Competência de emissão:</b> ${escapeHtml(competencia)}</div>
              </div>
              <div class="sep"></div>

              <div style="margin-top:12px">
                <h3>DETALHAMENTO DA COMPETÊNCIA (pág. ${pageIdx + 1}/${chunks.length})</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Cliente · Contrato</th>
                      <th>Data recebimento</th>
                      <th class="right">Valor do repasse</th>
                      <th class="right">Valor recebido</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${chunk.map((it) => {
                      const cli = pickCliente(it);
                      const ctr = pickContrato(it);
                      const rep = Number(it?.valorCentavos ?? 0);
                      const rec = Number(it?.valorRecebidoCentavos ?? 0);
                      return `
                        <tr>
                          <td>${escapeHtml(cli)} · ${escapeHtml(ctr)}</td>
                          <td>${escapeHtml(pickDateBR(it))}</td>
                          <td class="right">R$ ${brlFromCentavos(rep)}</td>
                          <td class="right">R$ ${brlFromCentavos(rec)}</td>
                        </tr>
                      `;
                    }).join("")}
                  </tbody>
                </table>
              </div>

              ${isLast ? `
                <div style="margin-top:12px">
                  <h3>SALDO (CONTROLE)</h3>
                  <table>
                    <tbody>
                      <tr>
                        <td style="font-size:12px">Saldo atual após os repasses</td>
                        <td class="right" style="font-weight:800; font-size:12px">
                          R$ ${brlFromCentavos(Number(p.saldoPosteriorCentavos ?? 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ` : ``}
            </div>
          </section>
        `);
      });
    }
  }

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${css}</style>
      </head>
      <body>
        <div class="header">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <div>
              <div style="font-size:16px; font-weight:800;">Amanda Maia Ramalho Advogados</div>
              <div style="font-size:12px; color:#444; margin-top:2px;">
                Relatório de Repasses • Competência: <b>${escapeHtml(competencia)}</b>
              </div>
            </div>
            <div style="text-align:right; font-size:12px; color:#444;">
              <div><b>Emissão:</b> ${brDate(now)}</div>
            </div>
          </div>
          <div class="line"></div>
        </div>

        <div class="footer">
          <div class="line"></div>
          <div style="display:flex; justify-content:space-between; gap:12px;">
            <div>Uso exclusivo do Advogado • Documento gerado automaticamente pelo sistema Addere - Controle de Gestão Financeira</div>
            <div style="white-space:nowrap;">${brDate(now)}</div>
          </div>
          <div style="margin-top:2px;">Em caso de divergência, contatar o financeiro.</div>
        </div>

        ${pages.join("")}
      </body>
    </html>
  `;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function repassesPdfHandler(req, res) {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);

    if (!ano || Number.isNaN(ano) || ano < 2000) return res.status(400).json({ message: "Parâmetro 'ano' inválido." });
    if (!mes || Number.isNaN(mes) || mes < 1 || mes > 12) return res.status(400).json({ message: "Parâmetro 'mes' inválido." });

    // ✅ AQUI você chama a MESMA rotina que já monta o JSON do relatório (a sua rota atual)
    // Exemplo (ajuste p/ seu código):
    // const advViews = await buildRelatorioRepasses({ ano, mes, userId: req.user.id });
    const advViews = await getRelatorioRepassesData({ ano, mes, req }); // <-- implemente chamando seu serviço atual

    const html = buildHtml({ ano, mes, advViews });

    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Relatorio-Repasses-${ano}-${String(mes).padStart(2, "0")}.pdf"`);
    return res.status(200).send(pdfBuffer);

  } catch (e) {
    console.error("[repassesPdfHandler] erro:", e);
    return res.status(500).json({ message: "Erro ao gerar PDF." });
  }
}

/**
 * Plugue aqui sua lógica atual. O ideal é REUSAR exatamente a mesma função/serviço
 * que abastece a tela (advViews com repasses, tendencia6m, saldoPosteriorCentavos etc).
 */
async function getRelatorioRepassesData({ ano, mes, req }) {
  // 🚩 Substitua pelo seu código real.
  // Você pode chamar direto sua função interna de service, não faça fetch HTTP.
  return [];
}
