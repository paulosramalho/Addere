// ============================================================
// DossieForm.jsx - FORMULÁRIO DE SELEÇÃO (CAMINHO CORRETO)
// ============================================================

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';

export default function DossieForm({ onGenerate, loading, onReset }) {
  const { addToast } = useToast();
  const [clientes, setClientes] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [contratoId, setContratoId] = useState('');
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [loadingContratos, setLoadingContratos] = useState(false);

  // Buscar clientes ao montar
  useEffect(() => {
    loadClientes();
  }, []);

  // Buscar contratos quando selecionar cliente
  useEffect(() => {
    if (clienteId) {
      loadContratos(clienteId);
    } else {
      setContratos([]);
      setContratoId('');
    }
  }, [clienteId]);

  const loadClientes = async () => {
    setLoadingClientes(true);
    try {
      const data = await apiFetch('/clients?tipo=C,A');
      console.log('📋 Clientes carregados:', data);
      setClientes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('❌ Erro ao carregar clientes:', err);
      addToast('Erro ao carregar clientes: ' + err.message, 'error');
    } finally {
      setLoadingClientes(false);
    }
  };

  const loadContratos = async (cid) => {
    setLoadingContratos(true);
    try {
      const data = await apiFetch('/contratos');
      console.log('📋 Contratos carregados:', data);
      
      // Filtra contratos do cliente selecionado
      const contratosFiltrados = Array.isArray(data) 
        ? data.filter(c => Number(c?.cliente?.id) === Number(cid))
        : [];
      
      console.log(`📋 Contratos do cliente ${cid}:`, contratosFiltrados);
      setContratos(contratosFiltrados);
    } catch (err) {
      console.error('❌ Erro ao carregar contratos:', err);
      addToast('Erro ao carregar contratos: ' + err.message, 'error');
    } finally {
      setLoadingContratos(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (clienteId && contratoId) {
      onGenerate(clienteId, contratoId);
    }
  };

  const handleResetForm = () => {
    setClienteId('');
    setContratoId('');
    setContratos([]);
    if (onReset) onReset();
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
            setContratoId('');
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={loadingClientes || loading}
          required
        >
          <option value="">
            {loadingClientes ? 'Carregando...' : 'Selecione um cliente'}
          </option>
          {clientes.map(c => (
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

      {/* Contrato */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Contrato/Pagamento *
        </label>
        <select
          value={contratoId}
          onChange={(e) => setContratoId(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
          disabled={!clienteId || loadingContratos || loading}
          required
        >
          <option value="">
            {loadingContratos 
              ? 'Carregando...' 
              : !clienteId
              ? 'Selecione um cliente primeiro'
              : 'Selecione um contrato'}
          </option>
          {contratos.map(c => (
            <option key={c.id} value={c.id}>
              {c.numeroContrato || c.numero} 
              {c.valorTotal && ` - R$ ${(Number(c.valorTotal) || 0).toFixed(2)}`}
            </option>
          ))}
        </select>
        {clienteId && contratos.length === 0 && !loadingContratos && (
          <p className="text-xs text-red-500 mt-1">
            ⚠️ Nenhum contrato encontrado para este cliente
          </p>
        )}
        {clienteId && contratos.length > 0 && !loadingContratos && (
          <p className="text-xs text-gray-500 mt-1">
            {contratos.length} contrato(s) disponível(is)
          </p>
        )}
      </div>

      {/* Botões */}
      <div className="space-y-2">
        <button
          type="submit"
          disabled={loading || !clienteId || !contratoId}
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
              🔍 Gerar Dossiê
            </span>
          )}
        </button>

        {(clienteId || contratoId) && (
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
          O dossiê inclui o contrato selecionado e todas as suas renegociações.
        </p>
      </div>

      {/* Debug Info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="bg-gray-100 border border-gray-300 rounded p-2 text-xs font-mono">
          <div>Clientes: {clientes.length}</div>
          <div>Contratos: {contratos.length}</div>
          <div>Cliente selecionado: {clienteId || 'nenhum'}</div>
          <div>Contrato selecionado: {contratoId || 'nenhum'}</div>
        </div>
      )}

    </form>
  );
}