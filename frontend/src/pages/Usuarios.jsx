// src/pages/Usuarios.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { isValidEmail, isValidPhoneBR, maskPhoneBR } from "../lib/validators";

import { useToast } from "../components/Toast";

/* ---------- CPF helpers (front) ---------- */
function onlyDigits(v = "") {
  return String(v || "").replace(/\D/g, "");
}
function maskCPF(v = "") {
  const d = onlyDigits(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}
function isValidCPF(cpf) {
  const s = onlyDigits(cpf);
  if (s.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(s)) return false;
  const calc = (base, factor) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(s.slice(0, 9), 10);
  const d2 = calc(s.slice(0, 10), 11);
  return d1 === Number(s[9]) && d2 === Number(s[10]);
}

/* ---------- UI helpers ---------- */
function Card({ title, subtitle, children, right }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-slate-900">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Badge({ children, tone = "slate" }) {
  const map = {
    slate: "bg-slate-100 text-slate-800 border-slate-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    if (open) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [open, onClose]);

  if (!open) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl border border-slate-200">
        <div className="sticky top-0 z-10 bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <button 
            onClick={onClose} 
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" 
            type="button"
            title="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer ? <div className="px-5 py-4 border-t border-slate-200">{footer}</div> : null}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder, disabled, hint, error }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <input
        className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50
          ${error ? "border-red-300 focus:ring-red-100" : "border-slate-300 focus:ring-slate-200"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
      />
      {error ? (
        <div className="mt-1 text-xs text-red-700">{error}</div>
      ) : hint ? (
        <div className="mt-1 text-xs text-slate-500">{hint}</div>
      ) : null}
    </label>
  );
}

function Select({ label, value, onChange, options, disabled, hint }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <select
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </label>
  );
}

/* ---------- MeuPerfilUsuario (USER role) ---------- */
function MeuPerfilUsuario({ user, addToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cpfVal, setCpfVal] = useState("");
  const [tipoUsuario, setTipoUsuario] = useState("");

  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState("");

  useEffect(() => { loadMe(); }, []);

  async function loadMe() {
    setLoading(true);
    try {
      const data = await apiFetch("/usuarios/me");
      setNome(data.nome || "");
      setEmail(data.email || "");
      setTelefone(data.telefone || "");
      setCpfVal(data.cpf || "");
      setTipoUsuario(data.tipoUsuario || "");
    } catch (e) {
      addToast(e?.message || "Erro ao carregar perfil.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    const payload = { telefone: telefone.trim() };

    if (novaSenha.trim()) {
      if (!senhaAtual.trim()) { addToast("Preencha a senha atual.", "error"); return; }
      if (novaSenha !== confirmarNovaSenha) { addToast("Senhas não coincidem.", "error"); return; }
      if (novaSenha.length < 6) { addToast("Mínimo 6 caracteres.", "error"); return; }
      payload.senhaAtual = senhaAtual;
      payload.novaSenha = novaSenha;
      payload.confirmarNovaSenha = confirmarNovaSenha;
    }

    setSaving(true);
    try {
      await apiFetch("/usuarios/me", { method: "PATCH", body: payload });
      addToast("Perfil atualizado!", "success");
      setSenhaAtual(""); setNovaSenha(""); setConfirmarNovaSenha("");
      await loadMe();
    } catch (e) {
      addToast(e?.message || "Erro ao salvar.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6"><div className="text-slate-500">Carregando...</div></div>;
  }

  return (
    <div className="p-6">
      <Card title="Meu Perfil" subtitle="Manutenção de dados pessoais">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome" value={nome} onChange={() => {}} disabled />
          <Input label="E-mail" value={email} onChange={() => {}} disabled />
          <Input label="CPF" value={maskCPF(cpfVal)} onChange={() => {}} disabled />
          <Input
            label="Telefone"
            value={maskPhoneBR(telefone)}
            onChange={(v) => setTelefone(v.replace(/\D/g, ""))}
          />
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="text-sm font-semibold text-slate-900 mb-3">Alterar senha</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Senha atual" type="password" value={senhaAtual} onChange={setSenhaAtual} placeholder="••••••••" />
            <Input label="Nova senha" type="password" value={novaSenha} onChange={setNovaSenha} placeholder="••••••••" hint="Mínimo 6 caracteres" />
            <Input label="Confirmar" type="password" value={confirmarNovaSenha} onChange={setConfirmarNovaSenha} placeholder="••••••••" />
          </div>
          <div className="mt-2 text-xs text-slate-500">Deixe em branco para manter a senha atual.</div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition disabled:opacity-70"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </Card>
    </div>
  );
}

export default function UsuariosPage({ user }) {
  const { addToast } = useToast();

  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  if (!isAdmin) {
    return <MeuPerfilUsuario user={user} addToast={addToast} />;
  }

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const [modalError, setModalError] = useState("");

  const [q, setQ] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cpf, setCpf] = useState("");
  const [tipoUsuario, setTipoUsuario] = useState("USUARIO");
  const [role, setRole] = useState("USER");
  const [senha, setSenha] = useState("");
  const [senhaConfirmacao, setSenhaConfirmacao] = useState("");

  const [ghostAdmin, setGhostAdmin] = useState(false);
  const [deveTrocarSenha, setDeveTrocarSenha] = useState(false);

  const [cpfLiveError, setCpfLiveError] = useState("");
  const [cpfTouched, setCpfTouched] = useState(false);

  const tipoOptions = useMemo(
    () => [
      { value: "USUARIO", label: "Usuário" },
      { value: "ESTAGIARIO", label: "Estagiário" },
      { value: "SECRETARIA_VIRTUAL", label: "Secretária Virtual" },
      { value: "EXTERNO", label: "Externo" },
      { value: "INTERNO", label: "Interno" },
    ],
    []
  );

  const roleOptions = useMemo(
    () => [
      { value: "ADMIN", label: "Admin" },
      { value: "USER", label: "User" },
    ],
    []
  );

  async function load() {
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch("/usuarios");

      // 🔍 DEBUG
      console.log("📥 DADOS RECEBIDOS DO BACKEND:", data);
      if (data && data.length > 0) {
        console.log("👤 Primeiro usuário:", data[0]);
        console.log("📞 Telefone:", data[0].telefone, "| CPF:", data[0].cpf);
      }
      
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || "Falha ao carregar usuários.");
      addToast(e?.message || "Falha ao carregar usuários.", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = String(q || "").trim().toLowerCase();
    if (!term) return rows;

    const termDigits = onlyDigits(term);

    return rows.filter((u) => {
      const nomeL = String(u?.nome || "").toLowerCase();
      const emailL = String(u?.email || "").toLowerCase();
      const cpfD = onlyDigits(u?.cpf || "");
      const telD = onlyDigits(u?.telefone || "");
      const tipoL = String(u?.tipoUsuario || "").toLowerCase();

      return (
        nomeL.includes(term) ||
        emailL.includes(term) ||
        tipoL.includes(term) ||
        (termDigits && (cpfD.includes(termDigits) || telD.includes(termDigits)))
      );
    });
  }, [rows, q]);

  function resetForm() {
    setNome("");
    setEmail("");
    setTelefone("");
    setCpf("");
    setTipoUsuario("USUARIO");
    setRole("USER");
    setGhostAdmin(false);
    setDeveTrocarSenha(false);
    setSenha("");
    setSenhaConfirmacao("");
    setCpfLiveError("");
    setCpfTouched(false);
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setModalError("");
    setOpen(true);
  }

  function openEdit(u) {
    setEditing(u);
    setNome(u.nome || "");
    setEmail(u.email || "");
    setCpf(u.cpf ? maskCPF(u.cpf) : "");
    setTelefone(u.telefone ? maskPhoneBR(u.telefone) : "");
    setRole(u.role || "USER");
    setTipoUsuario(u.tipoUsuario === "ADVOGADO" ? "USUARIO" : (u.tipoUsuario || "USUARIO"));
    setGhostAdmin(!!u.ghostAdmin);
    setDeveTrocarSenha(!!u.deveTrocarSenha);
    setSenha("");
    setSenhaConfirmacao("");
    setCpfTouched(false);
    setModalError("");
    setOpen(true);
  }

  function validate() {
    const emailNorm = String(email || "").trim().toLowerCase();
    if (!nome.trim()) return "Informe o nome.";
    if (!isValidEmail(emailNorm)) return "E-mail inválido.";
    if (telefone && !isValidPhoneBR(telefone)) return "Telefone inválido.";

    if (tipoUsuario === "USUARIO" || tipoUsuario === "ESTAGIARIO") {
      if (!cpf) return "CPF é obrigatório para Usuário/Estagiário.";
      if (!isValidCPF(cpf)) return "CPF inválido.";
    } else {
      if (cpf && !isValidCPF(cpf)) return "CPF inválido.";
    }

    if (!editing) {
      if (!senha || senha.length < 8) return "Senha obrigatória (mínimo 8 caracteres).";
      if (senha !== senhaConfirmacao) return "As senhas não conferem.";
    } else {
      if (senha || senhaConfirmacao) {
        if (!senha || senha.length < 8) return "Nova senha deve ter no mínimo 8 caracteres.";
        if (senha !== senhaConfirmacao) return "As senhas não conferem.";
      }
    }

    return null;
  }

  function handleCpfChange(v) {
    const masked = maskCPF(v);
    setCpf(masked);

    const d = onlyDigits(masked);
    if (!d) {
      setCpfLiveError("");
      return;
    }
    if (d.length === 11 && !isValidCPF(masked)) setCpfLiveError("CPF inválido.");
    else setCpfLiveError("");
  }

  async function save() {
    const msg = validate();
    if (msg) {
      setModalError(msg);
      return;
    }

    setModalError("");
    setLoading(true);

    const payload = {
      nome: nome.trim(),
      email: String(email).trim().toLowerCase(),
      telefone: telefone ? onlyDigits(telefone) : null,
      cpf: cpf ? onlyDigits(cpf) : null,
      tipoUsuario,
      role,
      ghostAdmin: ghostAdmin || false,
      deveTrocarSenha: deveTrocarSenha || false,
    };

    // Só adiciona senha se foi preenchida
    if (senha) {
      payload.senha = senha;
      payload.senhaConfirmacao = senhaConfirmacao;
    }

    // 🔍 DEBUG: Log do payload
    console.log("📤 PAYLOAD SENDO ENVIADO:", payload);
    console.log("📝 Dados do formulário:", { 
      cpf, 
      telefone, 
      cpfDigits: onlyDigits(cpf), 
      telefoneDigits: onlyDigits(telefone) 
    });

    try {
      let result;
      if (!editing) {
        result = await apiFetch("/usuarios", { method: "POST", body: payload });
        console.log("✅ Resposta do servidor (CREATE):", result);
        addToast("Usuário criado com sucesso!", "success");
      } else {
        result = await apiFetch(`/usuarios/${editing.id}`, { method: "PUT", body: payload });
        console.log("✅ Resposta do servidor (UPDATE):", result);
        addToast("Usuário atualizado com sucesso!", "success");
      }
      
      setOpen(false);
      resetForm();
      await load();
    } catch (e) {
      const errorMsg = e?.message || "Falha ao salvar.";
      console.error("❌ ERRO ao salvar:", e);
      setModalError(errorMsg);
      addToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }

  async function toggleAtivo(u) {
    setError("");
    setLoading(true);
    try {
      await apiFetch(`/usuarios/${u.id}/ativo`, {
        method: "PATCH",
        body: { ativo: !u.ativo },
      });
      addToast(`Usuário ${u.ativo ? "inativado" : "ativado"} com sucesso!`, "success");
      await load();
    } catch (e) {
      const errorMsg = e?.message || "Falha ao alterar status.";
      setError(errorMsg);
      addToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <Card
        title="Usuários"
        subtitle={null}
        right={
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-70"
            disabled={loading}
          >
            + Novo usuário
          </button>
        }
      >
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <input
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="Buscar por nome, e-mail, CPF, telefone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
            disabled={loading}
            title="Atualizar lista"
          >
            Atualizar
          </button>
        </div>

        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Nome</th>
                <th className="text-left px-4 py-3 font-semibold">E-mail</th>
                <th className="text-left px-4 py-3 font-semibold">Telefone</th>
                <th className="text-left px-4 py-3 font-semibold">CPF</th>
                <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                <th className="text-left px-4 py-3 font-semibold">Role</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading && !rows.length ? (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={8}>
                    Carregando…
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={8}>
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{u.nome || "—"}</td>
                    <td className="px-4 py-3">{u.email || "—"}</td>
                    <td className="px-4 py-3">{u.telefone ? maskPhoneBR(u.telefone) : "—"}</td>
                    <td className="px-4 py-3">{u.cpf ? maskCPF(u.cpf) : "—"}</td>
                    <td className="px-4 py-3">
                      {u.tipoUsuario === "ESTAGIARIO" ? (
                        <Badge tone="amber">Estagiário</Badge>
                      ) : u.tipoUsuario === "SECRETARIA_VIRTUAL" ? (
                        <span className="inline-flex items-center rounded-full border border-pink-200 bg-pink-50 text-pink-700 px-2 py-0.5 text-xs font-semibold">Secretária Virtual</span>
                      ) : (
                        <Badge tone="slate">Usuário</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.role === "ADMIN" ? "blue" : "slate"}>
                        {u.role === "ADMIN" ? (u.ghostAdmin ? "Ghost" : "Admin") : "User"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {u.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Inativo</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
                          disabled={loading}
                          title="Editar usuário"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleAtivo(u)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
                          disabled={loading}
                          title={u.ativo ? "Inativar usuário" : "Ativar usuário"}
                        >
                          {u.ativo ? "Inativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={open}
        title={editing ? "Editar Usuário" : "Novo Usuário"}
        onClose={() => !loading && setOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              disabled={loading}
            >
              {loading ? "Salvando…" : "Salvar"}
            </button>
          </div>
        }
      >
        {modalError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {modalError}
          </div>
        ) : null}

        <div className="space-y-4">
          <Input
            label="Nome completo *"
            value={nome}
            onChange={setNome}
            placeholder="Nome do usuário"
            disabled={loading}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="E-mail *"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="email@exemplo.com"
              disabled={loading}
            />

            <Input
              label="Telefone"
              value={telefone}
              onChange={(v) => setTelefone(maskPhoneBR(v))}
              placeholder="(85) 9 9999-9999"
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="CPF"
              value={cpf}
              onChange={handleCpfChange}
              onBlur={() => setCpfTouched(true)}
              placeholder="000.000.000-00"
              disabled={loading}
              error={cpfTouched && cpfLiveError ? cpfLiveError : ""}
              hint={!cpfTouched && cpfLiveError ? cpfLiveError : ""}
            />

            <Select
              label="Tipo de Usuário *"
              value={tipoUsuario}
              onChange={setTipoUsuario}
              options={tipoOptions}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Role (Permissão) *"
              value={role}
              onChange={setRole}
              options={roleOptions}
              disabled={loading}
              hint="Admin = acesso total"
            />

          </div>

          {/* Opções administrativas */}
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900 mb-2">Opções administrativas</div>

            {/* Status (somente visualização na edição) */}
            {editing && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">Status:</span>
                {editing.ativo ? (
                  <Badge tone="green">Ativo</Badge>
                ) : (
                  <Badge tone="red">Inativo</Badge>
                )}
                <span className="text-xs text-slate-400">(alterar via botão na listagem)</span>
              </div>
            )}

            {/* Ghost Admin */}
            {role === "ADMIN" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ghostAdmin}
                onChange={(e) => setGhostAdmin(e.target.checked)}
                className="rounded border-slate-300"
                disabled={loading}
              />
              <span className="text-sm text-slate-700">
                Ghost Admin (aparece como Usuário para não-admins)
              </span>
            </label>
            )}

            {/* Deve Trocar Senha */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deveTrocarSenha}
                onChange={(e) => setDeveTrocarSenha(e.target.checked)}
                className="rounded border-slate-300"
                disabled={loading}
              />
              <span className="text-sm text-slate-700">
                Forçar troca de senha no próximo login
              </span>
            </label>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="text-sm font-semibold text-slate-900 mb-3">
              {editing ? "Alterar Senha (opcional)" : "Senha *"}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label={editing ? "Nova senha" : "Senha"}
                type="password"
                value={senha}
                onChange={setSenha}
                placeholder="••••••••"
                disabled={loading}
                hint="Mínimo 8 caracteres"
              />
              <Input
                label={editing ? "Confirmar nova senha" : "Confirmar senha"}
                type="password"
                value={senhaConfirmacao}
                onChange={setSenhaConfirmacao}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>
            {editing ? (
              <div className="mt-2 text-xs text-slate-500">
                Deixe em branco para manter a senha atual.
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
