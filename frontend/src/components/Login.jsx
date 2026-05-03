import { useMemo, useState } from "react";
import { apiFetch, setToken } from "../lib/api";

/**
 * Login (Admin/User)
 * - usa /api/auth/login
 * - salva token no localStorage (addere_token)
 * - chama onLoggedIn() pra App revalidar /api/auth/me e renderizar role
 */
export default function Login({ onLoggedIn }) {
  // Estados principais
  const [view, setView] = useState("login"); // "login" | "forgot" | "register"

  // Login
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Esqueci senha
  const [forgotEmail, setForgotEmail] = useState("");

  // Cadastro
  const [regNome, setRegNome] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regSenha, setRegSenha] = useState("");
  const [regSenhaConfirm, setRegSenhaConfirm] = useState("");
  const [regTelefone, setRegTelefone] = useState("");

  const canSubmitLogin = useMemo(() => {
    return email.trim().length > 3 && senha.trim().length >= 4 && !loading;
  }, [email, senha, loading]);

  const canSubmitForgot = useMemo(() => {
    return forgotEmail.trim().length > 3 && !loading;
  }, [forgotEmail, loading]);

  const canSubmitRegister = useMemo(() => {
    return (
      regNome.trim().length >= 3 &&
      regEmail.trim().length > 3 &&
      regSenha.length >= 6 &&
      regSenha === regSenhaConfirm &&
      !loading
    );
  }, [regNome, regEmail, regSenha, regSenhaConfirm, loading]);

  function resetForm() {
    setErro("");
    setSucesso("");
    setEmail("");
    setSenha("");
    setForgotEmail("");
    setRegNome("");
    setRegEmail("");
    setRegSenha("");
    setRegSenhaConfirm("");
    setRegTelefone("");
  }

  function switchView(newView) {
    resetForm();
    setView(newView);
  }

  // ===================== LOGIN =====================
  async function handleLogin(e) {
    e.preventDefault();
    setErro("");
    setSucesso("");
    setLoading(true);

    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), senha }),
      });

      if (!data?.token) {
        throw new Error("Login sem token. Verifique o backend.");
      }

      setToken(data.token);
      onLoggedIn?.();
    } catch (err) {
      setErro(err?.message || "Erro no login");
    } finally {
      setLoading(false);
    }
  }

  // ===================== ESQUECI SENHA =====================
  async function handleForgotPassword(e) {
    e.preventDefault();
    setErro("");
    setSucesso("");
    setLoading(true);

    try {
      const data = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });

      setSucesso(data?.message || "Solicitação enviada com sucesso!");
      setForgotEmail("");
    } catch (err) {
      setErro(err?.message || "Erro ao solicitar recuperação de senha");
    } finally {
      setLoading(false);
    }
  }

  // ===================== CADASTRO =====================
  async function handleRegister(e) {
    e.preventDefault();
    setErro("");
    setSucesso("");

    if (regSenha !== regSenhaConfirm) {
      setErro("As senhas não conferem.");
      return;
    }

    setLoading(true);

    try {
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          nome: regNome.trim(),
          email: regEmail.trim(),
          senha: regSenha,
          telefone: regTelefone.trim() || null,
        }),
      });

      setSucesso(data?.message || "Cadastro solicitado com sucesso!");
      setRegNome("");
      setRegEmail("");
      setRegSenha("");
      setRegSenhaConfirm("");
      setRegTelefone("");
    } catch (err) {
      setErro(err?.message || "Erro ao solicitar cadastro");
    } finally {
      setLoading(false);
    }
  }

  // ===================== RENDER =====================
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm">

        {/* ========== LOGIN ========== */}
        {view === "login" && (
          <>
            <div className="p-6 border-b border-slate-100">
              <div className="text-sm text-slate-500">Addere</div>
              <h1 className="text-xl font-semibold text-slate-900">Entrar</h1>
              <p className="text-sm text-slate-600 mt-1">
                Use seu e-mail e senha para acessar o Addere On.
              </p>
            </div>

            <form className="p-6 space-y-4" onSubmit={handleLogin}>
              <div>
                <label className="text-sm font-medium text-slate-700">E-mail</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Senha</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>

              {erro && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {erro}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmitLogin}
                className="w-full rounded-xl bg-slate-900 text-white py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
              >
                {loading ? "Entrando..." : "Entrar"}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => switchView("forgot")}
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Esqueci minha senha
                </button>
                <button
                  type="button"
                  onClick={() => switchView("register")}
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Criar conta
                </button>
              </div>
            </form>
          </>
        )}

        {/* ========== ESQUECI SENHA ========== */}
        {view === "forgot" && (
          <>
            <div className="p-6 border-b border-slate-100">
              <div className="text-sm text-slate-500">Addere</div>
              <h1 className="text-xl font-semibold text-slate-900">Recuperar Senha</h1>
              <p className="text-sm text-slate-600 mt-1">
                Informe seu e-mail para solicitar uma nova senha.
              </p>
            </div>

            <form className="p-6 space-y-4" onSubmit={handleForgotPassword}>
              <div>
                <label className="text-sm font-medium text-slate-700">E-mail</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="seu@email.com"
                  autoComplete="email"
                  required
                />
              </div>

              {erro && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {erro}
                </div>
              )}

              {sucesso && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {sucesso}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmitForgot}
                className="w-full rounded-xl bg-slate-900 text-white py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
              >
                {loading ? "Enviando..." : "Solicitar Nova Senha"}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchView("login")}
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Voltar para o login
                </button>
              </div>
            </form>
          </>
        )}

        {/* ========== CADASTRO ========== */}
        {view === "register" && (
          <>
            <div className="p-6 border-b border-slate-100">
              <div className="text-sm text-slate-500">Addere</div>
              <h1 className="text-xl font-semibold text-slate-900">Criar Conta</h1>
              <p className="text-sm text-slate-600 mt-1">
                Preencha os dados para solicitar acesso ao sistema.
              </p>
            </div>

            <form className="p-6 space-y-4" onSubmit={handleRegister}>
              <div>
                <label className="text-sm font-medium text-slate-700">Nome Completo *</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={regNome}
                  onChange={(e) => setRegNome(e.target.value)}
                  placeholder="Seu nome completo"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">E-mail *</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="seu@email.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Telefone</label>
                <input
                  type="tel"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={regTelefone}
                  onChange={(e) => setRegTelefone(e.target.value)}
                  placeholder="(11) 99999-9999"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Senha *</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={regSenha}
                  onChange={(e) => setRegSenha(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Confirmar Senha *</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-slate-200"
                  value={regSenhaConfirm}
                  onChange={(e) => setRegSenhaConfirm(e.target.value)}
                  placeholder="Repita a senha"
                  autoComplete="new-password"
                  required
                />
                {regSenha && regSenhaConfirm && regSenha !== regSenhaConfirm && (
                  <p className="text-xs text-rose-600 mt-1">As senhas não conferem</p>
                )}
              </div>

              {erro && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {erro}
                </div>
              )}

              {sucesso && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {sucesso}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmitRegister}
                className="w-full rounded-xl bg-slate-900 text-white py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
              >
                {loading ? "Enviando..." : "Solicitar Cadastro"}
              </button>

              <p className="text-xs text-slate-500 text-center">
                Seu cadastro será analisado pelo administrador.
              </p>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchView("login")}
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Já tenho conta, fazer login
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
