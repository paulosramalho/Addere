import { createRequire } from "module";
const require = createRequire(import.meta.url);

import { WA_TOKEN, WA_PHONE_NUMBER_ID, WA_API_URL, _waMediaBase } from "./whatsapp.js";

const IS_TEST = process.env.NODE_ENV === "test";

// Cache de pastas Drive para evitar chamadas repetidas (max 500 entradas — stable IDs)
const _driveBotFolderCache = new Map();
// Limpeza: descarta entradas mais antigas quando excede limite
function _driveCachePrune() {
  if (_driveBotFolderCache.size > 500) {
    const toDelete = [..._driveBotFolderCache.keys()].slice(0, _driveBotFolderCache.size - 400);
    toDelete.forEach(k => _driveBotFolderCache.delete(k));
  }
}
if (!IS_TEST) setInterval(_driveCachePrune, 60 * 60 * 1000); // a cada hora

// Lista arquivos disponíveis no Drive para os últimos 3 meses do cliente
async function _waBuildDriveContext(cpfCnpj) {
  const GDOK = !!(process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  if (!GDOK || !cpfCnpj) return [];
  try {
    const { google } = require("googleapis");
    const auth = new google.auth.OAuth2(process.env.GOOGLE_DRIVE_CLIENT_ID, process.env.GOOGLE_DRIVE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
    const drive = google.drive({ version: "v3", auth });
    const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const cpfDigits = String(cpfCnpj).replace(/\D/g, "");

    async function findFolder(parentId, name, key) {
      if (_driveBotFolderCache.has(key)) return _driveBotFolderCache.get(key);
      // Escape single quotes to prevent Drive API query injection
      const safeName = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const r = await drive.files.list({
        q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id)", spaces: "drive", pageSize: 1,
      });
      const id = r.data.files?.[0]?.id || null;
      if (id) { _driveBotFolderCache.set(key, id); _driveCachePrune(); }
      return id;
    }

    const clientesId = await findFolder(root, "Clientes", "Clientes");
    if (!clientesId) return [];
    const cpfFolderId = await findFolder(clientesId, cpfDigits, `cpf:${cpfDigits}`);
    if (!cpfFolderId) return [];

    const docs = [];
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ano = String(d.getFullYear());
      const mes = String(d.getMonth() + 1).padStart(2, "0");
      try {
        const anoId = await findFolder(cpfFolderId, ano, `cpf:${cpfDigits}/${ano}`);
        if (!anoId) continue;
        const mesId = await findFolder(anoId, mes, `cpf:${cpfDigits}/${ano}/${mes}`);
        if (!mesId) continue;
        const r = await drive.files.list({
          q: `'${mesId}' in parents and trashed = false`,
          fields: "files(id, name)", spaces: "drive",
        });
        for (const f of (r.data.files || [])) docs.push({ driveId: f.id, nome: f.name, ano, mes });
      } catch (_) { continue; }
    }
    return docs;
  } catch (e) {
    console.error("🤖 Drive context erro:", e.message);
    return [];
  }
}

// Baixa arquivo do Drive e envia via WhatsApp como documento
async function _waSendDocViaWA(toPhone, driveId, nome, clienteNome) {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) return;
  try {
    const { google } = require("googleapis");
    const auth = new google.auth.OAuth2(process.env.GOOGLE_DRIVE_CLIENT_ID, process.env.GOOGLE_DRIVE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
    const drive = google.drive({ version: "v3", auth });

    const fileRes = await drive.files.get({ fileId: driveId, alt: "media" }, { responseType: "arraybuffer" });
    const fileBuffer = Buffer.from(fileRes.data);

    const mimeType = nome.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("file", new Blob([fileBuffer], { type: mimeType }), nome);
    const uploadRes = await fetch(`${_waMediaBase}/${WA_PHONE_NUMBER_ID}/media`, {
      method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}` }, body: formData,
    });
    if (!uploadRes.ok) { console.error("🤖 WA upload doc erro:", await uploadRes.text()); return; }
    const { id: mediaId } = await uploadRes.json();

    const caption = `Segue o documento solicitado, ${clienteNome ? clienteNome.split(" ")[0] : ""}. 📎`.trim();
    const sendRes = await fetch(WA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: toPhone, type: "document",
        document: { id: mediaId, filename: nome, caption },
      }),
    });
    if (!sendRes.ok) console.error("🤖 WA send doc erro:", await sendRes.text());
    else console.log(`📎 Doc enviado via WA: ${nome} → ${toPhone}`);
  } catch (e) {
    console.error("🤖 _waSendDocViaWA erro:", e.message);
  }
}

export { _driveBotFolderCache, _driveCachePrune, _waBuildDriveContext, _waSendDocViaWA };
