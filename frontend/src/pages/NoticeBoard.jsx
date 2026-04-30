// ============================================================
// NoticeBoard.jsx - Quadro de Avisos / Chat
// ============================================================

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { apiFetch, getUser, getToken, BASE_URL } from "../lib/api";
import { useToast } from "../components/Toast";

// import logoSrc from "../assets/logo.png";

// Hook para relógio
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
}

// Hook para localização
function useLocation() {
  const [location, setLocation] = useState("Carregando...");

  useEffect(() => {
    const fetchLocation = async () => {
      // Tenta múltiplas APIs em sequência (GPS primeiro = mais preciso)
      const apis = [
        // 1. Geolocalização do navegador com reverse geocoding (mais precisa)
        async () => {
          return new Promise((resolve) => {
            if (!navigator.geolocation) {
              resolve(null);
              return;
            }
            navigator.geolocation.getCurrentPosition(
              async (pos) => {
                try {
                  const { latitude, longitude } = pos.coords;
                  const resp = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
                    { headers: { "Accept-Language": "pt-BR" } }
                  );
                  const data = await resp.json();
                  const city = data.address?.city || data.address?.town || data.address?.village || data.address?.municipality;
                  const state = data.address?.state;
                  if (city && state) {
                    resolve(`${city}, ${state}`);
                  } else if (city) {
                    resolve(city);
                  } else {
                    resolve(null);
                  }
                } catch {
                  resolve(null);
                }
              },
              () => resolve(null),
              { timeout: 8000 }
            );
          });
        },
        // 2. ipapi.co - fallback por IP
        async () => {
          const resp = await fetch("https://ipapi.co/json/");
          const data = await resp.json();
          if (data.city && data.region) {
            return `${data.city}, ${data.region}`;
          } else if (data.city) {
            return data.city;
          }
          return null;
        },
        // 3. ipinfo.io - fallback por IP
        async () => {
          const resp = await fetch("https://ipinfo.io/json?token=");
          const data = await resp.json();
          if (data.city && data.region) {
            return `${data.city}, ${data.region}`;
          } else if (data.city) {
            return data.city;
          }
          return null;
        },
      ];

      for (const api of apis) {
        try {
          const result = await api();
          if (result) {
            setLocation(result);
            return;
          }
        } catch {
          // Tenta próxima API
        }
      }
      setLocation("Brasil");
    };
    fetchLocation();
  }, []);

  return location;
}

// Modal de vencimentos do dia
function VencimentosHojeModal({ isOpen, onClose, vencimentos }) {
  if (!isOpen) return null;
  const totalValor = vencimentos.reduce((acc, v) => acc + Number(v.valorPrevisto || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-yellow-500 to-orange-500 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📅</span>
              <div>
                <h3 className="font-bold text-lg">Vencimentos de Hoje</h3>
                <p className="text-sm text-white/80">{vencimentos.length} item(s) pendente(s)</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-2xl">&times;</button>
          </div>
        </div>
        <div className="p-6 max-h-80 overflow-auto">
          {vencimentos.length === 0 ? (
            <div className="text-center text-gray-500 py-8">Nenhum item vence hoje.</div>
          ) : (
            <div className="space-y-3">
              {vencimentos.map((v) => (
                <div key={v.id} className={`flex items-center justify-between p-3 rounded-xl border ${
                  v.tipo === "lancamento" ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"
                }`}>
                  <div>
                    <div className="font-semibold text-gray-900">{v.cliente}</div>
                    <div className="text-sm text-gray-600">
                      {v.tipo === "lancamento" ? (
                        <span className="flex items-center gap-1">
                          {v.es === "E" ? "↓ Entrada" : "↑ Saída"} • Manual
                          {v.conta && <span className="text-gray-400">• {v.conta}</span>}
                        </span>
                      ) : (
                        <span>Contrato: {v.numeroContrato} | Parcela #{v.numero}</span>
                      )}
                    </div>
                  </div>
                  <div className={`font-bold ${v.tipo === "lancamento" && v.es === "S" ? "text-red-600" : "text-green-600"}`}>
                    {Number(v.valorPrevisto || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Total: <span className="font-bold text-gray-900">
              {totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

// Função para renderizar texto com @mentions destacados
function renderMentions(text, usuarios, currentUserId) {
  if (!text) return text;
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("@")) {
      const nome = part.slice(1);
      const usuario = usuarios.find((u) => u.nome?.toLowerCase().includes(nome.toLowerCase()));
      const isMe = usuario?.id === currentUserId;
      return (
        <span key={idx} className={`font-bold ${isMe ? "text-yellow-600 bg-yellow-100 px-1 rounded" : "text-blue-600"}`}>
          {part}
        </span>
      );
    }
    return part;
  });
}

// Renderiza conteúdo de mensagem com menções e anexos
function renderMessageContent(text, usuarios, currentUserId, isMe, onError) {
  if (!text) return text;
  // Detectar [ANEXO:fileId:fileName:fileSize]
  const anexoRegex = /\[ANEXO:([^:]+):([^:]+):(\d+)\]/g;
  const hasAnexo = anexoRegex.test(text);
  if (!hasAnexo) return renderMentions(text, usuarios, currentUserId);

  // Split text into parts: text before anexo + anexo markers
  const parts = [];
  let lastIdx = 0;
  const regex = /\[ANEXO:([^:]+):([^:]+):(\d+)\]/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ type: "text", value: text.slice(lastIdx, m.index) });
    }
    parts.push({ type: "file", fileId: m[1], fileName: m[2], fileSize: Number(m[3]) });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ type: "text", value: text.slice(lastIdx) });
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  return parts.map((p, idx) => {
    if (p.type === "text") {
      const trimmed = p.value.trim();
      if (!trimmed) return null;
      return <span key={idx}>{renderMentions(trimmed, usuarios, currentUserId)}</span>;
    }
    // File attachment
    const downloadUrl = `${BASE_URL}/noticeboard/files/${p.fileId}`;
    const token = getToken();
    return (
      <div key={idx} className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border ${
        isMe ? "border-blue-400/50 bg-blue-500/30" : "border-gray-300 bg-gray-50"
      }`}>
        <span className="text-lg">📎</span>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium truncate ${isMe ? "text-white" : "text-gray-900"}`}>{p.fileName}</div>
          <div className={`text-xs ${isMe ? "text-blue-200" : "text-gray-500"}`}>{fmtSize(p.fileSize)}</div>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              const resp = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
              if (!resp.ok) throw new Error("Arquivo expirado ou não encontrado.");
              const blob = await resp.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = p.fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch (err) {
              if (onError) onError(err?.message || "Erro ao baixar arquivo.", "error");
            }
          }}
          className={`shrink-0 px-2 py-1 rounded-lg text-xs font-semibold transition ${
            isMe ? "bg-white/20 text-white hover:bg-white/30" : "bg-blue-100 text-blue-700 hover:bg-blue-200"
          }`}
        >
          Baixar
        </button>
      </div>
    );
  });
}

