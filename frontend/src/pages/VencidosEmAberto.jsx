import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { centsToBRL, todayBR } from '../lib/formatters';
import ConfirmModal from "../components/ConfirmModal.jsx";

function formatDate(d) {
  if (!d) return "—";
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function competenciaLabel(ano, mes) {
  if (!ano || !mes) return "—";
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

const RISCO_CONFIG = {
  NORMAL:     { label: "Normal",     bg: "#f1f5f9", color: "#475569" },
  ATENCAO:    { label: "Atenção",    bg: "#fef3c7", color: "#92400e" },
  ALTO_RISCO: { label: "Alto Risco", bg: "#ffedd5", color: "#c2410c" },
  DUVIDOSO:   { label: "Duvidoso",   bg: "#fee2e2", color: "#b91c1c" },
};

const TODOS_RISCOS = ["NORMAL", "ATENCAO", "ALTO_RISCO", "DUVIDOSO"];

function RiscoBadge({ risco }) {
  const cfg = RISCO_CONFIG[risco] || RISCO_CONFIG.NORMAL;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

function OrigemBadge({ origem }) {
  const badges = {
    MANUAL:             { bg: "#e0f2fe", color: "#0369a1", label: "Manual" },
    PAGAMENTO_RECEBIDO: { bg: "#dcfce7", color: "#15803d", label: "Recebimento" },
    PARCELA_PREVISTA:   { bg: "#fef3c7", color: "#a16207", label: "Parcela Prevista" },
    REPASSES_REALIZADOS:        { bg: "#ede9fe", color: "#6d28d9", label: "Repasse" },
    EMPRESTIMO_SOCIO_PAGAMENTO: { bg: "#ede9fe", color: "#6d28d9", label: "Empréstimo" },
    IMPORT_PDF:                 { bg: "#e0f7fa", color: "#0e7490", label: "Import PDF" },
  };
  const b = badges[origem] || { bg: "#f1f5f9", color: "#64748b", label: origem || "—" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 600,
      background: b.bg,
      color: b.color,
    }}>
      {b.label}
    </span>
  );
}

// Modal inline de liquidação
function LiquidarModal({ item, contas, onConfirm, onClose }) {
  const [dataBR, setDataBR] = useState(todayBR());
  const [valorCentavos, setValorCentavos] = useState(item.valorCentavos);
  const [contaId, setContaId] = useState(item.contaId ? String(item.contaId) : "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const isParcelaPrevista = item.origem === "PARCELA_PREVISTA";

  async function handleConfirmar() {
    if (!dataBR.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      addToast("Data inválida (DD/MM/AAAA).", "warning");
      return;
    }
    const v = Number(valorCentavos);
    if (!Number.isInteger(v) || v <= 0) {
      addToast("Valor inválido.", "warning");
      return;
    }
    setSaving(true);
    try {
      const body = { dataBR, valorCentavos: v };
      if (contaId) body.contaId = Number(contaId);
      const result = await apiFetch(`/livro-caixa/vencidos-em-aberto/${item.id}/liquidar`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      addToast("Lançamento liquidado com sucesso!", "success");
      onConfirm(result);
    } catch (err) {
      addToast("Erro ao liquidar: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
    zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
  };
  const modal = {
    background: "#fff", borderRadius: 12, padding: 24, width: 420,
    maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4, display: "block" };
  const inputStyle = {
    width: "100%", padding: "6px 10px", border: "1px solid #d1d5db",
    borderRadius: 6, fontSize: 14, boxSizing: "border-box",
  };
  const row = { marginBottom: 14 };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>
          Registrar recebimento
        </div>

        <div style={{ fontSize: 13, color: "#475569", marginBottom: 16, lineHeight: 1.5 }}>
          <strong>{item.clienteFornecedor || item.historico || "—"}</strong>
          <br />
          Valor original: <strong>{centsToBRL(item.valorCentavos)}</strong> —
          vencido há <strong>{item.diasEmAtraso} dias</strong>
        </div>

        {isParcelaPrevista && (
          <div style={{
            background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 8,
            padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#1d4ed8",
          }}>
            A parcela do contrato será marcada como <strong>RECEBIDA</strong> após a confirmação.
          </div>
        )}

        <div style={row}>
          <label style={labelStyle}>Data do recebimento</label>
          <input
            style={inputStyle}
            type="text"
            placeholder="DD/MM/AAAA"
            value={dataBR}
            onChange={(e) => setDataBR(e.target.value)}
          />
        </div>

        <div style={row}>
          <label style={labelStyle}>Valor recebido (centavos)</label>
          <input
            style={inputStyle}
            type="number"
            min="1"
            value={valorCentavos}
            onChange={(e) => setValorCentavos(Number(e.target.value))}
          />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
            = {centsToBRL(valorCentavos)}
          </div>
        </div>

        <div style={row}>
          <label style={labelStyle}>Conta</label>
          <select
            style={{ ...inputStyle, background: "#fff" }}
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
          >
            <option value="">— Manter conta original —</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db",
              background: "#f9fafb", color: "#374151", fontSize: 13, cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={saving}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: saving ? "#86efac" : "#16a34a", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Salvando..." : "Confirmar recebimento"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VencidosEmAberto({ user }) {
  const { addToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const [items, setItems] = useState([]);
  const [contas, setContas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalItem, setModalItem] = useState(null);
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const pendingConfirmRef = useRef(null);

  // Filtros
  const [filtroRiscos, setFiltroRiscos] = useState([...TODOS_RISCOS]);
  const [filtroES, setFiltroES] = useState("TODOS");
  const [filtroContaId, setFiltroContaId] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [vencidos, contasData] = await Promise.all([
        apiFetch("/livro-caixa/vencidos-em-aberto"),
        apiFetch("/livro-caixa/contas"),
      ]);
      setItems(vencidos.items || []);
      const lista = Array.isArray(contasData) ? contasData : (contasData.contas || []);
      setContas(lista.filter((c) => c.ativo !== false));
    } catch (err) {
      addToast("Erro ao carregar vencidos: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // Itens filtrados (client-side)
  const itemsFiltrados = useMemo(() => items.filter((l) =>
    filtroRiscos.includes(l.risco) &&
    (filtroES === "TODOS" || l.es === filtroES) &&
    (!filtroContaId || String(l.contaId) === filtroContaId)
  ), [items, filtroRiscos, filtroES, filtroContaId]);

  // Totais derivados dos itens filtrados
  const totalFiltrado = useMemo(() =>
    itemsFiltrados.reduce((s, l) => s + l.valorCentavos, 0),
    [itemsFiltrados]
  );
  const contagensFiltradas = useMemo(() => itemsFiltrados.reduce(
    (acc, l) => {
      if (l.risco === "NORMAL") acc.normal++;
      else if (l.risco === "ATENCAO") acc.atencao++;
      else if (l.risco === "ALTO_RISCO") acc.altoRisco++;
      else acc.duvidoso++;
      return acc;
    },
    { normal: 0, atencao: 0, altoRisco: 0, duvidoso: 0 }
  ), [itemsFiltrados]);

  function toggleRisco(r) {
    setFiltroRiscos((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  function limparFiltros() {
    setFiltroRiscos([...TODOS_RISCOS]);
    setFiltroES("TODOS");
    setFiltroContaId("");
  }

  const filtrosAtivos =
    filtroRiscos.length < TODOS_RISCOS.length || filtroES !== "TODOS" || filtroContaId !== "";

  async function handleEnviarEmail() {
    setEnviandoEmail(true);
    try {
      const r = await apiFetch("/livro-caixa/vencidos-em-aberto/enviar-email", { method: "POST" });
      if (r.enviados === 0) {
        addToast(r.message || "Nenhum e-mail enviado.", "warning");
      } else {
        addToast(`E-mail enviado para ${r.enviados} destinatário(s).`, "success");
      }
    } catch (err) {
      addToast("Erro ao enviar e-mail: " + err.message, "error");
    } finally {
      setEnviandoEmail(false);
    }
  }

  function handleCancelar(item) {
    pendingConfirmRef.current = async () => {
      try {
        await apiFetch(`/livro-caixa/vencidos-em-aberto/${item.id}/cancelar`, { method: "PATCH" });
        addToast("Lançamento cancelado.", "success");
        setItems((prev) => {
          const next = prev.filter((l) => l.id !== item.id);
          window.dispatchEvent(new CustomEvent("badge:refresh"));
          return next;
        });
      } catch (err) {
        addToast("Erro ao cancelar: " + err.message, "error");
      }
    };
    setConfirmState({
      title: "Cancelar lançamento",
      message: `Cancelar o lançamento "${item.historico || item.clienteFornecedor || item.id}"?`,
      danger: true,
    });
  }

  function handleLiquidado(result) {
    setModalItem(null);
    setItems((prev) => {
      const next = prev.filter((l) => l.id !== result.originalId);
      window.dispatchEvent(new CustomEvent("badge:refresh"));
      return next;
    });
  }

  const th = {
    padding: "8px 12px", fontSize: 11, fontWeight: 700,
    textTransform: "uppercase", color: "#64748b", textAlign: "left",
    borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap",
  };
  const td = {
    padding: "8px 12px", fontSize: 13, color: "#1e293b",
    borderBottom: "1px solid #f1f5f9", verticalAlign: "middle",
  };

  return (
    <div style={{ padding: "24px 32px", fontFamily: "sans-serif", maxWidth: 1400 }}>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          danger={confirmState.danger}
          onConfirm={async () => {
            setConfirmState(null);
            if (pendingConfirmRef.current) {
              await pendingConfirmRef.current();
              pendingConfirmRef.current = null;
            }
          }}
          onCancel={() => { setConfirmState(null); pendingConfirmRef.current = null; }}
        />
      )}
      {/* Cabeçalho */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Vencidos em Aberto
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 4, marginBottom: 0 }}>
            Lançamentos previstos com data passada aguardando confirmação
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={handleEnviarEmail}
            disabled={enviandoEmail}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: "1px solid #3b82f6", background: enviandoEmail ? "#dbeafe" : "#eff6ff",
              color: "#1d4ed8", cursor: enviandoEmail ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {enviandoEmail ? "Enviando..." : "📧 Enviar resumo por e-mail"}
          </button>
        )}
      </div>

      {/* Cards de resumo (refletem filtros ativos) */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <SummaryCard
          label="Total Vencido"
          value={centsToBRL(totalFiltrado)}
          color="#0f172a"
          bg="#f8fafc"
        />
        <SummaryCard
          label={filtrosAtivos ? "Filtrados" : "Lançamentos"}
          value={itemsFiltrados.length}
          color="#0f172a"
          bg="#f8fafc"
        />
        <SummaryCard
          label="Normal (0–30d)"
          value={contagensFiltradas.normal}
          color={RISCO_CONFIG.NORMAL.color}
          bg={RISCO_CONFIG.NORMAL.bg}
        />
        <SummaryCard
          label="Atenção (31–60d)"
          value={contagensFiltradas.atencao}
          color={RISCO_CONFIG.ATENCAO.color}
          bg={RISCO_CONFIG.ATENCAO.bg}
        />
        <SummaryCard
          label="Alto Risco (61–90d)"
          value={contagensFiltradas.altoRisco}
          color={RISCO_CONFIG.ALTO_RISCO.color}
          bg={RISCO_CONFIG.ALTO_RISCO.bg}
        />
        <SummaryCard
          label="Duvidoso (91+d)"
          value={contagensFiltradas.duvidoso}
          color={RISCO_CONFIG.DUVIDOSO.color}
          bg={RISCO_CONFIG.DUVIDOSO.bg}
        />
      </div>

      {/* Barra de filtros */}
      <div style={{
        background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10,
        padding: "14px 16px", marginBottom: 20,
        display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center",
      }}>
        {/* Chips de risco */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>Risco:</span>
          {TODOS_RISCOS.map((r) => {
            const cfg = RISCO_CONFIG[r];
            const ativo = filtroRiscos.includes(r);
            return (
              <button
                key={r}
                onClick={() => toggleRisco(r)}
                style={{
                  padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", transition: "all .15s",
                  background: ativo ? cfg.bg : "#fff",
                  color: ativo ? cfg.color : "#94a3b8",
                  border: `1.5px solid ${ativo ? cfg.color : "#d1d5db"}`,
                }}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* E/S */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginRight: 4 }}>Tipo:</span>
          {[["TODOS", "Todos"], ["E", "Entradas"], ["S", "Saídas"]].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFiltroES(val)}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: "pointer",
                background: filtroES === val ? "#dbeafe" : "#fff",
                color: filtroES === val ? "#1d4ed8" : "#64748b",
                border: `1.5px solid ${filtroES === val ? "#3b82f6" : "#d1d5db"}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Conta */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>Conta:</span>
          <select
            value={filtroContaId}
            onChange={(e) => setFiltroContaId(e.target.value)}
            style={{
              padding: "4px 8px", border: "1.5px solid #d1d5db", borderRadius: 6,
              fontSize: 12, background: filtroContaId ? "#dbeafe" : "#fff",
              color: filtroContaId ? "#1d4ed8" : "#374151",
            }}
          >
            <option value="">Todas as contas</option>
            {contas.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.nome}</option>
            ))}
          </select>
        </div>

        {/* Limpar */}
        {filtrosAtivos && (
          <button
            onClick={limparFiltros}
            style={{
              marginLeft: "auto", padding: "4px 12px", borderRadius: 6,
              border: "1px solid #d1d5db", background: "#fff",
              color: "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela */}
      {loading ? (
        <div style={{ color: "#64748b", fontSize: 14 }}>Carregando...</div>
      ) : items.length === 0 ? (
        <div style={{
          padding: 48, textAlign: "center", background: "#f8fafc",
          borderRadius: 12, color: "#64748b", fontSize: 14,
        }}>
          Nenhum lançamento vencido em aberto.
        </div>
      ) : itemsFiltrados.length === 0 ? (
        <div style={{
          padding: 32, textAlign: "center", background: "#f8fafc",
          borderRadius: 12, color: "#64748b", fontSize: 14,
        }}>
          Nenhum resultado para os filtros selecionados.{" "}
          <button onClick={limparFiltros} style={{ color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
            Limpar filtros
          </button>
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #e5e7eb" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                <th style={th}>Data orig.</th>
                <th style={th}>Competência</th>
                <th style={th}>E/S</th>
                <th style={th}>Cliente/Fornecedor</th>
                <th style={th}>Histórico</th>
                <th style={{ ...th, textAlign: "right" }}>Valor</th>
                <th style={{ ...th, textAlign: "center" }}>Dias</th>
                <th style={{ ...th, textAlign: "center" }}>Risco</th>
                <th style={th}>Origem</th>
                <th style={th}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {itemsFiltrados.map((item) => (
                <tr
                  key={item.id}
                  style={{
                    borderLeft: `3px solid ${RISCO_CONFIG[item.risco]?.color || "#e5e7eb"}`,
                  }}
                >
                  <td style={td}>{formatDate(item.data)}</td>
                  <td style={td}>{competenciaLabel(item.competenciaAno, item.competenciaMes)}</td>
                  <td style={td}>
                    <span style={{
                      fontWeight: 700,
                      color: item.es === "E" ? "#16a34a" : "#dc2626",
                    }}>
                      {item.es === "E" ? "Entrada" : "Saída"}
                    </span>
                  </td>
                  <td style={td}>{item.clienteFornecedor || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                  <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.historico || <span style={{ color: "#94a3b8" }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {centsToBRL(item.valorCentavos)}
                  </td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 600 }}>
                    {item.diasEmAtraso}d
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <RiscoBadge risco={item.risco} />
                  </td>
                  <td style={td}>
                    <OrigemBadge origem={item.origem} />
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
                      <button
                        onClick={() => setModalItem(item)}
                        style={{
                          padding: "4px 10px", borderRadius: 6,
                          border: "1px solid #16a34a", background: "#dcfce7",
                          color: "#166534", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Registrar recebimento
                      </button>
                      <button
                        onClick={() => handleCancelar(item)}
                        style={{
                          padding: "4px 10px", borderRadius: 6,
                          border: "1px solid #d1d5db", background: "#f9fafb",
                          color: "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de liquidação */}
      {modalItem && (
        <LiquidarModal
          item={modalItem}
          contas={contas}
          onConfirm={handleLiquidado}
          onClose={() => setModalItem(null)}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, color, bg }) {
  return (
    <div style={{
      background: bg,
      border: `1px solid ${color}22`,
      borderRadius: 10,
      padding: "12px 20px",
      minWidth: 140,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}
