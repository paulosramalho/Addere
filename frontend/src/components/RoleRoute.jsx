// frontend/src/lib/api.js
// API helper centralizado (Bearer + baseURL inteligente + 401 => logout)
// Diretriz: manter simples (sem libs) e fácil de remover/alterar.

const TOKEN_KEY = "addere_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
  // avisa o app (caso esteja aberto em outra aba também)
  try {
    window.dispatchEvent(new Event("amr:logout"));
  } catch {}
}

/**
 * Base URL:
 * - Dev: usa "/api" (com proxy do Vite)
 * - Prod (Vercel): aponta direto para o backend no Render
 * - Se existir VITE_API_BASE, ele manda.
 */
function resolveBaseUrl() {
  const envBase = import.meta?.env?.VITE_API_BASE;
  if (envBase && typeof envBase === "string" && envBase.trim()) return envBase.trim();

  // Em produção (Vercel), não existe /api; precisamos ir pro backend.
  if (typeof window !== "undefined") {
    const host = window.location?.hostname || "";
    if (host.includes("vercel.app")) {
      return "https://addere.onrender.com";
    }
  }

  // Dev padrão
  return "/api";
}

const BASE_URL = resolveBaseUrl();

async function parseResponse(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}

export async function apiFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // JSON helper
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });

  // 401: derruba sessão local
  if (res.status === 401) {
    clearToken();
    const data = await parseResponse(res).catch(() => null);
    const msg =
      (data && typeof data === "object" && data.message) ? data.message :
      "Não autenticado.";
    const err = new Error(msg);
    err.status = 401;
    err.data = data;
    throw err;
  }

  if (!res.ok) {
    const data = await parseResponse(res).catch(() => null);
    const msg =
      (data && typeof data === "object" && data.message) ? data.message :
      `Erro HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return await parseResponse(res);
}

export async function login(email, senha) {
  const data = await apiFetch("/api/auth/login", {
    method: "POST",
    body: { email, senha },
  });

  // backend tende a responder { token, user? }
  if (data?.token) setToken(data.token);

  return data;
}

export async function me() {
  return await apiFetch("/api/auth/me", { method: "GET" });
}
