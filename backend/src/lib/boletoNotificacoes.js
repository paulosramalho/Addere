// backend/src/lib/boletoNotificacoes.js
// Pós-processamento após emissão de boleto:
//   1. Gerar PDF (PDFKit)
//   2. Salvar no Drive (pasta do cliente, ano/mês do vencimento)
//   3. E-mail ao cliente (PDF anexado)
//   4. WhatsApp ao cliente (PDF anexado)
//   5. WhatsApp a todos os admins + advogados envolvidos (texto)
//   6. WhatsApp a admins se cliente sem e-mail e/ou telefone

import { createRequire } from "module";
import { Readable }       from "stream";
import prisma             from "./prisma.js";
import { sendEmail, EMAIL_FROM } from "./email.js";
import { baixarPdfInter } from "./interBoleto.js";
import {
  sendWhatsApp,
  _waPhone,
  WA_TOKEN,
  WA_PHONE_NUMBER_ID,
  WA_API_URL,
  _waMediaBase,
} from "./whatsapp.js";

const require = createRequire(import.meta.url);

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtBRL = (c) =>
  (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function fmtDateISO(iso) {
  if (!iso) return "—";
  // Prisma retorna Date objects — usar toISOString() para garantir formato YYYY-MM-DD
  const s = (iso instanceof Date ? iso.toISOString() : String(iso)).slice(0, 10);
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function _sanitizarNome(nome) {
  return (nome || "cliente")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();
}

function _nomeArquivoBoleto(cliente, boleto) {
  const nomeSan = _sanitizarNome(cliente.nomeRazaoSocial);
  const venc = new Date(boleto.dataVencimento);
  const ano  = venc.getUTCFullYear();
  const mes  = String(venc.getUTCMonth() + 1).padStart(2, "0");
  return `Boleto_${nomeSan}_${ano}_${mes}.pdf`;
}

// ── 1. PDF ────────────────────────────────────────────────────────────────────

async function _gerarPdfBoleto(boleto, cliente) {
  const PDFDocument = require("pdfkit");
  const QRCode      = require("qrcode");

  // ── Constantes fixas Addere / Inter ──────────────────────────────────────────
  const B_NOME  = "ADDERE";
  const B_CNPJ  = "48.744.127/0001-41";
  const B_END1  = "RUA ANTONIO BARRETO, 130, SALA 1403";
  const B_END2  = "UMARIZAL, BELEM/PA, 66055-050";
  const AG_COD  = "00019/254311490";
  const CART    = "112";
  const LOC_PAG = "PAGÁVEL EM QUALQUER BANCO";

  // ── Formatadores ───────────────────────────────────────────────────────────
  const fmtD = (d) => {
    const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
    const [y, m, dy] = s.split("-");
    return `${dy}/${m}/${y}`;
  };
  const fmtV = (c) =>
    (Number(c || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const vencStr  = fmtD(boleto.dataVencimento);
  const hojeStr  = fmtD(new Date());
  const venc1d      = new Date(boleto.dataVencimento);
  venc1d.setUTCDate(venc1d.getUTCDate() + 1);
  const _valDias    = Number(boleto.validadeDias ?? 30);
  const vencLimite  = new Date(boleto.dataVencimento);
  vencLimite.setUTCDate(vencLimite.getUTCDate() + _valDias);
  const valorStr  = fmtV(boleto.valorCentavos);
  const nossoFmt  = `00019/${CART}/${boleto.nossoNumero || "—"}`;
  const docNum    = boleto.docNum || `AMR-B${String(boleto.id).padStart(5, "0")}`;
  const multaPerc = Number(boleto.multaPerc  ?? 2);
  const moraPerc  = Number(boleto.moraPercMes ?? 1);
  const historico = boleto.historico || "Honorários advocatícios";
  const pagNome   = cliente.nomeRazaoSocial || "—";
  const pagDoc    = cliente.cpfCnpj || "";

  // ── QR Code (pré-gerar antes de abrir o PDF) ──────────────────────────────
  let qrPng = null;
  if (boleto.pixCopiaECola) {
    try {
      qrPng = await QRCode.toBuffer(boleto.pixCopiaECola,
        { type: "png", width: 220, margin: 1, errorCorrectionLevel: "M" });
    } catch { /* fallback: caixa vazia */ }
  }

  // ── Dimensões A4 ─────────────────────────────────────────────────────────
  const M  = 36;
  const PW = 595.28;
  const CW = PW - M * 2; // 523.28

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: "A4", margin: 0 });
    const chunks = [];
    doc.on("data",  (c) => chunks.push(c));
    doc.on("end",   ()  => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const GRAY  = "#555555";
      const BLACK = "#000000";


      // ── Helpers ──────────────────────────────────────────────────────────
      const hline = (y, dash = false, color = "#999999") => {
        doc.save();
        if (dash) doc.dash(3, { space: 3 });
        doc.moveTo(M, y).lineTo(PW - M, y)
           .strokeColor(color).lineWidth(0.5).stroke();
        doc.restore();
      };

      const vline = (x, y1, y2) =>
        doc.moveTo(x, y1).lineTo(x, y2)
           .strokeColor("#cccccc").lineWidth(0.4).stroke();

      const lbl = (text, x, y, w) =>
        doc.font("Helvetica").fontSize(7).fillColor(GRAY)
           .text(text, x, y, { width: w, lineBreak: false });

      const val = (text, x, y, w, bold = false, sz = 8.5) =>
        doc.font(bold ? "Helvetica-Bold" : "Helvetica")
           .fontSize(sz).fillColor(BLACK)
           .text(String(text ?? ""), x, y, { width: w, lineBreak: false });

      const cellRect = (label, value2, rx, ry, rw, rh = 22, bold = false) => {
        doc.rect(rx, ry, rw, rh).strokeColor("#aaaaaa").lineWidth(0.3).stroke();
        lbl(label, rx + 2, ry + 2, rw - 4);
        if (value2) val(value2, rx + 2, ry + 11, rw - 4, bold);
      };

      // ── SEÇÃO 1: Cabeçalho (Recibo do Pagador) ───────────────────────
      let y = M;

      doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK)
         .text(B_NOME, M, y, { lineBreak: false });
      y += 13;

      doc.font("Helvetica").fontSize(9).fillColor(BLACK)
         .text(`CPF/CNPJ: ${B_CNPJ}`, M, y, { lineBreak: false });
      y += 22; // duas linhas em branco

      doc.font("Helvetica").fontSize(9).fillColor(BLACK)
         .text(B_END1, M, y, { lineBreak: false });
      y += 12;

      doc.font("Helvetica").fontSize(9).fillColor(BLACK)
         .text(B_END2, M, y, { lineBreak: false });
      y += 20;

      if (boleto.modo === "mock") {
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#b45309")
           .text("⚠ SIMULAÇÃO — Dados gerados localmente, não registrado no Banco Inter.", M, y, { lineBreak: false });
        y += 14;
      }

      // ── Separador pontilhado ──────────────────────────────────────────
      hline(y, true);
      y += 12;

      // ── SEÇÃO 2: QR Code + Pix ───────────────────────────────────────
      const qrSz = 110;
      const qrX  = M;
      const qrY  = y;
      const txX  = M + qrSz + 22;
      const txW  = CW - qrSz - 22;

      if (qrPng) {
        doc.image(qrPng, qrX, qrY, { width: qrSz, height: qrSz });
      } else {
        doc.rect(qrX, qrY, qrSz, qrSz).strokeColor("#bbbbbb").lineWidth(0.5).stroke();
        doc.font("Helvetica").fontSize(8).fillColor(GRAY)
           .text("QR Code Pix", qrX, qrY + qrSz / 2 - 4, { width: qrSz, align: "center", lineBreak: false });
      }

      doc.font("Helvetica-Bold").fontSize(17).fillColor(BLACK)
         .text("Pague sua cobrança via Pix, o", txX, qrY + 8, { width: txW, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(17).fillColor(BLACK)
         .text("recebimento é instantâneo.", txX, qrY + 30, { width: txW, lineBreak: false });
      doc.font("Helvetica").fontSize(10.5).fillColor(GRAY)
         .text("Leia o QR Code no seu celular.", txX, qrY + 60, { width: txW, lineBreak: false });

      y = qrY + qrSz + 12;

      // ── Separador pontilhado ──────────────────────────────────────────
      hline(y, true);
      y += 8;

      // ── SEÇÃO 3: Logo Addere + Beneficiário ─────────────────────────────
      const logoW = 115;                           // mais largo → logo maior
      const bfX   = M + logoW + 4;
      const bfW   = CW - logoW - 4;
      const boxH  = 62;

      // Fundo azul-marinho suave na célula da logo (dentro do box)
      doc.rect(M, y, logoW, boxH).fillColor("#d6e4f5").fill();
      // Box outline por cima
      doc.rect(M, y, CW, boxH).strokeColor("#aaaaaa").lineWidth(0.4).stroke();
      vline(bfX, y, y + boxH);

      // Logo Addere: PNG com alpha — ratio 8.22:1
      // A largura útil é logoW-8=107pt → altura = 107/8.22 ≈ 13pt
      // Centra verticalmente: (boxH - 13) / 2 ≈ 24.5
      const _logoPath = new URL("../assets/logo.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
      const imgW = logoW - 8;                      // 107pt
      const imgH = Math.round(imgW / 8.22);        // ≈ 13pt
      const imgY = y + Math.round((boxH - imgH) / 2);
      doc.image(_logoPath, M + 4, imgY, { width: imgW, fit: [imgW, imgH] });

      lbl("Beneficiário", bfX + 3, y + 2, bfW - 6);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK)
         .text(`${B_CNPJ} - ${B_NOME}`, bfX + 3, y + 11, { width: bfW - 6, lineBreak: false });

      doc.moveTo(bfX, y + 24).lineTo(PW - M, y + 24)
         .strokeColor("#cccccc").lineWidth(0.3).stroke();

      lbl("Endereço do Beneficiário", bfX + 3, y + 26, bfW - 6);
      doc.font("Helvetica").fontSize(8.5).fillColor(BLACK)
         .text(`${B_END1} ${B_END2}`, bfX + 3, y + 35, { width: bfW - 6, lineBreak: false });

      y += boxH;

      // ── Row: Pagador | Vencimento | Valor do Documento ───────────────
      const rH  = 28;
      const vX  = M + CW - 188;
      const vlX = M + CW - 88;

      doc.rect(M, y, CW, rH).strokeColor("#aaaaaa").lineWidth(0.4).stroke();
      vline(vX,  y, y + rH);
      vline(vlX, y, y + rH);

      lbl("Pagador",             M + 2,   y + 2, vX - M - 4);
      val(pagNome,               M + 2,   y + 11, vX - M - 4, false, 8.5);
      lbl("Vencimento",          vX + 2,  y + 2, vlX - vX - 4);
      val(vencStr,               vX + 2,  y + 11, vlX - vX - 4, true, 9);
      lbl("Valor do Documento",  vlX + 2, y + 2, PW - M - vlX - 4);
      val(valorStr,              vlX + 2, y + 11, PW - M - vlX - 4, true, 9);

      y += rH;

      // ── Row: Agência | Nosso Número | Autenticação Mecânica ──────────
      const nnX = M + 140;
      const amX = M + CW - 130;

      doc.rect(M, y, CW, rH).strokeColor("#aaaaaa").lineWidth(0.4).stroke();
      vline(nnX, y, y + rH);
      vline(amX, y, y + rH);

      lbl("Agência / Código do Beneficiário",   M + 2,   y + 2, nnX - M - 4);
      val(AG_COD,                               M + 2,   y + 11, nnX - M - 4);
      lbl("Nosso Número / Cód. do Documento",   nnX + 2, y + 2, amX - nnX - 4);
      val(nossoFmt,                             nnX + 2, y + 11, amX - nnX - 4);
      lbl("Autenticação Mecânica",              amX + 2, y + 2, PW - M - amX - 4);

      y += rH + 8;

      // ════ Separador pesado — início Ficha de Compensação ═════════════
      hline(y, true, "#555555");
      y += 8;

      // ── SEÇÃO 4: Ficha de Compensação ────────────────────────────────

      // Logo Inter + 077-9 + linha digitável
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#00a859")
         .text("inter", M, y + 4, { width: logoW, align: "center", lineBreak: false });

      doc.font("Helvetica-Bold").fontSize(12).fillColor(BLACK)
         .text("077-9", M + logoW + 12, y + 8, { lineBreak: false });

      doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK)
         .text(boleto.linhaDigitavel || "—",
               M + logoW + 56, y + 8,
               { width: CW - logoW - 56, lineBreak: false });

      y += 36;

      // ── Grade ────────────────────────────────────────────────────────
      const cL = CW - 130;
      const cR = 130;

      // Local de Pagamento | Vencimento
      cellRect("Local De Pagamento", LOC_PAG,  M,      y, cL);
      cellRect("Vencimento",         vencStr,  M + cL, y, cR, 22, true);
      y += 22;

      // Beneficiário | Agência/Cód. Beneficiário
      cellRect("Beneficiário",                    `${B_CNPJ} - ${B_NOME}`, M,      y, cL);
      cellRect("Agência / Código do Beneficiário", AG_COD,                 M + cL, y, cR, 22, true);
      y += 22;

      // Data Documento | N° Documento | Espécie | Aceite | Data Process. | Nosso Número
      const c3w = [70, 88, 72, 38, 80, CW - 348];
      const c3d = [
        ["Data do Documento",              hojeStr,   false],
        ["N° do Documento",                docNum,            false],
        ["Espécie Documento",              "DM",      false],
        ["Aceite",                         "NÃO",     false],
        ["Data de Processamento",          hojeStr,   false],
        ["Nosso Número / Cód. do Documento", nossoFmt, true],
      ];
      let cx = M;
      c3d.forEach(([l, v2, b], i) => { cellRect(l, v2, cx, y, c3w[i], 22, b); cx += c3w[i]; });
      y += 22;

      // Uso do Banco | Carteira | Espécie Moeda | Qtd. | Valor Moeda | Valor Doc.
      const c4w = [70, 55, 68, 78, 78, CW - 349];
      const c4d = [
        ["Uso do banco",       "",       false],
        ["Carteira",           CART,     false],
        ["Espécie Moeda",      "BRL",    false],
        ["Quantidade Moeda",   "",       false],
        ["Valor Moeda",        "",       false],
        ["Valor do Documento", valorStr, true],
      ];
      cx = M;
      c4d.forEach(([l, v2, b], i) => { cellRect(l, v2, cx, y, c4w[i], 22, b); cx += c4w[i]; });
      y += 22;

      // Informações beneficiário (esq) | Deduções (dir)
      // infoH: label(10) + multa(10) + histórico 2 linhas(20) + dataLimite(10) + padding(16) = 66 → 80
      const infoH = 80;
      doc.rect(M, y, cL, infoH).strokeColor("#aaaaaa").lineWidth(0.3).stroke();

      const deds = [
        "(-) Desconto / Abatimento",
        "(-) Outras Deduções",
        "(+) Mora / Multa",
        "(+) Outros Acréscimos",
        "(=) Valor cobrado",
      ];
      const dH = infoH / deds.length;
      deds.forEach((d, i) => {
        doc.rect(M + cL, y + i * dH, cR, dH).strokeColor("#aaaaaa").lineWidth(0.3).stroke();
        lbl(d, M + cL + 2, y + i * dH + 2, cR - 4);
      });

      lbl("Informações de responsabilidade do beneficiário", M + 2, y + 2, cL - 4);
      doc.font("Helvetica").fontSize(8).fillColor(BLACK)
         .text(
           `MULTA DE ${multaPerc}% EM ${fmtD(venc1d)}. MORA DE ${moraPerc}% A PARTIR DE ${fmtD(venc1d)}.`,
           M + 2, y + 12, { width: cL - 8, lineBreak: false });

      // Histórico: max 2 linhas (~86 chars/linha a 8pt em 385pt). Trunca com "..." se necessário.
      const maxHistorico = 160;
      const historicoTxt = historico.length > maxHistorico
        ? historico.slice(0, maxHistorico - 1) + "…"
        : historico;
      doc.font("Helvetica").fontSize(8).fillColor(BLACK)
         .text(historicoTxt, M + 2, y + 27, { width: cL - 8 }); // lineBreak permitido

      // "Data Limite" posicionado dinamicamente logo após o histórico
      const dataLimiteY = Math.min(doc.y + 3, y + infoH - 11);
      doc.font("Helvetica").fontSize(8).fillColor(BLACK)
         .text(`Data Limite para pagamento: ${fmtD(vencLimite)}`, M + 2, dataLimiteY, { lineBreak: false });

      y += infoH;

      // Pagador | CNPJ/CPF
      const pW  = CW - 150;
      const pH  = 36;
      doc.rect(M,      y, pW,  pH).strokeColor("#aaaaaa").lineWidth(0.3).stroke();
      doc.rect(M + pW, y, 150, pH).strokeColor("#aaaaaa").lineWidth(0.3).stroke();
      lbl("Pagador",  M + 2,      y + 2,  pW - 4);
      val(pagNome,    M + 2,      y + 11, pW - 4, false, 8);
      lbl("CNPJ/CPF:", M + pW + 2, y + 2,  146);
      val(pagDoc,     M + pW + 2, y + 11, 146,    false, 8);
      y += pH;

      // Beneficiário Final | CNPJ/CPF
      doc.rect(M,      y, pW,  22).strokeColor("#aaaaaa").lineWidth(0.3).stroke();
      doc.rect(M + pW, y, 150, 22).strokeColor("#aaaaaa").lineWidth(0.3).stroke();
      lbl("Beneficiário Final", M + 2,      y + 2,  pW - 4);
      val(B_NOME,               M + 2,      y + 11, pW - 4, false, 8);
      lbl("CNPJ/CPF:",          M + pW + 2, y + 2,  146);
      val(B_CNPJ,               M + pW + 2, y + 11, 146,    false, 8);
      y += 22 + 6;

      // ── Separador pontilhado final ────────────────────────────────────
      hline(y, true, "#555555");
      y += 8;

      // ── Código de barras + Autenticação / Ficha de Compensação ───────
      const barcodeStr = boleto.codigoBarras || "";
      if (barcodeStr) {
        const bh = 44;
        let bx   = M;
        const narrow = 1.2, wide = 2.6, gap = 0.7;
        for (let i = 0; i < barcodeStr.length && bx < M + CW * 0.58; i++) {
          const d = parseInt(barcodeStr[i], 10) || 0;
          const w = d >= 5 ? wide : narrow;
          if (i % 2 === 0) doc.rect(bx, y, w, bh).fill(BLACK);
          bx += w + gap;
        }
      }

      const atX = PW - M - 185;
      doc.font("Helvetica").fontSize(7.5).fillColor(GRAY)
         .text("Autenticação Mecânica", atX, y + 14,
               { width: 185, align: "right", lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(BLACK)
         .text("Ficha de Compensação", atX, y + 26,
               { width: 185, align: "right", lineBreak: false });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ── 2. Drive ──────────────────────────────────────────────────────────────────

const _GOOGLE_OK = () =>
  !!(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID &&
     (process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY || process.env.GOOGLE_DRIVE_REFRESH_TOKEN));

function _driveClient() {
  const { google } = require("googleapis");
  if (process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY && process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL,
        private_key:  process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    return google.drive({ version: "v3", auth });
  }
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_DRIVE_CLIENT_ID,
    process.env.GOOGLE_DRIVE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

async function _driveEnsureFolder(drive, parentId, name) {
  const safeName = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)", spaces: "drive",
  });
  if (existing.data.files?.length) return existing.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  return created.data.id;
}

async function _driveNomeBoletoPdf(drive, folderId, ano, mes, parcelaNum, contratoNum) {
  // Padrão: Boleto_Parc01_AAAAMM.pdf (identificável pelo cliente)
  // Se não houver parcela: boleto_AAAAMM.pdf (retrocompatível)
  const prefixo = parcelaNum
    ? `Boleto_Parc${String(parcelaNum).padStart(2, "0")}${contratoNum ? `_${String(contratoNum).replace(/\D/g, "").slice(-6)}` : ""}`
    : `boleto`;
  const base = `${prefixo}_${ano}${mes}`;
  const existing = await drive.files.list({
    q: `'${folderId}' in parents and name contains '${base}' and trashed = false`,
    fields: "files(name)", spaces: "drive",
  });
  const nomes = existing.data.files?.map(f => f.name) || [];
  if (!nomes.includes(`${base}.pdf`)) return `${base}.pdf`;
  for (let seq = 2; seq <= 99; seq++) {
    const candidate = `${base}_${String(seq).padStart(3, "0")}.pdf`;
    if (!nomes.includes(candidate)) return candidate;
  }
  return `${base}_${Date.now()}.pdf`;
}

async function _uploadBoletoDrive(pdfBuffer, _nomeWaEmail, boleto) {
  if (!_GOOGLE_OK()) return null;
  const drive  = _driveClient();
  const root   = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const venc   = new Date(boleto.dataVencimento);
  const ano    = String(venc.getUTCFullYear());
  const mes    = String(venc.getUTCMonth() + 1).padStart(2, "0");

  const cpfCnpj = (boleto.pagadorCpfCnpj || "").replace(/\D/g, "");
  if (!cpfCnpj) return null;

  const clientesId = await _driveEnsureFolder(drive, root, "Clientes");
  const cpfId      = await _driveEnsureFolder(drive, clientesId, cpfCnpj);
  const anoId      = await _driveEnsureFolder(drive, cpfId, ano);
  const mesId      = await _driveEnsureFolder(drive, anoId, mes);

  // Nome no Drive: Boleto_ParcNN_AAAAMM.pdf — identificável pelo cliente
  const nomeDrive = await _driveNomeBoletoPdf(
    drive, mesId, ano, mes,
    boleto.parcela?.numero,
    boleto.parcela?.contrato?.numero,
  );

  const stream = new Readable();
  stream.push(pdfBuffer);
  stream.push(null);

  const uploaded = await drive.files.create({
    requestBody: { name: nomeDrive, parents: [mesId], mimeType: "application/pdf" },
    media:       { mimeType: "application/pdf", body: stream },
    fields:      "id",
  });
  return uploaded.data.id;
}

async function _atualizarBoletoDrive(fileId, pdfBuffer) {
  if (!_GOOGLE_OK() || !fileId) return false;
  try {
    const drive  = _driveClient();
    const stream = new Readable();
    stream.push(pdfBuffer);
    stream.push(null);
    await drive.files.update({
      fileId,
      media: { mimeType: "application/pdf", body: stream },
    });
    return true;
  } catch (e) {
    console.warn(`⚠️ Drive atualizar arquivo ${fileId}:`, e.message);
    return false;
  }
}

async function _renomearBoletoDrive(fileId, novoNome) {
  if (!_GOOGLE_OK() || !fileId) return false;
  try {
    const drive = _driveClient();
    await drive.files.update({ fileId, requestBody: { name: novoNome } });
    return true;
  } catch (e) {
    console.warn(`⚠️ Drive renomear arquivo ${fileId}:`, e.message);
    return false;
  }
}

// ── 3. E-mail ao cliente ──────────────────────────────────────────────────────

async function _enviarEmailBoleto(pdfBuffer, nomeArquivo, boleto, cliente) {
  if (!cliente.email) return;
  const fmtVenc = fmtDateISO(boleto.dataVencimento);
  const primeiroNome = cliente.nomeRazaoSocial.split(" ")[0];

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <tr><td style="background:#1d4ed8;padding:20px 28px">
    <div style="color:#bfdbfe;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere · Financeiro</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">🏦 Boleto Bancário</div>
  </td></tr>
  <tr><td style="padding:24px 28px">
    <p style="margin:0 0 16px;font-size:14px;color:#334155">Olá, <strong>${primeiroNome}</strong>.</p>
    <p style="margin:0 0 16px;font-size:14px;color:#334155">
      Segue em anexo o boleto bancário no valor de <strong style="color:#1d4ed8">${fmtBRL(boleto.valorCentavos)}</strong>,
      com vencimento em <strong>${fmtVenc}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:8px;padding:0;margin:16px 0">
      <tr><td style="padding:14px 18px">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">Linha Digitável</div>
        <div style="font-family:monospace;font-size:13px;color:#0f172a;word-break:break-all">${boleto.linhaDigitavel || "—"}</div>
      </td></tr>
    </table>
    ${boleto.pixCopiaECola ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border-radius:8px;margin:0 0 16px">
      <tr><td style="padding:14px 18px">
        <div style="font-size:11px;color:#1e40af;margin-bottom:4px">Pix Copia e Cola</div>
        <div style="font-family:monospace;font-size:11px;color:#1e40af;word-break:break-all">${boleto.pixCopiaECola}</div>
      </td></tr>
    </table>` : ""}
    <p style="margin:0;font-size:12px;color:#94a3b8">Em caso de dúvidas, entre em contato com nosso escritório.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;

  await sendEmail({
    to:      cliente.email,
    subject: `Boleto Addere — vencimento ${fmtVenc}`,
    html,
    attachments: [{ filename: nomeArquivo, content: pdfBuffer }],
  });
  console.log(`📧 [Boleto #${boleto.id}] E-mail enviado → ${cliente.email}`);
}

// ── 4. WhatsApp ao cliente (documento) ───────────────────────────────────────

async function _uploadWaMedia(pdfBuffer, filename) {
  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), filename);
  const resp = await fetch(`${_waMediaBase}/${WA_PHONE_NUMBER_ID}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
    body: formData,
  });
  if (!resp.ok) throw new Error(`WA media upload: ${await resp.text()}`);
  const { id } = await resp.json();
  return id;
}

async function _enviarWaBoletoCliente(pdfBuffer, nomeArquivo, boleto, cliente) {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID || !WA_API_URL) return;
  const phone = _waPhone(cliente.telefone);
  if (!phone) return;

  const primeiroNome = cliente.nomeRazaoSocial.split(" ")[0];
  const fmtVenc = fmtDateISO(boleto.dataVencimento);

  const mediaId = await _uploadWaMedia(pdfBuffer, nomeArquivo);

  // Envia documento
  await fetch(WA_API_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to:   phone,
      type: "document",
      document: {
        id:       mediaId,
        filename: nomeArquivo,
        caption:  `Olá, ${primeiroNome}! Segue seu boleto Addere — *${fmtBRL(boleto.valorCentavos)}*, vencimento *${fmtVenc}*. Você pode pagar também via Pix usando o código anexo.`,
      },
    }),
  });
  console.log(`📱 [Boleto #${boleto.id}] WA documento enviado → ${phone}`);
}

// ── 5. WhatsApp para admins + advogados envolvidos ────────────────────────────

async function _enviarWaAdminsAdvogados(boleto, cliente, parcela) {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) return;

  const fmtVenc = fmtDateISO(boleto.dataVencimento);
  const msg = [
    `🏦 *Boleto emitido — Addere*`,
    ``,
    `👤 Cliente: ${cliente.nomeRazaoSocial}`,
    `💰 Valor: *${fmtBRL(boleto.valorCentavos)}*`,
    `📅 Vencimento: *${fmtVenc}*`,
    ...(parcela ? [`📄 Parcela #${parcela.numero} — Contrato ${parcela.contratoId}`] : []),
    ``,
    `Modo: ${boleto.modo === "mock" ? "SIMULAÇÃO" : boleto.modo.toUpperCase()}`,
  ].join("\n");

  // Admins
  const admins = await prisma.usuario.findMany({
    where: { role: "ADMIN", ativo: true },
    select: { telefone: true, whatsapp: true },
  });
  for (const a of admins) {
    const phone = _waPhone(a.whatsapp || a.telefone);
    if (phone) sendWhatsApp(phone, msg).catch(() => {});
  }

  // Advogados envolvidos na parcela (se houver splits)
  if (parcela?.id) {
    const splits = await prisma.parcelaSplitAdvogado.findMany({
      where:   { parcelaId: parcela.id },
      include: {
        advogado: {
          select: {
            telefone: true,
            usuario:  { select: { telefone: true } },
          },
        },
      },
    });
    for (const s of splits) {
      const tel   = s.advogado?.telefone || s.advogado?.usuario?.telefone;
      const phone = _waPhone(tel);
      if (phone) sendWhatsApp(phone, msg).catch(() => {});
    }
  }
}

// ── 6. Notificar admins sobre falta de dados do cliente ───────────────────────

async function _notificarFaltaDados(boleto, cliente, semEmail, semWA) {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) return;

  const itens = [
    semEmail && "e-mail",
    semWA    && "WhatsApp",
  ].filter(Boolean);

  const msg = [
    `⚠️ *Boleto emitido — envio ao cliente INCOMPLETO*`,
    ``,
    `👤 ${cliente.nomeRazaoSocial}`,
    `💰 ${fmtBRL(boleto.valorCentavos)} · vence ${fmtDateISO(boleto.dataVencimento)}`,
    ``,
    `Não foi possível enviar por *${itens.join(" e ")}* — dados ausentes no cadastro do cliente.`,
    `Atualize o cadastro e reenvie manualmente, se necessário.`,
  ].join("\n");

  const admins = await prisma.usuario.findMany({
    where: { role: "ADMIN", ativo: true },
    select: { telefone: true, whatsapp: true },
  });
  for (const a of admins) {
    const phone = _waPhone(a.whatsapp || a.telefone);
    if (phone) sendWhatsApp(phone, msg).catch(() => {});
  }
  console.log(`⚠️ [Boleto #${boleto.id}] Notificado admins sobre falta de: ${itens.join(", ")}`);
}

// ── 7. Notificações de alteração e cancelamento ───────────────────────────────

export async function notificarAlteracaoBoleto(boletoId, novaDataVencimento) {
  try {
    const boleto  = await prisma.boletInter.findUnique({ where: { id: boletoId }, include: { cliente: true } });
    if (!boleto) return;
    const cliente = boleto.cliente;
    const fmtVenc = novaDataVencimento
      ? (() => { const [y,m,d] = novaDataVencimento.split("-"); return `${d}/${m}/${y}`; })()
      : fmtDateISO(boleto.dataVencimento);
    const nomeArquivo = _nomeArquivoBoleto(cliente, boleto);

    // 1. Baixar PDF atualizado do Inter e atualizar no Drive
    let pdfBuffer = null;
    if (boleto.modo !== "mock" && boleto.codigoSolicitacao) {
      // Aguarda Inter processar a alteração antes de baixar o PDF
      await new Promise((r) => setTimeout(r, 5000));
      try {
        pdfBuffer = await baixarPdfInter(boleto.codigoSolicitacao);
        if (pdfBuffer?.[0] === 0x7B) { // JSON
          const json = JSON.parse(pdfBuffer.toString("utf8"));
          const b64  = json.pdf || json.base64 || json.content;
          if (b64) pdfBuffer = Buffer.from(b64, "base64");
        }
      } catch (e) {
        console.warn(`⚠️ [Boleto #${boletoId}] PDF atualizado não disponível: ${e.message}`);
      }

      if (pdfBuffer && boleto.pdfUrl) {
        const ok = await _atualizarBoletoDrive(boleto.pdfUrl, pdfBuffer);
        if (ok) console.log(`📁 [Boleto #${boletoId}] Drive atualizado com novo vencimento`);
      }
    }

    const msg = [
      `📅 *Vencimento alterado — Addere*`,
      ``,
      `👤 Cliente: ${cliente?.nomeRazaoSocial || boleto.pagadorNome}`,
      `💰 Valor: *${fmtBRL(boleto.valorCentavos)}*`,
      `📅 Novo vencimento: *${fmtVenc}*`,
      `📄 ${boleto.docNum || boleto.seuNumero}`,
    ].join("\n");

    // WA admins
    const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { telefone: true } });
    for (const a of admins) {
      const phone = _waPhone(a.telefone);
      if (phone) sendWhatsApp(phone, msg).catch(() => {});
    }

    // WA cliente (texto + novo PDF se disponível)
    if (cliente?.telefone) {
      const phone = _waPhone(cliente.telefone);
      if (phone) {
        if (pdfBuffer) {
          _enviarWaBoletoCliente(pdfBuffer, nomeArquivo, boleto, cliente).catch(() => {});
        } else {
          sendWhatsApp(phone, msg).catch(() => {});
        }
      }
    }

    // E-mail cliente com novo PDF anexado
    if (cliente?.email) {
      const primeiroNome = (cliente.nomeRazaoSocial || "").split(" ")[0];
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <tr><td style="background:#1d4ed8;padding:20px 28px">
    <div style="color:#bfdbfe;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere · Financeiro</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">📅 Vencimento Alterado</div>
  </td></tr>
  <tr><td style="padding:24px 28px;font-size:14px;color:#334155">
    <p style="margin:0 0 16px">Olá, <strong>${primeiroNome}</strong>.</p>
    <p style="margin:0 0 16px">O vencimento do seu boleto <strong>${boleto.docNum || boleto.seuNumero}</strong> foi alterado para <strong>${fmtVenc}</strong>.</p>
    <p style="margin:0 0 16px">Valor: <strong style="color:#1d4ed8">${fmtBRL(boleto.valorCentavos)}</strong></p>
    ${pdfBuffer ? `<p style="margin:0 0 16px;font-size:13px;color:#1d4ed8">O boleto atualizado está em anexo.</p>` : ""}
    <p style="margin:0;font-size:12px;color:#94a3b8">Em caso de dúvidas, entre em contato com Addere.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
      await sendEmail({
        to:      cliente.email,
        subject: `Addere — Vencimento alterado para ${fmtVenc}`,
        html,
        ...(pdfBuffer ? { attachments: [{ filename: nomeArquivo, content: pdfBuffer }] } : {}),
      }).catch(() => {});
    }

    console.log(`📅 [Boleto #${boletoId}] Notificações de alteração enviadas`);
  } catch (e) {
    console.error(`⚠️ [Boleto #${boletoId}] notificarAlteracaoBoleto:`, e.message);
  }
}

export async function notificarCancelamentoBoleto(boletoId) {
  try {
    const boleto  = await prisma.boletInter.findUnique({ where: { id: boletoId }, include: { cliente: true } });
    if (!boleto) return;
    const cliente = boleto.cliente;

    const msg = [
      `❌ *Boleto cancelado — Addere*`,
      ``,
      `👤 Cliente: ${cliente?.nomeRazaoSocial || boleto.pagadorNome}`,
      `💰 Valor: *${fmtBRL(boleto.valorCentavos)}*`,
      `📅 Vencimento: ${fmtDateISO(boleto.dataVencimento)}`,
      `📄 ${boleto.docNum || boleto.seuNumero}`,
    ].join("\n");

    // WA admins
    const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { telefone: true } });
    for (const a of admins) {
      const phone = _waPhone(a.telefone);
      if (phone) sendWhatsApp(phone, msg).catch(() => {});
    }

    // WA + e-mail cliente
    if (cliente?.telefone) {
      const phone = _waPhone(cliente.telefone);
      if (phone) sendWhatsApp(phone, msg).catch(() => {});
    }
    if (cliente?.email) {
      const primeiroNome = (cliente.nomeRazaoSocial || "").split(" ")[0];
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <tr><td style="background:#dc2626;padding:20px 28px">
    <div style="color:#fecaca;font-size:11px;letter-spacing:2px;text-transform:uppercase">Addere · Financeiro</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">Boleto Cancelado</div>
  </td></tr>
  <tr><td style="padding:24px 28px;font-size:14px;color:#334155">
    <p style="margin:0 0 16px">Olá, <strong>${primeiroNome}</strong>.</p>
    <p style="margin:0 0 16px">O boleto <strong>${boleto.docNum || boleto.seuNumero}</strong> no valor de <strong>${fmtBRL(boleto.valorCentavos)}</strong>, com vencimento em <strong>${fmtDateISO(boleto.dataVencimento)}</strong>, foi cancelado.</p>
    <p style="margin:0;font-size:12px;color:#94a3b8">Em caso de dúvidas, entre em contato com Addere.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
      await sendEmail({ to: cliente.email, subject: `Addere — Boleto cancelado`, html }).catch(() => {});
    }

    // Renomear arquivo no Drive para indicar cancelamento
    if (boleto.pdfUrl) {
      const nomeOriginal = _nomeArquivoBoleto(cliente, boleto);
      const nomeCancelado = `CANCELADO_${nomeOriginal}`;
      const ok = await _renomearBoletoDrive(boleto.pdfUrl, nomeCancelado);
      if (ok) console.log(`📁 [Boleto #${boletoId}] Drive renomeado para ${nomeCancelado}`);
    }

    console.log(`❌ [Boleto #${boletoId}] Notificações de cancelamento enviadas`);
  } catch (e) {
    console.error(`⚠️ [Boleto #${boletoId}] notificarCancelamentoBoleto:`, e.message);
  }
}

