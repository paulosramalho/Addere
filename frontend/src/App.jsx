// src/App.jsx - Design Modernizado + Ajustes - 26/01/26
import React, { useEffect, useMemo, useState, useRef, useCallback, Suspense, lazy } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import logoSrc from "./assets/logo.png";
import { BASE_URL, apiFetch, setAuth, getUser, getToken, clearAuth } from "./lib/api";
import { brlFromCentavos } from "./lib/formatters";
import "./styles/dossie_print.css";

// Lazy loading — cada página é carregada apenas quando acessada pela primeira vez.
// Reduz o bundle inicial de ~2.5 MB para ~200 kB.
const DashboardFinanceiro           = lazy(() => import("./pages/DashboardFinanceiro"));
const ContratoPage                  = lazy(() => import("./pages/Contrato"));
const PagamentosPage                = lazy(() => import("./pages/Pagamentos"));
const Boletos                       = lazy(() => import("./pages/Boletos"));
const PixManager                    = lazy(() => import("./pages/PixManager"));
const InterPagarBoleto              = lazy(() => import("./pages/InterPagarBoleto"));
const C6Operacoes                   = lazy(() => import("./pages/C6Operacoes"));
const ClientesPage                  = lazy(() => import("./pages/Clientes"));
const UsuariosPage                  = lazy(() => import("./pages/Usuarios"));
const LivroCaixaContas              = lazy(() => import("./pages/LivroCaixaContas"));
const LivroCaixaLancamentos         = lazy(() => import("./pages/LivroCaixaLancamentos"));
const LivroCaixaVisualizacao        = lazy(() => import("./pages/LivroCaixaVisualizacao"));
const LivroCaixaEmissao             = lazy(() => import("./pages/LivroCaixaEmissao"));
const VencidosEmAberto              = lazy(() => import("./pages/VencidosEmAberto"));
const ImportacaoLivroCaixaPdf       = lazy(() => import("./pages/ImportacaoLivroCaixaPdf"));
const UtilitariosDisparoEmail       = lazy(() => import("./pages/UtilitariosDisparoEmail"));
const ComprovantesRecebidos         = lazy(() => import("./pages/ComprovantesRecebidos"));
const RelatorioFluxoCaixaConsolidado= lazy(() => import("./pages/RelatorioFluxoCaixaConsolidado"));
const RelatorioFluxoCaixaDiario     = lazy(() => import("./pages/RelatorioFluxoCaixaDiario"));
const RelatorioFluxoCaixaGrafico    = lazy(() => import("./pages/RelatorioFluxoCaixaGrafico"));
const RelatorioFluxoCaixaPorConta   = lazy(() => import("./pages/RelatorioFluxoCaixaPorConta"));
const RelatorioFluxoCaixaProjetado  = lazy(() => import("./pages/RelatorioFluxoCaixaProjetado"));
const RelatorioFluxoCaixaComparativo= lazy(() => import("./pages/RelatorioFluxoCaixaComparativo"));
const RelatorioFluxoCaixaDesempenho = lazy(() => import("./pages/RelatorioFluxoCaixaDesempenho"));
const RelatorioSaudeFinanceira      = lazy(() => import("./pages/RelatorioSaudeFinanceira"));
const RelatorioClientesFornecedores = lazy(() => import("./pages/RelatorioClientesFornecedores"));
const FluxodeCaixa                  = lazy(() => import("./pages/FluxodeCaixa"));
const NoticeBoard                   = lazy(() => import("./pages/NoticeBoard"));
const Auditoria                     = lazy(() => import("./pages/Auditoria"));
const Agenda                        = lazy(() => import("./pages/Agenda"));
const LogOperacoes                  = lazy(() => import("./pages/LogOperacoes"));
const DuplicadosClientes            = lazy(() => import("./pages/DuplicadosClientes"));
const EmissaoNotaFiscal             = lazy(() => import("./pages/EmissaoNotaFiscal"));
const DocumentosCliente             = lazy(() => import("./pages/DocumentosCliente"));
const ConfiguracaoEmpresa           = lazy(() => import("./pages/ConfiguracaoEmpresa"));
const WhatsAppInbox                 = lazy(() => import("./pages/WhatsAppInbox"));
const DossieReport                  = lazy(() => import("./components/DossieReport"));
const Seguranca2FA                  = lazy(() => import("./pages/Seguranca2FA"));
const UIShowcase                    = lazy(() => import("./pages/UIShowcase"));

import { Breadcrumbs } from "./components/Breadcrumbs";
import { ToastProvider, useToast } from "./components/Toast";
import { Tooltip } from "./components/Tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import GlobalSearch from "./components/GlobalSearch";
import LockScreen from "./components/LockScreen";

/* ---------------- Loading Screen ---------------- */
function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center z-50">
      <div className="text-center">
        {/* Logo animado */}
        <div className="relative inline-block mb-8">
          <div className="absolute inset-0 bg-blue-500/30 rounded-full blur-3xl animate-pulse"></div>
          <div className="relative p-6 bg-white/10 backdrop-blur-sm rounded-3xl border border-white/20">
            <img src={logoSrc} alt="Addere" className="h-16 brightness-0 invert animate-pulse" />
          </div>
        </div>

        {/* Spinner */}
        <div className="flex justify-center mb-6">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-white/20 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-t-blue-400 rounded-full animate-spin"></div>
          </div>
        </div>

        {/* Texto */}
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white">Carregando...</h2>
          <p className="text-blue-200 text-sm">Preparando seu ambiente</p>
        </div>

        {/* Barra de progresso */}
        <div className="mt-8 w-64 h-2 bg-white/10 rounded-full overflow-hidden mx-auto">
          <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full animate-[loading_1.5s_ease-in-out_infinite]"></div>
        </div>
      </div>

      <style>{`
        @keyframes loading {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
      `}</style>
    </div>
  );
}

/* ---------------- clock ---------------- */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n) => String(n).padStart(2, "0");
  const d = now;
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

/* ---------------- idle timer ---------------- */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
const IDLE_WARNING_MS = 25 * 60 * 1000; // aviso aos 25 minutos

function useIdleTimer(onWarning, onTimeout, paused = false) {
  const lastActivityRef = useRef(Date.now());
  const warningShownRef = useRef(false);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningShownRef.current = false;
  }, []);

  useEffect(() => {
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    const handleActivity = () => {
      if (pausedRef.current) return;
      lastActivityRef.current = Date.now();
      if (warningShownRef.current) {
        warningShownRef.current = false;
      }
    };
    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }));

    const checkInterval = setInterval(() => {
      if (pausedRef.current) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= IDLE_TIMEOUT_MS) {
        onTimeout();
      } else if (elapsed >= IDLE_WARNING_MS && !warningShownRef.current) {
        warningShownRef.current = true;
        onWarning();
      }
    }, 10000); // verifica a cada 10 segundos

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      clearInterval(checkInterval);
    };
  }, [onWarning, onTimeout]);

  return { resetTimer };
}

