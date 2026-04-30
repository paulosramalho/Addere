// ============================================================
// PARTE 1: PÁGINA DE CONTROLE DE SALDO
// src/pages/RepassesSaldos.jsx
// ============================================================

import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function brDate(d) {
  if (!d) return "—";
  // Append T12:00:00 to avoid timezone shift issues
  const str = String(d).includes("T") ? d : `${d}T12:00:00`;
  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

function Modal({ open, title, children, onClose, footer }) {
  if (!open) return null;
  return (
    <div style={backdrop} onMouseDown={onClose}>
      <div style={modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 800 }}>{title}</div>
          <button style={xBtn} onClick={onClose}>✕</button>
        </div>
        <div style={modalBody}>{children}</div>
        {footer ? <div style={modalFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}

export default function RepassesSaldosPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Modal de histórico
  const [openHistorico, setOpenHistorico] = useState(false);
  const [historicoData, setHistoricoData] = useState(null);
  const [historicoLoading, setHistoricoLoading] = useState(false);
  const [historicoErr, setHistoricoErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await apiFetch("/repasses/saldos");
      setData(res);
    } catch (e) {
      const msg = e?.message || "Erro ao carregar saldos.";
      setErr(msg);
      addToast(msg, "error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function abrirHistorico(advogadoId, advogadoNome) {
    setOpenHistorico(true);
    setHistoricoLoading(true);
    setHistoricoErr("");
    setHistoricoData({ advogadoNome, historico: [] });

    try {
      const res = await apiFetch(`/repasses/saldos/${advogadoId}/historico`);
      setHistoricoData({ advogadoNome, historico: res.historico || [] });
    } catch (e) {
      const msg = e?.message || "Erro ao carregar histórico.";
      setHistoricoErr(msg);
      addToast(msg, "error");
    } finally {
      setHistoricoLoading(false);
    }
  }

  const saldos = data?.saldos || [];
  const totalSaldo = data?.totalSaldo || "0.00";

  return (
    <div style={{ padding: 16 }}>
      <div style={card}>
        {/* HEADER */}
        <div style={header}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            Controle de Saldos de Repasses
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ opacity: 0.8, fontSize: 13 }}>Total Geral:</span>
            <span style={{
              padding: "6px 12px",
              borderRadius: 999,
              background: "#dcfce7",
              border: "1px solid #10b981",
              fontWeight: 800,
              color: "#065f46",
              fontSize: 14,
            }}>
              {money(totalSaldo)}
            </span>
          </div>
        </div>

        {err && <div style={errBox}>{err}</div>}

        {/* INSTRUÇÕES */}
        <div style={{
          margin: "0 12px 12px",
          padding: 12,
          background: "#e0e7ff",
          border: "1px solid #6366f1",
          borderRadius: 8,
          fontSize: 13,
        }}>
          <strong>💡 Como funciona o saldo:</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li><strong>Saldo positivo:</strong> Gerado quando o repasse efetivado é menor que o previsto</li>
            <li><strong>Usar saldo:</strong> Permite pagar mais que o previsto (limitado ao saldo disponível)</li>
            <li><strong>Histórico:</strong> Clique no nome do advogado para ver todas as movimentações</li>
          </ul>
        </div>

        {/* TABELA */}
        <div style={{ padding: "0 12px 12px" }}>
          {loading && <div>Carregando…</div>}

          {!loading && (
            <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead>
                  <tr style={{ background: "#f6f6f6" }}>
                    <th style={th}>Advogado</th>
                    <th style={th}>OAB</th>
                    <th style={thNum}>Saldo Atual</th>
                    <th style={th}>Última Atualização</th>
                    <th style={th}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {saldos.map((s) => (
                    <tr key={s.advogadoId}>
                      <td style={td}>
                        <button
                          style={linkBtn}
                          onClick={() => abrirHistorico(s.advogadoId, s.advogadoNome)}
                        >
                          {s.advogadoNome}
                        </button>
                      </td>
                      <td style={td}>{s.advogadoOab || "—"}</td>
                      <td style={{
                        ...tdNum,
                        fontWeight: 700,
                        color: Number(s.saldo) > 0 ? "#059669" : Number(s.saldo) < 0 ? "#dc2626" : "#64748b"
                      }}>
                        {money(s.saldo)}
                      </td>
                      <td style={td}>{brDate(s.ultimaAtualizacao)}</td>
                      <td style={td}>
                        <button
                          style={secondaryBtn}
                          onClick={() => abrirHistorico(s.advogadoId, s.advogadoNome)}
                        >
                          Ver Histórico
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!saldos.length && (
                    <tr>
                      <td style={{ ...td, padding: 14, opacity: 0.8 }} colSpan={5}>
                        Nenhum saldo registrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* MODAL HISTÓRICO */}
      <Modal
        open={openHistorico}
        title={`Histórico de Saldo — ${historicoData?.advogadoNome || ""}`}
        onClose={() => setOpenHistorico(false)}
        footer={
          <button style={secondaryBtn} onClick={() => setOpenHistorico(false)}>
            Fechar
          </button>
        }
      >
        {historicoLoading && <div>Carregando…</div>}
        {historicoErr && <div style={errBox}>{historicoErr}</div>}

        {!historicoLoading && !historicoErr && (
          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={th}>Data</th>
                  <th style={th}>Ref. (M-1)</th>
                  <th style={thNum}>Previsto</th>
                  <th style={thNum}>Efetivado</th>
                  <th style={thNum}>Saldo Ant.</th>
                  <th style={thNum}>Gerado</th>
                  <th style={thNum}>Consumido</th>
                  <th style={thNum}>Saldo Post.</th>
                </tr>
              </thead>
              <tbody>
                {(historicoData?.historico || []).map((h) => (
                  <tr key={h.id}>
                    <td style={td}>{brDate(h.dataRepasse)}</td>
                    <td style={td}>
                      {String(h.referencia.mes).padStart(2, "0")}/{h.referencia.ano}
                    </td>
                    <td style={tdNum}>{money(h.valorPrevisto)}</td>
                    <td style={tdNum}>{money(h.valorEfetivado)}</td>
                    <td style={tdNum}>{money(h.saldoAnterior)}</td>
                    <td style={{ ...tdNum, color: "#059669", fontWeight: 600 }}>
                      {Number(h.saldoGerado) > 0 ? `+${money(h.saldoGerado)}` : "—"}
                    </td>
                    <td style={{ ...tdNum, color: "#dc2626", fontWeight: 600 }}>
                      {Number(h.saldoConsumido) > 0 ? `-${money(h.saldoConsumido)}` : "—"}
                    </td>
                    <td style={{ ...tdNum, fontWeight: 700 }}>
                      {money(h.saldoPosterior)}
                    </td>
                  </tr>
                ))}

                {!historicoData?.historico?.length && (
                  <tr>
                    <td style={{ ...td, padding: 14, opacity: 0.8 }} colSpan={8}>
                      Nenhuma movimentação registrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}