// src/pages/WhatsAppInbox.jsx
import React, { useEffect, useRef, useState } from "react";
import { apiFetch, BASE_URL, getToken } from "../lib/api";
import { useToast } from "../components/Toast";

const isStaff = (user) =>
  String(user?.role || "").toUpperCase() === "ADMIN" ||
  String(user?.tipoUsuario || "").toUpperCase() === "SECRETARIA_VIRTUAL";
const isUser = (user) => String(user?.role || "").toUpperCase() === "USER";

function fmtPhone(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,5)} ${d.slice(5,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  return phone;
}
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mesmodia = d.toDateString() === new Date().toDateString();
  return mesmodia
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function fmtFull(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function Badge({ count }) {
  if (!count) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold">
      {count > 9 ? "9+" : count}
    </span>
  );
}
function RespondidoPorTag({ v }) {
  const map = {
    BOT:         { label: "Bot",     cls: "bg-sky-100 text-sky-700 border-sky-200" },
    BOT_ESCALOU: { label: "Escalou", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    HUMANO:      { label: "Humano",  cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  };
  const cfg = map[v];
  if (!cfg) return null;
  return <span className={`text-[9px] font-semibold border rounded-full px-1.5 py-0.5 ${cfg.cls}`}>{cfg.label}</span>;
}

/* ── Media helpers ── */
function mediaUrl(mediaId, filename, inline = false) {
  const params = new URLSearchParams({ token: getToken(), filename: filename || "arquivo" });
  if (inline) params.set("inline", "1");
  return `${BASE_URL}/whatsapp/media/${mediaId}?${params}`;
}

const TIPO_ICONS = { document: "📄", audio: "🎵", video: "🎬", sticker: "🖼️" };

function MediaBubble({ m, outbound }) {
  const { tipo, mediaId, mediaFilename, conteudo } = m;
  const filename = mediaFilename || conteudo || "arquivo";
  const textCls = outbound ? "text-green-100" : "text-slate-500";

  if (!mediaId) return <p className="whitespace-pre-wrap leading-snug italic opacity-70">{conteudo}</p>;

  if (tipo === "image" || tipo === "sticker") {
    return (
      <div className="space-y-1">
        <a href={mediaUrl(mediaId, filename, true)} download={filename} target="_blank" rel="noreferrer">
          <img
            src={mediaUrl(mediaId, filename, true)}
            alt={filename}
            className="max-w-[240px] rounded-xl object-cover cursor-pointer hover:opacity-90"
            onError={e => { e.target.style.display = "none"; e.target.nextSibling?.style.removeProperty("display"); }}
          />
          <span style={{ display: "none" }} className={`text-xs ${textCls}`}>🖼️ {filename}</span>
        </a>
        {conteudo && conteudo !== filename && <p className="text-xs mt-1 whitespace-pre-wrap">{conteudo}</p>}
      </div>
    );
  }

  if (tipo === "audio") {
    return (
      <div className="space-y-1">
        <audio controls src={mediaUrl(mediaId, filename, true)} className="max-w-[240px] h-9" />
        {conteudo && conteudo !== filename && <p className={`text-xs ${textCls}`}>{conteudo}</p>}
      </div>
    );
  }

  if (tipo === "video") {
    return (
      <div className="space-y-1">
        <video controls src={mediaUrl(mediaId, filename, true)} className="max-w-[240px] rounded-xl" />
        {conteudo && conteudo !== filename && <p className={`text-xs ${textCls}`}>{conteudo}</p>}
      </div>
    );
  }

  // document (default)
  return (
    <a href={mediaUrl(mediaId, filename)} download={filename}
      className={`flex items-center gap-2 hover:opacity-80 transition-opacity`}>
      <span className="text-xl">{TIPO_ICONS[tipo] || "📄"}</span>
      <span className={`text-sm underline truncate max-w-[200px] ${outbound ? "text-green-100" : "text-blue-600"}`}>
        {filename}
      </span>
    </a>
  );
}

/* ── Modal Transferir ── */
function ModalTransferir({ phone, advogados, responsavelId, onClose, onDone }) {
  const { addToast } = useToast();
  const [sel, setSel] = useState(responsavelId ? String(responsavelId) : "");
  const [saving, setSaving] = useState(false);

  async function handleSalvar() {
    setSaving(true);
    try {
      await apiFetch(`/whatsapp/conversas/${phone}/transferir`, {
        method: "POST",
        body: JSON.stringify({ responsavelId: sel ? Number(sel) : null }),
      });
      addToast(sel ? "Conversa transferida." : "Conversa devolvida ao pool.", "success");
      onDone();
    } catch (e) {
      addToast("Erro: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-base font-semibold text-slate-900">Transferir conversa</div>
          <div className="text-xs text-slate-500 mt-0.5">{fmtPhone(phone)}</div>
        </div>
        <div className="p-5 space-y-3">
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300"
            value={sel}
            onChange={e => setSel(e.target.value)}
          >
            <option value="">— Devolver ao pool (Admin/SV) —</option>
            {advogados.map(a => (
              <option key={a.usuarioId} value={String(a.usuarioId)}>{a.nome}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400">
            O advogado receberá uma notificação no chat e, se possível, também por WhatsApp.
          </p>
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={saving}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-50">
            {saving ? "Transferindo…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Página principal ── */
export default function WhatsAppInbox({ user }) {
  const { addToast } = useToast();
  const canView = isStaff(user) || isUser(user);

  const [conversas,      setConversas]      = useState([]);
  const [totalPages,     setTotalPages]     = useState(1);
  const [currentPage,    setCurrentPage]    = useState(1);
  const [ativa,          setAtiva]          = useState(null);
  const [msgs,           setMsgs]           = useState([]);
  const [responsavelId,  setResponsavelId]  = useState(null);
  const [advogados,      setAdvogados]      = useState([]);
  const [texto,          setTexto]          = useState("");
  const [loadingList,    setLoadingList]    = useState(false);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [loadingMsgs,    setLoadingMsgs]    = useState(false);
  const [sending,        setSending]        = useState(false);
  const [modalTransf,    setModalTransf]    = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  async function loadConversas(page = 1, append = false) {
    if (page === 1) setLoadingList(true); else setLoadingMore(true);
    try {
      const data = await apiFetch(`/whatsapp/conversas?page=${page}`);
      const lista = data.conversas || [];
      setConversas(prev => append ? [...prev, ...lista] : lista);
      setTotalPages(data.totalPages || 1);
      setCurrentPage(data.page || 1);
    }
    catch (e) { addToast("Erro: " + e.message, "error"); }
    finally { setLoadingList(false); setLoadingMore(false); }
  }

  async function loadMsgs(phone) {
    setLoadingMsgs(true);
    try {
      const data = await apiFetch(`/whatsapp/conversas/${phone}`);
      setMsgs(data.msgs || []);
      setResponsavelId(data.responsavelId || null);
      setConversas(cv => cv.map(c => c.phone === phone ? { ...c, unread: 0 } : c));
    } catch (e) { addToast("Erro: " + e.message, "error"); }
    finally { setLoadingMsgs(false); }
  }

  async function loadAdvogados() {
    try { setAdvogados(await apiFetch("/whatsapp/advogados")); } catch (_) {}
  }

  useEffect(() => {
    if (canView) { loadConversas(); loadAdvogados(); }
  }, []);

  useEffect(() => { if (ativa) loadMsgs(ativa); }, [ativa]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  // U1 — SSE: atualizações em tempo real + poll de 60s como fallback
  useEffect(() => {
    if (!canView) return;

    // SSE — BASE_URL já inclui /api
    const sseUrl = `${BASE_URL}/whatsapp/events?token=${getToken()}`;
    const sse = new EventSource(sseUrl);
    sse.addEventListener("wa", () => {
      loadConversas(1);
      if (ativa) loadMsgs(ativa);
    });
    sse.onerror = () => {}; // silencia erros de reconexão

    // Fallback poll a cada 60s
    const t = setInterval(() => {
      loadConversas(1);
      if (ativa) loadMsgs(ativa);
    }, 60000);

    return () => { sse.close(); clearInterval(t); };
  }, [ativa, canView]);

  async function handleFileSend(file) {
    if (!file || !ativa || sending) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch(`${BASE_URL}/whatsapp/conversas/${ativa}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Erro ao enviar"); }
      const nova = await res.json();
      setMsgs(m => [...m, nova]);
      loadConversas(1);
    } catch (e) { addToast("Erro ao enviar arquivo: " + e.message, "error"); }
    finally { setSending(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  async function handleSend() {
    if (!texto.trim() || !ativa || sending) return;
    setSending(true);
    try {
      const nova = await apiFetch(`/whatsapp/conversas/${ativa}/reply`, {
        method: "POST", body: JSON.stringify({ conteudo: texto.trim() }),
      });
      setMsgs(m => [...m, nova]);
      setTexto("");
      loadConversas(1);
    } catch (e) { addToast("Erro ao enviar: " + e.message, "error"); }
    finally { setSending(false); }
  }

  if (!canView) return <div className="text-sm text-slate-500 py-8">Acesso restrito.</div>;

  const atv = conversas.find(c => c.phone === ativa);
  const advResp = atv?.responsavelId
    ? advogados.find(a => a.usuarioId === atv.responsavelId)
    : null;

  return (
    <div className="flex h-[calc(100vh-120px)] rounded-2xl border border-slate-200 overflow-hidden bg-white">

      {/* ── Lista ── */}
      <div className="w-80 border-r border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-slate-800">
              WhatsApp Inbox
              {isUser(user) && <span className="ml-1.5 text-[10px] text-slate-400">(atribuídas a mim)</span>}
            </span>
            <span className="mt-1 inline-flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0"></span>
              <span className="text-[11px] font-mono font-semibold text-green-700 tracking-wide">
                +55 (91) 8615-6529
              </span>
            </span>
          </div>
          <button onClick={() => loadConversas(1)} className="text-xs text-slate-400 hover:text-slate-600">↺</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingList && conversas.length === 0 && (
            <div className="text-xs text-slate-400 text-center py-8">Carregando…</div>
          )}
          {!loadingList && conversas.length === 0 && (
            <div className="text-xs text-slate-400 text-center py-8">Nenhuma conversa.</div>
          )}
          {conversas.map(c => {
            const adv = c.responsavelId ? advogados.find(a => a.usuarioId === c.responsavelId) : null;
            return (
              <button key={c.phone} onClick={() => setAtiva(c.phone)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors
                  ${ativa === c.phone ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800 truncate">
                        {c.cliente?.nomeRazaoSocial || c.advogado?.nome || fmtPhone(c.phone)}
                      </span>
                      {c.advogado && !c.cliente && (
                        <span className="text-[9px] font-bold border border-purple-300 bg-purple-50 text-purple-700 rounded-full px-1.5">Advogado</span>
                      )}
                      {c.aguardaHumano && (
                        <span className="text-[9px] font-bold border border-amber-300 bg-amber-50 text-amber-700 rounded-full px-1.5">Aguarda</span>
                      )}
                    </div>
                    {(c.cliente || c.advogado) && <div className="text-[10px] text-slate-400">{fmtPhone(c.phone)}</div>}
                    {adv && <div className="text-[10px] text-blue-500">→ {adv.nome}</div>}
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {c.ultima?.direcao === "OUT" ? "Você: " : ""}{c.ultima?.conteudo}
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0 gap-1">
                    <span className="text-[10px] text-slate-400">{fmtTime(c.ultima?.criadoEm)}</span>
                    <Badge count={c.unread} />
                  </div>
                </div>
              </button>
            );
          })}
          {currentPage < totalPages && (
            <button
              onClick={() => loadConversas(currentPage + 1, true)}
              disabled={loadingMore}
              className="w-full py-2.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 border-t border-slate-100 disabled:opacity-50"
            >
              {loadingMore ? "Carregando…" : `Ver mais (${totalPages - currentPage} página${totalPages - currentPage > 1 ? "s" : ""})`}
            </button>
          )}
        </div>
      </div>

      {/* ── Conversa ── */}
      {!ativa ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Selecione uma conversa
        </div>
      ) : (
        <div className="flex-1 flex flex-col">

          {/* Header */}
          <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm shrink-0">
              WA
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800">
                {atv?.cliente?.nomeRazaoSocial || atv?.advogado?.nome || fmtPhone(ativa)}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(atv?.cliente || atv?.advogado) && <span className="text-xs text-slate-400">{fmtPhone(ativa)}</span>}
                {advResp
                  ? <span className="text-xs text-blue-600 font-medium">→ {advResp.nome}</span>
                  : isStaff(user) && <span className="text-xs text-slate-400">Pool geral</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {atv?.aguardaHumano && (
                <span className="text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-700 rounded-xl px-2.5 py-1">
                  ⚠️ Aguarda atendente
                </span>
              )}
              {/* Transferir: staff sempre; advogado pode retransferir */}
              {(isStaff(user) || isUser(user)) && (
                <button onClick={() => setModalTransf(true)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                  ↗ Transferir
                </button>
              )}
            </div>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50">
            {loadingMsgs && <div className="text-xs text-center text-slate-400">Carregando…</div>}
            {msgs.map(m => {
              const out = m.direcao === "OUT";
              const hasMedia = m.tipo && m.tipo !== "text" && m.mediaId;
              return (
                <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm
                    ${out
                      ? "bg-green-600 text-white rounded-tr-sm"
                      : "bg-white text-slate-800 border border-slate-200 rounded-tl-sm"}`}
                  >
                    {hasMedia
                      ? <MediaBubble m={m} outbound={out} />
                      : <p className="whitespace-pre-wrap leading-snug">{m.conteudo}</p>
                    }
                    <div className={`flex items-center gap-1.5 mt-1 ${out ? "justify-end" : "justify-start"}`}>
                      <span className={`text-[10px] ${out ? "text-green-200" : "text-slate-400"}`}>
                        {fmtFull(m.criadoEm)}
                      </span>
                      {out && <RespondidoPorTag v={m.respondidoPor} />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-slate-200 bg-white flex gap-2 items-end">
            {/* Attachment */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSend(f); }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Anexar arquivo"
              className="p-2 rounded-xl border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-40 transition-colors shrink-0"
            >
              📎
            </button>
            <textarea rows={2}
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-300 resize-none"
              placeholder="Digite sua resposta… (Enter envia, Shift+Enter nova linha)"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            <button onClick={handleSend} disabled={!texto.trim() || sending}
              className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors shrink-0">
              {sending ? "…" : "Enviar"}
            </button>
          </div>
        </div>
      )}

      {modalTransf && ativa && (
        <ModalTransferir
          phone={ativa}
          advogados={advogados}
          responsavelId={responsavelId}
          onClose={() => setModalTransf(false)}
          onDone={() => { setModalTransf(false); loadConversas(); loadMsgs(ativa); }}
        />
      )}
    </div>
  );
}
