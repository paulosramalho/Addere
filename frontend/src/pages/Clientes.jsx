// src/pages/Clientes.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { isValidEmail, isValidPhoneBR, maskPhoneBR } from "../lib/validators";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import EmptyState from "../components/ui/EmptyState";

/* ---------- helpers CPF/CNPJ ---------- */
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

function maskCNPJ(v = "") {
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

function isValidCNPJ(cnpj) {
  const s = onlyDigits(cnpj);
  if (s.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(s)) return false;

  const calc = (base, weights) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(s.slice(0, 12), w1);
  const d2 = calc(s.slice(0, 12) + String(d1), w2);

  return d1 === Number(s[12]) && d2 === Number(s[13]);
}

function maskCpfCnpj(v = "") {
  const d = onlyDigits(v);
  return d.length <= 11 ? maskCPF(d) : maskCNPJ(d);
}

function isValidCpfCnpj(v = "") {
  const d = onlyDigits(v);
  if (d.length === 11) return isValidCPF(d);
  if (d.length === 14) return isValidCNPJ(d);
  return false;
}

/* ---------- Tipo helper ---------- */
function getTipoLabel(tipo) {
  const tipos = {
    F: "Fornecedor",
    C: "Cliente",
    A: "Ambos",
  };
  return tipos[tipo] || tipo || "—";
}

function getTipoBadge(tipo) {
  const config = {
    F: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", label: "Fornecedor" },
    C: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", label: "Cliente" },
    A: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", label: "Ambos" },
  };
  const c = config[tipo] || { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200", label: tipo || "—" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
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
        {right ? <div className="pt-0.5">{right}</div> : null}
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
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${map[tone] || map.slate}`}>
      {children}
    </span>
  );
}

function Input({ label, value, onChange, onBlur, placeholder, disabled, readOnly, error }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        type="text"
        className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500
          ${error ? "border-red-400 focus:ring-red-200 bg-red-50" : "border-slate-300 focus:ring-slate-200 bg-white"}`}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
      />
      {error && <p className="mt-1 text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder, disabled, readOnly }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <textarea
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-500 min-h-[80px]"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
      />
    </div>
  );
}

function InfoLine({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className="mt-1 text-sm text-slate-900 break-words">{value}</div>
    </div>
  );
}

function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div className="sticky top-0 z-10 bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100" title="Fechar">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer ? <div className="px-5 py-4 border-t border-slate-200">{footer}</div> : null}
      </div>
    </div>
  );
}

function Popover({ open, anchorEl, onClose, children }) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 300 });

  useEffect(() => {
    if (!open || !anchorEl) return;

    const r = anchorEl.getBoundingClientRect();
    const margin = 16;
    const estimatedHeight = 200;

    let left = r.left;
    let width = Math.max(300, r.width);
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }

    let top = r.bottom + margin;
    if (top + estimatedHeight > window.innerHeight - margin) {
      top = r.top - margin - estimatedHeight;
      if (top < margin) top = margin;
    }

    setPos({ top, left, width });
  }, [open, anchorEl]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50"
        style={{ top: pos.top, left: pos.left, width: pos.width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl">{children}</div>
      </div>
    </>
  );
}

