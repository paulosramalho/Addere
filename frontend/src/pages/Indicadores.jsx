import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { centsToBRL } from "../lib/formatters";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v, max) { return max > 0 ? Math.max((v / max) * 100, 1) : 0; }

function fmt(cents) { return centsToBRL(cents); }

// ── Componentes de gráfico (CSS puro, sem biblioteca) ─────────────────────────

/** Gráfico de barras vertical com duas séries (confirmada + prevista) — barras clicáveis */
function BarDual({ data, h = 140, onClickRecebida, onClickPrevista }) {
  const max = Math.max(...data.map(d => Math.max(d.confirmadaCentavos, d.previstaCentavos)), 1);

  const barStyle = (bg, height, clickable) => ({
    width: 14, background: bg,
    height: `${height}%`,
    borderRadius: "3px 3px 0 0",
    cursor: clickable ? "pointer" : "default",
    transition: "height 0.4s, opacity 0.15s",
    flexShrink: 0,
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, minWidth: 520, height: h + 40, paddingBottom: 32 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 40 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: h }}>
              {/* Recebida */}
              <div
                title={`Recebida ${d.label}: ${fmt(d.confirmadaCentavos)} — clique para detalhar`}
                style={barStyle("#1e3a5f", pct(d.confirmadaCentavos, max), !!onClickRecebida && d.confirmadaCentavos > 0)}
                onClick={() => d.confirmadaCentavos > 0 && onClickRecebida?.(d)}
                onMouseEnter={e => { if (d.confirmadaCentavos > 0 && onClickRecebida) e.currentTarget.style.opacity = "0.75"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
              />
              {/* Prevista */}
              <div
                title={`Prevista ${d.label}: ${fmt(d.previstaCentavos)} — clique para detalhar`}
                style={barStyle("#93c5fd", pct(d.previstaCentavos, max), !!onClickPrevista && d.previstaCentavos > 0)}
                onClick={() => d.previstaCentavos > 0 && onClickPrevista?.(d)}
                onMouseEnter={e => { if (d.previstaCentavos > 0 && onClickPrevista) e.currentTarget.style.opacity = "0.75"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
              />
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, textAlign: "center" }}>{d.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: -20 }}>
        <LegendDot color="#1e3a5f" label="Recebida (clique para detalhar)" />
        <LegendDot color="#93c5fd" label="Prevista (clique para detalhar)" />
      </div>
    </div>
  );
}

/** Gráfico de barras vertical simples */
function Bar({ data, valueKey, labelKey, color = "#1e3a5f", formatValue = fmt, h = 120 }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, minWidth: Math.max(data.length * 44, 300), height: h + 32, paddingBottom: 28 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 36 }}>
            <div
              title={`${d[labelKey]}: ${formatValue(d[valueKey] || 0)}`}
              style={{
                width: "70%", background: color,
                height: `${pct(d[valueKey] || 0, max)}%`,
                maxHeight: h, minHeight: 2,
                borderRadius: "3px 3px 0 0", cursor: "default",
                transition: "height 0.4s",
              }}
            />
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, textAlign: "center" }}>{d[labelKey]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barras horizontais para rankings */
function HBar({ data, valueKey, labelKey, color = "#1e3a5f", formatValue = fmt }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 130, fontSize: 12, color: "#374151", textAlign: "right",
            flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={d[labelKey]}>
            {d[labelKey]}
          </div>
          <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 4, height: 18, overflow: "hidden" }}>
            <div style={{
              width: `${pct(d[valueKey] || 0, max)}%`,
              background: color, height: "100%",
              borderRadius: 4, transition: "width 0.4s",
            }} />
          </div>
          <div style={{ width: 90, fontSize: 12, color: "#374151", flexShrink: 0, textAlign: "right" }}>
            {formatValue(d[valueKey] || 0)}
          </div>
        </div>
      ))}
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

// ── Cards KPI ─────────────────────────────────────────────────────────────────

