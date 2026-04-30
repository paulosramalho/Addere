// API 31/01

export const BASE_URL =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "https://addere.onrender.com/api";

const TOKEN_KEY = "addere_token";
const USER_KEY = "addere_user";

export function setAuth(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// path deve começar com "/".
// Ex.: apiFetch("/auth/login") -> BASE_URL + "/auth/login"
export async function apiFetch(path, options = {}) {
  const token = getToken();

  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  // stringify SOMENTE se for objeto "plain" (e não FormData)
  if (options.body && typeof options.body === "object" && !isFormData) {
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      // Content-Type só para JSON; para FormData, NÃO setar (browser coloca boundary)
      ...(!isFormData && options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "ngrok-skip-browser-warning": "true",
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? options.body : undefined,
  });

  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Resposta inválida do servidor (${res.status}). Esperado JSON, recebido: ${text.slice(0, 80)}`
    );
  }

  // 401 => sessão expirada — só dispara se havia token ativo nesta requisição
  if (res.status === 401 && token && path !== "/auth/login") {
    window.dispatchEvent(new CustomEvent("addere:session-expired"));
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Erro HTTP ${res.status}`);
    err.data   = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