export default function ClientesPage({ user }) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const isSecretaria = user?.tipoUsuario === "SECRETARIA_VIRTUAL";

  if (!isAdmin && !isSecretaria) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xl font-semibold text-slate-900">Clientes</div>
          <div className="mt-2 text-sm text-slate-600">Acesso restrito a administradores.</div>
        </div>
      </div>
    );
  }

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewing, setViewing] = useState(null);

  const [obsOpenId, setObsOpenId] = useState(null);
  const obsBtnRefs = useRef({});

  const [cpfCnpj, setCpfCnpj] = useState("");
  const [nomeRazaoSocial, setNomeRazaoSocial] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [tipo, setTipo] = useState("C");
  const [naoEnviarEmails, setNaoEnviarEmails] = useState(false);

  // Endereço
  const [cep, setCep]             = useState("");
  const [endereco, setEndereco]   = useState("");
  const [numero, setNumero]       = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro]       = useState("");
  const [cidade, setCidade]       = useState("");
  const [uf, setUf]               = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  const [fe, setFe] = useState({}); // field errors

  function setFieldError(field, msg) {
    setFe(prev => ({ ...prev, [field]: msg }));
  }
  function clearFieldError(field) {
    setFe(prev => ({ ...prev, [field]: "" }));
  }

  function blurCpfCnpj() {
    if (!cpfCnpj) { setFieldError("cpfCnpj", "CPF/CNPJ obrigatório."); return; }
    if (!isValidCpfCnpj(cpfCnpj)) { setFieldError("cpfCnpj", "CPF/CNPJ inválido."); return; }
    clearFieldError("cpfCnpj");
  }
  function blurNome() {
    if (!nomeRazaoSocial.trim()) setFieldError("nome", "Nome/Razão Social obrigatório.");
    else clearFieldError("nome");
  }
  function blurEmail() {
    if (email && !isValidEmail(String(email).trim().toLowerCase()))
      setFieldError("email", "E-mail inválido.");
    else clearFieldError("email");
  }
  function blurTelefone() {
    if (telefone && !isValidPhoneBR(telefone))
      setFieldError("telefone", "Telefone inválido. Use (99) 9 9999-9999.");
    else clearFieldError("telefone");
  }

  async function load() {
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch("/clients");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      addToast(e?.message || "Falha ao carregar clientes.", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const busca = new URLSearchParams(location.search).get("busca");
    if (busca) setQ(busca);
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = String(q || "").trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((c) => {
      const doc = String(c?.cpfCnpj || "");
      const nome = String(c?.nomeRazaoSocial || "");
      const em = String(c?.email || "");
      const tel = String(c?.telefone || "");
      const obs = String(c?.observacoes || "");
      return (
        doc.toLowerCase().includes(term) ||
        maskCpfCnpj(doc).toLowerCase().includes(term) ||
        nome.toLowerCase().includes(term) ||
        em.toLowerCase().includes(term) ||
        maskPhoneBR(tel).toLowerCase().includes(term) ||
        obs.toLowerCase().includes(term)
      );
    });
  }, [rows, q]);

  async function buscarCep(cepVal) {
    const digits = onlyDigits(cepVal);
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const d = await r.json();
      if (d.erro) { addToast("CEP não encontrado.", "error"); return; }
      setEndereco(d.logradouro || "");
      setBairro(d.bairro || "");
      setCidade(d.localidade || "");
      setUf(d.uf || "");
    } catch {
      addToast("Erro ao buscar CEP.", "error");
    } finally {
      setCepLoading(false);
    }
  }

  function maskCep(v = "") {
    const d = onlyDigits(v).slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  }

  function resetForm() {
    setCpfCnpj("");
    setNomeRazaoSocial("");
    setEmail("");
    setTelefone("");
    setObservacoes("");
    setTipo("C");
    setNaoEnviarEmails(false);
    setCep(""); setEndereco(""); setNumero(""); setComplemento("");
    setBairro(""); setCidade(""); setUf("");
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setError("");
    setFe({});
    setOpen(true);
  }

  function openEdit(c) {
    setEditing(c);
    setCpfCnpj(maskCpfCnpj(c?.cpfCnpj || ""));
    setNomeRazaoSocial(c?.nomeRazaoSocial || "");
    setEmail(c?.email || "");
    setTelefone(c?.telefone ? maskPhoneBR(c.telefone) : "");
    setObservacoes(c?.observacoes || "");
    setTipo(c?.tipo || "C");
    setNaoEnviarEmails(c?.naoEnviarEmails ?? false);
    setCep(c?.cep ? maskCep(c.cep) : "");
    setEndereco(c?.endereco || "");
    setNumero(c?.numero || "");
    setComplemento(c?.complemento || "");
    setBairro(c?.bairro || "");
    setCidade(c?.cidade || "");
    setUf(c?.uf || "");
    setError("");
    setFe({});
    setOpen(true);
  }

  function openView(c) {
    setViewing(c);
    setViewOpen(true);
  }

  function validate() {
    if (!isSecretaria) {
      if (!cpfCnpj) return "Informe CPF ou CNPJ.";
      if (!isValidCpfCnpj(cpfCnpj)) return "CPF/CNPJ inválido.";
      if (!nomeRazaoSocial.trim()) return "Informe Nome/Razão Social.";
    }
    if (email && !isValidEmail(String(email).trim().toLowerCase())) return "E-mail inválido.";
    if (telefone && !isValidPhoneBR(telefone)) return "Telefone inválido.";
    return null;
  }

  async function save() {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }

    setError("");
    setLoading(true);

    const payload = isSecretaria
      ? {
          email: email ? String(email).trim().toLowerCase() : null,
          telefone: telefone ? onlyDigits(telefone) : null,
        }
      : {
          cpfCnpj: onlyDigits(cpfCnpj),
          nomeRazaoSocial: nomeRazaoSocial.trim(),
          email: email ? String(email).trim().toLowerCase() : null,
          telefone: telefone ? onlyDigits(telefone) : null,
          observacoes: observacoes ? String(observacoes).trim() : null,
          tipo: tipo || "C",
          naoEnviarEmails,
          cep:         onlyDigits(cep) || null,
          endereco:    endereco.trim()  || null,
          numero:      numero.trim()    || null,
          complemento: complemento.trim() || null,
          bairro:      bairro.trim()    || null,
          cidade:      cidade.trim()    || null,
          uf:          uf.trim().toUpperCase().slice(0, 2) || null,
        };

    try {
      if (!editing) {
        await apiFetch("/clients", { method: "POST", body: payload });
        addToast("Cliente criado com sucesso!", "success");
      } else {
        await apiFetch(`/clients/${editing.id}`, { method: "PUT", body: payload });
        addToast("Cliente atualizado com sucesso!", "success");
      }

      setOpen(false);
      resetForm();
      await load();
    } catch (e) {
      setError(e?.message || "Falha ao salvar cliente.");
      addToast(e?.message || "Falha ao salvar cliente.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function toggleAtivo(c) {
    setError("");
    setLoading(true);
    try {
      await apiFetch(`/clients/${c.id}/toggle`, { method: "PATCH" });
      addToast(`Cliente ${c.ativo ? "inativado" : "ativado"} com sucesso!`, "success");
      await load();
    } catch (e) {
      addToast(e?.message || "Falha ao ativar/inativar.", "error");
    } finally {
      setLoading(false);
    }
  }

  const searchRow = (
    <div className="flex items-center gap-3">
      <input
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        placeholder="Buscar por nome, e-mail, CPF/CNPJ…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Tooltip content="Atualizar lista">
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
          disabled={loading}
        >
          Atualizar
        </button>
      </Tooltip>
    </div>
  );

  const actionButton = isAdmin ? (
    <Tooltip content="Cadastrar novo cliente">
      <button
        type="button"
        onClick={openCreate}
        className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800"
        disabled={loading}
      >
        + Novo cliente
      </button>
    </Tooltip>
  ) : null;

  return (
    <div className="p-6">
      <Card title="Clientes" subtitle={null} right={actionButton}>
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
        ) : null}

        {searchRow}

        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">CPF/CNPJ</th>
                <th className="text-left px-4 py-3 font-semibold">Nome/Razão Social</th>
                <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                <th className="text-left px-4 py-3 font-semibold">Telefone</th>
                <th className="text-left px-4 py-3 font-semibold">E-mail</th>
                <th className="text-left px-4 py-3 font-semibold">Observações</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((c) => {
                const obs = String(c?.observacoes || "").trim();
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Tooltip content="Clique para ver detalhes">
                        <button type="button" onClick={() => openView(c)} className="font-semibold text-slate-900 hover:underline">
                          {maskCpfCnpj(c?.cpfCnpj || "")}
                        </button>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-3">{c?.nomeRazaoSocial || "—"}</td>
                    <td className="px-4 py-3">{getTipoBadge(c?.tipo)}</td>
                    <td className="px-4 py-3">{c?.telefone ? maskPhoneBR(c.telefone) : "—"}</td>
                    <td className="px-4 py-3">{c?.email || "—"}</td>
                    <td className="px-4 py-3">
                      {obs ? (
                        <>
                          <button
                            ref={(el) => (obsBtnRefs.current[c.id] = el)}
                            type="button"
                            onClick={() => setObsOpenId(c.id)}
                            className="text-slate-600 hover:text-slate-900 text-xs underline"
                          >
                            Ver observações
                          </button>
                          <Popover
                            open={obsOpenId === c.id}
                            anchorEl={obsBtnRefs.current[c.id]}
                            onClose={() => setObsOpenId(null)}
                          >
                            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-slate-900">Observações</div>
                              <button
                                type="button"
                                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                                onClick={() => setObsOpenId(null)}
                                title="Fechar"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="p-4 text-sm text-slate-700 whitespace-pre-wrap text-left">{obs}</div>
                          </Popover>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3">{c?.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Inativo</Badge>}</td>

                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Tooltip content="Repositório de documentos do cliente">
                          <button
                            type="button"
                            onClick={() => navigate(`/clientes/${c.id}/documentos`)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                          >
                            Docs
                          </button>
                        </Tooltip>
                        <Tooltip content="Editar informações do cliente">
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                            disabled={loading}
                          >
                            Editar
                          </button>
                        </Tooltip>
                        {isAdmin && (
                          <Tooltip content={c?.ativo ? "Desativar este cliente" : "Reativar este cliente"}>
                            <button
                              type="button"
                              onClick={() => toggleAtivo(c)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                              disabled={loading}
                            >
                              {c?.ativo ? "Inativar" : "Ativar"}
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!filtered.length ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      compact
                      icon={loading ? null : "👤"}
                      title={loading ? "Carregando..." : "Nenhum cliente encontrado."}
                      description={!loading && "Ajuste os filtros ou cadastre um novo cliente."}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal criar/editar */}
      <Modal
        open={open}
        title={editing ? "Editar Cliente" : "Novo Cliente"}
        onClose={() => setOpen(false)}
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
              {loading ? "Salvando..." : "Salvar"}
            </button>
          </div>
        }
      >
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
        ) : null}

        {isSecretaria ? (
          /* Secretária: apenas telefone e e-mail */
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Como Secretária Virtual, você pode editar apenas <strong>Telefone</strong> e <strong>E-mail</strong>.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Telefone"
                value={telefone}
                onChange={(v) => setTelefone(maskPhoneBR(v))}
                placeholder="(99) 9 9999-9999"
                disabled={loading}
              />
              <Input
                label="E-mail"
                value={email}
                onChange={setEmail}
                placeholder="ex.: cliente@empresa.com"
                disabled={loading}
              />
            </div>
          </div>
        ) : (
          /* Admin: formulário completo */
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="CPF/CNPJ *"
                value={cpfCnpj}
                onChange={(v) => { setCpfCnpj(maskCpfCnpj(v)); clearFieldError("cpfCnpj"); }}
                onBlur={blurCpfCnpj}
                placeholder="CPF (11) ou CNPJ (14)"
                disabled={loading}
                error={fe.cpfCnpj}
              />
              <Input
                label="Nome/Razão Social *"
                value={nomeRazaoSocial}
                onChange={(v) => { setNomeRazaoSocial(v); clearFieldError("nome"); }}
                onBlur={blurNome}
                placeholder="Ex.: Fulano de Tal / Empresa X Ltda."
                disabled={loading}
                error={fe.nome}
              />
              <div>
                <label className="text-sm font-medium text-slate-700">Tipo</label>
                <select
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  disabled={loading}
                >
                  <option value="C">Cliente</option>
                  <option value="F">Fornecedor</option>
                  <option value="A">Ambos</option>
                </select>
              </div>
              <Input
                label="Telefone"
                value={telefone}
                onChange={(v) => { setTelefone(maskPhoneBR(v)); clearFieldError("telefone"); }}
                onBlur={blurTelefone}
                placeholder="(99) 9 9999-9999"
                disabled={loading}
                error={fe.telefone}
              />
              <Input
                label="E-mail"
                value={email}
                onChange={(v) => { setEmail(v); clearFieldError("email"); }}
                onBlur={blurEmail}
                placeholder="ex.: cliente@empresa.com"
                disabled={loading}
                error={fe.email}
              />
            </div>

            {/* Endereço */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Endereço</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* CEP */}
                <div className="relative">
                  <label className="text-sm font-medium text-slate-700">CEP</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="text"
                      value={cep}
                      onChange={(e) => setCep(maskCep(e.target.value))}
                      onBlur={(e) => buscarCep(e.target.value)}
                      placeholder="00000-000"
                      maxLength={9}
                      disabled={loading || cepLoading}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                    />
                    {cepLoading && (
                      <span className="absolute right-3 top-9 text-slate-400 text-xs">...</span>
                    )}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-slate-700">Logradouro</label>
                  <input type="text" value={endereco}
                    onChange={(e) => setEndereco(e.target.value)}
                    placeholder="Rua, Avenida..."
                    disabled={loading}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Número</label>
                  <input type="text" value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="Ex.: 130"
                    disabled={loading}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Complemento</label>
                  <input type="text" value={complemento}
                    onChange={(e) => setComplemento(e.target.value)}
                    placeholder="Apto, Sala..."
                    disabled={loading}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Bairro</label>
                  <input type="text" value={bairro}
                    onChange={(e) => setBairro(e.target.value)}
                    placeholder="Bairro"
                    disabled={loading}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-slate-700">Cidade</label>
                  <input type="text" value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    placeholder="Cidade"
                    disabled={loading}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">UF</label>
                  <input type="text" value={uf}
                    onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
                    placeholder="PA"
                    maxLength={2}
                    disabled={loading}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Textarea
                label="Observações"
                value={observacoes}
                onChange={setObservacoes}
                placeholder="Notas internas…"
                disabled={loading}
              />
            </div>
            <div className="mt-4">
              <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={naoEnviarEmails}
                  onChange={e => setNaoEnviarEmails(e.target.checked)}
                  disabled={loading}
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span>Opt-out — não enviar e-mails automáticos de vencimento/atraso</span>
              </label>
            </div>
          </>
        )}
      </Modal>

      {/* Modal detalhes (somente leitura) */}
      <Modal
        open={viewOpen}
        title="Detalhes do Cliente"
        onClose={() => setViewOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setViewOpen(false);
                if (viewing) openEdit(viewing);
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => setViewOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Fechar
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoLine label="CPF/CNPJ" value={maskCpfCnpj(viewing?.cpfCnpj || "")} />
          <InfoLine label="Status" value={viewing?.ativo ? "Ativo" : "Inativo"} />
          <InfoLine label="Nome/Razão Social" value={viewing?.nomeRazaoSocial || "—"} />
          <InfoLine label="Tipo" value={getTipoLabel(viewing?.tipo)} />
          <InfoLine label="E-mail" value={viewing?.email || "—"} />
          <InfoLine label="Telefone" value={viewing?.telefone ? maskPhoneBR(viewing.telefone) : "—"} />
          <InfoLine label="ID" value={viewing?.id ? String(viewing.id) : "—"} />
        </div>

        <div className="mt-4">
          <Textarea label="Observações" value={String(viewing?.observacoes || "")} onChange={() => {}} readOnly placeholder="—" />
        </div>
      </Modal>
    </div>
  );
}