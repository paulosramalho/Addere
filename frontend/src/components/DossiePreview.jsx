// ============================================================
// DossiePreview.jsx - PREVIEW DO RELATÓRIO (RODAPÉ CORRIGIDO)
// ============================================================

import React from 'react';
import DossieHeader from './DossieHeader';
import DossieContrato from './DossieContrato';

export default function DossiePreview({ data }) {
  const { cliente, contratoBase, cadeia, metadata } = data;

  return (
    <div 
      id="dossie-preview" 
      className="bg-white rounded-lg shadow-lg print:shadow-none"
    >
      {/* Header */}
      <DossieHeader
        cliente={cliente}
        contrato={contratoBase}
        metadata={metadata}
      />

      {/* Conteúdo Principal */}
      <div className="p-8">
        
        {/* Info do Cliente */}
        <div className="mb-8 pb-6 border-b-2">
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            📋 Informações do Cliente
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold text-gray-700">Cliente:</span>
              <p className="text-gray-900">{cliente.nome}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-700">CPF/CNPJ:</span>
              <p className="text-gray-900">{cliente.cpfCnpj || '—'}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Tipo:</span>
              <p className="text-gray-900">{contratoBase.tipo}</p>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Total de Contratos:</span>
              <p className="text-gray-900">{metadata.totalContratos}</p>
            </div>
          </div>
        </div>

        {/* Para cada contrato na cadeia */}
        {cadeia.map((contrato, idx) => (
          <div key={contrato.id}>
            <DossieContrato 
              contrato={contrato} 
              index={idx}
              isFirst={idx === 0}
              isLast={idx === cadeia.length - 1}
            />

            {/* Separador entre contratos */}
            {idx < cadeia.length - 1 && (
              <div className="my-8 py-6 border-t-2 border-dashed border-gray-300">
                <div className="flex items-center justify-center gap-3 text-gray-500">
                  <div className="h-px flex-1 bg-gray-300"></div>
                  <span className="text-sm font-semibold bg-amber-100 px-4 py-2 rounded-full">
                    ↓ RENEGOCIADO EM ↓
                  </span>
                  <div className="h-px flex-1 bg-gray-300"></div>
                </div>
              </div>
            )}
          </div>
        ))}

      </div>

      {/* Rodapé - LAYOUT ATUALIZADO */}
      <div className="px-8 py-4 border-t bg-gray-50">

        {/* Primeira linha: Uso exclusivo e [cliente] + Gerado por */}
        <div className="flex justify-between items-start text-xs text-gray-600 mb-2">
          {/* Esquerda */}
          <div className="max-w-md">
            <p className="leading-relaxed">
              Uso exclusivo dos Sócios e {cliente?.nome || 'Cliente'}
            </p>
          </div>

          {/* Direita */}
          <div className="text-right">
            <p>
              <span className="font-semibold">Gerado por:</span> {metadata.geradoPorNome || metadata.geradoPor || 'Usuário'}
            </p>
          </div>
        </div>

        {/* Segunda linha: Controle de Gestão + Gerado em (mesma linha) */}
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>
            Documento gerado automaticamente pelo sistema{' '}
            <span className="font-bold">Controle de Gestão Financeira Addere</span>
          </span>
          <span>
            <span className="font-semibold">Gerado em:</span>{' '}
            {new Date(metadata.geradoEm).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

      </div>

    </div>
  );
}