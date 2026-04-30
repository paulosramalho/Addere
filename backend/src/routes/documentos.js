import { Router } from "express";
import { createRequire } from "module";
import multer from "multer";
import { Readable } from "stream";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { sendEmail, EMAIL_FROM } from "../lib/email.js";
import { WA_TOKEN, WA_PHONE_NUMBER_ID, WA_API_URL, _waMediaBase, _waPhone } from "../lib/whatsapp.js";
import { _safeFilename } from "../lib/upload.js";
import { Resend } from "resend";

const require = createRequire(import.meta.url);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const router = Router();

  const GOOGLE_OK = !!(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID &&
    (process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY || process.env.GOOGLE_DRIVE_REFRESH_TOKEN));

  // Cache: chave lógica → Drive folder ID
  const _driveFolderCache = new Map();

  function _driveClient() {
    if (!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado.");
    const { google } = require("googleapis");

    // Conta de serviço (preferencial — nunca expira)
    if (process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY && process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL) {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
        },
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
      return google.drive({ version: "v3", auth });
    }

    // Fallback: OAuth2 com refresh token (pode expirar)
    if (!process.env.GOOGLE_DRIVE_REFRESH_TOKEN) throw new Error("Google Drive não configurado (GOOGLE_DRIVE_SA_PRIVATE_KEY ou GOOGLE_DRIVE_REFRESH_TOKEN).");
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_DRIVE_CLIENT_ID,
      process.env.GOOGLE_DRIVE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
    return google.drive({ version: "v3", auth });
  }

  async function _driveEnsureFolder(drive, parentId, name, cacheKey) {
    if (_driveFolderCache.has(cacheKey)) return _driveFolderCache.get(cacheKey);
    const existing = await drive.files.list({
      q: `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id)", spaces: "drive",
    });
    let folderId;
    if (existing.data.files?.length > 0) {
      folderId = existing.data.files[0].id;
    } else {
      const created = await drive.files.create({
        requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
        fields: "id",
      });
      folderId = created.data.id;
    }
    _driveFolderCache.set(cacheKey, folderId);
    return folderId;
  }

  async function _driveGetFolderId(drive, cpfCnpj, ano, mes) {
    const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const mesStr = String(mes).padStart(2, "0");
    const clientesId = await _driveEnsureFolder(drive, root, "Clientes", "Clientes");
    const cpfId      = await _driveEnsureFolder(drive, clientesId, cpfCnpj, `Clientes/${cpfCnpj}`);
    const anoId      = await _driveEnsureFolder(drive, cpfId, String(ano), `Clientes/${cpfCnpj}/${ano}`);
    const mesId      = await _driveEnsureFolder(drive, anoId, mesStr, `Clientes/${cpfCnpj}/${ano}/${mesStr}`);
    return mesId;
  }

  const TIPO_PREFIXOS = { boleto: "boleto", nf: "nf", guia_das: "guia_das", guia_darf: "guia_darf", guia_tlpl: "guia_tlpl", guia_dae: "guia_dae", extrato: "extrato", contrato: "contrato", doc: "doc" };

  async function _driveNomeArquivo(drive, folderId, tipo, ano, mes, ext = "pdf") {
    const prefixo = TIPO_PREFIXOS[tipo] || "doc";
    const competencia = tipo === "contrato" ? "" : `_${ano}${String(mes).padStart(2, "0")}`;
    const base = `${prefixo}${competencia}`;
    const existing = await drive.files.list({
      q: `'${folderId}' in parents and name contains '${base}' and trashed = false`,
      fields: "files(name)", spaces: "drive",
    });
    const nomes = existing.data.files?.map(f => f.name) || [];
    if (nomes.length === 0) return `${base}.${ext}`;
    for (let seq = 2; seq <= 99; seq++) {
      const candidate = `${base}_${String(seq).padStart(3, "0")}.${ext}`;
      if (!nomes.includes(candidate)) return candidate;
    }
    return `${base}_${Date.now()}.${ext}`;
  }

  const uploadDoc = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // GET /api/documentos/:clienteId?ano&mes
  router.get("/api/documentos/:clienteId", authenticate, async (req, res) => {
    try {
      if (!GOOGLE_OK) return res.status(503).json({ message: "Google Drive não configurado" });
      const clienteId = parseInt(req.params.clienteId);
      const ano = parseInt(req.query.ano) || new Date().getFullYear();
      const mes = parseInt(req.query.mes) || new Date().getMonth() + 1;
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { cpfCnpj: true, nomeRazaoSocial: true, email: true, telefone: true } });
      if (!cliente) return res.status(404).json({ message: "Cliente não encontrado" });
      const cpfCnpj = (cliente.cpfCnpj || "").replace(/\D/g, "");
      if (!cpfCnpj) return res.status(400).json({ message: "Cliente sem CPF/CNPJ" });
      const drive = _driveClient();
      const folderId = await _driveGetFolderId(drive, cpfCnpj, ano, mes);
      const result = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "files(id, name, size, createdTime, mimeType)", orderBy: "name", spaces: "drive",
      });
      const arquivos = (result.data.files || []).map(f => ({
        driveId: f.id, nome: f.name, tamanho: parseInt(f.size || 0), mimeType: f.mimeType, criadoEm: f.createdTime,
      }));
      res.json({ cliente: { id: clienteId, nome: cliente.nomeRazaoSocial, email: cliente.email || null, telefone: cliente.telefone || null }, arquivos });
    } catch (e) {
      console.error("❌ Erro ao listar documentos:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/documentos/:clienteId/upload
  router.post("/api/documentos/:clienteId/upload", authenticate, uploadDoc.single("arquivo"), async (req, res) => {
    try {
      if (!GOOGLE_OK) return res.status(503).json({ message: "Google Drive não configurado" });
      if (!req.file) return res.status(400).json({ message: "Arquivo obrigatório" });
      const clienteId = parseInt(req.params.clienteId);
      const { tipo = "doc", ano, mes } = req.body;
      const anoN = parseInt(ano) || new Date().getFullYear();
      const mesN = parseInt(mes) || new Date().getMonth() + 1;
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { cpfCnpj: true, nomeRazaoSocial: true } });
      if (!cliente) return res.status(404).json({ message: "Cliente não encontrado" });
      const cpfCnpj = (cliente.cpfCnpj || "").replace(/\D/g, "");
      if (!cpfCnpj) return res.status(400).json({ message: "Cliente sem CPF/CNPJ" });
      const drive = _driveClient();
      const folderId = await _driveGetFolderId(drive, cpfCnpj, anoN, mesN);
      const ext = req.file.originalname.split(".").pop()?.toLowerCase() || "pdf";
      const nomeArquivo = await _driveNomeArquivo(drive, folderId, tipo, anoN, mesN, ext);
      const { Readable } = require("stream");
      const stream = new Readable();
      stream.push(req.file.buffer);
      stream.push(null);
      const uploaded = await drive.files.create({
        requestBody: { name: nomeArquivo, parents: [folderId], mimeType: req.file.mimetype },
        media: { mimeType: req.file.mimetype, body: stream },
        fields: "id, name, size, createdTime",
      });
      await prisma.auditoriaLog.create({
        data: {
          usuarioId: req.user.id, acao: "UPLOAD_DOCUMENTO_CLIENTE",
          entidade: "Cliente", entidadeId: clienteId,
          dadosDepois: { driveId: uploaded.data.id, nome: nomeArquivo, tipo, ano: anoN, mes: mesN },
          ip: req.ip,
        },
      });
      res.json({ driveId: uploaded.data.id, nome: nomeArquivo, tamanho: parseInt(uploaded.data.size || 0), criadoEm: uploaded.data.createdTime });
    } catch (e) {
      console.error("❌ Erro ao fazer upload de documento:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/documentos/:clienteId/enviar
  router.post("/api/documentos/:clienteId/enviar", authenticate, async (req, res) => {
    try {
      if (!GOOGLE_OK) return res.status(503).json({ message: "Google Drive não configurado" });
      const clienteId = parseInt(req.params.clienteId);
      const { driveId, nome, canal = "email", mensagemWA } = req.body;
      if (!driveId || !nome) return res.status(400).json({ message: "driveId e nome são obrigatórios" });
      const cliente = await prisma.cliente.findUnique({
        where: { id: clienteId }, select: { nomeRazaoSocial: true, email: true, telefone: true },
      });
      if (!cliente) return res.status(404).json({ message: "Cliente não encontrado" });
      const drive = _driveClient();
      const fileRes = await drive.files.get({ fileId: driveId, alt: "media" }, { responseType: "arraybuffer" });
      const fileBuffer = Buffer.from(fileRes.data);
      const canais = Array.isArray(canal) ? canal : [canal];
      const resultados = {};

      // E-mail
      if (canais.includes("email")) {
        if (!cliente.email) {
          resultados.email = { ok: false, error: "Cliente sem e-mail cadastrado" };
        } else if (!resend) {
          resultados.email = { ok: false, error: "Resend não configurado" };
        } else {
          try {
            await resend.emails.send({
              from: EMAIL_FROM, to: cliente.email,
              subject: `Addere — ${nome}`,
              html: `<p>Prezado(a) ${cliente.nomeRazaoSocial},</p><p>Segue em anexo o documento: <strong>${nome}</strong>.</p><p>Atenciosamente,<br>Addere</p>`,
              attachments: [{ filename: nome, content: fileBuffer }],
            });
            resultados.email = { ok: true };
          } catch (e) { resultados.email = { ok: false, error: e.message }; }
        }
      }

      // WhatsApp
      if (canais.includes("whatsapp")) {
        const waPhone = _waPhone(cliente.telefone);
        if (!waPhone || !WA_TOKEN || !WA_PHONE_NUMBER_ID) {
          resultados.whatsapp = { ok: false, error: !waPhone ? "Cliente sem telefone válido" : "WA não configurado" };
        } else {
          try {
            const mimeType = nome.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
            const formData = new FormData();
            formData.append("messaging_product", "whatsapp");
            formData.append("file", new Blob([fileBuffer], { type: mimeType }), nome);
            const uploadRes = await fetch(`${_waMediaBase}/${WA_PHONE_NUMBER_ID}/media`, {
              method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}` }, body: formData,
            });
            if (!uploadRes.ok) {
              resultados.whatsapp = { ok: false, error: await uploadRes.text() };
            } else {
              const { id: mediaId } = await uploadRes.json();
              const caption = mensagemWA || `Olá ${cliente.nomeRazaoSocial}, segue seu documento: ${nome}`;
              const sendRes = await fetch(WA_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
                body: JSON.stringify({
                  messaging_product: "whatsapp", to: waPhone, type: "document",
                  document: { id: mediaId, filename: nome, caption },
                }),
              });
              resultados.whatsapp = sendRes.ok ? { ok: true } : { ok: false, error: await sendRes.text() };
            }
          } catch (e) { resultados.whatsapp = { ok: false, error: e.message }; }
        }
      }

      await prisma.auditoriaLog.create({
        data: {
          usuarioId: req.user.id, acao: "ENVIAR_DOCUMENTO_CLIENTE",
          entidade: "Cliente", entidadeId: clienteId,
          dadosDepois: { driveId, nome, canais, resultados }, ip: req.ip,
        },
      });
      res.json({ resultados });
    } catch (e) {
      console.error("❌ Erro ao enviar documento:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/documentos/:clienteId/:driveId/download
  router.get("/api/documentos/:clienteId/:driveId/download", authenticate, async (req, res) => {
    try {
      if (!GOOGLE_OK) return res.status(503).json({ message: "Google Drive não configurado" });
      const { driveId } = req.params;
      const drive = _driveClient();
      const meta = await drive.files.get({ fileId: driveId, fields: "name, mimeType" });
      const fileRes = await drive.files.get({ fileId: driveId, alt: "media" }, { responseType: "arraybuffer" });
      const buf = Buffer.from(fileRes.data);
      res.setHeader("Content-Type", meta.data.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(meta.data.name)}"`);
      res.send(buf);
    } catch (e) {
      console.error("❌ Erro ao baixar documento:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE /api/documentos/:clienteId/:driveId (admin only)
  router.delete("/api/documentos/:clienteId/:driveId", authenticate, requireAdmin, async (req, res) => {
    try {
      if (!GOOGLE_OK) return res.status(503).json({ message: "Google Drive não configurado" });
      const clienteId = parseInt(req.params.clienteId);
      const { driveId } = req.params;
      const drive = _driveClient();
      await drive.files.delete({ fileId: driveId });
      await prisma.auditoriaLog.create({
        data: {
          usuarioId: req.user.id, acao: "REMOVER_DOCUMENTO_CLIENTE",
          entidade: "Cliente", entidadeId: clienteId,
          dadosDepois: { driveId }, ip: req.ip,
        },
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("❌ Erro ao remover documento:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

export default router;
