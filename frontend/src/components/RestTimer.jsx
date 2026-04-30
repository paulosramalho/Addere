import React, { useEffect, useMemo, useState } from "react";

/**
 * TEMP: Descanso / Repouso (UTILITÁRIO)
 * -----------------------------------
 * Diretriz do projeto: "Tudo aqui é temporário e será removido ao final."
 * Este componente foi isolado em /src/components para facilitar remoção futura:
 * - Remover import e <RestTimer /> no App.jsx
 * - Apagar este arquivo
 * - Fim ✅
 *
 * Funcionalidade:
 * - Usuário escolhe a "hora de descansar"
 * - Mostra hora escolhida + contagem regressiva até o horário
 * - Ao chegar, abre modal com opção de postergar ou encerrar (com mensagem adequada ao horário)
 * - Ícone (sol/lua) muda conforme a hora (dia/noite)
 */

const LS_KEY = "addere_rest_time_hhmm"; // "HH:MM"

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseHHMM(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function greetingByHour(h) {
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

function isNightByHour(h) {
  // noite: 18:00–04:59
  return h >= 18 || h < 5;
}

function IconSun({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M12 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 20v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M4.93 4.93 6.34 6.34"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17.66 17.66 19.07 19.07"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M2 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M4.93 19.07 6.34 17.66"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17.66 6.34 19.07 4.93"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Modal({ open, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div className="relative w-[92vw] max-w-md rounded-2xl border bg-white shadow-xl p-5">
        {children}
      </div>
    </div>
  );
}

export default function RestTimer() {
  const [now, setNow] = useState(() => new Date());
  const [hhmm, setHhmm] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) || "";
    } catch {
      return "";
    }
  });

  // modal state machine:
  // "ALERT" -> chegou, perguntar postergar
  // "POSTPONE" -> escolhe novo horário
  // "DONE" -> confirmação final
  const [modalStep, setModalStep] = useState(null); // null | "ALERT" | "POSTPONE" | "DONE"

  const parsed = useMemo(() => parseHHMM(hhmm), [hhmm]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = useMemo(() => {
    if (!parsed) return null;
    const t = new Date(now);
    t.setHours(parsed.hh, parsed.mm, 0, 0);
    return t;
  }, [parsed, now]);

  const remainingMs = useMemo(() => {
    if (!target) return null;
    return target.getTime() - now.getTime();
  }, [target, now]);

  useEffect(() => {
    if (!parsed || !target) return;
    if (modalStep) return;
    if (now.getTime() >= target.getTime()) {
      setModalStep("ALERT");
    }
  }, [parsed, target, now, modalStep]);

  const greeting = useMemo(() => {
    const h = parsed ? parsed.hh : now.getHours();
    return greetingByHour(h);
  }, [parsed, now]);

  const night = useMemo(() => {
    const h = parsed ? parsed.hh : now.getHours();
    return isNightByHour(h);
  }, [parsed, now]);

  function persist(value) {
    try {
      if (value) localStorage.setItem(LS_KEY, value);
      else localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }

  function onChangeTime(value) {
    setHhmm(value);
    persist(value);
  }

  function clearTimer() {
    setHhmm("");
    persist("");
  }

  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white border">
              {night ? (
                <IconMoon className="h-4 w-4 text-slate-700" />
              ) : (
                <IconSun className="h-4 w-4 text-slate-700" />
              )}
            </span>
            <div>
              <p className="text-xs font-semibold text-slate-900">Descanso</p>
              <p className="text-[11px] text-slate-500">
                Defina a hora de ir descansar (temporário).
              </p>
            </div>
          </div>
        </div>

        {hhmm ? (
          <button
            type="button"
            onClick={clearTimer}
            className="text-[11px] font-semibold text-slate-600 hover:text-slate-900"
            title="Limpar hora de descanso"
          >
            Limpar
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="time"
          value={hhmm}
          onChange={(e) => onChangeTime(e.target.value)}
          className="w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>

      {parsed && remainingMs != null ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
              Hora escolhida
            </p>
            <p className="mt-1 text-sm font-mono text-slate-900">{hhmm}</p>
          </div>
          <div className="rounded-xl bg-white border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
              Faltam
            </p>
            <p className="mt-1 text-sm font-mono text-slate-900">
              {remainingMs > 0 ? formatCountdown(remainingMs) : "00:00:00"}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">
          Dica: escolha um horário (HH:MM). Quando chegar, eu te aviso.
        </p>
      )}

      <Modal open={modalStep !== null}>
        {modalStep === "ALERT" ? (
          <>
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                {night ? <IconMoon className="h-5 w-5" /> : <IconSun className="h-5 w-5" />}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{greeting} 👋</p>
                <p className="mt-1 text-sm text-slate-700">
                  Chegou a hora escolhida. Você deve ir descansar agora.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalStep("POSTPONE")}
                className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Postergar
              </button>
              <button
                type="button"
                onClick={() => setModalStep("DONE")}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Vou descansar
              </button>
            </div>
          </>
        ) : null}

        {modalStep === "POSTPONE" ? (
          <>
            <p className="text-sm font-semibold text-slate-900">Excepcionalmente, ok.</p>
            <p className="mt-1 text-sm text-slate-700">Qual a nova hora para descansar?</p>

            <div className="mt-3">
              <input
                type="time"
                value={hhmm}
                onChange={(e) => onChangeTime(e.target.value)}
                className="w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalStep("ALERT")}
                className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => setModalStep(null)}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Confirmar
              </button>
            </div>
          </>
        ) : null}

        {modalStep === "DONE" ? (
          <>
            <p className="text-sm font-semibold text-slate-900">{greeting}.</p>
            <p className="mt-1 text-sm text-slate-700">
              Combinado. Descanse bem. Quando voltar, clique em “Retornar”.
            </p>

            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  setModalStep(null);
                  clearTimer(); // evita repetir modal ao reabrir a tela
                }}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Retornar
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