/* ---------------- placeholders ---------------- */
function Placeholder({ title }) {
  const navigate = useNavigate();
  const is404 = title?.includes("não encontrada");
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        {is404 ? (
          <>
            <div className="text-7xl font-black text-slate-200 mb-2">404</div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">Página não encontrada</h1>
            <p className="text-sm text-slate-500 mb-6">O endereço acessado não existe ou foi movido.</p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">🚧</div>
            <h1 className="text-lg font-bold text-slate-800 mb-2">{title}</h1>
            <p className="text-sm text-slate-500 mb-6">Esta seção está em desenvolvimento.</p>
          </>
        )}
        <button
          onClick={() => navigate("/noticeboard")}
          className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700"
        >
          Ir para o início
        </button>
      </div>
    </div>
  );
}


/* ---------------- Histórico (Dossiê de Pagamentos) ---------------- */
function HistoricoPage() {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [selecionados, setSelecionados] = useState([]); // contratoId[]
  const [loading, setLoading] = useState(false);

  async function loadBase() {
    setLoading(true);
    try {
      // Clientes: GET /api/clients (apenas tipo C=Cliente ou A=Ambos)
      const c = await apiFetch("/clients?tipo=C,A");
      setClientes(Array.isArray(c) ? c : []);

      // Contratos/Avulsos: GET /api/contratos
      // (Avulsos são contratos com número iniciando em "AV-")
      const all = await apiFetch("/contratos");
      setContratos(Array.isArray(all) ? all : []);
    } catch (e) {
      addToast(e?.message || "Falha ao carregar dados do Histórico", "error");
    } finally {
      setLoading(false);
    }
  }

  const contratosDoCliente = useMemo(() => {
    const id = Number(clienteId);
    if (!id) return [];
    return (contratos || []).filter((ct) => Number(ct?.cliente?.id) === id);
  }, [contratos, clienteId]);

  // Monta árvore: pai (original) -> filhos (renegociações) -> ...
  const arvore = useMemo(() => {
    const nodes = new Map();
    for (const ct of contratosDoCliente) {
      nodes.set(Number(ct.id), { ...ct, _id: Number(ct.id), _children: [] });
    }
    for (const node of nodes.values()) {
      const pid = node.contratoOrigemId ? Number(node.contratoOrigemId) : null;
      if (pid && nodes.has(pid)) {
        nodes.get(pid)._children.push(node);
      }
    }

    const roots = [];
    for (const node of nodes.values()) {
      const pid = node.contratoOrigemId ? Number(node.contratoOrigemId) : null;
      if (!pid || !nodes.has(pid)) roots.push(node);
    }

    const sortFn = (a, b) => {
      // Tenta ordenar por createdAt, senão por número/id
      const da = a.createdAt ? new Date(a.createdAt).getTime() : null;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : null;
      if (da != null && db != null && da !== db) return da - db;
      const na = String(a.numeroContrato || "");
      const nb = String(b.numeroContrato || "");
      if (na && nb && na !== nb) return na.localeCompare(nb, "pt-BR");
      return a._id - b._id;
    };

    function sortTree(node) {
      node._children.sort(sortFn);
      node._children.forEach(sortTree);
    }

    roots.sort(sortFn);
    roots.forEach(sortTree);

    return roots;
  }, [contratosDoCliente]);

  function toggleSelecionado(id) {
    setSelecionados((prev) => {
      const n = Number(id);
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      return [...prev, n];
    });
  }

  async function gerarPDFs() {
    const cid = Number(clienteId);
    if (!cid || selecionados.length === 0) {
      addToast("Selecione o cliente e ao menos 1 contrato/pagamento avulso.", "warning");
      return;
    }

    setLoading(true);
    try {
      const token = getToken();
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      // Regra: 1 item selecionado = 1 PDF
      // Observação: o PDF do item escolhido já inclui a sequência (ele + renegociações descendentes).
      const uniq = Array.from(new Set(selecionados.map(Number)));

      for (const contratoId of uniq) {
        const resp = await fetch(`${API}/historico/dossie-pagamentos/pdf`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ clienteId: cid, contratoId }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err?.message || "Erro ao gerar dossiê");
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      }

      // fecha modal ao final
      setOpen(false);
      setClienteId("");
      setSelecionados([]);
    } catch (e) {
      addToast(e?.message || "Falha ao gerar PDFs", "error");
    } finally {
      setLoading(false);
    }
  }

  function renderNode(ct, depth = 0) {
    const isAvulso = String(ct.numeroContrato || "").toUpperCase().startsWith("AV-");
    const checked = selecionados.includes(Number(ct.id));
    const indentPx = depth * 16;

    return (
      <div key={ct.id} style={{ paddingLeft: indentPx }}>
        <label className="flex items-start gap-3 cursor-pointer py-1">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleSelecionado(ct.id)}
            disabled={loading}
            className="mt-1"
          />
          <div className="text-sm">
            <div className="font-semibold text-slate-900">
              {isAvulso ? "Pagamento Avulso" : "Contrato"} {ct.numeroContrato}
            </div>
            <div className="text-xs text-slate-600">
              Valor: {brlFromCentavos(ct?.valorTotal)}
              {ct?.contratoOrigemId ? ` • Renegociado de ID: ${ct.contratoOrigemId}` : ""}
              {ct?._children?.length ? ` • Filhos: ${ct._children.length}` : ""}
            </div>
          </div>
        </label>

        {ct?._children?.length ? (
          <div className="border-l border-slate-200 ml-2 pl-2">
            {ct._children.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-slate-900">Histórico</div>
          <div className="mt-1 text-sm text-slate-600">
            Gere o Dossiê de Pagamentos (PDF) por cliente e por contrato/pagamento avulso.
          </div>
        </div>

        <button
          onClick={() => {
            setOpen(true);
            loadBase();
          }}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
        >
          Gerar Dossiê (PDF)
        </button>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !loading && setOpen(false)} />
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-slate-900">Dossiê de Pagamentos (PDF)</div>
                <div className="text-sm text-slate-600">
                  Se você selecionar vários itens, cada um gera 1 PDF separado (paginação 1/TT).
                  <br />
                  Hierarquia: pai (original) → filhos (renegociações) logo abaixo.
                  <br />
                  Selecionando um renegociado (ex.: R2), entram apenas ele e os seus descendentes (R2 → R3 → ...).
                </div>
              </div>
              <button
                className="text-slate-500 hover:text-slate-800"
                onClick={() => !loading && setOpen(false)}
                title="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700">Cliente</label>
                  <select
                    className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                    value={clienteId}
                    onChange={(e) => {
                      setClienteId(e.target.value);
                      setSelecionados([]);
                    }}
                    disabled={loading}
                  >
                    <option value="">Selecione...</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nomeRazaoSocial}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Contratos / Recebimentos</label>
                  <div className="mt-1 max-h-56 overflow-auto border border-slate-200 rounded-xl p-3">
                    {!clienteId ? (
                      <div className="text-sm text-slate-500">Selecione um cliente para listar os itens.</div>
                    ) : contratosDoCliente.length === 0 ? (
                      <div className="text-sm text-slate-500">Nenhum item encontrado para este cliente.</div>
                    ) : (
                      <div className="space-y-1">{arvore.map((ct) => renderNode(ct, 0))}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => !loading && setOpen(false)}
                disabled={loading}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
                onClick={gerarPDFs}
                disabled={loading || !clienteId || selecionados.length === 0}
              >
                {loading ? "Gerando..." : "Gerar Dossiê (PDF)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/* ---------------- Helper: Iniciais do Nome ---------------- */
function getInitials(fullName) {
  if (!fullName) return "U";
  
  const parts = fullName.trim().split(/\s+/);
  
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  
  const firstInitial = parts[0].charAt(0).toUpperCase();
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  
  return firstInitial + lastInitial;
}

/* ---------------- Trocar Senha Obrigatória ---------------- */
function TrocarSenhaObrigatoria({ user, onSuccess }) {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showNova, setShowNova] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    if (novaSenha.length < 6) { setErro("A nova senha deve ter pelo menos 6 caracteres."); return; }
    if (novaSenha !== confirmar) { setErro("As senhas não conferem."); return; }
    setLoading(true);
    try {
      await apiFetch("/auth/trocar-senha", { method: "PUT", body: { novaSenha } });
      // update stored user
      const stored = JSON.parse(localStorage.getItem("addere_user") || "{}");
      stored.deveTrocarSenha = false;
      localStorage.setItem("addere_user", JSON.stringify(stored));
      onSuccess({ ...user, deveTrocarSenha: false });
    } catch (err) {
      setErro(err?.message || "Erro ao alterar senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-6 z-50">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute top-1/2 -right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-700" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="backdrop-blur-xl bg-white/10 rounded-3xl border border-white/20 shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30 mb-4">
              <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Redefinir sua senha</h1>
            <p className="text-blue-200 text-sm">
              Olá, <span className="font-semibold text-white">{user?.nome?.split(" ")[0]}</span>! Por segurança, defina uma nova senha antes de continuar.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Nova senha */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white/90">Nova senha</label>
              <div className="relative">
                <input
                  type={showNova ? "text" : "password"}
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all pr-12"
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                  required
                />
                <button type="button" onClick={() => setShowNova(!showNova)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {showNova
                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                    }
                  </svg>
                </button>
              </div>
            </div>

            {/* Confirmar */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white/90">Confirmar nova senha</label>
              <div className="relative">
                <input
                  type={showConf ? "text" : "password"}
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all pr-12"
                  placeholder="Repita a nova senha"
                  autoComplete="new-password"
                  required
                />
                <button type="button" onClick={() => setShowConf(!showConf)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {showConf
                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                    }
                  </svg>
                </button>
              </div>
              {/* inline match indicator */}
              {confirmar.length > 0 && (
                <p className={`text-xs mt-1 ${novaSenha === confirmar ? "text-emerald-400" : "text-red-400"}`}>
                  {novaSenha === confirmar ? "✓ Senhas conferem" : "✗ Senhas não conferem"}
                </p>
              )}
            </div>

            {erro && (
              <div className="rounded-xl bg-red-500/20 backdrop-blur-sm border border-red-500/30 text-red-200 text-sm px-4 py-3">
                {erro}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || novaSenha !== confirmar || novaSenha.length < 6}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-4 py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Salvando..." : "Definir nova senha e entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Login Modernizado ---------------- */
function Login({ onLogin }) {
  const [view, setView] = useState("login"); // "login" | "forgot" | "register" | "totp"
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState("");

  // Register
  const [regNome, setRegNome] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regSenha, setRegSenha] = useState("");
  const [regSenhaConfirm, setRegSenhaConfirm] = useState("");
  const [regTelefone, setRegTelefone] = useState("");

  function formatPhone(value) {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits.length ? `(${digits}` : "";
    if (digits.length <= 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  function switchView(newView) {
    setView(newView);
    setError("");
    setSuccess("");
    setEmail("");
    setSenha("");
    setForgotEmail("");
    setRegNome("");
    setRegEmail("");
    setRegSenha("");
    setRegSenhaConfirm("");
    setRegTelefone("");
  }

  async function submitLogin(e) {
    e.preventDefault();
    if (isSubmitting) return;

    setError("");
    setIsSubmitting(true);

    try {
      const resp = await apiFetch("/auth/login", {
        method: "POST",
        body: { email, senha },
      });

      if (resp.requires2fa) {
        setTempToken(resp.tempToken);
        setTotpCode("");
        setView("totp");
        return;
      }

      if (!resp.token) {
        throw new Error("Token não retornado");
      }

      setAuth(resp.token, resp.usuario);
      onLogin(resp.usuario);
    } catch (err) {
      setError(err?.message || "Credenciais inválidas");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitTotp(e) {
    e.preventDefault();
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      const resp = await apiFetch("/auth/2fa/verify-login", {
        method: "POST",
        body: { tempToken, code: totpCode.replace(/\s/g, "") },
      });
      if (!resp.token) throw new Error("Token não retornado");
      setAuth(resp.token, resp.usuario);
      onLogin(resp.usuario);
    } catch (err) {
      setError(err?.message || "Código inválido ou expirado");
      setTotpCode("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitForgotPassword(e) {
    e.preventDefault();
    if (isSubmitting) return;

    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const resp = await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: { email: forgotEmail.trim() },
      });

      setSuccess(resp?.message || "Solicitação enviada! Entre em contato com o administrador para obter a nova senha.");
      setForgotEmail("");
    } catch (err) {
      setError(err?.message || "Erro ao solicitar recuperação de senha");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitRegister(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (regSenha !== regSenhaConfirm) {
      setError("As senhas não conferem");
      return;
    }

    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const resp = await apiFetch("/auth/register", {
        method: "POST",
        body: {
          nome: regNome.trim(),
          email: regEmail.trim(),
          senha: regSenha,
          telefone: regTelefone.trim() || null,
        },
      });

      setSuccess(resp?.message || "Cadastro solicitado! Aguarde a aprovação do administrador.");
      setRegNome("");
      setRegEmail("");
      setRegSenha("");
      setRegSenhaConfirm("");
      setRegTelefone("");
    } catch (err) {
      setError(err?.message || "Erro ao solicitar cadastro");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Efeitos de fundo animados */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-1/2 -right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-700"></div>
        <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      {/* Grid de fundo */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>

      <div className="relative flex items-center justify-center min-h-screen p-6">
        <div className="w-full max-w-md">
          {/* Card com Glassmorphism */}
          <div className="relative backdrop-blur-xl bg-white/10 rounded-3xl border border-white/20 shadow-2xl p-8 animate-[fadeIn_0.5s_ease-out]">
            {/* Brilho superior */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-blue-400/30 rounded-full blur-3xl"></div>

            {/* Logo e Título */}
            <div className="text-center mb-8 relative">
              <div className="inline-block p-4 bg-white/10 backdrop-blur-sm rounded-2xl mb-4 border border-white/20">
                <img src={logoSrc} alt="Addere" className="h-12" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">
                {view === "login" && "Bem-vindo"}
                {view === "forgot" && "Recuperar Senha"}
                {view === "register" && "Criar Conta"}
                {view === "totp" && "Verificação 2FA"}
              </h1>
              <p className="text-blue-200 text-sm">
                {view === "login" && "Sistema de Gestão Financeira Addere"}
                {view === "forgot" && "Informe seu e-mail para solicitar uma nova senha"}
                {view === "register" && "Preencha os dados para solicitar acesso"}
                {view === "totp" && "Digite o código do seu aplicativo autenticador"}
              </p>
            </div>

            {/* ========== LOGIN FORM ========== */}
            {view === "login" && (
              <form onSubmit={submitLogin} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">E-mail</label>
                  <div className="relative">
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all"
                      placeholder="seu@email.com"
                      autoComplete="email"
                      type="email"
                      required
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">Senha</label>
                  <div className="relative">
                    <input
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all pr-12"
                      placeholder="••••••••"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                    >
                      {showPassword ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl bg-red-500/20 backdrop-blur-sm border border-red-500/30 text-red-200 text-sm px-4 py-3 flex items-center gap-3 animate-[shake_0.3s_ease-in-out]">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-4 py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/50 hover:shadow-blue-500/70 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Entrando...
                    </span>
                  ) : (
                    "Entrar no Sistema"
                  )}
                </button>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => switchView("forgot")}
                    className="text-blue-300 hover:text-blue-200 transition-colors font-medium"
                  >
                    Esqueci minha senha
                  </button>
                  <button
                    type="button"
                    onClick={() => switchView("register")}
                    className="text-blue-300 hover:text-blue-200 transition-colors font-medium"
                  >
                    Criar conta
                  </button>
                </div>
              </form>
            )}

            {/* ========== TOTP FORM ========== */}
            {view === "totp" && (
              <form onSubmit={submitTotp} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">Código de 6 dígitos</label>
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all text-center text-2xl tracking-[0.4em] font-mono"
                    placeholder="000000"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    required
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-red-500/20 backdrop-blur-sm border border-red-500/30 text-red-200 text-sm px-4 py-3 flex items-center gap-3">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || totpCode.length < 6}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-4 py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/50 hover:shadow-blue-500/70 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Verificando…" : "Verificar Código"}
                </button>

                <button
                  type="button"
                  onClick={() => { setView("login"); setError(""); setTotpCode(""); setTempToken(""); }}
                  className="w-full text-center text-sm text-blue-300 hover:text-blue-200 transition-colors"
                >
                  Voltar para o login
                </button>
              </form>
            )}

            {/* ========== FORGOT PASSWORD FORM ========== */}
            {view === "forgot" && (
              <form onSubmit={submitForgotPassword} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">E-mail</label>
                  <div className="relative">
                    <input
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all"
                      placeholder="seu@email.com"
                      autoComplete="email"
                      type="email"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl bg-red-500/20 backdrop-blur-sm border border-red-500/30 text-red-200 text-sm px-4 py-3">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="rounded-xl bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3">
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || !forgotEmail.trim()}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-4 py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/50 hover:shadow-blue-500/70 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Enviando..." : "Solicitar Nova Senha"}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => switchView("login")}
                    className="text-sm text-blue-300 hover:text-blue-200 transition-colors font-medium"
                  >
                    Voltar para o login
                  </button>
                </div>
              </form>
            )}

            {/* ========== REGISTER FORM ========== */}
            {view === "register" && (
              <form onSubmit={submitRegister} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">Nome Completo *</label>
                  <input
                    value={regNome}
                    onChange={(e) => setRegNome(e.target.value)}
                    className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all"
                    placeholder="Seu nome completo"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">E-mail *</label>
                  <input
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all"
                    placeholder="seu@email.com"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">Telefone</label>
                  <input
                    value={regTelefone}
                    onChange={(e) => setRegTelefone(formatPhone(e.target.value))}
                    className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all"
                    placeholder="(91) 9 9999-9999"
                    type="tel"
                    maxLength={16}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">Senha *</label>
                  <input
                    value={regSenha}
                    onChange={(e) => setRegSenha(e.target.value)}
                    className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all"
                    placeholder="Mínimo 6 caracteres"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/90">Confirmar Senha *</label>
                  <input
                    value={regSenhaConfirm}
                    onChange={(e) => setRegSenhaConfirm(e.target.value)}
                    className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 transition-all"
                    placeholder="Repita a senha"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                  {regSenha && regSenhaConfirm && regSenha !== regSenhaConfirm && (
                    <p className="text-xs text-red-300 mt-1">As senhas não conferem</p>
                  )}
                </div>

                {error && (
                  <div className="rounded-xl bg-red-500/20 backdrop-blur-sm border border-red-500/30 text-red-200 text-sm px-4 py-3">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="rounded-xl bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3">
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || !regNome.trim() || !regEmail.trim() || regSenha.length < 6 || regSenha !== regSenhaConfirm}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-4 py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/50 hover:shadow-blue-500/70 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Enviando..." : "Solicitar Cadastro"}
                </button>

                <p className="text-xs text-white/50 text-center">
                  Seu cadastro será analisado pelo administrador.
                </p>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => switchView("login")}
                    className="text-sm text-blue-300 hover:text-blue-200 transition-colors font-medium"
                  >
                    Já tenho conta, fazer login
                  </button>
                </div>
              </form>
            )}

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-white/10 text-center">
              <p className="text-xs text-white/50">
                © 2026 Addere. Todos os direitos reservados.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          75% { transform: translateX(10px); }
        }
      `}</style>
    </div>
  );
}

/* ---------------- Shell ---------------- */
function Shell({ user, onLogout }) {
  const clock = useClock();
  const location = useLocation();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const isSecretaria = user?.tipoUsuario === "SECRETARIA_VIRTUAL";
  const userLabel = isSecretaria ? "Secretária Virtual" : isAdmin ? "Administrador" : "Usuário";
  const [openSettings, setOpenSettings] = useState(false);
  const [openLivroCaixa, setOpenLivroCaixa] = useState(false);
  const [openDashboard, setOpenDashboard] = useState(false);
  const [openRelatorios, setOpenRelatorios] = useState(false);
  const [openUtilitarios, setOpenUtilitarios] = useState(false);
  const [openJuridico, setOpenJuridico] = useState(false);
  const [openInterOps, setOpenInterOps] = useState(false);
  const [openC6Ops, setOpenC6Ops] = useState(false);
  const lastMsgIdRef = React.useRef(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(user);
  const avatarInputRef = React.useRef(null);
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [isLocked, setIsLocked] = useState(() => sessionStorage.getItem("addere_locked") === "1");
  const [vencidosTotal, setVencidosTotal] = useState(0);
  const [agendaCount, setAgendaCount] = useState(0);
  const [waUnread, setWaUnread] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("addere_sidebar_collapsed") === "1");

  useEffect(() => {
    localStorage.setItem("addere_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  // Polling badge Vencidos em Aberto (a cada 5 min, só para não-secretaria)
  const fetchVencidosCount = React.useCallback(async () => {
    if (!user || isSecretaria) return;
    try {
      const d = await apiFetch("/livro-caixa/vencidos-em-aberto/contagem");
      setVencidosTotal(d.total || 0);
    } catch (_) {}
  }, [user, isSecretaria]);

  useEffect(() => {
    if (!user || isSecretaria) return;
    fetchVencidosCount();
    const t = setInterval(fetchVencidosCount, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchVencidosCount]);

  // Polling badge Agenda (a cada 5 min) — inclui convites pendentes
  const prevConvitesRef = React.useRef(null);
  const fetchAgendaCount = React.useCallback(async () => {
    if (!user) return;
    try {
      const d = await apiFetch("/agenda/contagem");
      const convites = d.convitesPendentes || 0;
      setAgendaCount((d.hoje || 0) + convites);
      if (prevConvitesRef.current !== null && convites > prevConvitesRef.current) {
        const novos = convites - prevConvitesRef.current;
        addToast(`🗓️ Você tem ${novos} novo${novos !== 1 ? "s" : ""} convite${novos !== 1 ? "s" : ""} na Agenda!`, "info", 8000);
      }
      prevConvitesRef.current = convites;
    } catch (_) {}
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchAgendaCount();
    const t = setInterval(fetchAgendaCount, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchAgendaCount]);

  // Polling badge WhatsApp (a cada 30s, só admin/secretária)
  useEffect(() => {
    const r = String(user?.role || "").toUpperCase();
    if (!user || !["ADMIN", "SECRETARIA_VIRTUAL"].includes(r)) return;
    const fetchWa = () => apiFetch("/whatsapp/unread").then(d => setWaUnread(d.count || 0)).catch(() => {});
    fetchWa();
    const t = setInterval(fetchWa, 30000);
    return () => clearInterval(t);
  }, [user]);

  // Atualização imediata via evento (páginas despacham "badge:refresh")
  // Declarado APÓS fetchVencidosCount e fetchAgendaCount para evitar temporal dead zone
  useEffect(() => {
    const handler = () => {
      fetchVencidosCount();
      fetchAgendaCount();
    };
    window.addEventListener("badge:refresh", handler);
    return () => window.removeEventListener("badge:refresh", handler);
  }, [fetchVencidosCount, fetchAgendaCount]);

  // Polling lembretes APP de Agenda (a cada 2 min — toast in-app)
  useEffect(() => {
    if (!user) return;
    let lastShownId = null;
    async function checkLembretes() {
      try {
        const lista = await apiFetch("/agenda/lembretes/pendentes");
        if (!Array.isArray(lista) || lista.length === 0) return;
        for (const lem of lista) {
          if (lem.id === lastShownId) continue;
          lastShownId = lem.id;
          addToast(`🗓️ ${lem.evento?.titulo || "Evento"} — ${new Date(lem.evento?.dataInicio).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`, "info", 10000);
          apiFetch(`/agenda/lembretes/${lem.id}/dispensar`, { method: "PATCH" }).catch(() => {});
        }
      } catch (_) {}
    }
    checkLembretes();
    const t = setInterval(checkLembretes, 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [user]);

  // Idle timer - auto logout após 30 min de inatividade
  const handleIdleWarning = useCallback(() => {
    setShowIdleWarning(true);
  }, []);

  const handleIdleTimeout = useCallback(() => {
    setShowIdleWarning(false);
    // Atualizar presença para offline
    try {
      apiFetch("/noticeboard/presenca", {
        method: "PUT",
        body: { online: false, digitando: false },
      }).catch(() => {});
    } catch {}
    clearAuth();
    onLogout?.();
    navigate("/");
  }, [navigate, onLogout]);

  const { resetTimer: resetIdleTimer } = useIdleTimer(handleIdleWarning, handleIdleTimeout, isLocked);

  const handleLock = useCallback(() => {
    setShowIdleWarning(false);
    sessionStorage.setItem("addere_locked", "1");
    setIsLocked(true);
  }, []);

  const handleUnlock = useCallback(() => {
    sessionStorage.removeItem("addere_locked");
    setIsLocked(false);
    resetIdleTimer();
  }, [resetIdleTimer]);

  const userInitials = getInitials(currentUser?.nome || user?.nome);

  // Avatar upload handler
  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      addToast("Tipo de arquivo não permitido. Use JPG, PNG, GIF ou WebP.", "error");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      addToast("Arquivo muito grande. Máximo 2MB.", "error");
      return;
    }

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);

      const result = await apiFetch("/auth/avatar", {
        method: "PUT",
        body: formData,
      });

      if (result?.usuario) {
        setCurrentUser(result.usuario);
        // Update stored user (correct key: addere_user)
        const stored = JSON.parse(localStorage.getItem("addere_user") || "{}");
        stored.avatarUrl = result.usuario.avatarUrl;
        localStorage.setItem("addere_user", JSON.stringify(stored));
      }

      addToast("Avatar atualizado com sucesso!", "success");
      setShowAvatarModal(false);
    } catch (err) {
      addToast(err?.message || "Erro ao atualizar avatar.", "error");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarUploading(true);
    try {
      await apiFetch("/auth/avatar", { method: "DELETE" });
      setCurrentUser((prev) => ({ ...prev, avatarUrl: null }));
      // Update stored user (correct key: addere_user)
      const stored = JSON.parse(localStorage.getItem("addere_user") || "{}");
      delete stored.avatarUrl;
      localStorage.setItem("addere_user", JSON.stringify(stored));
      addToast("Avatar removido com sucesso!", "success");
      setShowAvatarModal(false);
    } catch (err) {
      addToast(err?.message || "Erro ao remover avatar.", "error");
    } finally {
      setAvatarUploading(false);
    }
  };

  // Redireciona para NoticeBoard após login (página inicial)
  useEffect(() => {
    if (location.pathname === "/" || location.pathname === "") {
      navigate("/noticeboard", { replace: true });
    }
  }, []);

  // Polling para novas mensagens (toast se não estiver no NoticeBoard)
  useEffect(() => {
    const checkNewMessages = async () => {
      try {
        const msgs = await apiFetch("/noticeboard/mensagens");
        if (Array.isArray(msgs) && msgs.length > 0) {
          const latestMsg = msgs[msgs.length - 1];
          // Se é uma nova mensagem e não é do usuário atual
          if (latestMsg.id !== lastMsgIdRef.current && latestMsg.remetenteId !== user?.id) {
            // Se não estiver na página NoticeBoard, mostra toast
            if (!location.pathname.includes("noticeboard")) {
              const remetente = latestMsg.remetente?.nome || "Alguém";
              addToast(`Nova mensagem de ${remetente}`, "info", 5000);
            }
            lastMsgIdRef.current = latestMsg.id;
          } else if (lastMsgIdRef.current === null) {
            lastMsgIdRef.current = latestMsg.id;
          }
        }
      } catch (e) {
        // Silencia erros de polling
      }
    };

    // Verifica imediatamente para pegar último ID
    checkNewMessages();
    const interval = setInterval(checkNewMessages, 5000);
    return () => clearInterval(interval);
  }, [location.pathname, user?.id, addToast]);

  const IconWA = (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="#25D366" style={{ flexShrink: 0 }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
  const IconIG = (
    <svg viewBox="0 0 24 24" width="18" height="18" style={{ flexShrink: 0 }}>
      <defs>
        <radialGradient id="ig-sb-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%"  stopColor="#fdf497" />
          <stop offset="5%"  stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <path fill="url(#ig-sb-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );

  const menu = useMemo(() => {
    return [
      { to: "/noticeboard", label: "Notice Board", icon: "📋" },
      { to: "/agenda", label: "Agenda", icon: "🗓️", badge: agendaCount || null },
      { to: "/dashboard", label: "Dashboard", icon: "📊" },
      { to: "/recebimentos", label: "Recebimentos", icon: "💰" },
      {
        type: "group",
        label: "Livro Caixa",
        icon: "📖",
        badge: vencidosTotal || null,
        children: [
          { to: "/livro-caixa/lancamentos", label: "Lançamentos" },
          { to: "/livro-caixa/visualizacao", label: "Visualização" },
          { to: "/livro-caixa/emissao", label: "Emissão" },
        ],
      },
      {
        type: "group",
        label: "Configurações",
        icon: "⚙️",
        children: [
          { to: "/clientes", label: "Clientes" },
          { to: "/usuarios", label: "Usuários" },
          { to: "/contas-contabeis", label: "Contas Contábeis" },
          { to: "/seguranca", label: "Segurança (2FA)" },
        ],
      },
      {
        type: "group",
        label: "Utilitários",
        icon: "🧰",
        children: [
          { to: "/utilitarios/importacao-pdf", label: "Importação PDF Livro Caixa" },
          { to: "/utilitarios/nota-fiscal", label: "Emissão de Nota Fiscal" },
        ],
      },
    ];
  }, [agendaCount, vencidosTotal]);

  const navClass = ({ isActive }) =>
    `group relative block rounded-xl text-sm font-medium transition-all duration-200 ${
      sidebarCollapsed ? "px-2 py-3" : "px-4 py-2.5"
    } ${
      isActive
        ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/30"
        : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
    }`;

  const sidebarWidthClass = sidebarCollapsed ? "w-20" : "w-72";
  const mainOffsetClass = sidebarCollapsed ? "ml-20" : "ml-72";
  const iconBoxClass = "inline-flex h-7 w-7 shrink-0 items-center justify-center text-xl leading-none";

  // Simular loading ao trocar de rota
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <>
      {isLoading && <LoadingScreen />}
      
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        {/* Sidebar Moderna */}
        <aside className={`fixed left-0 top-0 ${sidebarWidthClass} h-screen bg-white border-r border-slate-200 flex flex-col shadow-xl transition-all duration-300`}>
          {/* Logo Header - Compacto */}
          <div className={`${sidebarCollapsed ? "px-2 py-3" : "px-4 py-3"} border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white transition-colors`}>
            <div className={`flex ${sidebarCollapsed ? "flex-col gap-2" : "items-start justify-between gap-2"}`}>
              <button
                type="button"
                className={`min-w-0 text-center ${sidebarCollapsed ? "w-full" : "flex-1"} cursor-pointer rounded-lg hover:bg-slate-100 transition-colors`}
                onClick={() => navigate("/configuracao-empresa")}
                title="Dados da Empresa"
              >
              <div className="inline-block p-2 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg shadow-md mb-2">
                <img
                  src={logoSrc}
                  alt="Addere"
                  className="h-6 brightness-0 invert opacity-100"
                  style={{ filter: 'brightness(0) invert(1) contrast(1.2)' }}
                />
              </div>
              {!sidebarCollapsed && (
                <div className="font-bold text-slate-900 text-xs leading-tight">Addere - Gestão Financeira</div>
              )}
              </button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((v) => !v)}
                className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center justify-center"
                title={sidebarCollapsed ? "Expandir sidebar" : "Retrair sidebar"}
                aria-label={sidebarCollapsed ? "Expandir sidebar" : "Retrair sidebar"}
              >
                <svg className={`w-4 h-4 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Menu */}
          <nav className={`${sidebarCollapsed ? "p-3" : "p-4"} space-y-2 flex-1 overflow-auto custom-scrollbar`}>
            {menu.map((item) => {
              if (item.type === "group") {
                const opened =
                  item.label === "Configurações" ? openSettings :
                  item.label === "Livro Caixa" ? openLivroCaixa :
                  item.label === "Dashboard" ? openDashboard :
                  item.label === "Relatórios" ? openRelatorios :
                  item.label === "Utilitários" ? openUtilitarios :
                  item.label === "Jurídico" ? openJuridico :
                  item.label === "Operações Bco. Inter" ? openInterOps :
                  item.label === "Operações Bco. C6 Bank" ? openC6Ops :
                  false;

                const toggle =
                  item.label === "Configurações" ? setOpenSettings :
                  item.label === "Livro Caixa" ? setOpenLivroCaixa :
                  item.label === "Dashboard" ? setOpenDashboard :
                  item.label === "Relatórios" ? setOpenRelatorios :
                  item.label === "Utilitários" ? setOpenUtilitarios :
                  item.label === "Jurídico" ? setOpenJuridico :
                  item.label === "Operações Bco. Inter" ? setOpenInterOps :
                  item.label === "Operações Bco. C6 Bank" ? setOpenC6Ops :
                  () => {};

                return (
                  <div key={item.label}>
                    <button
                      onClick={() => {
                        if (sidebarCollapsed) {
                          setSidebarCollapsed(false);
                          toggle(true);
                          return;
                        }
                        toggle((v) => !v);
                      }}
                      className={`relative w-full flex items-center ${sidebarCollapsed ? "justify-center px-2 py-3" : "justify-between px-4 py-2.5"} text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-all duration-200 group`}
                      title={item.label}
                      aria-label={item.label}
                    >
                      <span className={`flex items-center ${sidebarCollapsed ? "justify-center" : "gap-2"}`}>
                        <span className={iconBoxClass}>{item.icon}</span>
                        {!sidebarCollapsed && <span>{item.label}</span>}
                      </span>
                      {!sidebarCollapsed && (
                      <span className="flex items-center gap-1.5">
                        {!opened && item.badge > 0 && (
                          <span style={{
                            background: "#dc2626", color: "#fff",
                            borderRadius: 10, padding: "1px 6px",
                            fontSize: 11, fontWeight: 700, lineHeight: 1.4,
                          }}>
                            {item.badge}
                          </span>
                        )}
                        <Chevron open={opened} />
                      </span>
                      )}
                      {sidebarCollapsed && item.badge > 0 && (
                        <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
                          {item.badge}
                        </span>
                      )}
                    </button>

                    {opened && !sidebarCollapsed && (
                      <div className="mt-1 ml-8 space-y-1 border-l-2 border-slate-200 pl-3">
                        {item.children.map((ch, idx) =>
                          ch.type === "divider" ? (
                            <div key={`div-${idx}`} className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide pt-2 pb-1 px-3">
                              {ch.label}
                            </div>
                          ) : (
                            <NavLink key={ch.to} to={ch.to} end className={navClass}>
                              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                                <span>{ch.label}</span>
                                {ch.badge > 0 && (
                                  <span style={{
                                    background: "#dc2626", color: "#fff",
                                    borderRadius: 10, padding: "1px 6px",
                                    fontSize: 11, fontWeight: 700, lineHeight: 1.4,
                                  }}>
                                    {ch.badge}
                                  </span>
                                )}
                              </span>
                            </NavLink>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <NavLink key={item.to} to={item.to} end className={navClass} title={item.label} aria-label={item.label}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "space-between", width: "100%" }}>
                    <span className={`flex items-center ${sidebarCollapsed ? "justify-center" : "gap-2"}`}>
                      <span className={iconBoxClass}>{item.icon}</span>
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </span>
                    {!sidebarCollapsed && item.badge > 0 && (
                      <span style={{ background: "#dc2626", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 700, lineHeight: 1.4 }}>
                        {item.badge}
                      </span>
                    )}
                    {sidebarCollapsed && item.badge > 0 && (
                      <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
                        {item.badge}
                      </span>
                    )}
                  </span>
                </NavLink>
              );
            })}
          </nav>

          {/* Footer com usuário */}
          <div className="p-2 border-t border-slate-200 bg-gradient-to-br from-slate-50 to-white space-y-3">
            {/* Relógio - AJUSTADO: Maior */}
            {!sidebarCollapsed && (
            <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-slate-200">
              <div className="text-base flex justify-between font-bold text-slate-250 tracking-wide">
                <span>{clock.date}</span>
                <span>{clock.time}</span>
              </div>
            </div>
            )}

            {/* Card do Usuário - Compacto e Clicável */}
            <button
              onClick={() => setShowAvatarModal(true)}
              className={`w-full bg-gradient-to-br from-blue-600 to-blue-700 text-white ${sidebarCollapsed ? "px-2 py-2" : "px-3 py-2"} rounded-xl shadow-lg hover:from-blue-700 hover:to-blue-800 transition-all text-left`}
              title="Clique para alterar avatar"
            >
              <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "gap-2"}`}>
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.nome}
                    className="w-9 h-9 rounded-full object-cover border-2 border-white/30"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm backdrop-blur-sm border-2 border-white/30">
                    {userInitials}
                  </div>
                )}
                {!sidebarCollapsed && (
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-xs truncate leading-tight">
                    {currentUser?.nome || user?.nome || "Usuário"}
                  </div>
                  <div className="text-[10px] text-blue-200 font-medium leading-tight">
                    {userLabel}
                  </div>
                </div>
                )}
                {!sidebarCollapsed && (
                <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                )}
              </div>
            </button>

            {/* Botão Bloquear Tela */}
            <button
              onClick={handleLock}
              className={`w-full flex items-center justify-center ${sidebarCollapsed ? "px-2" : "gap-2 px-4"} rounded-xl bg-slate-600 text-white py-2 font-semibold hover:bg-slate-700 transition-all duration-200 text-sm`}
              title="Bloquear tela — exige senha para retornar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {!sidebarCollapsed && "Bloquear Tela"}
            </button>

            {/* Botão Sair */}
            <button
              onClick={() => {
                setIsLoading(true);
                setTimeout(() => {
                  clearAuth();
                  onLogout?.();
                  navigate("/");
                }, 500);
              }}
              className={`w-full flex items-center justify-center ${sidebarCollapsed ? "px-2" : "gap-2 px-4"} rounded-xl bg-red-600 text-white py-2.5 font-semibold hover:bg-red-700 transition-all duration-200 shadow-lg hover:shadow-red-500/50 transform hover:scale-[1.02]`}
              title="Sair do Sistema"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {!sidebarCollapsed && "Sair do Sistema"}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className={`${mainOffsetClass} min-h-screen transition-all duration-300`}>
          <Breadcrumbs />
          <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/noticeboard" element={<NoticeBoard user={currentUser} />} />
            <Route path="/agenda" element={<Agenda user={currentUser} />} />
            <Route path="/dashboard" element={<DashboardFinanceiro user={user} />} />
            <Route path="/contratos/:id" element={<ContratoPage user={user} />} />
            <Route path="/pagamentos" element={<PagamentosPage user={user} />} />
            <Route path="/recebimentos" element={<PagamentosPage user={user} />} />
            <Route path="/boletos" element={<Boletos user={user} bank="inter" />} />
            <Route path="/pix" element={<PixManager user={user} bank="inter" />} />
            <Route path="/inter/pagar-boleto" element={<InterPagarBoleto user={user} />} />
            <Route path="/c6/operacoes" element={<C6Operacoes user={user} />} />
            <Route path="/santander/operacoes" element={<Boletos user={user} bank="santander" />} />
            <Route path="/santander/operacoes/emitir-boleto" element={<Boletos user={user} bank="santander" />} />
            <Route path="/santander/operacoes/enviar-pix" element={<PixManager user={user} bank="santander" />} />
            <Route path="/santander/operacoes/receber-pix" element={<PixManager user={user} bank="santander" />} />
            <Route path="/livro-caixa/contas" element={<LivroCaixaContas user={user} />} />
            <Route path="/contas-contabeis" element={<LivroCaixaContas user={user} />} />
            <Route path="/livro-caixa/lancamentos" element={<LivroCaixaLancamentos user={user} />} />
            <Route path="/livro-caixa/visualizacao" element={<LivroCaixaVisualizacao user={user} />} />
            <Route path="/livro-caixa/emissao" element={<LivroCaixaEmissao user={user} />} />
            <Route path="/livro-caixa/fluxo" element={<FluxodeCaixa user={user} />} />
            <Route path="/livro-caixa/vencidos" element={<VencidosEmAberto user={user} />} />
            <Route path="/historico" element={<DossieReport />} />
            <Route path="/clientes" element={<ClientesPage user={user} />} />
            <Route path="/usuarios" element={<UsuariosPage user={user} />} />
            <Route path="/auditoria" element={<Auditoria user={user} />} />
            <Route path="/utilitarios/importacao-pdf" element={<ImportacaoLivroCaixaPdf user={user} />} />
            <Route path="/utilitarios/disparo-email" element={<UtilitariosDisparoEmail user={user} />} />
            <Route path="/utilitarios/comprovantes" element={<ComprovantesRecebidos user={user} />} />
            <Route path="/utilitarios/log-operacoes" element={<LogOperacoes user={user} />} />
            <Route path="/utilitarios/duplicados-clientes" element={<DuplicadosClientes user={user} />} />
            <Route path="/utilitarios/nota-fiscal" element={<EmissaoNotaFiscal />} />
            <Route path="/clientes/:id/documentos" element={<DocumentosCliente user={user} />} />
            <Route path="/configuracao-empresa" element={<ConfiguracaoEmpresa user={user} />} />
            <Route path="/configuracao-escritorio" element={<Navigate to="/configuracao-empresa" replace />} />
            <Route path="/whatsapp-inbox" element={<WhatsAppInbox user={user} />} />
            <Route path="/relatorios/fluxo-caixa/consolidado" element={<RelatorioFluxoCaixaConsolidado />} />
            <Route path="/relatorios/fluxo-caixa/diario" element={<RelatorioFluxoCaixaDiario />} />
            <Route path="/relatorios/fluxo-caixa/grafico" element={<RelatorioFluxoCaixaGrafico />} />
            <Route path="/relatorios/fluxo-caixa/por-conta" element={<RelatorioFluxoCaixaPorConta />} />
            <Route path="/relatorios/fluxo-caixa/projetado" element={<RelatorioFluxoCaixaProjetado />} />
            <Route path="/relatorios/fluxo-caixa/comparativo" element={<RelatorioFluxoCaixaComparativo />} />
            <Route path="/relatorios/fluxo-caixa/desempenho" element={<RelatorioFluxoCaixaDesempenho />} />
            <Route path="/relatorios/fluxo-caixa/saude" element={<RelatorioSaudeFinanceira />} />
            <Route path="/relatorios/clientes-fornecedores" element={<RelatorioClientesFornecedores />} />
            <Route path="/seguranca" element={<Seguranca2FA user={user} />} />
            <Route path="/ui-showcase" element={<UIShowcase />} />

            <Route path="*" element={<Placeholder title="Página não encontrada" />} />
          </Routes>
          </Suspense>
        </main>

        <style>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
          }
        `}</style>
      </div>

      {/* Modal de Avatar */}
      {showAvatarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !avatarUploading && setShowAvatarModal(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 text-white">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Alterar Avatar</h3>
                <button
                  onClick={() => !avatarUploading && setShowAvatarModal(false)}
                  className="text-white/80 hover:text-white text-2xl"
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Preview atual */}
              <div className="flex justify-center mb-6">
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.nome}
                    className="w-24 h-24 rounded-full object-cover border-4 border-blue-200 shadow-lg"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg">
                    {userInitials}
                  </div>
                )}
              </div>

              <div className="text-center text-sm text-slate-600 mb-4">
                {currentUser?.nome || user?.nome}
              </div>

              {/* Hidden file input */}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />

              <div className="space-y-3">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {avatarUploading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Enviando...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Escolher Imagem
                    </>
                  )}
                </button>

                {currentUser?.avatarUrl && (
                  <button
                    onClick={handleAvatarRemove}
                    disabled={avatarUploading}
                    className="w-full px-4 py-3 border border-red-300 text-red-600 rounded-xl font-semibold hover:bg-red-50 transition disabled:opacity-50"
                  >
                    Remover Avatar
                  </button>
                )}

                <button
                  onClick={() => setShowAvatarModal(false)}
                  disabled={avatarUploading}
                  className="w-full px-4 py-3 border border-slate-300 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>

              <div className="mt-4 text-xs text-slate-500 text-center">
                Formatos aceitos: JPG, PNG, GIF, WebP (máx. 2MB)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lock Screen */}
      {isLocked && <LockScreen onUnlock={handleUnlock} />}

      {/* Modal de Inatividade */}
      {showIdleWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-pulse-slow">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 text-white">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <h3 className="font-bold text-lg">Sessão Inativa</h3>
              </div>
            </div>
            <div className="p-6 text-center">
              <p className="text-slate-700 mb-2">
                Você está inativo há algum tempo.
              </p>
              <p className="text-sm text-slate-500 mb-6">
                Sua sessão será encerrada automaticamente em breve por segurança.
              </p>
              <button
                onClick={() => {
                  setShowIdleWarning(false);
                  resetIdleTimer();
                }}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition shadow-lg"
              >
                Continuar Conectado
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const API = BASE_URL;

/* ---------------- Modal sessão expirada ---------------- */
function SessionExpiredModal({ onConfirm }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Sessão expirada</h2>
        <p className="text-sm text-slate-500 mb-6">
          Sua sessão expirou por inatividade. Entre novamente para continuar.
        </p>
        <button
          onClick={onConfirm}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
        >
          Entrar novamente
        </button>
      </div>
    </div>
  );
}

/* ---------------- App root ---------------- */
export default function App() {
  const [user, setUser] = useState(() => getUser());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const token = getToken();

  // Escuta evento de sessão expirada disparado por apiFetch (401)
  useEffect(() => {
    function handleExpired() {
      // Só aciona o modal se ainda há um usuário logado no estado
      if (getToken()) setSessionExpired(true);
    }
    window.addEventListener("addere:session-expired", handleExpired);
    return () => window.removeEventListener("addere:session-expired", handleExpired);
  }, []);

  function handleSessionConfirm() {
    clearAuth();
    setUser(null);
    setSessionExpired(false);
  }

  useEffect(() => {
    // Simula carregamento inicial
    const timer = setTimeout(() => {
      setIsInitialLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token) return;
  }, [token]);

  if (isInitialLoading) {
    return <LoadingScreen />;
  }

  if (!token || !user) {
    if (window.location.pathname === "/ui-showcase") {
      return (
        <Suspense fallback={<LoadingScreen />}>
          <UIShowcase />
        </Suspense>
      );
    }
    return <Login onLogin={(u) => setUser(u)} />;
  }

  if (user.deveTrocarSenha) {
    return (
      <TrocarSenhaObrigatoria
        user={user}
        onSuccess={(updatedUser) => setUser(updatedUser)}
      />
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        {sessionExpired && <SessionExpiredModal onConfirm={handleSessionConfirm} />}
        <Shell user={user} onLogout={() => setUser(null)} />
      </ToastProvider>
    </ErrorBoundary>
  );
}
