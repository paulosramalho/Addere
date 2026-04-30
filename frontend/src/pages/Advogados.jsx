// src/pages/Advogados.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { isValidEmail, isValidPhoneBR, maskPhoneBR } from "../lib/validators";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import EmptyState from "../components/ui/EmptyState";

/* ---------- logo (se existir) ---------- */
let logoSrc = null;
try {
  logoSrc = new URL("../assets/logo.png", import.meta.url).href;
} catch {
  logoSrc = null;
}

/* ---------- helpers CPF (máscara + validação) ---------- */
function onlyDigits(v = "") {
  return String(v).replace(/\D/g, "");
}
function maskCPF(v = "") {
  const d = onlyDigits(v).slice(0, 11);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 9);
  const e = d.slice(9, 11);
  if (d.length <= 3) return a;
  if (d.length <= 6) return `${a}.${b}`;
  if (d.length <= 9) return `${a}.${b}.${c}`;
  return `${a}.${b}.${c}-${e}`;
}
function isValidCPF(v = "") {
  const cpf = onlyDigits(v);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calc = (base, factor) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

/* ---------- helpers Money ---------- */
function maskMoney(v = "") {
  const d = onlyDigits(v);
  if (!d) return "";
  const num = parseFloat(d) / 100;
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoneyDisplay(value) {
  const num = parseFloat(value) || 0;
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoney(v = "") {
  const clean = String(v).replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
}

/* ---------- UI helpers simples ---------- */
function Card({ title, subtitle, children, right, titleClassName = "" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
        <div>
          <div className={"font-semibold text-slate-900 " + titleClassName}>{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, children, hint, error }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="mt-1">{children}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-500 " +
        (props.className || "")
      }
    />
  );
}

function Select(props) {
  return (
    <select
      {...props}
      className={
        "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-500 " +
        (props.className || "")
      }
    />
  );
}

function Badge({ children, tone = "slate" }) {
  const map = {
    slate: "bg-slate-100 text-slate-800 border-slate-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          {hint ? <div className="mt-0.5 text-xs text-slate-600">{hint}</div> : null}
        </div>
        <button
          type="button"
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
            checked ? "bg-slate-900" : "bg-slate-300"
          }`}
          aria-pressed={checked}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
              checked ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

/* ---------- PDF (print-friendly) ---------- */
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openPdfWindow({ advogado }) {
  const nomeAdv = advogado?.nome ? String(advogado.nome).trim() : "Advogado";
  const cpf = advogado?.cpf ? maskCPF(advogado.cpf) : "—";
  const chavePix = advogado?.chavePix || "—";
  const titulo = `Dados para Pix - ${nomeAdv}`;

  const html = `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(titulo)}</title>
  <style>
    *{ box-sizing:border-box; font-family: Arial, Helvetica, sans-serif; }
    body{ margin:0; padding:32px; color:#0f172a; background:#fff; }
    .wrap{ max-width:720px; margin:0 auto; }
    .header{ text-align:center; padding-bottom:22px; border-bottom:2px solid #e2e8f0; margin-bottom:24px; }
    .brandRow{ display:flex; justify-content:center; margin-bottom:14px; }
    .logo{ width:320px; height:auto; max-height:320px; object-fit:contain; }
    .line2{ font-size:16px; color:#475569; margin:6px 0 0; font-weight:700; }
    .box{ border:1px solid #e2e8f0; border-radius:14px; padding:16px; background:#f8fafc; }
    .boxTitle{ font-size:17px; font-weight:700; color:#0f172a; margin-bottom:10px; }
    .field{ margin-bottom:8px; display:flex; }
    .label{ font-size:14px; font-weight:700; color:#475569; min-width:105px; }
    .value{ font-size:14px; color:#0f172a; word-break:break-word; flex:1; }
    @media print{
      body{ background:#fff; }
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="header">
    ${logoSrc ? `<div class="brandRow"><img class="logo" src="${escapeHtml(logoSrc)}" alt="Logo" /></div>` : ""}
    <div class="line2">Dados para Pix</div>
  </div>
  <div class="box">
    <div class="boxTitle">💳 Informações do Advogado</div>
    <div class="field"><div class="label">Nome:</div><div class="value">${escapeHtml(nomeAdv)}</div></div>
    <div class="field"><div class="label">CPF:</div><div class="value">${escapeHtml(cpf)}</div></div>
    <div class="field"><div class="label">Chave Pix:</div><div class="value">${escapeHtml(chavePix)}</div></div>
  </div>
</div>
<script>
setTimeout(() => window.print(), 200);
</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=840,height=800");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

/* ---------- GoogleCalendarCard ---------- */
function GoogleCalendarCard({ advogadoId }) {
  const { addToast } = useToast();
  const [status, setStatus]         = useState(null); // null = carregando
  const [connecting, setConnecting]   = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing]         = useState(false);

  useEffect(() => {
    if (!advogadoId) return;
    apiFetch(`/google-calendar/status/${advogadoId}`)
      .then(d => setStatus(d))
      .catch(() => setStatus({ conectado: false }));
  }, [advogadoId]);

  // Detectar retorno do OAuth na URL (?gcal=connected)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal === "connected") {
      addToast("Google Agenda conectada com sucesso!", "success");
      window.history.replaceState({}, "", window.location.pathname);
      if (advogadoId) {
        apiFetch(`/google-calendar/status/${advogadoId}`)
          .then(d => setStatus(d)).catch(() => {});
      }
    } else if (gcal === "cancelled") {
      addToast("Conexão cancelada.", "info");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (gcal === "error" || gcal === "no_refresh_token") {
      addToast("Erro ao conectar Google Agenda. Tente novamente.", "error");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleConectar() {
    if (!advogadoId || connecting) return;
    setConnecting(true);
    try {
      const data = await apiFetch(`/google-calendar/auth/${advogadoId}`);
      if (data.url) window.location.href = data.url;
      else addToast("Não foi possível iniciar a conexão.", "error");
    } catch (e) {
      addToast(e.message || "Erro ao conectar.", "error");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDesconectar() {
    if (!advogadoId || disconnecting) return;
    setDisconnecting(true);
    try {
      await apiFetch(`/google-calendar/disconnect/${advogadoId}`, { method: "DELETE" });
      setStatus({ conectado: false });
      addToast("Google Agenda desconectada.", "success");
    } catch (e) {
      addToast(e.message || "Erro ao desconectar.", "error");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSync() {
    if (!advogadoId || syncing) return;
    setSyncing(true);
    try {
      await apiFetch(`/google-calendar/sync/${advogadoId}`, { method: "POST" });
      addToast("Sincronização concluída. Atualize a Agenda.", "success");
    } catch (e) {
      addToast(e.message || "Erro ao sincronizar.", "error");
    } finally {
      setSyncing(false);
    }
  }

  if (!advogadoId) return null;

  return (
    <div className="border-t border-slate-200 pt-6">
      <div className="flex items-start gap-3">
        {/* Ícone Google Calendar */}
        <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center shrink-0 mt-0.5">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
            <rect width="24" height="24" rx="4" fill="#fff"/>
            <path d="M17 3H7C5.9 3 5 3.9 5 5v14c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" fill="#4285F4" opacity=".15"/>
            <path d="M16 2H8v2h8V2z" fill="#EA4335"/>
            <path d="M12 2v4" stroke="#EA4335" strokeWidth="2" strokeLinecap="round"/>
            <rect x="7" y="10" width="10" height="1.5" rx=".75" fill="#4285F4" opacity=".5"/>
            <rect x="7" y="13" width="7" height="1.5" rx=".75" fill="#4285F4" opacity=".5"/>
            <rect x="7" y="16" width="5" height="1.5" rx=".75" fill="#4285F4" opacity=".5"/>
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold text-slate-900 mb-0.5">Google Agenda</div>
          <div className="text-xs text-slate-500 mb-3">
            Sincronize bidirecionalmente com sua conta Google: eventos criados aqui aparecem no Google Agenda e vice-versa.
          </div>

          {status === null && (
            <div className="text-xs text-slate-400">Verificando conexão…</div>
          )}

          {status !== null && !status.conectado && (
            <button
              onClick={handleConectar}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
              </svg>
              {connecting ? "Redirecionando…" : "Conectar com Google"}
            </button>
          )}

          {status !== null && status.conectado && (
            <div className="flex items-center gap-4 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-3 py-1 text-sm font-medium">
                <span className="text-green-500">&#10003;</span> Conectada
                {status.pushAtivo && <span className="ml-1 text-[10px] opacity-70">(push ativo)</span>}
              </span>
              {status.desde && (
                <span className="text-xs text-slate-400">
                  desde {new Date(status.desde).toLocaleDateString("pt-BR")}
                </span>
              )}
              <button
                onClick={handleSync}
                disabled={syncing}
                className="text-xs text-blue-600 underline hover:text-blue-800 disabled:opacity-60"
              >
                {syncing ? "Sincronizando…" : "Sincronizar agora"}
              </button>
              <button
                onClick={handleDesconectar}
                disabled={disconnecting}
                className="text-xs text-red-500 underline hover:text-red-700 disabled:opacity-60"
              >
                {disconnecting ? "Desconectando…" : "Desconectar"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- MeuPerfilProfissional ---------- */
function MeuPerfilProfissional({ user }) {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cpf, setCpf] = useState("");
  const [chavePix, setChavePix] = useState("");
  const [oab, setOab] = useState("");

  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState("");

  const [hasPjeSeed, setHasPjeSeed] = useState(false);
  const [pjeSeedInput, setPjeSeedInput] = useState("");
  const [savingSeed, setSavingSeed] = useState(false);
  const [seedMode, setSeedMode] = useState("idle"); // "idle" | "edit" | "remove"
  const [advogadoId, setAdvogadoId] = useState(null);

  useEffect(() => {
    loadMe();
  }, []);

  async function loadMe() {
    setLoading(true);
    setErro("");
    try {
      const data = await apiFetch("/advogados/me");
      setNome(data.nome || "");
      setEmail(data.email || "");
      setTelefone(data.telefone || "");
      setCpf(data.cpf || "");
      setChavePix(data.chavePix || "");
      setOab(data.oab || "");
      setHasPjeSeed(!!data.hasPjeSeed);
      setAdvogadoId(data.id || null);
    } catch (e) {
      setErro(e?.message || "Erro ao carregar perfil.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSeed() {
    if (savingSeed) return;
    const seedClean = pjeSeedInput.replace(/\s+/g, "").toUpperCase();
    if (seedMode === "edit" && seedClean.length < 16) {
      addToast("SEED inválido — deve ter pelo menos 16 caracteres.", "error");
      return;
    }
    setSavingSeed(true);
    try {
      await apiFetch("/advogados/me", { method: "PATCH", body: { pjeSeed: seedMode === "remove" ? "" : seedClean } });
      addToast(seedMode === "remove" ? "SEED PJe removido." : "SEED PJe configurado com sucesso!", "success");
      setPjeSeedInput("");
      setSeedMode("idle");
      await loadMe();
    } catch (e) {
      addToast(e?.message || "Erro ao salvar SEED.", "error");
    } finally {
      setSavingSeed(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setErro("");

    const payload = {
      telefone: telefone.trim(),
      chavePix: chavePix.trim() || null,
    };

    if (novaSenha.trim()) {
      if (!senhaAtual.trim()) {
        addToast("Preencha a senha atual para alterar a senha.", "error");
        return;
      }
      if (novaSenha !== confirmarNovaSenha) {
        addToast("Nova senha e confirmação não coincidem.", "error");
        return;
      }
      if (novaSenha.length < 6) {
        addToast("A nova senha deve ter no mínimo 6 caracteres.", "error");
        return;
      }
      payload.senhaAtual = senhaAtual;
      payload.novaSenha = novaSenha;
      payload.confirmarNovaSenha = confirmarNovaSenha;
    }

    setSaving(true);
    try {
      await apiFetch("/advogados/me", { method: "PATCH", body: payload });
      addToast("Perfil atualizado com sucesso!", "success");
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmarNovaSenha("");
      await loadMe();
    } catch (e) {
      const msg = e?.message || "Erro ao salvar perfil.";
      setErro(msg);
      addToast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <Card title="Meu perfil profissional" subtitle={null} titleClassName="text-xl">
          <div className="text-sm text-slate-600">Carregando dados…</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Card title="Meu perfil profissional" subtitle="Gerencie suas informações de contato e senha" titleClassName="text-xl">
        {erro ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{erro}</div>
        ) : null}

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome completo">
              <Input value={nome} disabled />
            </Field>
            <Field label="E-mail">
              <Input value={email} disabled />
            </Field>
            <Field label="CPF">
              <Input value={cpf ? maskCPF(cpf) : ""} disabled />
            </Field>
            <Field label="OAB">
              <Input value={oab} disabled />
            </Field>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <div className="text-base font-semibold text-slate-900 mb-4">Informações de contato</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Telefone" hint="Ex: (85) 99999-9999">
                <Input
                  value={telefone}
                  onChange={(e) => setTelefone(maskPhoneBR(e.target.value))}
                  placeholder="(00) 00000-0000"
                />
              </Field>
              <Field label="Chave Pix" hint="Ex: CPF, e-mail, celular ou chave aleatória">
                <Input
                  value={chavePix}
                  onChange={(e) => setChavePix(e.target.value)}
                  placeholder="Digite sua chave Pix"
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <div className="text-base font-semibold text-slate-900 mb-4">Alterar senha</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Senha atual">
                <Input
                  type="password"
                  value={senhaAtual}
                  onChange={(e) => setSenhaAtual(e.target.value)}
                  placeholder="Senha atual"
                />
              </Field>
              <Field label="Nova senha">
                <Input
                  type="password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Nova senha"
                />
              </Field>
              <Field label="Confirmar nova senha">
                <Input
                  type="password"
                  value={confirmarNovaSenha}
                  onChange={(e) => setConfirmarNovaSenha(e.target.value)}
                  placeholder="Confirme a nova senha"
                />
              </Field>
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Deixe em branco se não deseja alterar a senha. Caso preencha, todos os 3 campos são obrigatórios.
            </div>
          </div>

          {/* SEED PJe — 2FA automático */}
          <div className="border-t border-slate-200 pt-6">
            <div className="text-base font-semibold text-slate-900 mb-1">PJe — SEED 2FA</div>
            <div className="mb-4 text-xs text-slate-500">
              Configure o SEED permanente do seu autenticador PJe para que o sistema gere o código 2FA automaticamente
              ao capturar processos em segredo de justiça. O SEED é armazenado criptografado — nunca fica visível após salvar.
            </div>

            {hasPjeSeed && seedMode === "idle" ? (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-3 py-1 text-sm font-medium">
                  <span>&#10003;</span> SEED configurado
                </span>
                <button
                  onClick={() => setSeedMode("edit")}
                  className="text-xs text-slate-500 underline hover:text-slate-700"
                >
                  Alterar
                </button>
                <button
                  onClick={() => setSeedMode("remove")}
                  className="text-xs text-red-500 underline hover:text-red-700"
                >
                  Remover
                </button>
              </div>
            ) : seedMode === "remove" ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-700">Remover o SEED PJe?</span>
                <button
                  onClick={handleSaveSeed}
                  disabled={savingSeed}
                  className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-70"
                >
                  {savingSeed ? "Removendo…" : "Confirmar remoção"}
                </button>
                <button onClick={() => setSeedMode("idle")} className="text-xs text-slate-500 underline">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-w-lg">
                <Field
                  label={hasPjeSeed ? "Novo SEED (substitui o atual)" : "SEED do autenticador"}
                  hint="Cole o SEED base32 de 32 caracteres que aparece no QR Code do PJe (ex: JBSWY3DPEHPK3PXP...)"
                >
                  <Input
                    value={pjeSeedInput}
                    onChange={(e) => setPjeSeedInput(e.target.value.replace(/\s+/g, "").toUpperCase())}
                    placeholder="JBSWY3DPEHPK3PXP..."
                    autoComplete="off"
                  />
                </Field>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveSeed}
                    disabled={savingSeed || pjeSeedInput.length < 16}
                    className="rounded-xl bg-amber-600 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {savingSeed ? "Salvando…" : "Salvar SEED"}
                  </button>
                  {hasPjeSeed && (
                    <button onClick={() => { setSeedMode("idle"); setPjeSeedInput(""); }} className="text-xs text-slate-500 underline self-center">
                      Cancelar
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  Como obter o SEED: acesse <strong>pje.tjpa.jus.br</strong> (ou qualquer tribunal PJe) &rarr; Configurar autenticador
                  &rarr; o QR Code contém um link com o parâmetro <code>secret=XXXXX</code>. Esse XXXXX &eacute; o SEED.
                  O mesmo SEED vale para todos os tribunais que usam o mesmo e-mail/CPF.
                </div>
              </div>
            )}
          </div>

          {/* Google Calendar */}
          <GoogleCalendarCard advogadoId={advogadoId} />

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-70"
            >
              {saving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------- AdvogadosAdmin ---------- */
function AdvogadosAdmin() {
  const { addToast, confirmToast } = useToast();
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");

  const empty = {
    nome: "",
    cpf: "",
    oab: "",
    email: "",
    telefone: "",
    chavePix: "",
    senha: "",
    confirmarSenha: "",
    ehSocio: false,
    parcelaFixaAtiva: false,
    parcelaFixaValor: "",
    parcelaFixaTipo: "SOMADA",
    parcelaFixaNome: "",
  };
  const [form, setForm] = useState({ ...empty });
  const [criarUsuario, setCriarUsuario] = useState(false);

  const [openView, setOpenView] = useState(false);
  const [viewing, setViewing] = useState(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) => {
      const n = (r.nome || "").toLowerCase();
      const e = (r.email || "").toLowerCase();
      const c = (r.cpf || "").toLowerCase();
      const o = (r.oab || "").toLowerCase();
      return n.includes(needle) || e.includes(needle) || c.includes(needle) || o.includes(needle);
    });
  }, [rows, q]);

  useEffect(() => {
    const busca = new URLSearchParams(location.search).get("busca");
    if (busca) setQ(busca);
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const data = await apiFetch("/advogados");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.message || "Erro ao carregar.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...empty });
    setCriarUsuario(false);
    setFormErr("");
    setOpenForm(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      nome: row.nome || "",
      cpf: row.cpf || "",
      oab: row.oab || "",
      email: row.email || "",
      telefone: row.telefone || "",
      chavePix: row.chavePix || "",
      senha: "",
      confirmarSenha: "",
      ehSocio: !!row.ehSocio,
      parcelaFixaAtiva: !!row.parcelaFixaAtiva,
      parcelaFixaValor: row.parcelaFixaAtiva ? formatMoneyDisplay(row.parcelaFixaValor) : "",
      parcelaFixaTipo: row.parcelaFixaTipo || "SOMADA",
      parcelaFixaNome: row.parcelaFixaNome || "",
    });
    setCriarUsuario(false);
    setFormErr("");
    setOpenForm(true);
  }

  function openDetails(row) {
    setViewing(row);
    setOpenView(true);
  }

  function validate(isCreate) {
    const n = String(form.nome).trim();
    const e = String(form.email).trim();
    const c = form.cpf;

    if (!n) return "Nome é obrigatório.";
    if (!e) return "E-mail é obrigatório.";
    if (!isValidEmail(e)) return "E-mail inválido.";

    if (isCreate) {
      if (!c) return "CPF é obrigatório.";
      if (!isValidCPF(c)) return "CPF inválido.";
      if (criarUsuario) {
        if (!form.senha || form.senha.length < 6) return "Senha deve ter no mínimo 6 caracteres.";
        if (form.senha !== form.confirmarSenha) return "Senha e confirmação não coincidem.";
      }
    } else {
      if (form.senha && form.senha.length < 6) return "Senha deve ter no mínimo 6 caracteres.";
      if (form.senha && form.senha !== form.confirmarSenha) return "Senha e confirmação não coincidem.";
    }

    const t = form.telefone;
    if (t && !isValidPhoneBR(t)) return "Telefone inválido.";

    if (form.parcelaFixaAtiva) {
      const val = parseMoney(form.parcelaFixaValor);
      if (!val || val <= 0) return "Valor da parcela fixa inválido.";
      if (form.parcelaFixaTipo === "SEPARADA" && !String(form.parcelaFixaNome).trim()) {
        return "Nome da parcela separada é obrigatório.";
      }
    }

    return "";
  }

  async function save() {
    if (saving) return;
    setFormErr("");

    const isCreate = !editing;
    const v = validate(isCreate);
    if (v) return setFormErr(v);

    setSaving(true);
    try {
      if (isCreate) {
        const body = {
          nome: String(form.nome).trim(),
          cpf: form.cpf,
          oab: String(form.oab || "").trim(),
          email: String(form.email).trim(),
          telefone: form.telefone || "",
          chavePix: String(form.chavePix || "").trim() || null,
          criarUsuario: !!criarUsuario,
          ehSocio: !!form.ehSocio,
          parcelaFixaAtiva: !!form.parcelaFixaAtiva,
          parcelaFixaValor: form.parcelaFixaAtiva ? parseMoney(form.parcelaFixaValor) : null,
          parcelaFixaTipo: form.parcelaFixaAtiva ? form.parcelaFixaTipo : null,
          parcelaFixaNome: form.parcelaFixaAtiva && form.parcelaFixaTipo === "SEPARADA" ? String(form.parcelaFixaNome || "").trim() : null,
        };

        if (criarUsuario) {
          body.senha = form.senha;
          body.confirmarSenha = form.confirmarSenha;
        }

        await apiFetch("/advogados", { method: "POST", body });
        addToast("Advogado criado com sucesso!", "success");
      } else {
        const payload = {
          nome: String(form.nome).trim(),
          cpf: form.cpf,
          oab: String(form.oab || "").trim(),
          email: String(form.email).trim(),
          telefone: form.telefone || "",
          chavePix: String(form.chavePix || "").trim() || null,
          ehSocio: !!form.ehSocio,
          parcelaFixaAtiva: !!form.parcelaFixaAtiva,
          parcelaFixaValor: form.parcelaFixaAtiva ? parseMoney(form.parcelaFixaValor) : null,
          parcelaFixaTipo: form.parcelaFixaAtiva ? form.parcelaFixaTipo : null,
          parcelaFixaNome: form.parcelaFixaAtiva && form.parcelaFixaTipo === "SEPARADA" ? String(form.parcelaFixaNome || "").trim() : null,
        };

        if (String(form.senha || "").trim()) {
          payload.senha = form.senha;
          payload.confirmarSenha = form.confirmarSenha;
        }

        await apiFetch(`/advogados/${editing.id}`, { method: "PUT", body: payload });
        addToast("Advogado atualizado com sucesso!", "success");
      }

      setOpenForm(false);
      setForm(empty);
      await load();
    } catch (e) {
      const errorMsg = e?.message || "Falha ao salvar.";
      setFormErr(errorMsg);
      addToast(errorMsg, "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAtivo(row) {
    const novo = !row.ativo;
    const ok = await confirmToast(`${novo ? "Ativar" : "Inativar"} o advogado "${row.nome}"?`);
    if (!ok) return;

    try {
      await apiFetch(`/advogados/${row.id}/status`, {
        method: "PATCH",
        body: { ativo: novo },
      });
      addToast(`Advogado ${novo ? "ativado" : "inativado"} com sucesso!`, "success");
      await load();
    } catch (e) {
      addToast(e?.message || "Falha ao atualizar status.", "error");
    }
  }

  return (
    <div className="p-6 space-y-4">
      <Card
        title="Advogados"
        subtitle={null}
        titleClassName="text-xl"
        right={
          <Tooltip content="Cadastrar novo advogado">
            <button
              onClick={openCreate}
              className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 transition"
            >
              + Novo advogado
            </button>
          </Tooltip>
        }
      >
        {err ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{err}</div>
        ) : null}

        <div className="flex items-center gap-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, e-mail, CPF ou OAB…" />
          <Tooltip content="Atualizar lista de advogados">
            <button
              onClick={load}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
            >
              Atualizar
            </button>
          </Tooltip>
        </div>

        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">OAB</th>
                <th className="text-left px-4 py-3 font-semibold">Nome completo</th>
                <th className="text-left px-4 py-3 font-semibold">Telefone</th>
                <th className="text-left px-4 py-3 font-semibold">E-mail</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Parcela Fixa</th>
                <th className="text-right px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-slate-600" colSpan={7}>
                    Carregando…
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">{r.oab || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Tooltip content="Ver detalhes completos">
                          <button
                            type="button"
                            onClick={() => openDetails(r)}
                            className="font-semibold text-slate-900 hover:underline"
                          >
                            {r.nome || "—"}
                          </button>
                        </Tooltip>
                        {r.ehSocio ? <Badge tone="purple">SÓCIO</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">{r.telefone ? maskPhoneBR(r.telefone) : "—"}</td>
                    <td className="px-4 py-3">{r.email || "—"}</td>
                    <td className="px-4 py-3">{r.ativo ? <Badge tone="green">ATIVO</Badge> : <Badge tone="red">INATIVO</Badge>}</td>
                    <td className="px-4 py-3">
                      {r.parcelaFixaAtiva ? (
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900">
                            R$ {parseFloat(r.parcelaFixaValor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className="text-slate-500">
                            {r.parcelaFixaTipo === "SOMADA" ? "📊 Somada" : `📋 ${r.parcelaFixaNome}`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Tooltip content="Editar informações do advogado">
                          <button
                            onClick={() => openEdit(r)}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition"
                          >
                            Editar
                          </button>
                        </Tooltip>
                        <Tooltip content={r.ativo ? "Inativar advogado" : "Ativar advogado"}>
                          <button
                            onClick={() => toggleAtivo(r)}
                            className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                              r.ativo
                                ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                                : "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                            }`}
                          >
                            {r.ativo ? "Inativar" : "Ativar"}
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState compact icon="⚖️" title="Nenhum advogado encontrado." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* MODAL FORM */}
        {openForm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => !saving && setOpenForm(false)} />
            <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-sm">
              <div className="sticky top-0 z-10 bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="text-base font-semibold text-slate-900">
                  {editing ? "Editar advogado" : "Cadastrar novo advogado"}
                </div>
                <button
                  onClick={() => !saving && setOpenForm(false)}
                  disabled={saving}
                  className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  title="Fechar"
                >
                  ✕
                </button>
              </div>

              <div className="p-5">
                {formErr ? (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
                    {formErr}
                  </div>
                ) : null}

                <div className="space-y-5">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 mb-3">Dados pessoais</div>
                    <div className="space-y-4">
                      <Field label="Nome completo *">
                        <Input
                          value={form.nome}
                          onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                          placeholder="Nome do advogado"
                          disabled={saving}
                        />
                      </Field>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="CPF *" hint={editing ? "Não editável após criação" : undefined}>
                          <Input
                            value={form.cpf ? maskCPF(form.cpf) : ""}
                            onChange={(e) => setForm((p) => ({ ...p, cpf: onlyDigits(e.target.value) }))}
                            placeholder="000.000.000-00"
                            disabled={saving || !!editing}
                          />
                        </Field>

                        <Field label="OAB" hint="Opcional">
                          <Input
                            value={form.oab}
                            onChange={(e) => setForm((p) => ({ ...p, oab: e.target.value }))}
                            placeholder="Ex: CE 12345"
                            disabled={saving}
                          />
                        </Field>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-5">
                    <div className="text-sm font-semibold text-slate-900 mb-3">Contato</div>
                    <div className="space-y-4">
                      <Field label="E-mail *">
                        <Input
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                          placeholder="email@exemplo.com"
                          disabled={saving}
                        />
                      </Field>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Telefone" hint="Formato: (85) 99999-9999">
                          <Input
                            value={form.telefone ? maskPhoneBR(form.telefone) : ""}
                            onChange={(e) => setForm((p) => ({ ...p, telefone: maskPhoneBR(e.target.value) }))}
                            placeholder="(00) 00000-0000"
                            disabled={saving}
                          />
                        </Field>

                        <Field label="Chave Pix" hint="CPF, e-mail, celular ou aleatória">
                          <Input
                            value={form.chavePix}
                            onChange={(e) => setForm((p) => ({ ...p, chavePix: e.target.value }))}
                            placeholder="Digite a chave Pix"
                            disabled={saving}
                          />
                        </Field>
                      </div>
                    </div>
                  </div>

                  {!editing ? (
                    <div className="border-t border-slate-200 pt-5">
                      <div className="mb-3">
                        <Toggle
                          label="Criar usuário de acesso"
                          checked={criarUsuario}
                          onChange={setCriarUsuario}
                          hint="Se ativado, será criado um login para este advogado acessar o sistema"
                        />
                      </div>

                      {criarUsuario ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label="Senha *" hint="Mínimo 6 caracteres">
                              <Input
                                type="password"
                                value={form.senha}
                                onChange={(e) => setForm((p) => ({ ...p, senha: e.target.value }))}
                                placeholder="••••••"
                                disabled={saving}
                              />
                            </Field>
                            <Field label="Confirmar senha *">
                              <Input
                                type="password"
                                value={form.confirmarSenha}
                                onChange={(e) => setForm((p) => ({ ...p, confirmarSenha: e.target.value }))}
                                placeholder="••••••"
                                disabled={saving}
                              />
                            </Field>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {editing ? (
                    <div className="border-t border-slate-200 pt-5">
                      <div className="text-sm font-semibold text-slate-900 mb-3">Alterar senha</div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Field label="Nova senha" hint="Deixe vazio para não alterar">
                            <Input
                              type="password"
                              value={form.senha}
                              onChange={(e) => setForm((p) => ({ ...p, senha: e.target.value }))}
                              placeholder="••••••"
                              disabled={saving}
                            />
                          </Field>
                          <Field label="Confirmar nova senha">
                            <Input
                              type="password"
                              value={form.confirmarSenha}
                              onChange={(e) => setForm((p) => ({ ...p, confirmarSenha: e.target.value }))}
                              placeholder="••••••"
                              disabled={saving}
                            />
                          </Field>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="border-t border-slate-200 pt-5">
                    <div className="text-sm font-semibold text-slate-900 mb-3">Configurações</div>
                    <div className="space-y-3">
                      <Toggle
                        label="Marcar como sócio"
                        checked={form.ehSocio}
                        onChange={(v) => setForm((p) => ({ ...p, ehSocio: v }))}
                        hint="Sócios aparecem destacados na listagem"
                      />

                      <Toggle
                        label="Parcela fixa mensal"
                        checked={form.parcelaFixaAtiva}
                        onChange={(v) => setForm((p) => ({ ...p, parcelaFixaAtiva: v }))}
                        hint="Valor fixo a ser repassado todo mês, independente dos processos"
                      />

                      {form.parcelaFixaAtiva ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label="Valor da parcela fixa" hint="Ex: 1412.00 ou 2500.00">
                              <Input
                                value={form.parcelaFixaValor}
                                onChange={(e) => setForm((p) => ({ ...p, parcelaFixaValor: maskMoney(e.target.value) }))}
                                placeholder="0,00"
                                disabled={saving}
                              />
                            </Field>

                            <Field label="Tipo de lançamento">
                              <Select
                                value={form.parcelaFixaTipo}
                                onChange={(e) => setForm((p) => ({ ...p, parcelaFixaTipo: e.target.value }))}
                                disabled={saving}
                              >
                                <option value="SOMADA">📊 Somada ao repasse</option>
                                <option value="SEPARADA">📋 Lançamento separado</option>
                              </Select>
                            </Field>

                            {form.parcelaFixaTipo === "SEPARADA" ? (
                              <Field label="Nome da parcela separada" hint='Ex: "Pró Labore", "Salário Fixo"'>
                                <Input
                                  value={form.parcelaFixaNome}
                                  onChange={(e) => setForm((p) => ({ ...p, parcelaFixaNome: e.target.value }))}
                                  placeholder="Pró Labore"
                                  disabled={saving}
                                />
                              </Field>
                            ) : null}
                          </div>

                          <div className="text-xs text-slate-600">
                            {form.parcelaFixaTipo === "SOMADA" ? (
                              <div>
                                💡 <b>Somada:</b> O valor será adicionado ao total do repasse calculado pelas parcelas do processo.
                              </div>
                            ) : (
                              <div>
                                💡 <b>Separada:</b> Será criado um lançamento individual com o nome "{form.parcelaFixaNome || "Parcela Fixa"}".
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={() => setOpenForm(false)}
                    disabled={saving}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition disabled:opacity-70"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={save}
                    disabled={saving}
                    className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-70"
                  >
                    {saving ? "Salvando…" : "Salvar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        
        {/* MODAL VIEW */}
        {openView && viewing ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpenView(false)} />
            <div className="relative w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-sm">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-slate-900 truncate">{viewing.nome}</div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    {viewing.ativo ? <Badge tone="green">ATIVO</Badge> : <Badge tone="red">INATIVO</Badge>}
                    {viewing.ehSocio ? <Badge tone="purple">SÓCIO</Badge> : null}
                    <span className="text-xs text-slate-500">OAB: {viewing.oab || "—"}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openPdfWindow({ advogado: viewing })}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
                    title="Gerar PDF com dados para Pix"
                  >
                    📄 PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenView(false);
                      openEdit(viewing);
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
                    title="Editar informações"
                  >
                    Editar
                  </button>
                  <button 
                    onClick={() => setOpenView(false)} 
                    className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100" 
                    title="Fechar"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-600">Nome completo</div>
                    <div className="mt-1 text-sm text-slate-900 break-words">{viewing.nome || "—"}</div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-600">OAB</div>
                    <div className="mt-1 text-sm text-slate-900 break-words">{viewing.oab || "—"}</div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-600">CPF</div>
                    <div className="mt-1 text-sm text-slate-900 break-words">{viewing.cpf ? maskCPF(viewing.cpf) : "—"}</div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-600">Telefone</div>
                    <div className="mt-1 text-sm text-slate-900 break-words">{viewing.telefone ? maskPhoneBR(viewing.telefone) : "—"}</div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                    <div className="text-xs font-semibold text-slate-600">E-mail</div>
                    <div className="mt-1 text-sm text-slate-900 break-words">{viewing.email || "—"}</div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                    <div className="text-xs font-semibold text-slate-600">Chave Pix</div>
                    <div className="mt-1 text-sm text-slate-900 break-words">{viewing.chavePix || "—"}</div>
                  </div>

                  {viewing.parcelaFixaAtiva ? (
                    <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 md:col-span-2">
                      <div className="text-xs font-semibold text-purple-700 mb-2">💰 Parcela Fixa Mensal</div>
                      <div className="space-y-1 text-sm">
                        <div>
                          <span className="text-slate-600">Valor:</span>{" "}
                          <span className="font-semibold text-slate-900">
                            R$ {parseFloat(viewing.parcelaFixaValor || 0).toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-600">Tipo:</span>{" "}
                          <span className="font-medium text-slate-900">
                            {viewing.parcelaFixaTipo === "SOMADA" ? "📊 Somada ao repasse" : `📋 Separada: "${viewing.parcelaFixaNome}"`}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={() => setOpenView(false)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ---------- EXPORT PRINCIPAL ---------- */
function AdminGoogleCalendar() {
  return (
    <div className="px-6 pb-2">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-5">
        <GoogleCalendarCard advogadoId="me" />
      </div>
    </div>
  );
}

export default function AdvogadosPage({ user }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  if (!isAdmin) return <MeuPerfilProfissional user={user} />;
  return (
    <div>
      <AdminGoogleCalendar />
      <AdvogadosAdmin />
    </div>
  );
}