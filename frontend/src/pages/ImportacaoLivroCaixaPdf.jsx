import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { brlFromCentavos } from "../lib/formatters";
import { useToast } from "../components/Toast";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function modeloLabel(m) {
  if (!m) return "—";
  const code = m.codigo ? `${m.codigo} — ` : "";
  return code + (m.descricao || m.nome || `Modelo ${m.id}`);
}

function bpToPercentStr(bp) {
  return (Number(bp || 0) / 100).toFixed(2).replace(".", ",");
}

function percentStrToBp(s) {
  const raw = String(s ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function percentMask(value) {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  const n = Number(digits) / 100;
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
}

const DESTINO_LABELS = {
  FUNDO_RESERVA: "Fundo Reserva",
  SOCIO: "Sócio",
  ESCRITORIO: "Escritório",
  INDICACAO: "Indicação",
};

function destinoBadge(tipo) {
  const map = {
    FUNDO_RESERVA: { bg: "#dbeafe", color: "#1e40af" },
    SOCIO:         { bg: "#dcfce7", color: "#15803d" },
    ESCRITORIO:    { bg: "#f3f4f6", color: "#374151" },
    INDICACAO:     { bg: "#fef3c7", color: "#a16207" },
  };
  return map[tipo] || { bg: "#f3f4f6", color: "#6b7280" };
}

// ─── RepasseModal ─────────────────────────────────────────────────────────────
function RepasseModal({ modelos, initialData, onConfirm, onClose }) {
  const [localModeloId, setLocalModeloId] = useState(initialData?.modeloDistribuicaoId || null);
  const [localAdvId,    setLocalAdvId]    = useState(initialData?.advogadoPrincipalId  || null);
  const [localIndId,    setLocalIndId]    = useState(initialData?.indicacaoAdvogadoId  || null);
  const [usaSplit,      setUsaSplit]      = useState(initialData?.usaSplitSocio        || false);
  const [splits,        setSplits]        = useState(initialData?.splits               || []);
  const [splitDraft,    setSplitDraft]    = useState({});
  const [advogados,     setAdvogados]     = useState([]);
  const [loadingAdv,    setLoadingAdv]    = useState(true);
  const [erro,          setErro]          = useState("");

  useEffect(() => {
    apiFetch("/advogados")
      .then((d) => setAdvogados(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoadingAdv(false));
  }, []);

  // Itens do modelo selecionado (já vêm carregados no objeto modelos)
  const modeloItens = useMemo(() => {
    if (!localModeloId) return [];
    return modelos.find((m) => m.id === localModeloId)?.itens || [];
  }, [localModeloId, modelos]);

  // % da cota do Sócio no modelo
  const socioBp = useMemo(() => {
    const it = modeloItens.find((i) => String(i.destinoTipo || "").toUpperCase() === "SOCIO");
    return it ? Number(it.percentualBp) || 0 : 0;
  }, [modeloItens]);

  const exigeIndicacao = useMemo(
    () => modeloItens.some((i) => String(i.destinoTipo || "").toUpperCase() === "INDICACAO"),
    [modeloItens]
  );

  const needsAdvPrincipal = useMemo(() => {
    if (!localModeloId || !modeloItens.length) return true;
    return modeloItens.some((i) => String(i.destinoTipo || "").toUpperCase() === "SOCIO");
  }, [localModeloId, modeloItens]);

  const somaBp = useMemo(
    () => splits.reduce((acc, r) => acc + (Number(r.percentualBp) || 0), 0),
    [splits]
  );

  const splitExcede = usaSplit && socioBp > 0 && somaBp > socioBp;

  function handleModeloChange(id) {
    setLocalModeloId(id);
    setLocalAdvId(null);
    setLocalIndId(null);
    setUsaSplit(false);
    setSplits([]);
    setSplitDraft({});
    setErro("");
  }

  function removeSplit(idx) {
    setSplits((prev) => prev.filter((_, i) => i !== idx));
    setSplitDraft((prev) => {
      const next = {};
      Object.keys(prev).forEach((k) => {
        const i = Number(k);
        if (i < idx) next[i] = prev[i];
        if (i > idx) next[i - 1] = prev[i];
      });
      return next;
    });
  }

  function updateSplit(idx, patch) {
    setSplits((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function handleConfirm() {
    setErro("");
    if (!localModeloId) {
      setErro("Selecione um modelo de distribuição.");
      return;
    }
    if (exigeIndicacao && !localIndId) {
      setErro("Este modelo exige informar o advogado de indicação.");
      return;
    }
    if (needsAdvPrincipal && !usaSplit && !localAdvId) {
      setErro("Selecione o advogado.");
      return;
    }
    if (usaSplit) {
      if (!splits.length) { setErro("Adicione pelo menos um split."); return; }
      if (splits.some((r) => !r.advogadoId)) { setErro("Selecione o advogado em todos os splits."); return; }
      if (splitExcede) {
        setErro(`Soma dos splits (${bpToPercentStr(somaBp)}%) excede a cota do Sócio (${bpToPercentStr(socioBp)}%).`);
        return;
      }
    }
    onConfirm({
      modeloDistribuicaoId: localModeloId,
      advogadoPrincipalId:  usaSplit ? null : localAdvId,
      indicacaoAdvogadoId:  localIndId,
      usaSplitSocio:        usaSplit,
      splits:               usaSplit ? splits : [],
    });
  }

  const inp = {
    width: "100%", padding: "7px 10px", borderRadius: 8,
    border: "1px solid #ddd", fontSize: 13, fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 14, padding: 24,
        width: "min(700px, 95vw)", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        {/* Cabeçalho */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Configurar Repasse</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#666" }}>✕</button>
        </div>

        {/* Modelo */}
        <div>
          <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 6 }}>Modelo de Distribuição</label>
          <select
            style={inp}
            value={localModeloId || ""}
            onChange={(e) => handleModeloChange(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— Selecione —</option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>{modeloLabel(m)}</option>
            ))}
          </select>
        </div>

        {/* Tabela de itens do modelo (read-only) */}
        {modeloItens.length > 0 && (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead style={{ background: "#f9fafb" }}>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "#555", fontWeight: 600 }}>Destino</th>
                  <th style={{ textAlign: "right", padding: "6px 10px", fontSize: 11, color: "#555", fontWeight: 600 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {modeloItens.map((it, idx) => {
                  const badge = destinoBadge(it.destinoTipo);
                  return (
                    <tr key={it.id || idx} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "6px 10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: badge.bg, color: badge.color }}>
                          {DESTINO_LABELS[it.destinoTipo] || it.destinoTipo}
                        </span>
                      </td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>
                        {bpToPercentStr(it.percentualBp)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Indicação */}
        {exigeIndicacao && (
          <div>
            <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 6 }}>Advogado de Indicação</label>
            <select
              style={inp}
              value={localIndId || ""}
              onChange={(e) => setLocalIndId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingAdv}
            >
              <option value="">— Selecione —</option>
              {advogados
                .filter((a) =>
                  a.id === localIndId ||
                  (!splits.some((r) => Number(r.advogadoId) === a.id) && (!localAdvId || a.id !== localAdvId))
                )
                .map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </div>
        )}

        {/* Advogado principal + toggle Split */}
        {needsAdvPrincipal && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            {!usaSplit && (
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 6 }}>Advogado</label>
                <select
                  style={inp}
                  value={localAdvId || ""}
                  onChange={(e) => setLocalAdvId(e.target.value ? Number(e.target.value) : null)}
                  disabled={loadingAdv}
                >
                  <option value="">— Selecione —</option>
                  {advogados
                    .filter((a) => !localIndId || a.id !== localIndId)
                    .map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                </select>
              </div>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, paddingBottom: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={usaSplit}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setUsaSplit(checked);
                  if (checked) {
                    setSplits(localAdvId ? [{ advogadoId: localAdvId, percentualBp: 0 }] : []);
                    setLocalAdvId(null);
                  } else {
                    setSplits([]);
                    setSplitDraft({});
                  }
                }}
              />
              Split entre advogados
            </label>
          </div>
        )}

        {/* Splits */}
        {usaSplit && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#111" }}>
              Splits — cota do Sócio: {socioBp > 0 ? `${bpToPercentStr(socioBp)}%` : "—"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {splits.map((row, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "center" }}>
                  <select
                    style={inp}
                    value={row.advogadoId || ""}
                    onChange={(e) => updateSplit(idx, { advogadoId: e.target.value ? Number(e.target.value) : null })}
                    disabled={loadingAdv}
                  >
                    <option value="">— advogado —</option>
                    {advogados
                      .filter((a) =>
                        a.id === row.advogadoId ||
                        (!splits.some((r, i) => i !== idx && Number(r.advogadoId) === a.id) &&
                         (!localIndId || a.id !== localIndId))
                      )
                      .map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                  </select>
                  <input
                    style={inp}
                    inputMode="numeric"
                    placeholder="0,00"
                    value={splitDraft[idx] ?? bpToPercentStr(row.percentualBp)}
                    onChange={(e) => {
                      const masked = percentMask(e.target.value);
                      setSplitDraft((prev) => ({ ...prev, [idx]: masked }));
                      updateSplit(idx, { percentualBp: percentStrToBp(masked) });
                    }}
                    onBlur={() => {
                      const raw = splitDraft[idx];
                      if (raw == null) return;
                      updateSplit(idx, { percentualBp: percentStrToBp(raw) });
                      setSplitDraft((prev) => { const next = { ...prev }; delete next[idx]; return next; });
                    }}
                  />
                  <button
                    onClick={() => removeSplit(idx)}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 12 }}
                  >
                    Remover
                  </button>
                </div>
              ))}

              {/* Linha de seleção de novo advogado (enquanto houver cota disponível) */}
              {(!socioBp || somaBp < socioBp) && (
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "center" }}>
                  <select
                    style={{ ...inp, color: "#999" }}
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setSplits((prev) => [...prev, { advogadoId: Number(e.target.value), percentualBp: 0 }]);
                    }}
                  >
                    <option value="">+ advogado</option>
                    {advogados
                      .filter((a) =>
                        !splits.some((r) => Number(r.advogadoId) === a.id) &&
                        (!localIndId || a.id !== localIndId)
                      )
                      .map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                  </select>
                  <input style={{ ...inp, background: "#f9fafb", color: "#aaa" }} placeholder="0,00" disabled />
                  <div />
                </div>
              )}

              {/* Totalizador */}
              <div style={{ fontSize: 12, textAlign: "right", fontWeight: 600, color: splitExcede ? "#b91c1c" : "#15803d" }}>
                Soma: {bpToPercentStr(somaBp)}%
                {socioBp > 0 && ` / ${bpToPercentStr(socioBp)}%`}
                {splitExcede && " — excede a cota do Sócio"}
              </div>
            </div>
          </div>
        )}

        {/* Erro */}
        {erro && (
          <div style={{ color: "#b91c1c", fontSize: 13, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px" }}>
            {erro}
          </div>
        )}

        {/* Rodapé */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 4, borderTop: "1px solid #eee" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontWeight: 600 }}>
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#111", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14 }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ImportacaoLivroCaixaPdf() {
  const { addToast } = useToast();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const [contas, setContas] = useState([]);
  const [pessoasCA, setPessoasCA] = useState([]); // C e A
  const [pessoasFA, setPessoasFA] = useState([]); // F e A
  const [modelos, setModelos] = useState([]);

  const [rows, setRows] = useState([]);
  const [busyRowId, setBusyRowId] = useState(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [repasseModalRowId, setRepasseModalRowId] = useState(null);
  const [sessaoId, setSessaoId] = useState(null);
  const [alertaImport, setAlertaImport] = useState(null);
  const [mostrarApenasP, setMostrarApenasP] = useState(false);

  const competenciaLabel = useMemo(() => `${String(mes).padStart(2, "0")}/${ano}`, [ano, mes]);
  const pendingRows = useMemo(() => rows.filter((r) => !r._confirmed), [rows]);
  const confirmedCount = useMemo(() => rows.filter((r) => r._confirmed).length, [rows]);

  useEffect(() => {
    (async () => {
      try {
        const [c, ca, fa, m] = await Promise.all([
          apiFetch("/livro-caixa/contas"),
          apiFetch("/pessoas?tipos=C,A"),
          apiFetch("/pessoas?tipos=F,A"),
          apiFetch("/modelo-distribuicao?ativo=true"),
        ]);
        setContas(Array.isArray(c) ? c : []);
        setPessoasCA(Array.isArray(ca) ? ca : []);
        setPessoasFA(Array.isArray(fa) ? fa : []);
        setModelos(Array.isArray(m) ? m : []);
      } catch (e) {
        addToast(e?.message || "Erro ao carregar dados base.", "error");
      }
    })();
  }, [addToast]);

  const btn = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  };

  const btnSec = { ...btn, background: "#fff", color: "#111" };

  const input = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #ddd",
  };

  const th = { textAlign: "left", fontSize: 12, color: "#444", padding: "8px 10px", borderBottom: "1px solid #eee" };
  const td = { padding: "8px 10px", borderBottom: "1px solid #f2f2f2", verticalAlign: "top" };

  const onParse = async () => {
    if (!file) { addToast("Selecione um PDF.", "error"); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await apiFetch(`/livro-caixa/importacao/pdf/parse?ano=${ano}&mes=${mes}`, {
        method: "POST",
        body: fd,
      });
      setSessaoId(resp?.sessaoId || null);
      setAlertaImport(resp?.alerta || null);
      setMostrarApenasP(false);
      const items = resp?.items || [];
      setRows(items.map((x) => ({ ...x, _confirmed: x.jaConfirmada === true, _error: "", _result: null })));
      addToast(`Prévia gerada: ${items.length} lançamento(s).`, "success");
    } catch (e) {
      addToast(e?.message || "Erro ao ler PDF.", "error");
    } finally {
      setLoading(false);
    }
  };

  const setRow = (rowId, patch) => {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const confirmRow = async (r) => {
    if (r._confirmed) return true;

    if (!r.contaId && !r.contaNome) {
      setRow(r.rowId, { _error: "Informe uma conta (ou contaNome)." });
      return false;
    }

    const contemNFSe = /NFS-e/i.test(String(r.documento || "")) || /NFS-e/i.test(String(r.historico || ""));
    const viraAvulso = r.es === "E" && (contemNFSe || r.isentoTributacao === true);

    if (viraAvulso && r.repasse && !r.modeloDistribuicaoId) {
      setRow(r.rowId, { _error: "Repasse=Sim exige Modelo de Distribuição." });
      return false;
    }

    setBusyRowId(r.rowId);
    setRow(r.rowId, { _error: "" });

    try {
      const payload = {
        rowId: r.rowId,
        competenciaAno: ano,
        competenciaMes: mes,
        dataBR: r.dataBR,
        es: r.es,
        documento: r.documento,
        clienteFornecedor: r.clienteFornecedor,
        historico: r.historico,
        valorCentavos: Number(r.valorCentavos || 0),
        localLabel: r.localLabel || r.localLabelFallback || "",
        contaId: r.contaId ? Number(r.contaId) : null,
        contaNome: r.contaNome || "",
        repasse: !!r.repasse,
        isentoTributacao: !!r.isentoTributacao,
        clienteId: r.clienteId ? Number(r.clienteId) : null,
        modeloDistribuicaoId:  r.modeloDistribuicaoId  ? Number(r.modeloDistribuicaoId)  : null,
        advogadoPrincipalId:   r.advogadoPrincipalId   ? Number(r.advogadoPrincipalId)   : null,
        indicacaoAdvogadoId:   r.indicacaoAdvogadoId   ? Number(r.indicacaoAdvogadoId)   : null,
        usaSplitSocio:         !!r.usaSplitSocio,
        splits:                Array.isArray(r.splits) ? r.splits : [],
        sessaoId:              sessaoId,
      };

      const result = await apiFetch("/livro-caixa/importacao/pdf/confirmar-linha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      if (result?.clienteCriado?.id) {
        const novo = result.clienteCriado;
        const upsertSorted = (prev) => {
          const exists = prev.some((x) => x.id === novo.id);
          const merged = exists ? prev : [...prev, novo];
          return merged.sort((a, b) =>
            String(a.nomeRazaoSocial || "").localeCompare(String(b.nomeRazaoSocial || ""), "pt-BR")
          );
        };
        const t = String(novo.tipo || "").toUpperCase();
        if (t === "C") setPessoasCA((prev) => upsertSorted(prev));
        else if (t === "F") setPessoasFA((prev) => upsertSorted(prev));
        else {
          setPessoasCA((prev) => upsertSorted(prev));
          setPessoasFA((prev) => upsertSorted(prev));
        }
        setRow(r.rowId, { clienteId: novo.id });
      }

      setRow(r.rowId, { _confirmed: true, _result: result });
      addToast(`Linha confirmada: ${r.dataBR} (${r.es})`, "success");
      return true;
    } catch (e) {
      setRow(r.rowId, { _error: e?.message || "Erro ao confirmar linha." });
      addToast(e?.message || "Erro ao confirmar linha.", "error");
      return false;
    } finally {
      setBusyRowId(null);
    }
  };

  const confirmAll = async () => {
    if (pendingRows.length === 0) {
      addToast("Nenhuma linha pendente para confirmar.", "warning");
      return;
    }
    setConfirmingAll(true);
    let successCount = 0;
    let errorCount = 0;
    for (const r of pendingRows) {
      const ok = await confirmRow(r);
      if (ok) successCount++;
      else errorCount++;
    }
    setConfirmingAll(false);
    addToast(
      `Confirmação em lote: ${successCount} sucesso, ${errorCount} erro(s).`,
      errorCount > 0 ? "warning" : "success"
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 6px 0" }}>Importação por PDF — Livro Caixa</h2>
      <div style={{ color: "#666", marginBottom: 14 }}>Competência: {competenciaLabel}</div>

      <div style={{ display: "grid", gridTemplateColumns: "140px 120px 1fr auto", gap: 10, alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Ano</div>
          <input style={input} value={ano} onChange={(e) => setAno(Number(e.target.value || 0))} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Mês</div>
          <input style={input} value={mes} onChange={(e) => setMes(Number(e.target.value || 0))} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>PDF</div>
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <button style={btn} onClick={onParse} disabled={loading || confirmingAll}>
          {loading ? "Lendo..." : "Gerar prévia"}
        </button>
      </div>

      {alertaImport && (
        <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10,
          background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e",
          fontSize: 13, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span>
            <strong>Este arquivo já foi importado</strong>{" "}
            em {new Date(alertaImport.criadaEm).toLocaleDateString("pt-BR")} —{" "}
            {alertaImport.linhasConfirmadas}/{alertaImport.totalLinhas} linha(s) confirmada(s).
            {alertaImport.linhasConfirmadas < alertaImport.totalLinhas
              ? " Linhas pendentes ainda podem ser importadas."
              : " Todas as linhas já foram confirmadas."}
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            style={{ ...btn, background: pendingRows.length > 0 ? "#16a34a" : "#999" }}
            onClick={confirmAll}
            disabled={confirmingAll || pendingRows.length === 0}
          >
            {confirmingAll ? "Confirmando..." : `Confirmar Todos (${pendingRows.length})`}
          </button>
          <button onClick={() => setMostrarApenasP((v) => !v)} style={btnSec}>
            {mostrarApenasP ? "Mostrar todas" : `Só pendentes (${rows.filter((r) => !r._confirmed).length})`}
          </button>
          <span style={{ fontSize: 13, color: "#666" }}>
            {confirmedCount} de {rows.length} confirmado(s)
          </span>
        </div>
      )}

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#fafafa" }}>
            <tr>
              <th style={th}>Data</th>
              <th style={th}>E/S</th>
              <th style={th}>Documento</th>
              <th style={th}>Cliente</th>
              <th style={th}>Histórico</th>
              <th style={th}>Valor</th>
              <th style={th}>Conta</th>
              <th style={th}>Flags</th>
              <th style={th}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {(mostrarApenasP ? rows.filter((r) => !r._confirmed) : rows).map((r) => {
              const disabled = r._confirmed || busyRowId === r.rowId;
              const valorFmt = brlFromCentavos(r.valorCentavos);
              const contemNFSe = /NFS-e/i.test(String(r.documento || "")) || /NFS-e/i.test(String(r.historico || ""));
              const isEntrada = r.es === "E";
              const viraAvulso = isEntrada && (contemNFSe || r.isentoTributacao === true);
              const modeloSelecionado = modelos.find((m) => m.id === r.modeloDistribuicaoId);

              return (
                <tr key={r.rowId} style={{ opacity: r._confirmed ? 0.65 : 1 }}>
                  <td style={td}>
                    <input style={input} value={r.dataBR || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { dataBR: e.target.value })} />
                  </td>

                  <td style={td}>
                    <select style={input} value={r.es || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { es: e.target.value })}>
                      <option value="">-</option>
                      <option value="E">E</option>
                      <option value="S">S</option>
                    </select>
                  </td>

                  <td style={td}>
                    <input style={input} value={r.documento || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { documento: e.target.value || null })} />
                  </td>

                  <td style={td}>
                    <select style={input} value={r.clienteId || ""} disabled={disabled}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        const lista = r.es === "S" ? pessoasFA : pessoasCA;
                        const c = lista.find((x) => x.id === id);
                        setRow(r.rowId, { clienteId: id, ...(c?.nomeRazaoSocial ? { clienteFornecedor: c.nomeRazaoSocial } : {}) });
                      }}>
                      <option value="">(opcional) selecione p/ substituir</option>
                      {(r.es === "S" ? pessoasFA : pessoasCA).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nomeRazaoSocial || c.nome || `Cadastro ${c.id}`}{c.tipo ? ` (${c.tipo})` : ""}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>
                      <input type="text" style={input} placeholder="cliente/fornecedor (texto)"
                        value={r.clienteFornecedor || ""} disabled={disabled}
                        onChange={(e) => setRow(r.rowId, { clienteFornecedor: e.target.value })} />
                    </div>
                  </td>

                  <td style={td}>
                    <textarea style={{ ...input, height: 62 }} value={r.historico || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { historico: e.target.value })} />
                    {r._error ? <div style={{ marginTop: 6, color: "#b00020", fontSize: 12 }}>{r._error}</div> : null}
                  </td>

                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{valorFmt}</div>
                    <div style={{ fontSize: 11, color: "#777" }}>{r.localLabel || ""}</div>
                  </td>

                  <td style={td}>
                    <select style={input} value={r.contaId || ""} disabled={disabled}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        const c = contas.find((x) => x.id === id);
                        setRow(r.rowId, { contaId: id, contaNome: c?.nome || r.contaNome });
                      }}>
                      <option value="">(auto/criar OUTROS)</option>
                      {contas.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome} ({c.tipo})</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>
                      <input style={input} value={r.contaNome || ""} disabled={disabled}
                        onChange={(e) => setRow(r.rowId, { contaNome: e.target.value })}
                        placeholder="Nome da conta (se não existir cria OUTROS)" />
                    </div>
                  </td>

                  <td style={td}>
                    {isEntrada ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {!contemNFSe ? (
                          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                            <input type="checkbox" checked={!!r.isentoTributacao} disabled={disabled}
                              onChange={(e) => setRow(r.rowId, { isentoTributacao: e.target.checked })} />
                            Não tributado?
                          </label>
                        ) : (
                          <div style={{ fontSize: 12, color: "#555" }}>Detectado NFS-e</div>
                        )}

                        {viraAvulso ? (
                          <>
                            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                              <input type="checkbox" checked={!!r.repasse} disabled={disabled}
                                onChange={(e) => setRow(r.rowId, { repasse: e.target.checked })} />
                              Repasse?
                            </label>

                            {r.repasse ? (
                              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                <button
                                  style={{
                                    ...btnSec, fontSize: 12, padding: "6px 12px",
                                    borderColor: modeloSelecionado ? "#16a34a" : "#f59e0b",
                                    color:       modeloSelecionado ? "#15803d" : "#92400e",
                                    background:  modeloSelecionado ? "#f0fdf4" : "#fffbeb",
                                  }}
                                  disabled={disabled}
                                  onClick={() => setRepasseModalRowId(r.rowId)}
                                >
                                  {modeloSelecionado ? modeloLabel(modeloSelecionado) : "⚠ Configurar Repasse..."}
                                </button>
                                {modeloSelecionado && !disabled && (
                                  <button
                                    onClick={() => setRow(r.rowId, {
                                      modeloDistribuicaoId: null, advogadoPrincipalId: null,
                                      indicacaoAdvogadoId: null, usaSplitSocio: false, splits: [],
                                    })}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontSize: 14, padding: "2px 4px" }}
                                    title="Limpar configuração de repasse"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: "#777" }}>Vai direto p/ Livro Caixa</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#777" }}>Saída =&gt; Livro Caixa</div>
                    )}
                  </td>

                  <td style={td}>
                    {r._confirmed ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ padding: "3px 10px", borderRadius: 20, background: "#dcfce7",
                          color: "#15803d", fontSize: 12, fontWeight: 700 }}>
                          ✓ {r.jaConfirmada ? "Já importada" : "Confirmado"}
                        </span>
                        {r.confirmedAt && (
                          <span style={{ fontSize: 11, color: "#6b7280" }}>
                            em {new Date(r.confirmedAt).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                        {r._result && (
                          <div style={{ fontSize: 11, color: "#666" }}>
                            {r._result.numeroContrato
                              ? <div>Contrato: {r._result.numeroContrato}</div>
                              : null}
                            {r._result.livroCaixaLancamentoId
                              ? <div>LC: #{r._result.livroCaixaLancamentoId}</div>
                              : null}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button style={btn} disabled={disabled} onClick={() => confirmRow(r)}>
                        Confirmar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {!rows.length ? (
              <tr>
                <td style={{ padding: 16, color: "#777" }} colSpan={9}>
                  Nenhuma prévia ainda. Selecione um PDF e clique em "Gerar prévia".
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, color: "#777", fontSize: 12 }}>
        Regras: NFS-e =&gt; Pagamento Avulso; sem NFS-e =&gt; marque "Não tributado?" para virar avulso; Saída sempre vai ao Livro Caixa.
      </div>

      {/* Modal de configuração de Repasse */}
      {repasseModalRowId && (
        <RepasseModal
          modelos={modelos}
          initialData={(() => {
            const row = rows.find((r) => r.rowId === repasseModalRowId);
            return row ? {
              modeloDistribuicaoId: row.modeloDistribuicaoId || null,
              advogadoPrincipalId:  row.advogadoPrincipalId  || null,
              indicacaoAdvogadoId:  row.indicacaoAdvogadoId  || null,
              usaSplitSocio:        row.usaSplitSocio        || false,
              splits:               row.splits               || [],
            } : null;
          })()}
          onConfirm={(data) => {
            setRow(repasseModalRowId, data);
            setRepasseModalRowId(null);
          }}
          onClose={() => setRepasseModalRowId(null)}
        />
      )}
    </div>
  );
}
