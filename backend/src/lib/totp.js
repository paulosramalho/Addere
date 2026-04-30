import crypto from "crypto";

const _B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function _b32decode(s) {
  const str = s.toUpperCase().replace(/=+$/, "");
  let bits = "", i = 0;
  for (; i < str.length; i++) { const idx = _B32.indexOf(str[i]); if (idx < 0) continue; bits += idx.toString(2).padStart(5, "0"); }
  const groups = bits.match(/.{8}/g) || [];
  return Buffer.from(groups.map(b => parseInt(b, 2)));
}

export function _b32encode(buf) {
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) { const chunk = bits.slice(i, i + 5); if (chunk.length < 5) break; out += _B32[parseInt(chunk, 2)]; }
  return out;
}

function _totpToken(secret, counter) {
  const key = _b32decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset+1] << 16) | (hmac[offset+2] << 8) | hmac[offset+3];
  return String(code % 1_000_000).padStart(6, "0");
}

export const totpGenerate = (s) => _totpToken(s, Math.floor(Date.now() / 1000 / 30));
export const totpVerify   = (token, s) => { const t = Math.floor(Date.now() / 1000 / 30); return [-1,0,1].some(d => _totpToken(s, t + d) === String(token).replace(/\s/g, "")); };
export const totpSecret   = () => _b32encode(crypto.randomBytes(20));
export const totpKeyUri   = (label, issuer, secret) => `otpauth://totp/${encodeURIComponent(issuer + ":" + label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