// ── Emoji Picker ─────────────────────────────────────────────
const EMOJI_CATS = [
  { icon: "😀", emojis: ["😀","😁","😂","🤣","😊","😍","🥰","😎","🤔","😮","😢","😭","😤","😠","🤬","😱","🥳","🥺","😴","🫡","😌","😔","😏","😅","🙄","🥹","😇","🤩","🫠","😶","🤐","🥴","😒","🤦","🤷","🙃","😬","😋","🤑","😵","🥸"] },
  { icon: "👍", emojis: ["👍","👎","❤️","🧡","💛","💚","💙","💜","🖤","❤️‍🔥","🙌","👏","🤝","✌️","🤞","👌","🤌","🫶","🙏","💪","🫂","✊","👊","🤜","🤛","☝️","👆","👇","👈","👉","🫵","🤙","🖖","💅","🫳","🫴","🤏","🫷","🫸"] },
  { icon: "🔥", emojis: ["🔥","⭐","💯","✅","❌","⚠️","❓","❗","💡","📌","🗓️","📊","💰","💼","🔔","📣","🎯","🏆","🚀","🎉","🔑","⏳","⏰","✔️","💬","🔄","📋","💎","🎁","🏅","💥","🌟","🎵","🎬","📷","🤖","🆗","🆙","🆕","🔁","📍","🔖"] },
  { icon: "🐶", emojis: ["🐶","🐱","🐭","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐸","🐔","🦋","🐝","🌸","🌺","🌻","☀️","🌙","🌈","❄️","💧","🌊","🍎","🍕","☕","🎂","🍻","🌍","🏖️","🏔️","🌲","🌵","🌴","🍀","🌮","🍣","🧃","🍦"] },
];
const QUICK_EMOJIS = ["👍","❤️","😂","😮","😢"];

