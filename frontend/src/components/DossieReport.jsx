// ============================================================
// DossieReport.jsx - COMPONENTE PRINCIPAL (CORRIGIDO)
// ============================================================

import React, { useState } from 'react';
import { apiFetch } from '../lib/api';
import DossieForm from './DossieForm';
import DossiePreview from './DossiePreview';
import DossieExport from './DossieExport';

export default function DossieReport() {
  const [dossieData, setDossieData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async (clienteId, contratoId) => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🔍 Gerando dossiê:', { clienteId, contratoId });
      
      // Usando apiFetch do sistema
      const data = await apiFetch(
        `/historico/dossie-dados?clienteId=${clienteId}&contratoId=${contratoId}`
      );
      
      console.log('✅ Dados do dossiê recebidos:', data);
      setDossieData(data);
      
    } catch (err) {
      console.error('❌ Erro ao gerar dossiê:', err);
      setError(err.message || 'Erro ao buscar dados do dossiê');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setDossieData(null);
    setError(null);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      
      {/* Sidebar - Formulário */}
      <div className="w-80 bg-white border-r shadow-sm flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-gray-800">
            📋 Dossiê de Pagamentos
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Relatório completo de contratos
          </p>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <DossieForm 
            onGenerate={handleGenerate} 
            loading={loading}
            onReset={handleReset}
          />
        </div>

        <div className="p-4 border-t bg-gray-50 text-xs text-gray-500 text-center">
          Addere • Sistema de Gestão Financeira
        </div>
      </div>

      {/* Main Content - Preview e Export */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          
          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Carregando dados do dossiê...</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl mx-auto">
              <div className="flex items-center gap-3">
                <span className="text-2xl">❌</span>
                <div>
                  <p className="font-semibold text-red-900">Erro ao gerar dossiê</p>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="mt-3 text-sm text-red-700 hover:text-red-900 underline"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* Preview State */}
          {dossieData && !loading && !error && (
            <div className="max-w-6xl mx-auto">
              <DossiePreview data={dossieData} />
              <DossieExport data={dossieData} />
            </div>
          )}

          {/* Empty State */}
          {!dossieData && !loading && !error && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="text-6xl mb-4">📄</div>
                <p className="text-xl font-semibold text-gray-700 mb-2">
                  Pronto para gerar seu dossiê
                </p>
                <p className="text-gray-500">
                  Preencha os campos ao lado para começar
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}