const CARD_COLORS = {
  blue:   { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af" },
  green:  { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
  amber:  { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
  red:    { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
  purple: { bg: "#faf5ff", border: "#e9d5ff", text: "#6b21a8" },
  slate:  { bg: "#f8fafc", border: "#e2e8f0", text: "#334155" },
};

function KpiCard({ title, value, sub, color = "blue" }) {
  const c = CARD_COLORS[color];
  return (
    <div style={{
      background: c.bg, border: `2px solid ${c.border}`,
      borderRadius: 12, padding: "16px 20px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: c.text, opacity: 0.75, letterSpacing: "0.5px" }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: c.text, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: c.text, opacity: 0.65, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Seção com título ──────────────────────────────────────────────────────────

function Section({ title, children, cols = 1 }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px",
        color: "#64748b", borderBottom: "2px solid #e2e8f0", paddingBottom: 8, marginBottom: 20,
      }}>
        {title}
      </div>
      {cols > 1
        ? <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 20 }}>{children}</div>
        : children}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0",
      borderRadius: 12, padding: 20,
    }}>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 16 }}>{title}</div>}
      {children}
    </div>
  );
}

// ── Status label ──────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  ATIVO: "Ativo", ARQUIVADO: "Arquivado", ENCERRADO: "Encerrado",
  SUSPENSO: "Suspenso", AGUARDANDO: "Aguardando",
};
const STATUS_COLORS = {
  ATIVO: "#22c55e", ARQUIVADO: "#94a3b8", ENCERRADO: "#64748b",
  SUSPENSO: "#f59e0b", AGUARDANDO: "#3b82f6",
};

const TRIB_LABELS = {
  tjpa:"TJPA", tjsp:"TJSP", tjam:"TJAM", tjrj:"TJRJ", tjmg:"TJMG", tjrs:"TJRS",
  tjpr:"TJPR", tjsc:"TJSC", tjba:"TJBA", tjce:"TJCE", tjpe:"TJPE", tjgo:"TJGO",
  tjms:"TJMS", tjmt:"TJMT", tjrn:"TJRN", tjal:"TJAL", tjse:"TJSE", tjpi:"TJPI",
  tjma:"TJMA", tjpb:"TJPB", tjes:"TJES", tjto:"TJTO", tjro:"TJRO", tjrr:"TJRR",
  tjac:"TJAC", tjap:"TJAP", trf1:"TRF 1ª", trf2:"TRF 2ª", trf3:"TRF 3ª",
  trf4:"TRF 4ª", trf5:"TRF 5ª",
  trt1:"TRT 1ª", trt2:"TRT 2ª", trt3:"TRT 3ª", trt4:"TRT 4ª", trt5:"TRT 5ª",
  trt6:"TRT 6ª", trt7:"TRT 7ª", trt8:"TRT 8ª", trt9:"TRT 9ª", trt10:"TRT 10ª",
  trt11:"TRT 11ª", trt12:"TRT 12ª", trt13:"TRT 13ª", trt14:"TRT 14ª", trt15:"TRT 15ª",
  trt16:"TRT 16ª", trt17:"TRT 17ª", trt18:"TRT 18ª", trt19:"TRT 19ª", trt20:"TRT 20ª",
  trt21:"TRT 21ª", trt22:"TRT 22ª", trt23:"TRT 23ª", trt24:"TRT 24ª",
  stj:"STJ", stf:"STF", tst:"TST",
  extrajudicial:"Extrajudicial",
};

// ── Página principal ──────────────────────────────────────────────────────────

