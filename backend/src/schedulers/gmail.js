import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppTemplate } from "../lib/whatsapp.js";
import { createRequire } from "module";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker as _tesseractCreateWorker } from "tesseract.js";

const require = createRequire(import.meta.url);

const IS_TEST = process.env.NODE_ENV === "test";

// ── WhatsApp config ──────────────────────────────────────────────────────────
const WA_API_URL = process.env.WA_PHONE_NUMBER_ID
  ? `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  : null;
const WA_TOKEN = process.env.WA_TOKEN || null;

// ── Phone normalizer (E.164 for WA) ─────────────────────────────────────────
function _waPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return "55" + digits;
  return digits.length >= 8 ? "55" + digits : null;
}

/** Extrai texto de imagem PNG/JPG via OCR (Tesseract, idioma pt) */
async function _extrairTextoImagem(buf) {
  const worker = await _tesseractCreateWorker("por");
  try {
    const { data: { text } } = await worker.recognize(buf);
    return text || "";
  } finally {
    await worker.terminate();
  }
}

// ============================================================
// GMAIL POLLER — monitoramento de respostas de clientes
// Roda a cada 10 minutos; pula silenciosamente se não houver credenciais
// ============================================================

export function startGmailScheduler() {
  const GMAIL_CFG_OK =
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN &&
    process.env.GMAIL_USER;

  if (!GMAIL_CFG_OK) {
    console.log("ℹ️  Gmail poller desativado — configure GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN no .env");
    return;
  }

  const { google } = require("googleapis");

  const _gmailOAuth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  _gmailOAuth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const _gmail = google.gmail({ version: "v1", auth: _gmailOAuth2 });

  // Decodifica base64url → Buffer
  function _b64Decode(str) {
    return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }

  // Extrai texto e anexos de uma mensagem Gmail (estrutura MIME recursiva)
  function _parseParts(parts = [], result = { text: "", html: "", anexos: [] }) {
    for (const part of parts) {
      if (part.parts) {
        _parseParts(part.parts, result);
      } else if (part.mimeType === "text/plain" && part.body?.data) {
        result.text += _b64Decode(part.body.data).toString("utf-8");
      } else if (part.mimeType === "text/html" && part.body?.data) {
        result.html += _b64Decode(part.body.data).toString("utf-8");
      } else if (part.filename && part.body?.attachmentId) {
        result.anexos.push({
          nome: part.filename,
          mime: part.mimeType || "application/octet-stream",
          attachmentId: part.body.attachmentId,
        });
      }
    }
    return result;
  }

  // Extrai valor de um header pelo nome
  function _header(headers, name) {
    return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || null;
  }

  // Extrai e-mail limpo de "Nome Sobrenome <email@x.com>"
  function _extractEmail(str) {
    if (!str) return null;
    const m = str.match(/<([^>]+)>/);
    return m ? m[1].toLowerCase() : str.toLowerCase().trim();
  }

  function _norm(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function _htmlToText(html) {
    return String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, "\"")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function _toCentavos(valorStr) {
    if (!valorStr) return 0;
    const clean = String(valorStr).replace(/\u00A0/g, " ").replace(/[^\d,.\s]/g, "").replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number.parseFloat(clean);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  function _parseDateBr(dateBr) {
    if (!dateBr) return null;
    const m = String(dateBr).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    return {
      dataISO: `${yyyy}-${mm}-${dd}`,
      compAno: Number.parseInt(yyyy, 10),
      compMes: Number.parseInt(mm, 10),
    };
  }

  function _detectarBancoOrigemEmail(remetenteEmail, fromRaw) {
    const from = String(fromRaw || "");
    const sender = String(remetenteEmail || "");

    if (/@(?:.*\.)?inter\.co$/i.test(sender)) return "INTER";
    if (/@(?:.*\.)?santander\./i.test(sender)) return "SANTANDER";
    if (/santander/i.test(from) && /@/i.test(sender)) return "SANTANDER";
    return null;
  }

  function _parseAlertaBancoEmail({ bancoOrigem, assunto, corpoTexto, recebidoEm }) {
    if (!bancoOrigem) return null;

    const texto = `${assunto || ""}\n${corpoTexto || ""}`.trim();
    if (!texto) return null;
    const textoNorm = _norm(texto);

    if (!/(pix|ted|transferenc|pagamento)/.test(textoNorm)) return null;

    let esSugerido = null;
    if (
      /(pix|ted|transferenc|pagamento).*(recebid|entrada|credito)|recebeu um pix|pix recebido|transferencia recebida|ted recebida/.test(textoNorm)
    ) {
      esSugerido = "E";
    }
    if (
      !esSugerido &&
      /(pix|ted|transferenc|pagamento).*(enviad|realizad|saida|debito)|foi realizado um pagamento|pagamento pix realizado|pix enviado|transferencia enviada|ted enviada|ted realizada/.test(textoNorm)
    ) {
      esSugerido = "S";
    }
    if (!esSugerido) return null;

    const mValor =
      texto.match(/valor(?:\s+de)?\s*R\$\s*([\d.\u00A0 ]+,\d{2})/i) ||
      texto.match(/R\$\s*([\d.\u00A0 ]+,\d{2})/i);
    const valorCentavos = _toCentavos(mValor?.[1]);
    if (!valorCentavos) return null;

    const mData =
      texto.match(/[Dd]ata\s*:\s*(\d{2}\/\d{2}\/\d{4})/) ||
      texto.match(/[Ee]m\s*(\d{2}\/\d{2}\/\d{4})/) ||
      texto.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
    const parsedData = _parseDateBr(mData?.[1]);
    const dataISO = parsedData?.dataISO || new Date(recebidoEm || new Date()).toISOString().slice(0, 10);
    const compAno = parsedData?.compAno || Number.parseInt(dataISO.slice(0, 4), 10);
    const compMes = parsedData?.compMes || Number.parseInt(dataISO.slice(5, 7), 10);

    const mNome = texto.match(/[Nn]ome\s*:\s*(.+?)(?:\n|CPF\/CNPJ|CPF|CNPJ|Data:|ID\s+Transa)/s);
    const mBanco = texto.match(/[Bb]anco\s*:\s*(.+?)(?:\n|Nome:|CPF\/CNPJ|CPF|CNPJ|Data:|ID\s+Transa)/s);
    const mIdTx = texto.match(/ID\s*(?:da\s*)?[Tt]ransa\S{0,12}\s*:\s*([A-Za-z0-9]+)/);

    // Inter body format: "Você recebeu um Pix no valor de R$ X de NOME, na conta NNNN."
    // or "Você enviou um Pix no valor de R$ X para/de NOME, na conta NNNN."
    const mInterParte =
      texto.match(/recebeu\s+um\s+pix\s+no\s+valor\s+de\s+R\$\s*[\d.\u00A0 ]+,\d{2}\s+de\s+(.+?),\s*na\s+conta/i) ||
      texto.match(/enviou\s+um\s+pix\s+no\s+valor\s+de\s+R\$\s*[\d.\u00A0 ]+,\d{2}\s+(?:de|para)\s+(.+?),\s*na\s+conta/i);

    const parteNome =
      mInterParte?.[1]?.replace(/\s+/g, " ").trim() ||
      mNome?.[1]?.replace(/\s+/g, " ").trim() ||
      null;
    const bancoDestino = mBanco?.[1]?.replace(/\s+/g, " ").trim() || null;
    const transacaoId = mIdTx?.[1] || null;

    const bancoLabel = bancoOrigem === "INTER" ? "Banco Inter" : "Banco Santander";
    const tipoLabel = esSugerido === "E" ? "Entrada" : "Saida";
    const historicoBase = `${tipoLabel} via ${bancoLabel} (e-mail)`;
    const historicoDetalhe = [parteNome, bancoDestino].filter(Boolean).join(" - ");
    const historico = [historicoBase, historicoDetalhe].filter(Boolean).join(" - ").slice(0, 255);

    return {
      bancoOrigem,
      bancoLabel,
      dataISO,
      compAno,
      compMes,
      valorCentavos,
      esSugerido,
      parteNome,
      bancoDestino,
      transacaoId,
      historico,
    };
  }

  async function _findContaBancoId(bancoOrigem) {
    const contas = await prisma.livroCaixaConta.findMany({
      where: { ativa: true },
      select: { id: true, nome: true },
      orderBy: { ordem: "asc" },
    });
    const key = bancoOrigem === "INTER" ? "inter" : "santander";
    const prefer = bancoOrigem === "INTER" ? "banco inter" : "banco santander";
    const byPrefer = contas.find(c => _norm(c.nome).includes(prefer));
    if (byPrefer) return byPrefer.id;
    const byKey = contas.find(c => _norm(c.nome).includes(key));
    return byKey?.id || null;
  }

  function _ehLocalClientes(lancamento) {
    const localNome = lancamento?.conta?.nome || lancamento?.localLabelFallback || "";
    return _norm(localNome).includes("clientes");
  }

  async function _processarAlertaBancoEmail({ msgId, remetenteEmail, assunto, corpoTexto, recebidoEm, bancoOrigem }) {
    const dados = _parseAlertaBancoEmail({ bancoOrigem, assunto, corpoTexto, recebidoEm });
    if (!dados) return false;

    const refOrigem = dados.transacaoId ? `PIX_${dados.transacaoId}` : `PIX_GMAIL_${msgId}_BANK_${bancoOrigem}`;
    const dataLC = new Date(`${dados.dataISO}T12:00:00Z`);

    const porReferencia = await prisma.livroCaixaLancamento.findFirst({
      where: { referenciaOrigem: refOrigem },
      include: { conta: { select: { id: true, nome: true } } },
    });
    if (porReferencia?.statusFluxo === "EFETIVADO") {
      const localDefinido = !!porReferencia.contaId || _ehLocalClientes(porReferencia);
      const updateData = {};
      if (!localDefinido) {
        // Ainda sem conta — segundo e-mail chegou, tenta resolver a conta agora
        const contaBancoIdResolved = await _findContaBancoId(bancoOrigem);
        if (contaBancoIdResolved) {
          updateData.contaId = contaBancoIdResolved;
          updateData.localLabelFallback = null;
          updateData.status = "OK";
        }
      } else if (porReferencia.status !== "OK") {
        updateData.status = "OK";
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.livroCaixaLancamento.update({ where: { id: porReferencia.id }, data: updateData });
      }
      console.log(`📬 Banco alert [${msgId}]: lançamento já confirmado no LC (#${porReferencia.id}) — ignorado`);
      return true;
    }

    const contaBancoId = await _findContaBancoId(bancoOrigem);
    const dtMin = new Date(dataLC.getTime() - 3 * 24 * 60 * 60 * 1000);
    const dtMax = new Date(dataLC.getTime() + 3 * 24 * 60 * 60 * 1000);

    const candidatos = porReferencia ? [porReferencia] : await prisma.livroCaixaLancamento.findMany({
      where: {
        es: dados.esSugerido,
        valorCentavos: dados.valorCentavos,
        data: { gte: dtMin, lte: dtMax },
      },
      include: { conta: { select: { id: true, nome: true } } },
      orderBy: { data: "asc" },
      take: 10,
    });

    const confirmado = candidatos.find(l => l.statusFluxo === "EFETIVADO");
    if (confirmado) {
      if (!confirmado.referenciaOrigem) {
        await prisma.livroCaixaLancamento.update({
          where: { id: confirmado.id },
          data: { referenciaOrigem: refOrigem },
        });
      }
      console.log(`📬 Banco alert [${msgId}]: já existe lançamento confirmado no LC (#${confirmado.id}) — ignorado`);
      return true;
    }

    const pendente = candidatos[0] || null;
    if (pendente) {
      const manterClientes = _ehLocalClientes(pendente);
      const temLocalExistente = !!pendente.contaId || !!pendente.localLabelFallback || manterClientes;
      const dataUpdate = {
        statusFluxo: "EFETIVADO",
        data: dataLC,
        competenciaAno: dados.compAno,
        competenciaMes: dados.compMes,
        referenciaOrigem: refOrigem,
        status: "PENDENTE_CONTA",
      };

      if (!manterClientes) {
        if (contaBancoId) {
          dataUpdate.contaId = contaBancoId;
          dataUpdate.localLabelFallback = null;
          dataUpdate.status = "OK";
        } else {
          dataUpdate.contaId = null;
          dataUpdate.localLabelFallback = dados.bancoLabel;
        }
      } else if (temLocalExistente) {
        dataUpdate.status = "OK";
      }

      await prisma.livroCaixaLancamento.update({
        where: { id: pendente.id },
        data: dataUpdate,
      });
      console.log(`📬 Banco alert [${msgId}]: LC #${pendente.id} confirmado (${dados.bancoLabel})`);
      await _notificarAlertaBanco({ dados, bancoOrigem, remetenteEmail, confirmado: true });
      return true;
    }

    await prisma.livroCaixaLancamento.create({
      data: {
        competenciaAno: dados.compAno,
        competenciaMes: dados.compMes,
        data: dataLC,
        es: dados.esSugerido,
        clienteFornecedor: dados.parteNome || remetenteEmail,
        historico: dados.historico,
        valorCentavos: dados.valorCentavos,
        contaId: contaBancoId,
        origem: "PIX_EMAIL",
        referenciaOrigem: refOrigem,
        status: contaBancoId ? "OK" : "PENDENTE_CONTA",
        statusFluxo: "EFETIVADO",
        localLabelFallback: contaBancoId ? null : dados.bancoLabel,
      },
    });

    console.log(`📬 Banco alert [${msgId}]: novo lançamento criado e confirmado (${dados.bancoLabel})`);
    await _notificarAlertaBanco({ dados, bancoOrigem, remetenteEmail, confirmado: false });
    return true;
  }

  async function _notificarAlertaBanco({ dados, bancoOrigem, remetenteEmail, confirmado }) {
    try {
      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { id: true, email: true, nome: true, whatsapp: true, telefone: true },
      });
      const sistemaId = admins[0]?.id;
      const valFmt   = (dados.valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const esLabel  = dados.esSugerido === "E" ? "Entrada" : "Saída";
      const banco    = bancoOrigem === "INTER" ? "Banco Inter" : "Banco Santander";
      const parte    = dados.parteNome || remetenteEmail;
      const dataFmt  = dados.dataISO ? dados.dataISO.split("-").reverse().join("/") : "—";
      const acao     = confirmado ? "✅ LC existente confirmado" : "🆕 Novo lançamento criado";

      const waMsg = `🏦 *Alerta ${banco}*\n*${esLabel}* ${valFmt} — ${dataFmt}\n${parte}\n${dados.historico}\n${acao}`;
      const chatMsg = `🏦 Alerta ${banco} processado\n${esLabel} ${valFmt} — ${dataFmt}\n${parte}\n${dados.historico}\n${acao}`;
      const emailHtml = `<p style="font-family:sans-serif">
        <strong>🏦 Alerta ${banco}</strong><br><br>
        <b>${esLabel}</b> ${valFmt} — ${dataFmt}<br>
        Parte: ${parte}<br>
        Histórico: ${dados.historico}<br><br>
        ${acao}
      </p>`;

      await Promise.allSettled(admins.map(async admin => {
        await sendEmail({ to: admin.email, subject: `🏦 ${banco} — ${esLabel} ${valFmt} — ${parte}`, html: emailHtml }).catch(() => {});
        if (sistemaId) prisma.mensagemChat.create({ data: { remetenteId: sistemaId, destinatarioId: admin.id, conteudo: chatMsg, tipoMensagem: "CHAT" } }).catch(() => {});
        const phone = _waPhone(admin.whatsapp || admin.telefone);
        if (phone) await sendWhatsApp(phone, waMsg).catch(() => {});
      }));
    } catch (e) {
      console.log(`📬 _notificarAlertaBanco erro: ${e.message}`);
    }
  }

  // Extrai data de pagamento de texto livre (assunto, corpo, PDF)
  function _extrairDataPagamento(assunto, corpoTexto, pdfTexto = "") {
    const texto = [assunto, corpoTexto, pdfTexto].join(" ");
    const matches = [...texto.matchAll(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})\b/g)];
    const limite = new Date(Date.now() + 7 * 86400000); // até 7 dias no futuro
    const validas = matches.map(m => {
      let ano = parseInt(m[3]); if (ano < 100) ano += 2000;
      const d = new Date(ano, parseInt(m[2]) - 1, parseInt(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }).filter(d => d && d <= limite && d.getFullYear() >= 2020);
    if (!validas.length) return null;
    return validas.sort((a, b) => b - a)[0];
  }

  // Extrai texto plano de PDF (buffer). Tenta sem senha; se protegido,
  // tenta com os 6 primeiros dígitos do CNPJ da firma (padrão Inter).
  const _PDF_SENHAS_FALLBACK = ["276785"]; // CNPJ_FIRMA slice(0,6)
  async function _extrairTextoPdf(buf, senha = null) {
    try {
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const opts = { data: new Uint8Array(ab), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true };
      const loadingTask = pdfjsLib.getDocument(opts);
      if (senha) {
        loadingTask.onPassword = (cb) => cb(senha);
      } else {
        // Tenta automaticamente com senhas fallback
        let _tentativa = 0;
        loadingTask.onPassword = (cb, reason) => {
          if (reason === 1 && _tentativa < _PDF_SENHAS_FALLBACK.length) {
            cb(_PDF_SENHAS_FALLBACK[_tentativa++]);
          } else {
            cb(""); // desiste
          }
        };
      }
      const pdf = await loadingTask.promise;
      let text = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(" ") + "\n";
      }
      return text;
    } catch { return ""; }
  }

  // Encontra parcela em aberto do cliente mais próxima da data de pagamento (limite: 60 dias)
  async function _matchParcelaMaisProxima(clienteId, dataPagamento) {
    const parcelas = await prisma.parcelaContrato.findMany({
      where: { status: { in: ["PREVISTA", "ATRASADA"] }, contrato: { clienteId } },
      select: { id: true, vencimento: true, valorPrevisto: true, numero: true, contratoId: true },
      orderBy: { vencimento: "asc" },
    });
    if (!parcelas.length) return null;
    const dtMs = dataPagamento.getTime();
    let melhor = null, menorDiff = Infinity;
    for (const p of parcelas) {
      const diff = Math.abs(new Date(p.vencimento).getTime() - dtMs) / 86400000;
      if (diff < menorDiff) { menorDiff = diff; melhor = p; }
    }
    return menorDiff <= 60 ? melhor : null;
  }

  // ── Boleto helpers ──────────────────────────────────────────────────────

  /** Extrai campos de boleto de texto plano de PDF. Mesma lógica do route parse-pdf. */
  function _parseBoletoText(texto) {
    let linha = null;
    const reBanco = /\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14}/;
    const mBanco = texto.match(reBanco);
    if (mBanco) linha = mBanco[0].replace(/\D/g, "");
    if (!linha) {
      const reCon = /\d{10,12}[-\s]\d{1}\s+\d{10,12}[-\s]\d{1}\s+\d{10,12}[-\s]\d{1}\s+\d{10,12}[-\s]\d{1}/;
      const mCon = texto.match(reCon);
      if (mCon) linha = mCon[0].replace(/\D/g, "");
    }
    if (!linha) {
      const seqs = texto.match(/\d{44,48}/g) || [];
      if (seqs.length) linha = seqs[0];
    }

    const mVenc = texto.match(/[Vv]encimento[:\s]+(\d{2}[-\/]\d{2}[-\/]\d{4})/);
    let vencimento = null;
    if (mVenc) { const p = mVenc[1].split(/[-\/]/); vencimento = `${p[2]}-${p[1]}-${p[0]}`; }

    let valorCentavos = 0;
    const mValorLabel = texto.match(/(?:VALOR|[Vv]alor\s+(?:do\s+)?(?:documento|boleto)?)\s*[:\s]\s*R?\$?\s*([\d.]+,\d{2})/);
    if (mValorLabel) { valorCentavos = Math.round(parseFloat(mValorLabel[1].replace(/\./g,"").replace(",",".")) * 100); }
    if (!valorCentavos) {
      const mValor = texto.match(/R\$\s*([\d.]+,\d{2})/);
      if (mValor) { valorCentavos = Math.round(parseFloat(mValor[1].replace(/\./g,"").replace(",",".")) * 100); }
    }

    let pagador = null, cpfCnpjPagador = null;
    const mPag = texto.match(/PAGADOR[:\s]+([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s]+?)\s*[:\s\/]\s*(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (mPag) { pagador = mPag[1].trim(); cpfCnpjPagador = mPag[2].trim(); }
    else {
      const mPN = texto.match(/PAGADOR[:\s]+([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s]{5,60})/);
      if (mPN) pagador = mPN[1].trim();
    }

    let beneficiario = null, cnpjBeneficiario = null;
    // Padrão 1: "Nome Empresa - 48.744.127/0001-41"
    const mBenef = texto.match(/([A-Za-zÀ-ú\s&.]+)\s*[-–]\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (mBenef) { beneficiario = mBenef[1].trim(); cnpjBeneficiario = mBenef[2].trim(); }
    // Padrão 2: seção BENEFICIÁRIO/FAVORECIDO/CEDENTE com CNPJ na linha seguinte ou próxima
    if (!cnpjBeneficiario) {
      const mBenef2 = texto.match(/(?:BENEFICI[AÁ]RIO|FAVORECIDO|CEDENTE)[^\n]*\n([^\n]{3,80})\n[^\n]*?(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
      if (mBenef2) { beneficiario = mBenef2[1].trim(); cnpjBeneficiario = mBenef2[2].trim(); }
    }
    // Padrão 3: CNPJ da firma aparece em qualquer contexto de beneficiário no documento
    if (!cnpjBeneficiario && /27\.678\.566\/0001-23|27678566000123/.test(texto)) {
      cnpjBeneficiario = "48.744.127/0001-41";
    }

    let numeroDocumento = null;
    const mNDoc = texto.match(/[Nn][\u00BA\u00B0°o]\s*(?:[Dd]o\s+)?[Dd]ocumento\s*[:\s]*(\d+)/);
    if (mNDoc) numeroDocumento = mNDoc[1].trim();

    let intermediario = null;
    const mInter = texto.match(/INTERMEDIADO\s+POR\s*[:\s]+(.+?)\s+\d{2}\.\d{3}\.\d{3}/);
    if (mInter) intermediario = mInter[1].trim();
    if (!intermediario) {
      const mCed = texto.match(/[Cc]edente\s+([A-Z][A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s\-\.]+(?:SA|S\.A\.?|PAGAMENTO))/);
      if (mCed) intermediario = mCed[1].trim();
    }

    const CNPJ_FIRMA = "27678566000123";
    let esSugerido = null;
    if (cnpjBeneficiario) esSugerido = cnpjBeneficiario.replace(/\D/g,"") === CNPJ_FIRMA ? "E" : "S";

    return { linha, vencimento, valorCentavos, pagador, cpfCnpjPagador, beneficiario, cnpjBeneficiario, numeroDocumento, intermediario, esSugerido };
  }

  /** Encontra conta pelo nome do banco/intermediário (match direto + aliases). */
  const _BANCO_ALIASES = [
    { from: "CELCOIN", keywords: ["VRDE", "CEL"] },
    { from: "SICOOB",  keywords: ["SICOOB"] },
    { from: "SICREDI", keywords: ["SICREDI"] },
  ];
  function _findContaByBancoDB(intermediario, contas) {
    if (!intermediario || !contas?.length) return null;
    const inter = String(intermediario).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    for (const conta of contas) {
      const nome = String(conta.nome).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      if (inter.split(/\s+/).filter(w => w.length >= 4).some(w => nome.includes(w))) return conta.id;
      for (const alias of _BANCO_ALIASES) {
        if (inter.includes(alias.from) && alias.keywords.some(k => nome.includes(k))) return conta.id;
      }
    }
    return null;
  }

  /** Detecta e extrai dados de NFS-e Municipal (Prefeitura de Belém e outros municípios) */
  function _parseNFSeText(texto) {
    if (!/NOTA FISCAL DE SERVI[CÇ]OS ELETR[ÔO]NICA|NFS-?e\b/i.test(texto)) return null;
    const CNPJ_FIRMA = "27678566000123";
    const mNum   = texto.match(/[Nn]úmero\s+da\s+[Nn]ota\s*:?\s*0*(\d+)/);
    const mData  = texto.match(/[Ee]miss[ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/);
    const mComp  = texto.match(/[Cc]ompet[eê]ncia\s*:?\s*(\d{2})\/(\d{4})/);
    const mValor = texto.match(/VALOR\s+TOTAL\s+DA\s+NOTA\s*=?\s*R?\$?\s*([\d.]+,\d{2})/i)
                || texto.match(/Valor\s+(?:Total|L[íi]quido)\s*[:\s=]*R?\$?\s*([\d.]+,\d{2})/i);
    const numeroNota = mNum ? mNum[1] : null;
    let dataISO = null, compAno = null, compMes = null;
    if (mData) { const [dd,mm,yyyy] = mData[1].split("/"); dataISO = `${yyyy}-${mm}-${dd}`; }
    if (mComp) { compMes = parseInt(mComp[1]); compAno = parseInt(mComp[2]); }
    else if (dataISO) { compAno = parseInt(dataISO.slice(0,4)); compMes = parseInt(dataISO.slice(5,7)); }
    const valorCentavos = mValor ? Math.round(parseFloat(mValor[1].replace(/\./g,"").replace(",",".")) * 100) : 0;
    // Extrai nomes na ordem: prestador [0], tomador [1]
    const reNome = /Nome\s*\/?\s*Raz[ãa]o\s+Social\s*:?\s*(.+?)\s+(?=CPF|Inscri|Email|Endere)/gi;
    const nomes  = [...texto.matchAll(reNome)].map(m => m[1].trim());
    const reCNPJ = /CPF\s*\/?\s*CNPJ\s*:?\s*([\d.\/\-]+)/gi;
    const cnpjs  = [...texto.matchAll(reCNPJ)].map(m => m[1].replace(/\D/g,""));
    const prestadorCNPJ = cnpjs[0] || null;
    const tomadorCNPJ   = cnpjs[1] || null;
    const esSugerido = tomadorCNPJ === CNPJ_FIRMA ? "S" : "E";
    const parteNome  = esSugerido === "E" ? (nomes[1] || null) : (nomes[0] || null);
    if (!valorCentavos || !compAno) return null;
    return { numeroNota, dataISO, compAno, compMes, valorCentavos, esSugerido, parteNome };
  }

  /** Detecta e extrai dados de comprovante PIX/TED */
  function _parseComprovantePixText(texto) {
    const mTipo = texto.match(/Pix\s+(enviado|recebido)|TED\s+(enviada?|recebida?|realizada?)|Transfer[eê]ncia\s+(enviada?|recebida?|banc[áa]ria)/i);
    if (!mTipo) return null;
    const CNPJ_FIRMA = "27678566000123";
    // Direção inicial pelo título (enviado/TED enviada = Saída; recebido = Entrada)
    const tituloStr = mTipo[0].toLowerCase();
    let esSugerido = /enviado|enviada|realizada/.test(tituloStr) ? "S" : "E";
    const mValor = texto.match(/R\$\s*([\d.]+,\d{2})/);
    const valorCentavos = mValor ? Math.round(parseFloat(mValor[1].replace(/\./g,"").replace(",",".")) * 100) : 0;
    // Data: "Data da transação: dd/mm/yyyy" OU "Quando\ndd/mm/yyyy" OU "Data:\ndd/mm/yyyy"
    const mData = texto.match(/[Dd]ata\s+da\s+transa[çc][ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/)
               || texto.match(/[Qq]uando\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/)
               || texto.match(/[Dd]ata\s*:?\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/);
    let dataISO = null, compAno = null, compMes = null;
    if (mData) { const [dd,mm,yyyy] = mData[1].split("/"); dataISO = `${yyyy}-${mm}-${dd}`; compAno = parseInt(yyyy); compMes = parseInt(mm); }
    const mId   = texto.match(/ID\s+da\s+transa[çc][ãa]o\s*:?\s*([A-Za-z0-9]+)/);
    const mDesc = texto.match(/[Dd]escri[çc][ãa]o\s*:?\s*\n?\s*(.+?)(?:\n|$)/);
    const transacaoId = mId   ? mId[1]         : null;
    const descricao   = mDesc ? mDesc[1].trim() : null;
    // Pagador e recebedor: padrão Itaú/Banco Inter ("Quem pagou / Quem recebeu")
    const mPagNome = texto.match(/Quem\s+pagou\s+Nome\s*:\s*(.+?)\s+CPF/i);
    const mPagCNPJ = texto.match(/Quem\s+pagou\s+.{0,60}?CPF\/CNPJ\s*:\s*([\d.\/\-*]+)/i);
    const mRecNome = texto.match(/Quem\s+recebeu\s+Nome\s*:\s*(.+?)\s+CPF/i);
    // Padrão Vrde Bank / outros: "Para\nNOME" ou "Favorecido\nNOME"
    const mParaNome = texto.match(/(?:^|\n)[Pp]ara\s*\n\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\n]{2,60})/m)
                   || texto.match(/[Ff]avorecido\s*:?\s*\n?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\n]{2,60})/);
    const pagadorNome   = mPagNome ? mPagNome[1].trim() : null;
    const pagadorCNPJ   = mPagCNPJ ? mPagCNPJ[1].replace(/\D/g,"") : null;
    const recebedorNome = mRecNome ? mRecNome[1].trim() : (mParaNome ? mParaNome[1].trim() : null);
    // Refinar direção pelo CNPJ do pagador (mais confiável que o título)
    if (pagadorCNPJ) {
      esSugerido = pagadorCNPJ === CNPJ_FIRMA ? "S" : "E";
    }
    // Refinar pelo CNPJ do recebedor (comprovante gerado pelo banco do pagador diz "Pix enviado",
    // mas se Addere é o recebedor → para Addere é ENTRADA, não SAÍDA)
    const mRecCNPJ = texto.match(/Quem\s+recebeu\s+.{0,80}?CPF\/CNPJ\s*:\s*([\d.\/\-*]+)/is);
    const recebedorCNPJ = mRecCNPJ ? mRecCNPJ[1].replace(/\D/g,"") : null;
    if (recebedorCNPJ && recebedorCNPJ === CNPJ_FIRMA) esSugerido = "E";
    // Fallback: CNPJ da firma aparece no documento sem seção estruturada
    // → se título dizia "enviado" mas não havia CNPJ do pagador encontrado, checar recebedor pelo CNPJ literal
    if (!pagadorCNPJ && !recebedorCNPJ && esSugerido === "S") {
      if (/27\.678\.566\/0001-23|27678566000123/.test(texto)) esSugerido = "E";
    }
    const parteNome = esSugerido === "S" ? (recebedorNome || descricao) : (pagadorNome || descricao);
    if (!valorCentavos || !dataISO) return null;
    return { dataISO, compAno, compMes, valorCentavos, esSugerido, parteNome, descricao, transacaoId };
  }

  /** Detecta e extrai dados de guias fiscais: DAS, TLPL, DAE, DARF */
  function _parseGuiaFiscalText(texto) {
    let tipo = null;
    if (/[Dd]ocumento\s+de\s+[Aa]rrecada[çc][ãa]o\s+do\s+[Ss]imples\s+[Nn]acional/i.test(texto)) tipo = "DAS";
    else if (/TLPL\s*[\/ ]\s*\d{4}|Taxa\s+de\s+Licen[çc]a\s+Profissional/i.test(texto)) tipo = "TLPL";
    else if (/DAE\b.*SEFA|SEFA.*\bDAE\b|[Dd]ocumento\s+de\s+[Aa]rrecada[çc][ãa]o\s+[Ee]stadual/i.test(texto)) tipo = "DAE";
    else if (/\bDARF\b|[Dd]ocumento\s+de\s+[Aa]rrecada[çc][ãa]o\s+de\s+[Rr]eceitas\s+[Ff]ederais/i.test(texto)) tipo = "DARF";
    if (!tipo) return null;
    const mVenc = texto.match(/[Dd]ata\s+de\s+[Vv]encimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/)
               || texto.match(/[Pp]agar\s+(?:este\s+documento\s+)?at[eé]\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    let dataISO = null, compAno = null, compMes = null;
    if (mVenc) { const [dd,mm,yyyy] = mVenc[1].split("/"); dataISO = `${yyyy}-${mm}-${dd}`; compAno = parseInt(yyyy); compMes = parseInt(mm); }
    const MESES = {janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
    const mPer = texto.match(/[Pp]er[íi]odo\s+de\s+[Aa]pura[çc][ãa]o\s*:?\s*([A-Za-záàâãéêíóôõúç]+)\/(\d{4})/);
    if (mPer) { const k = mPer[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""); if (MESES[k]) compMes = MESES[k]; compAno = parseInt(mPer[2]); }
    let valorCentavos = 0;
    const mV = (tipo === "DAS"  ? texto.match(/[Vv]alor\s+[Tt]otal\s+do\s+[Dd]ocumento\s*:?\s*([\d.]+,\d{2})/) : null)
            || (tipo === "TLPL" ? (texto.match(/A\s+[Pp]agar\s+no\s+[Vv]encimento\s*:?\s*R?\$?\s*([\d.]+,\d{2})/) || texto.match(/TOTAL\s+COTA\s+[ÚU]NICA\s*\(R\$\)\s*:?\s*([\d.]+,\d{2})/)) : null)
            || texto.match(/[Vv]alor\s+(?:[Tt]otal|[Pp]rincipal|[Aa]\s+[Pp]agar)\s*:?\s*R?\$?\s*([\d.]+,\d{2})/);
    if (mV) valorCentavos = Math.round(parseFloat(mV[1].replace(/\./g,"").replace(",",".")) * 100);
    const mNum = texto.match(/[Nn][úu]mero\s+do\s+[Dd]ocumento\s*:?\s*([\d.\-\/]+)/) || texto.match(/N[ºo°]\s*(?:DA\s+)?GUIA\s*:?\s*([\d.\-\/]+)/i);
    const numeroDoc = mNum ? mNum[1].trim() : null;
    const periodoStr = mPer ? `${mPer[1]}/${mPer[2]}` : `${compMes}/${compAno}`;
    const historico  = tipo === "DAS"  ? `Simples Nacional — ${periodoStr}`
                     : tipo === "TLPL" ? `TLPL — ${periodoStr}`
                     : tipo === "DAE"  ? `DAE/SEFA — ${periodoStr}`
                     :                  `DARF — ${periodoStr}`;
    if (!valorCentavos || !dataISO) return null;
    return { tipo, dataISO, compAno, compMes, valorCentavos, numeroDoc, historico };
  }

  /** Detecta e extrai dados de fatura de fornecedor (ClickSign, SaaS, etc.) a partir do corpo do e-mail */
  function _parseFaturaEmail(assunto, corpo) {
    const textoCompleto = (assunto + " " + corpo).toLowerCase();
    if (!textoCompleto.includes("fatura")) return null;

    // Valor: "R$ 69,00"
    const mValor = corpo.match(/R\$\s*([\d.]+,\d{2})/i);
    if (!mValor) return null;
    const valorCentavos = Math.round(parseFloat(mValor[1].replace(/\./g, "").replace(",", ".")) * 100);
    if (!valorCentavos) return null;

    // Vencimento: "vencimento para o dia 10/04/2026" ou "vencimento em 10/04/2026" ou primeira data encontrada
    const mVenc = corpo.match(/vencimento\s+(?:para\s+(?:o\s+)?dia\s+|em\s+)?(\d{2})\/(\d{2})\/(\d{4})/i)
               || corpo.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!mVenc) return null;
    const [, dd, mm, yyyy] = mVenc;
    const dataISO = `${yyyy}-${mm}-${dd}`;
    const vencFmt = `${dd}/${mm}/${yyyy}`;

    return { valorCentavos, dataISO, vencFmt, compAno: parseInt(yyyy), compMes: parseInt(mm) };
  }

  /** Processa NFS-e recebida por e-mail: cria LC e notifica admins */
  async function _processarNFSeGmail(buf, msgId, attachIdx, remetenteEmail, assunto, textoOverride = null) {
    try {
      const texto = textoOverride ?? await _extrairTextoPdf(buf).catch(() => "");
      if (!texto.trim()) return;
      const dados = _parseNFSeText(texto);
      if (!dados) { console.log(`📋 NFS-e scan [${msgId}]: não reconhecido como NFS-e`); return; }
      const refOrigem = `NFSE_GMAIL_${msgId}_${attachIdx}`;
      if (await prisma.livroCaixaLancamento.findFirst({ where: { referenciaOrigem: refOrigem }, select: { id: true } })) return;
      // Boleto do mesmo anexo tem prioridade
      if (await prisma.livroCaixaLancamento.findFirst({ where: { referenciaOrigem: `BOLETO_GMAIL_${msgId}_${attachIdx}` }, select: { id: true } })) return;
      const dataLC = new Date((dados.dataISO || new Date().toISOString().slice(0,10)) + "T12:00:00Z");
      await prisma.livroCaixaLancamento.create({ data: {
        competenciaAno: dados.compAno, competenciaMes: dados.compMes,
        data: dataLC, es: dados.esSugerido,
        clienteFornecedor: dados.parteNome || remetenteEmail,
        historico: (dados.numeroNota ? `NFS-e ${dados.numeroNota} — ${assunto}` : `NFS-e via e-mail — ${assunto}`).slice(0,255),
        valorCentavos: dados.valorCentavos,
        contaId: null, origem: "NFSE_EMAIL", referenciaOrigem: refOrigem,
        status: "PENDENTE_CONTA", statusFluxo: "PREVISTO",
      }});
      const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { id: true, email: true, nome: true } });
      const sistemaId = admins[0]?.id;
      const valFmt  = (dados.valorCentavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
      const esLabel = dados.esSugerido === "E" ? "Entrada" : "Saída";
      const chatMsg = `📋 NFS-e recebida via e-mail\n${dados.parteNome || remetenteEmail}\n${esLabel} ${valFmt} — competência ${String(dados.compMes).padStart(2,"0")}/${dados.compAno}`;
      await Promise.allSettled(admins.map(async admin => {
        await sendEmail({ to: admin.email, subject: `📋 NFS-e recebida — ${dados.parteNome || remetenteEmail}`, html: `<p style="font-family:sans-serif">${chatMsg.replace(/\n/g,"<br>")}</p>` }).catch(() => {});
        if (sistemaId && admin.id !== sistemaId) await prisma.mensagemChat.create({ data: { remetenteId: sistemaId, destinatarioId: admin.id, conteudo: chatMsg, tipoMensagem: "CHAT" } }).catch(() => {});
      }));
      console.log(`📋 NFS-e processada [${msgId}]: ${dados.parteNome} — ${valFmt}`);
    } catch (e) { console.log(`📋 NFS-e scan [${msgId}] erro: ${e.message}`); }
  }

  /** Processa comprovante PIX/TED: confirma LC PREVISTO existente ou cria novo EFETIVADO */
  async function _processarComprovantePix(buf, msgId, attachIdx, remetenteEmail, assunto, textoOverride = null) {
    try {
      const texto = textoOverride ?? await _extrairTextoPdf(buf).catch(() => "");
      if (!texto.trim()) return;
      const dados = _parseComprovantePixText(texto);
      if (!dados) { console.log(`💳 PIX scan [${msgId}]: não reconhecido como comprovante PIX/TED`); return; }
      const refOrigem = dados.transacaoId ? `PIX_${dados.transacaoId}` : `PIX_GMAIL_${msgId}_${attachIdx}`;
      if (await prisma.livroCaixaLancamento.findFirst({ where: { referenciaOrigem: refOrigem }, select: { id: true } })) return;
      const dataLC = new Date((dados.dataISO || new Date().toISOString().slice(0,10)) + "T12:00:00Z");
      const dtMin  = new Date(dataLC.getTime() - 30*24*60*60*1000);
      const dtMax  = new Date(dataLC.getTime() + 30*24*60*60*1000);
      const previsto = await prisma.livroCaixaLancamento.findFirst({
        where: { statusFluxo: "PREVISTO", es: dados.esSugerido, valorCentavos: dados.valorCentavos, data: { gte: dtMin, lte: dtMax }, origem: { not: "REPASSES_REALIZADOS" } },
        orderBy: { data: "asc" },
      });
      if (previsto) {
        await prisma.livroCaixaLancamento.update({ where: { id: previsto.id }, data: { statusFluxo: "EFETIVADO", data: dataLC, referenciaOrigem: refOrigem, competenciaAno: dados.compAno, competenciaMes: dados.compMes } });
        console.log(`💳 PIX confirmou LC #${previsto.id}: ${dados.parteNome} — ${(dados.valorCentavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}`);
      } else {
        await prisma.livroCaixaLancamento.create({ data: {
          competenciaAno: dados.compAno, competenciaMes: dados.compMes,
          data: dataLC, es: dados.esSugerido,
          clienteFornecedor: dados.parteNome || remetenteEmail,
          historico: (dados.descricao || assunto || "Pagamento via PIX/TED").slice(0,255),
          valorCentavos: dados.valorCentavos,
          contaId: null, origem: "PIX_EMAIL", referenciaOrigem: refOrigem,
          status: "PENDENTE_CONTA", statusFluxo: "EFETIVADO",
        }});
        console.log(`💳 PIX novo LC criado [${msgId}]: ${dados.parteNome} — ${(dados.valorCentavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}`);
      }
      const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { id: true, email: true, nome: true } });
      const sistemaId = admins[0]?.id;
      const valFmt  = (dados.valorCentavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
      const esLabel = dados.esSugerido === "S" ? "Saída" : "Entrada";
      const chatMsg = `💳 Comprovante PIX/TED recebido\n${dados.parteNome || remetenteEmail}\n${esLabel} ${valFmt}${previsto ? "\n✅ LC existente confirmado" : "\n🆕 Novo LC criado"}`;
      await Promise.allSettled(admins.map(async admin => {
        await sendEmail({ to: admin.email, subject: `💳 PIX/TED — ${dados.parteNome || remetenteEmail}`, html: `<p style="font-family:sans-serif">${chatMsg.replace(/\n/g,"<br>")}</p>` }).catch(() => {});
        if (sistemaId && admin.id !== sistemaId) await prisma.mensagemChat.create({ data: { remetenteId: sistemaId, destinatarioId: admin.id, conteudo: chatMsg, tipoMensagem: "CHAT" } }).catch(() => {});
      }));
    } catch (e) { console.log(`💳 PIX scan [${msgId}] erro: ${e.message}`); }
  }

  /** Processa guias fiscais recebidas por e-mail: DAS, TLPL, DAE, DARF */
  async function _processarGuiaFiscal(buf, msgId, attachIdx, remetenteEmail, assunto, textoOverride = null) {
    try {
      const texto = textoOverride ?? await _extrairTextoPdf(buf).catch(() => "");
      if (!texto.trim()) return;
      const dados = _parseGuiaFiscalText(texto);
      if (!dados) { console.log(`🧾 Guia scan [${msgId}]: não reconhecido como guia fiscal`); return; }
      const refOrigem = dados.numeroDoc ? `GUIA_${dados.tipo}_${dados.numeroDoc.replace(/\W/g,"")}` : `GUIA_GMAIL_${msgId}_${attachIdx}`;
      if (await prisma.livroCaixaLancamento.findFirst({ where: { referenciaOrigem: refOrigem }, select: { id: true } })) return;
      const dataLC = new Date((dados.dataISO || new Date().toISOString().slice(0,10)) + "T12:00:00Z");
      await prisma.livroCaixaLancamento.create({ data: {
        competenciaAno: dados.compAno, competenciaMes: dados.compMes,
        data: dataLC, es: "S",
        clienteFornecedor: dados.tipo === "DAS" ? "Simples Nacional" : dados.tipo === "TLPL" ? "Prefeitura de Belém — TLPL" : dados.tipo === "DAE" ? "SEFA/Estadual" : "Receita Federal — DARF",
        historico: dados.historico.slice(0,255),
        valorCentavos: dados.valorCentavos,
        contaId: null, origem: "GUIA_FISCAL_EMAIL", referenciaOrigem: refOrigem,
        status: "PENDENTE_CONTA", statusFluxo: "PREVISTO",
      }});
      const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { id: true, email: true, nome: true } });
      const sistemaId = admins[0]?.id;
      const valFmt  = (dados.valorCentavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
      const chatMsg = `🧾 ${dados.tipo} recebida via e-mail\nSaída ${valFmt}\n${dados.historico}`;
      await Promise.allSettled(admins.map(async admin => {
        await sendEmail({ to: admin.email, subject: `🧾 ${dados.tipo} recebida — ${valFmt}`, html: `<p style="font-family:sans-serif">${chatMsg.replace(/\n/g,"<br>")}</p>` }).catch(() => {});
        if (sistemaId && admin.id !== sistemaId) await prisma.mensagemChat.create({ data: { remetenteId: sistemaId, destinatarioId: admin.id, conteudo: chatMsg, tipoMensagem: "CHAT" } }).catch(() => {});
      }));
      console.log(`🧾 Guia ${dados.tipo} processada [${msgId}]: ${dados.historico} — ${valFmt}`);
    } catch (e) { console.log(`🧾 Guia scan [${msgId}] erro: ${e.message}`); }
  }

  /** Processa um PDF de boleto recebido por e-mail: cria LC e notifica admins. */
  async function _processarBoletoPdfGmail(buf, msgId, attachIdx, remetenteEmail, assunto, bancoOrigem = null) {
    try {
      const texto = await _extrairTextoPdf(buf).catch(() => "");
      if (!texto.trim()) { console.log(`📄 Boleto scan [${msgId}]: PDF sem texto extraível (imagem?)`); return; }

      // Heurística: é um boleto?
      const ehBoleto =
        /\d{5}\.\d{5}\s+\d{5}\.\d{6}/.test(texto) ||
        /\d{44,48}/.test(texto) ||
        (/[Vv]encimento/.test(texto) && /R\$\s*[\d.]+,\d{2}/.test(texto) && /PAGADOR|[Pp]agador/.test(texto));
      if (!ehBoleto) { console.log(`📄 Boleto scan [${msgId}]: PDF não reconhecido como boleto`); return; }

      const campos = _parseBoletoText(texto);
      if (!campos.vencimento && !campos.valorCentavos) { console.log(`📄 Boleto scan [${msgId}]: vencimento e valor não encontrados no texto`); return; } // dados insuficientes

      // Idempotência
      const refOrigem = `BOLETO_GMAIL_${msgId}_${attachIdx}`;
      const jaProcessado = await prisma.livroCaixaLancamento.findFirst({
        where: { referenciaOrigem: refOrigem }, select: { id: true },
      });
      if (jaProcessado) return;

      // ── Lookup / criação de cliente ou fornecedor ────────────────────────
      const parteNome    = campos.esSugerido === "E" ? campos.pagador      : campos.beneficiario;
      const parteCpfCnpj = campos.esSugerido === "E" ? campos.cpfCnpjPagador : campos.cnpjBeneficiario;
      const parteTipo    = campos.esSugerido === "S" ? "F" : "C";
      let clienteNome = null;

      if (parteNome) {
        const cpfDig = parteCpfCnpj ? parteCpfCnpj.replace(/\D/g,"") : null;
        let encontrado = cpfDig ? await prisma.cliente.findUnique({ where: { cpfCnpj: cpfDig } }) : null;
        if (!encontrado) {
          const porNome = await prisma.cliente.findMany({ where: { nomeRazaoSocial: { contains: parteNome, mode: "insensitive" } } });
          encontrado = porNome.find(c => c.nomeRazaoSocial.toLowerCase() === parteNome.toLowerCase()) || porNome[0] || null;
        }
        if (encontrado) {
          clienteNome = encontrado.nomeRazaoSocial;
          if (cpfDig && encontrado.cpfCnpj !== cpfDig) {
            const conflito = await prisma.cliente.findUnique({ where: { cpfCnpj: cpfDig } });
            if (!conflito) await prisma.cliente.update({ where: { id: encontrado.id }, data: { cpfCnpj: cpfDig } });
          }
        } else if (parteNome && cpfDig) {
          const conflito = await prisma.cliente.findUnique({ where: { cpfCnpj: cpfDig } });
          if (conflito) {
            clienteNome = conflito.nomeRazaoSocial;
          } else {
            const novo = await prisma.cliente.create({ data: {
              nomeRazaoSocial: parteNome, cpfCnpj: cpfDig, tipo: parteTipo,
              observacoes: `Criado automaticamente via boleto recebido por e-mail em ${new Date().toLocaleDateString("pt-BR")}.`,
            }});
            clienteNome = novo.nomeRazaoSocial;
          }
        }
      }

      // ── Conta bancária ───────────────────────────────────────────────────
      const contas = await prisma.livroCaixaConta.findMany({ where: { ativa: true }, select: { id: true, nome: true } });
      const contaId = _findContaByBancoDB(campos.intermediario, contas);

      // ── Competência = mês/ano do vencimento ──────────────────────────────
      let compAno, compMes;
      if (campos.vencimento) {
        const [y, m] = campos.vencimento.split("-");
        compAno = parseInt(y); compMes = parseInt(m);
      } else {
        const now = new Date(); compAno = now.getFullYear(); compMes = now.getMonth() + 1;
      }

      // ── Criar lançamento ─────────────────────────────────────────────────
      // Se o e-mail veio de um banco (Inter/Santander), usa o nome do banco como
      // fornecedor e o assunto como histórico (sem prefixo genérico).
      const bancoLabel = bancoOrigem === "INTER" ? "Banco Inter"
                       : bancoOrigem === "SANTANDER" ? "Banco Santander"
                       : null;

      const historico = bancoLabel
        ? (assunto || bancoLabel).slice(0, 255)
        : (campos.numeroDocumento
            ? `Boleto Nº ${campos.numeroDocumento} — ${assunto || "e-mail"}`.slice(0, 255)
            : `Boleto via e-mail — ${assunto || remetenteEmail}`.slice(0, 255));

      // Fallback para clienteFornecedor: extrai nome do assunto em vez do e-mail do remetente
      // Remove prefixos de encaminhamento (Fwd:, Re:, Enc:, RES:) e usa o restante
      const _nomeDoAssunto = assunto
        ? assunto.replace(/^(Fwd?|Re|Enc|RES|ENC)\s*:\s*/i, "").split(/[-–|]/)[0].trim().slice(0, 80)
        : null;
      const nomeParteOuAssunto = bancoLabel || clienteNome || parteNome || _nomeDoAssunto || remetenteEmail;

      // ── Deduplicação: pula se já existe LC com mesmo valor, direção e data próxima ──
      if (campos.valorCentavos) {
        const dataBase = campos.vencimento ? new Date(campos.vencimento + "T12:00:00Z") : new Date();
        const d3antes  = new Date(dataBase.getTime() - 3 * 24 * 60 * 60 * 1000);
        const d3depois = new Date(dataBase.getTime() + 3 * 24 * 60 * 60 * 1000);
        const lcExist = await prisma.livroCaixaLancamento.findFirst({
          where: {
            valorCentavos: campos.valorCentavos,
            es: campos.esSugerido || "S",
            data: { gte: d3antes, lte: d3depois },
            origem: { not: "BOLETO_EMAIL" }, // não deduplica contra si mesmo
          },
          select: { id: true },
        });
        if (lcExist) {
          console.log(`📄 Boleto Gmail [${msgId}]: duplicata de LC#${lcExist.id} (mesmo valor/data) — ignorado`);
          return;
        }
      }

      const lancamento = await prisma.livroCaixaLancamento.create({ data: {
        competenciaAno: compAno, competenciaMes: compMes,
        data: campos.vencimento ? new Date(campos.vencimento + "T12:00:00Z") : new Date(),
        es: campos.esSugerido || "S",
        clienteFornecedor: nomeParteOuAssunto,
        historico, valorCentavos: campos.valorCentavos || 0,
        contaId: contaId || null,
        origem: "BOLETO_EMAIL", referenciaOrigem: refOrigem,
        status: contaId ? "OK" : "PENDENTE_CONTA", statusFluxo: "PREVISTO",
      }});

      // ── Notificar admins ─────────────────────────────────────────────────
      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { id: true, email: true, nome: true, whatsapp: true, telefone: true },
      });
      const sistemaId   = admins[0]?.id;
      const esLabel   = campos.esSugerido === "E" ? "Entrada" : "Saída";
      const parteLabel = campos.esSugerido === "E" ? "Pagador" : "Fornecedor";
      const valorFmt  = campos.valorCentavos ? (campos.valorCentavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}) : "—";
      const vencFmt   = campos.vencimento ? campos.vencimento.split("-").reverse().join("/") : "—";
      const nomeLabel = bancoLabel || clienteNome || parteNome || remetenteEmail;

      const emailHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
  <div style="background:#1e3a5f;padding:24px 28px">
    <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
    <div style="font-size:13px;color:#93c5fd;margin-top:4px">🔖 Boleto recebido por e-mail — lançamento criado automaticamente</div>
  </div>
  <div style="padding:24px 28px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;width:160px">Tipo</td>
          <td style="padding:6px 0;font-size:14px;color:#0f172a">${esLabel}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">${parteLabel}</td>
          <td style="padding:6px 0;font-size:14px;color:#0f172a">${nomeLabel}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Valor</td>
          <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:700">${valorFmt}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Vencimento</td>
          <td style="padding:6px 0;font-size:14px;color:#0f172a">${vencFmt}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Histórico</td>
          <td style="padding:6px 0;font-size:14px;color:#0f172a">${historico}</td></tr>
      <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">E-mail origem</td>
          <td style="padding:6px 0;font-size:14px;color:#0f172a">${bancoLabel ? `${bancoLabel} — "${remetenteEmail}"` : remetenteEmail}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:13px;color:#6b7280">Acesse <strong>Livro Caixa → Lançamentos</strong> para revisar e confirmar.</p>
  </div>
  <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">Addere Control — lançamento automático</div>
