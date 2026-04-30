import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/api";

const REFRESH_MS = 5 * 60 * 1000; // 5 min

function n(v, dec = 2) {
  const num = Number(v);
  if (!isFinite(num)) return "—";
  return num.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function BolsaCard({ flag, label, sublabel, value, change, changePct, loading }) {
  const up = change >= 0;
  const color = up ? "#16a34a" : "#dc2626";
  const bg    = up ? "#f0fdf4" : "#fef2f2";
  return (
    <div style={{
      flex: 1, minWidth: 160, background: "#fff",
      border: "1px solid #e2e8f0", borderRadius: 10,
      borderTop: `3px solid ${color}`, padding: "12px 16px",
    }}>
      {loading ? (
        <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>Carregando…</span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 16 }}>{flag}</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>{sublabel}</div>
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
            {value != null ? n(value, value >= 10000 ? 0 : 2) : "—"}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            fontSize: 11, fontWeight: 600, color,
            background: bg, padding: "2px 7px", borderRadius: 99,
          }}>
            <span>{up ? "▲" : "▼"}</span>
            <span>{change != null ? n(Math.abs(change), change >= 100 ? 0 : 2) : "—"}</span>
            <span>({changePct != null ? n(Math.abs(changePct)) : "—"}%)</span>
          </div>
        </>
      )}
    </div>
  );
}

// mode "simple" = compra + venda + variação  |  mode "cross" = relação bidirecional + máx/mín
function CambioCard({ label, currencySymbol, buy, sell, high, low, pctChange, loading, mode = "simple" }) {
  const up = Number(pctChange) >= 0;
  const color = up ? "#dc2626" : "#16a34a"; // moeda subindo = ruim para BRL
  const bg    = up ? "#fef2f2" : "#f0fdf4";
  const inverse = buy && Number(buy) > 0 ? 1 / Number(buy) : null;
  return (
    <div style={{
      flex: 1, minWidth: 140, background: "#fff",
      border: "1px solid #e2e8f0", borderRadius: 10,
      padding: "12px 16px",
    }}>
      {loading ? (
        <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>Carregando…</span>
        </div>
      ) : mode === "simple" ? (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            {label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>
            R$ {buy != null ? n(buy) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
            Venda: R$ {sell != null ? n(sell) : "—"}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            fontSize: 11, fontWeight: 600, color,
            background: bg, padding: "2px 7px", borderRadius: 99,
          }}>
            <span>{up ? "▲" : "▼"}</span>
            <span>{pctChange != null ? n(Math.abs(Number(pctChange))) : "—"}% hoje</span>
          </div>
        </>
      ) : (
        /* mode === "cross" — relação bidirecional */
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            {label}
          </div>
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>1 {currencySymbol} =</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}> R$ {buy != null ? n(buy) : "—"}</span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>1 R$ =</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}> {currencySymbol} {inverse != null ? n(inverse, 4) : "—"}</span>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
            Máx: R$ {high != null ? n(high) : "—"} · Mín: R$ {low != null ? n(low) : "—"}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            fontSize: 11, fontWeight: 600, color,
            background: bg, padding: "2px 7px", borderRadius: 99,
          }}>
            <span>{up ? "▲" : "▼"}</span>
            <span>{pctChange != null ? n(Math.abs(Number(pctChange))) : "—"}% hoje</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function MercadoWidget() {
  const [indices, setIndices] = useState(null);
  const [forex,   setForex]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [erro, setErro] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErro(false);
    try {
      const data = await apiFetch("/mercado");
      setIndices(data.indices);
      setForex(data.forex);
      setUpdatedAt(new Date(data.updatedAt));
    } catch {
      setErro(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  const hhmm = updatedAt
    ? updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const ibov = indices?.ibov;
  const dji  = indices?.dji;
  const ixic = indices?.ixic;
  const usd  = forex?.usd;
  const eur  = forex?.eur;

  return (
    <div style={{
      background: "#f8fafc", border: "1px solid #e2e8f0",
      borderRadius: 12, padding: "16px 20px", marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>📈</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>Mercado Financeiro</span>
          {hhmm && !erro && (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>· Atualizado às {hhmm}</span>
          )}
          {erro && (
            <span style={{ fontSize: 11, color: "#dc2626" }}>· Falha ao carregar</span>
          )}
        </div>
        <button
          onClick={fetchData}
          title="Atualizar agora"
          style={{
            background: "none", border: "1px solid #e2e8f0", borderRadius: 6,
            padding: "4px 10px", fontSize: 12, color: "#64748b",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <svg style={{ width: 13, height: 13 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Atualizar
        </button>
      </div>

      {/* Bolsas */}
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Bolsas de Valores
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <BolsaCard
          flag="🇧🇷" label="IBOVESPA" sublabel="São Paulo / B3"
          value={ibov?.price}
          change={ibov?.change}
          changePct={ibov?.changePct}
          loading={loading}
        />
        <BolsaCard
          flag="🇺🇸" label="Dow Jones" sublabel="New York / NYSE"
          value={dji?.price}
          change={dji?.change}
          changePct={dji?.changePct}
          loading={loading}
        />
        <BolsaCard
          flag="🇺🇸" label="Nasdaq" sublabel="New York / NASDAQ"
          value={ixic?.price}
          change={ixic?.change}
          changePct={ixic?.changePct}
          loading={loading}
        />
      </div>

      {/* Câmbio */}
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Cotação do Dia
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <CambioCard mode="simple"
          label="US$ — Dólar Americano"
          buy={usd?.bid} sell={usd?.ask}
          pctChange={usd?.pctChange}
          loading={loading}
        />
        <CambioCard mode="simple"
          label="EU — Euro"
          buy={eur?.bid} sell={eur?.ask}
          pctChange={eur?.pctChange}
          loading={loading}
        />
        <CambioCard mode="cross"
          label="US$ × R$"
          currencySymbol="US$"
          buy={usd?.bid} sell={usd?.ask}
          high={usd?.high} low={usd?.low}
          pctChange={usd?.pctChange}
          loading={loading}
        />
        <CambioCard mode="cross"
          label="EU × R$"
          currencySymbol="€"
          buy={eur?.bid} sell={eur?.ask}
          high={eur?.high} low={eur?.low}
          pctChange={eur?.pctChange}
          loading={loading}
        />
      </div>
    </div>
  );
}
