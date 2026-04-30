// src/lib/validators.js
export function onlyDigits(v = "") {
  return String(v).replace(/\D/g, "");
}

export function maskCPF(value = "") {
  const d = onlyDigits(value).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

export function isValidCPF(cpf = "") {
  const c = onlyDigits(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const calc = (baseLen) => {
    let sum = 0;
    for (let i = 0; i < baseLen; i++) {
      sum += Number(c[i]) * (baseLen + 1 - i);
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc(9);
  const d2 = (() => {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(c[i]) * (11 - i);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  })();

  return Number(c[9]) === d1 && Number(c[10]) === d2;
}

export function maskPhoneBR(value = "") {
  const d = onlyDigits(value).slice(0, 11);
  const dd = d.slice(0, 2);
  const p1 = d.slice(2, 3);
  const p2 = d.slice(3, 7);
  const p3 = d.slice(7, 11);

  if (d.length === 0) return "";
  if (d.length < 3) return `(${dd}`;
  if (d.length < 7) return `(${dd}) ${p1} ${p2}`;
  return `(${dd}) ${p1} ${p2}-${p3}`;
}

export function isValidPhoneBR(value = "") {
  const d = onlyDigits(value);
  // padrão solicitado: (99) 9 9999-9999 => 11 dígitos
  return d.length === 11;
}

export function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

export function normalizeOAB(value = "") {
  return String(value).trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizePixKey(value = "") {
  return String(value).trim();
}

export function maskCNPJ(v = "") {
  const d = onlyDigits(v).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  if (d.length <= 2) return p1;
  if (d.length <= 5) return `${p1}.${p2}`;
  if (d.length <= 8) return `${p1}.${p2}.${p3}`;
  if (d.length <= 12) return `${p1}.${p2}.${p3}/${p4}`;
  return `${p1}.${p2}.${p3}/${p4}-${p5}`;
}

export function isValidCNPJ(cnpj = "") {
  const c = onlyDigits(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += Number(c[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return Number(c[12]) === calc(12) && Number(c[13]) === calc(13);
}

/** Aplica máscara CPF ou CNPJ automaticamente conforme tamanho */
export function maskCPFCNPJ(v = "") {
  const d = onlyDigits(v);
  return d.length <= 11 ? maskCPF(d) : maskCNPJ(d);
}

/** Valida CPF ou CNPJ automaticamente conforme tamanho */
export function isValidCPFCNPJ(v = "") {
  const d = onlyDigits(v);
  if (d.length === 14) return isValidCNPJ(d);
  if (d.length === 11) return isValidCPF(d);
  return false;
}
