// ============================================================
// DossieContrato.jsx - DADOS DE UM CONTRATO
// ============================================================

import React from 'react';

export default function DossieContrato({ contrato, index, isFirst, isLast }) {
  const { numero, resumo, parcelas, isRenegociacao, contratoOrigemNumero, retificacoes } = contrato;

  // Formatar moeda
  const fmt = (cents) => {
    const val = (cents || 0) / 100;
    return val.toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    });
  };

  // Parse seguro: evita D-1 quando backend manda UTC midnight (ex: 2026-02-14T00:00:00.000Z)
  const safeParseDate = (d) => {
    if (!d) return null;
    const s = String(d);
    const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) return new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]), 12, 0, 0);
    const dt = new Date(d);
    return Number.isFinite(dt.getTime()) ? dt : null;
  };

  // Formatar data
  const fmtDate = (date) => {
    if (!date) return '—';
    const d = safeParseDate(date);
    if (!d) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  // Status badge - Apenas: Prevista, Recebida, Pendente (vencida não paga), Cancelada
  const StatusBadge = ({ status, dataVencimento }) => {
    // Normaliza status: REPASSE_EFETUADO vira RECEBIDA
    let normalizedStatus = status;
    if (status === 'REPASSE_EFETUADO') {
      normalizedStatus = 'RECEBIDA';
    }

    // PREVISTA que passou do vencimento vira PENDENTE
    if (normalizedStatus === 'PREVISTA' && dataVencimento) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const venc = safeParseDate(dataVencimento);
      if (venc) {
        venc.setHours(0, 0, 0, 0);
        if (venc < hoje) {
          normalizedStatus = 'PENDENTE';
        }
      }
    }

    const styles = {
      RECEBIDA: 'bg-green-100 text-green-800 border-green-300',
      PREVISTA: 'bg-blue-100 text-blue-800 border-blue-300',
      PENDENTE: 'bg-red-100 text-red-800 border-red-300',
      CANCELADA: 'bg-gray-100 text-gray-800 border-gray-300',
    };

    const labels = {
      RECEBIDA: 'Recebida',
      PREVISTA: 'Prevista',
      PENDENTE: 'Pendente',
      CANCELADA: 'Cancelada',
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold border ${styles[normalizedStatus] || styles.PREVISTA}`}>
        {labels[normalizedStatus] || normalizedStatus}
      </span>
    );
  };

  return (
    <div className="mb-8">
      
      {/* Título do Contrato */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-2xl font-bold text-gray-900">
            {isRenegociacao ? '🔄' : '📄'} {numero}
          </h3>
          {isRenegociacao && (
            <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-sm font-semibold">
              Renegociação
            </span>
          )}
        </div>
        {isRenegociacao && contratoOrigemNumero && (
          <p className="text-sm text-gray-600">
            Originado de: <span className="font-semibold">{contratoOrigemNumero}</span>
          </p>
        )}
      </div>

      {/* Resumo Financeiro */}
      <div className="bg-gradient-to-r from-blue-50 to-blue-100 border-2 border-blue-200 rounded-lg p-6 mb-6">
        <h4 className="text-lg font-bold text-blue-900 mb-4">
          💰 Resumo Financeiro
        </h4>
        
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total do Contrato */}
          <div className="bg-white rounded-lg p-4 border border-blue-200">
            <p className="text-xs text-gray-600 mb-1">Total do Contrato</p>
            <p className="text-xl font-bold text-gray-900">{fmt(resumo.totalContrato)}</p>
            <p className="text-xs text-gray-500 mt-1">{resumo.qtdParcelas} parcelas</p>
          </div>

          {/* Total Pago */}
          <div className="bg-white rounded-lg p-4 border border-green-200">
            <p className="text-xs text-gray-600 mb-1">Total Pago</p>
            <p className="text-xl font-bold text-green-700">{fmt(resumo.totalPago)}</p>
            <p className="text-xs text-gray-500 mt-1">
              {resumo.qtdParcelasPagas} parcelas ({resumo.percPago}%)
            </p>
          </div>

          {/* Em Aberto */}
          <div className="bg-white rounded-lg p-4 border border-yellow-200">
            <p className="text-xs text-gray-600 mb-1">Em Aberto</p>
            <p className="text-xl font-bold text-yellow-700">{fmt(resumo.totalEmAberto)}</p>
            <p className="text-xs text-gray-500 mt-1">
              {resumo.qtdParcelasEmAberto} parcelas ({resumo.percEmAberto}%)
            </p>
          </div>

          {/* Cancelado */}
          {resumo.totalCancelado > 0 && (
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <p className="text-xs text-gray-600 mb-1">Cancelado</p>
              <p className="text-xl font-bold text-gray-700">{fmt(resumo.totalCancelado)}</p>
              <p className="text-xs text-gray-500 mt-1">
                {resumo.qtdParcelasCanceladas} parcelas
              </p>
            </div>
          )}
        </div>

        {/* Barra de Progresso */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-semibold text-gray-700">Progresso de Pagamento</span>
            <span className="font-bold text-blue-900">{resumo.percPago}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-green-500 to-green-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${resumo.percPago}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Tabela de Parcelas */}
      <div>
        <h4 className="text-lg font-bold text-gray-900 mb-3">
          📊 Detalhamento de Parcelas
        </h4>
        
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b-2">
              <tr>
                <th className="text-left p-3 font-semibold text-gray-700">Nº</th>
                <th className="text-left p-3 font-semibold text-gray-700">Vencimento</th>
                <th className="text-left p-3 font-semibold text-gray-700">Recebimento</th>
                <th className="text-right p-3 font-semibold text-gray-700">Previsto</th>
                <th className="text-right p-3 font-semibold text-gray-700">Recebido</th>
                <th className="text-center p-3 font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {parcelas.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium">{p.numero}</td>
                  <td className="p-3">{fmtDate(p.dataVencimento)}</td>
                  <td className="p-3">{fmtDate(p.dataRecebimento)}</td>
                  <td className="p-3 text-right font-medium">{fmt(p.valorPrevisto)}</td>
                  <td className="p-3 text-right font-bold text-green-700">
                    {fmt(p.valorRecebido)}
                  </td>
                  <td className="p-3 text-center">
                    <StatusBadge status={p.status} dataVencimento={p.dataVencimento} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 font-bold">
              <tr>
                <td colSpan="3" className="p-3 text-right">TOTAL:</td>
                <td className="p-3 text-right">{fmt(resumo.totalContrato)}</td>
                <td className="p-3 text-right text-green-700">{fmt(resumo.totalPago)}</td>
                <td colSpan="1"></td>
              </tr>
            </tfoot>
          </table>
        </div>

      </div>

      {/* Retificações */}
      {retificacoes && retificacoes.length > 0 && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="text-sm font-bold text-amber-800 mb-2">
            Retificações
          </h4>
          <ul className="space-y-1 text-sm text-amber-900">
            {retificacoes.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold whitespace-nowrap">{r.data}:</span>
                <span>{r.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}