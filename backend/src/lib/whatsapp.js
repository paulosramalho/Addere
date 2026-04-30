export const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || null;
export const WA_TOKEN = process.env.WA_TOKEN || null;
export const WA_WABA_ID = process.env.WA_WABA_ID || null;
export const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || null;
export const WA_APP_SECRET = process.env.WA_APP_SECRET || null;

export const WA_API_URL = WA_PHONE_NUMBER_ID ? `https://graph.facebook.com/v19.0/${WA_PHONE_NUMBER_ID}/messages` : null;
export const _waMediaBase = "https://graph.facebook.com/v19.0";

/** Mapeia MIME type para o tipo de mensagem WA. */
export function _mimeToWATipo(mime) {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

async function _waSendText(digits, message) {
  try {
    const res = await fetch(WA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${WA_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: digits, type: "text", text: { body: message } }),
    });

    const raw = await res.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}

    if (!res.ok) {
      const code = body?.error?.code ?? null;
      const detail = body?.error?.error_data?.details || body?.error?.message || raw || `HTTP ${res.status}`;
      return { ok: false, httpStatus: res.status, code, detail, raw, body, wamid: null };
    }

    const wamid = body?.messages?.[0]?.id || null;
    return { ok: true, httpStatus: res.status, code: null, detail: null, raw, body, wamid };
  } catch (e) {
    return {
      ok: false,
      httpStatus: null,
      code: null,
      detail: e?.message || "Erro desconhecido ao enviar WhatsApp",
      raw: null,
      body: null,
      wamid: null,
    };
  }
}

/**
 * Envia mensagem de texto livre via WhatsApp (Meta Cloud API).
 * Fire-and-forget: nunca lanca excecao.
 */
export async function sendWhatsApp(phone, message) {
  if (!WA_API_URL || !WA_TOKEN) return { ok: false, skipped: true, reason: "not_configured" };
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return { ok: false, skipped: true, reason: "invalid_phone" };

  const result = await _waSendText(digits, message);
  if (!result.ok) {
    if (result.code === 131047) {
      console.info(`[WA] 131047 ${digits}: janela 24h expirada - mensagem nao entregue.`);
    } else {
      console.error("[WA] send error:", JSON.stringify({
        to: digits,
        status: result.httpStatus,
        code: result.code,
        detail: result.detail,
      }));
    }
    return result;
  }

  if (result.wamid) {
    console.log(`[WA] accepted by Meta for ${digits} (wamid ...${result.wamid.slice(-10)})`);
  }
  return result;
}

/** Versao estrita: lanca erro se falhar. Usar em rotas onde o usuario precisa saber. */
export async function sendWhatsAppStrict(phone, message) {
  if (!WA_API_URL || !WA_TOKEN) throw new Error("WhatsApp nao configurado no servidor.");
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) throw new Error("Numero de telefone invalido.");

  const result = await _waSendText(digits, message);
  if (!result.ok) {
    const code = result.code;
    const detail = result.detail || "";
    if (code === 131047 || String(detail).includes("24")) {
      throw new Error(
        "Mensagem nao entregue: o destinatario nao iniciou conversa com o numero Addere nas ultimas 24h. " +
        "Peca ao cliente para enviar uma mensagem primeiro, ou use o chat WhatsApp do sistema."
      );
    }
    const statusLabel = result.httpStatus ? `Meta API ${result.httpStatus}` : "Meta API";
    throw new Error(`${statusLabel}: ${detail}`);
  }

  return result;
}

/** Envia mensagem via template aprovado pela Meta (retry opcional, default 3x). */
export async function sendWhatsAppTemplate(phone, templateName, langCode = "pt_BR", components = [], opts = {}) {
  if (!WA_API_URL || !WA_TOKEN) return;
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return;
  const payload = {
    messaging_product: "whatsapp",
    to: digits,
    type: "template",
    template: { name: templateName, language: { code: langCode }, ...(components.length ? { components } : {}) },
  };
  const maxAttemptsNum = Number(opts?.maxAttempts);
  const MAX_ATTEMPTS = Number.isFinite(maxAttemptsNum) && maxAttemptsNum >= 1
    ? Math.trunc(maxAttemptsNum)
    : 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(WA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${WA_TOKEN}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
      const err = await res.text();
      if (attempt === MAX_ATTEMPTS) console.error(`[WA] template \"${templateName}\" falhou apos ${MAX_ATTEMPTS} tentativas:`, err);
      else await new Promise((r) => setTimeout(r, attempt * 2000));
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) console.error(`[WA] template \"${templateName}\" erro:`, e.message);
      else await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

/** Normaliza numero para E.164 sem "+" (ex: "5591999990000"). */
export function _waPhone(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d || d.length < 8) return null;
  if (d.startsWith("55") && d.length >= 12) return d;
  return "55" + d;
}

/** Normaliza numero para DDD(2) + 8 digitos centrais (remove 9 de portabilidade). */
export function _normalizePhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  const local = d.slice(2);
  const core8 = (local.length === 9 && local.startsWith("9")) ? local.slice(1) : local.slice(-8);
  return ddd + core8;
}
