// src/pages/InstagramInbox.jsx
import React, { useEffect, useRef, useState } from "react";
import { apiFetch, BASE_URL, getToken } from "../lib/api";
import { useToast } from "../components/Toast";

const isStaff = (user) =>
  String(user?.role || "").toUpperCase() === "ADMIN" ||
  String(user?.tipoUsuario || "").toUpperCase() === "SECRETARIA_VIRTUAL";

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mesmodia = d.toDateString() === new Date().toDateString();
  return mesmodia
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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

const TIPO_ICONS = {
  video: "🎬",
  audio: "🎵",
  file: "📄",
  story_mention: "📖",
  story_reply: "↩️",
};

function MediaBubble({ m, outbound }) {
  const { tipo, mediaUrl, conteudo } = m;
  const textCls = outbound ? "text-pink-100" : "text-slate-500";

  if (!mediaUrl && tipo !== "text") {
    return <p className="whitespace-pre-wrap leading-snug italic opacity-70">{conteudo || `[${tipo}]`}</p>;
  }

  if (tipo === "image" || tipo === "sticker") {
    return (
      <div className="space-y-1">
        <a href={mediaUrl} target="_blank" rel="noreferrer">
          <img
            src={mediaUrl}
            alt="imagem"
            className="max-w-[240px] rounded-xl object-cover cursor-pointer hover:opacity-90"
            onError={e => { e.target.style.display = "none"; }}
          />
        </a>
        {conteudo && conteudo !== "[image]" && (
          <p className="text-xs mt-1 whitespace-pre-wrap">{conteudo}</p>
        )}
      </div>
    );
  }

  if (tipo === "video") {
    return (
      <div className="space-y-1">
        <video controls src={mediaUrl} className="max-w-[240px] rounded-xl" />
        {conteudo && conteudo !== "[video]" && <p className={`text-xs ${textCls}`}>{conteudo}</p>}
      </div>
    );
  }

  if (tipo === "audio") {
    return (
      <div className="space-y-1">
        <audio controls src={mediaUrl} className="max-w-[240px] h-9" />
        {conteudo && conteudo !== "[audio]" && <p className={`text-xs ${textCls}`}>{conteudo}</p>}
      </div>
    );
  }

  if (tipo === "story_mention" || tipo === "story_reply") {
    return (
      <div className={`flex items-start gap-2 text-sm ${textCls}`}>
        <span className="text-lg">{TIPO_ICONS[tipo]}</span>
        <div>
          <p className="font-medium">{tipo === "story_mention" ? "Story Mencionou" : "Respondeu ao Story"}</p>
          {mediaUrl && (
            <a href={mediaUrl} target="_blank" rel="noreferrer" className="underline text-xs">
              Ver story
            </a>
          )}
          {conteudo && <p className="text-xs mt-1 whitespace-pre-wrap">{conteudo}</p>}
        </div>
      </div>
    );
  }

  // file genérico
  return (
    <a href={mediaUrl} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 hover:opacity-80 transition-opacity">
      <span className="text-xl">{TIPO_ICONS[tipo] || "📄"}</span>
      <span className={`text-sm underline truncate max-w-[200px] ${outbound ? "text-pink-100" : "text-blue-600"}`}>
        Arquivo
      </span>
    </a>
  );
}

