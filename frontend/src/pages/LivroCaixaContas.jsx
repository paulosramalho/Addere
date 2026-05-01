// src/pages/LivroCaixaContas.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import { brlFromCentavos as formatBRL } from '../lib/formatters';

// ── Card de dados bancários ───────────────────────────────────────────────────
function bankGradient(nome) {
  const n = nome.toLowerCase();
  if (n.includes("inter"))                     return "from-orange-500 to-orange-600";
  if (n.includes("santander"))                 return "from-red-600 to-red-700";
  if (n.includes("vrde") || n.includes("verde")) return "from-emerald-600 to-teal-600";
  if (n.includes("nubank"))                    return "from-purple-600 to-purple-700";
  if (n.includes("itaú") || n.includes("itau")) return "from-orange-500 to-amber-500";
  if (n.includes("bradesco"))                  return "from-red-700 to-red-800";
  if (n.includes("brasil") || n.includes("bb")) return "from-yellow-500 to-yellow-600";
  if (n.includes("caixa"))                     return "from-blue-700 to-blue-800";
  if (n.includes("sicredi"))                   return "from-green-700 to-green-800";
  return "from-slate-700 to-slate-800";
}

function formatPixLabel(chave) {
  if (!chave) return null;
  const d = chave.replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  if (d.length === 11 && !chave.includes("@") && !chave.includes("-"))
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return chave;
}

