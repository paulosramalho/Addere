// src/pages/DuplicadosClientes.jsx
import React, { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { maskPhoneBR } from "../lib/validators";

function onlyDigits(v = "") { return String(v || "").replace(/\D/g, ""); }
function maskCpfCnpj(v = "") {
  const d = onlyDigits(v);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  }
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

const CONF_CORES = {
  ALTA:  { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" },
  MÉDIA: { bg: "#ffedd5", text: "#9a3412", border: "#fdba74" },
  BAIXA: { bg: "#fef9c3", text: "#713f12", border: "#fde047" },
};

const TIPO_LABELS = { F: "Fornecedor", C: "Cliente", A: "Ambos" };

function ClienteCard({ c, vinculos, loadingVinculos, onDelete, isMergeTarget, isSelected, showCheckbox, onSelectMergeTarget, onToggleSelect }) {
  const vTotal = vinculos?.total ?? "—";
  const hasVinculos = vinculos && vinculos.total > 0;

  let borderCls = "border-slate-200 bg-white";
  if (isMergeTarget) borderCls = "border-blue-400 bg-blue-50";
  else if (showCheckbox && isSelected) borderCls = "border-red-300 bg-red-50";

  return (
    <div className={`rounded-xl border p-4 text-sm ${borderCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-900 text-base truncate">{c.nomeRazaoSocial}</div>
          <div className="mt-1 space-y-0.5 text-slate-600 text-xs">
            <div>CPF/CNPJ: <span className="font-mono font-semibold">{maskCpfCnpj(c.cpfCnpj)}</span></div>
            {c.email && <div>E-mail: {c.email}</div>}
            {c.telefone && <div>Telefone: {maskPhoneBR(c.telefone)}</div>}
            <div className="flex gap-2 mt-1">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                c.ativo ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-100 text-slate-500 border-slate-200"
              }`}>{c.ativo ? "Ativo" : "Inativo"}</span>
              <span className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 border-slate-200">
                {TIPO_LABELS[c.tipo] || c.tipo}
              </span>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          {loadingVinculos ? (
            <span className="text-xs text-slate-400">verificando...</span>
          ) : vinculos ? (
            <div className="text-xs">
              <div className={`font-bold ${hasVinculos ? "text-orange-600" : "text-green-600"}`}>
                {vTotal} vínculo{vTotal !== 1 ? "s" : ""}
              </div>
              {hasVinculos && (
                <div className="text-slate-500 mt-0.5 space-y-0.5">
                  {vinculos.contratos > 0 && <div>{vinculos.contratos} contrato{vinculos.contratos !== 1 ? "s" : ""}</div>}
                  {vinculos.lancamentos > 0 && <div>{vinculos.lancamentos} lançamento{vinculos.lancamentos !== 1 ? "s" : ""}</div>}
                  {vinculos.contaCorrente > 0 && <div>{vinculos.contaCorrente} c. corrente</div>}
                  {vinculos.adiantamentos > 0 && <div>{vinculos.adiantamentos} adiant.</div>}
                  {vinculos.repassesManuais > 0 && <div>{vinculos.repassesManuais} rep. manual</div>}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => onSelectMergeTarget(c)}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
            isMergeTarget
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50"
          }`}
          title="Definir este como o registro a MANTER"
        >
          {isMergeTarget ? "✓ Manter este" : "Manter este"}
        </button>

        {/* Checkbox de inclusão na fusão (só aparece em grupos com 3+ membros) */}
        {!isMergeTarget && showCheckbox && (
          <label className="flex items-center gap-1.5 cursor-pointer select-none ml-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(c.id)}
              className="w-3.5 h-3.5 rounded border-slate-300 accent-red-600"
            />
            <span className={`text-xs font-semibold ${isSelected ? "text-red-700" : "text-slate-400"}`}>
              {isSelected ? "Incluir na fusão" : "Não incluir"}
            </span>
          </label>
        )}

        {!hasVinculos && !isMergeTarget && (
          <button
            onClick={() => onDelete(c)}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold border bg-white text-red-600 border-red-300 hover:bg-red-50"
          >
            Excluir
          </button>
        )}
      </div>
    </div>
  );
}

function GrupoCard({ grupo, onRefresh }) {
  const { addToast } = useToast();
  const [vinculos, setVinculos] = useState({});
  const [loadingVinculos, setLoadingVinculos] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState(new Set());
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(null); // { type: 'merge'|'delete', c }

  const todos = [grupo.principal, ...grupo.similares.map((s) => s.cliente)];
  const showCheckbox = todos.length > 2;

  useEffect(() => {
    setLoadingVinculos(true);
    Promise.all(
      todos.map((c) =>
        apiFetch(`/clients/${c.id}/vinculos`)
          .then((v) => [c.id, v])
          .catch(() => [c.id, null])
      )
    ).then((results) => {
      const m = {};
      for (const [id, v] of results) m[id] = v;
      setVinculos(m);
      setLoadingVinculos(false);
    });
  }, [grupo.principal.id]);

  // Auto-select the one with most vinculos as merge target; all others selected by default
  useEffect(() => {
    if (Object.keys(vinculos).length === 0) return;
    const sorted = todos.slice().sort((a, b) => (vinculos[b.id]?.total ?? 0) - (vinculos[a.id]?.total ?? 0));
    const autoTarget = sorted[0].id;
    if (!mergeTargetId) {
      setMergeTargetId(autoTarget);
      setSelectedSourceIds(new Set(todos.filter((c) => c.id !== autoTarget).map((c) => c.id)));
    }
  }, [vinculos]);

  function handleSelectTarget(c) {
    setMergeTargetId(c.id);
    // All non-target get selected by default when target changes
    setSelectedSourceIds(new Set(todos.filter((t) => t.id !== c.id).map((t) => t.id)));
  }

  function handleToggleSelect(id) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fromIds = [...selectedSourceIds].filter((id) => id !== mergeTargetId);

  async function handleMerge() {
    if (!fromIds.length || !mergeTargetId) return;
    setMerging(true);
    try {
      for (const fromId of fromIds) {
        await apiFetch(`/clients/${fromId}/merge-into/${mergeTargetId}`, { method: "POST" });
      }
      addToast("Registros fundidos com sucesso!", "success");
      onRefresh();
    } catch (e) {
      addToast(e?.message || "Erro ao fundir.", "error");
    } finally {
      setMerging(false);
      setConfirmOpen(null);
    }
  }

  async function handleDelete(c) {
    setDeleting(c.id);
    try {
      await apiFetch(`/clients/${c.id}`, { method: "DELETE" });
      addToast(`"${c.nomeRazaoSocial}" excluído.`, "success");
      onRefresh();
    } catch (e) {
      addToast(e?.message || "Erro ao excluir.", "error");
    } finally {
      setDeleting(null);
      setConfirmOpen(null);
    }
  }

  const maxConfianca = grupo.similares
    .flatMap((s) => s.razoes)
    .reduce((acc, r) => {
      if (r.confianca === "ALTA" || acc === "ALTA") return "ALTA";
      if (r.confianca === "MÉDIA" || acc === "MÉDIA") return "MÉDIA";
      return "BAIXA";
    }, "BAIXA");
  const cc = CONF_CORES[maxConfianca];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3"
        style={{ background: cc.bg, borderBottomColor: cc.border }}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: cc.text }}>
            Possível duplicata — confiança {maxConfianca}
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            {grupo.similares.flatMap((s) => s.razoes).map((r, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border font-semibold"
                style={{ background: cc.bg, color: cc.text, borderColor: cc.border }}>
                {r.tipo}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => setConfirmOpen({ type: "merge" })}
          disabled={!mergeTargetId || merging || loadingVinculos || fromIds.length === 0}
          className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-40"
          title={fromIds.length === 0 ? "Selecione ao menos um registro para fundir" : ""}
        >
          {merging ? "Fundindo..." : `Fundir${showCheckbox && fromIds.length > 0 ? ` (${fromIds.length})` : ""}`}
        </button>
      </div>

      {/* Cards */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {todos.map((c) => (
          <ClienteCard
            key={c.id}
            c={c}
            vinculos={vinculos[c.id]}
            loadingVinculos={loadingVinculos}
            isMergeTarget={c.id === mergeTargetId}
            isSelected={selectedSourceIds.has(c.id)}
            showCheckbox={showCheckbox}
            onSelectMergeTarget={handleSelectTarget}
            onToggleSelect={handleToggleSelect}
            onDelete={(c) => setConfirmOpen({ type: "delete", c })}
          />
        ))}
      </div>

      {mergeTargetId && !loadingVinculos && (
        <div className="px-5 pb-4 text-xs text-slate-500">
          {(() => {
            const from = todos.filter((c) => fromIds.includes(c.id));
            const to = todos.find((c) => c.id === mergeTargetId);
            if (!from.length) return <span className="text-amber-600 font-medium">Nenhum registro selecionado para fundir. Marque ao menos um.</span>;
            return <>Vínculos de <strong>{from.map((f) => f.nomeRazaoSocial).join(", ")}</strong> serão transferidos para <strong>{to?.nomeRazaoSocial}</strong> e {from.length === 1 ? "o registro duplicado será excluído" : "os registros duplicados serão excluídos"}.</>;
          })()}
        </div>
      )}

      {/* Confirm dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 p-6">
            {confirmOpen.type === "merge" ? (
              <>
                <div className="text-base font-bold text-slate-900 mb-2">Confirmar fusão</div>
                <p className="text-sm text-slate-600 mb-4">
                  Esta operação é <strong>irreversível</strong>. Os registros duplicados serão excluídos e todos os vínculos transferidos para o registro escolhido como "Manter".
                </p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setConfirmOpen(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                  <button onClick={handleMerge} disabled={merging}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {merging ? "Fundindo..." : "Confirmar fusão"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-base font-bold text-slate-900 mb-2">Excluir registro</div>
                <p className="text-sm text-slate-600 mb-4">
                  Excluir <strong>"{confirmOpen.c?.nomeRazaoSocial}"</strong>? Esta ação não pode ser desfeita.
                </p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setConfirmOpen(null)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                  <button onClick={() => handleDelete(confirmOpen.c)} disabled={!!deleting}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                    Excluir
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Busca de cliente para mesclagem manual ---- */
function ClientePicker({ label, value, onChange }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const d = await apiFetch(`/clients?search=${encodeURIComponent(query)}&limit=8&includeInativo=true`);
        setResults(d);
        setOpen(true);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function select(c) {
    onChange(c);
    setQuery(c.nomeRazaoSocial);
    setOpen(false);
    setResults([]);
  }

  function clear() { onChange(null); setQuery(""); setResults([]); }

  return (
    <div className="relative">
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value ? value.nomeRazaoSocial : query}
          onChange={e => { if (value) clear(); setQuery(e.target.value); }}
          placeholder="Buscar por nome ou CPF/CNPJ…"
          className={`flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 ${value ? "border-blue-400 bg-blue-50 font-semibold" : "border-slate-300"}`}
          onFocus={() => results.length && setOpen(true)}
        />
        {value && (
          <button onClick={clear} className="px-2 py-1 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100 text-sm">×</button>
        )}
      </div>
      {open && results.length > 0 && !value && (
        <ul className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {results.map(c => (
            <li key={c.id}
              onClick={() => select(c)}
              className="px-3 py-2 cursor-pointer hover:bg-blue-50 border-b border-slate-100 last:border-0">
              <div className="font-semibold text-slate-800 text-sm truncate">{c.nomeRazaoSocial}</div>
              <div className="text-xs text-slate-500 font-mono">{maskCpfCnpj(c.cpfCnpj)} · {c.ativo ? "Ativo" : "Inativo"}</div>
            </li>
          ))}
        </ul>
      )}
      {value && (
        <div className="mt-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 space-y-0.5">
          <div className="font-semibold">{value.nomeRazaoSocial}</div>
          <div className="font-mono">{maskCpfCnpj(value.cpfCnpj)}</div>
          {value.email && <div>{value.email}</div>}
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold border ${value.ativo ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
            {value.ativo ? "Ativo" : "Inativo"}
          </span>
        </div>
      )}
    </div>
  );
}

function MesclaManualPanel({ onRefresh }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [fonte, setFonte] = useState(null);   // será excluído
  const [alvo, setAlvo]   = useState(null);   // será mantido
  const [merging, setMerging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleMerge() {
    setMerging(true);
    try {
      await apiFetch(`/clients/${fonte.id}/merge-into/${alvo.id}`, { method: "POST" });
      addToast("Registros fundidos com sucesso!", "success");
      setFonte(null); setAlvo(null); setOpen(false);
      onRefresh();
    } catch (e) {
      addToast(e?.message || "Erro ao fundir.", "error");
    } finally {
      setMerging(false);
      setConfirmOpen(false);
    }
  }

  const canMerge = fonte && alvo && fonte.id !== alvo.id;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
      >
        <div>
          <span className="font-semibold text-slate-800 text-sm">Mesclar manualmente</span>
          <span className="ml-2 text-xs text-slate-500">Para casos não detectados automaticamente</span>
        </div>
        <span className="text-slate-400 text-lg">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <ClientePicker
                label="Registros a EXCLUIR (duplicata)"
                value={fonte}
                onChange={setFonte}
              />
            </div>
            <div>
              <ClientePicker
                label="Registro a MANTER (correto)"
                value={alvo}
                onChange={setAlvo}
              />
            </div>
          </div>

          {fonte && alvo && fonte.id === alvo.id && (
            <p className="text-xs text-red-600 font-medium">Selecione registros diferentes.</p>
          )}

          {canMerge && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              Vínculos de <strong>{fonte.nomeRazaoSocial}</strong> serão transferidos para{" "}
              <strong>{alvo.nomeRazaoSocial}</strong> e o registro duplicado será excluído.
            </div>
          )}

          <div className="flex justify-end">
            <button
              disabled={!canMerge || merging}
              onClick={() => setConfirmOpen(true)}
              className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40"
            >
              {merging ? "Fundindo…" : "Fundir registros"}
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 p-6">
            <div className="text-base font-bold text-slate-900 mb-2">Confirmar fusão manual</div>
            <p className="text-sm text-slate-600 mb-4">
              Esta operação é <strong>irreversível</strong>. Todos os vínculos de{" "}
              <strong>"{fonte?.nomeRazaoSocial}"</strong> serão transferidos para{" "}
              <strong>"{alvo?.nomeRazaoSocial}"</strong> e o registro duplicado será excluído.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmOpen(false)} className="px-4 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={handleMerge} disabled={merging}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {merging ? "Fundindo..." : "Confirmar fusão"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DuplicadosClientesPage({ user }) {
  const { addToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  const [grupos, setGrupos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/clients/duplicados");
      setGrupos(d.grupos || []);
      setTotal(d.total || 0);
      setLoaded(true);
    } catch (e) {
      addToast(e?.message || "Erro ao buscar duplicados.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xl font-semibold text-slate-900">Duplicatas</div>
          <div className="mt-2 text-sm text-slate-600">Acesso restrito a administradores.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Deduplicação de Clientes/Fornecedores</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Detecta registros com CPF/CNPJ, e-mail, telefone ou nome similares.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-5 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Analisando..." : loaded ? "Reanalisar" : "Analisar agora"}
        </button>
      </div>

      <MesclaManualPanel onRefresh={load} />

      {!loaded && !loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <div className="text-slate-600 font-medium">Clique em "Analisar agora" para buscar possíveis duplicatas</div>
          <div className="text-slate-400 text-xs mt-1">A análise compara nomes, CPF/CNPJ, e-mail e telefone</div>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <div className="text-slate-400 text-sm">Analisando registros...</div>
        </div>
      )}

      {loaded && !loading && grupos.length === 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="text-green-800 font-semibold">Nenhuma duplicata encontrada</div>
          <div className="text-green-600 text-sm mt-1">Todos os registros parecem únicos.</div>
        </div>
      )}

      {loaded && !loading && grupos.length > 0 && (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-medium">
            {total} grupo{total !== 1 ? "s" : ""} de possíveis duplicatas encontrado{total !== 1 ? "s" : ""}.
            Revise cada grupo e escolha "Manter este" no registro correto antes de fundir.
          </div>
          <div className="space-y-4">
            {grupos.map((g, i) => (
              <GrupoCard key={`${g.principal.id}-${i}`} grupo={g} onRefresh={load} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
