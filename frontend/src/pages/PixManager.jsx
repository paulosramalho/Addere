// frontend/src/pages/PixManager.jsx
// Gestão de Pix (Inter/Santander): enviados + recebidos (admin only)

import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import MoneyInput from "../components/ui/MoneyInput";
import EmptyState from "../components/ui/EmptyState";

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const STATUS_LABEL = {
  PROCESSANDO:          { label: "Processando",       color: "#d97706", bg: "#fef3c7" },
  EM_APROVACAO:         { label: "Aguard. Aprovação", color: "#0369a1", bg: "#e0f2fe" },
  REALIZADO:            { label: "Realizado",          color: "#16a34a", bg: "#dcfce7" },
  DEVOLVIDO:            { label: "Devolvido",          color: "#6b7280", bg: "#f3f4f6" },
  ERRO:                 { label: "Erro",               color: "#dc2626", bg: "#fee2e2" },
  MOCK:                 { label: "Mock",               color: "#7c3aed", bg: "#ede9fe" },
};

function fmtBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL",
  });
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(String(iso).includes("T") ? iso : `${iso}T12:00:00`);
  if (isNaN(d)) return "—";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateOnly(iso) {
  if (!iso) return "—";
  const d = new Date(String(iso).includes("T") ? iso : `${iso}T12:00:00`);
  if (isNaN(d)) return "—";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function StatusBadge({ status }) {
  const cfg = STATUS_LABEL[status] || { label: status, color: "#6b7280", bg: "#f3f4f6" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 9999,
      fontSize: 12,
      fontWeight: 600,
      color: cfg.color,
      background: cfg.bg,
    }}>
      {cfg.label}
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function PixManager({ user, bank = "inter" }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const { addToast, confirmToast } = useToast();
  const bankKey = String(bank || "inter").toLowerCase();
  const isSantander = bankKey === "santander";
  const bankName = isSantander ? "Santander" : "Inter";
  const bankPixBase = isSantander ? "/santander/pix" : "/pix";

  const [aba, setAba] = useState("enviados");

  // ── Estado filtros enviados
  const [filtroStatus, setFiltroStatus]     = useState("");
  const [filtroAdvId, setFiltroAdvId]       = useState("");
  const [filtroNome, setFiltroNome]         = useState("");
  const [filtroDe, setFiltroDe]             = useState("");
  const [filtroAte, setFiltroAte]           = useState("");
  const [page, setPage]                     = useState(1);
  const [enviados, setEnviados]             = useState({ pagamentos: [], total: 0, pages: 1 });
  const [loadingEnv, setLoadingEnv]         = useState(false);

  // ── Estado recebidos
  const [recDe, setRecDe]                   = useState(new Date().toISOString().slice(0, 10));
  const [recAte, setRecAte]                 = useState(new Date().toISOString().slice(0, 10));
  const [recebidos, setRecebidos]           = useState([]);
  const [loadingRec, setLoadingRec]         = useState(false);

  // ── Dados auxiliares
  const [advogados, setAdvogados]           = useState([]);
  const [contas, setContas]                 = useState([]);

  // ── Modal enviar
  const [modalEnviar, setModalEnviar]       = useState({ open: false });
  const [sincronizando, setSincronizando]   = useState(null); // id
  const [marcandoReal, setMarcandoReal]     = useState(null); // id

  // ── Autocomplete destinatário no modal
  const [destQuery, setDestQuery]           = useState("");
  const [destClientes, setDestClientes]     = useState([]);
  const [destLoading, setDestLoading]       = useState(false);
  const [destOpen, setDestOpen]             = useState(false);
  const destDebounce                        = useRef(null);
  const destRef                             = useRef(null);

  // ── Carregar dados iniciais ───────────────────────────────────────────────

  useEffect(() => {
    apiFetch("/advogados").then(r => setAdvogados(Array.isArray(r) ? r : (r?.advogados || []))).catch(() => {});
    apiFetch("/livro-caixa/contas").then(r => setContas(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const carregarEnviados = useCallback(async () => {
    setLoadingEnv(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (filtroStatus) params.set("status", filtroStatus);
      if (filtroAdvId)  params.set("advogadoId", filtroAdvId);
      if (filtroNome)   params.set("nome", filtroNome);
      if (filtroDe)     params.set("de", filtroDe);
      if (filtroAte)    params.set("ate", filtroAte);
      const r = await apiFetch(`${bankPixBase}/pagamentos?${params}`);
      setEnviados(r);
    } catch (e) {
      addToast(e.message || "Erro ao carregar", "error");
    } finally {
      setLoadingEnv(false);
    }
  }, [bankPixBase, page, filtroStatus, filtroAdvId, filtroNome, filtroDe, filtroAte]);

  useEffect(() => { if (aba === "enviados") carregarEnviados(); }, [carregarEnviados, aba]);

  const carregarRecebidos = useCallback(async () => {
    setLoadingRec(true);
    try {
      const r = await apiFetch(`${bankPixBase}/recebidos?de=${recDe}&ate=${recAte}`);
      // Filtrar apenas créditos (Pix recebidos / entradas)
      const todas = r?.transacoes || [];
      const soCreditos = todas.filter(t => {
        const op = String(t.tipoOperacao || t.tipo || "").toUpperCase();
        return op === "C" || op === "CREDITO" || op === "ENTRADA";
      });
      setRecebidos(soCreditos);
    } catch (e) {
      addToast(e.message || "Erro ao carregar recebidos", "error");
    } finally {
      setLoadingRec(false);
    }
  }, [bankPixBase, recDe, recAte]);

  useEffect(() => { if (aba === "recebidos") carregarRecebidos(); }, [carregarRecebidos, aba]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handler(e) {
      if (destRef.current && !destRef.current.contains(e.target)) setDestOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounce busca de clientes ao digitar no destinatário
  useEffect(() => {
    if (!destQuery.trim() || destQuery.length < 2) { setDestClientes([]); setDestOpen(false); return; }
    clearTimeout(destDebounce.current);
    destDebounce.current = setTimeout(async () => {
      setDestLoading(true);
      try {
        const r = await apiFetch(`/clients?search=${encodeURIComponent(destQuery)}&limit=8`);
        setDestClientes(Array.isArray(r) ? r : []);
        setDestOpen(true);
      } catch { setDestClientes([]); } finally { setDestLoading(false); }
    }, 300);
  }, [destQuery]);

  // ── Sincronizar Pix ───────────────────────────────────────────────────────

  async function sincronizar(id) {
    setSincronizando(id);
    try {
      const r = await apiFetch(`${bankPixBase}/pagamentos/${id}/sincronizar`, { method: "POST" });
      if (r.sincronizado) {
        addToast(`Status atualizado: ${r.pix.status}`, "success");
      } else {
        addToast(r.message || "Nada a sincronizar", "info");
      }
      carregarEnviados();
    } catch (e) {
      addToast(e.message || "Erro ao sincronizar", "error");
    } finally {
      setSincronizando(null);
    }
  }

  function abrirModalEnviar() {
    setDestQuery(""); setDestClientes([]); setDestOpen(false);
    setModalEnviar({
      open: true, chavePix: "", valorCentavos: 0, descricao: "",
      advogadoId: "", contaId: contasBanco.length === 1 ? String(contasBanco[0].id) : "",
      favorecidoNome: "", cpfCnpjFavorecido: "", loading: false, error: "",
    });
  }

  function selecionarDestAdvogado(adv) {
    setDestQuery(adv.nome);
    setDestOpen(false);
    setModalEnviar(m => ({
      ...m, advogadoId: String(adv.id),
      favorecidoNome: adv.nome,
      chavePix: adv.chavePix || "",
      cpfCnpjFavorecido: adv.cpf || "",
    }));
  }

  function selecionarDestCliente(cli) {
    setDestQuery(cli.nomeRazaoSocial);
    setDestOpen(false);
    setModalEnviar(m => ({
      ...m, advogadoId: "",
      favorecidoNome: cli.nomeRazaoSocial,
      chavePix: "",
      cpfCnpjFavorecido: cli.cpfCnpj || "",
    }));
  }

  function usarNomeManual() {
    setDestOpen(false);
    setModalEnviar(m => ({
      ...m, advogadoId: "",
      favorecidoNome: destQuery.trim(),
      chavePix: "",
      cpfCnpjFavorecido: "",
    }));
  }

  function limparDest() {
    setDestQuery(""); setDestClientes([]); setDestOpen(false);
    setModalEnviar(m => ({ ...m, advogadoId: "", favorecidoNome: "", chavePix: "", cpfCnpjFavorecido: "" }));
  }

  async function marcarRealizado(id) {
    if (!await confirmToast("Marcar este Pix como REALIZADO? Use apenas se o pagamento foi confirmado no banco.")) return;
    setMarcandoReal(id);
    try {
      await apiFetch(`${bankPixBase}/pagamentos/${id}/marcar-realizado`, { method: "POST" });
      addToast("Pix marcado como Realizado", "success");
      carregarEnviados();
    } catch (e) {
      addToast(e.message || "Erro ao marcar", "error");
    } finally {
      setMarcandoReal(null);
    }
  }

  // ── Enviar Pix ────────────────────────────────────────────────────────────

  async function confirmarEnvio() {
    const { advogadoId, chavePix, valorCentavos, descricao, contaId, favorecidoNome, cpfCnpjFavorecido } = modalEnviar;

    const nomeEnviar  = (favorecidoNome || "").trim();
    const chaveEnviar = (chavePix || "").trim();

    if (!nomeEnviar)  { setModalEnviar(m => ({ ...m, error: "Selecione ou informe o destinatário" })); return; }
    if (!chaveEnviar) { setModalEnviar(m => ({ ...m, error: "Informe a chave Pix" })); return; }
    if (!valorCentavos || valorCentavos <= 0) { setModalEnviar(m => ({ ...m, error: "Informe o valor" })); return; }

    const cntId = contasBanco.length === 1 ? String(contasBanco[0].id) : contaId;
    if (!cntId) { setModalEnviar(m => ({ ...m, error: `Selecione a conta ${bankName}` })); return; }

    setModalEnviar(m => ({ ...m, loading: true, error: "" }));
    try {
      await apiFetch(`${bankPixBase}/enviar`, {
        method: "POST",
        body: { chavePix: chaveEnviar, valorCentavos, descricao, advogadoId, contaId: cntId, favorecidoNome: nomeEnviar, cpfCnpjFavorecido },
      });
      addToast("Pix enviado com sucesso!", "success");
      setModalEnviar({ open: false });
      carregarEnviados();
    } catch (e) {
      setModalEnviar(m => ({ ...m, loading: false, error: e.message || "Erro ao enviar Pix" }));
    }
  }

  if (!isAdmin) {
    return <EmptyState icon="🔒" title="Acesso restrito" description="Esta área é exclusiva para administradores." />;
  }

  const contasBanco = contas.filter((c) =>
    isSantander
      ? String(c?.nome || "").toLowerCase().includes("santander")
      : !!c?.interContaId
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>Pix</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
            Envio e recebimento de Pix via Banco {bankName} PJ
          </p>
        </div>
        <button
          onClick={abrirModalEnviar}
          style={{ padding: "8px 16px", background: "#1e40af", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
        >
          + Enviar Pix
        </button>
      </div>

      {/* Abas */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e2e8f0" }}>
        {[{ k: "enviados", label: "Enviados" }, { k: "recebidos", label: "Recebidos" }].map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            style={{
              padding: "8px 18px",
              background: "none",
              border: "none",
              borderBottom: aba === k ? "2px solid #1e40af" : "2px solid transparent",
              marginBottom: -2,
              fontWeight: aba === k ? 700 : 400,
              color: aba === k ? "#1e40af" : "#64748b",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── ABA ENVIADOS ── */}
      {aba === "enviados" && (
        <>
          {/* Filtros */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <select
              value={filtroStatus}
              onChange={e => { setFiltroStatus(e.target.value); setPage(1); }}
              style={{ padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }}
            >
              <option value="">Todos os status</option>
              <option value="PROCESSANDO">Processando</option>
              <option value="REALIZADO">Realizado</option>
              <option value="DEVOLVIDO">Devolvido</option>
              <option value="ERRO">Erro</option>
            </select>

            <select
              value={filtroAdvId}
              onChange={e => { setFiltroAdvId(e.target.value); setPage(1); }}
              style={{ padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, minWidth: 160 }}
            >
              <option value="">Todos os advogados</option>
              {advogados.map(a => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Buscar destinatário / fornecedor..."
              value={filtroNome}
              onChange={e => { setFiltroNome(e.target.value); setPage(1); }}
              style={{ padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, minWidth: 220 }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>De</span>
              <input type="date" value={filtroDe} onChange={e => { setFiltroDe(e.target.value); setPage(1); }}
                style={{ padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
              <span style={{ color: "#64748b" }}>até</span>
              <input type="date" value={filtroAte} onChange={e => { setFiltroAte(e.target.value); setPage(1); }}
                style={{ padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
            </div>

            <button
              onClick={() => { setFiltroStatus(""); setFiltroAdvId(""); setFiltroNome(""); setFiltroDe(""); setFiltroAte(""); setPage(1); }}
              style={{ padding: "6px 12px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#64748b" }}
            >
              Limpar
            </button>
          </div>

          {/* Tabela enviados */}
          {loadingEnv ? (
            <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Carregando...</div>
          ) : enviados.pagamentos.length === 0 ? (
            <EmptyState icon="💸" title="Nenhum Pix encontrado" description="Nenhum pagamento Pix com os filtros selecionados." />
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Data", "Destinatário", "Chave Pix", "Valor", "Status", "Repasse?", ""].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {enviados.pagamentos.map(p => (
                      <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{fmtDate(p.createdAt)}</td>
                        <td style={{ padding: "9px 12px" }}>
                          <div style={{ fontWeight: 600 }}>{p.favorecidoNome || p.advogado?.nome || "—"}</div>
                          {p.descricao && <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.descricao}</div>}
                        </td>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 12 }}>{p.chavePix}</td>
                        <td style={{ padding: "9px 12px", fontWeight: 700, whiteSpace: "nowrap", color: "#1e40af" }}>{fmtBRL(p.valorCentavos)}</td>
                        <td style={{ padding: "9px 12px" }}>
                          <StatusBadge status={p.status} />
                          {p.erro && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>{p.erro}</div>}
                        </td>
                        <td style={{ padding: "9px 12px", fontSize: 12, color: "#64748b" }}>
                          {p.repasseId ? `Repasse #${p.repasseId}` : "—"}
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          {["PROCESSANDO", "EM_APROVACAO"].includes(p.status) && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <button
                                onClick={() => sincronizar(p.id)}
                                disabled={sincronizando === p.id}
                                style={{ padding: "4px 10px", background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                              >
                                {sincronizando === p.id ? "..." : "⟳ Sincronizar"}
                              </button>
                              <button
                                onClick={() => marcarRealizado(p.id)}
                                disabled={marcandoReal === p.id}
                                style={{ padding: "4px 10px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                              >
                                {marcandoReal === p.id ? "..." : "✓ Realizado"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {enviados.pages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", background: page <= 1 ? "#f8fafc" : "#fff" }}>
                    ←
                  </button>
                  <span style={{ padding: "6px 12px", fontSize: 13, color: "#64748b" }}>
                    Página {page} de {enviados.pages} · {enviados.total} registros
                  </span>
                  <button onClick={() => setPage(p => Math.min(enviados.pages, p + 1))} disabled={page >= enviados.pages}
                    style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", background: page >= enviados.pages ? "#f8fafc" : "#fff" }}>
                    →
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── ABA RECEBIDOS ── */}
      {aba === "recebidos" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>De</span>
              <input type="date" value={recDe} onChange={e => setRecDe(e.target.value)}
                style={{ padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
              <span style={{ color: "#64748b" }}>até</span>
              <input type="date" value={recAte} onChange={e => setRecAte(e.target.value)}
                style={{ padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
            </div>
            <button
              onClick={carregarRecebidos}
              style={{ padding: "6px 14px", background: "#1e40af", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer", fontWeight: 600 }}
            >
              Atualizar
            </button>
          </div>

          {loadingRec ? (
            <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Carregando extrato...</div>
          ) : recebidos.length === 0 ? (
            <EmptyState icon="📥" title="Nenhuma transação no período" description="Extrato vazio para as datas selecionadas." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Data", "Tipo", "Descrição / Remetente", "Valor"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recebidos.map((t, i) => {
                    const op  = (t.tipoOperacao || "").toUpperCase();
                    const isC = op === "C" || op === "CREDITO";
                    const isD = op === "D" || op === "DEBITO";
                    const tipo = t.tipoTransacao || t.tipoOperacao || t.tipo || "—";
                    const valorCents = t.valorCentavos
                      ? Number(t.valorCentavos)
                      : Math.round(Math.abs(Number(t.valor || 0)) * 100);
                    const descricao = t.descricao || t.titulo || t.historico || t.nomeRemetente || "—";
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: isC ? "#f0fdf4" : isD ? "#fff7f7" : undefined }}>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                          {fmtDateOnly(t.dataEntrada || t.dataTransacao || t.data)}
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <span style={{
                            display: "inline-block", padding: "2px 7px", borderRadius: 9999, fontSize: 11, fontWeight: 700,
                            background: isC ? "#dcfce7" : isD ? "#fee2e2" : "#f1f5f9",
                            color:      isC ? "#16a34a" : isD ? "#dc2626" : "#64748b",
                          }}>
                            {isC ? "▲" : isD ? "▼" : "●"} {tipo}
                          </span>
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <div>{descricao}</div>
                          {t.endToEndId && (
                            <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{t.endToEndId}</div>
                          )}
                        </td>
                        <td style={{ padding: "9px 12px", fontWeight: 700, whiteSpace: "nowrap",
                          color: isC ? "#16a34a" : isD ? "#dc2626" : "#0f172a" }}>
                          {isD ? "−" : "+"}{fmtBRL(valorCents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── MODAL ENVIAR PIX ── */}
      {modalEnviar.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>

            {/* Header fixo */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>Enviar Pix</h2>
            </div>

            {/* Body rolável */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

              {/* ── Destinatário — autocomplete ── */}
              <div style={{ marginBottom: 14 }} ref={destRef}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                  DESTINATÁRIO *
                </label>

                {/* Card de selecionado */}
                {modalEnviar.favorecidoNome ? (
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#166534" }}>{modalEnviar.favorecidoNome}</div>
                      {modalEnviar.advogadoId && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Advogado cadastrado</div>}
                      {modalEnviar.cpfCnpjFavorecido && <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>CPF/CNPJ: {modalEnviar.cpfCnpjFavorecido}</div>}
                    </div>
                    <button onClick={limparDest} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 16, lineHeight: 1, padding: "0 0 0 8px" }}>✕</button>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      placeholder="Buscar por nome, CPF, CNPJ..."
                      value={destQuery}
                      onChange={e => { setDestQuery(e.target.value); setDestOpen(true); }}
                      onFocus={() => destQuery.length >= 2 && setDestOpen(true)}
                      autoComplete="off"
                      style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                    />
                    {destLoading && (
                      <div style={{ position: "absolute", right: 10, top: 9, fontSize: 12, color: "#94a3b8" }}>...</div>
                    )}

                    {/* Dropdown */}
                    {destOpen && destQuery.length >= 2 && (
                      <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 50, maxHeight: 260, overflowY: "auto" }}>

                        {/* Advogados matching */}
                        {advogados.filter(a => a.nome?.toLowerCase().includes(destQuery.toLowerCase())).map(adv => (
                          <button key={`adv-${adv.id}`}
                            onMouseDown={e => { e.preventDefault(); selecionarDestAdvogado(adv); }}
                            style={{ width: "100%", textAlign: "left", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                            onMouseLeave={e => e.currentTarget.style.background = "none"}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{adv.nome}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              Advogado{adv.chavePix ? ` · Chave: ${adv.chavePix}` : " · ⚠ sem chave Pix"}
                            </div>
                          </button>
                        ))}

                        {/* Clientes matching */}
                        {destClientes.map(cli => (
                          <button key={`cli-${cli.id}`}
                            onMouseDown={e => { e.preventDefault(); selecionarDestCliente(cli); }}
                            style={{ width: "100%", textAlign: "left", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                            onMouseLeave={e => e.currentTarget.style.background = "none"}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{cli.nomeRazaoSocial}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>{cli.cpfCnpj || "Cliente"}</div>
                          </button>
                        ))}

                        {/* Não encontrado */}
                        {!destLoading && destClientes.length === 0 && !advogados.some(a => a.nome?.toLowerCase().includes(destQuery.toLowerCase())) && (
                          <div>
                            <button
                              onMouseDown={e => { e.preventDefault(); usarNomeManual(); }}
                              style={{ width: "100%", textAlign: "left", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", borderBottom: "1px solid #f1f5f9", color: "#1e40af" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#eff6ff"}
                              onMouseLeave={e => e.currentTarget.style.background = "none"}
                            >
                              <span style={{ fontWeight: 600 }}>✓ Usar "{destQuery}" como nome</span>
                            </button>
                            <a
                              href="/clientes"
                              target="_blank"
                              rel="noreferrer"
                              style={{ display: "block", padding: "9px 14px", fontSize: 13, color: "#64748b", textDecoration: "none", borderBottom: "1px solid #f1f5f9" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                              onMouseLeave={e => e.currentTarget.style.background = "none"}
                            >
                              📋 Cadastrar novo cliente
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Chave Pix ── */}
              {(
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>CHAVE PIX *</label>
                  <input
                    value={modalEnviar.chavePix || ""}
                    onChange={e => setModalEnviar(m => ({ ...m, chavePix: e.target.value }))}
                    placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                  />
                  {modalEnviar.advogadoId && !modalEnviar.chavePix && (
                    <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>⚠ Chave Pix não cadastrada — preencha em Advogados ou informe manualmente</div>
                  )}
                </div>
              )}

              {/* ── Valor ── */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>VALOR *</label>
                <MoneyInput
                  value={modalEnviar.valorCentavos || 0}
                  onChange={v => setModalEnviar(m => ({ ...m, valorCentavos: v }))}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                />
              </div>

              {/* ── Descrição ── */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>DESCRIÇÃO (opcional)</label>
                <input
                  value={modalEnviar.descricao || ""}
                  onChange={e => setModalEnviar(m => ({ ...m, descricao: e.target.value }))}
                  maxLength={140}
                  placeholder="Ex: Repasse março/2026"
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                />
              </div>

              {/* ── Conta banco — só exibe quando há mais de uma ── */}
              {contasBanco.length === 0 && (
                <div style={{ padding: 10, background: "#fef3c7", borderRadius: 8, fontSize: 13, color: "#92400e", marginBottom: 14 }}>
                  ⚠ Nenhuma conta {bankName} configurada em Contas Contábeis.
                </div>
              )}
              {contasBanco.length === 1 && (
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                  Débito em: <strong style={{ color: "#0f172a" }}>{contasBanco[0].nome}</strong>
                </div>
              )}
              {contasBanco.length > 1 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>CONTA DE ORIGEM *</label>
                  <select
                    value={modalEnviar.contaId || ""}
                    onChange={e => setModalEnviar(m => ({ ...m, contaId: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14 }}
                  >
                    <option value="">Selecionar conta...</option>
                    {contasBanco.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* ── Preview ── */}
              {modalEnviar.valorCentavos > 0 && modalEnviar.favorecidoNome && modalEnviar.chavePix && (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#1e40af" }}>
                  💸 <strong>{fmtBRL(modalEnviar.valorCentavos)}</strong>{" "}para{" "}
                  <strong>{modalEnviar.favorecidoNome}</strong>
                  {" · "}<span style={{ fontFamily: "monospace" }}>{modalEnviar.chavePix}</span>
                </div>
              )}

              {modalEnviar.error && (
                <div style={{ background: "#fee2e2", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#dc2626", marginTop: 12 }}>
                  {modalEnviar.error}
                </div>
              )}
            </div>

            {/* Footer fixo */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid #e2e8f0", flexShrink: 0, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setModalEnviar({ open: false })}
                style={{ padding: "9px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, cursor: "pointer", color: "#475569" }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmarEnvio}
                disabled={modalEnviar.loading}
                style={{ padding: "9px 18px", background: "#1e40af", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                {modalEnviar.loading ? "Enviando..." : "Confirmar e Enviar ▶"}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
