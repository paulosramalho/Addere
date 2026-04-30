import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
export const EMAIL_FROM = process.env.EMAIL_FROM || "Addere Control <noreply@amr.com.br>";
export const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || null;

// Resend free tier: 2 req/s — pausa de 1100ms a cada 2 envios
let _emailsSentCount = 0;

export async function sendEmail({ to, subject, html, attachments }) {
  if (!resend) {
    console.warn("⚠️ RESEND_API_KEY não configurada. E-mail não enviado para:", to);
    return null;
  }
  try {
    const payload = { from: EMAIL_FROM, to, subject, html };
    if (attachments?.length) payload.attachments = attachments; // [{ filename, content: Buffer|base64 }]
    const result = await resend.emails.send(payload);
    console.log(`📧 E-mail enviado para ${to}: ${subject}`);
    _emailsSentCount++;
    if (_emailsSentCount % 2 === 0) {
      await new Promise(r => setTimeout(r, 1100));
    }
    return result;
  } catch (err) {
    console.error(`❌ Erro ao enviar e-mail para ${to}:`, err);
    return null;
  }
}

export function buildWhatsAppLink(message) {
  if (!ADMIN_WHATSAPP) return null;
  const phone = ADMIN_WHATSAPP.replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