function BancoCard({ conta, selecionada, onToggle }) {
  const grad = bankGradient(conta.nome);
  return (
    <div className={`rounded-2xl overflow-hidden shadow-md transition-opacity ${!selecionada ? "opacity-40" : ""}`}>
      {/* Cabeçalho colorido */}
      <div className={`bg-gradient-to-r ${grad} px-5 py-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <span className="text-3xl">🏦</span>
          <span className="font-bold text-white text-base tracking-wider uppercase drop-shadow">
            {conta.nome}
          </span>
        </div>
        {/* Toggle Enviar */}
        <label className="flex items-center gap-2 cursor-pointer select-none" onClick={onToggle}>
          <span className="text-white/80 text-sm font-medium">Enviar</span>
          <div className={`relative w-11 h-6 rounded-full transition-colors ${selecionada ? "bg-white/40" : "bg-black/30"}`}>
            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${selecionada ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
        </label>
      </div>
      {/* Corpo */}
      <div className="bg-slate-50 px-5 py-3 space-y-2">
        {(conta.agencia || conta.conta) && (
          <div className="flex gap-6 text-sm">
            {conta.agencia && (
              <span className="text-slate-700">
                <span className="font-semibold">Ag:</span> {conta.agencia}
              </span>
            )}
            {conta.conta && (
              <span className="text-slate-700">
                <span className="font-semibold">Cc:</span> {conta.conta}
              </span>
            )}
          </div>
        )}
        {(conta.chavePix1 || conta.chavePix2) && (
          <div className={`space-y-1 ${(conta.agencia || conta.conta) ? "border-t border-slate-200 pt-2" : ""}`}>
            {conta.chavePix1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-blue-500 text-base">✦</span>
                <span className="font-semibold text-slate-700">Pix:</span>
                <span className="text-slate-600 font-mono text-xs">{formatPixLabel(conta.chavePix1)}</span>
              </div>
            )}
            {conta.chavePix2 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-blue-500 text-base">✦</span>
                <span className="font-semibold text-slate-700">Pix:</span>
                <span className="text-slate-600 font-mono text-xs">{formatPixLabel(conta.chavePix2)}</span>
              </div>
            )}
          </div>
        )}
        {!conta.agencia && !conta.conta && !conta.chavePix1 && !conta.chavePix2 && (
          <p className="text-xs text-slate-400 italic">Nenhuma informação de pagamento cadastrada.</p>
        )}
      </div>
    </div>
  );
}

function DadosBancariosModal({ onClose }) {
  const { addToast } = useToast();
  const [bancas, setBancas] = useState([]);
  const [loadingBancas, setLoadingBancas] = useState(true);
  const [selecionadas, setSelecionadas] = useState({});
  const [phone, setPhone] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    apiFetch("/livro-caixa/contas")
      .then(data => {
        const arr = Array.isArray(data) ? data : (data?.contas || []);
        const ativas = arr.filter(c => c.tipo === "BANCO" && c.ativa);
        setBancas(ativas);
        setSelecionadas(Object.fromEntries(ativas.map(c => [c.id, true])));
      })
      .catch(() => addToast("Erro ao carregar contas", "error"))
      .finally(() => setLoadingBancas(false));
  }, []);

  function toggle(id) {
    setSelecionadas(p => ({ ...p, [id]: !p[id] }));
  }

  async function handleEnviar() {
    const ids = Object.entries(selecionadas).filter(([, v]) => v).map(([k]) => parseInt(k));
    if (ids.length === 0) { addToast("Selecione ao menos uma conta", "error"); return; }
    if (!phone.trim()) { addToast("Informe o número de WhatsApp", "error"); return; }
    setEnviando(true);
    try {
      await apiFetch("/dados-bancarios/enviar", { method: "POST", body: { contaIds: ids, phone: phone.trim() } });
      addToast("Dados bancários enviados via WhatsApp!", "success");
      onClose();
    } catch (e) {
      addToast(e.message || "Erro ao enviar", "error");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Dados Bancários</h3>
            <p className="text-xs text-slate-500 mt-0.5">Selecione as contas e envie via WhatsApp</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        {/* Cards */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {loadingBancas ? (
            <p className="text-slate-400 text-center py-8 text-sm">Carregando contas…</p>
          ) : bancas.length === 0 ? (
            <p className="text-slate-500 text-center py-8">Nenhuma conta bancária ativa cadastrada.</p>
          ) : (
            bancas.map(c => (
              <BancoCard key={c.id} conta={c} selecionada={!!selecionadas[c.id]} onToggle={() => toggle(c.id)} />
            ))
          )}

          {/* Destinatário */}
          <div className="pt-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1">WhatsApp do destinatário</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="Ex: 91999887766"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">DDD + número, sem espaços</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={handleEnviar}
            disabled={enviando || Object.values(selecionadas).every(v => !v) || !phone.trim()}
            className="flex-1 rounded-xl bg-green-600 text-white px-4 py-2 font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {enviando ? "Enviando…" : "📤 Enviar via WhatsApp"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LivroCaixaContas({ user }) {
  const { addToast, confirmToast } = useToast();

  const [contas, setContas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showDadosBancarios, setShowDadosBancarios] = useState(false);
  const [editingConta, setEditingConta] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "BANCO",
    ordem: 0,
    ativa: true,
    dataInicial: "",
    saldoInicial: "",
    chavePix1: "",
    chavePix2: "",
    interContaId: "",
  });

  function parseSaldo(str) {
    if (!str) return 0;
    const s = String(str).trim();
    // Brazilian format: "14.883,92" → remove dot separators → replace comma → parse
    if (s.includes(",")) {
      const cleaned = s.replace(/\./g, "").replace(",", ".");
      return Math.round(parseFloat(cleaned) * 100) || 0;
    }
    // Plain or US format: "14883.92"
    return Math.round(parseFloat(s.replace(/[^\d.]/g, "")) * 100) || 0;
  }

  const TIPOS_CONTA = [
    { value: "BANCO", label: "Banco" },
    { value: "APLICACAO", label: "Aplicação" },
    { value: "CAIXA", label: "Caixa" },
    { value: "CLIENTES", label: "Clientes" },
    { value: "CARTAO_CREDITO", label: "Cartão de Crédito" },
    { value: "CARTAO_DEBITO", label: "Cartão de Débito" },
    { value: "OUTROS", label: "Outros" },
  ];

  useEffect(() => {
    loadContas();
  }, []);

  async function loadContas() {
    try {
      setLoading(true);
      setError("");
      const data = await apiFetch("/livro-caixa/contas");
      setContas(Array.isArray(data) ? data : (data?.contas || []));
    } catch (err) {
      const errorMsg = err.message || "Erro ao carregar contas";
      setError(errorMsg);
      addToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }

  function openNewModal() {
    setEditingConta(null);
    setFormData({
      nome: "",
      tipo: "BANCO",
      ordem: contas.length + 1,
      ativa: true,
      dataInicial: "",
      saldoInicial: "",
      chavePix1: "",
      chavePix2: "",
      agencia: "",
      conta: "",
      interContaId: "",
    });
    setShowModal(true);
  }

  function openEditModal(conta) {
    setEditingConta(conta);
    setFormData({
      nome: conta.nome,
      tipo: conta.tipo,
      ordem: conta.ordem,
      ativa: conta.ativa,
      dataInicial: conta.dataInicial ? conta.dataInicial.slice(0, 10) : "",
      saldoInicial: conta.saldoInicialCent ? (conta.saldoInicialCent / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
      chavePix1: conta.chavePix1 || "",
      chavePix2: conta.chavePix2 || "",
      agencia: conta.agencia || "",
      conta: conta.conta || "",
      interContaId: conta.interContaId || "",
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingConta(null);
    setFormData({
      nome: "",
      tipo: "BANCO",
      ordem: 0,
      ativa: true,
      dataInicial: "",
      saldoInicial: "",
      chavePix1: "",
      chavePix2: "",
      agencia: "",
      conta: "",
      interContaId: "",
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      ...formData,
      saldoInicialCent: parseSaldo(formData.saldoInicial),
      dataInicial: formData.dataInicial || null,
      chavePix1: formData.chavePix1 || null,
      chavePix2: formData.chavePix2 || null,
      agencia: formData.agencia || null,
      conta: formData.conta || null,
      interContaId: formData.interContaId || null,
    };
    delete payload.saldoInicial;

    try {
      if (editingConta) {
        await apiFetch(`/livro-caixa/contas/${editingConta.id}`, {
          method: "PUT",
          body: payload,
        });
        addToast("Conta atualizada com sucesso!", "success");
      } else {
        await apiFetch("/livro-caixa/contas", {
          method: "POST",
          body: payload,
        });
        addToast("Conta criada com sucesso!", "success");
      }

      closeModal();
      loadContas();
    } catch (err) {
      addToast(err.message || "Erro ao salvar conta", "error");
    }
  }

  async function handleDelete(conta) {
    const ok = await confirmToast(`Deseja realmente excluir a conta "${conta.nome}"?`);
    if (!ok) {
      return;
    }

    try {
      await apiFetch(`/livro-caixa/contas/${conta.id}`, {
        method: "DELETE",
      });
      addToast("Conta excluída com sucesso!", "success");
      loadContas();
    } catch (err) {
      addToast(err.message || "Não foi possível excluir a conta", "error");
    }
  }

  async function handleToggleAtiva(conta) {
    try {
      await apiFetch(`/livro-caixa/contas/${conta.id}`, {
        method: "PUT",
        body: { ...conta, ativa: !conta.ativa },
      });
      addToast(`Conta ${!conta.ativa ? "ativada" : "desativada"} com sucesso!`, "success");
      loadContas();
    } catch (err) {
      addToast(err.message || "Erro ao atualizar status da conta", "error");
    }
  }

  // Agrupar por tipo
  const contasPorTipo = TIPOS_CONTA.map((tipoConfig) => ({
    ...tipoConfig,
    contas: contas
      .filter((c) => c.tipo === tipoConfig.value)
      .sort((a, b) => (a.ordem - b.ordem) || (a.id - b.id)),
  })).filter((grupo) => grupo.contas.length > 0);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-slate-600">Carregando contas...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contas Contábeis</h1>
          <p className="text-sm text-slate-600 mt-1">
            Gerenciar contas do Livro Caixa
          </p>
        </div>
        <div className="flex gap-2">
          <Tooltip content="Enviar dados bancários via WhatsApp">
            <button
              onClick={() => setShowDadosBancarios(true)}
              className="rounded-xl bg-green-600 text-white px-4 py-2 font-semibold hover:bg-green-700"
            >
              📤 Dados Bancários
            </button>
          </Tooltip>
          <Tooltip content="Criar nova conta contábil">
            <button
              onClick={openNewModal}
              className="rounded-xl bg-blue-700 text-white px-4 py-2 font-semibold hover:bg-blue-800"
            >
              + Nova Conta
            </button>
          </Tooltip>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 text-red-800 px-4 py-3">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {contasPorTipo.map((grupo) => (
          <div key={grupo.value} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">{grupo.label}</h2>
            </div>

            <div className="divide-y divide-slate-200">
              {grupo.contas.map((conta) => (
                <div
                  key={conta.id}
                  className="px-4 py-3 flex items-center justify-between hover:bg-slate-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="text-xs text-slate-500 w-16 shrink-0 leading-tight">
                      <div>ID #{conta.id}</div>
                      <div>Ordem {conta.ordem}</div>
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">
                        {conta.nome}
                      </div>
                      <div className="text-xs text-slate-500 flex gap-3 mt-0.5 flex-wrap">
                        {conta.dataInicial && (
                          <span>Desde {new Date(conta.dataInicial).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>
                        )}
                        {conta.saldoInicialCent !== undefined && conta.saldoInicialCent !== 0 && (
                          <span>Saldo inicial: {formatBRL(conta.saldoInicialCent)}</span>
                        )}
                        {conta.agencia && <span className="text-slate-500">Ag: {conta.agencia}</span>}
                        {conta.conta && <span className="text-slate-500">Cc: {conta.conta}</span>}
                        {conta.chavePix1 && <span className="text-blue-600">Pix: {conta.chavePix1}</span>}
                        {conta.chavePix2 && <span className="text-blue-600">Pix 2: {conta.chavePix2}</span>}
                        {conta.interContaId && <span className="text-orange-600 font-semibold">⚡ API Inter PJ</span>}
                      </div>
                      {!conta.ativa && (
                        <div className="text-xs text-red-600 font-semibold">
                          INATIVA
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Tooltip content={conta.ativa ? "Desativar esta conta" : "Ativar esta conta"}>
                      <button
                        onClick={() => handleToggleAtiva(conta)}
                        className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                          conta.ativa
                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {conta.ativa ? "Ativa" : "Inativa"}
                      </button>
                    </Tooltip>

                    <Tooltip content="Editar informações desta conta">
                      <button
                        onClick={() => openEditModal(conta)}
                        className="px-3 py-1 rounded-lg bg-blue-100 text-blue-800 hover:bg-blue-200 text-sm font-semibold"
                      >
                        Editar
                      </button>
                    </Tooltip>

                    <Tooltip content="Excluir esta conta permanentemente">
                      <button
                        onClick={() => handleDelete(conta)}
                        className="px-3 py-1 rounded-lg bg-red-100 text-red-800 hover:bg-red-200 text-sm font-semibold"
                      >
                        Excluir
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {contas.length === 0 && (
          <div className="text-center py-12 text-slate-600">
            Nenhuma conta cadastrada. Clique em "Nova Conta" para começar.
          </div>
        )}
      </div>

      {/* Modal Dados Bancários */}
      {showDadosBancarios && (
        <DadosBancariosModal onClose={() => setShowDadosBancarios(false)} />
      )}

      {/* Modal Nova/Editar Conta */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            {/* Header fixo */}
            <div className="px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <h3 className="text-lg font-semibold text-slate-900">
                {editingConta ? "Editar Conta" : "Nova Conta"}
              </h3>
            </div>

            {/* Body rolável */}
            <form id="conta-form" onSubmit={handleSubmit} className="overflow-y-auto flex-1 min-h-0 p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Nome da Conta
                </label>
                <input
                  type="text"
                  value={formData.nome}
                  onChange={(e) =>
                    setFormData({ ...formData, nome: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Ex: Banco Inter"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Tipo
                </label>
                <select
                  value={formData.tipo}
                  onChange={(e) =>
                    setFormData({ ...formData, tipo: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                  required
                >
                  {TIPOS_CONTA.map((tipo) => (
                    <option key={tipo.value} value={tipo.value}>
                      {tipo.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Data Inicial
                  </label>
                  <input
                    type="date"
                    value={formData.dataInicial}
                    onChange={(e) => setFormData({ ...formData, dataInicial: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Saldo Inicial (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formData.saldoInicial}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "");
                      const cents = parseInt(digits || "0", 10);
                      const formatted = cents === 0 ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      setFormData({ ...formData, saldoInicial: formatted });
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="0,00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Ordem
                </label>
                <input
                  type="number"
                  value={formData.ordem}
                  onChange={(e) =>
                    setFormData({ ...formData, ordem: parseInt(e.target.value) || 0 })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                  min="0"
                  required
                />
              </div>

              {formData.tipo === "BANCO" && (
                <div className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">
                        Agência
                      </label>
                      <input
                        type="text"
                        value={formData.agencia || ""}
                        onChange={(e) => setFormData({ ...formData, agencia: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="Ex: 0001"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">
                        Conta
                      </label>
                      <input
                        type="text"
                        value={formData.conta || ""}
                        onChange={(e) => {
                          const novaConta = e.target.value;
                          // Se Inter PJ marcado, atualiza interContaId junto
                          const novoInter = formData.interContaId
                            ? novaConta.replace(/\D/g, "") || "inter"
                            : formData.interContaId;
                          setFormData({ ...formData, conta: novaConta, interContaId: novoInter });
                        }}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="Ex: 12345-6"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      Chave Pix 1
                    </label>
                    <input
                      type="text"
                      value={formData.chavePix1}
                      onChange={(e) => setFormData({ ...formData, chavePix1: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                      placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      Chave Pix 2
                    </label>
                    <input
                      type="text"
                      value={formData.chavePix2}
                      onChange={(e) => setFormData({ ...formData, chavePix2: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
                      placeholder="Chave alternativa (opcional)"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                    <input
                      type="checkbox"
                      checked={!!formData.interContaId}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData({
                          ...formData,
                          interContaId: checked
                            ? (formData.conta || "").replace(/\D/g, "") || "inter"
                            : "",
                        });
                      }}
                      className="rounded w-4 h-4 accent-orange-500"
                    />
                    <div>
                      <span className="text-sm font-semibold text-slate-700">Conta Inter PJ (API Banking)</span>
                      <p className="text-xs text-slate-400">Habilita integração com a API Banking.</p>
                    </div>
                  </label>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ativa"
                  checked={formData.ativa}
                  onChange={(e) =>
                    setFormData({ ...formData, ativa: e.target.checked })
                  }
                  className="rounded"
                />
                <label htmlFor="ativa" className="text-sm font-semibold text-slate-700">
                  Conta Ativa
                </label>
              </div>

            </form>

            {/* Footer fixo */}
            <div className="px-6 py-4 border-t border-slate-200 flex-shrink-0 flex gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="conta-form"
                className="flex-1 rounded-xl bg-blue-700 text-white px-4 py-2 font-semibold hover:bg-blue-800"
              >
                {editingConta ? "Salvar" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
