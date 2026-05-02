// ============================================================
// DossieForm.jsx - FORMULÁRIO DE SELEÇÃO (multi-contrato)
// ============================================================

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';

export default function DossieForm({ onGenerate, loading, onReset }) {
  const { addToast } = useToast();
  const [clientes, setClientes] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [contratoIds, setContratoIds] = useState([]); // multi-seleção
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [loadingContratos, setLoadingContratos] = useState(false);

  useEffect(() => {
    loadClientes();
  }, []);

  useEffect(() => {
    if (clienteId) {
      loadContratos(clienteId);
    } else {
      setContratos([]);
      setContratoIds([]);
    }
  }, [clienteId]);

  const loadClientes = async () => {
    setLoadingClientes(true);
    try {
      const data = await apiFetch('/clients?tipo=C,A');
      setClientes(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast('Erro ao carregar clientes: ' + err.message, 'error');
    } finally {
      setLoadingClientes(false);
    }
  };

  const loadContratos = async (cid) => {
    setLoadingContratos(true);
    try {
      const data = await apiFetch('/contratos');
      const contratosFiltrados = Array.isArray(data)
        ? data.filter((c) => Number(c?.cliente?.id) === Number(cid))
        : [];
      setContratos(contratosFiltrados);
    } catch (err) {
      addToast('Erro ao carregar contratos: ' + err.message, 'error');
    } finally {
      setLoadingContratos(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (clienteId && contratoIds.length > 0) {
      onGenerate(clienteId, contratoIds);
    }
  };

  const handleResetForm = () => {
    setClienteId('');
    setContratoIds([]);
    setContratos([]);
    if (onReset) onReset();
  };

  const toggleContrato = (id) => {
    const sid = String(id);
    setContratoIds((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    );
  };

  const toggleAll = () => {
    if (contratoIds.length === contratos.length) {
      setContratoIds([]);
    } else {
      setContratoIds(contratos.map((c) => String(c.id)));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Cliente */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Cliente *
        </label>
        <select
          value={clienteId}
          onChange={(e) => {
            setClienteId(e.target.value);
            setContratoIds([]);
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={loadingClientes || loading}
          required
        >
          <option value="">
            {loadingClientes ? 'Carregando...' : 'Selecione um cliente'}
          </option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nomeRazaoSocial || c.nome}
            </option>
          ))}
        </select>
        {clientes.length === 0 && !loadingClientes && (
          <p className="text-xs text-red-500 mt-1">
            ⚠️ Nenhum cliente encontrado
          </p>
        )}
        {clientes.length > 0 && !loadingClientes && (
          <p className="text-xs text-gray-500 mt-1">
            {clientes.length} cliente(s) disponível(is)
          </p>
        )}
      </div>

      {/* Contrato(s) — multi-seleção */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Contrato(s)/Pagamento(s) *
          </label>
          {contratos.length > 1 && !loadingContratos && (
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
              disabled={loading}
            >
              {contratoIds.length === contratos.length ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          )}
        </div>

        <div
          className={`border border-gray-300 rounded-lg max-h-72 overflow-y-auto ${
            !clienteId || loadingContratos || loading ? 'bg-gray-100 opacity-60' : 'bg-white'
          }`}
        >
          {loadingContratos && (
            <p className="px-3 py-2 text-sm text-gray-500">Carregando...</p>
          )}
          {!loadingContratos && !clienteId && (
            <p className="px-3 py-2 text-sm text-gray-500">Selecione um cliente primeiro</p>
          )}
          {!loadingContratos && clienteId && contratos.length === 0 && (
            <p className="px-3 py-2 text-sm text-red-500">
              ⚠️ Nenhum contrato encontrado para este cliente
            </p>
          )}
          {!loadingContratos && contratos.map((c) => {
            const sid = String(c.id);
            const checked = contratoIds.includes(sid);
            return (
              <label
                key={c.id}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-blue-50 border-b border-gray-100 last:border-b-0 text-sm ${
                  checked ? 'bg-blue-50' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleContrato(c.id)}
                  disabled={loading}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="flex-1 truncate">
                  <span className="font-medium">{c.numeroContrato || c.numero}</span>
                  {c.valorTotal != null && (
                    <span className="text-gray-500 ml-2">
                      — R$ {(Number(c.valorTotal) || 0).toFixed(2)}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        {clienteId && contratos.length > 0 && !loadingContratos && (
          <p className="text-xs text-gray-500 mt-1">
            {contratoIds.length} de {contratos.length} contrato(s) selecionado(s)
          </p>
        )}
      </div>

      {/* Botões */}
      <div className="space-y-2">
        <button
          type="submit"
          disabled={loading || !clienteId || contratoIds.length === 0}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Gerando...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              🔍 {contratoIds.length > 1 ? `Gerar Dossiê (${contratoIds.length} contratos)` : 'Gerar Dossiê'}
            </span>
          )}
        </button>

        {(clienteId || contratoIds.length > 0) && (
          <button
            type="button"
            onClick={handleResetForm}
            disabled={loading}
            className="w-full bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
          >
            🔄 Limpar
          </button>
        )}
      </div>

      {/* Dica */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        <p className="font-semibold mb-1">💡 Dica</p>
        <p>
          O dossiê inclui cada contrato selecionado e todas as suas renegociações. Marque mais
          de um contrato do mesmo cliente para gerar um único dossiê consolidado.
        </p>
      </div>

      {/* Debug Info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="bg-gray-100 border border-gray-300 rounded p-2 text-xs font-mono">
          <div>Clientes: {clientes.length}</div>
          <div>Contratos: {contratos.length}</div>
          <div>Cliente selecionado: {clienteId || 'nenhum'}</div>
          <div>Contratos selecionados: {contratoIds.length > 0 ? contratoIds.join(', ') : 'nenhum'}</div>
        </div>
      )}

    </form>
  );
}
