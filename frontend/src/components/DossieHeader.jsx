// ============================================================
// DossieHeader.jsx - CABEÇALHO DO DOSSIÊ (PADRÃO OUTROS RELATÓRIOS)
// ============================================================

import React from 'react';
import logoSrc from '../assets/logo.png';
import { formatCpfCnpj } from '../lib/formatters';

export default function DossieHeader({ cliente, contrato, metadata }) {
  // Formatar data+hora (UTC-safe: evita D-1 com datas em UTC midnight)
  const fmtDate = (date) => {
    if (!date) return '—';
    const s = String(date);
    const d = new Date(date);
    if (!Number.isFinite(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    // Se contém horário (T), usar UTC getters para a parte da data
    const hasTime = /T\d{2}:\d{2}/.test(s);
    const dd = hasTime ? d.getUTCDate() : d.getDate();
    const mm = hasTime ? d.getUTCMonth() + 1 : d.getMonth() + 1;
    const yyyy = hasTime ? d.getUTCFullYear() : d.getFullYear();
    const hh = hasTime ? d.getUTCHours() : d.getHours();
    const min = hasTime ? d.getUTCMinutes() : d.getMinutes();
    return `${pad(dd)}/${pad(mm)}/${yyyy} ${pad(hh)}:${pad(min)}`;
  };

  return (
    <div className="bg-white p-6 print:p-4">

      {/* Header Principal - Estilo igual aos outros relatórios */}
      <div style={{textAlign:'center', borderBottom:'2px solid #000', paddingBottom:'10px', marginBottom:'12px'}}>
        <img
          src={logoSrc}
          alt="Logo"
          style={{height:'18px', margin:'0 auto 6px', display:'block'}}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div style={{fontSize:'15px', fontWeight:'bold'}}>Addere</div>
        <div style={{fontSize:'13px', fontWeight:'600', marginTop:'3px'}}>Dossiê de Pagamentos</div>
      </div>

      {/* Info do Cliente e Contrato */}
      <div style={{fontSize:'10px', marginBottom:'10px'}}>
        <div><strong>Cliente:</strong> {cliente?.nome || '—'}</div>
        <div><strong>CPF/CNPJ:</strong> {cliente?.cpfCnpj ? formatCpfCnpj(cliente.cpfCnpj) : '—'}</div>
        <div><strong>Contrato:</strong> {contrato?.numero || '—'}</div>
      </div>

      <div style={{borderTop:'1px solid #000', margin:'6px 0'}}></div>

    </div>
  );
}
