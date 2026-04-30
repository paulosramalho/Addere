import React, { useState, useEffect, useRef } from "react";
import { apiFetch, getUser } from "../lib/api";

function useLockClock() {
  const [display, setDisplay] = useState({ hora: "", data: "" });
  useEffect(() => {
    function tick() {
      const now = new Date();
      setDisplay({
        hora: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        data: now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }),
      });
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return display;
}

function useMercadoLock() {
  const [data,    setData]    = useState(null);
  const [mLoad,   setMLoad]   = useState(true);
  const [mErro,   setMErro]   = useState(false);
  useEffect(() => {
    async function load() {
      setMLoad(true);
      setMErro(false);
      try {
        setData(await apiFetch("/mercado"));
      } catch {
        setMErro(true);
      } finally {
        setMLoad(false);
      }
    }
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  return { data, mLoad, mErro };
}

function getInitials(nome) {
  if (!nome) return "?";
  const parts = nome.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function nm(v, dec = 2) {
  const num = Number(v);
  if (!isFinite(num)) return "—";
  return num.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function MiniIndexTile({ flag, label, price, change, changePct }) {
  const up = Number(change) >= 0;
  const color = up ? "#4ade80" : "#f87171";
  return (
    <div style={{
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderTop: `2px solid ${color}`,
      borderRadius: 8, padding: "8px 12px",
      minWidth: 110, flex: "0 0 auto",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
        <span style={{ fontSize: 11 }}>{flag}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "white", marginBottom: 2 }}>
        {price != null ? nm(price, price >= 10000 ? 0 : 2) : "—"}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color }}>
        {up ? "▲" : "▼"} {changePct != null ? nm(Math.abs(Number(changePct))) : "—"}%
      </div>
    </div>
  );
}

function MiniForexTile({ label, bid, pctChange }) {
  const up = Number(pctChange) >= 0;
  const color = up ? "#f87171" : "#4ade80"; // moeda subindo = ruim para BRL
  return (
    <div style={{
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderTop: `2px solid ${color}`,
      borderRadius: 8, padding: "8px 12px",
      minWidth: 100, flex: "0 0 auto",
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>
        {label} / BRL
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "white", marginBottom: 2 }}>
        R$ {bid != null ? nm(bid) : "—"}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color }}>
        {up ? "▲" : "▼"} {pctChange != null ? nm(Math.abs(Number(pctChange))) : "—"}%
      </div>
    </div>
  );
}

export default function LockScreen({ onUnlock }) {
  const [senha,   setSenha]   = useState("");
  const [erroSenha, setErroSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const clock    = useLockClock();
  const user     = getUser();
  const { data: mercado, mLoad, mErro } = useMercadoLock();

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function block(e) {
      if (e.ctrlKey || e.metaKey) e.stopPropagation();
    }
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, []);

  async function handleUnlock(e) {
    e.preventDefault();
    if (!senha) { setErroSenha("Informe a senha."); return; }
    setLoading(true);
    setErroSenha("");
    try {
      const resp = await apiFetch("/auth/login", {
        method: "POST",
        body: { email: user?.email, senha },
      });
      if (!resp.token && !resp.requires2fa) throw new Error("Falha na verificação.");
      setSenha("");
      onUnlock();
    } catch {
      setErroSenha("Senha incorreta. Tente novamente.");
      setSenha("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }

  const ibov = mercado?.indices?.ibov;
  const dji  = mercado?.indices?.dji;
  const ixic = mercado?.indices?.ixic;
  const usd  = mercado?.forex?.usd;
  const eur  = mercado?.forex?.eur;

  const ibovAberto   = ibov?.marketState === "REGULAR";
  const usaAberto    = dji?.marketState === "REGULAR" || ixic?.marketState === "REGULAR";
  const pregaoAberto = ibovAberto || usaAberto;
  const temDados     = !!(ibov || dji || ixic || usd || eur);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "linear-gradient(160deg, #0a1628 0%, #1a2a4a 50%, #0d1a35 100%)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        userSelect: "none", padding: "24px 16px",
        overflowY: "auto",
      }}
    >
      <style>{`
        @keyframes lockPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.75); }
        }
      `}</style>

      {/* Relógio grande */}
      <div style={{ fontSize: 80, fontWeight: 800, color: "white", letterSpacing: -3, lineHeight: 1 }}>
        {clock.hora}
      </div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginTop: 6, marginBottom: 32, textTransform: "capitalize" }}>
        {clock.data}
      </div>

      {/* Card de desbloqueio */}
      <form
        onSubmit={handleUnlock}
        style={{
          background: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 20,
          padding: "32px 40px",
          width: 320,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          flexShrink: 0,
        }}
      >
        {/* Avatar */}
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.nome}
            style={{
              width: 64, height: 64, borderRadius: "50%",
              objectFit: "cover",
              border: "2px solid rgba(184,160,106,0.5)",
              flexShrink: 0,
            }}
          />
        ) : (
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "rgba(184,160,106,0.15)",
            border: "2px solid rgba(184,160,106,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, fontWeight: 700, color: "#b8a06a",
            flexShrink: 0,
          }}>
            {getInitials(user?.nome)}
          </div>
        )}

        <div style={{ textAlign: "center", lineHeight: 1.3 }}>
          <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>
            {user?.nome || "Usuário"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 3 }}>
            🔒 Tela bloqueada
          </div>
        </div>

        {/* Campo senha */}
        <div style={{ width: "100%" }}>
          <input
            ref={inputRef}
            type="password"
            value={senha}
            onChange={(e) => { setSenha(e.target.value); setErroSenha(""); }}
            onKeyDown={(e) => { if (e.key === "Escape") { setSenha(""); setErroSenha(""); } }}
            placeholder="Digite sua senha"
            disabled={loading}
            style={{
              width: "100%", padding: "11px 14px", boxSizing: "border-box",
              background: "rgba(255,255,255,0.07)",
              border: `1px solid ${erroSenha ? "#f87171" : "rgba(255,255,255,0.15)"}`,
              borderRadius: 10, color: "white", fontSize: 14,
              outline: "none", transition: "border-color 0.15s",
            }}
            autoComplete="current-password"
          />
          {erroSenha && (
            <div style={{ color: "#f87171", fontSize: 12, marginTop: 5, textAlign: "center" }}>
              {erroSenha}
            </div>
          )}
        </div>

        {/* Botão desbloquear */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%", padding: "11px 0",
            background: loading ? "rgba(184,160,106,0.4)" : "#b8a06a",
            border: "none", borderRadius: 10,
            color: "#0f1f3d", fontWeight: 700, fontSize: 14,
            cursor: loading ? "not-allowed" : "pointer",
            transition: "opacity 0.2s, background 0.2s",
          }}
        >
          {loading ? "Verificando..." : "Desbloquear"}
        </button>
      </form>

      {/* ── Mercado Financeiro ── */}
      <div style={{ marginTop: 24, width: "100%", maxWidth: 700, flexShrink: 0, minHeight: 60 }}>

        {/* Carregando */}
        {mLoad && !temDados && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
            Carregando mercado…
          </div>
        )}

        {/* Erro */}
        {mErro && !temDados && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 11 }}>
            Dados de mercado indisponíveis
          </div>
        )}

        {/* Dados */}
        {temDados && (
          <>
            {/* Indicador de pregão em andamento */}
            {pregaoAberto && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 7, marginBottom: 12 }}>
                <span style={{
                  display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                  background: "#4ade80",
                  animation: "lockPulse 1.8s ease-in-out infinite",
                  flexShrink: 0,
                }} />
                <span style={{ color: "#4ade80", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  Pregão em andamento
                  {ibovAberto && " · B3"}
                  {usaAberto  && " · NYSE · NASDAQ"}
                </span>
              </div>
            )}

            {/* Tiles */}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {ibov && <MiniIndexTile flag="🇧🇷" label="IBOVESPA"  price={ibov.price} change={ibov.change} changePct={ibov.changePct} />}
              {dji  && <MiniIndexTile flag="🇺🇸" label="Dow Jones" price={dji.price}  change={dji.change}  changePct={dji.changePct}  />}
              {ixic && <MiniIndexTile flag="🇺🇸" label="Nasdaq"    price={ixic.price} change={ixic.change} changePct={ixic.changePct} />}
              {usd  && <MiniForexTile label="US$"   bid={usd.bid} pctChange={usd.pctChange} />}
              {eur  && <MiniForexTile label="€ EUR" bid={eur.bid} pctChange={eur.pctChange} />}
            </div>

            {/* Timestamp */}
            {mercado?.updatedAt && (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.18)", fontSize: 10, marginTop: 10 }}>
                {!pregaoAberto && "Mercado fechado · "}
                Atualizado às {new Date(mercado.updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                {mercado.cached && " · cache 5 min"}
              </div>
            )}
          </>
        )}
      </div>

      {/* Rodapé */}
      <div style={{ color: "rgba(255,255,255,0.12)", fontSize: 11, marginTop: 24, letterSpacing: 1 }}>
        Addere CONTROLES · ACESSO RESTRITO
      </div>
    </div>
  );
}