export default function Indicadores({ user }) {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Modal detalhe de parcelas
  const [modal, setModal] = useState(null); // { mes, ano, label, tipo: "recebida"|"prevista" }
  const [modalData, setModalData] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);

  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    setErr("");
    apiFetch(`/indicadores?ano=${ano}`)
      .then(setData)
      .catch(e => setErr(e?.message || "Erro ao carregar indicadores"))
      .finally(() => setLoading(false));
  }, [ano]); // eslint-disable-line react-hooks/exhaustive-deps

  function abrirModal(d, tipo) {
    setModal({ mes: d.mes, ano: d.ano, label: d.label, tipo });
    setModalData(null);
    setModalLoading(true);
    apiFetch(`/indicadores/parcelas?ano=${d.ano}&mes=${d.mes}&tipo=${tipo}`)
      .then(setModalData)
      .catch(() => setModalData({ parcelas: [], totalRecebidoC: 0, totalPrevistoC: 0 }))
      .finally(() => setModalLoading(false));
  }

  useEffect(() => {
    if (!modal) return;
    const onKey = e => { if (e.key === "Escape") setModal(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 24, color: "#991b1b" }}>
          Acesso restrito a administradores.
        </div>
      </div>
    );
  }

  const anos = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div style={{ padding: "24px 24px 48px", background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#0f172a" }}>Indicadores Gerenciais</h1>
            <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
              Receita = parcelas recebidas (RECEBIDA) — exclui transferências, alvarás e fundos de terceiros
            </p>
          </div>
          <select
            value={ano}
            onChange={e => setAno(Number(e.target.value))}
            style={{ padding: "8px 14px", border: "2px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontWeight: 500, background: "#fff" }}
          >
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16, marginBottom: 32 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{ height: 100, background: "#e2e8f0", borderRadius: 12, animation: "pulse 1.5s infinite" }} />
            ))}
          </div>
        )}

        {err && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 20, color: "#991b1b", marginBottom: 24 }}>
            {err}
          </div>
        )}

        {data && !loading && (() => {
          const s = data.sumario;
          const inad = s.inadimplencia;

          return (
            <>
              {/* ── KPIs ──────────────────────────────────────────────────── */}
              <Section title={`Resumo ${ano}`} cols={3}>
                <KpiCard
                  color="blue"
                  title="Receita confirmada"
                  value={fmt(s.receitaAnoCentavos)}
                  sub={`+ ${fmt(s.previstaTotalCentavos)} previsto a receber`}
                />
                <KpiCard
                  color={inad.taxa > 10 ? "red" : inad.taxa > 5 ? "amber" : "green"}
                  title="Inadimplência"
                  value={`${inad.taxa.toFixed(1)}%`}
                  sub={`${fmt(inad.valorCentavos)} · ${inad.clientesCount} cliente(s) · ${inad.parcelasCount} parcela(s)`}
                />
                <KpiCard
                  color="slate"
                  title="Contratos"
                  value={s.contratosAtivos}
                  sub={`+ ${s.contratosEncerrados} encerrado(s)`}
                />
                <KpiCard
                  color="purple"
                  title="Processos ativos"
                  value={s.processosAtivos}
                  sub={`de ${s.totalProcessos} total`}
                />
                <KpiCard
                  color="green"
                  title="Novos clientes"
                  value={data.novosClientesMensal.reduce((s, m) => s + m.count, 0)}
                  sub={`cadastrados em ${ano}`}
                />
                <KpiCard
                  color="amber"
                  title="Andamentos recebidos"
                  value={data.andamentosPorMes.reduce((s, m) => s + m.count, 0)}
                  sub="últimos 6 meses"
                />
              </Section>

              {/* ── RECEITA ───────────────────────────────────────────────── */}
              <Section title="Receita">
                <Panel title={`Receita mensal ${ano} — clique nas barras para detalhar`}>
                  <BarDual
                    data={data.receitaMensal}
                    h={160}
                    onClickRecebida={d => abrirModal(d, "recebida")}
                    onClickPrevista={d => abrirModal(d, "prevista")}
                  />
                </Panel>
              </Section>

              {/* ── ADVOGADOS ─────────────────────────────────────────────── */}
              <Section title="Por Advogado" cols={2}>
                <Panel title={`Honorários recebidos em ${ano}`}>
                  {data.honorariosPorAdvogado.length === 0
                    ? <Empty />
                    : <HBar data={data.honorariosPorAdvogado} valueKey="totalCentavos" labelKey="nome" color="#1e3a5f" />
                  }
                </Panel>
                <Panel title={`Ticket médio por contrato em ${ano}`}>
                  {data.ticketMedio.length === 0
                    ? <Empty />
                    : <HBar data={data.ticketMedio} valueKey="ticketMedioCentavos" labelKey="nome" color="#3b82f6" />
                  }
                </Panel>
              </Section>

              {/* ── PROCESSOS ─────────────────────────────────────────────── */}
              <Section title="Processos" cols={2}>
                <Panel title="Por status">
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {data.processosPorStatus.map(r => (
                      <div key={r.status} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{
                          width: 10, height: 10, borderRadius: "50%",
                          background: STATUS_COLORS[r.status] || "#94a3b8",
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 13, color: "#374151", flex: 1 }}>
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{r.count}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel title="Por tribunal (ativos — top 10)">
                  {data.processosPorTribunal.length === 0
                    ? <Empty />
                    : <HBar
                        data={data.processosPorTribunal.map(r => ({
                          ...r,
                          nomeLabel: TRIB_LABELS[r.tribunal] || r.tribunal,
                        }))}
                        valueKey="count"
                        labelKey="nomeLabel"
                        color="#7c3aed"
                        formatValue={v => v}
                      />
                  }
                </Panel>
              </Section>

              <Section title="Processos — continuação" cols={2}>
                <Panel title="Por advogado (ativos)">
                  {data.processosPorAdvogado.length === 0
                    ? <Empty />
                    : <HBar
                        data={data.processosPorAdvogado}
                        valueKey="count"
                        labelKey="nome"
                        color="#0891b2"
                        formatValue={v => v}
                      />
                  }
                </Panel>
                <Panel title="Andamentos recebidos — últimos 6 meses">
                  <Bar
                    data={data.andamentosPorMes}
                    valueKey="count"
                    labelKey="label"
                    color="#10b981"
                    formatValue={v => v}
                    h={120}
                  />
                </Panel>
              </Section>

              {/* ── CLIENTES ──────────────────────────────────────────────── */}
              <Section title="Clientes">
                <Panel title={`Novos clientes por mês — ${ano}`}>
                  <Bar
                    data={data.novosClientesMensal}
                    valueKey="count"
                    labelKey="label"
                    color="#f59e0b"
                    formatValue={v => v}
                    h={120}
                  />
                </Panel>
              </Section>
            </>
          );
        })()}
      </div>

      {/* ── MODAL DETALHE PARCELAS ──────────────────────────────────────────── */}
      {modal && (
        <div
          onClick={() => setModal(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: "24px 16px",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 14, width: "100%", maxWidth: 940,
              maxHeight: "85vh", display: "flex", flexDirection: "column",
              boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
            }}
          >
            {/* Header */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              padding: "18px 24px", borderBottom: "1px solid #e2e8f0", gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  Parcelas — {modal.label}/{modal.ano}
                  <span style={{
                    fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                    padding: "2px 10px", borderRadius: 10,
                    background: modal.tipo === "recebida" ? "#1e3a5f" : "#bfdbfe",
                    color: modal.tipo === "recebida" ? "#fff" : "#1e40af",
                  }}>
                    {modal.tipo === "recebida" ? "Recebida" : "Prevista"}
                  </span>
                </div>
                {modalData && !modalLoading && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                    {modalData.parcelas.length} parcela(s) · Total:{" "}
                    <strong>{fmt(modal.tipo === "recebida" ? modalData.totalRecebidoC : modalData.totalPrevistoC)}</strong>
                  </div>
                )}
              </div>
              <button
                onClick={() => setModal(null)}
                style={{
                  background: "none", border: "none", fontSize: 24,
                  cursor: "pointer", color: "#94a3b8", lineHeight: 1,
                  padding: "0 4px", flexShrink: 0,
                }}
              >×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
              {modalLoading ? (
                <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>Carregando…</div>
              ) : !modalData || modalData.parcelas.length === 0 ? (
                <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>Nenhuma parcela encontrada</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 16 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                      {["Cliente","Contrato","Advogado","Vencimento","Recebimento","Meio","Valor"].map(h => (
                        <th key={h} style={{
                          textAlign: h === "Valor" ? "right" : "left",
                          padding: "8px 10px", fontWeight: 700, color: "#374151",
                          fontSize: 11, textTransform: "uppercase", letterSpacing: "0.4px",
                          whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modalData.parcelas.map((p, i) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                        <td style={{ padding: "8px 10px", color: "#0f172a", fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.cliente}>{p.cliente}</td>
                        <td style={{ padding: "8px 10px", color: "#475569", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{p.contrato}</td>
                        <td style={{ padding: "8px 10px", color: "#475569", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.advogado}>{p.advogado}</td>
                        <td style={{ padding: "8px 10px", color: "#475569", whiteSpace: "nowrap" }}>
                          {p.vencimento ? new Date(p.vencimento).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—"}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#475569", whiteSpace: "nowrap" }}>
                          {p.dataRecebimento ? new Date(p.dataRecebimento).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—"}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#475569", whiteSpace: "nowrap" }}>{p.meioRecebimento}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap" }}>
                          {fmt(modal.tipo === "recebida" ? (p.valorRecebidoC ?? p.valorPrevistoC) : p.valorPrevistoC)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                      <td colSpan={6} style={{ padding: "10px 10px", fontWeight: 700, color: "#374151", textAlign: "right", fontSize: 13 }}>Total</td>
                      <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
                        {fmt(modal.tipo === "recebida" ? modalData.totalRecebidoC : modalData.totalPrevistoC)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Sem dados para o período</div>;
}
