import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPdfRowsByColumns(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const data = new Uint8Array(ab);

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const allRows = [];

  const mid = (a, b) => {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return (a + b) / 2;
  };


  // Fallback por linha (evita regressão): se o recorte por colunas falhar e o "histórico" vier vazio
  // (observado em alguns PDFs, ex.: "Livro Caixa 04 Abr.pdf"), tentamos separar Cliente/Fornecedor vs Histórico
  // detectando o MAIOR GAP entre tokens (X) no intervalo [cliStart, cut.hisEnd).
  const splitClienteHistoricoByGap = (tokens, xMin, xMax) => {
    const seg = tokens
      .filter((t) => t.x >= (xMin ?? 0) && (xMax == null || t.x < xMax))
      .sort((a, b) => a.x - b.x);

    if (seg.length < 3) return null;

    let bestGap = 0;
    let bestIdx = -1;
    for (let i = 1; i < seg.length; i++) {
      const gap = seg[i].x - seg[i - 1].x;
      if (gap > bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }

    // limiar conservador pra não afetar PDFs já bons
    if (bestGap < 18 || bestIdx <= 0 || bestIdx >= seg.length) return null;

    const left = seg.slice(0, bestIdx).map((t) => t.s).join(" ").replace(/\s+/g, " ").trim();
    const right = seg.slice(bestIdx).map((t) => t.s).join(" ").replace(/\s+/g, " ").trim();

    if (!left || !right) return null;
    return { left, right };
  };

for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Agrupa itens por linha (Y)
    const rowsMap = new Map();
    for (const it of content.items) {
      const s = String(it.str || "").trim();
      if (!s) continue;
      const x = it.transform?.[4] ?? 0;
      const y = it.transform?.[5] ?? 0;
      const yKey = Math.round(y * 2) / 2; // granularidade 0.5
      if (!rowsMap.has(yKey)) rowsMap.set(yKey, []);
      rowsMap.get(yKey).push({ x, s });
    }

    // Ordena linhas de cima pra baixo
    const yKeys = Array.from(rowsMap.keys()).sort((a, b) => b - a);

    // 1) Acha a linha de cabeçalho e define X dos títulos
    let col = null;

    for (const yKey of yKeys) {
      const tokens = rowsMap.get(yKey).sort((a, b) => a.x - b.x);
      const line = tokens.map((t) => t.s).join(" ");
      if (
        line.includes("Cliente") &&
        line.includes("Histórico") &&
        line.includes("Entrada") &&
        line.includes("Saída") &&
        line.includes("Local") &&
        line.includes("Saldo")
      ) {
        const getX = (needle) => tokens.find((t) => t.s.includes(needle))?.x ?? null;

        const xData = getX("Data") ?? 0;
        const xDoc = getX("NFS-e") ?? getX("NFS-e/NF/CF/RC") ?? getX("NF") ?? null;
        const xES = getX("E/S") ?? null;
        const xCli = getX("Cliente") ?? null;
        const xHis = getX("Histórico") ?? null;
        const xEnt = getX("Entrada") ?? null;
        const xSai = getX("Saída") ?? null;
        const xLoc = getX("Local") ?? null;
        const xSal = getX("Saldo") ?? null;

        col = { xData, xDoc, xES, xCli, xHis, xEnt, xSai, xLoc, xSal };
        break;
      }
    }

    // fallback se não achar header
    if (!col) {
      col = { xData: 0, xDoc: 90, xES: 160, xCli: 250, xHis: 490, xEnt: 610, xSai: 660, xLoc: 710, xSal: 760 };
    }

    // ------------------------------------------------------------
    // FIX: Em alguns PDFs (observado em Set/2019 em diante) o cabeçalho
    // "NFS-e/NF/CF/RC" e "E/S" pode vir colado no MESMO token, fazendo
    // xDoc e xES ficarem iguais e "Documento" acabar vazio.
    // Quando isso acontecer, inferimos xDoc/xES olhando as primeiras linhas
    // de dados (tokens 'NFS-e' e 'E'/'S').
    // ------------------------------------------------------------
    if (col) {
      const near = (a, b, tol = 6) => (a != null && b != null && Math.abs(a - b) <= tol);
      const median = (arr) => {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        const midIdx = Math.floor(s.length / 2);
        return s.length % 2 ? s[midIdx] : (s[midIdx - 1] + s[midIdx]) / 2;
      };

      if (col.xES == null || col.xDoc == null || near(col.xES, col.xDoc)) {
        const esXs = [];
        const docXs = [];

        let seen = 0;
        for (const yKey of yKeys) {
          if (seen >= 40) break;
          const tokens = rowsMap.get(yKey).sort((a, b) => a.x - b.x);
          const line = tokens.map((t) => t.s).join(" ").replace(/\s+/g, " ").trim();
          const mDate = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
          if (!mDate) continue;

          // ignora linhas de saldo
          if (/Saldo de/i.test(line)) continue;

          const tES = tokens.find((t) => /^[ES]$/i.test(String(t.s || "").trim()));
          if (tES) {
            // só considera ES antes da coluna Cliente (se existir)
            if (col.xCli == null || tES.x < col.xCli) esXs.push(tES.x);
          }

          const tDoc = tokens.find((t) => /^(NFS-e|NF|CF|RC)$/i.test(String(t.s || "").trim()));
          if (tDoc) {
            if (col.xCli == null || tDoc.x < col.xCli) docXs.push(tDoc.x);
          }

          seen += 1;
        }

        const infES = median(esXs);
        const infDoc = median(docXs);

        if (infDoc != null) col.xDoc = infDoc;
        if (infES != null) col.xES = infES;

        // se ainda ficou colado, força docEnd com base em xCli (pelo menos não zera)
        if (near(col.xES, col.xDoc) && col.xCli != null) {
          // assume ES está antes do Cliente, então desloca ES para o meio do caminho Doc->Cli
          col.xES = median([col.xDoc + 40, (col.xDoc + col.xCli) / 2]);
        }
      }
    }


    // 2) Cortes por MEIO entre colunas (evita "Local" pegar "Saldo")
    const cut = {
      docEnd: (col.xES != null ? (col.xES - 1) : mid(col.xDoc, col.xES)),
      cliEnd: mid(col.xCli, col.xHis),
      hisEnd: mid(col.xHis, col.xEnt),
      entEnd: mid(col.xEnt, col.xSai),
      saiEnd: mid(col.xSai, col.xLoc),
      locEnd: mid(col.xLoc, col.xSal), // << aqui é o que impede o saldo cair em local
    };

        // ------------------------------------------------------------
    // Fallback textual (sem cadastro prévio): alguns PDFs (ex.: Abril/2019)
    // colapsam Cliente/Fornecedor + Histórico na mesma coluna, deixando "historico" vazio.
    // Para NÃO regredir os PDFs já perfeitos, só aplicamos quando historico vier vazio.
    //
    // Estratégia:
    // 1) Casos "Banco X ..." => cliente = "Banco X", histórico = resto
    // 2) Procura palavras-chave típicas de histórico (material, serviços, tarifa, rendimento, aplicação...)
    //    e divide no primeiro match.
    // ------------------------------------------------------------
    const splitClienteHistoricoByText = (s) => {
      const raw = String(s || "").replace(/\s+/g, " ").trim();
      if (!raw) return null;

      const tokens = raw.split(" ").filter(Boolean);
      if (tokens.length < 2) return null;

      const t0 = tokens[0].toLowerCase();

      // 1) "Banco Itaú ..." / "Banco do Brasil ..." etc.
      if (t0 === "banco" && tokens.length >= 3) {
        // Mantém "Banco <prox>" como cliente (mais seguro e evita dividir nomes longos por engano)
        const left = tokens.slice(0, 2).join(" ").trim();
        const right = tokens.slice(2).join(" ").trim();
        if (right) return { left, right };
      }

      // 2) Palavras-chave que normalmente iniciam o histórico
      const keywords = new Set([
        "material","materiais","utensílios","utensilios","serviço","serviços","servico","servicos",
        "tarifa","tarifas","taxa","taxas","rendimento","rendimentos","aplicação","aplicacao",
        "aplicações","aplicacoes","juros","iof","pix","ted","doc","boleto","pagamento","pagamentos",
        "transferência","transferencia","transferências","transferencias","compra","compras",
        "manutenção","manutencao","frete","energia","água","agua","internet","telefone",
        "aluguel","locação","locacao","combustível","combustivel","imposto","impostos",
        "débito","debito","crédito","credito","estorno","cancelamento","compra","pagto",
        "pagamento","receb","recebimento","transferência","transferencia","transf","entre","contas",
        "saque","depósito","deposito","cobrança","cobranca","cartão","cartao","fatura",
        "liquidação","liquidacao","pix","ted","doc", "honorários", "honorarios","honorário","honorario",
        "simples","cópias","copias","Cópia","Copia","limpeza","(paulo","sistema"
     ]);

      // acha o primeiro token (a partir do 2º) que pareça início de histórico
      for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i].toLowerCase();
        if (keywords.has(tok)) {
          const left = tokens.slice(0, i).join(" ").trim();
          const right = tokens.slice(i).join(" ").trim();
          if (left && right) return { left, right };
        }
      }

      return null;
    };

    // Observação do seu PDF: "Cliente/Fornecedor" começa logo após o E/S (bem antes do título "Cliente")
    const cliStart = (col.xES != null ? (col.xES + 5) : (col.xCli ?? 0));
    const esStart = col.xES ?? 0;
    const docStart = col.xDoc ?? 0;
    const hisStart = cut.cliEnd ?? (col.xHis ?? 0);
    const locStart = cut.saiEnd ?? (col.xLoc ?? 0);

    // 3) Processa linhas de dados
    for (const yKey of yKeys) {
      const tokens = rowsMap.get(yKey).sort((a, b) => a.x - b.x);
      const line = tokens.map((t) => t.s).join(" ").replace(/\s+/g, " ").trim();

      // pula título/cabeçalho/saldo anterior
      if (line.startsWith("Addere - Livro Caixa")) continue;
      if (line.startsWith("Data NFS-e")) continue;
      if (/Saldo de/i.test(line)) continue;

      const mDate = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
      if (!mDate) continue;

      const pick = (xMin, xMax) =>
        tokens
          .filter((t) => t.x >= (xMin ?? 0) && (xMax == null || t.x < xMax))
          .map((t) => t.s)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

      const dataBR = mDate[1];

      let documento = pick(docStart, cut.docEnd);
      let esRaw = pick(esStart, cliStart).trim();

      // Se o ES veio com lixo (ex.: "00074/19 E" ou "00074/19  E"),
      // extrai o E/S e joga o "00074/19" para dentro do documento.
      let es = esRaw;

      // Normaliza NBSP
      esRaw = esRaw.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

      const mEsComNumero = esRaw.match(/^(\d+\/\d{2})\s*([ES])$/i)
        || esRaw.match(/^(\d+\/\d{2})\s+([ES])\b/i);

      if (mEsComNumero) {
        const num = mEsComNumero[1];          // "00074/19"
        const letter = mEsComNumero[2].toUpperCase(); // "E" ou "S"

        if (num) {
          documento = [documento, num].filter(Boolean).join(" ").trim();
        }
        es = letter;
      } else {
        // se o ES veio como "E" ou "S" normal, mantém
        es = esRaw.toUpperCase();
      }

      const clienteFornecedor0 = pick(cliStart, hisStart);
      const historico0 = pick(hisStart, cut.hisEnd);

      // Remove "E"/"S" isolado no começo (variações: espaço, NBSP, "-", ":")
      // Ex.: "S Lucas Cecim" -> "Lucas Cecim"
      function stripEsLeadingToken(txt) {
        const s = String(txt || "")
          .replace(/\u00A0/g, " ")      // NBSP -> espaço normal
          .replace(/\s+/g, " ")
          .trim();

        if (!s) return "";

        // tira "E" ou "S" como token inicial, seguido de separadores e texto
        // exige que depois venha pelo menos 2 letras (evita mexer em casos estranhos)
        const m = s.match(/^(E|S)\s*[-:–—]?\s+(.+)$/i);
        if (!m) return s;

        const rest = String(m[2] || "").trim();
        if (rest.length < 2) return s;

        return rest;
      }

      const clienteFornecedor0Clean = stripEsLeadingToken(clienteFornecedor0);
      const historico0Clean = stripEsLeadingToken(historico0);

      // ------------------------------------------------------------
      // Fallback textual (só quando histórico vier vazio)
      // Não depende de cadastro prévio
      // Não afeta PDFs que já funcionam
      // ------------------------------------------------------------

      // fallback: alguns PDFs colapsam as colunas e o recorte por X deixa "histórico" vazio.
      // só aplica quando histórico veio vazio (pra não mexer no que já está funcionando).
      let clienteFornecedor = clienteFornecedor0Clean;
      let historico = historico0Clean;

      if (!historico && clienteFornecedor) {
        const split = splitClienteHistoricoByGap(tokens, cliStart, cut.hisEnd);
        if (split) {
          clienteFornecedor = split.left;
          historico = split.right;
        }
      }

      // fallback textual (só quando histórico continuar vazio)
      // não depende de cadastro prévio
      if (!historico && clienteFornecedor) {
        const splitTxt = splitClienteHistoricoByText(clienteFornecedor);
        if (splitTxt) {
          clienteFornecedor = splitTxt.left;
          historico = splitTxt.right;
        }
      }

      // Large right-aligned numbers extend LEFT of the column header's X position.
      // Use mid(Histórico, Entrada) as Entrada start, and mid(Entrada, Saída) as Saída start
      // so wide values like "14.967,09" are not missed.
      const entradaTxt = pick(cut.hisEnd ?? (col.xEnt ?? 0), cut.entEnd);
      const saidaTxt = pick(cut.entEnd ?? (col.xSai ?? 0), cut.saiEnd);

      // ✅ Local é a última coluna útil; Saldo (última coluna do PDF) é ignorado
      const local = pick(locStart, cut.locEnd);

      const moneyRe = /\d{1,3}(?:\.\d{3})*,\d{2}/;
      const entradaVal = (entradaTxt.match(moneyRe) || [null])[0];
      const saidaVal = (saidaTxt.match(moneyRe) || [null])[0];
      const valorBR = entradaVal || saidaVal || null;

      if (!valorBR) continue;

      allRows.push({
        dataBR,
        documento: documento || null,
        es: (es === "E" || es === "S") ? es : (entradaVal ? "E" : "S"),
        clienteFornecedor: clienteFornecedor || "",
        historico: historico || "",
        valorBR,
        local: local || "",
      });
    }
  }

  return allRows;
}

export async function extractPdfLines(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const data = new Uint8Array(ab);

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Cada item tem .str e .transform (matriz com posição)
    // transform[5] costuma ser o Y, transform[4] o X (depende do PDF, mas normalmente funciona)
    const rows = new Map();

    for (const it of content.items) {
      const s = String(it.str || "").trim();
      if (!s) continue;

      const x = it.transform?.[4] ?? 0;
      const y = it.transform?.[5] ?? 0;

      // Agrupa por linha usando arredondamento do Y (ajuste fino se precisar)
      const yKey = Math.round(y * 2) / 2; // 0.5 de granularidade
      if (!rows.has(yKey)) rows.set(yKey, []);
      rows.get(yKey).push({ x, s });
    }

    // Ordena as linhas de cima pra baixo (Y desc) e tokens da esquerda pra direita (X asc)
    const yKeys = Array.from(rows.keys()).sort((a, b) => b - a);
    for (const yKey of yKeys) {
      const tokens = rows.get(yKey).sort((a, b) => a.x - b.x).map(t => t.s);
      const line = tokens.join(" ").replace(/\s+/g, " ").trim();
      if (line) allLines.push(line);
    }
  }

  return allLines;
}