function EmojiPickerPopup({ isMe, onSelect, onClose }) {
  const [cat, setCat] = React.useState(0);
  const ref = React.useRef(null);
  React.useEffect(() => {
    function handleDown(e) {
      if (e.target.closest("[data-picker-toggle]")) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);
  return (
    <div ref={ref} style={{
      position: "absolute",
      [isMe ? "right" : "left"]: 0,
      bottom: "calc(100% + 2px)",
      zIndex: 200,
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 14,
      boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
      width: 268,
      padding: 10,
    }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, borderBottom: "1px solid #f3f4f6", paddingBottom: 8 }}>
        {EMOJI_CATS.map((c, i) => (
          <button key={i} onMouseDown={e => { e.preventDefault(); setCat(i); }} style={{
            flex: 1, fontSize: 18, padding: "3px 0", borderRadius: 8, border: "none",
            background: cat === i ? "#eff6ff" : "transparent", cursor: "pointer",
          }}>{c.icon}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 1, maxHeight: 168, overflowY: "auto" }}>
        {EMOJI_CATS[cat].emojis.map(emoji => (
          <button key={emoji} onMouseDown={e => { e.preventDefault(); onSelect(emoji); }}
            style={{ fontSize: 20, padding: "4px 5px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", lineHeight: 1 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f3f4f6"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >{emoji}</button>
        ))}
      </div>
    </div>
  );
}

// Componente principal
export default function NoticeBoard({ user: propUser }) {
  const user = propUser || getUser();
  const { addToast } = useToast();
  const clock = useClock();
  const location = useLocation();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const isSecretaria = user?.tipoUsuario === "SECRETARIA_VIRTUAL";

  // Estados
  const [usuarios, setUsuarios] = useState([]);
  const [mensagensAll, setMensagensAll] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [vencimentos, setVencimentos] = useState({ grupos: {}, total: 0 });
  const [vencimentosHoje, setVencimentosHoje] = useState([]);
  const [showVencimentosModal, setShowVencimentosModal] = useState(false);

  const [hoveredMsg, setHoveredMsg] = useState(null); // id da mensagem com picker aberto
  const [pickerOpenId, setPickerOpenId] = useState(null); // id da mensagem com picker completo aberto

  const [activeTab, setActiveTab] = useState("chat"); // "chat" | "avisos"
  const [activeChat, setActiveChat] = useState(null);
  const [novaMensagem, setNovaMensagem] = useState("");
  const [novoAviso, setNovoAviso] = useState("");
  const [requerConfirmacao, setRequerConfirmacao] = useState(false);
  const [digitando, setDigitando] = useState(false);
  const [loading, setLoading] = useState(true);

  // Notificações do sistema
  const [notifPermission, setNotifPermission] = useState(
    () => (typeof Notification !== "undefined" ? Notification.permission : "denied")
  );

  // Estados para menção @usuario
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [mentionSource, setMentionSource] = useState("aviso"); // "aviso" | "chat"

  // File attachment
  const [pendingFile, setPendingFile] = useState(null); // { fileId, fileName, fileSize, mimeType }
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Reply to message
  const [replyingTo, setReplyingTo] = useState(null); // { id, conteudo, remetente }
  const [hoveredMsgId, setHoveredMsgId] = useState(null);
  const inputRef = useRef(null);

  const chatContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pollingRef = useRef(null);
  const avisoInputRef = useRef(null);
  const lastMsgIdsRef = useRef(null);   // null = not yet initialized
  const lastAvisoIdsRef = useRef(null);
  const lastSinceRef = useRef(null);    // ISO timestamp do último fetch de msgs

  // --- Browser notifications helpers ---
  function fireNotification(items, type) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const count = items.length;
    const title =
      type === "mensagem"
        ? count === 1 ? "1 nova mensagem" : `${count} novas mensagens`
        : count === 1 ? "1 novo aviso" : `${count} novos avisos`;
    const body =
      count === 1
        ? type === "mensagem"
          ? `${items[0].remetente?.nome || "Alguém"}: ${previewFromConteudo(items[0].conteudo)}`
          : previewFromConteudo(items[0].conteudo)
        : `${count} ${type === "mensagem" ? "mensagens novas" : "avisos novos"} no Notice Board`;
    const notif = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: `noticeboard-${type}`,
      renotify: true,
    });
    notif.onclick = () => { window.focus(); notif.close(); };
  }

  async function requestNotifPermission() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }
  // --- end helpers ---

  // Carregar dados
  useEffect(() => {
    loadData();
    pollingRef.current = setInterval(() => {
      loadMensagens(true); // incremental — só msgs novas desde o último fetch
      loadAvisos();
      loadUsuarios();
      if (isAdmin) {
        loadVencimentos();
        loadVencimentosHoje();
      }
    }, 3000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [activeChat]);

  useEffect(() => {
    if (isAdmin && vencimentosHoje.length > 0) {
      const shown = sessionStorage.getItem("vencimentos_modal_shown");
      if (!shown) {
        setShowVencimentosModal(true);
        sessionStorage.setItem("vencimentos_modal_shown", "1");
      }
    }
  }, [isAdmin, vencimentosHoje]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [mensagensAll, avisos, activeTab]);

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([
        loadUsuarios(),
        loadMensagens(),
        loadAvisos(),
        isAdmin && loadVencimentos(),
        isAdmin && loadVencimentosHoje(),
      ]);
    } catch (e) {
      console.error("Erro ao carregar dados:", e);
    } finally {
      setLoading(false);
    }
  }

  async function loadUsuarios() {
    try {
      const data = await apiFetch("/noticeboard/usuarios");
      setUsuarios(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Erro ao carregar usuários:", e);
    }
  }

  async function loadMensagens(incremental = false) {
    try {
      const fetchedAt = new Date().toISOString();
      const url = incremental && lastSinceRef.current
        ? `/noticeboard/mensagens?since=${encodeURIComponent(lastSinceRef.current)}`
        : "/noticeboard/mensagens?limit=50";

      const data = await apiFetch(url);
      const msgs = Array.isArray(data) ? data : [];
      lastSinceRef.current = fetchedAt;

      if (!incremental) {
        // Carga completa — substitui estado
        if (lastMsgIdsRef.current !== null) {
          const newMsgs = msgs.filter(
            (m) => !lastMsgIdsRef.current.has(m.id) && m.remetenteId !== user?.id
          );
          if (newMsgs.length > 0 && (!document.hasFocus() || document.hidden)) {
            fireNotification(newMsgs, "mensagem");
          }
        }
        lastMsgIdsRef.current = new Set(msgs.map((m) => m.id));
        setMensagensAll(msgs);
        marcarLidasDoChat(activeChat, msgs);
      } else if (msgs.length > 0) {
        // Incremental — só acrescenta mensagens novas
        const newMsgs = msgs.filter(
          (m) => !lastMsgIdsRef.current?.has(m.id) && m.remetenteId !== user?.id
        );
        if (newMsgs.length > 0 && (!document.hasFocus() || document.hidden)) {
          fireNotification(newMsgs, "mensagem");
        }
        if (lastMsgIdsRef.current) for (const m of msgs) lastMsgIdsRef.current.add(m.id);
        setMensagensAll((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const toAdd = msgs.filter((m) => !existingIds.has(m.id));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
        marcarLidasDoChat(activeChat, msgs);
      }
    } catch (e) {
      console.error("Erro ao carregar mensagens:", e);
    }
  }

  async function marcarLidasDoChat(chatId, msgs) {
    const pool = Array.isArray(msgs) ? msgs : mensagensAll;
    const unread = pool.filter(m => {
      if (chatId === null) {
        // Chat geral: broadcast de outros usuários ainda não lidas
        return m.destinatarioId === null && m.remetenteId !== user?.id && !m.lidoPorMim;
      }
      // Chat privado: mensagens desse usuário para mim ainda não lidas
      return m.remetenteId === chatId && m.destinatarioId === user?.id && !m.lidoPorMim;
    });
    if (unread.length === 0) return;
    try {
      await apiFetch("/noticeboard/mensagens/marcar-lidas", {
        method: "PUT",
        body: { mensagemIds: unread.map(m => m.id) },
      });
      // Atualiza estado local otimisticamente
      const readSet = new Set(unread.map(m => m.id));
      setMensagensAll(prev => prev.map(m => readSet.has(m.id) ? { ...m, lidoPorMim: true } : m));
    } catch {
      // ignora silenciosamente
    }
  }

  async function loadAvisos() {
    try {
      const data = await apiFetch("/noticeboard/avisos");
      const list = Array.isArray(data) ? data : [];
      if (lastAvisoIdsRef.current !== null) {
        const newAvisos = list.filter(
          (a) => !lastAvisoIdsRef.current.has(a.id) && a.remetente?.id !== user?.id
        );
        if (newAvisos.length > 0 && (!document.hasFocus() || document.hidden)) {
          fireNotification(newAvisos, "aviso");
        }
      }
      lastAvisoIdsRef.current = new Set(list.map((a) => a.id));
      setAvisos(list);
    } catch (e) {
      console.error("Erro ao carregar avisos:", e);
    }
  }

  async function loadVencimentos() {
    try {
      const data = await apiFetch("/noticeboard/vencimentos");
      setVencimentos(data || { grupos: {}, total: 0 });
    } catch (e) {
      console.error("Erro ao carregar vencimentos:", e);
    }
  }

  async function loadVencimentosHoje() {
    try {
      const data = await apiFetch("/noticeboard/vencimentos-hoje");
      setVencimentosHoje(data?.parcelas || []);
    } catch (e) {
      console.error("Erro ao carregar vencimentos de hoje:", e);
    }
  }

  const updatePresenca = useCallback(async (isDigitando = false) => {
    try {
      await apiFetch("/noticeboard/presenca", {
        method: "PUT",
        body: { online: true, digitando: isDigitando, digitandoPara: activeChat },
      });
    } catch (e) {
      console.error("Erro ao atualizar presença:", e);
    }
  }, [activeChat]);

  useEffect(() => {
    updatePresenca(false);
    return () => {
      apiFetch("/noticeboard/presenca", {
        method: "PUT",
        body: { online: false, digitando: false },
      }).catch(() => {});
    };
  }, [updatePresenca]);

  function handleDigitando(e) {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setNovaMensagem(value);

    // Detecta @ para mencionar
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      if (!textAfterAt.includes(" ")) {
        setMentionSource("chat");
        setShowMentionList(true);
        setMentionFilter(textAfterAt.toLowerCase());
        setMentionCursorPos(atIndex);
        setSelectedMentionIndex(0);
        if (!digitando) { setDigitando(true); updatePresenca(true); }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => { setDigitando(false); updatePresenca(false); }, 2000);
        return;
      }
    }
    setShowMentionList(false);
    setMentionFilter("");

    if (!digitando) {
      setDigitando(true);
      updatePresenca(true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setDigitando(false);
      updatePresenca(false);
    }, 2000);
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      addToast("Arquivo muito grande. Máximo 10MB.", "error");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiFetch("/noticeboard/upload", { method: "POST", body: formData });
      setPendingFile(result);
    } catch (err) {
      console.error("Erro ao fazer upload:", err);
      addToast(err?.message || "Erro ao fazer upload.", "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function reagir(mensagemId, emoji) {
    // Optimistic update
    setMensagensAll(prev => prev.map(m => {
      if (m.id !== mensagemId) return m;
      const reacoes = m.reacoes ? [...m.reacoes] : [];
      const idx = reacoes.findIndex(r => r.emoji === emoji && r.usuarioId === user?.id);
      if (idx >= 0) {
        reacoes.splice(idx, 1);
      } else {
        reacoes.push({ id: Date.now(), emoji, usuarioId: user?.id, usuario: { id: user?.id, nome: user?.nome || "Você" } });
      }
      return { ...m, reacoes };
    }));
    try {
      await apiFetch(`/noticeboard/mensagens/${mensagemId}/reagir`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
    } catch (e) {
      addToast("Erro ao reagir", "error");
      loadMensagens(); // revert on error
    }
  }

  async function enviarMensagem(e) {
    e.preventDefault();
    if (!novaMensagem.trim() && !pendingFile) return;
    try {
      let conteudo = novaMensagem.trim();
      if (pendingFile) {
        const marker = `[ANEXO:${pendingFile.fileId}:${pendingFile.fileName}:${pendingFile.fileSize}]`;
        conteudo = conteudo ? `${conteudo}\n${marker}` : marker;
      }
      await apiFetch("/noticeboard/mensagens", {
        method: "POST",
        body: { conteudo, destinatarioId: activeChat, replyToId: replyingTo?.id || null },
      });
      setNovaMensagem("");
      setPendingFile(null);
      setReplyingTo(null);
      setDigitando(false);
      await loadMensagens();
    } catch (e) {
      console.error("Erro ao enviar mensagem:", e);
      addToast(e?.message || "Erro ao enviar mensagem", "error");
    }
  }

  async function enviarAviso(e) {
    e.preventDefault();
    if (!novoAviso.trim()) return;
    try {
      await apiFetch("/noticeboard/avisos", {
        method: "POST",
        body: { conteudo: novoAviso.trim(), requerConfirmacao },
      });
      setNovoAviso("");
      setRequerConfirmacao(false);
      await loadAvisos();
    } catch (e) {
      console.error("Erro ao enviar aviso:", e);
      addToast(e?.message || "Erro ao enviar aviso", "error");
    }
  }

  async function confirmarLeitura(mensagemId) {
    try {
      await apiFetch(`/noticeboard/mensagens/${mensagemId}/confirmar`, { method: "POST" });
      await loadAvisos();
    } catch (e) {
      console.error("Erro ao confirmar leitura:", e);
    }
  }

  // Função para lidar com mudanças no input de aviso (detecta @)
  function handleAvisoChange(e) {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setNovoAviso(value);

    // Procura por @ antes do cursor
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      // Verifica se não há espaço após o @
      if (!textAfterAt.includes(" ")) {
        setMentionSource("aviso");
        setShowMentionList(true);
        setMentionFilter(textAfterAt.toLowerCase());
        setMentionCursorPos(atIndex);
        setSelectedMentionIndex(0);
        return;
      }
    }
    setShowMentionList(false);
    setMentionFilter("");
  }

  // Função para lidar com teclas especiais no input de aviso
  function handleAvisoKeyDown(e) {
    if (!showMentionList) return;

    const filteredUsers = usuarios.filter(
      (u) => u.id !== user?.id && u.nome?.toLowerCase().includes(mentionFilter)
    );

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedMentionIndex((prev) => Math.min(prev + 1, filteredUsers.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedMentionIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filteredUsers.length > 0) {
      e.preventDefault();
      insertMention(filteredUsers[selectedMentionIndex]);
    } else if (e.key === "Escape") {
      setShowMentionList(false);
    }
  }

  // Insere a menção no texto
  function insertMention(usuario) {
    const isChat = mentionSource === "chat";
    const currentText = isChat ? novaMensagem : novoAviso;
    const beforeAt = currentText.slice(0, mentionCursorPos);
    const afterCursor = currentText.slice(mentionCursorPos + 1 + mentionFilter.length);
    const newText = `${beforeAt}@${usuario.nome} ${afterCursor}`;
    if (isChat) setNovaMensagem(newText);
    else setNovoAviso(newText);
    setShowMentionList(false);
    setMentionFilter("");

    // Foca no input e posiciona o cursor
    const ref = isChat ? inputRef : avisoInputRef;
    setTimeout(() => {
      if (ref.current) {
        ref.current.focus();
        const newCursorPos = mentionCursorPos + usuario.nome.length + 2;
        ref.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }

  // Lista filtrada de usuários para menção
  const filteredMentionUsers = useMemo(() => {
    return usuarios.filter(
      (u) => u.id !== user?.id && u.nome?.toLowerCase().includes(mentionFilter)
    );
  }, [usuarios, user?.id, mentionFilter]);

  const mensagensFiltradas = useMemo(() => {
    const all = mensagensAll || [];
    const myId = user?.id;

    // Chat geral = destinatarioId null
    if (!activeChat) {
      return all.filter((m) => m.destinatarioId == null);
    }

    // Chat privado = conversa entre eu e activeChat
    return all.filter((m) => {
      const a = m.remetenteId;
      const b = m.destinatarioId;
      return (
        (a === myId && b === activeChat) ||
        (a === activeChat && b === myId)
      );
    });
  }, [mensagensAll, activeChat, user?.id]);

  const usuariosDigitando = useMemo(() => {
    return usuarios.filter((u) => u.digitando && u.id !== user?.id);
  }, [usuarios, user?.id]);

  function formatHora(date) {
    // Append T12:00:00 to avoid timezone shift issues if no time component
    const str = String(date).includes("T") ? date : `${date}T12:00:00`;
    const d = new Date(str);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function formatData(date) {
    // Append T12:00:00 to avoid timezone shift issues if no time component
    const str = String(date).includes("T") ? date : `${date}T12:00:00`;
    const d = new Date(str);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function previewFromConteudo(conteudo) {
    if (!conteudo) return "";
    // se tiver anexo, simplifica
    if (/\[ANEXO:/.test(conteudo)) return "📎 Anexo";
    // tira quebras e reduz
    const oneLine = String(conteudo).replace(/\s+/g, " ").trim();
    return oneLine.length > 60 ? oneLine.slice(0, 60) + "…" : oneLine;
  }

  function previewReply(conteudo) {
    if (!conteudo) return "";
    if (/\[ANEXO:/.test(conteudo)) return "📎 Anexo";
    const oneLine = String(conteudo).replace(/\s+/g, " ").trim();
    return oneLine.length > 80 ? oneLine.slice(0, 80) + "…" : oneLine;
  }

  const lastMessageByUserId = useMemo(() => {
    const myId = user?.id;
    const map = new Map();

    for (const m of mensagensAll || []) {
      // só considera privadas
      if (m.destinatarioId == null) continue;

      const otherId =
        m.remetenteId === myId ? m.destinatarioId :
        m.destinatarioId === myId ? m.remetenteId :
        null;

      if (!otherId) continue;

      const prev = map.get(otherId);
      const mTime = new Date(m.createdAt).getTime();
      const prevTime = prev ? new Date(prev.createdAt).getTime() : -Infinity;

      if (!prev || mTime > prevTime) {
        map.set(otherId, m);
      }
    }

    return map;
  }, [mensagensAll, user?.id]);

  const usuarioAtivo = activeChat ? usuarios.find((u) => u.id === activeChat) : null;
  const canPostAvisos = true;

    // ==========================
  // Avatar / usuário helpers
  // ==========================
  const usuariosById = useMemo(() => {
    const map = new Map();
    for (const u of usuarios) map.set(u.id, u);
    return map;
  }, [usuarios]);

  function pickAvatar(obj) {
    return (
      obj?.avatarUrl ||
      obj?.avatar_url ||
      obj?.avatar ||
      obj?.fotoUrl ||
      obj?.foto_url ||
      null
    );
  }

  function getInitials(name = "") {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function resolveUserById(id) {
    if (!id) return null;
    return usuariosById.get(id) || null;
  }

  function resolveAvatarByUserId(id) {
    const u = resolveUserById(id);
    return pickAvatar(u);
  }

  // "m.remetente" às vezes vem sem avatar. Então montamos um "remetente resolvido"
  function resolveSender(m) {
    return m?.remetente || resolveUserById(m?.remetenteId) || null;
  }

  const destinatarioAtivo = activeChat ? resolveUserById(activeChat) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-700 to-blue-800 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Controle Financeiro - Notice Board</h1>
              <p className="text-sm text-blue-200">Quadro de Avisos e Chat</p>
            </div>
            <div className="flex items-center gap-4 text-sm flex-wrap justify-end">
              {/* Info pills */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
                  <span className="text-blue-200 mr-2">📅</span>
                  <span className="font-semibold">{clock.date}</span>
                </span>

                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
                  <span className="text-blue-200 mr-2">⏰</span>
                  <span className="font-semibold">{clock.time}</span>
                </span>

                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm max-w-[260px] truncate">
                  <span className="text-blue-200 mr-2">📍</span>
                  <span className="font-semibold">{location}</span>
                </span>
              </div>

              {/* Bell / notification permission */}
              {typeof Notification !== "undefined" && notifPermission !== "granted" && notifPermission !== "denied" && (
                <button
                  onClick={requestNotifPermission}
                  title="Ativar notificações do sistema"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-yellow-400/20 border border-yellow-300/40 text-yellow-200 hover:bg-yellow-400/30 text-xs font-semibold transition"
                >
                  🔔 Ativar notificações
                </button>
              )}
              {typeof Notification !== "undefined" && notifPermission === "granted" && (
                <span title="Notificações ativas" className="px-2 py-1 rounded-full bg-green-500/20 border border-green-400/30 text-green-200 text-xs">
                  🔔
                </span>
              )}

              {/* User block */}
              <div className="flex items-center gap-3 pl-4 ml-2 border-l border-white/20">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.nome}
                    className="w-10 h-10 rounded-full object-cover border-2 border-white/30"
                  />
                ) : (
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${isAdmin ? "bg-purple-500" : "bg-blue-500"}`}>
                    {getInitials(user?.nome)}
                  </div>
                )}
                <div className="leading-tight">
                  <div className="font-semibold">{user?.nome || "Usuário"}</div>
                  <div className="text-xs text-blue-200">
                    {isSecretaria ? "Secretária Virtual" : isAdmin ? "Administrador" : "Usuário"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna esquerda */}
          <div className="space-y-6">
            {/* Resumo de Lançamentos - Admin Only */}
            {isAdmin && (
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                <div className="bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3 text-white">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold flex items-center gap-2">
                      <span>📊</span> Resumo de Lançamentos
                    </h2>
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{vencimentos.total} total</span>
                  </div>
                </div>
                <div className="p-4 max-h-64 overflow-auto">
                  {loading ? (
                    <div className="text-center py-4 text-gray-500">Carregando...</div>
                  ) : vencimentos.total === 0 ? (
                    <div className="text-center py-4 text-gray-500">Nenhuma parcela pendente.</div>
                  ) : (
                    <div className="space-y-3">
                      {["Atrasada", "Vencimento hoje", "Próximo do vencimento"].map((grupo) => {
                        const items = vencimentos.grupos?.[grupo] || [];
                        if (items.length === 0) return null;
                        const colors = {
                          "Atrasada": { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50 border-red-100" },
                          "Vencimento hoje": { dot: "bg-yellow-500", text: "text-yellow-700", bg: "bg-yellow-50 border-yellow-100" },
                          "Próximo do vencimento": { dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50 border-blue-100" },
                        };
                        const c = colors[grupo];
                        return (
                          <div key={grupo}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`w-2 h-2 rounded-full ${c.dot}`}></span>
                              <span className={`font-semibold text-sm ${c.text}`}>{grupo} ({items.length})</span>
                            </div>
                            <div className="space-y-1 pl-4">
                              {items.map((p) => (
                                <div key={p.id} className={`${c.bg} border rounded-lg p-2 text-xs`}>
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <span className="font-medium block truncate">{p.cliente?.nomeRazaoSocial || "—"}</span>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className="text-gray-500 text-[10px]">
                                          {p.tipo === "lancamento"
                                            ? `${p.es === "E" ? "↓ Entrada" : "↑ Saída"} • Manual`
                                            : p.numeroContrato ? `Contrato #${p.numeroContrato}` : ""}
                                        </span>
                                        {p.vencimento && (
                                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.text} bg-white/60`}>
                                            📅 {new Date(p.vencimento).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <span className={`font-bold whitespace-nowrap ${p.tipo === "lancamento" && p.es === "S" ? "text-red-600" : ""}`}>
                                      {Number(p.valorPrevisto || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Lista de Usuários */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-green-500 to-teal-500 px-4 py-3 text-white">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold flex items-center gap-2"><span>👥</span> Usuários</h2>
                  {activeChat && (
                    <button onClick={() => setActiveChat(null)} className="text-xs bg-white/20 px-2 py-1 rounded-full hover:bg-white/30">
                      Chat Geral
                    </button>
                  )}
                </div>
                <p className="text-xs text-green-100 mt-1">Clique para chat privado | Use @nome para mencionar</p>
              </div>
              <div className="p-4 max-h-80 overflow-auto">
                {usuarios.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">Nenhum usuário encontrado.</div>
                ) : (
                  <div className="space-y-2">
                    {usuarios.map((u) => {
                      const isSelected = u.id === activeChat;
                      const isMe = u.id === user?.id;
                      const isSecretariaVirtual = u.tipoUsuario === "SECRETARIA_VIRTUAL";
                      const lastMsg = lastMessageByUserId.get(u.id);
                      const lastIsMe = lastMsg?.remetenteId === user?.id;
                      const lastText = lastMsg ? previewFromConteudo(lastMsg.conteudo) : "";
                      const directionLabel = lastMsg
                        ? (lastIsMe ? `Você → ${u.nome}` : `${u.nome} → Você`)
                        : "";
                      const unreadCount = mensagensAll.filter(
                        m => m.remetenteId === u.id && m.destinatarioId === user?.id && !m.lidoPorMim
                      ).length;

                      return (
                        <button
                          key={u.id}
                          onClick={() => { if (!isMe) setActiveChat(isSelected ? null : u.id); }}
                          disabled={isMe}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all border-2 ${
                            isSelected ? "bg-blue-100 border-blue-500 shadow-md"
                            : isMe ? "bg-gray-50 border-transparent cursor-not-allowed opacity-60"
                            : "bg-gray-50 border-transparent hover:bg-blue-50 hover:border-blue-200 cursor-pointer"
                          }`}
                        >
                          <div className="relative">
                            {u.avatarUrl && !isSecretariaVirtual ? (
                              <img
                                src={u.avatarUrl}
                                alt={u.nome}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
                                isSecretariaVirtual ? "bg-pink-500" : u.role === "ADMIN" ? "bg-purple-500" : "bg-blue-500"
                              }`}>
                                {isSecretariaVirtual ? "🤖" : getInitials(u.nome)}
                              </div>
                            )}
                            {u.online && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>}
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <div className="font-semibold text-gray-900 flex items-center gap-2">
                              {u.nome || "Usuário"}
                              {isMe && <span className="text-xs text-gray-500">(você)</span>}
                              {isSelected && <span className="text-xs text-blue-600 font-bold">CHAT ATIVO</span>}
                            </div>
                            <div className="text-xs text-gray-500">
                              {lastMsg ? (
                                <span className="block truncate">
                                  <span className="font-semibold text-gray-700">{directionLabel}</span>
                                  <span className="text-gray-400"> • </span>
                                  <span className="text-gray-600">{lastText}</span>
                                </span>
                              ) : (
                                <span>
                                  {isSecretariaVirtual ? "Secretária Virtual" : u.role === "ADMIN" ? "Administrador" : "Usuário"}
                                </span>
                              )}

                              {u.digitando && !isMe && (
                                <span className="text-blue-500 animate-pulse ml-2">digitando...</span>
                              )}
                            </div>

                          </div>
                          {unreadCount > 0 && !isSelected ? (
                            <span className="shrink-0 bg-blue-600 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                              {unreadCount > 9 ? "9+" : unreadCount}
                            </span>
                          ) : (u.online && !isMe && <span className="text-xs text-green-600 font-medium">Online</span>)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Coluna direita: Tabs Chat/Avisos */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden h-full flex flex-col" style={{ minHeight: "600px" }}>
              {/* Tabs */}
              <div className="flex border-b">
                <button
                  onClick={() => setActiveTab("chat")}
                  className={`flex-1 px-4 py-3 font-semibold text-sm transition-all ${
                    activeTab === "chat" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  💬 Chat {activeChat ? `(${usuarioAtivo?.nome})` : "(Geral)"}
                </button>
                <button
                  onClick={() => setActiveTab("avisos")}
                  className={`flex-1 px-4 py-3 font-semibold text-sm transition-all ${
                    activeTab === "avisos" ? "bg-pink-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  📢 Avisos da Secretária ({avisos.filter((a) => !a.confirmadoPorMim && a.requerConfirmacao).length} pendente)
                </button>
              </div>

              {/* Header contextual do chat (privado) */}
              {activeTab === "chat" && activeChat && (
                <div className="px-4 py-3 border-b bg-white flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar do destinatário */}
                  {(() => {
                    const isSV = destinatarioAtivo?.tipoUsuario === "SECRETARIA_VIRTUAL";
                    const avatar = pickAvatar(destinatarioAtivo);
                    if (isSV) {
                      return (
                        <div className="w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center text-white font-bold">
                          🤖
                        </div>
                      );
                    }
                    if (avatar) {
                      return (
                        <img
                          src={avatar}
                          alt={destinatarioAtivo?.nome || "Destinatário"}
                          className="w-10 h-10 rounded-full object-cover border border-gray-200"
                        />
                      );
                    }
                    return (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${destinatarioAtivo?.role === "ADMIN" ? "bg-purple-500" : "bg-blue-500"}`}>
                        {getInitials(destinatarioAtivo?.nome)}
                      </div>
                    );
                  })()}

                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">
                        {destinatarioAtivo?.nome || "Chat Privado"}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        Você → {destinatarioAtivo?.nome || "—"}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveChat(null)}
                    className="text-xs px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold"
                    title="Voltar para o Chat Geral"
                  >
                    Chat Geral
                  </button>
                </div>
              )}

              {/* Área de conteúdo */}
              <div ref={chatContainerRef} className="flex-1 p-4 overflow-auto bg-gray-50">
                {activeTab === "chat" ? (
                  // Chat
                  loading ? (
                    <div className="flex items-center justify-center h-full text-gray-500">Carregando...</div>
                  ) : mensagensFiltradas.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <div className="text-center">
                        <span className="text-4xl mb-2 block">💬</span>
                        <p>Nenhuma mensagem ainda.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {mensagensFiltradas.map((m, idx) => {
                        const isMe = m.remetenteId === user?.id;
                        const isSecretariaMsg = m.remetente?.tipoUsuario === "SECRETARIA_VIRTUAL";
                        const showDate = idx === 0 || formatData(m.createdAt) !== formatData(mensagensFiltradas[idx - 1].createdAt);
                        const isMentioned = m.mencionados?.includes(user?.id);
                        const isHovered = hoveredMsgId === m.id;

                        const remetenteAvatar =
                          usuariosById.get(m.remetenteId)?.avatarUrl ||
                          m.remetente?.avatarUrl ||
                          null;

                        return (
                          <React.Fragment key={m.id}>
                            {showDate && (
                              <div className="flex justify-center my-4">
                                <span className="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">{formatData(m.createdAt)}</span>
                              </div>
                            )}

                            <div
                              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                              onMouseEnter={() => setHoveredMsgId(m.id)}
                              onMouseLeave={() => setHoveredMsgId(null)}
                            >
                              {/* Botão reply — aparece no hover, lado oposto ao remetente */}
                              <div className={`flex items-center ${isMe ? "order-first mr-1" : "order-last ml-1"}`}>
                                {isHovered && (
                                  <button
                                    type="button"
                                    title="Responder"
                                    onClick={() => {
                                      setReplyingTo({
                                        id: m.id,
                                        conteudo: m.conteudo,
                                        remetente: m.remetente || resolveSender(m),
                                      });
                                      inputRef.current?.focus();
                                    }}
                                    className="p-1.5 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs transition"
                                  >
                                    ↩
                                  </button>
                                )}
                              </div>

                              <div className={`flex items-end gap-2 max-w-[85%] ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                                {/* Avatar */}
                                {(() => {
                                  const isSV = isMe
                                    ? user?.tipoUsuario === "SECRETARIA_VIRTUAL"
                                    : (resolveSender(m)?.tipoUsuario === "SECRETARIA_VIRTUAL");

                                  const avatar = isMe
                                    ? (pickAvatar(user) || user?.avatarUrl || null)
                                    : (pickAvatar(resolveSender(m)) || remetenteAvatar || null);

                                  if (isSV) {
                                    return (
                                      <div className="w-8 h-8 rounded-full bg-pink-500 flex items-center justify-center text-white font-bold">
                                        🤖
                                      </div>
                                    );
                                  }

                                  if (avatar) {
                                    return (
                                      <img
                                        src={avatar}
                                        alt={isMe ? (user?.nome || "Você") : (resolveSender(m)?.nome || "Usuário")}
                                        className="w-8 h-8 rounded-full object-cover border border-white/40"
                                      />
                                    );
                                  }

                                  const letter = isMe
                                    ? getInitials(user?.nome)
                                    : getInitials(resolveSender(m)?.nome);

                                  const role = isMe ? user?.role : resolveSender(m)?.role;

                                  return (
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                                      role === "ADMIN" ? "bg-purple-500" : "bg-blue-500"
                                    }`}>
                                      {letter}
                                    </div>
                                  );
                                })()}

                                {/* Conteúdo */}
                                <div
                                  className={`max-w-[70%] ${isMentioned && !isMe ? "ring-2 ring-yellow-400 ring-offset-2 rounded-2xl" : ""}`}
                                  style={{ position: "relative" }}
                                  onMouseEnter={() => setHoveredMsg(m.id)}
                                  onMouseLeave={() => { if (pickerOpenId !== m.id) setHoveredMsg(null); }}
                                >
                                  {/* Cabeçalho só no lado do outro (nome/labels) */}
                                  {!isMe && (
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-xs font-semibold text-gray-700">
                                        {resolveSender(m)?.nome || "Usuário"}
                                      </span>
                                      {isSecretariaMsg && (
                                        <span className="text-xs bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">Secretária</span>
                                      )}
                                      {resolveSender(m)?.role === "ADMIN" && !isSecretariaMsg && (
                                        <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Admin</span>
                                      )}
                                    </div>
                                  )}

                                  {/* Picker de emoji (aparece no hover) */}
                                  {(hoveredMsg === m.id || pickerOpenId === m.id) && (
                                    <div className={`flex gap-1 mb-1 items-center ${isMe ? "justify-end" : "justify-start"}`}>
                                      {QUICK_EMOJIS.map(emoji => (
                                        <button
                                          key={emoji}
                                          onMouseDown={e => { e.preventDefault(); reagir(m.id, emoji); }}
                                          className="text-base leading-none bg-white border border-gray-200 rounded-full w-7 h-7 flex items-center justify-center hover:bg-gray-100 shadow-sm transition"
                                          title={emoji}
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                      <button
                                        data-picker-toggle
                                        onMouseDown={e => { e.preventDefault(); setPickerOpenId(prev => prev === m.id ? null : m.id); }}
                                        className="text-sm font-bold bg-white border border-gray-200 rounded-full w-7 h-7 flex items-center justify-center hover:bg-gray-100 shadow-sm transition text-gray-400"
                                        title="Mais emojis"
                                      >
                                        +
                                      </button>
                                      {pickerOpenId === m.id && (
                                        <EmojiPickerPopup
                                          isMe={isMe}
                                          onSelect={emoji => { reagir(m.id, emoji); setPickerOpenId(null); setHoveredMsg(null); }}
                                          onClose={() => { setPickerOpenId(null); setHoveredMsg(null); }}
                                        />
                                      )}
                                    </div>
                                  )}

                                  <div className={`rounded-2xl px-4 py-2 ${
                                    isMe
                                      ? "bg-blue-600 text-white rounded-br-md"
                                      : isSecretariaMsg
                                        ? "bg-pink-100 text-gray-900 border border-pink-200 rounded-bl-md"
                                        : "bg-white text-gray-900 border border-gray-200 rounded-bl-md"
                                  }`}>
                                    {/* Preview da mensagem citada */}
                                    {m.replyTo && (
                                      <div className={`mb-2 pl-2 border-l-4 rounded-r-lg py-1 pr-2 text-xs ${
                                        isMe
                                          ? "border-blue-300 bg-blue-500/40"
                                          : "border-green-400 bg-gray-100"
                                      }`}>
                                        <div className={`font-semibold mb-0.5 ${isMe ? "text-blue-100" : "text-green-700"}`}>
                                          {m.replyTo.remetente?.id === user?.id ? "Você" : (m.replyTo.remetente?.nome || "Usuário")}
                                        </div>
                                        <div className={`truncate ${isMe ? "text-blue-200" : "text-gray-500"}`}>
                                          {previewReply(m.replyTo.conteudo)}
                                        </div>
                                      </div>
                                    )}

                                    <div className="whitespace-pre-wrap break-words">
                                      {renderMessageContent(m.conteudo, usuarios, user?.id, isMe, addToast)}
                                    </div>
                                    <div className={`text-xs mt-1 flex items-center justify-end gap-1 ${isMe ? "text-blue-200" : "text-gray-400"}`}>
                                      <span>{formatHora(m.createdAt)}</span>
                                      {isMe && activeChat && (
                                        <span
                                          className={m.lidoPeloDestinatario ? "text-blue-300" : "text-blue-200/50"}
                                          title={m.lidoPeloDestinatario ? "Lida" : "Enviada"}
                                        >
                                          {m.lidoPeloDestinatario ? "✓✓" : "✓"}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Pills de reações existentes */}
                                  {m.reacoes?.length > 0 && (() => {
                                    const grouped = m.reacoes.reduce((acc, r) => {
                                      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, names: [], mine: false };
                                      acc[r.emoji].count++;
                                      acc[r.emoji].names.push(r.usuario?.nome || "?");
                                      if (r.usuarioId === user?.id) acc[r.emoji].mine = true;
                                      return acc;
                                    }, {});
                                    return (
                                      <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? "justify-end" : "justify-start"}`}>
                                        {Object.entries(grouped).map(([emoji, { count, names, mine }]) => (
                                          <button
                                            key={emoji}
                                            onClick={() => reagir(m.id, emoji)}
                                            title={names.join(", ")}
                                            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs border transition ${
                                              mine
                                                ? "bg-blue-100 border-blue-300 text-blue-700"
                                                : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                                            }`}
                                          >
                                            <span>{emoji}</span>
                                            {count > 1 && <span className="font-semibold">{count}</span>}
                                          </button>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>

                          </React.Fragment>
                        );
                      })}
                    </div>
                  )
                ) : (
                  // Avisos
                  loading ? (
                    <div className="flex items-center justify-center h-full text-gray-500">Carregando...</div>
                  ) : avisos.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <div className="text-center">
                        <span className="text-4xl mb-2 block">📢</span>
                        <p>Nenhum aviso ainda.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {avisos.map((a) => {
                        const isMentioned = a.mencionados?.includes(user?.id);
                        return (
                          <div key={a.id} className={`bg-white border rounded-2xl p-4 shadow-sm ${
                            isMentioned ? "ring-2 ring-yellow-400" : ""
                          } ${a.requerConfirmacao && !a.confirmadoPorMim ? "border-pink-300 bg-pink-50" : "border-gray-200"}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center text-white font-bold">
                                  🤖
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-900">{a.remetente?.nome || "Secretária Virtual"}</div>
                                  <div className="text-xs text-gray-500">{formatData(a.createdAt)} às {formatHora(a.createdAt)}</div>
                                </div>
                              </div>
                              {a.requerConfirmacao && (
                                <div>
                                  {a.confirmadoPorMim ? (
                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">✓ Confirmado</span>
                                  ) : (
                                    <button
                                      onClick={() => confirmarLeitura(a.id)}
                                      className="text-xs bg-pink-600 text-white px-3 py-1.5 rounded-full hover:bg-pink-700 font-semibold"
                                    >
                                      Confirmar Leitura
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="mt-3 text-gray-800 whitespace-pre-wrap">
                              {renderMentions(a.conteudo, usuarios, user?.id)}
                            </div>
                            {isMentioned && (
                              <div className="mt-2 text-xs text-yellow-700 bg-yellow-100 px-2 py-1 rounded inline-block">
                                Você foi mencionado neste aviso
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                )}

                {activeTab === "chat" && usuariosDigitando.length > 0 && (
                  <div className="mt-4 text-sm text-gray-500 italic">
                    {usuariosDigitando.map((u) => u.nome).join(", ")} está digitando...
                  </div>
                )}
              </div>

              {/* Input */}
              {activeTab === "chat" ? (
                <form onSubmit={enviarMensagem} className="p-4 border-t bg-white">
                  {/* Banner: respondendo a... */}
                  {replyingTo && (
                    <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-xl text-sm">
                      <span className="text-green-600 text-base">↩</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-green-700 text-xs">
                          {replyingTo.remetente?.id === user?.id ? "Você" : (replyingTo.remetente?.nome || "Usuário")}
                        </div>
                        <div className="text-gray-600 truncate text-xs">{previewReply(replyingTo.conteudo)}</div>
                      </div>
                      <button type="button" onClick={() => setReplyingTo(null)} className="text-gray-400 hover:text-gray-600 font-bold text-lg leading-none">&times;</button>
                    </div>
                  )}
                  {/* Pending file preview */}
                  {pendingFile && (
                    <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-sm">
                      <span>📎</span>
                      <span className="flex-1 truncate font-medium text-blue-900">{pendingFile.fileName}</span>
                      <span className="text-blue-500 text-xs">{formatFileSize(pendingFile.fileSize)}</span>
                      <button type="button" onClick={() => setPendingFile(null)} className="text-red-500 hover:text-red-700 font-bold text-lg leading-none">&times;</button>
                    </div>
                  )}
                  <div className="flex gap-3 relative">
                    <div className="flex-1 relative">
                      <input
                        ref={inputRef}
                        type="text"
                        value={novaMensagem}
                        onChange={handleDigitando}
                        onKeyDown={handleAvisoKeyDown}
                        onBlur={() => setTimeout(() => setShowMentionList(false), 200)}
                        placeholder={activeChat ? `Mensagem para ${usuarioAtivo?.nome}... (use @nome para mencionar)` : "Digite sua mensagem... (use @nome para mencionar)"}
                        className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      />
                      {/* Dropdown de menção no chat */}
                      {showMentionList && mentionSource === "chat" && filteredMentionUsers.length > 0 && (
                        <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-auto z-50">
                          <div className="p-2 text-xs text-gray-500 border-b bg-gray-50">Selecione um usuário para mencionar:</div>
                          {filteredMentionUsers.map((u, idx) => {
                            const isSecretariaVirtual = u.tipoUsuario === "SECRETARIA_VIRTUAL";
                            return (
                              <button
                                key={u.id}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                                className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-blue-50 transition-colors ${
                                  idx === selectedMentionIndex ? "bg-blue-100" : ""
                                }`}
                              >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                                  isSecretariaVirtual ? "bg-pink-500" : u.role === "ADMIN" ? "bg-purple-500" : "bg-blue-500"
                                }`}>
                                  {isSecretariaVirtual ? "🤖" : getInitials(u.nome)}
                                </div>
                                <div className="flex-1">
                                  <div className="font-semibold text-gray-900 text-sm">{u.nome}</div>
                                  <div className="text-xs text-gray-500">
                                    {isSecretariaVirtual ? "Secretária Virtual" : u.role === "ADMIN" ? "Administrador" : "Usuário"}
                                  </div>
                                </div>
                                {u.online && <span className="w-2 h-2 bg-green-500 rounded-full"></span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {/* File attachment button */}
                    <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      title="Anexar arquivo"
                      className="px-3 py-3 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-all"
                    >
                      {uploading ? (
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                      ) : (
                        <span className="text-lg">📎</span>
                      )}
                    </button>
                    <button
                      type="submit"
                      disabled={!novaMensagem.trim() && !pendingFile}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
                    >
                      Enviar
                    </button>
                  </div>
                </form>
              ) : canPostAvisos ? (
                <form onSubmit={enviarAviso} className="p-4 border-t bg-white">
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-3 relative">
                      <div className="flex-1 relative">
                        <input
                          ref={avisoInputRef}
                          type="text"
                          value={novoAviso}
                          onChange={handleAvisoChange}
                          onKeyDown={handleAvisoKeyDown}
                          onBlur={() => setTimeout(() => setShowMentionList(false), 200)}
                          placeholder="Digite o aviso para todos... (digite @ para mencionar)"
                          className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                        />
                        {/* Dropdown de menção */}
                        {showMentionList && filteredMentionUsers.length > 0 && (
                          <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-auto z-50">
                            <div className="p-2 text-xs text-gray-500 border-b bg-gray-50">Selecione um usuário para mencionar:</div>
                            {filteredMentionUsers.map((u, idx) => {
                              const isSecretariaVirtual = u.tipoUsuario === "SECRETARIA_VIRTUAL";
                              return (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => insertMention(u)}
                                  className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-pink-50 transition-colors ${
                                    idx === selectedMentionIndex ? "bg-pink-100" : ""
                                  }`}
                                >
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                                    isSecretariaVirtual ? "bg-pink-500" : u.role === "ADMIN" ? "bg-purple-500" : "bg-blue-500"
                                  }`}>
                                    {isSecretariaVirtual ? "🤖" : getInitials(u.nome)}
                                  </div>
                                  <div className="flex-1">
                                    <div className="font-semibold text-gray-900 text-sm">{u.nome}</div>
                                    <div className="text-xs text-gray-500">
                                      {isSecretariaVirtual ? "Secretária Virtual" : u.role === "ADMIN" ? "Administrador" : "Usuário"}
                                    </div>
                                  </div>
                                  {u.online && <span className="w-2 h-2 bg-green-500 rounded-full"></span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={!novoAviso.trim()}
                        className="px-6 py-3 bg-pink-600 text-white rounded-xl font-semibold hover:bg-pink-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
                      >
                        Publicar
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={requerConfirmacao}
                        onChange={(e) => setRequerConfirmacao(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Requer confirmação de leitura
                    </label>
                  </div>
                </form>
              ) : (
                <div className="p-4 border-t bg-gray-50 text-center text-gray-500 text-sm">
                  Apenas a Secretária Virtual ou Admin podem publicar avisos.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <VencimentosHojeModal
        isOpen={showVencimentosModal}
        onClose={() => setShowVencimentosModal(false)}
        vencimentos={vencimentosHoje}
      />
    </div>
  );
}
