// src/pages/RepassesRealizados.jsx - VERSÃO CORRIGIDA
import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

function monthOptions() {
  return [
    { v: 1, t: "Jan" }, { v: 2, t: "Fev" }, { v: 3, t: "Mar" }, { v: 4, t: "Abr" },
    { v: 5, t: "Mai" }, { v: 6, t: "Jun" }, { v: 7, t: "Jul" }, { v: 8, t: "Ago" },
    { v: 9, t: "Set" }, { v: 10, t: "Out" }, { v: 11, t: "Nov" }, { v: 12, t: "Dez" },
  ];
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function brMonthYear(ano, mes) {
  if (!ano || !mes) return "—";
  return `${String(mes).padStart(2, "0")}/${ano}`;
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

export default function RepassesRealizadosPage() {
  const { addToast } = useToast();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // modal lançamentos
  const [openLanc, setOpenLanc] = useState(false);
  const [lancLoading, setLancLoading] = useState(false);
  const [lancErr, setLancErr] = useState("");
  const [lanc, setLanc] = useState([]);
  const [lancMeta, setLancMeta] = useState(null);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await apiFetch(`/repasses/realizados?ano=${ano}&mes=${mes}`);
      console.log('📊 Repasses realizados:', res);
      setData(res);
    } catch (e) {
      const msg = e?.message || "Erro ao carregar.";
      setErr(msg);
      addToast(msg, "error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  async function openLancamentos(repassePagamentoId) {
    setOpenLanc(true);
    setLancLoading(true);
    setLancErr("");
    setLanc([]);
    setLancMeta(null);
    try {
      const res = await apiFetch(`/repasses/pagamentos/${repassePagamentoId}/lancamentos`);
      setLanc(res?.lancamentos || []);
      setLancMeta(res?.meta || null);
    } catch (e) {
      const msg = e?.message || "Erro ao carregar lançamentos.";
      setLancErr(msg);
      addToast(msg, "error");
    } finally {
      setLancLoading(false);
    }
  }

  const rows = Array.isArray(data?.items) ? data.items : [];

  return (
    <div style={{ padding: 16 }}>
      <div style={card}>
        <div style={header}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Repasses — Realizados</h2>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ opacity: 0.8 }}>Competência:</span>
            <span style={pill}>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={pillSelect}>
                {monthOptions().map((m) => (
                  <option key={m.v} value={m.v}>{m.t}</option>
                ))}
              </select>
              <input
                type="number"
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                style={pillYear}
              />
            </span>
          </div>
        </div>

        {err ? <div style={errBox}>{err}</div> : null}

        <div style={{ padding: "0 12px 12px" }}>
          {loading ? <div>Carregando…</div> : null}

          {!loading && (
            <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr style={{ background: "#f6f6f6" }}>
                    <th style={th}>Referência (M-1)</th>
                    <th style={th}>Data do Repasse</th>
                    <th style={th}>Advogado</th>
                    <th style={th}>OAB</th>
                    <th style={thNum}>Valor Previsto</th>
                    <th style={thNum}>Valor Efetivado</th>
                    <th style={thNum}>Saldo gerado</th>
                    <th style={th}>Parcelas</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>
                        <button style={linkBtn} onClick={() => openLancamentos(r.id)}>
                          {brMonthYear(r.referenciaAno, r.referenciaMes)}
                        </button>
                      </td>
                      <td style={td}>{brDate(r.dataRepasse)}</td>
                      <td style={td}>
                        <button style={linkBtn} onClick={() => openLancamentos(r.id)}>
                          {r.advogadoNome}
                        </button>
                      </td>
                      <td style={td}>{r.advogadoOab || "—"}</td>
                      <td style={tdNum}>{money(r.valorPrevisto)}</td>
                      <td style={tdNum}>
                        <button style={linkBtnValue} onClick={() => openLancamentos(r.id)}>
                          {money(r.valorEfetivado)}
                        </button>
                      </td>
                      <td style={tdNum}>{money(r.saldoGerado || 0)}</td>
                      <td style={td}>{r.quantidadeParcelas}</td>
                    </tr>
                  ))}

                  {!rows.length ? (
                    <tr>
                      <td style={{ ...td, padding: 14, opacity: 0.8 }} colSpan={8}>Nenhum repasse realizado.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* MODAL LANÇAMENTOS */}
      <Modal
        open={openLanc}
        title={lancMeta?.titulo || "Lançamentos do Repasse"}
        onClose={() => setOpenLanc(false)}
        footer={<button style={secondaryBtn} onClick={() => setOpenLanc(false)}>Fechar</button>}
      >
        {lancLoading ? <div>Carregando…</div> : null}
        {lancErr ? <div style={errBox}>{lancErr}</div> : null}

        {!lancLoading && !lancErr && lancMeta && (
          <div style={{ marginBottom: 16, padding: 12, background: "#f8fafc", borderRadius: 8 }}>
            <div><strong>Competência:</strong> {lancMeta.competencia}</div>
            <div><strong>Referência:</strong> {lancMeta.referencia}</div>
            <div><strong>Data Repasse:</strong> {brDate(lancMeta.dataRepasse)}</div>
            <div><strong>Valor Previsto:</strong> {money(lancMeta.valorPrevisto)}</div>
            <div><strong>Valor Efetivado:</strong> {money(lancMeta.valorEfetivado)}</div>
          </div>
        )}

        {!lancLoading && !lancErr && (
          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={th}>Contrato</th>
                  <th style={th}>Cliente</th>
                  <th style={th}>Parcela</th>
                  <th style={th}>Data Receb.</th>
                  <th style={thNum}>Líquido</th>
                  <th style={thNum}>%</th>
                  <th style={thNum}>Repasse</th>
                </tr>
              </thead>
              <tbody>
                {(lanc || []).map((l, idx) => (
                  <tr key={idx}>
                    <td style={td}>{l.numeroContrato}</td>
                    <td style={td}>{l.clienteNome}</td>
                    <td style={td}>{l.parcelaNumero}</td>
                    <td style={td}>{brDate(l.dataRecebimento)}</td>
                    <td style={tdNum}>{money(l.liquido)}</td>
                    <td style={tdNum}>{(Number(l.percentualBp || 0) / 100).toFixed(2)}%</td>
                    <td style={tdNum}>{money(l.valorRepasse)}</td>
                  </tr>
                ))}

                {!lanc?.length ? (
                  <tr>
                    <td style={{ ...td, padding: 14, opacity: 0.8 }} colSpan={7}>Sem lançamentos.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

const card = { border: "1px solid #ddd", borderRadius: 8, background: "#fff" };
const header = { padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const errBox = { margin: "0 12px 12px", padding: 10, background: "#fee", border: "1px solid #f99", borderRadius: 8 };

const th = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #ddd", fontSize: 12 };
const thNum = { ...th, textAlign: "right" };
const td = { padding: "10px 8px", borderBottom: "1px solid #eee", fontSize: 13 };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const pill = { display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#f8fafc", fontSize: 12, fontWeight: 600 };
const pillSelect = { border: "none", background: "transparent" };
const pillYear = { width: 84, border: "none", background: "transparent", fontWeight: 600 };

const linkBtn = { border: "none", background: "transparent", padding: 0, color: "#0f3d8a", fontWeight: 800, cursor: "pointer", textDecoration: "underline" };
const linkBtnValue = { ...linkBtn, fontVariantNumeric: "tabular-nums" };
const secondaryBtn = { border: "1px solid #cbd5e1", background: "#fff", color: "#0f172a", padding: "8px 10px", borderRadius: 8, fontWeight: 800, cursor: "pointer" };

const backdrop = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, zIndex: 9999 };
const modal = { width: "min(920px, 100%)", background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 20px 80px rgba(0,0,0,0.25)", overflow: "hidden", maxHeight: "90vh", display: "flex", flexDirection: "column" };
const modalHeader = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid #e5e7eb", background: "#f8fafc" };
const modalBody = { padding: 14, overflowY: "auto", flex: 1 };
const modalFooter = { padding: 14, borderTop: "1px solid #e5e7eb", background: "#fff" };
const xBtn = { border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };