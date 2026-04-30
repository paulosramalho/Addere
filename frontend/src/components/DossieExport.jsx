// ============================================================
// DossieExport.jsx - BOTÕES DE EXPORTAÇÃO
// ============================================================

import React, { useState } from 'react';
import { useToast } from './Toast';
// import jsPDF from 'jspdf'; // npm install jspdf
// import html2canvas from 'html2canvas'; // npm install html2canvas
// import * as XLSX from 'xlsx'; // npm install xlsx

export default function DossieExport({ data }) {
  const { addToast } = useToast();
  const [exporting, setExporting] = useState(false);

  // Formatar moeda
  const fmt = (cents) => {
    const val = (cents || 0) / 100;
    return val.toFixed(2);
  };

  // Formatar data (UTC-safe: evita D-1 com datas em UTC midnight)
  const fmtDate = (date) => {
    if (!date) return '';
    const s = String(date);
    const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = mISO
      ? new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]), 12, 0, 0)
      : new Date(date);
    if (!Number.isFinite(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  // ============================================================
  // 1. IMPRIMIR (Window.print)
  // ============================================================
  const handlePrint = () => {
    window.print();
  };

  // ============================================================
  // 2. EXPORTAR PDF (jsPDF + html2canvas)
  // ============================================================
  const handlePDF = async () => {
    setExporting(true);
    try {
      // Importação dinâmica (evita erro se libs não instaladas)
      const jsPDF = (await import('jspdf')).default;
      const html2canvas = (await import('html2canvas')).default;

      const element = document.getElementById('dossie-preview');
      
      // Captura o elemento como imagem
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      
      // Cria PDF
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      // Adiciona primeira página
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Adiciona páginas adicionais se necessário
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Salva PDF
      const filename = `Dossie_${data.contratoBase.numero}_${data.cliente.nome.replace(/\s+/g, '_')}.pdf`;
      pdf.save(filename);

    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      addToast('Erro ao gerar PDF. Verifique se as bibliotecas estão instaladas: npm install jspdf html2canvas', 'error');
    } finally {
      setExporting(false);
    }
  };

  // ============================================================
  // 3. EXPORTAR EXCEL (xlsx)
  // ============================================================
  const handleExcel = async () => {
    setExporting(true);
    try {
      // Importação dinâmica
      const XLSX = await import('xlsx');

      const wb = XLSX.utils.book_new();

      // Sheet 1: Resumo Geral
      const resumoData = [
        ['DOSSIÊ DE PAGAMENTOS'],
        [''],
        ['Cliente:', data.cliente.nome],
        ['CPF/CNPJ:', data.cliente.cpfCnpj],
        ['Tipo:', data.contratoBase.tipo],
        ['Total de Contratos:', data.metadata.totalContratos],
        ['Gerado em:', new Date(data.metadata.geradoEm).toLocaleString('pt-BR')],
        ['Gerado por:', data.metadata.geradoPor],
        [''],
      ];
      const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

      // Sheet para cada contrato
      data.cadeia.forEach((contrato, idx) => {
        const sheetName = `Contrato_${idx + 1}`;
        
        // Cabeçalho do contrato
        const contratoData = [
          [`CONTRATO: ${contrato.numero}`],
          [''],
          ['Tipo:', contrato.isRenegociacao ? 'Renegociação' : 'Original'],
          contrato.isRenegociacao ? ['Originado de:', contrato.contratoOrigemNumero] : [],
          [''],
          ['RESUMO FINANCEIRO:'],
          ['Total do Contrato:', fmt(contrato.resumo.totalContrato)],
          ['Total Pago:', fmt(contrato.resumo.totalPago)],
          ['Em Aberto:', fmt(contrato.resumo.totalEmAberto)],
          ['Cancelado:', fmt(contrato.resumo.totalCancelado)],
          ['Qtd Parcelas:', contrato.resumo.qtdParcelas],
          ['Qtd Pagas:', contrato.resumo.qtdParcelasPagas],
          ['Qtd Em Aberto:', contrato.resumo.qtdParcelasEmAberto],
          ['Qtd Canceladas:', contrato.resumo.qtdParcelasCanceladas],
          [''],
          ['PARCELAS:'],
          ['Nº', 'Vencimento', 'Recebimento', 'Previsto (R$)', 'Recebido (R$)', 'Status', 'Observação'],
        ];

        // Linhas de parcelas
        contrato.parcelas.forEach(p => {
          contratoData.push([
            p.numero,
            fmtDate(p.dataVencimento),
            fmtDate(p.dataRecebimento),
            fmt(p.valorPrevisto),
            fmt(p.valorRecebido),
            p.status,
            p.observacao || '',
          ]);
        });

        // Total
        contratoData.push([
          'TOTAL',
          '',
          '',
          fmt(contrato.resumo.totalContrato),
          fmt(contrato.resumo.totalPago),
          '',
          '',
        ]);

        const ws = XLSX.utils.aoa_to_sheet(contratoData);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      // Salva arquivo
      const filename = `Dossie_${data.contratoBase.numero}_${data.cliente.nome.replace(/\s+/g, '_')}.xlsx`;
      XLSX.writeFile(wb, filename);

    } catch (err) {
      console.error('Erro ao gerar Excel:', err);
      addToast('Erro ao gerar Excel. Verifique se a biblioteca está instalada: npm install xlsx', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mt-8 mb-8">
      <div className="flex flex-wrap justify-center gap-4">
        
        {/* Botão Imprimir */}
        <button
          onClick={handlePrint}
          disabled={exporting}
          className="flex items-center gap-2 bg-gray-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-md hover:shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Imprimir
        </button>

        {/* Botão PDF */}
        <button
          onClick={handlePDF}
          disabled={exporting}
          className="flex items-center gap-2 bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-md hover:shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
          </svg>
          {exporting ? 'Gerando PDF...' : 'Exportar PDF'}
        </button>

        {/* Botão Excel */}
        <button
          onClick={handleExcel}
          disabled={exporting}
          className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-md hover:shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {exporting ? 'Gerando Excel...' : 'Exportar Excel'}
        </button>

      </div>

      {/* Mensagem de Ajuda */}
      <div className="mt-4 text-center text-sm text-gray-600">
        <p>
          💡 Use <strong>Imprimir</strong> para impressão direta ou salvar como PDF pelo navegador
        </p>
      </div>
    </div>
  );
}