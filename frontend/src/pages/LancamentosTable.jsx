import React, { useState, useEffect, useRef } from "react";
import { Tooltip } from "../components/Tooltip";
import { useToast } from "../components/Toast";
import EmptyState from "../components/ui/EmptyState";
import { apiFetch } from "../lib/api";
import { centsToBRL } from '../lib/formatters';

function formatDate(d) {
  if (!d) return "—";
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function getOrigemBadge(origem) {
  const badges = {
    MANUAL: { bg: "#e0f2fe", color: "#0369a1", label: "Manual" },
    PAGAMENTO_RECEBIDO: { bg: "#dcfce7", color: "#15803d", label: "Recebimento" },
    PARCELA_PREVISTA: { bg: "#fef3c7", color: "#a16207", label: "Parcela Prevista" },
    PARCELA_FIXA_AUTOMATICA: { bg: "#f3f4f6", color: "#6b7280", label: "Legado" },
    REPASSES_REALIZADOS: { bg: "#f3f4f6", color: "#6b7280", label: "Legado" },
    EMPRESTIMO_SOCIO_PAGAMENTO: { bg: "#f3f4f6", color: "#6b7280", label: "Legado" },
    DESPESA: { bg: "#fee2e2", color: "#b91c1c", label: "Despesa" },
  };
  
  const badge = badges[origem] || { bg: "#f3f4f6", color: "#6b7280", label: origem };
  
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: badge.bg,
        color: badge.color,
      }}
    >
      {badge.label}
    </span>
  );
}

function getStatusBadge(status) {
  if (status === "OK") {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          background: "#dcfce7",
          color: "#15803d",
        }}
      >
        ✓ OK
      </span>
    );
  }
  
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: "#fef3c7",
        color: "#a16207",
      }}
    >
      ⚠ Pendente
    </span>
  );
}

