// pages/C6Operacoes.jsx
// Placeholder do módulo de operações C6 Bank.
// Status: scaffold — exibe o status da configuração e ações disponíveis.

import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export default function C6Operacoes({ user }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    apiFetch("/api/c6/status")
      .then((d) => setStatus(d))
      .catch((e) => setError(e?.message || "Falha ao consultar status."))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">C6 Bank — Operações</h1>
        <p className="text-gray-600">Esta área é restrita a administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">C6 Bank — Operações</h1>
      <p className="text-sm text-gray-500 mb-6">Integração com a API de cobrança do C6 Bank.</p>

      {loading && <p className="text-gray-500">Carregando status…</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
          {error}
        </div>
      )}

      {status && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold text-gray-700">Modo:</span>
              <span className="ml-2 inline-block px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide" style={{
                background: status.mode === "production" ? "#dcfce7" : status.mode === "sandbox" ? "#fef3c7" : "#e2e8f0",
                color: status.mode === "production" ? "#166534" : status.mode === "sandbox" ? "#92400e" : "#475569",
              }}>{status.mode}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Configurado:</span>
              <span className={`ml-2 ${status.configurado ? "text-green-700" : "text-amber-700"}`}>
                {status.configurado ? "✓ credenciais presentes" : "⚠ credenciais ausentes"}
              </span>
            </div>
            {status.sandboxUrl && (
              <div className="col-span-2">
                <span className="font-semibold text-gray-700">Sandbox URL:</span>
                <span className="ml-2 font-mono text-xs text-gray-600 break-all">{status.sandboxUrl}</span>
              </div>
            )}
            {status.productionUrl && (
              <div className="col-span-2">
                <span className="font-semibold text-gray-700">Produção URL:</span>
                <span className="ml-2 font-mono text-xs text-gray-600 break-all">{status.productionUrl}</span>
              </div>
            )}
          </div>

          <div className="border-t pt-4 mt-4 text-sm text-gray-600 space-y-1">
            <p className="font-semibold text-gray-700">Endpoints disponíveis:</p>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li><code className="text-xs bg-gray-100 px-1 rounded">GET /api/c6/status</code> — status da configuração</li>
              <li><code className="text-xs bg-gray-100 px-1 rounded">POST /api/c6/boletos</code> — emitir boleto</li>
              <li><code className="text-xs bg-gray-100 px-1 rounded">GET /api/c6/boletos/:codigoSolicitacao</code> — consultar</li>
              <li><code className="text-xs bg-gray-100 px-1 rounded">POST /api/c6/boletos/:codigoSolicitacao/cancelar</code> — cancelar</li>
            </ul>
          </div>

          {status.mode === "mock" && (
            <div className="border-t pt-4 bg-amber-50 border-amber-200 rounded p-3 text-sm text-amber-900">
              <strong>Modo mock ativo.</strong> A integração real exige contrato corporativo com o C6 Bank.
              Configure <code>C6_MODE=sandbox</code> ou <code>C6_MODE=production</code> nas variáveis de
              ambiente após receber as credenciais. Veja <code>backend/.env.example</code>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
