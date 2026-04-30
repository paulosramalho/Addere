// src/pages/ModeloDistribuicao.jsx
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { Fragment } from "react";
import { useToast } from "../components/Toast";

function Button({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={
        "rounded-xl px-3 py-2 text-sm font-semibold border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-60 " +
        className
      }
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={
        "rounded-xl px-3 py-2 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 " +
        className
      }
    >
      {children}
    </button>
  );
}

function DangerButton({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={
        "rounded-xl px-3 py-2 text-sm font-semibold bg-red-600 text-white hover:bg-red-500 disabled:opacity-60 " +
        className
      }
    >
      {children}
    </button>
  );
}

function Badge({ children, tone = "slate" }) {
  const map = {
    slate: "bg-slate-600 text-white",
    green: "bg-green-600 text-white",
    red: "bg-red-600 text-white",
    blue: "bg-blue-600 text-white",
    amber: "bg-amber-500 text-white",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200">
          <div className="text-lg font-semibold text-slate-900">{title}</div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function ModeloDistribuicao() {
  const { addToast, confirmToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [itens, setItens] = useState([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // item ou null
  const [form, setForm] = useState({
  cod: "",
  descricao: "",
  ativo: true,
  origem: "REPASSE",
  periodicidade: "INCIDENTAL",
});

  // controle de expansão
  const [openItens, setOpenItens] = useState({}); // { [modeloId]: true }

  // itens por modelo
  const [itensByModelo, setItensByModelo] = useState({});
  const [itensLoading, setItensLoading] = useState({});
  const [itensError, setItensError] = useState({});

  // formulário de novo item
  const [novoItem, setNovoItem] = useState({}); // { [modeloId]: {...} }

  // edição inline
  const [editItem, setEditItem] = useState({});
  const [savingItem, setSavingItem] = useState({});

  function percentToBp(p) {
    const v = String(p ?? "").replace(",", ".").trim();
    const n = Number(v);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100);
  }

  function bpToPercent(bp) {
    if (!Number.isFinite(Number(bp))) return "";
    return (Number(bp) / 100).toFixed(2);
  }

function sanitizePercentInput(raw) {
  const v = String(raw ?? "");

  // mantém só dígitos e separadores
  const cleaned = v.replace(/[^\d.,]/g, "");

  // separa por , ou .
  const parts = cleaned.split(/[.,]/);

  const intPart = (parts[0] || "").slice(0, 3); // até 999
  const decPart = parts.slice(1).join("").slice(0, 2); // 2 casas

  if (!decPart) return intPart;
  return `${intPart},${decPart}`;
}

  function clampPercentToRemaining(percentStr, remainingBp) {
    const bp = percentToBp(percentStr);
    if (!Number.isFinite(bp) || bp <= 0) return { bp: NaN, str: "" };   
    const clamped = Math.min(bp, Math.max(0, remainingBp));
    return { bp: clamped, str: (clamped / 100).toFixed(2).replace(".", ",") };
  }

  function somaBp(itens) {
    return (itens || []).reduce((a, i) => a + Number(i.percentualBp || 0), 0);
  }

  async function load() {
    setError("");
    setLoading(true);
    try {
      // Ajuste aqui se seu backend exigir prefixo /api
      const data = await apiFetch(`/modelo-distribuicao`);
      setItens(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e?.message || "Falha ao carregar Modelos de Distribuição.";
      setError(msg);
      addToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return itens;
    return itens.filter((x) => {
      const cod = String(x.codigo ?? x.cod ?? "").toLowerCase();
      const desc = String(x.descricao || "").toLowerCase();
      return cod.includes(term) || desc.includes(term);
    });
  }, [itens, q]);

  function openCreate() {
  setEditing(null);
  setForm({
    cod: "",
    descricao: "",
    ativo: true,
    origem: "REPASSE",
    periodicidade: "INCIDENTAL",
  });
  setModalOpen(true);
}

function openEdit(item) {
  setEditing(item);
  setForm({
    cod: item.codigo ?? item.cod ?? "",
    descricao: item.descricao ?? "",
    ativo: item.ativo !== false,
    origem: item.origem ?? "REPASSE",
    periodicidade: item.periodicidade ?? item.tipo ?? "INCIDENTAL",
  });
  setModalOpen(true);
}

  async function save() {
    setError("");
    const cod = String(form.cod || "").trim();
    const descricao = String(form.descricao || "").trim();
    const origem = String(form.origem || "REPASSE").trim().toUpperCase();
    const periodicidade = String(form.periodicidade || "INCIDENTAL").trim().toUpperCase();

    if (!cod) return setError("Informe o código.");
    if (cod.length > 50) return setError("Código muito longo (máx. 50).");

    setLoading(true);
    try {
      if (editing?.id) {
        await apiFetch(`/modelo-distribuicao/${editing.id}`, {
          method: "PUT",
          body: { codigo: cod, descricao, ativo: !!form.ativo, origem, periodicidade },
        });
      } else {
        await apiFetch(`/modelo-distribuicao`, {
          method: "POST",
          body: { codigo: cod, descricao, ativo: !!form.ativo, origem, periodicidade },
        });
      }
      setModalOpen(false);
      addToast(editing ? "Modelo atualizado!" : "Modelo criado!", "success");
      await load();
    } catch (e) {
      const msg = e?.message || "Falha ao salvar.";
      setError(msg);
      addToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  async function toggleAtivo(item) {
    setError("");
    setLoading(true);
    try {
      await apiFetch(`/modelo-distribuicao/${item.id}`, {
        method: "PUT",
        body: { ativo: !item.ativo },
      });
      addToast(item.ativo ? "Modelo desativado." : "Modelo ativado.", "success");
      await load();
    } catch (e) {
      const msg = e?.message || "Falha ao ativar/desativar.";
      setError(msg);
      addToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  async function remove(item) {
    const ok = await confirmToast(`Excluir o modelo "${item.cod}"? Essa ação não pode ser desfeita.`);
    if (!ok) return;
    setError("");
    setLoading(true);
    try {
      await apiFetch(`/modelo-distribuicao/${item.id}`, { method: "DELETE" });
      addToast("Modelo excluído.", "success");
      await load();
    } catch (e) {
      const msg = e?.message || "Falha ao excluir.";
      setError(msg);
      addToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

async function loadItens(modeloId) {
  setItensLoading((s) => ({ ...s, [modeloId]: true }));
  setItensError((s) => ({ ...s, [modeloId]: "" }));
  try {
    const data = await apiFetch(`/modelo-distribuicao/${modeloId}/itens`);
    setItensByModelo((s) => ({ ...s, [modeloId]: Array.isArray(data) ? data : [] }));
  } catch (e) {
    const msg = e?.message || "Erro ao carregar itens.";
    setItensError((s) => ({ ...s, [modeloId]: msg }));
    addToast(msg, "error");
  } finally {
    setItensLoading((s) => ({ ...s, [modeloId]: false }));
  }
}

function toggleItens(modeloId) {
  setOpenItens((s) => {
    const next = !s[modeloId];
    return { ...s, [modeloId]: next };
  });

  if (!openItens[modeloId]) {
    if (!itensByModelo[modeloId]) loadItens(modeloId);
    setNovoItem((s) => ({
      ...s,
      [modeloId]: s[modeloId] || { origem: "", periodicidade: "", destinoTipo: "SOCIO", percentual: "" },
    }));
  }
}

async function addItem(modeloId) {
  const ni = novoItem[modeloId] || {};

  const itensLocal = itensByModelo[modeloId] || [];
  const somaAtual = somaBp(itensLocal);
  const restanteBp = Math.max(0, 10000 - somaAtual);

  // ordem automática
  const maxOrd = itensLocal.reduce((m, it) => Math.max(m, Number(it.ordem || 0)), 0);
  const ordem = maxOrd + 1;

  // regra: após o primeiro item, origem/tipo ficam obrigatórios e iguais ao 1º
  const lockOrigemTipo = itensLocal.length > 0;
  const origemFinal = lockOrigemTipo ? (itensLocal[0]?.origem || "") : (ni.origem || "");
  const tipoFinal = lockOrigemTipo
    ? ((itensLocal[0]?.periodicidade ?? itensLocal[0]?.tipo) || "")
    : (ni.periodicidade || "");

  if (!origemFinal) return addToast("Informe a origem.", "warning");
  if (!tipoFinal) return addToast("Informe o tipo.", "warning");
  if (!ni.destinoTipo) return addToast("Informe o destino.", "warning");

  // percentual: não pode ultrapassar o restante; se passar, ajusta automaticamente
  const { bp: percentualBpClamped } = clampPercentToRemaining(ni.percentual, restanteBp);
  if (!Number.isFinite(percentualBpClamped) || percentualBpClamped <= 0) {
    return addToast("Percentual inválido.", "warning");
  }

  try {
    await apiFetch(`/modelo-distribuicao/${modeloId}/itens`, {
      method: "POST",
      body: {
        ordem,
        origem: String(origemFinal).trim().toUpperCase(),
        periodicidade: String(tipoFinal).trim().toUpperCase(),
        destinoTipo: ni.destinoTipo,
        percentualBp: percentualBpClamped,
      },
    });

    await loadItens(modeloId);
    addToast("Item adicionado!", "success");

    // limpa o form (sem destinatário)
    setNovoItem((s) => ({
      ...s,
      [modeloId]: { origem: "", periodicidade: "", destinoTipo: "SOCIO", percentual: "" },
    }));
  } catch (e) {
    addToast(e?.message || "Falha ao incluir item.", "error");
  }
}


function startEditItem(it) {
  setEditItem((s) => ({
    ...s,
    [it.id]: {
      id: it.id,
      modeloId: it.modeloId,
      ordem: String(it.ordem ?? ""),
      destinoTipo: String(it.destinoTipo ?? "SOCIO"),
      percentual: bpToPercent(it.percentualBp),
    },
  }));
}

function cancelEditItem(itemId) {
  setEditItem((s) => {
    const next = { ...s };
    delete next[itemId];
    return next;
  });
}

async function saveEditItem(itemId) {
  const e = editItem[itemId];
  if (!e) return;

  const ordem = Number(e.ordem);
  if (!Number.isFinite(ordem) || ordem <= 0) return addToast("Ordem inválida.", "warning");
  if (!e.destinoTipo) return addToast("Informe o destino.", "warning");

  // restante para edição = 100% - soma(dos outros itens)
  const itensLocal = itensByModelo[e.modeloId] || [];
  const somaSemEste = somaBp(itensLocal.filter((z) => z.id !== itemId));
  const restanteEditBp = Math.max(0, 10000 - somaSemEste);

  const { bp: percentualBpClamped } = clampPercentToRemaining(e.percentual, restanteEditBp);
  if (!Number.isFinite(percentualBpClamped) || percentualBpClamped <= 0) {
    return addToast("Percentual inválido.", "warning");
  }

  setSavingItem((s) => ({ ...s, [itemId]: true }));
  try {
    await apiFetch(`/modelo-distribuicao/itens/${itemId}`, {
      method: "PUT",
      body: {
        ordem,
        destinoTipo: e.destinoTipo,
        percentualBp: percentualBpClamped, // clamp aplicado
      },
    });

    await loadItens(e.modeloId);
    cancelEditItem(itemId);
    addToast("Item atualizado!", "success");
  } catch (err) {
    addToast(err?.message || "Falha ao salvar item.", "error");
  } finally {
    setSavingItem((s) => ({ ...s, [itemId]: false }));
  }
}

async function deleteItem(modeloId, itemId, confirmToast) {
  const ok = await confirmToast("Excluir este item?");
  if (!ok) return;

  try {
    await apiFetch(`/modelo-distribuicao/itens/${itemId}`, { method: "DELETE" });
    await loadItens(modeloId);
    addToast("Item excluído.", "success");
  } catch (err) {
    addToast(err?.message || "Falha ao excluir item.", "error");
  }
}

function origemLabel(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return "—";
  if (s === "REPASSE") return "Escritório";
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function tipoLabel(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return "—";

  if (s === "INCIDENTAL") return "Incidental";
  if (s === "MENSAL") return "Mensal";
  if (s === "MENSAL_RECORRENTE") return "Mensal/Recorrente"; // ✅ AQUI
  if (s === "SEMANAL") return "Semanal";
  if (s === "SEMESTRAL") return "Semestral";
  if (s === "ANUAL") return "Anual";

  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
}


function destinoLabel(v) {
  switch (String(v || "").toUpperCase()) {
    case "FUNDO_RESERVA": return "Fundo de Reserva";
    case "SOCIO": return "Sócio";
    case "ESCRITORIO": return "Escritório";
    case "INDICACAO": return "Indicação";
    default: return String(v || "—");
  }
}

// bp -> % sem casas decimais
function bpToPercent0(bp) {
  const n = Number(bp);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n / 100)); // 1500 -> "15"
}

  return (
    <div className="p-6 space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="p-5 border-b border-slate-200 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xl font-semibold text-slate-900">Modelos de Distribuição</div>
          </div>
          <div className="flex items-center gap-2">
            <PrimaryButton type="button" onClick={openCreate}>
              + Novo
            </PrimaryButton>
          </div>
        </div>
        <div className="p-5 space-y-3">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por código ou descrição…"
              className="w-full md:flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            />
            <div className="flex items-center gap-2 justify-end">
              <div className="text-sm text-slate-600">
              {loading ? "Carregando…" : `${filtered.length} item(ns)`}
            </div>

            <Button type="button" onClick={load} disabled={loading}>
              Atualizar
            </Button>
          </div>
        </div>

        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-white text-slate-700 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Código</th>
                <th className="text-left px-4 py-3 font-semibold">Descrição</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 bg-white">

              {filtered.map((x) => {
                const itensLocal = itensByModelo[x.id] || [];
                const soma = somaBp(itensLocal);
                const firstOrigem = itensLocal?.[0]?.origem || "";
                const firstTipo = (itensLocal?.[0]?.periodicidade ?? itensLocal?.[0]?.tipo) || "";
                const restanteBp = Math.max(0, 10000 - soma);
                const lockOrigemTipo = itensLocal.length > 0;
                const somaOk = soma === 10000;
 
                const origemForCheck = lockOrigemTipo ? firstOrigem : (novoItem[x.id]?.origem || "");
                const tipoForCheck = lockOrigemTipo ? firstTipo : (novoItem[x.id]?.periodicidade || "");
                const destinoForCheck = novoItem[x.id]?.destinoTipo || "";
                const { bp: bpCheck } = clampPercentToRemaining(novoItem[x.id]?.percentual, restanteBp);

                const canAdd =
                  restanteBp > 0 &&
                  !!origemForCheck &&
                  !!tipoForCheck &&
                  !!destinoForCheck &&
                  Number.isFinite(bpCheck) &&
                  bpCheck > 0;

                return (
                  <Fragment key={x.id}>
                    {/* Linha principal do modelo */}
                    <tr>
                      <td className="px-4 py-3 font-semibold text-slate-900">{x.codigo ?? x.cod}</td>
                      <td className="px-4 py-3 text-slate-800">{x.descricao || "—"}</td>
                      <td className="px-4 py-3">
                        {x.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2 items-center">
                          <button
                            type="button"
                            onClick={() => toggleItens(x.id)}
                            className="text-sm font-semibold text-slate-700 underline hover:text-slate-900"
                          >
                            Itens {openItens[x.id] ? "▾" : "▸"}
                          </button>

                          <Button type="button" onClick={() => openEdit(x)}>
                            Editar
                          </Button>
                          <Button type="button" onClick={() => toggleAtivo(x)} disabled={loading}>
                            {x.ativo ? "Desativar" : "Ativar"}
                          </Button>
                          <DangerButton type="button" onClick={() => remove(x)} disabled={loading}>
                            Excluir
                          </DangerButton>
                        </div>
                      </td>
                    </tr>

                    {/* Expandido */}
                    {openItens[x.id] && (
                      <tr>
                        <td colSpan={4} className="bg-slate-50">
                          <div className="p-4 space-y-3">
                            <div className="flex justify-between items-center">
                              <div className="font-semibold text-slate-800">
                                {x.descricao || "—"}
                              </div>

                              <div className={`font-semibold ${somaOk ? "text-emerald-700" : "text-red-700"}`}>
                                Soma: {Math.round(soma / 100)}%
                              </div>
                            </div>

                            {itensLoading[x.id] ? (
                              <div className="text-sm text-slate-500">Carregando itens…</div>
                            ) : itensError[x.id] ? (
                              <div className="text-sm text-red-700">{itensError[x.id]}</div>
                            ) : (
                              <div className="space-y-3">
                                {/* Adicionar item */}
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <div className="mb-2 text-sm text-slate-600">
                                    Restante para 100%: <span className="font-semibold">{(restanteBp / 100).toFixed(2)}%</span>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                                    <select
                                      className="md:col-span-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
                                      value={lockOrigemTipo ? firstOrigem : (novoItem[x.id]?.origem || "")}
                                      disabled={lockOrigemTipo}
                                      onChange={(e) =>
                                        setNovoItem((s) => ({
                                          ...s,
                                          [x.id]: { ...(s[x.id] || {}), origem: e.target.value },
                                        }))
                                      }
                                    >
                                      <option value="">Origem (selecionar)</option>
                                      <option value="REPASSE">Escritório</option>
                                      <option value="SOCIO">Sócio</option>
                                      <option value="INDICACAO">Indicação</option>
                                    </select>

                                    <select
                                      className="md:col-span-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
                                      value={lockOrigemTipo ? firstTipo : (novoItem[x.id]?.periodicidade || "")}
                                      disabled={lockOrigemTipo}
                                      onChange={(e) =>
                                        setNovoItem((s) => ({
                                          ...s,
                                          [x.id]: { ...(s[x.id] || {}), periodicidade: e.target.value },
                                        }))
                                      }
                                    >
                                      <option value="">Tipo (selecionar)</option>
                                      <option value="INCIDENTAL">Incidental</option>
                                      <option value="MENSAL">Mensal</option>
                                      <option value="MENSAL_RECORRENTE">Mensal/Recorrente</option>
                                      <option value="SEMANAL">Semanal</option>
                                      <option value="SEMESTRAL">Semestral</option>
                                      <option value="ANUAL">Anual</option>
                                    </select>

                                    <select
                                      className="md:col-span-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                                      value={novoItem[x.id]?.destinoTipo || "SOCIO"}
                                      onChange={(e) =>
                                        setNovoItem((s) => ({
                                          ...s,
                                          [x.id]: { ...(s[x.id] || {}), destinoTipo: e.target.value },
                                        }))
                                      }
                                    >
                                      <option value="FUNDO_RESERVA">Fundo de Reserva</option>
                                      <option value="SOCIO">Sócio</option>
                                      <option value="ESCRITORIO">Escritório</option>
                                      <option value="INDICACAO">Indicação</option>
                                    </select>

                                    <input
                                      className="md:col-span-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                                      placeholder="Percentual (ex.: 30,00)"
                                      value={novoItem[x.id]?.percentual || ""}
                                      onChange={(e) => {
                                        const next = sanitizePercentInput(e.target.value);
                                        setNovoItem((s) => ({
                                          ...s,
                                          [x.id]: { ...(s[x.id] || {}), percentual: next },
                                        }));
                                      }}
                                      onBlur={() => {
                                        const itensLocalNow = itensByModelo[x.id] || [];
                                        const restanteNow = Math.max(0, 10000 - somaBp(itensLocalNow));

                                        const { bp, str } = clampPercentToRemaining(novoItem[x.id]?.percentual, restanteNow);

                                        // só formata se for um número válido
                                        if (Number.isFinite(bp) && bp > 0) {
                                          setNovoItem((s) => ({
                                            ...s,
                                            [x.id]: { ...(s[x.id] || {}), percentual: str },
                                          }));
                                        }
                                      }}
                                    />                                    

                                    <PrimaryButton
                                      className="md:col-span-1"
                                      type="button"
                                      onClick={() => addItem(x.id)}
                                      disabled={!canAdd}
                                      title={restanteBp === 0 ? "Total já está em 100%" : ""}
                                    >
                                      +
                                    </PrimaryButton>

                                  </div>
                                </div>

 
                            {/* Tabela de itens */}
                            <table className="w-full text-sm border border-slate-200 rounded-xl overflow-hidden">
                              <thead className="bg-slate-100">
                                <tr>
                                  <th className="px-3 py-2 text-left">Origem</th>
                                  <th className="px-3 py-2 text-left">Tipo</th>
                                  <th className="px-3 py-2 text-right">%</th>
                                  <th className="px-3 py-2 text-left">Destino</th>
                                  <th className="px-3 py-2 text-right">Ações</th>
                                </tr>
                              </thead>

                              <tbody>
                                {[...(itensLocal || [])]
                                  .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0))
                                  .map((it) => {
                                    const e = editItem[it.id];

                                    return (
                                      <tr key={it.id} className="border-t">
                                        <td className="px-3 py-2">{origemLabel(it.origem)}</td>
                                        <td className="px-3 py-2">{tipoLabel(it.periodicidade ?? it.tipo)}</td>

                                        <td className="px-3 py-2 text-right">
                                          {e ? (
                                            <input
                                              className="w-24 text-right rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                                              value={e.percentual}
                                              onChange={(ev) =>
                                                setEditItem((s) => ({
                                                  ...s,
                                                  [it.id]: { ...s[it.id], percentual: sanitizePercentInput(ev.target.value) },
                                                }))
                                              }
                                              onBlur={() => {
                                                const itensLocalNow = itensByModelo[x.id] || [];
                                                const somaSemEste = somaBp(itensLocalNow.filter((z) => z.id !== it.id));
                                                const restanteEditBp = Math.max(0, 10000 - somaSemEste);

                                                const { bp, str } = clampPercentToRemaining(editItem[it.id]?.percentual, restanteEditBp);
                                                if (Number.isFinite(bp) && bp > 0) {
                                                  setEditItem((s) => ({
                                                    ...s,
                                                    [it.id]: { ...s[it.id], percentual: str },
                                                  }));
                                                }
                                              }}
                                            />
                                          ) : (
                                            `${bpToPercent0(it.percentualBp)}%`
                                          )}
                                        </td>

                                        <td className="px-3 py-2">
                                          {e ? (
                                            <select
                                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                                              value={e.destinoTipo}
                                              onChange={(ev) =>
                                                setEditItem((s) => ({
                                                  ...s,
                                                  [it.id]: { ...s[it.id], destinoTipo: ev.target.value },
                                                }))
                                              }
                                            >
                                              <option value="FUNDO_RESERVA">Fundo de Reserva</option>
                                              <option value="SOCIO">Sócio</option>
                                              <option value="ESCRITORIO">Escritório</option>
                                              <option value="INDICACAO">Indicação</option>
                                            </select>
                                          ) : (
                                            destinoLabel(it.destinoTipo)
                                          )}
                                        </td>

                                        <td className="px-3 py-2 text-right">
                                          {e ? (
                                            <div className="flex justify-end gap-2">
                                              <Button
                                                type="button"
                                                onClick={() => saveEditItem(it.id)}
                                                disabled={!!savingItem[it.id]}
                                              >
                                                Salvar
                                              </Button>
                                              <Button
                                                type="button"
                                                onClick={() => cancelEditItem(it.id)}
                                                disabled={!!savingItem[it.id]}
                                              >
                                                Cancelar
                                              </Button>
                                            </div>
                                          ) : (
                                            <div className="flex justify-end gap-2">
                                              <Button type="button" onClick={() => startEditItem(it)}>
                                                Editar
                                              </Button>
                                              <DangerButton type="button" onClick={() => deleteItem(x.id, it.id, confirmToast)}>
                                                Excluir
                                              </DangerButton>
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}

                                {!itensLocal?.length && (
                                  <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                      Nenhum item cadastrado.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}

          {!filtered.length && (
            <tr>
              <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                Nenhum registro encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    
  </div>
</div>

<Modal
  open={modalOpen}
  title={editing ? `Editar Modelo (${editing.cod ?? editing.codigo ?? editing.cod})` : "Novo Modelo de Distribuição"}
  onClose={() => setModalOpen(false)}
>
  {error ? (
    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
      {error}
    </div>
  ) : null}

  <div className="space-y-3">
    <div>
      <label className="block text-sm font-semibold text-slate-800 mb-1">Código *</label>
      <input
        value={form.cod}
        onChange={(e) => setForm((s) => ({ ...s, cod: e.target.value }))}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        placeholder="Ex.: MD-001"
      />
    </div>

    <div>
      <label className="block text-sm font-semibold text-slate-800 mb-1">Descrição</label>
      <input
        value={form.descricao}
        onChange={(e) => setForm((s) => ({ ...s, descricao: e.target.value }))}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        placeholder="Descrição do modelo…"
      />
    </div>

    <label className="flex items-center gap-2 text-sm text-slate-800">
      <input
        type="checkbox"
        checked={!!form.ativo}
        onChange={(e) => setForm((s) => ({ ...s, ativo: e.target.checked }))}
      />
      Ativo
    </label>

    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" onClick={() => setModalOpen(false)}>
        Cancelar
      </Button>
      <PrimaryButton type="button" onClick={save} disabled={loading}>
        Salvar
      </PrimaryButton>
    </div>
  </div>
</Modal>
</div>
);
}
