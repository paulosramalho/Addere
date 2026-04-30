import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

const TIPOS = ["REUNIÃO", "AUDIÊNCIA", "PRAZO", "COMPROMISSO", "TAREFA", "OUTRO"];
const PRIORIDADES = ["BAIXA", "NORMAL", "ALTA", "URGENTE"];
const ANTECEDENCIAS = [
  { label: "15 minutos", value: 15 },
  { label: "30 minutos", value: 30 },
  { label: "1 hora", value: 60 },
  { label: "2 horas", value: 120 },
  { label: "1 dia", value: 1440 },
];
const CANAIS = ["APP", "EMAIL"];

const TIPO_CORES = {
  "REUNIÃO":     { bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "AUDIÊNCIA":   { bg: "#ede9fe", text: "#5b21b6", dot: "#7c3aed" },
  "PRAZO":       { bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" },
  "COMPROMISSO": { bg: "#dcfce7", text: "#14532d", dot: "#22c55e" },
  "TAREFA":      { bg: "#fef9c3", text: "#713f12", dot: "#eab308" },
  "OUTRO":       { bg: "#f1f5f9", text: "#334155", dot: "#94a3b8" },
};
const PRIORIDADE_CORES = {
  "BAIXA":   { bg: "#f1f5f9", text: "#475569" },
  "NORMAL":  { bg: "#dbeafe", text: "#1e40af" },
  "ALTA":    { bg: "#ffedd5", text: "#9a3412" },
  "URGENTE": { bg: "#fee2e2", text: "#991b1b" },
};
const STATUS_CORES = {
  "PENDENTE":  { bg: "#dbeafe", text: "#1e40af" },
  "CONCLUIDO": { bg: "#dcfce7", text: "#14532d" },
  "CANCELADO": { bg: "#f1f5f9", text: "#6b7280" },
};
const PART_STATUS_CORES = {
  "PENDENTE":  { bg: "#fef9c3", text: "#713f12", icon: "⏳" },
  "ACEITO":    { bg: "#dcfce7", text: "#14532d", icon: "✓" },
  "RECUSADO":  { bg: "#fee2e2", text: "#991b1b", icon: "✗" },
};
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DIAS_SEMANA_SHORT = ["D","S","T","Q","Q","S","S"];
const RECORRENCIA_LABELS = { DIARIA: "Diária", SEMANAL: "Semanal", QUINZENAL: "Quinzenal", MENSAL: "Mensal", ANUAL: "Anual" };

function fmtDataHora(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function toLocalDateStr(d) {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function groupByDate(eventos) {
  const groups = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const nextWeek = new Date(today.getTime() + 7 * 86400000);
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  for (const ev of eventos) {
    const d = new Date(ev.dataInicio);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let key, label;
    if (dayStart < today)                              { key = "passado"; label = "Passados"; }
    else if (dayStart.getTime() === today.getTime())   { key = "hoje";    label = "Hoje"; }
    else if (dayStart.getTime() === tomorrow.getTime()){ key = "amanha";  label = "Amanhã"; }
    else if (dayStart < nextWeek)                      { key = "semana";  label = "Esta Semana"; }
    else if (dayStart < nextMonth)                     { key = "mes";     label = "Este Mês"; }
    else                                               { key = "futuro";  label = "Futuro"; }
    if (!groups[key]) groups[key] = { label, eventos: [] };
    groups[key].eventos.push(ev);
  }
  return ["passado","hoje","amanha","semana","mes","futuro"].filter((k) => groups[k]).map((k) => groups[k]);
}

const EMPTY_FORM = {
  titulo: "", descricao: "", dataInicio: "", dataFim: "",
  tipo: "COMPROMISSO", prioridade: "NORMAL", participantes: [], lembretes: [],
  recorrencia: "NENHUMA", recorrenciaFim: "",
};

/* ─── Decline Modal ─── */
function DeclineModal({ onConfirm, onCancel }) {
  const [motivo, setMotivo] = useState("");
  const [sugerirData, setSugerirData] = useState(false);
  const [dataAlt, setDataAlt] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <span className="font-bold text-base">Recusar convite</span>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Motivo *</label>
            <textarea
              autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3} placeholder="Explique o motivo da recusa..."
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={sugerirData} onChange={(e) => setSugerirData(e.target.checked)} className="rounded" />
            Sugerir data/hora alternativa
          </label>
          {sugerirData && (
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Data/hora sugerida</label>
              <input type="datetime-local" value={dataAlt} onChange={(e) => setDataAlt(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button
            onClick={() => { if (!motivo.trim()) return; onConfirm({ motivo: motivo.trim(), dataAlternativa: sugerirData && dataAlt ? dataAlt : null }); }}
            disabled={!motivo.trim()}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-40"
          >
            Recusar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Reagendar Modal ─── */
function ReagendarModal({ ev, dataInicial, onConfirm, onCancel }) {
  const [dataInicio, setDataInicio] = useState(dataInicial || "");
  const [dataFim, setDataFim] = useState(ev.dataFim ? toLocalDateStr(ev.dataFim) : "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <span className="font-bold text-base">Reagendar evento</span>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Todos os participantes receberão notificação e serão solicitados a confirmar novamente.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Nova data/hora início *</label>
            <input type="datetime-local" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Nova data/hora fim (opcional)</label>
            <input type="datetime-local" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button
            onClick={() => { if (dataInicio) onConfirm(dataInicio, dataFim || null); }}
            disabled={!dataInicio}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40"
          >
            Reagendar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Recorrência Escopo Modal ─── */
function RecorrenciaEscopoModal({ titulo, onConfirm, onCancel }) {
  const [escopo, setEscopo] = useState("este");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-5 py-4 border-b">
          <span className="font-bold text-base">{titulo}</span>
        </div>
        <div className="p-5 space-y-3">
          {[
            { value: "este",    label: "Apenas este evento" },
            { value: "futuros", label: "Este e os próximos eventos" },
            { value: "todos",   label: "Todos os eventos da série" },
          ].map((op) => (
            <label key={op.value} className="flex items-center gap-3 cursor-pointer">
              <input type="radio" name="escopo_rec" value={op.value} checked={escopo === op.value}
                onChange={() => setEscopo(op.value)} className="accent-blue-600" />
              <span className="text-sm text-gray-700">{op.label}</span>
            </label>
          ))}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => onConfirm(escopo)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">OK</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Participant Panel ─── */
function ParticipantPanel({ ev, user, isCreator, onResposta, onReagendar }) {
  const [reagendarState, setReagendarState] = useState(null); // null | { dataInicial }
  const parts = ev.participantes || [];

  return (
    <div className="mt-3 border-t pt-3">
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Participantes ({parts.length})</div>
      <div className="space-y-2">
        {parts.map((p) => {
          const nome = p.usuario?.nome || p.nomeExterno || p.emailExterno || "Externo";
          const sc = PART_STATUS_CORES[p.status] || PART_STATUS_CORES["PENDENTE"];
          const isMe = p.usuarioId === user?.id;
          return (
            <div key={p.id} className="flex items-start gap-2">
              <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full text-center text-xs font-bold leading-5"
                style={{ background: sc.bg, color: sc.text }}>
                {sc.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-800">{nome}{isMe ? " (você)" : ""}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: sc.bg, color: sc.text }}>
                    {p.status}
                  </span>
                </div>
                {p.status === "RECUSADO" && p.motivoRecusa && (
                  <div className="text-xs text-red-700 mt-0.5">
                    Motivo: {p.motivoRecusa}
                  </div>
                )}
                {p.status === "RECUSADO" && p.dataAlternativaSugerida && (
                  <div className="text-xs text-amber-700 mt-0.5">
                    Sugere: {fmtDataHora(p.dataAlternativaSugerida)}
                    {isCreator && (
                      <button
                        onClick={() => setReagendarState({ dataInicial: toLocalDateStr(p.dataAlternativaSugerida) })}
                        className="ml-2 underline text-blue-600 hover:text-blue-800"
                      >
                        Aceitar sugestão
                      </button>
                    )}
                  </div>
                )}
                {isCreator && p.status === "RECUSADO" && !p.dataAlternativaSugerida && (
                  <button
                    onClick={() => setReagendarState({ dataInicial: toLocalDateStr(ev.dataInicio) })}
                    className="text-xs text-blue-600 underline hover:text-blue-800 mt-0.5"
                  >
                    Propor nova data
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {parts.length === 0 && <div className="text-xs text-gray-400 italic">Nenhum participante</div>}
      </div>
      {isCreator && (
        <button
          onClick={() => setReagendarState({ dataInicial: toLocalDateStr(ev.dataInicio) })}
          className="mt-2 text-xs text-blue-600 underline hover:text-blue-800"
        >
          🗓️ Reagendar evento
        </button>
      )}
      {reagendarState && (
        <ReagendarModal
          ev={ev}
          dataInicial={reagendarState.dataInicial}
          onConfirm={(di, df) => { setReagendarState(null); onReagendar(di, df); }}
          onCancel={() => setReagendarState(null)}
        />
      )}
    </div>
  );
}

/* ─── Event Card ─── */
function EventCard({ ev, user, isAdmin, onEdit, onDelete, onStatus, onResposta, onReagendar, onRefresh }) {
  const canEdit = isAdmin || ev.criadoPorId === user?.id;
  const isCreator = ev.criadoPorId === user?.id;
  const tc = TIPO_CORES[ev.tipo] || TIPO_CORES["OUTRO"];
  const pc = PRIORIDADE_CORES[ev.prioridade] || PRIORIDADE_CORES["NORMAL"];
  const sc = STATUS_CORES[ev.status] || STATUS_CORES["PENDENTE"];
  const isPast = new Date(ev.dataInicio) < new Date() && ev.status === "PENDENTE";

  const myParticipation = useMemo(
    () => (ev.participantes || []).find((p) => p.usuarioId === user?.id && p.usuarioId !== ev.criadoPorId),
    [ev, user]
  );
  const pendentes = (ev.participantes || []).filter((p) => p.status === "PENDENTE" && p.usuarioId !== ev.criadoPorId);
  const recusados = (ev.participantes || []).filter((p) => p.status === "RECUSADO");

  const [showParts, setShowParts] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [responding, setResponding] = useState(false);

  async function handleAceitar() {
    if (!myParticipation || responding) return;
    setResponding(true);
    try {
      await apiFetch(`/agenda/participantes/${myParticipation.id}/responder`, { method: "PATCH", body: { aceita: true } });
      onRefresh();
      window.dispatchEvent(new CustomEvent("badge:refresh"));
    } catch (e) { console.error(e); }
    finally { setResponding(false); }
  }

  async function handleRecusar({ motivo, dataAlternativa }) {
    if (!myParticipation || responding) return;
    setResponding(true);
    try {
      await apiFetch(`/agenda/participantes/${myParticipation.id}/responder`, {
        method: "PATCH", body: { aceita: false, motivo, dataAlternativa },
      });
      setShowDecline(false);
      onRefresh();
      window.dispatchEvent(new CustomEvent("badge:refresh"));
    } catch (e) { console.error(e); }
    finally { setResponding(false); }
  }

  const awaitingMyResponse = myParticipation && myParticipation.status === "PENDENTE" && ev.status === "PENDENTE";

  return (
    <>
      {showDecline && (
        <DeclineModal
          onConfirm={handleRecusar}
          onCancel={() => setShowDecline(false)}
        />
      )}
      <div
        className={`bg-white border rounded-xl transition-shadow hover:shadow-sm ${isPast ? "opacity-70" : ""}`}
        style={{ borderLeftWidth: 4, borderLeftColor: tc.dot }}
      >
        {/* Invite banner */}
        {awaitingMyResponse && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 rounded-t-xl flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-amber-800">⏳ Aguardando sua confirmação de presença</span>
            <div className="flex gap-1.5">
              <button
                onClick={handleAceitar} disabled={responding}
                className="px-3 py-1 bg-green-600 text-white text-xs rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Aceitar
              </button>
              <button
                onClick={() => setShowDecline(true)} disabled={responding}
                className="px-3 py-1 bg-red-600 text-white text-xs rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                ✗ Recusar
              </button>
            </div>
          </div>
        )}
        {myParticipation && myParticipation.status === "ACEITO" && !isCreator && (
          <div className="bg-green-50 border-b border-green-200 px-4 py-1.5 rounded-t-xl">
            <span className="text-xs font-semibold text-green-800">✓ Você confirmou presença</span>
          </div>
        )}
        {myParticipation && myParticipation.status === "RECUSADO" && !isCreator && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-1.5 rounded-t-xl flex items-center justify-between">
            <span className="text-xs font-semibold text-red-800">✗ Você recusou este evento</span>
            <button onClick={handleAceitar} disabled={responding}
              className="text-xs text-blue-600 underline hover:text-blue-800">
              Aceitar agora
            </button>
          </div>
        )}

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: tc.bg, color: tc.text }}>{ev.tipo}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: pc.bg, color: pc.text }}>{ev.prioridade}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: sc.bg, color: sc.text }}>
                  {ev.status === "CONCLUIDO" ? "CONCLUÍDO" : ev.status}
                </span>
                {ev.recorrencia && ev.recorrencia !== "NENHUMA" && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700">
                    🔄 {RECORRENCIA_LABELS[ev.recorrencia] || ev.recorrencia}
                  </span>
                )}
              </div>
              <div className={`font-semibold text-sm text-gray-900 ${ev.status === "CANCELADO" ? "line-through text-gray-400" : ""}`}>
                {ev.titulo}
              </div>
              {ev.descricao && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ev.descricao}</div>}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                <span>📅 {fmtDataHora(ev.dataInicio)}</span>
                {ev.dataFim && <span>→ {fmtDataHora(ev.dataFim)}</span>}
                {ev.criadoPor && <span>👤 {ev.criadoPor.nome}</span>}
                {(ev.participantes?.length > 0) && (
                  <button
                    onClick={() => setShowParts((v) => !v)}
                    className="flex items-center gap-1 hover:text-gray-700 underline"
                  >
                    👥 {ev.participantes.length} participante{ev.participantes.length !== 1 ? "s" : ""}
                    {pendentes.length > 0 && <span className="text-amber-600">({pendentes.length} pendente{pendentes.length !== 1 ? "s" : ""})</span>}
                    {recusados.length > 0 && <span className="text-red-600">({recusados.length} recusou{recusados.length !== 1 ? "ram" : ""})</span>}
                  </button>
                )}
                {ev.lembretes?.length > 0 && <span>🔔 {ev.lembretes.length} lembrete{ev.lembretes.length !== 1 ? "s" : ""}</span>}
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {ev.status === "PENDENTE" && (
                  <>
                    <button onClick={() => onStatus("CONCLUIDO")} title="Concluir" className="p-1.5 rounded text-green-600 hover:bg-green-50 text-sm font-bold">✓</button>
                    <button onClick={() => onStatus("CANCELADO")} title="Cancelar" className="p-1.5 rounded text-gray-400 hover:bg-gray-100 text-sm">✗</button>
                  </>
                )}
                {ev.status !== "PENDENTE" && (
                  <button onClick={() => onStatus("PENDENTE")} title="Reativar" className="p-1.5 rounded text-blue-500 hover:bg-blue-50 text-xs font-bold">↺</button>
                )}
                <button onClick={onEdit} title="Editar" className="p-1.5 rounded text-blue-600 hover:bg-blue-50 text-sm">✎</button>
                <button onClick={onDelete} title="Excluir" className="p-1.5 rounded text-red-400 hover:bg-red-50 text-sm">🗑</button>
              </div>
            )}
          </div>

          {showParts && (
            <ParticipantPanel
              ev={ev} user={user} isCreator={isCreator}
              onResposta={onResposta}
              onReagendar={(di, df) => onReagendar(ev, di, df)}
            />
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Event Modal ─── */
function EventModal({ formData, editingId, isRecurring, saving, usuarios, user, onSave, onClose, updForm, addPart, remPart, updPart, addLem, remLem, updLem }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-8 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-base text-gray-900">{editingId ? "Editar Evento" : "Novo Evento"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Título *</label>
            <input type="text" value={formData.titulo} onChange={(e) => updForm("titulo", e.target.value)} autoFocus
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Título do evento" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Tipo</label>
              <select value={formData.tipo} onChange={(e) => updForm("tipo", e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Prioridade</label>
              <select value={formData.prioridade} onChange={(e) => updForm("prioridade", e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Início *</label>
              <input type="datetime-local" value={formData.dataInicio} onChange={(e) => updForm("dataInicio", e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Fim (opcional)</label>
              <input type="datetime-local" value={formData.dataFim} onChange={(e) => updForm("dataFim", e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Descrição</label>
            <textarea value={formData.descricao} onChange={(e) => updForm("descricao", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none" rows={2} placeholder="Detalhes opcionais" />
          </div>

          {/* Participantes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-600">Participantes</label>
              <button onClick={addPart} className="text-xs text-blue-600 hover:underline">+ Adicionar</button>
            </div>
            <div className="space-y-2">
              {formData.participantes.map((p, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 px-2 py-1.5 rounded-lg">
                  <select value={p.usuarioId || ""} onChange={(e) => updPart(i, "usuarioId", e.target.value ? Number(e.target.value) : null)}
                    className="flex-1 border rounded px-2 py-1 text-xs bg-white">
                    <option value="">— E-mail externo —</option>
                    {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                  {!p.usuarioId && (
                    <input type="text" value={p.emailExterno || ""} onChange={(e) => updPart(i, "emailExterno", e.target.value)}
                      placeholder="e-mail externo" className="flex-1 border rounded px-2 py-1 text-xs bg-white" />
                  )}
                  {p.status && p.status !== "PENDENTE" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                      style={{ background: PART_STATUS_CORES[p.status]?.bg, color: PART_STATUS_CORES[p.status]?.text }}>
                      {p.status}
                    </span>
                  )}
                  <button onClick={() => remPart(i)} className="text-red-400 hover:text-red-600 text-base px-1 flex-shrink-0">×</button>
                </div>
              ))}
              {formData.participantes.length === 0 && <div className="text-xs text-gray-400 italic">Nenhum participante adicionado</div>}
            </div>
          </div>

          {/* Lembretes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-600">Lembretes</label>
              <button onClick={addLem} className="text-xs text-blue-600 hover:underline">+ Adicionar</button>
            </div>
            <div className="space-y-2">
              {formData.lembretes.map((l, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 px-2 py-1.5 rounded-lg">
                  <select value={l.usuarioId || ""} onChange={(e) => updLem(i, "usuarioId", e.target.value ? Number(e.target.value) : null)}
                    className="flex-1 border rounded px-2 py-1 text-xs bg-white">
                    <option value="">— Externo —</option>
                    {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                  <select value={l.antecedenciaMin} onChange={(e) => updLem(i, "antecedenciaMin", Number(e.target.value))}
                    className="border rounded px-2 py-1 text-xs bg-white">
                    {ANTECEDENCIAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  <select value={l.canal} onChange={(e) => updLem(i, "canal", e.target.value)}
                    className="border rounded px-2 py-1 text-xs bg-white">
                    {CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={() => remLem(i)} className="text-red-400 hover:text-red-600 text-base px-1">×</button>
                </div>
              ))}
              {formData.lembretes.length === 0 && <div className="text-xs text-gray-400 italic">Nenhum lembrete configurado</div>}
            </div>
          </div>

          {/* Recorrência */}
          {!editingId ? (
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Recorrência</label>
              <select value={formData.recorrencia} onChange={(e) => updForm("recorrencia", e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="NENHUMA">Não se repete</option>
                <option value="DIARIA">Diária (máx. 60 ocorrências)</option>
                <option value="SEMANAL">Semanal (máx. 52 semanas)</option>
                <option value="QUINZENAL">Quinzenal (máx. 26)</option>
                <option value="MENSAL">Mensal (máx. 12 meses)</option>
                <option value="ANUAL">Anual (máx. 3 anos)</option>
              </select>
              {formData.recorrencia !== "NENHUMA" && (
                <div className="mt-2">
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Repetir até (opcional)</label>
                  <input type="date" value={formData.recorrenciaFim} onChange={(e) => updForm("recorrenciaFim", e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
            </div>
          ) : isRecurring && (
            <div className="bg-indigo-50 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="text-indigo-600">🔄</span>
              <span className="text-xs text-indigo-800 font-semibold">
                Evento recorrente ({RECORRENCIA_LABELS[formData.recorrencia] || formData.recorrencia}) — ao salvar você poderá escolher quais ocorrências alterar.
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => onSave()} disabled={saving}
            className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover disabled:opacity-50">
            {saving ? "Salvando..." : editingId ? "Salvar" : "Criar Evento"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function Agenda({ user }) {
  const { addToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterTipo, setFilterTipo] = useState("");
  const [filterStatus, setFilterStatus] = useState("PENDENTE");
  const [calendarDate, setCalendarDate] = useState(() => {
    const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingEv, setEditingEv] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [usuarios, setUsuarios] = useState([]);
  const [confirmState, setConfirmState] = useState({ open: false });
  const [escopoModal, setEscopoModal] = useState(null); // { type: "edit"|"delete", ev? }
  const pendingConfirmRef = useRef(null);

  const fetchEventos = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ pageSize: 200 });
      if (filterTipo) p.set("tipo", filterTipo);
      if (filterStatus) p.set("status", filterStatus);
      if (selectedDay) {
        const ds = new Date(selectedDay);
        p.set("dataInicio", ds.toISOString().slice(0, 10));
        p.set("dataFim", ds.toISOString().slice(0, 10));
      }
      const r = await apiFetch(`/agenda?${p}`);
      setEventos(r.items || []);
    } catch {
      addToast("Erro ao carregar agenda.", "error");
    } finally {
      setLoading(false);
    }
  }, [filterTipo, filterStatus, selectedDay]);

  useEffect(() => { fetchEventos(); }, [fetchEventos]);
  useEffect(() => {
    const id = setInterval(fetchEventos, 60000);
    return () => clearInterval(id);
  }, [fetchEventos]);
  useEffect(() => {
    apiFetch("/noticeboard/usuarios").then((r) => setUsuarios(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  // Convites pendentes (events where I'm invited but haven't responded)
  const convitesPendentes = useMemo(() => {
    if (!user?.id) return [];
    return eventos.filter((ev) =>
      ev.criadoPorId !== user.id &&
      (ev.participantes || []).some((p) => p.usuarioId === user.id && p.status === "PENDENTE")
    );
  }, [eventos, user]);

  function abrirModal(ev = null) {
    if (ev) {
      setEditingId(ev.id);
      setEditingEv(ev);
      setFormData({
        titulo: ev.titulo, descricao: ev.descricao || "",
        dataInicio: toLocalDateStr(ev.dataInicio), dataFim: ev.dataFim ? toLocalDateStr(ev.dataFim) : "",
        tipo: ev.tipo, prioridade: ev.prioridade,
        recorrencia: ev.recorrencia || "NENHUMA",
        recorrenciaFim: ev.recorrenciaFim ? ev.recorrenciaFim.slice(0, 10) : "",
        participantes: (ev.participantes || []).map((p) => ({
          usuarioId: p.usuarioId || null, emailExterno: p.emailExterno || "",
          nomeExterno: p.nomeExterno || "", whatsappExterno: p.whatsappExterno || "",
          status: p.status,
        })),
        lembretes: (ev.lembretes || []).map((l) => ({
          usuarioId: l.usuarioId || null, emailExterno: l.emailExterno || "",
          antecedenciaMin: l.antecedenciaMin, canal: l.canal,
        })),
      });
    } else {
      setEditingId(null);
      setEditingEv(null);
      setFormData({
        ...EMPTY_FORM,
        participantes: [{ usuarioId: user?.id || null, emailExterno: "", nomeExterno: "", whatsappExterno: "" }],
        lembretes: [{ usuarioId: user?.id || null, emailExterno: "", antecedenciaMin: 60, canal: "APP" }],
      });
    }
    setShowModal(true);
  }

  async function saveEvento(escopo = null) {
    if (!formData.titulo.trim()) { addToast("Informe o título.", "error"); return; }
    if (!formData.dataInicio) { addToast("Informe a data e hora.", "error"); return; }

    // Editing a recurring event — ask escopo first
    if (editingId && editingEv?.recorrenciaGrupoId && escopo === null) {
      setEscopoModal({ type: "edit" });
      return;
    }

    setSaving(true);
    try {
      const body = {
        ...formData,
        dataInicio: new Date(formData.dataInicio).toISOString(),
        dataFim: formData.dataFim ? new Date(formData.dataFim).toISOString() : null,
        recorrenciaFim: formData.recorrenciaFim ? new Date(formData.recorrenciaFim).toISOString() : null,
        ...(escopo ? { escopo } : {}),
      };
      if (editingId) {
        await apiFetch(`/agenda/${editingId}`, { method: "PUT", body });
        addToast("Evento atualizado!", "success");
      } else {
        await apiFetch("/agenda", { method: "POST", body });
        addToast(formData.recorrencia !== "NENHUMA" ? "Série criada!" : "Evento criado!", "success");
      }
      setEscopoModal(null);
      setShowModal(false);
      fetchEventos();
      window.dispatchEvent(new CustomEvent("badge:refresh"));
    } catch (e) {
      addToast(e.message || "Erro ao salvar.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(ev, status) {
    try {
      await apiFetch(`/agenda/${ev.id}/status`, { method: "PATCH", body: { status } });
      addToast(status === "CONCLUIDO" ? "Concluído!" : status === "CANCELADO" ? "Cancelado." : "Reativado.", "success");
      fetchEventos();
      window.dispatchEvent(new CustomEvent("badge:refresh"));
    } catch (e) {
      addToast(e.message || "Erro.", "error");
    }
  }

  function confirmDelete(ev) {
    if (ev.recorrenciaGrupoId) {
      setEscopoModal({ type: "delete", ev });
      return;
    }
    pendingConfirmRef.current = async () => {
      try {
        await apiFetch(`/agenda/${ev.id}`, { method: "DELETE" });
        addToast("Evento excluído.", "success");
        fetchEventos();
        window.dispatchEvent(new CustomEvent("badge:refresh"));
      } catch (e) {
        addToast(e.message || "Erro.", "error");
      }
    };
    setConfirmState({ open: true, title: "Excluir evento", message: `Deseja excluir "${ev.titulo}"? Os participantes serão notificados.`, danger: true });
  }

  async function executeDelete(ev, escopo) {
    setEscopoModal(null);
    try {
      await apiFetch(`/agenda/${ev.id}?escopo=${escopo}`, { method: "DELETE" });
      addToast("Evento(s) excluído(s).", "success");
      fetchEventos();
      window.dispatchEvent(new CustomEvent("badge:refresh"));
    } catch (e) {
      addToast(e.message || "Erro.", "error");
    }
  }

  async function handleReagendar(ev, dataInicio, dataFim) {
    try {
      await apiFetch(`/agenda/${ev.id}/reagendar`, { method: "PATCH", body: { dataInicio: new Date(dataInicio).toISOString(), dataFim: dataFim ? new Date(dataFim).toISOString() : null } });
      addToast("Evento reagendado! Participantes notificados.", "success");
      fetchEventos();
      window.dispatchEvent(new CustomEvent("badge:refresh"));
    } catch (e) {
      addToast(e.message || "Erro ao reagendar.", "error");
    }
  }

  // Calendar
  const calendarDays = useMemo(() => {
    const y = calendarDate.getFullYear(), m = calendarDate.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(new Date(y, m, d));
    return days;
  }, [calendarDate]);

  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of eventos) {
      const d = new Date(ev.dataInicio);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [eventos]);

  const grouped = useMemo(() => groupByDate(eventos), [eventos]);
  const updForm = (key, val) => setFormData((f) => ({ ...f, [key]: val }));
  const addPart = () => setFormData((f) => ({ ...f, participantes: [...f.participantes, { usuarioId: null, emailExterno: "", nomeExterno: "", whatsappExterno: "" }] }));
  const remPart = (i) => setFormData((f) => ({ ...f, participantes: f.participantes.filter((_, idx) => idx !== i) }));
  const updPart = (i, k, v) => setFormData((f) => { const a = [...f.participantes]; a[i] = { ...a[i], [k]: v }; return { ...f, participantes: a }; });
  const addLem = () => setFormData((f) => ({ ...f, lembretes: [...f.lembretes, { usuarioId: user?.id || null, emailExterno: "", antecedenciaMin: 60, canal: "APP" }] }));
  const remLem = (i) => setFormData((f) => ({ ...f, lembretes: f.lembretes.filter((_, idx) => idx !== i) }));
  const updLem = (i, k, v) => setFormData((f) => { const a = [...f.lembretes]; a[i] = { ...a[i], [k]: v }; return { ...f, lembretes: a }; });

  return (
    <div className="p-6">
      {confirmState.open && (
        <ConfirmModal
          title={confirmState.title} message={confirmState.message} danger={confirmState.danger}
          onConfirm={() => { setConfirmState({ open: false }); pendingConfirmRef.current?.(); }}
          onCancel={() => setConfirmState({ open: false })}
        />
      )}
      {escopoModal && (
        <RecorrenciaEscopoModal
          titulo={escopoModal.type === "delete" ? "Excluir evento recorrente" : "Editar evento recorrente"}
          onCancel={() => setEscopoModal(null)}
          onConfirm={(escopo) => {
            if (escopoModal.type === "delete") executeDelete(escopoModal.ev, escopo);
            else saveEvento(escopo);
          }}
        />
      )}
      {showModal && (
        <EventModal
          formData={formData} setFormData={setFormData} editingId={editingId}
          isRecurring={!!editingEv?.recorrenciaGrupoId}
          saving={saving}
          usuarios={usuarios} user={user} onSave={saveEvento} onClose={() => setShowModal(false)}
          updForm={updForm} addPart={addPart} remPart={remPart} updPart={updPart}
          addLem={addLem} remLem={remLem} updLem={updLem}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agenda</h1>
          <p className="text-sm text-gray-500">Compromissos, prazos e lembretes</p>
        </div>
        <button onClick={() => abrirModal()}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-hover">
          <span>+</span> Novo Evento
        </button>
      </div>

      {/* Convites pendentes banner */}
      {convitesPendentes.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-2">
          <span className="text-amber-600 text-lg">⏳</span>
          <span className="text-sm font-semibold text-amber-800">
            Você tem {convitesPendentes.length} convite{convitesPendentes.length !== 1 ? "s" : ""} aguardando sua resposta — veja abaixo
          </span>
        </div>
      )}

      <div className="flex gap-5">
        {/* Left column */}
        <div className="w-60 flex-shrink-0 space-y-4">
          {/* Mini Calendar */}
          <div className="bg-white border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-lg leading-none">‹</button>
              <span className="text-xs font-semibold text-gray-800">{MESES[calendarDate.getMonth()].slice(0, 3)} {calendarDate.getFullYear()}</span>
              <button onClick={() => setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-lg leading-none">›</button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {DIAS_SEMANA_SHORT.map((d, i) => (
                <div key={i} className="text-center text-[9px] font-bold text-gray-400 py-0.5">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {calendarDays.map((day, i) => {
                if (!day) return <div key={`e${i}`} />;
                const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                const evs = eventsByDay[key] || [];
                const isToday = day.toDateString() === new Date().toDateString();
                const isSel = selectedDay?.toDateString() === day.toDateString();
                const dotColor = evs.some((e) => e.prioridade === "URGENTE") ? "#dc2626"
                  : evs.some((e) => e.prioridade === "ALTA") ? "#ea580c" : "#2563eb";
                return (
                  <button key={key} onClick={() => setSelectedDay(isSel ? null : day)}
                    className={`relative text-center text-[11px] py-1 rounded font-medium transition-colors ${
                      isSel ? "bg-blue-600 text-white" : isToday ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-700 hover:bg-gray-100"
                    }`}>
                    {day.getDate()}
                    {evs.length > 0 && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                        style={{ background: isSel ? "white" : dotColor }} />
                    )}
                  </button>
                );
              })}
            </div>
            {selectedDay && (
              <button onClick={() => setSelectedDay(null)} className="w-full mt-2 text-[11px] text-blue-600 hover:underline text-center">
                Ver todos
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="bg-white border rounded-xl p-3 space-y-2">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Filtros</div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Tipo</label>
              <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)} className="w-full border rounded px-2 py-1 text-xs">
                <option value="">Todos</option>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full border rounded px-2 py-1 text-xs">
                <option value="">Todos</option>
                <option value="PENDENTE">PENDENTE</option>
                <option value="CONCLUIDO">CONCLUÍDO</option>
                <option value="CANCELADO">CANCELADO</option>
              </select>
            </div>
          </div>

          {/* Legend */}
          <div className="bg-white border rounded-xl p-3">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Legenda</div>
            <div className="space-y-1.5">
              {Object.entries(TIPO_CORES).map(([tipo, c]) => (
                <div key={tipo} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.dot }} />
                  <span className="text-xs text-gray-600">{tipo}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main list */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-white border rounded-xl p-8 text-center text-gray-400 text-sm">Carregando...</div>
          ) : eventos.length === 0 ? (
            <div className="bg-white border rounded-xl p-12 text-center">
              <div className="text-4xl mb-3">🗓️</div>
              <div className="text-gray-500 font-medium">Nenhum evento encontrado</div>
              <div className="text-gray-400 text-xs mt-1">Clique em "+ Novo Evento" para começar</div>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{group.label}</span>
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400">{group.eventos.length}</span>
                  </div>
                  <div className="space-y-2">
                    {group.eventos.map((ev) => (
                      <EventCard
                        key={ev.id} ev={ev} user={user} isAdmin={isAdmin}
                        onEdit={() => abrirModal(ev)}
                        onDelete={() => confirmDelete(ev)}
                        onStatus={(s) => updateStatus(ev, s)}
                        onResposta={fetchEventos}
                        onReagendar={handleReagendar}
                        onRefresh={fetchEventos}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
