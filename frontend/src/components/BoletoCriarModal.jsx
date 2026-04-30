// frontend/src/components/BoletoCriarModal.jsx
// Modal de confirmação/configuração ao emitir boleto Inter
import React, { useEffect, useRef, useState } from "react";
import { formatBRLFromDecimal, toDDMMYYYY } from "../lib/formatters";

/**
 * Props:
 *   parcela  – objeto parcela (id, numero, valorPrevisto, vencimento)
 *   onConfirm({ historico, multaPerc, moraPercMes, validadeDias }) – callback ao confirmar
 *   onClose  – callback ao cancelar
 *   loading  – boolean (emitindo)
 */
export default function BoletoCriarModal({ parcela, onConfirm, onClose, loading }) {
  const [historico,    setHistorico]    = useState("Honorários advocatícios");
  const [multaPerc,    setMultaPerc]    = useState("2");
  const [moraPercMes,  setMoraPercMes]  = useState("1");
  const [validadeDias, setValidadeDias] = useState("30");
  const [err,          setErr]          = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleConfirm() {
    if (!historico.trim()) { setErr("Histórico é obrigatório."); return; }
    const m  = parseFloat(multaPerc);
    const mo = parseFloat(moraPercMes);
    const v  = parseInt(validadeDias, 10);
    if (isNaN(m)  || m  < 0 || m  > 100) { setErr("Multa inválida (0–100%)."); return; }
    if (isNaN(mo) || mo < 0 || mo > 100) { setErr("Mora inválida (0–100%)."); return; }
    if (isNaN(v)  || v  < 1 || v  > 60)  { setErr("Validade deve ser entre 1 e 60 dias."); return; }
    setErr("");
    onConfirm({ historico: historico.trim(), multaPerc: m, moraPercMes: mo, validadeDias: v });
  }

  const venc = parcela?.vencimento ? toDDMMYYYY(parcela.vencimento) : "—";
  const valor = parcela?.valorPrevisto
    ? formatBRLFromDecimal(parcela.valorPrevisto)
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Emitir Boleto Inter</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Resumo da parcela */}
        <div className="mx-6 mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span className="font-medium">Parcela #{parcela?.numero}</span>
          {" · "}
          <span>{valor}</span>
          {" · "}
          <span>Venc. {venc}</span>
        </div>

        {/* Campos */}
        <div className="space-y-4 px-6 py-4">
          {/* Histórico */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Histórico / Descrição <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={inputRef}
              rows={2}
              value={historico}
              onChange={(e) => setHistorico(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Ex: Honorários advocatícios — contrato n° 123"
            />
          </div>

          {/* Multa + Mora + Validade */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Multa (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={multaPerc}
                onChange={(e) => setMultaPerc(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-400">Após vencimento</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Mora (% / mês)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={moraPercMes}
                onChange={(e) => setMoraPercMes(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-400">Rateada por dia</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Validade (dias)</label>
              <input
                type="number"
                min="1"
                max="60"
                step="1"
                value={validadeDias}
                onChange={(e) => setValidadeDias(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-400">1 a 60 dias</p>
            </div>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        {/* Botões */}
        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {loading ? "Emitindo..." : "Emitir Boleto"}
          </button>
        </div>
      </div>
    </div>
  );
}
