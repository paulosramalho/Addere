import React, { useEffect, useMemo, useState } from "react";
import PreviewResumo from "../components/livroCaixa/PreviewResumo.jsx";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import { centsToBRL } from '../lib/formatters';

export default function LivroCaixaVisualizacao() {
  const { addToast } = useToast();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [reconciliacao, setReconciliacao] = useState(null);

  // ── Filtros de busca ──
  const [fEs, setFEs] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fHistorico, setFHistorico] = useState("");
  const [fValorMin, setFValorMin] = useState("");
  const [fValorMax, setFValorMax] = useState("");
  const [fLocal, setFLocal] = useState("");
  const [fStatusFluxo, setFStatusFluxo] = useState("");

  const competenciaLabel = useMemo(() => `${String(mes).padStart(2, "0")}/${ano}`, [ano, mes]);

  function parseCents(v) {
    return Number(String(v || "").replace(/\D/g, "")) || 0;
  }
  function maskValor(v) {
    const d = String(v || "").replace(/\D/g, "");
    if (!d) return "";
    return (Number(d) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const locaisNoMes = useMemo(() => {
    const set = new Set((data?.linhas || []).map(l => l.localLabel).filter(Boolean));
    return [...set].sort();
  }, [data]);

  const hasFilter = !!(fEs || fCliente || fHistorico || fValorMin || fValorMax || fLocal || fStatusFluxo);

  const filteredLinhas = useMemo(() => {
    const linhas = data?.linhas || [];
    if (!hasFilter) return linhas;
    return linhas.filter((l) => {
      if (fEs && l.es !== fEs) return false;
      if (fCliente && !String(l.clienteFornecedor || "").toLowerCase().includes(fCliente.toLowerCase())) return false;
      if (fHistorico && !String(l.historico || "").toLowerCase().includes(fHistorico.toLowerCase())) return false;
      if (fValorMin) { const min = parseCents(fValorMin); if (l.valorCentavos < min) return false; }
      if (fValorMax) { const max = parseCents(fValorMax); if (l.valorCentavos > max) return false; }
      if (fLocal && l.localLabel !== fLocal) return false;
      if (fStatusFluxo && l.statusFluxo !== fStatusFluxo) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fEs, fCliente, fHistorico, fValorMin, fValorMax, fLocal, fStatusFluxo]);

  function clearFilters() {
    setFEs(""); setFCliente(""); setFHistorico("");
    setFValorMin(""); setFValorMax(""); setFLocal(""); setFStatusFluxo("");
  }

  async function loadData() {
    setErr("");
    setLoading(true);
    try {
      const d = await apiFetch(`/livro-caixa/preview?ano=${ano}&mes=${mes}`);
      setData(d);
    } catch (e) {
      const errorMsg = e.message || String(e);
      setErr(errorMsg);
      addToast(`Erro ao carregar visualização: ${errorMsg}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function recarregar() {
    setErr("");
    setLoading(true);
    try {
      const d = await apiFetch(`/livro-caixa/preview?ano=${ano}&mes=${mes}`);
      setData(d);
      addToast("Visualização recarregada com sucesso!", "success");
    } catch (e) {
      const errorMsg = e.message || String(e);
      setErr(errorMsg);
      addToast(`Erro ao carregar visualização: ${errorMsg}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  useEffect(() => {
    apiFetch("/conta-corrente-clientes/reconciliacao")
      .then(setReconciliacao)
      .catch(() => {});
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h2>Livro Caixa — Visualização</h2>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        <Tooltip content="Selecione o ano para visualizar o livro caixa">
          <label>
            Ano:&nbsp;
            <input
              type="number"
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              style={styles.input}
            />
          </label>
        </Tooltip>

        <Tooltip content="Selecione o mês (1-12) para visualizar o livro caixa">
          <label>
            Mês:&nbsp;
            <input
              type="number"
              min={1}
              max={12}
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              style={styles.inputMes}
            />
          </label>
        </Tooltip>

        <strong style={{ marginLeft: 8 }}>Competência: {competenciaLabel}</strong>

        <Tooltip content="Recarregar os dados da visualização">
          <button onClick={recarregar} disabled={loading} style={styles.btnRecarregar}>
            🔄 Recarregar
          </button>
        </Tooltip>
      </div>

      {err ? (
        <div style={styles.errorBox}>
          <strong>Erro:</strong> {err}
        </div>
      ) : null}

      {loading ? (
        <div style={styles.loading}>
          Carregando visualização...
        </div>
      ) : null}

      {data ? (
        <>
          <PreviewResumo
            saldoAnteriorCentavos={data.saldoAnteriorCentavos}
            pendenciasCount={data.pendenciasCount}
            totaisPorLocal={data.totaisPorLocal || []}
            reconciliacaoClientes={reconciliacao}
          />

          <div style={{ marginTop: 20, marginBottom: 8 }}>
            <h3 style={{ marginBottom: 8 }}>Prévia do mês</h3>
          </div>

          {/* ── Barra de filtros ── */}
          <div style={styles.filterWrap}>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>E/S</span>
              <select value={fEs} onChange={e => setFEs(e.target.value)} style={{ ...styles.filterInput, minWidth: 120 }}>
                <option value="">Todos</option>
                <option value="E">Entrada</option>
                <option value="S">Saída</option>
              </select>
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Cliente/Fornecedor</span>
              <input value={fCliente} onChange={e => setFCliente(e.target.value)} placeholder="Buscar…" style={{ ...styles.filterInput, minWidth: 160 }} />
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Histórico</span>
              <input value={fHistorico} onChange={e => setFHistorico(e.target.value)} placeholder="Buscar…" style={{ ...styles.filterInput, minWidth: 160 }} />
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Valor mín.</span>
              <input inputMode="numeric" value={fValorMin}
                onChange={e => { const d = e.target.value.replace(/\D/g, ""); setFValorMin(d ? maskValor(d) : ""); }}
                placeholder="0,00" style={{ ...styles.filterInput, width: 110 }} />
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Valor máx.</span>
              <input inputMode="numeric" value={fValorMax}
                onChange={e => { const d = e.target.value.replace(/\D/g, ""); setFValorMax(d ? maskValor(d) : ""); }}
                placeholder="0,00" style={{ ...styles.filterInput, width: 110 }} />
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Local</span>
              <select value={fLocal} onChange={e => setFLocal(e.target.value)} style={{ ...styles.filterInput, minWidth: 140 }}>
                <option value="">Todos</option>
                {locaisNoMes.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Status</span>
              <select value={fStatusFluxo} onChange={e => setFStatusFluxo(e.target.value)} style={{ ...styles.filterInput, minWidth: 130 }}>
                <option value="">Todos</option>
                <option value="EFETIVADO">Efetivado</option>
                <option value="PREVISTO">Previsto</option>
              </select>
            </div>
            {hasFilter && (
              <button onClick={clearFilters} style={styles.filterBtnClear}>✕ Limpar</button>
            )}
          </div>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
            {hasFilter
              ? `${filteredLinhas.length} de ${data.linhas?.length || 0} lançamento(s)`
              : `${data.linhas?.length || 0} lançamento(s) — competência ${competenciaLabel}`}
          </p>

          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={th} title="Data do lançamento">Data</th>
                  <th style={th} title="Número do documento fiscal">NFS-e</th>
                  <th style={th} title="Entrada ou Saída">E/S</th>
                  <th style={th} title="Cliente ou Fornecedor">Cliente/Fornecedor</th>
                  <th style={th} title="Descrição do lançamento">Histórico</th>
                  <th style={thRight} title="Valor do lançamento">Valor</th>
                  <th style={th} title="Conta bancária ou caixa">Local</th>
                  <th style={thRight} title="Saldo acumulado após o lançamento">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filteredLinhas.map((l) => (
                  <tr key={l.id} style={styles.tableRow}>
                    <td style={td}>{l.dataBR}</td>
                    <td style={td}>{l.documento || "—"}</td>
                    <td style={{ ...td, ...getEsStyle(l.es) }}>{l.es}</td>
                    <td
                      style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={l.clienteFornecedor || undefined}
                    >
                      {l.clienteFornecedor || "—"}
                    </td>
                    <td
                      style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={l.historico || undefined}
                    >
                      {l.historico}
                    </td>
                    <td style={{ ...td, ...getValueStyle(l.es), textAlign: "right" }}>
                      {centsToBRL(l.es === "S" ? -l.valorCentavos : l.valorCentavos)}
                    </td>
                    <td
                      style={{ ...td, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={l.localLabel || undefined}
                    >
                      {l.localLabel}
                    </td>
                    <td style={{ ...td, fontWeight: 700, textAlign: "right" }}>
                      {centsToBRL(l.saldoAposCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredLinhas.length === 0 && (
            <div style={styles.emptyState}>
              {hasFilter ? "🔍 Nenhum resultado para os filtros aplicados" : "📭 Nenhum lançamento encontrado para esta competência"}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// Função auxiliar para estilo da coluna E/S
function getEsStyle(es) {
  if (es === "E") {
    return {
      color: "#059669",
      fontWeight: 700,
    };
  }
  if (es === "S") {
    return {
      color: "#dc2626",
      fontWeight: 700,
    };
  }
  return {};
}

// Função auxiliar para estilo dos valores
function getValueStyle(es) {
  if (es === "E") {
    return {
      color: "#059669",
      fontWeight: 600,
    };
  }
  if (es === "S") {
    return {
      color: "#dc2626",
      fontWeight: 600,
    };
  }
  return {};
}

const styles = {
  filterWrap: {
    display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end",
    margin: "0 0 8px", padding: "12px 14px",
    background: "#f8fafc", borderRadius: 10, border: "1px solid #e5e7eb",
  },
  filterGroup: { display: "flex", flexDirection: "column", gap: 3 },
  filterLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", whiteSpace: "nowrap" },
  filterInput: {
    height: 34, borderRadius: 8, border: "1px solid #d1d5db",
    padding: "0 10px", fontSize: 13, outline: "none", minWidth: 120,
  },
  filterBtnClear: {
    height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #d1d5db",
    background: "#fff", color: "#64748b", fontSize: 12, cursor: "pointer",
    fontWeight: 600, alignSelf: "flex-end",
  },
  input: {
    width: 100,
    height: 38,
    padding: "0 10px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  },
  inputMes: {
    width: 70,
    height: 38,
    padding: "0 10px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  },
  btnRecarregar: {
    height: 38,
    padding: "0 16px",
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    color: "#111",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    marginLeft: 8,
  },
  errorBox: {
    padding: 12,
    background: "#ffe9e9",
    border: "1px solid #ffb6b6",
    borderRadius: 8,
    marginBottom: 16,
  },
  loading: {
    padding: 16,
    textAlign: "center",
    color: "#6b7280",
    fontSize: 14,
  },
  tableContainer: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  tableRow: {
    transition: "background-color 0.2s",
  },
  emptyState: {
    padding: 40,
    textAlign: "center",
    fontSize: 16,
    color: "#6b7280",
    background: "#f9fafb",
    borderRadius: 8,
    marginTop: 16,
  },
};

const th = {
  textAlign: "left",
  padding: 12,
  borderBottom: "2px solid #e5e7eb",
  background: "#f9fafb",
  fontWeight: 700,
  fontSize: 13,
  color: "#374151",
  whiteSpace: "nowrap",
  cursor: "help",
};

const thRight = {
  ...th,
  textAlign: "right",
};

const td = {
  padding: 12,
  borderBottom: "1px solid #f3f4f6",
  fontSize: 14,
  color: "#1f2937",
  verticalAlign: "middle",
};