</div></body></html>`;

      const wppMsg = `🔖 *Boleto recebido por e-mail*\n*${esLabel}* | ${vencFmt} | *${valorFmt}*\n${parteLabel}: ${nomeLabel}\nHistórico: ${historico}\n\nRevisar: Livro Caixa → Lançamentos`;
      const chatMsg = `🔖 Boleto recebido por e-mail e registrado automaticamente.\n${esLabel} | ${vencFmt} | ${valorFmt}\n${parteLabel}: ${nomeLabel}\nHistórico: ${historico}`;

      const fmtWAVal2 = (c) => c ? (c/100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "0,00";
      admins.forEach(admin => {
        sendEmail({ to: admin.email, subject: `🔖 Boleto ${esLabel} — ${vencFmt} — ${valorFmt} — ${nomeLabel}`, html: emailHtml }).catch(() => {});
        if (sistemaId) prisma.mensagemChat.create({ data: { remetenteId: sistemaId, destinatarioId: admin.id, conteudo: chatMsg, tipoMensagem: "CHAT" } }).catch(() => {});
        const phoneAdm = _waPhone(admin.whatsapp || admin.telefone);
        if (phoneAdm) {
          sendWhatsAppTemplate(phoneAdm, "capturado_boleto", "pt_BR", [{
            type: "body",
            parameters: [
              { type: "text", text: esLabel },
              { type: "text", text: vencFmt },
              { type: "text", text: fmtWAVal2(campos.valorCentavos) },
              { type: "text", text: parteLabel },
              { type: "text", text: nomeLabel },
            ],
          }]).catch(() => {});
        }
      });

      console.log(`🔖 Boleto Gmail processado — ${remetenteEmail} — ${valorFmt} — venc. ${vencFmt} — LC#${lancamento.id}`);
    } catch (err) {
      console.error(`❌ Erro ao processar boleto PDF do Gmail (msg ${msgId}):`, err.message);
    }
  }

  async function _buildEmailAcuseRecebimentoCliente(nomeCliente, assuntoOriginal, parcelaConfirmada) {
    const { buildEmailAcuseRecebimentoCliente } = await import("./vencimentos.js");
    return buildEmailAcuseRecebimentoCliente(nomeCliente, assuntoOriginal, parcelaConfirmada);
  }

  async function _pollGmail() {
    try {
      // Busca mensagens não lidas na caixa de entrada
      const listUnreadRes = await _gmail.users.messages.list({
        userId: "me",
        q: "is:unread in:inbox",
        maxResults: 20,
      });

      // Busca alertas bancários recentes (Inter/Santander), mesmo se já estiverem lidos.
      // Isso evita perda quando outro monitor marca como lido antes do Addere.
      const listBankRes = await _gmail.users.messages.list({
        userId: "me",
        q: "in:inbox newer_than:7d (from:no-reply@inter.co OR from:santander)",
        maxResults: 20,
      });

      const byId = new Map();
      for (const m of (listUnreadRes.data.messages || [])) byId.set(m.id, m);
      for (const m of (listBankRes.data.messages || [])) byId.set(m.id, m);
      const messages = [...byId.values()];
      if (messages.length === 0) return;

      console.log(`📬 Gmail poller: ${messages.length} mensagem(ns) para análise (unread + bancos)`);

      // Busca palavras-chave ativas do banco (uma vez por ciclo)
      const palavrasDb = await prisma.gmailPalavraChave.findMany({ where: { ativo: true }, select: { palavra: true } });
      const _PALAVRAS_COMPROVANTE = palavrasDb.map(p => p.palavra);

      for (const { id: msgId } of messages) {
        // Idempotência: pula se já processamos este messageId
        const jaExiste = await prisma.comprovanteRespostaCliente.findUnique({
          where: { gmailMessageId: msgId },
          select: { id: true },
        });
        if (jaExiste) {
          // Marca como lida e segue
          await _gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } }).catch(() => {});
          continue;
        }

        // Busca mensagem completa
        const msgRes = await _gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
        const msg = msgRes.data;
        const headers = msg.payload?.headers || [];

        const fromRaw = _header(headers, "From");
        const remetenteEmail = _extractEmail(fromRaw);
        const assunto = _header(headers, "Subject") || "(sem assunto)";
        const dateStr = _header(headers, "Date");
        const recebidoEm = dateStr ? new Date(dateStr) : new Date();

        // Filtra: ignora e-mails do próprio sistema para evitar loops
        if (remetenteEmail === process.env.GMAIL_USER?.toLowerCase()) {
          await _gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } }).catch(() => {});
          continue;
        }

        // ── Parse partes (metadata) — usado tanto pelo boleto scan quanto pelo comprovante ──
        const emailParsed = _parseParts(msg.payload?.parts || []);
        if (!emailParsed.text && !emailParsed.html && msg.payload?.body?.data) {
          const rawBody = _b64Decode(msg.payload.body.data).toString("utf-8");
          if ((msg.payload?.mimeType || "").toLowerCase().includes("html")) emailParsed.html = rawBody;
          else emailParsed.text = rawBody;
        }
        const emailTextFromHtml = _htmlToText(emailParsed.html || "");
        const corpoTextoEmail = [emailParsed.text || "", emailTextFromHtml || ""].filter(Boolean).join("\n").trim();

        // Alertas bancários (Inter / Santander): confirma, atualiza ou cria no LC
        const bancoOrigem = _detectarBancoOrigemEmail(remetenteEmail, fromRaw);
        if (bancoOrigem) {
          const handledBanco = await _processarAlertaBancoEmail({
            msgId,
            remetenteEmail,
            assunto,
            corpoTexto: corpoTextoEmail,
            recebidoEm,
            bancoOrigem,
          });
          if (handledBanco) {
            await _gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } }).catch(() => {});
            continue;
          }
        }

        // ── Scan de documentos PDF (boleto, NFS-e, PIX/TED, guias fiscais) ──────────────
        for (let pi = 0; pi < emailParsed.anexos.length; pi++) {
          const anx = emailParsed.anexos[pi];
          if (!anx.mime?.includes("pdf") && !String(anx.nome || "").toLowerCase().endsWith(".pdf")) continue;
          try {
            const attRes = await _gmail.users.messages.attachments.get({ userId: "me", messageId: msgId, id: anx.attachmentId });
            const buf = _b64Decode(attRes.data.data || "");
            if (buf.length <= 0 || buf.length > 10 * 1024 * 1024) continue;
            await _processarBoletoPdfGmail(buf, msgId, pi, remetenteEmail, assunto, bancoOrigem);
            await _processarNFSeGmail(buf, msgId, pi, remetenteEmail, assunto);
            await _processarComprovantePix(buf, msgId, pi, remetenteEmail, assunto);
            await _processarGuiaFiscal(buf, msgId, pi, remetenteEmail, assunto);
          } catch (pdfErr) { console.log(`📄 PDF scan [${msgId}] erro no anexo ${pi}: ${pdfErr.message}`); }
        }

        // ── Scan de imagens PNG/JPG via OCR (comprovantes, NFS-e, guias) ─────────────
        for (let pi = 0; pi < emailParsed.anexos.length; pi++) {
          const anx = emailParsed.anexos[pi];
          const nomeAnx = String(anx.nome || "").toLowerCase();
          const isImg = anx.mime?.startsWith("image/") || /\.(png|jpe?g)$/.test(nomeAnx);
          if (!isImg) continue;
          try {
            const attRes = await _gmail.users.messages.attachments.get({ userId: "me", messageId: msgId, id: anx.attachmentId });
            const buf = _b64Decode(attRes.data.data || "");
            if (buf.length <= 0 || buf.length > 5 * 1024 * 1024) continue;
            console.log(`🖼️ OCR iniciando [${msgId}] anexo ${pi}: ${anx.nome}`);
            const texto = await _extrairTextoImagem(buf).catch(e => { console.log(`🖼️ OCR erro [${msgId}] anexo ${pi}: ${e.message}`); return ""; });
            if (!texto.trim()) continue;
            // Boleto não é processado via OCR (código de barras requer vetor)
            await _processarNFSeGmail(buf, msgId, pi, remetenteEmail, assunto, texto);
            await _processarComprovantePix(buf, msgId, pi, remetenteEmail, assunto, texto);
            await _processarGuiaFiscal(buf, msgId, pi, remetenteEmail, assunto, texto);
          } catch (imgErr) { console.log(`🖼️ Image scan [${msgId}] erro no anexo ${pi}: ${imgErr.message}`); }
        }

        // ── Filtro 1: remetente deve ser cliente cadastrado ───────────────
        const cliente = await prisma.cliente.findFirst({
          where: { email: { equals: remetenteEmail, mode: "insensitive" } },
          select: { id: true, nomeRazaoSocial: true },
        });
        if (!cliente) {
          // Não é cliente cadastrado — marca como lido e ignora
          await _gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } }).catch(() => {});
          console.log(`📬 Gmail poller: ignorado (remetente não cadastrado) — ${remetenteEmail}`);
          continue;
        }

        // ── Filtro 2: assunto deve conter palavra-chave de comprovante ────
        const assuntoLower = assunto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const temPalavraChave = _PALAVRAS_COMPROVANTE.some(p =>
          assuntoLower.includes(p.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
        );
        if (!temPalavraChave) {
          await _gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } }).catch(() => {});
          console.log(`📬 Gmail poller: ignorado (assunto sem palavra-chave) — "${assunto}" de ${remetenteEmail}`);
          continue;
        }

        // Extrai corpo e lista de anexos (já calculado no scan de boletos acima)
        const parsed = emailParsed;
        const parsedText = corpoTextoEmail || parsed.text || "";

        // Se encontrou cliente, busca parcelas em atraso dele para auto-link
        let parcelaIdAutoLink = null;
        if (cliente) {
          const parcelasAbertas = await prisma.parcelaContrato.findMany({
            where: {
              status: { in: ["PREVISTA", "ATRASADA"] },
              contrato: { clienteId: cliente.id },
              vencimento: { lt: new Date() },
            },
            select: { id: true },
            orderBy: { vencimento: "asc" },
          });
          if (parcelasAbertas.length === 1) parcelaIdAutoLink = parcelasAbertas[0].id;
        }

        // Baixa os anexos
        const anexosData = [];
        for (const anx of parsed.anexos) {
          try {
            const attRes = await _gmail.users.messages.attachments.get({
              userId: "me", messageId: msgId, id: anx.attachmentId,
            });
            const buf = _b64Decode(attRes.data.data || "");
            if (buf.length > 0 && buf.length <= 10 * 1024 * 1024) { // limite 10MB
              anexosData.push({ nome: anx.nome, mime: anx.mime, buf, tamanho: buf.length });
            }
          } catch (_) { /* ignora falha em anexo individual */ }
        }

        // Salva no banco
        await prisma.comprovanteRespostaCliente.create({
          data: {
            gmailMessageId: msgId,
            parcelaId:      parcelaIdAutoLink,
            clienteId:      cliente?.id ?? null,
            remetenteEmail,
            assunto,
            corpoTexto:     parsedText.slice(0, 10000) || null,
            recebidoEm,
            anexos: {
              create: anexosData.map(a => ({
                nomeArquivo:  a.nome,
                mimeType:     a.mime,
                tamanhoBytes: a.tamanho,
                conteudo:     a.buf,
              })),
            },
          },
        });

        // ── Lançamento automático de fatura de fornecedor ────────────────────
        try {
          const dadosFatura = _parseFaturaEmail(assunto, parsedText || "");
          if (dadosFatura) {
            const refFatura = `FATURA_GMAIL_${msgId}`;
            const jaExiste = await prisma.livroCaixaLancamento.findFirst({
              where: { referenciaOrigem: refFatura }, select: { id: true },
            });
            if (!jaExiste) {
              const nomeForn = cliente?.nomeRazaoSocial || fromRaw?.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim() || remetenteEmail;
              await prisma.livroCaixaLancamento.create({ data: {
                competenciaAno:    dadosFatura.compAno,
                competenciaMes:    dadosFatura.compMes,
                data:              new Date(dadosFatura.dataISO),
                es:                "S",
                clienteFornecedor: nomeForn,
                historico:         `Fatura ${nomeForn} — venc. ${dadosFatura.vencFmt}`.slice(0, 255),
                valorCentavos:     dadosFatura.valorCentavos,
                contaId:           null,
                origem:            "FATURA_EMAIL",
                referenciaOrigem:  refFatura,
                status:            "PENDENTE_CONTA",
                statusFluxo:       "PREVISTO",
              }});
              console.log(`🧾 Fatura registrada no LC [${msgId}]: ${nomeForn} — R$ ${(dadosFatura.valorCentavos / 100).toFixed(2)} venc. ${dadosFatura.vencFmt}`);
            }
          }
        } catch (eFatura) {
          console.log(`🧾 Fatura LC [${msgId}] erro: ${eFatura.message}`);
        }

        // Notifica admins
        const admins = await prisma.usuario.findMany({
          where: { role: "ADMIN", ativo: true },
          select: { email: true, nome: true },
        });
        const nomeCliente = cliente?.nomeRazaoSocial || remetenteEmail;
        const temAnexo = anexosData.length > 0;
        for (const admin of admins) {
          await sendEmail({
            to: admin.email,
            subject: `📎 Resposta de cliente recebida${temAnexo ? " (com anexo)" : ""} — ${nomeCliente}`,
            html: `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#1e3a5f;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px">Resposta de cliente recebida</div>
    </div>
    <div style="padding:24px 28px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;width:140px">De</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${nomeCliente} &lt;${remetenteEmail}&gt;</td></tr>
        <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Assunto</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${assunto}</td></tr>
        <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Recebido em</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${recebidoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td></tr>
        <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Parcela</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${parcelaIdAutoLink ? `#${parcelaIdAutoLink} (vinculada automaticamente)` : "— (vincular manualmente)"}</td></tr>
        <tr><td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Anexos</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${anexosData.length > 0 ? anexosData.map(a => a.nome).join(", ") : "Nenhum"}</td></tr>
      </table>
      ${parsedText ? `<div style="background:#f8fafc;border-radius:8px;padding:14px 16px;margin-top:16px;font-size:13px;color:#374151;white-space:pre-wrap">${parsedText.slice(0, 500)}${parsedText.length > 500 ? "…" : ""}</div>` : ""}
      <p style="margin-top:16px;font-size:13px;color:#6b7280">Acesse o sistema para visualizar e baixar os anexos: <strong>Comprovantes Recebidos</strong>.</p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">Addere Control — notificação automática</div>
  </div>
</body></html>`,
          }).catch(() => {});
        }

        // ── Processamento automático do comprovante ─────────────────────
        if (cliente) {
          try {
            // 1. Extrai texto de PDFs nos anexos
            let pdfTexto = "";
            for (const anx of anexosData) {
              if (anx.mime?.includes("pdf")) {
                pdfTexto += await _extrairTextoPdf(anx.buf).catch(() => "");
              }
            }

            // 2. Determina data de pagamento (fallback: data de recebimento do e-mail)
            const dataPagamento = _extrairDataPagamento(assunto, parsedText || "", pdfTexto) ?? recebidoEm;

            // 3. Detecta meio de pagamento
            const textoMeio = (assunto + " " + (parsedText || "")).toLowerCase();
            const meioPagamento =
              textoMeio.includes("pix")       ? "PIX"       :
              textoMeio.includes("boleto")     ? "BOLETO"    :
              textoMeio.includes("ted") || textoMeio.includes("doc") || textoMeio.includes("transfer") ? "TED" :
              textoMeio.includes("dep") ? "DEPÓSITO" : "PIX";

            // 4. Encontra parcela mais próxima da data de pagamento
            const parcelaMatch = await _matchParcelaMaisProxima(cliente.id, dataPagamento);

            if (parcelaMatch) {
              const valorRecebido = Number(parcelaMatch.valorPrevisto || 0);

              // 5. Marca parcela como RECEBIDA
              await prisma.parcelaContrato.update({
                where: { id: parcelaMatch.id },
                data: { status: "RECEBIDA", dataRecebimento: dataPagamento, meioRecebimento: meioPagamento, valorRecebido },
              });

              // 6. Atualiza ou cria entrada no LC como PENDENTE_CONTA (sem conta — admin ajusta)
              const lcExistente = await prisma.livroCaixaLancamento.findFirst({
                where: { origem: "PARCELA_PREVISTA", referenciaOrigem: String(parcelaMatch.id) },
              });
              if (lcExistente) {
                await prisma.livroCaixaLancamento.update({
                  where: { id: lcExistente.id },
                  data: {
                    statusFluxo: "EFETIVADO", status: "PENDENTE_CONTA", contaId: null,
                    data: dataPagamento,
                    competenciaAno: dataPagamento.getFullYear(),
                    competenciaMes: dataPagamento.getMonth() + 1,
                    valorCentavos: Math.round(valorRecebido * 100),
                  },
                });
              } else {
                const contrato = await prisma.contratoPagamento.findUnique({
                  where: { id: parcelaMatch.contratoId },
                  select: { numeroContrato: true },
                });
                await prisma.livroCaixaLancamento.create({
                  data: {
                    competenciaAno: dataPagamento.getFullYear(),
                    competenciaMes: dataPagamento.getMonth() + 1,
                    data: dataPagamento, es: "E",
                    clienteFornecedor: cliente.nomeRazaoSocial,
                    historico: `Parcela ${parcelaMatch.numero} - ${contrato?.numeroContrato || ""} - PAGA (comprovante Gmail)`,
                    valorCentavos: Math.round(valorRecebido * 100),
                    contaId: null, origem: "PARCELA_PREVISTA",
                    referenciaOrigem: String(parcelaMatch.id),
                    status: "PENDENTE_CONTA", statusFluxo: "EFETIVADO",
                  },
                });
              }

              // 7. Atualiza vínculo do comprovante com a parcela confirmada
              await prisma.comprovanteRespostaCliente.updateMany({
                where: { gmailMessageId: msgId },
                data: { parcelaId: parcelaMatch.id },
              });

              console.log(`✅ Parcela ${parcelaMatch.id} auto-confirmada via comprovante de ${remetenteEmail}`);
            }

            // 9. Auto-resposta ao cliente
            const acuseHtml = await _buildEmailAcuseRecebimentoCliente(cliente.nomeRazaoSocial, assunto, !!parcelaMatch);
            await sendEmail({
              to: remetenteEmail,
              subject: "Recebemos sua mensagem — Addere",
              html: acuseHtml,
            }).catch(() => {});

          } catch (autoErr) {
            console.error("❌ Erro no processamento automático do comprovante:", autoErr.message);
          }
        }

        // Marca como lida
        await _gmail.users.messages.modify({
          userId: "me", id: msgId,
          requestBody: { removeLabelIds: ["UNREAD"] },
        }).catch(() => {});

        console.log(`📎 Comprovante salvo: ${remetenteEmail} — "${assunto}" (${anexosData.length} anexo(s))`);
      }
    } catch (err) {
      console.error("❌ Erro no Gmail poller:", err.message);
    }
  }

  if (IS_TEST) return;

  // Roda imediatamente ao iniciar e depois a cada 10 minutos
  _pollGmail();
  setInterval(_pollGmail, 10 * 60 * 1000);
  console.log(`📬 Gmail poller ativo — monitorando ${process.env.GMAIL_USER} a cada 10 min`);
}