// ── Popover de saldos por conta ───────────────────────────────────────────────
function ContasSaldoPopover({ lancamentoId, onSelect, onClose }) {
  const ref = useRef(null);
  const [saldos, setSaldos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/livro-caixa/contas/saldos")
      .then(d => { setSaldos(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Fecha ao clicar fora
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute", zIndex: 9999, top: "100%", left: 0,
        background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 220, maxWidth: 280,
        padding: "6px 0", marginTop: 2,
      }}
    >
      <div style={{ padding: "6px 12px 4px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Saldos disponíveis
      </div>
      {loading && <div style={{ padding: "8px 12px", fontSize: 13, color: "#94a3b8" }}>Carregando...</div>}
      {!loading && saldos.length === 0 && <div style={{ padding: "8px 12px", fontSize: 13, color: "#94a3b8" }}>Nenhuma conta</div>}
      {saldos.map(c => {
        const positivo = c.saldo >= 0;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", padding: "7px 12px", border: "none", background: "none",
              cursor: "pointer", fontSize: 13, textAlign: "left", gap: 8,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
            onMouseLeave={e => e.currentTarget.style.background = "none"}
          >
            <span style={{ color: "#1e293b", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.nome}
            </span>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: positivo ? "#15803d" : "#b91c1c" }}>
              {positivo ? "" : "−"} R$ {Math.abs(c.saldo / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function LancamentosTable({ lancamentos, onDefinirConta, onRefresh, onEditar, onExcluir, isAdmin = false, contas = [] }) {
  const { addToast } = useToast();
  const [confirmarModal, setConfirmarModal] = useState(null); // { id, dataStr, contaId }
  const [contaPopover, setContaPopover] = useState(null); // lancamentoId

  function abrirConfirmar(lancamento) {
    const hoje = new Date().toISOString().slice(0, 10);
    setConfirmarModal({
      id: lancamento.id,
      dataStr: hoje,
      contaId: lancamento.contaId ? String(lancamento.contaId) : "",
      nomeItem: lancamento.clienteFornecedor || lancamento.historico || "",
    });
  }

  async function handleSelecionarConta(lancamentoId, contaId) {
    setContaPopover(null);
    try {
      await apiFetch(`/livro-caixa/lancamentos/${lancamentoId}/atribuir-conta`, {
        method: "PATCH",
        body: { contaId },
      });
      addToast("Conta atribuída!", "success");
      if (typeof onRefresh === "function") onRefresh();
    } catch (err) {
      addToast(err?.message || "Erro ao atribuir conta", "error");
    }
  }

  async function submitConfirmar() {
    if (!confirmarModal) return;
    const { id, dataStr, contaId } = confirmarModal;
    if (!dataStr) { addToast("Informe a data.", "warning"); return; }
    setConfirmarModal(null);
    try {
      await apiFetch(`/livro-caixa/lancamentos/${id}/confirmar`, {
        method: "PATCH",
        body: { dataRecebimento: dataStr, contaId: contaId ? Number(contaId) : null },
      });
      addToast("Lançamento confirmado!", "success");
      if (typeof onRefresh === "function") onRefresh();
    } catch (err) {
      addToast(err?.message || "Erro ao confirmar lançamento", "error");
    }
  }

  if (!lancamentos || lancamentos.length === 0) {
    return <EmptyState icon="📒" title="Nenhum lançamento encontrado." />;
  }

  // ✅ Calcular saldo acumulado (apenas para lançamentos EFETIVADOS)
  let saldoAcumulado = 0;

  return (
    <>
    {/* Modal: confirmar lançamento */}
    {confirmarModal && (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          background: "#fff", borderRadius: 12, padding: "24px 28px",
          width: 380, boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Confirmar lançamento</div>
          {confirmarModal.nomeItem && (
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 14 }}>
              {confirmarModal.nomeItem}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
              Data de recebimento / pagamento
            </label>
            <input
              type="date"
              value={confirmarModal.dataStr}
              onChange={e => setConfirmarModal(m => ({ ...m, dataStr: e.target.value }))}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8,
                border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
              Conta bancária / local
            </label>
            <select
              value={confirmarModal.contaId}
              onChange={e => setConfirmarModal(m => ({ ...m, contaId: e.target.value }))}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8,
                border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box",
                background: "#fff",
              }}
            >
              <option value="">— Sem conta (definir depois) —</option>
              {contas.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={() => setConfirmarModal(null)}
              style={{
                padding: "7px 18px", borderRadius: 8, border: "1px solid #d1d5db",
                background: "#f8fafc", fontSize: 13, cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={submitConfirmar}
              disabled={!confirmarModal.dataStr}
              style={{
                padding: "7px 18px", borderRadius: 8, border: "none",
                background: "#16a34a", color: "#fff", fontSize: 13,
                fontWeight: 600, cursor: confirmarModal.dataStr ? "pointer" : "not-allowed",
              }}
            >
              ✓ Confirmar
            </button>
          </div>
        </div>
      </div>
    )}
    <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#fafafa" }}>
            <th style={th}>Data</th>
            <th style={th}>NFS-e/NF/CF/RC</th>
            <th style={th}>E/S</th>
            <th style={th}>Cliente/Fornecedor</th>
            <th style={th}>Histórico</th>
            <th style={th}>Valor</th>
            <th style={th}>Local</th>
            <th style={th}>Origem</th>
            <th style={th}>Status</th>
            <th style={th}>Saldo</th>
            <th style={th}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {lancamentos.map((l) => {
            const isPendente = l.status === "PENDENTE_CONTA";
            const isEntrada = l.es === "E";
            const isSaldoVirtual = l._virtualSaldo === true;
            const isPrevisto = l.statusFluxo === "PREVISTO";
            const isEfetivado = l.statusFluxo === "EFETIVADO";
            const isLiquidado = l.statusFluxo === "LIQUIDADO";
            const isCancelado = l.statusFluxo === "CANCELADO";
            // ✅ Atualiza saldo SOMENTE para lançamentos EFETIVADOS
            if (isSaldoVirtual) {
              // Linha do saldo anterior - inicializa o acumulador
              saldoAcumulado = Number(l.valorCentavos || 0);
            } else if (isEfetivado) {
              // Lançamentos efetivados influenciam o saldo
              const valor = Number(l.valorCentavos || 0);
              if (isEntrada) {
                saldoAcumulado += valor;
              } else {
                saldoAcumulado -= valor;
              }
            }

            return (
              <tr
                key={l.id}
                style={{
                  background: isSaldoVirtual
                    ? "#f8fafc"
                    : isPrevisto
                    ? "#fef9c3"
                    : isLiquidado
                    ? "#f0fdf4"
                    : isCancelado
                    ? "#f8fafc"
                    : isPendente
                    ? "#fffbeb"
                    : "#fff",
                  borderLeft: isSaldoVirtual
                    ? "3px solid #64748b"
                    : isPrevisto
                    ? "3px solid #eab308"
                    : isLiquidado
                    ? "3px solid #16a34a"
                    : isCancelado
                    ? "3px solid #94a3b8"
                    : isPendente
                    ? "3px solid #f59e0b"
                    : "3px solid transparent",
                  fontWeight: isSaldoVirtual ? 600 : "normal",
                  opacity: isCancelado ? 0.65 : 1,
                }}
              >
                <td style={td}>{formatDate(l.data)}</td>

                {/* ✅ Coluna NFS-e editável para entradas tributadas */}
                <td style={td}>
                  {isSaldoVirtual ? (
                    "—"
                  ) : isEntrada ? (
                    <input
                      type="text"
                      placeholder="NFS-e"
                      defaultValue={l.documento || ""}
                      onBlur={async (e) => {
                        const novoDoc = e.target.value.trim();
                        if (novoDoc === (l.documento || "")) return;

                        try {
                          await apiFetch(`/livro-caixa/lancamentos/${l.id}/documento`, {
                            method: "PUT",
                            body: JSON.stringify({ documento: novoDoc || null }),
                          });

                          addToast("Documento atualizado!", "success");

                          if (typeof onRefresh === "function") {
                            onRefresh();
                          }
                        } catch (err) {
                          console.error("Erro ao atualizar documento:", err);
                          addToast("Erro ao atualizar documento", "error");
                        }
                      }}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 13,
                        width: "100%",
                        maxWidth: 180,
                        fontFamily: "inherit",
                        background: isPrevisto ? "#fef9c3" : "#fff",
                      }}
                    />
                  ) : (
                    l.documento || "—"
                  )}
                </td>

                <td style={td}>
                  {isSaldoVirtual ? (
                    "—"
                  ) : (
                    <Tooltip content={isEntrada ? "Entrada (receita)" : "Saída (despesa)"}>
                      <span
                        style={{
                          fontWeight: 700,
                          color: isEntrada ? "#15803d" : "#b91c1c",
                          cursor: "help",
                        }}
                      >
                        {l.es}
                      </span>
                    </Tooltip>
                  )}
                </td>
                
                <td
                  style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}
                  title={isSaldoVirtual ? undefined : l.clienteFornecedor || undefined}
                >
                  {isSaldoVirtual ? "—" : l.clienteFornecedor || "—"}
                </td>

                <td
                  style={{
                    ...td,
                    maxWidth: 260,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontStyle: isSaldoVirtual ? "italic" : "normal",
                    color: isSaldoVirtual ? "#334155" : isPrevisto ? "#854d0e" : "inherit",
                  }}
                  title={l.historico ? (l.historico + (isPrevisto ? " (previsão)" : "")) : undefined}
                >
                  {l.historico}
                  {isPrevisto ? " (previsão)" : ""}
                </td>
                
                <td
                  style={{
                    ...td,
                    textAlign: "right",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: isPrevisto
                      ? "#854d0e"
                      : isEntrada
                      ? "#15803d"
                      : "#b91c1c",
                  }}
                >
                  {isSaldoVirtual ? "—" : centsToBRL(l.valorCentavos)}
                </td>
                
                <td
                  style={{ ...td, maxWidth: 150, position: "relative" }}
                >
                  {isSaldoVirtual ? "—" : (
                    <button
                      onClick={() => !isEfetivado && setContaPopover(contaPopover === l.id ? null : l.id)}
                      title={isEfetivado ? "Lançamento efetivado — conta não pode ser alterada" : "Clique para ver saldos e atribuir conta"}
                      disabled={isEfetivado}
                      style={{
                        background: "none", border: "none", padding: "2px 4px",
                        cursor: "pointer", borderRadius: 4, display: "flex",
                        alignItems: "center", gap: 4, maxWidth: 140,
                        color: l.conta?.nome || l.localLabelFallback ? "#1e293b" : "#94a3b8",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f1f5f9"}
                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                        {l.conta?.nome || l.localLabelFallback || "—"}
                      </span>
                      <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>▼</span>
                    </button>
                  )}
                  {contaPopover === l.id && (
                    <ContasSaldoPopover
                      lancamentoId={l.id}
                      onSelect={contaId => handleSelecionarConta(l.id, contaId)}
                      onClose={() => setContaPopover(null)}
                    />
                  )}
                </td>
                
                <td style={td}>
                  {isSaldoVirtual ? (
                    "—"
                  ) : (
                    <Tooltip content={`Origem: ${l.origem}`}>
                      {getOrigemBadge(l.origem)}
                    </Tooltip>
                  )}
                </td>
                
                <td style={td}>
                  {isSaldoVirtual ? (
                    "—"
                  ) : (
                    <Tooltip
                      content={
                        isPrevisto
                          ? "Lançamento previsto (não afeta o saldo)"
                          : isLiquidado
                          ? "Recebido fora do prazo — veja Vencidos em Aberto"
                          : isCancelado
                          ? "Cancelado — definitivamente não ocorrerá"
                          : isPendente
                          ? "Aguardando definição de conta"
                          : "Lançamento completo"
                      }
                    >
                      {isPrevisto ? (
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 6,
                          fontSize: 11, fontWeight: 600, background: "#fff7ed", color: "#fb923c",
                        }}>
                          📅 Previsto
                        </span>
                      ) : isLiquidado ? (
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 6,
                          fontSize: 11, fontWeight: 600, background: "#dcfce7", color: "#15803d",
                        }}>
                          ✓ Liquidado
                        </span>
                      ) : isCancelado ? (
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 6,
                          fontSize: 11, fontWeight: 600, background: "#f1f5f9", color: "#64748b",
                        }}>
                          ✗ Cancelado
                        </span>
                      ) : (
                        getStatusBadge(l.status)
                      )}
                    </Tooltip>
                  )}
                </td>
                
                <td
                  style={{
                    ...td,
                    textAlign: "right",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: (isPrevisto || isLiquidado || isCancelado) ? "#854d0e" : "#0f172a",
                  }}
                >
                  {(isPrevisto || isLiquidado || isCancelado) ? "—" : centsToBRL(saldoAcumulado)}
                </td>
                
                {/* ✅ Coluna de Ações */}
                <td style={td}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {isSaldoVirtual ? (
                      <span style={{ opacity: 0.4 }}>—</span>
                    ) : (
                      <>
                        {/* Confirmar para PREVISTO */}
                        {isPrevisto && (
                          <Tooltip content="Confirmar este lançamento">
                            <button
                              onClick={() => abrirConfirmar(l)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 6,
                                border: "1px solid #16a34a",
                                background: "#dcfce7",
                                color: "#166534",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              ✓ Confirmar
                            </button>
                          </Tooltip>
                        )}

                        {/* Definir conta para PENDENTE */}
                        {isPendente && (
                          <Tooltip content="Definir a conta deste lançamento">
                            <button
                              onClick={() => onDefinirConta(l.id)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 6,
                                border: "1px solid #f59e0b",
                                background: "#fef3c7",
                                color: "#92400e",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Definir conta
                            </button>
                          </Tooltip>
                        )}

                        {/* Editar */}
                        {typeof onEditar === "function" && (
                          <Tooltip content="Editar este lançamento">
                            <button
                              onClick={() => onEditar(l)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 6,
                                border: "1px solid #3b82f6",
                                background: "#dbeafe",
                                color: "#1e40af",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              ✏️ Editar
                            </button>
                          </Tooltip>
                        )}

                        {/* Excluir (somente admin) */}
                        {isAdmin && typeof onExcluir === "function" && (
                          <Tooltip content="Excluir este lançamento">
                            <button
                              onClick={() => onExcluir(l)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 6,
                                border: "1px solid #ef4444",
                                background: "#fee2e2",
                                color: "#b91c1c",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              🗑️ Excluir
                            </button>
                          </Tooltip>
                        )}

                        {/* Mostrar — se não tem nenhuma ação */}
                        {!isPrevisto && !isPendente && l.origem !== "MANUAL" && (
                          <span style={{ opacity: 0.4 }}>—</span>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

const th = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  fontWeight: 600,
  whiteSpace: "nowrap",
  fontSize: 12,
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};