// ── Orquestrador público ──────────────────────────────────────────────────────

export async function processarPosBoleto(boletoId) {
  try {
    const boleto = await prisma.boletInter.findUnique({
      where:   { id: boletoId },
      include: {
        cliente: true,
        parcela: {
          include: {
            contrato: { select: { numero: true } },
            splits: {
              include: {
                advogado: {
                  select: {
                    telefone: true,
                    usuario:  { select: { telefone: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!boleto) return;

    // Boletos mock não geram Drive/e-mail/WA — apenas log
    if (boleto.modo === "mock") {
      console.log(`⏭️ [Boleto #${boletoId}] Modo mock — pós-processamento ignorado`);
      return;
    }

    const cliente      = boleto.cliente;
    const nomeArquivo  = _nomeArquivoBoleto(cliente, boleto);

    // 1. Obter PDF
    //    Produção/sandbox → baixar PDF oficial do Inter (tem QR Code, código de barras, linha digitável)
    //    Mock → gerar localmente via PDFKit (apenas para testes internos)
    let pdfBuffer;
    try {
      if (boleto.modo !== "mock" && boleto.codigoSolicitacao) {
        // Tenta até 3x com 5s de intervalo — PDF pode não estar pronto imediatamente
        for (let t = 1; t <= 3; t++) {
          try {
            pdfBuffer = await baixarPdfInter(boleto.codigoSolicitacao);
            if (pdfBuffer && pdfBuffer.length > 0) break;
            throw new Error("vazio");
          } catch (e) {
            if (t === 3) throw new Error(`PDF Inter indisponível após 3 tentativas: ${e.message}`);
            console.log(`⏳ [Boleto #${boletoId}] PDF tentativa ${t}/3 — aguardando 5s...`);
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
        console.log(`📄 [Boleto #${boletoId}] PDF baixado do Inter (${pdfBuffer.length} bytes)`);
      } else {
        pdfBuffer = await _gerarPdfBoleto(boleto, cliente);
      }
    } catch (e) {
      console.error(`❌ [Boleto #${boletoId}] PDF:`, e.message);
      return; // sem PDF, não avança
    }

    // 2. Salvar no Drive (assíncrono, não bloqueia)
    let driveFileId = null;
    try {
      driveFileId = await _uploadBoletoDrive(pdfBuffer, nomeArquivo, boleto);
      if (driveFileId) {
        await prisma.boletInter.update({
          where: { id: boletoId },
          data:  { pdfUrl: driveFileId },
        });
        console.log(`📁 [Boleto #${boletoId}] Salvo no Drive: ${nomeArquivo}`);
      }
    } catch (e) {
      console.error(`⚠️ [Boleto #${boletoId}] Drive upload:`, e.message);
    }

    // 3–4. E-mail + WA ao cliente
    const semEmail = !cliente.email;
    const semWA    = !_waPhone(cliente.telefone);

    if (!semEmail) {
      _enviarEmailBoleto(pdfBuffer, nomeArquivo, boleto, cliente)
        .catch((e) => console.error(`⚠️ [Boleto #${boletoId}] E-mail:`, e.message));
    }

    if (!semWA) {
      _enviarWaBoletoCliente(pdfBuffer, nomeArquivo, boleto, cliente)
        .catch((e) => console.error(`⚠️ [Boleto #${boletoId}] WA cliente:`, e.message));
    }

    // 5. WA para admins + advogados
    _enviarWaAdminsAdvogados(boleto, cliente, boleto.parcela)
      .catch((e) => console.error(`⚠️ [Boleto #${boletoId}] WA admins:`, e.message));

    // 6. Notificar admins se faltam dados
    if (semEmail || semWA) {
      _notificarFaltaDados(boleto, cliente, semEmail, semWA)
        .catch((e) => console.error(`⚠️ [Boleto #${boletoId}] Notif falta dados:`, e.message));
    }

    console.log(`✅ [Boleto #${boletoId}] Pós-processamento iniciado`);
  } catch (e) {
    console.error(`❌ [Boleto #${boletoId}] processarPosBoleto:`, e.message);
  }
}