/* ── Modal Transferir ── */
function ModalTransferir({ igUserId, igUsername, advogados, responsavelId, onClose, onDone }) {
  const { addToast } = useToast();
  const [sel, setSel] = useState(responsavelId ? String(responsavelId) : "");
  const [saving, setSaving] = useState(false);

  async function handleSalvar() {
    setSaving(true);
    try {
      await apiFetch(`/instagram/conversas/${igUserId}/transferir`, {
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
          <div className="text-xs text-slate-500 mt-0.5">{igUsername || igUserId}</div>
        </div>
        <div className="p-5 space-y-3">
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-pink-300"
            value={sel}
            onChange={e => setSel(e.target.value)}
          >
            <option value="">— Devolver ao pool (Admin/SV) —</option>
            {advogados.map(a => (
              <option key={a.usuario?.id || a.id} value={String(a.usuario?.id || a.id)}>{a.nome}</option>
            ))}
          </select>
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={saving}
            className="px-4 py-2 rounded-xl bg-pink-600 text-white text-sm font-semibold hover:bg-pink-700 disabled:opacity-50">
            {saving ? "Transferindo…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Avatar do usuário ── */
function IgAvatar({ fotoPerfil, nome, username, size = "sm" }) {
  const dim = size === "lg" ? "w-10 h-10 text-base" : "w-8 h-8 text-sm";
  const letra = (nome || username || "?").replace("@", "")[0]?.toUpperCase() || "?";
  if (fotoPerfil) {
    return (
      <img
        src={fotoPerfil}
        alt={nome || username}
        className={`${dim} rounded-full object-cover shrink-0 border border-slate-200`}
        onError={e => { e.target.style.display = "none"; e.target.nextSibling?.removeAttribute("style"); }}
      />
    );
  }
  return (
    <div className={`${dim} rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-semibold shrink-0`}>
      {letra}
    </div>
  );
}

/* ── Ícone do Instagram (SVG inline) ── */
function IgIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  );
}

/* ── Página principal ── */
export default function InstagramInbox({ user }) {
  const { addToast } = useToast();
  const canView = isStaff(user) || String(user?.role || "").toUpperCase() === "USER";

  const [conversas,     setConversas]     = useState([]);
  const [totalPages,    setTotalPages]    = useState(1);
  const [currentPage,   setCurrentPage]  = useState(1);
  const [ativa,         setAtiva]         = useState(null); // igUserId ativo
  const [ativaInfo,     setAtivaInfo]     = useState(null); // { igUsername, nomeCompleto, fotoPerfil, responsavelId }
  const [msgs,          setMsgs]          = useState([]);
  const [advogados,     setAdvogados]     = useState([]);
  const [texto,         setTexto]         = useState("");
  const [loadingList,   setLoadingList]   = useState(false);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [loadingMsgs,   setLoadingMsgs]   = useState(false);
  const [sending,       setSending]       = useState(false);
  const [modalTransf,   setModalTransf]   = useState(false);
  const bottomRef = useRef(null);

  // ── Carregar lista de conversas ──
  async function loadConversas(page = 1, append = false) {
    if (page === 1) setLoadingList(true); else setLoadingMore(true);
    try {
      const data = await apiFetch(`/instagram/conversas?page=${page}`);
      const lista = data.conversas || [];
      setConversas(prev => append ? [...prev, ...lista] : lista);
      setTotalPages(data.totalPages || 1);
      setCurrentPage(page);
    } catch (e) {
      addToast("Erro ao carregar conversas: " + e.message, "error");
    } finally {
      setLoadingList(false); setLoadingMore(false);
    }
  }

  // ── Carregar mensagens de uma conversa ──
  async function loadMsgs(igUserId) {
    setLoadingMsgs(true);
    try {
      const data = await apiFetch(`/instagram/conversas/${igUserId}`);
      setMsgs(data.mensagens || []);
      setAtivaInfo({
        igUsername:   data.conversa?.igUsername || null,
        nomeCompleto: data.conversa?.nomeCompleto || null,
        fotoPerfil:   data.conversa?.fotoPerfil || null,
        responsavelId: data.conversa?.responsavelId || null,
      });
    } catch (e) {
      addToast("Erro ao carregar mensagens: " + e.message, "error");
    } finally {
      setLoadingMsgs(false);
    }
  }

  // ── Selecionar conversa ──
  function selecionarConversa(igUserId) {
    setAtiva(igUserId);
    setMsgs([]);
    loadMsgs(igUserId);
  }

  // ── Enviar resposta ──
  async function handleEnviar(e) {
    e.preventDefault();
    if (!texto.trim() || !ativa || sending) return;
    setSending(true);
    try {
      const data = await apiFetch(`/instagram/conversas/${ativa}/reply`, {
        method: "POST",
        body: JSON.stringify({ texto }),
      });
      setMsgs(prev => [...prev, data.mensagem]);
      setTexto("");
      // Atualizar última mensagem na lista
      setConversas(prev => prev.map(c =>
        c.igUserId === ativa
          ? { ...c, ultimaMensagem: texto, ultimaAtividade: new Date().toISOString(), ultimaDirecao: "OUT", ultimoRespondidoPor: "HUMANO" }
          : c
      ));
    } catch (e) {
      addToast("Erro ao enviar: " + e.message, "error");
    } finally {
      setSending(false);
    }
  }

  // ── SSE tempo real ──
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${BASE_URL}/instagram/events?token=${encodeURIComponent(token)}`);
    es.addEventListener("ig", (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "new_message") {
        // Recarregar lista
        setCurrentPage(p => { loadConversas(p); return p; });
        // Se conversa ativa recebeu nova mensagem
        if (ev.igUserId === ativa) {
          loadMsgs(ev.igUserId);
        }
      }
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [ativa]);

  // ── Scroll para o fim ao mudar mensagens ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // ── Carregar lista e advogados ao montar ──
  useEffect(() => {
    if (!canView) return;
    loadConversas(1);
    if (isStaff(user)) {
      apiFetch("/instagram/advogados")
        .then(d => setAdvogados(d.advogados || []))
        .catch(() => {});
    }
  }, []);

  if (!canView) {
    return <div className="p-8 text-slate-500">Acesso não autorizado.</div>;
  }

  const convAtiva = conversas.find(c => c.igUserId === ativa);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-white rounded-2xl shadow-sm border border-slate-200">
      {/* ── Painel esquerdo — lista ── */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-slate-200">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-white">
            <IgIcon className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Instagram DMs</div>
            <div className="text-[10px] text-slate-400">@amradvogados_</div>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loadingList && (
            <div className="p-6 text-center text-sm text-slate-400">Carregando…</div>
          )}
          {!loadingList && conversas.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">Nenhuma conversa ainda.</div>
          )}
          {conversas.map(c => (
            <button
              key={c.igUserId}
              onClick={() => selecionarConversa(c.igUserId)}
              className={`w-full text-left px-3 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${ativa === c.igUserId ? "bg-pink-50 border-l-2 border-l-pink-500" : ""}`}
            >
              <div className="flex items-start gap-2.5">
                <IgAvatar fotoPerfil={c.fotoPerfil} nome={c.nomeCompleto} username={c.igUsername} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold text-slate-800 truncate max-w-[130px]">
                      {c.nomeCompleto || c.igUsername || c.igUserId}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-1">{fmtTime(c.ultimaAtividade)}</span>
                  </div>
                  {c.nomeCompleto && c.igUsername && (
                    <div className="text-[10px] text-slate-400 truncate mb-0.5">{c.igUsername}</div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500 truncate flex-1">
                      {c.ultimaDirecao === "OUT" ? "✓ " : ""}{c.ultimaMensagem || "…"}
                    </span>
                    {c.aguardaHumano && (
                      <span className="text-[9px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-semibold shrink-0">
                        Aguarda
                      </span>
                    )}
                    {c.unread > 0 && <Badge count={c.unread} />}
                  </div>
                </div>
              </div>
            </button>
          ))}
          {/* Paginação */}
          {totalPages > 1 && (
            <div className="p-3 flex gap-2 justify-center">
              {currentPage > 1 && (
                <button onClick={() => loadConversas(currentPage - 1)}
                  className="text-xs text-slate-500 hover:text-slate-800">← Anterior</button>
              )}
              {currentPage < totalPages && (
                <button onClick={() => loadConversas(currentPage + 1, true)}
                  className="text-xs text-pink-600 hover:text-pink-800 font-medium">Carregar mais</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Painel direito — chat ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!ativa ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
              <IgIcon className="w-7 h-7 text-white" />
            </div>
            <p className="text-sm">Selecione uma conversa para visualizar</p>
          </div>
        ) : (
          <>
            {/* Header do chat */}
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <IgAvatar fotoPerfil={ativaInfo?.fotoPerfil} nome={ativaInfo?.nomeCompleto} username={ativaInfo?.igUsername} size="lg" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {ativaInfo?.nomeCompleto || ativaInfo?.igUsername || ativa}
                  </div>
                  {ativaInfo?.nomeCompleto && ativaInfo?.igUsername && (
                    <div className="text-[11px] text-slate-400">{ativaInfo.igUsername}</div>
                  )}
                  {convAtiva?.aguardaHumano && (
                    <span className="text-[10px] text-amber-600 font-medium">Aguardando atendimento humano</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isStaff(user) && (
                  <button
                    onClick={() => setModalTransf(true)}
                    className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors"
                  >
                    Transferir
                  </button>
                )}
              </div>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {loadingMsgs && (
                <div className="text-center text-sm text-slate-400 py-6">Carregando…</div>
              )}
              {!loadingMsgs && msgs.map(m => {
                const outbound = m.direcao === "OUT";
                return (
                  <div key={m.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      outbound
                        ? "bg-gradient-to-br from-pink-600 to-purple-600 text-white rounded-br-sm"
                        : "bg-slate-100 text-slate-900 rounded-bl-sm"
                    }`}>
                      {m.tipo !== "text" && m.tipo ? (
                        <MediaBubble m={m} outbound={outbound} />
                      ) : (
                        <p className="whitespace-pre-wrap leading-snug">{m.conteudo}</p>
                      )}
                      <div className={`flex items-center gap-1 mt-1 ${outbound ? "justify-end" : "justify-start"}`}>
                        <span className={`text-[9px] ${outbound ? "text-pink-200" : "text-slate-400"}`}>
                          {fmtTime(m.criadoEm)}
                        </span>
                        {outbound && <RespondidoPorTag v={m.respondidoPor} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input de resposta */}
            <form onSubmit={handleEnviar} className="px-4 py-3 border-t border-slate-200 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-pink-300 min-h-[40px] max-h-32"
                  placeholder="Digite sua resposta…"
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  rows={1}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(e); }
                  }}
                />
                <button
                  type="submit"
                  disabled={!texto.trim() || sending}
                  className="shrink-0 h-10 px-4 rounded-xl bg-gradient-to-br from-pink-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {sending ? "…" : "Enviar"}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Enter para enviar · Shift+Enter para quebrar linha</p>
            </form>
          </>
        )}
      </div>

      {/* Modal transferir */}
      {modalTransf && ativa && (
        <ModalTransferir
          igUserId={ativa}
          igUsername={ativaInfo?.igUsername}
          advogados={advogados}
          responsavelId={ativaInfo?.responsavelId}
          onClose={() => setModalTransf(false)}
          onDone={() => {
            setModalTransf(false);
            loadConversas(currentPage);
            loadMsgs(ativa);
          }}
        />
      )}
    </div>
  );
}
