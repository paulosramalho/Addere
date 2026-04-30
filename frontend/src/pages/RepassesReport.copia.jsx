// src/pages/RelatorioRepasses.jsx NOVO
import React, { useState, useEffect } from "react";
import { apiFetch, getUser } from "../lib/api";
import { useToast } from "../components/Toast";
import logoAddere from "../assets/logo.png";

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MONTHS_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const fmt = {
  date: (d) => {
    if (!d) return "-";
    // Append T12:00:00 to avoid timezone shift issues
    const str = String(d).includes("T") ? d : `${d}T12:00:00`;
    const dt = new Date(str);
    if (isNaN(dt)) return "-";
    const dd = String(dt.getDate()).padStart(2,'0');
    const mm = String(dt.getMonth()+1).padStart(2,'0');
    const yy = dt.getFullYear();
    return `${dd}/${mm}/${yy}`;
  },
  money: (cents) => {
    const val = Number(cents || 0) / 100;
    return val.toLocaleString("pt-BR", {minimumFractionDigits:2, maximumFractionDigits:2});
  },
  month: (y, m) => `${MONTHS[m-1]}/${String(y).slice(-2)}`,
  monthFull: (y, m) => m === 0 ? `${y} - Todos os meses` : `${MONTHS_FULL[m-1]}/${String(y).slice(-2)}`,
};

const trend = (dir) => dir === "UP" ? "▲" : dir === "DOWN" ? "▼" : "■";
const trendClass = (dir) => (
  dir === "UP"
    ? "text-blue-700"
    : dir === "DOWN"
      ? "text-red-600"
      : "text-slate-500"
);
const trendColor = (dir) => (
  dir === "UP"
    ? "#1d4ed8"
    : dir === "DOWN"
      ? "#dc2626"
      : "#64748b"
);

const get = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "-";
};

export default function RelatorioRepasses() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState(null);

  const user = getUser();
  const isAdmin = (user?.role || "").toUpperCase() === "ADMIN";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [lawyers, setLawyers] = useState([]);
  const [lawyerId, setLawyerId] = useState("ALL");
  const [lastN, setLastN] = useState(6);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch("/advogados")
      .then(res => {
        const list = Array.isArray(res) ? res : res?.items || [];
        setLawyers(list.filter(a => a.ativo));
      })
      .catch(() => setLawyers([]));
  }, [isAdmin]);

  const generate = async () => {
    setLoading(true);
    setReportData(null);
    
    try {
      const params = new URLSearchParams({
        ano: year,
        mes: month,
        ultimos: lastN,
        _t: Date.now(),
      });
      
      if (isAdmin && lawyerId !== "ALL") {
        params.set("advogadoId", lawyerId);
      }
      
      const res = await apiFetch(`/relatorios/repasses?${params}`);
      console.log(" Report data:", res);
      
      setReportData(res);
      addToast("Relatório gerado!", "success");
    } catch (err) {
      console.error(" Error:", err);
      addToast(err.message || "Erro ao gerar relatório", "error");
    } finally {
      setLoading(false);
    }
  };
 
  const print = () => {
    const printZone = document.getElementById('print-zone');
    if (!printZone) {
      addToast("Erro: Conteúdo não encontrado", "error");
      return;
    }

    const content = printZone.innerHTML;
    const printWindow = window.open('', '_blank', 'width=800,height=600');
  
    if (!printWindow) {
      addToast("Bloqueador de pop-up ativo. Permita pop-ups.", "warning");
      return;
    }
  
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Relatório de Repasses - Addere</title>
        <style>
          @page { 
            size: A4 portrait; 
            margin: 1.5cm 1cm; 
          }
        
          * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
          }
        
          body { 
            font-family: Arial, sans-serif;
            background: white;
          }
        
          .pdf-page { 
            page-break-after: always; 
            min-height: 25cm;
            padding-bottom: 70px;  /*  ESPAÃ‡O PARA RODAPÃ‰ */
            position: relative;    /*  PARA position:absolute FUNCIONAR */
            background: white;
          }
        
          .pdf-page:last-child { 
            page-break-after: avoid; 
          }
        
          table { 
            width: 100%; 
            border-collapse: collapse;
            page-break-inside: avoid;
          }
        
          thead {
            display: table-header-group;
          }
        
          tr {
            page-break-inside: avoid;
          }
        
          @media print {
            .pdf-page {
              page-break-after: always;
            }
            .pdf-page:last-child {
              page-break-after: avoid;
            }
          }
        </style>
      </head>
      <body>
        ${content}
        <script>
          window.onload = () => setTimeout(() => window.print(), 250);
        </script>
      </body>
      </html>
    `);
  
    printWindow.document.close();
  }

  const items = reportData?.items || [];
  const lawyers_data = items.length > 0 ? items : [];

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body * { visibility: hidden; }
          #print-zone, #print-zone * { visibility: visible; }
          #print-zone {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          
          @page {
            size: A4;
            margin: 1.5cm 1cm;
          }
          
          .pdf-page {
            page-break-after: always;
            page-break-inside: avoid;
            min-height: 25cm;
            position: relative;
          }
          
          .pdf-page:last-child {
            page-break-after: avoid;
          }
        }
      `}</style>

      {/* Screen UI */}
      <div className="no-print p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">Relatório de Repasses</h1>
            <p className="text-sm text-gray-600 mt-1">
              Competência: <b>{fmt.monthFull(year, month)}</b>
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Gerando..." : "Gerar"}
            </button>
            <button
              onClick={print}
              disabled={!reportData}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              Imprimir
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Ano</label>
              <input
                type="number"
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                min="2020"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Mês</label>
              <select
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {MONTHS_FULL.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>

            {isAdmin && (
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Advogado</label>
                <select
                  value={lawyerId}
                  onChange={e => setLawyerId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="ALL">Todos</option>
                  {lawyers.map(l => (
                    <option key={l.id} value={l.id}>{l.nome}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Meses histórico</label>
              <input
                type="number"
                value={lastN}
                onChange={e => setLastN(Math.min(6, Math.max(1, Number(e.target.value))))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                min="1"
                max="6"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div>
          {!reportData ? (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-600">
              Clique em "Gerar" para visualizar o relatório
            </div>
          ) : lawyers_data.length === 0 ? (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-600">
              Nenhum dado encontrado
            </div>
          ) : (
            <div className="space-y-4">
              {lawyers_data.map((lawyer, idx) => {
                const repasses = lawyer.repasses || [];
                const filtered = repasses.filter(r => {
                  const cli = get(r, ["clienteNome","cliente","nomeCliente"]);
                  const ctr = get(r, ["numeroContrato","contrato","contratoNumero"]);
                  return cli !== "-" || ctr !== "-";
                });

                const totalRepFallback = filtered.reduce((sum, r) => sum + Number(r.valorCentavos || 0), 0);
                const totalRecFallback = filtered.reduce((sum, r) => sum + Number(r.valorRecebidoCentavos || 0), 0);
                const resumo = lawyer.resumoFinanceiro || {};
                const totalRep = Number(resumo.repasseCalculadoCentavos ?? totalRepFallback);
                const totalRec = Number(resumo.repasseEfetivadoCentavos ?? totalRecFallback);
                const totalSaldoUtilizado = Math.max(totalRec - totalRep, 0);
                const totalAdiantamentoResumo = Number(resumo.adiantamentoAbatidoCentavos || 0);
                const totalSaldoGerado = Number(resumo.saldoGeradoCentavos || 0);
                const totalSaldoConsumido = Number(resumo.saldoConsumidoCentavos || 0);
                const totalTransferido = resumo.transferenciaRepasseLCCentavos != null
                  ? Number(resumo.transferenciaRepasseLCCentavos || 0)
                  : Math.max(totalRec - totalAdiantamentoResumo, 0);
                const totalEmprestimosValor = (lawyer.emprestimos || []).reduce((sum, e) => sum + Number(e.valorCentavos || 0), 0);
                const totalEmprestimosPago = (lawyer.emprestimos || []).reduce((sum, e) => sum + Number(e.valorPagoCentavos || 0), 0);
                const totalAdiantamentosEntradaCompetencia = (lawyer.adiantamentos || []).reduce((sum, a) => sum + Number(a.entradaCompetenciaCentavos || 0), 0);
                const totalAdiantamentosSaidaCompetencia = (lawyer.adiantamentos || []).reduce((sum, a) => sum + Number(a.saidaCompetenciaCentavos || 0), 0);
                const totalEmprestimosPendentes = (lawyer.emprestimos || []).reduce((sum, e) => sum + Number(e.saldoPendenteCentavos || 0), 0);
                const totalAdiantamentosPendentes = (lawyer.adiantamentos || []).reduce((sum, a) => sum + Number(a.saldoPendenteCentavos || 0), 0);
                const saldoAnterior = Number(lawyer.saldoAnteriorCentavos || 0);
                const saldoAtual = totalSaldoConsumido - totalSaldoGerado;
                const hasAjustesResumo = totalSaldoUtilizado > 0 || totalAdiantamentoResumo > 0;
                const saldoResumoBase = hasAjustesResumo
                  ? (totalRep - totalRec)
                  : (totalRep - totalTransferido);
                const saldoResumo = Math.max(saldoResumoBase, 0);
                const saldo = saldoAnterior + saldoAtual;

                const tend = lawyer.tendencia6m || [];
                const trendN = tend.slice(-lastN); // Pega os Ãºltimos N meses (mais recentes)

                // Seta de tendÃªncia: mÃªs corrente vs mÃªs anterior
                const prevMesVal = trendN.length > 0 ? (trendN[trendN.length - 1].totalCentavos || trendN[trendN.length - 1].valorEfetivadoCentavos || 0) : null;
                const currentTrend = prevMesVal === null ? null : totalRep > prevMesVal ? "UP" : totalRep < prevMesVal ? "DOWN" : "SAME";

                return (
                  <div key={idx} className="bg-white border rounded-lg p-6">
                    <div className="mb-4">
                      <div className="font-semibold">{lawyer.advogado?.nome || lawyer.advogadoNome || "-"}</div>
                      <div className="text-sm text-gray-600">Competência: {fmt.monthFull(year, month)}</div>
                    </div>

                    <div className="border-t pt-4">
                      <div className="font-bold text-sm mb-3">RESUMO</div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <div className="text-gray-600">Repasse Calculado</div>
                          <div className="font-bold">
                            R$ {fmt.money(totalRep)}
                            {currentTrend && <span className={`ml-1 ${trendClass(currentTrend)}`} title="Tendência vs mês anterior">{trend(currentTrend)}</span>}
                          </div>
                        </div>
                        <div className="bg-indigo-50 border border-indigo-200 p-3 rounded-lg">
                          <div className="text-indigo-900 font-semibold">Saldo Utilizado</div>
                          <div className="font-bold text-indigo-900">R$ {fmt.money(totalSaldoUtilizado)}</div>
                        </div>
                        <div className="bg-rose-50 border border-rose-200 p-3 rounded-lg">
                          <div className="text-rose-900 font-semibold">Adiantamento</div>
                          <div className="font-bold text-rose-900">R$ {fmt.money(totalAdiantamentoResumo)}</div>
                        </div>
                        <div className="bg-emerald-50 border-2 border-emerald-500 p-3 rounded-lg shadow-sm">
                          <div className="text-emerald-900 font-semibold">Transferido</div>
                          <div className="font-bold text-emerald-900">R$ {fmt.money(totalTransferido)}</div>
                        </div>
                        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg">
                          <div className="text-amber-900 font-semibold">Saldo</div>
                          <div className="font-bold text-amber-900">R$ {fmt.money(saldoResumo)}</div>
                        </div>
                      </div>
                    </div>

                    {trendN.length > 0 && (
                      <div className="mt-6">
                        <div className="font-bold text-sm mb-3">ÚLTIMOS {lastN} REPASSES</div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left p-2">Competência</th>
                              <th className="text-right p-2">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {trendN.map((t, i) => {
                              const val = t.valorEfetivadoCentavos || t.totalCentavos || 0;
                              const prev = i > 0 ? (trendN[i-1].valorEfetivadoCentavos || 0) : val;
                              const dir = val > prev ? "UP" : val < prev ? "DOWN" : "SAME";
                              return (
                                <tr key={i}>
                                  <td style={{border:'1px solid #ddd', padding:'5px'}}>{t.label || t.competencia || "-"}</td>
                                  <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right'}}>
                                    R$ {fmt.money(val)}
                                    <span style={{ color: trendColor(dir), marginLeft: 4, fontWeight: 700 }}>{trend(dir)}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {filtered.length > 0 && (
                      <div className="mt-6">
                        <div className="font-bold text-sm mb-3">DETALHAMENTO</div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left p-2">Cliente / Contrato</th>
                              <th className="text-left p-2">Data</th>
                              <th className="text-right p-2">Repasse</th>
                              <th className="text-right p-2">Recebido</th>
                              <th className="text-right p-2">Saldo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {filtered.map((r, i) => {
                              const rep = Number(r.valorCentavos || 0);
                              const rec = Number(r.valorRecebidoCentavos || 0);
                              const sld = rep - rec;
                              const cli = get(r, ["clienteNome","cliente","nomeCliente"]);
                              const ctr = get(r, ["numeroContrato","contrato","contratoNumero"]);
                              const dt = get(r, ["dataRecebimento","dataRepasse","data","createdAt"]);

                              return (
                                <tr key={i}>
                                  <td className="p-2">{cli}  -  {ctr}</td>
                                  <td className="p-2">{fmt.date(dt)}</td>
                                  <td className="text-right p-2">R$ {fmt.money(rep)}</td>
                                  <td className="text-right p-2">R$ {fmt.money(rec)}</td>
                                  <td className="text-right p-2 font-semibold">R$ {fmt.money(sld)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* HISTÓRICO DE SALDOS */}
                    {(lawyer.saldoHistorico?.length > 0 || lawyer.saldoAgregadoAnterior || saldo !== 0) && (
                      <div className="mt-6">
                        <div className="font-bold text-sm mb-3">HISTÓRICO DE SALDOS</div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left p-2">Competência</th>
                              <th className="text-right p-2">Usado</th>
                              <th className="text-right p-2">Gerado</th>
                              <th className="text-right p-2">Saldo Final</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {lawyer.saldoAgregadoAnterior && (
                              <tr className="bg-gray-100">
                                <td className="p-2 text-gray-600">
                                  {lawyer.saldoAgregadoAnterior.label}
                                  <span className="text-xs ml-1">({lawyer.saldoAgregadoAnterior.mesesAgregados} meses)</span>
                                </td>
                                <td className="text-right p-2 text-red-600">
                                  {lawyer.saldoAgregadoAnterior.saldoConsumidoCentavos > 0 ? `- R$ ${fmt.money(lawyer.saldoAgregadoAnterior.saldoConsumidoCentavos)}` : '-'}
                                </td>
                                <td className="text-right p-2 text-green-600">
                                  {lawyer.saldoAgregadoAnterior.saldoGeradoCentavos > 0 ? `+ R$ ${fmt.money(lawyer.saldoAgregadoAnterior.saldoGeradoCentavos)}` : '-'}
                                </td>
                                <td className="text-right p-2 font-semibold text-gray-600">
                                  R$ {fmt.money(lawyer.saldoAgregadoAnterior.saldoCentavos)}
                                </td>
                              </tr>
                            )}
                            {(lawyer.saldoHistorico || []).filter(s => s.saldoGeradoCentavos > 0 || s.saldoConsumidoCentavos > 0).map((s, i) => (
                              <tr key={i}>
                                <td className="p-2">{s.label}</td>
                                <td className="text-right p-2 text-red-600">
                                  {s.saldoConsumidoCentavos > 0 ? `- R$ ${fmt.money(s.saldoConsumidoCentavos)}` : '-'}
                                </td>
                                <td className="text-right p-2 text-green-600">
                                  {s.saldoGeradoCentavos > 0 ? `+ R$ ${fmt.money(s.saldoGeradoCentavos)}` : '-'}
                                </td>
                                <td className={`text-right p-2 font-semibold ${s.saldoCentavos >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                                  R$ {fmt.money(s.saldoCentavos)}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-amber-50 border-t-2 border-amber-300">
                              <td className="p-2 font-bold text-amber-900">Saldo Total Atual</td>
                              <td className="p-2"></td>
                              <td className="p-2"></td>
                              <td className="text-right p-2 font-bold text-amber-900">
                                R$ {fmt.money(lawyer.saldoPosteriorCentavos ?? saldo)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* EMPRÉSTIMOS PENDENTES */}
                    {(lawyer.emprestimos?.length > 0) && (
                      <div className="mt-6">
                        <div className="font-bold text-sm mb-3" style={{color:'#7c3aed'}}>
                          EMPRÉSTIMOS PENDENTES
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-purple-50">
                            <tr>
                              <th className="text-left p-2">Competência</th>
                              <th className="text-left p-2">Descrição</th>
                              <th className="text-right p-2">Valor</th>
                              <th className="text-right p-2">Pago</th>
                              <th className="text-right p-2">Pendente</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {lawyer.emprestimos.map((e, i) => (
                              <tr key={i}>
                                <td className="p-2">{e.competencia}</td>
                                <td className="p-2 text-gray-600">{e.descricao}</td>
                                <td className="text-right p-2">R$ {fmt.money(e.valorCentavos)}</td>
                                <td className="text-right p-2 text-green-700">R$ {fmt.money(e.valorPagoCentavos)}</td>
                                <td className="text-right p-2 font-semibold text-purple-700">R$ {fmt.money(e.saldoPendenteCentavos)}</td>
                              </tr>
                            ))}
                            <tr className="bg-purple-100 border-t-2 border-purple-300">
                              <td className="p-2 font-bold text-purple-900">Totais</td>
                              <td className="p-2"></td>
                              <td className="text-right p-2 font-bold text-purple-900">R$ {fmt.money(totalEmprestimosValor)}</td>
                              <td className="text-right p-2 font-bold text-purple-900">R$ {fmt.money(totalEmprestimosPago)}</td>
                              <td className="text-right p-2 font-bold text-purple-900">R$ {fmt.money(totalEmprestimosPendentes)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* ADIANTAMENTOS PENDENTES */}
                    {(lawyer.adiantamentos?.length > 0) && (
                      <div className="mt-6">
                        <div className="font-bold text-sm mb-3" style={{color:'#b45309'}}>
                          ADIANTAMENTOS PENDENTES (ATÉ {fmt.monthFull(year, month)})
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-amber-50">
                            <tr>
                              <th className="text-left p-2">Competência</th>
                              <th className="text-left p-2">Cliente</th>
                              <th className="text-right p-2">Entrada (Comp.)</th>
                              <th className="text-right p-2">Saída (Comp.)</th>
                              <th className="text-right p-2">Pendente</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {lawyer.adiantamentos.map((a, i) => (
                              <tr key={i}>
                                <td className="p-2">{a.competencia}</td>
                                <td className="p-2 text-gray-600">{a.cliente}</td>
                                <td className="text-right p-2">R$ {fmt.money(a.entradaCompetenciaCentavos || 0)}</td>
                                <td className="text-right p-2 text-green-700">R$ {fmt.money(a.saidaCompetenciaCentavos || 0)}</td>
                                <td className="text-right p-2 font-semibold text-amber-700">R$ {fmt.money(a.saldoPendenteCentavos)}</td>
                              </tr>
                            ))}
                            <tr className="bg-amber-100 border-t-2 border-amber-300">
                              <td className="p-2 font-bold text-amber-900">Totais</td>
                              <td className="p-2"></td>
                              <td className="text-right p-2 font-bold text-amber-900">R$ {fmt.money(totalAdiantamentosEntradaCompetencia)}</td>
                              <td className="text-right p-2 font-bold text-amber-900">R$ {fmt.money(totalAdiantamentosSaidaCompetencia)}</td>
                              <td className="text-right p-2 font-bold text-amber-900">R$ {fmt.money(totalAdiantamentosPendentes)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Print Zone - SEMPRE RENDERIZADO */}
      <div id="print-zone" style={{ position: 'fixed', left: '-9999px', top: 0 }}>

        {reportData && lawyers_data.length > 0 && lawyers_data.map((lawyer, lawyerIdx) => {
          const repasses = lawyer.repasses || [];
          const filtered = repasses.filter(r => {
          const cli = get(r, ["clienteNome","cliente","nomeCliente"]);
          const ctr = get(r, ["numeroContrato","contrato","contratoNumero"]);
          return cli !== "-" || ctr !== "-";
        });

        const totalRepFallback = filtered.reduce((sum, r) => sum + Number(r.valorCentavos || 0), 0);
        const totalRecFallback = filtered.reduce((sum, r) => sum + Number(r.valorRecebidoCentavos || 0), 0);
        const resumo = lawyer.resumoFinanceiro || {};
        const totalRep = Number(resumo.repasseCalculadoCentavos ?? totalRepFallback);
        const totalRec = Number(resumo.repasseEfetivadoCentavos ?? totalRecFallback);
        const totalSaldoUtilizado = Math.max(totalRec - totalRep, 0);
        const totalAdiantamentoResumo = Number(resumo.adiantamentoAbatidoCentavos || 0);
        const totalSaldoGerado = Number(resumo.saldoGeradoCentavos || 0);
        const totalSaldoConsumido = Number(resumo.saldoConsumidoCentavos || 0);
        const totalTransferido = resumo.transferenciaRepasseLCCentavos != null
          ? Number(resumo.transferenciaRepasseLCCentavos || 0)
          : Math.max(totalRec - totalAdiantamentoResumo, 0);
        const totalEmprestimosValor = (lawyer.emprestimos || []).reduce((sum, e) => sum + Number(e.valorCentavos || 0), 0);
        const totalEmprestimosPago = (lawyer.emprestimos || []).reduce((sum, e) => sum + Number(e.valorPagoCentavos || 0), 0);
        const totalAdiantamentosEntradaCompetencia = (lawyer.adiantamentos || []).reduce((sum, a) => sum + Number(a.entradaCompetenciaCentavos || 0), 0);
        const totalAdiantamentosSaidaCompetencia = (lawyer.adiantamentos || []).reduce((sum, a) => sum + Number(a.saidaCompetenciaCentavos || 0), 0);
        const totalEmprestimosPendentes = (lawyer.emprestimos || []).reduce((sum, e) => sum + Number(e.saldoPendenteCentavos || 0), 0);
        const totalAdiantamentosPendentes = (lawyer.adiantamentos || []).reduce((sum, a) => sum + Number(a.saldoPendenteCentavos || 0), 0);

        const saldoAnterior = Number(lawyer.saldoAnteriorCentavos || 0);
        const saldoAtual = totalSaldoConsumido - totalSaldoGerado;
        const hasAjustesResumo = totalSaldoUtilizado > 0 || totalAdiantamentoResumo > 0;
        const saldoResumoBase = hasAjustesResumo
          ? (totalRep - totalRec)
          : (totalRep - totalTransferido);
        const saldoResumo = Math.max(saldoResumoBase, 0);
        const saldo = saldoAnterior + saldoAtual;

        const tend = lawyer.tendencia6m || [];
        const trendN = tend.slice(-lastN); // Pega os Ãºltimos N meses (mais recentes)

        // Seta de tendÃªncia: mÃªs corrente vs mÃªs anterior
        const prevMesValPrint = trendN.length > 0 ? (trendN[trendN.length - 1].totalCentavos || trendN[trendN.length - 1].valorEfetivadoCentavos || 0) : null;
        const currentTrendPrint = prevMesValPrint === null ? null : totalRep > prevMesValPrint ? "UP" : totalRep < prevMesValPrint ? "DOWN" : "SAME";
        const lawyerName = lawyer.advogado?.nome || lawyer.advogadoNome || "-";

        const chunks = [];
        for (let i = 0; i < filtered.length; i += 15) {
          chunks.push(filtered.slice(i, i + 15));
        }

        const totalPgs = 1 + chunks.length;

        return (
          <React.Fragment key={lawyerIdx}>
            {/* Pagina 1: Resumo */}
            <div className="pdf-page">
              <div style={{textAlign:'center', borderBottom:'2px solid #000', paddingBottom:'10px', marginBottom:'12px'}}>
                <img src={logoAMR} alt="Logo" style={{height:'18px', margin:'0 auto 6px', display:'block'}} />
                <div style={{fontSize:'15px', fontWeight:'bold'}}>Amanda Maia Ramalho Advogados</div>
                <div style={{fontSize:'13px', fontWeight:'600', marginTop:'3px'}}>Relatório de Repasses</div>
              </div>

              <div style={{fontSize:'10px', marginBottom:'10px'}}>
                <div><strong>Advogada(o):</strong> {lawyerName}</div>
                <div><strong>Competência:</strong> {fmt.monthFull(year, month)}</div>
              </div>

              <div style={{borderTop:'1px solid #000', margin:'6px 0'}}></div>

              <div style={{marginTop:'10px'}}>
                <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px'}}>RESUMO</div>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:'10px'}}>
                  <tbody>
                    <tr>
                      <td style={{border:'1px solid #ddd', padding:'6px'}}>Repasse calculado</td>
                      <td style={{border:'1px solid #ddd', padding:'6px', textAlign:'right', fontWeight:'bold'}}>
                        R$ {fmt.money(totalRep)}
                        {currentTrendPrint && <span style={{ color: trendColor(currentTrendPrint), marginLeft: 4 }}>{trend(currentTrendPrint)}</span>}
                      </td>
                    </tr>
                    <tr>
                      <td style={{border:'1px solid #ddd', padding:'6px'}}>Saldo utilizado</td>
                      <td style={{border:'1px solid #ddd', padding:'6px', textAlign:'right', fontWeight:'bold'}}>R$ {fmt.money(totalSaldoUtilizado)}</td>
                    </tr>
                    <tr style={{background:'#ecfdf5'}}>
                      <td style={{border:'1px solid #ddd', padding:'6px'}}>Adiantamento</td>
                      <td style={{border:'1px solid #ddd', padding:'6px', textAlign:'right', fontWeight:'bold'}}>R$ {fmt.money(totalAdiantamentoResumo)}</td>
                    </tr>
                    <tr style={{background:'#ecfdf5'}}>
                      <td style={{border:'2px solid #10b981', padding:'6px', fontWeight:'bold', color:'#065f46'}}>Transferido</td>
                      <td style={{border:'2px solid #10b981', padding:'6px', textAlign:'right', fontWeight:'bold', color:'#065f46'}}>
                        R$ {fmt.money(totalTransferido)}
                      </td>
                    </tr>
                    <tr style={{background:'#FEF3C7'}}>
                      <td style={{border:'1px solid #ddd', padding:'6px', fontWeight:'bold'}}>Saldo</td>
                      <td style={{border:'1px solid #ddd', padding:'6px', textAlign:'right', fontWeight:'bold', color:'#92400E'}}>
                        R$ {fmt.money(saldoResumo)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {trendN.length > 0 && (
                <div style={{marginTop:'12px'}}>
                  <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px'}}>ÚLTIMOS {lastN} REPASSES</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:'9px'}}>
                    <thead>
                      <tr>
                        <th style={{border:'1px solid #ddd', padding:'5px', textAlign:'left'}}>Competência</th>
                        <th style={{border:'1px solid #ddd', padding:'5px', textAlign:'right'}}>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendN.map((t, i) => {
                        const val = t.valorEfetivadoCentavos || t.totalCentavos || 0;
                        const prev = i > 0 ? (trendN[i-1].valorEfetivadoCentavos || 0) : val;
                        const dir = val > prev ? "UP" : val < prev ? "DOWN" : "SAME";
                        return (
                          <tr key={i}>
                            <td style={{border:'1px solid #ddd', padding:'5px'}}>{t.label || t.competencia || "-"}</td>
                            <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right'}}>
                              R$ {fmt.money(val)}
                              <span style={{ color: trendColor(dir), marginLeft: 4, fontWeight: 700 }}>{trend(dir)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* EMPRÉSTIMOS PENDENTES - só na página 1 se não houver detalhamento */}
              {chunks.length === 0 && lawyer.emprestimos?.length > 0 && (
                <div style={{marginTop:'12px'}}>
                  <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px', color:'#7c3aed'}}>
                    EMPRÉSTIMOS PENDENTES
                  </div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:'9px'}}>
                    <thead>
                      <tr>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#f3e8ff'}}>Competência</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#f3e8ff'}}>Descrição</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#f3e8ff'}}>Valor</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#f3e8ff'}}>Pago</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#f3e8ff'}}>Pendente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lawyer.emprestimos.map((e, i) => (
                        <tr key={i}>
                          <td style={{border:'1px solid #ddd', padding:'4px'}}>{e.competencia}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', color:'#666'}}>{e.descricao}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(e.valorCentavos)}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', color:'#16a34a'}}>R$ {fmt.money(e.valorPagoCentavos)}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', fontWeight:'bold', color:'#7c3aed'}}>R$ {fmt.money(e.saldoPendenteCentavos)}</td>
                        </tr>
                      ))}
                    <tr style={{background:'#ede9fe', borderTop:'2px solid #7c3aed', fontWeight:'bold', color:'#5b21b6'}}>
                      <td style={{border:'1px solid #ddd', padding:'4px'}}>Totais</td>
                      <td style={{border:'1px solid #ddd', padding:'4px'}}></td>
                      <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalEmprestimosValor)}</td>
                      <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalEmprestimosPago)}</td>
                      <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalEmprestimosPendentes)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

              {/* ADIANTAMENTOS PENDENTES - só na página 1 se não houver detalhamento */}
              {chunks.length === 0 && lawyer.adiantamentos?.length > 0 && (
                <div style={{marginTop:'12px'}}>
                  <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px', color:'#b45309'}}>
                    ADIANTAMENTOS PENDENTES (ATÉ {fmt.monthFull(year, month)})
                  </div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:'9px'}}>
                    <thead>
                      <tr>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#fef3c7'}}>Competência</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#fef3c7'}}>Cliente</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#fef3c7'}}>Entrada (Comp.)</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#fef3c7'}}>Saída (Comp.)</th>
                        <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#fef3c7'}}>Pendente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lawyer.adiantamentos.map((a, i) => (
                        <tr key={i}>
                          <td style={{border:'1px solid #ddd', padding:'4px'}}>{a.competencia}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', color:'#666'}}>{a.cliente}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(a.entradaCompetenciaCentavos || 0)}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', color:'#16a34a'}}>R$ {fmt.money(a.saidaCompetenciaCentavos || 0)}</td>
                          <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', fontWeight:'bold', color:'#b45309'}}>R$ {fmt.money(a.saldoPendenteCentavos)}</td>
                        </tr>
                      ))}
                      <tr style={{background:'#fef3c7', borderTop:'2px solid #d97706', fontWeight:'bold', color:'#92400e'}}>
                        <td style={{border:'1px solid #ddd', padding:'4px'}}>Totais</td>
                        <td style={{border:'1px solid #ddd', padding:'4px'}}></td>
                        <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalAdiantamentosEntradaCompetencia)}</td>
                        <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalAdiantamentosSaidaCompetencia)}</td>
                        <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalAdiantamentosPendentes)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Rodapé com nome do advogado */}
              <div style={{position:'absolute', bottom:'8px', left:'0', right:'0', borderTop:'1px solid #000', paddingTop:'6px', fontSize:'8px', color:'#666'}}>
                <div style={{display:'flex', justifyContent:'space-between'}}>
                  <span>Uso exclusivo - Addere e {lawyerName}</span>
                  <span>{fmt.date(new Date())}</span>
                </div>
                <div style={{textAlign:'right', marginTop:'3px'}}>Página 1/{totalPgs}</div>
              </div>
            </div>

            {/* Páginas 2+: Detalhamento */}
            {chunks.map((chunk, chunkIdx) => {
              const pageNum = 2 + chunkIdx;
              const isLast = chunkIdx === chunks.length - 1;

              return (
                <div key={`${lawyerIdx}-${chunkIdx}`} className="pdf-page">
                  <div style={{textAlign:'center', borderBottom:'2px solid #000', paddingBottom:'10px', marginBottom:'12px'}}>
                    <img src={logoAMR} alt="Logo" style={{height:'18px', margin:'0 auto 6px', display:'block'}} />
                    <div style={{fontSize:'15px', fontWeight:'bold'}}>Amanda Maia Ramalho Advogados</div>
                    <div style={{fontSize:'13px', fontWeight:'600', marginTop:'3px'}}>Relatório de Repasses</div>
                  </div>

                  <div style={{fontSize:'10px', marginBottom:'10px'}}>
                    <div><strong>Advogada(o):</strong> {lawyerName}</div>
                    <div><strong>Competência:</strong> {fmt.monthFull(year, month)}</div>
                  </div>

                  <div style={{borderTop:'1px solid #000', margin:'6px 0'}}></div>

                  <div style={{marginTop:'10px'}}>
                    <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px'}}>DETALHAMENTO ({chunkIdx + 1}/{chunks.length})</div>
                      <table style={{width:'100%', borderCollapse:'collapse', fontSize:'9px'}}>
                        <thead>
                          <tr>
                            <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left'}}>Cliente</th>
                            <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left'}}>Data</th>
                            <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>Repasse</th>
                            <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>Recebido</th>
                            <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>Saldo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chunk.map((r, i) => {
                            const rep = Number(r.valorCentavos || 0);
                            const rec = Number(r.valorRecebidoCentavos || 0);
                            const sld = rep - rec;
                            const cli = get(r, ["clienteNome","cliente","nomeCliente"]);
                            const ctr = get(r, ["numeroContrato","contrato","contratoNumero"]);
                            const dt = get(r, ["dataRecebimento","dataRepasse","data","createdAt"]);

                            return (
                              <tr key={i}>
                                <td style={{border:'1px solid #ddd', padding:'4px'}}>{cli}  -  {ctr}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px'}}>{fmt.date(dt)}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(rep)}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(rec)}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', fontWeight:'bold'}}>R$ {fmt.money(sld)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* HISTÓRICO DE SALDOS - apenas na última página */}
                    {isLast && (lawyer.saldoHistorico?.length > 0 || lawyer.saldoAgregadoAnterior || saldo !== 0) && (
                      <div style={{marginTop:'12px'}}>
                        <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px'}}>HISTÓRICO DE SALDOS</div>
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:'9px'}}>
                          <thead>
                            <tr>
                              <th style={{border:'1px solid #ddd', padding:'5px', textAlign:'left'}}>Competência</th>
                              <th style={{border:'1px solid #ddd', padding:'5px', textAlign:'right'}}>Usado</th>
                              <th style={{border:'1px solid #ddd', padding:'5px', textAlign:'right'}}>Gerado</th>
                              <th style={{border:'1px solid #ddd', padding:'5px', textAlign:'right'}}>Saldo Final</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lawyer.saldoAgregadoAnterior && (
                              <tr style={{background:'#f3f4f6'}}>
                                <td style={{border:'1px solid #ddd', padding:'5px', color:'#666'}}>
                                  {lawyer.saldoAgregadoAnterior.label}
                                  <span style={{fontSize:'8px', marginLeft:'4px'}}>({lawyer.saldoAgregadoAnterior.mesesAgregados} meses)</span>
                                </td>
                                <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right', color:'#dc2626'}}>
                                  {lawyer.saldoAgregadoAnterior.saldoConsumidoCentavos > 0 ? `- R$ ${fmt.money(lawyer.saldoAgregadoAnterior.saldoConsumidoCentavos)}` : '-'}
                                </td>
                                <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right', color:'#16a34a'}}>
                                  {lawyer.saldoAgregadoAnterior.saldoGeradoCentavos > 0 ? `+ R$ ${fmt.money(lawyer.saldoAgregadoAnterior.saldoGeradoCentavos)}` : '-'}
                                </td>
                                <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right', fontWeight:'bold', color:'#666'}}>
                                  R$ {fmt.money(lawyer.saldoAgregadoAnterior.saldoCentavos)}
                                </td>
                              </tr>
                            )}
                            {(lawyer.saldoHistorico || []).filter(s => s.saldoGeradoCentavos > 0 || s.saldoConsumidoCentavos > 0).map((s, i) => (
                              <tr key={i}>
                                <td style={{border:'1px solid #ddd', padding:'5px'}}>{s.label}</td>
                                <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right', color:'#dc2626'}}>
                                  {s.saldoConsumidoCentavos > 0 ? `- R$ ${fmt.money(s.saldoConsumidoCentavos)}` : '-'}
                                </td>
                                <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right', color:'#16a34a'}}>
                                  {s.saldoGeradoCentavos > 0 ? `+ R$ ${fmt.money(s.saldoGeradoCentavos)}` : '-'}
                                </td>
                                <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right', fontWeight:'bold', color: s.saldoCentavos >= 0 ? '#1d4ed8' : '#dc2626'}}>
                                  R$ {fmt.money(s.saldoCentavos)}
                                </td>
                              </tr>
                            ))}
                            {/* Saldo Total Atual */}
                            <tr style={{background:'#FEF3C7', borderTop:'2px solid #D97706'}}>
                              <td style={{border:'1px solid #ddd', padding:'5px', fontWeight:'bold', color:'#92400E'}}>Saldo Total Atual</td>
                              <td style={{border:'1px solid #ddd', padding:'5px'}}></td>
                              <td style={{border:'1px solid #ddd', padding:'5px'}}></td>
                              <td style={{border:'1px solid #ddd', padding:'5px', textAlign:'right', fontWeight:'bold', color:'#92400E'}}>
                                R$ {fmt.money(lawyer.saldoPosteriorCentavos ?? saldo)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* EMPRÉSTIMOS PENDENTES - última página do detalhamento */}
                    {isLast && lawyer.emprestimos?.length > 0 && (
                      <div style={{marginTop:'12px'}}>
                        <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px', color:'#7c3aed'}}>
                          EMPRÉSTIMOS PENDENTES
                        </div>
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:'9px'}}>
                          <thead>
                            <tr>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#f3e8ff'}}>Competência</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#f3e8ff'}}>Descrição</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#f3e8ff'}}>Valor</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#f3e8ff'}}>Pago</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#f3e8ff'}}>Pendente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lawyer.emprestimos.map((e, i) => (
                              <tr key={i}>
                                <td style={{border:'1px solid #ddd', padding:'4px'}}>{e.competencia}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', color:'#666'}}>{e.descricao}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(e.valorCentavos)}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', color:'#16a34a'}}>R$ {fmt.money(e.valorPagoCentavos)}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', fontWeight:'bold', color:'#7c3aed'}}>R$ {fmt.money(e.saldoPendenteCentavos)}</td>
                              </tr>
                            ))}
                            <tr style={{background:'#ede9fe', borderTop:'2px solid #7c3aed', fontWeight:'bold', color:'#5b21b6'}}>
                              <td style={{border:'1px solid #ddd', padding:'4px'}}>Totais</td>
                              <td style={{border:'1px solid #ddd', padding:'4px'}}></td>
                              <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalEmprestimosValor)}</td>
                              <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalEmprestimosPago)}</td>
                              <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalEmprestimosPendentes)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* ADIANTAMENTOS PENDENTES - última página do detalhamento */}
                    {isLast && lawyer.adiantamentos?.length > 0 && (
                      <div style={{marginTop:'12px'}}>
                        <div style={{fontSize:'11px', fontWeight:'bold', marginBottom:'6px', color:'#b45309'}}>
                          ADIANTAMENTOS PENDENTES (ATÉ {fmt.monthFull(year, month)})
                        </div>
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:'9px'}}>
                          <thead>
                            <tr>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#fef3c7'}}>Competência</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'left', background:'#fef3c7'}}>Cliente</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#fef3c7'}}>Entrada (Comp.)</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#fef3c7'}}>Saída (Comp.)</th>
                              <th style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', background:'#fef3c7'}}>Pendente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lawyer.adiantamentos.map((a, i) => (
                              <tr key={i}>
                                <td style={{border:'1px solid #ddd', padding:'4px'}}>{a.competencia}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', color:'#666'}}>{a.cliente}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(a.entradaCompetenciaCentavos || 0)}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', color:'#16a34a'}}>R$ {fmt.money(a.saidaCompetenciaCentavos || 0)}</td>
                                <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right', fontWeight:'bold', color:'#b45309'}}>R$ {fmt.money(a.saldoPendenteCentavos)}</td>
                              </tr>
                            ))}
                            <tr style={{background:'#fef3c7', borderTop:'2px solid #d97706', fontWeight:'bold', color:'#92400e'}}>
                              <td style={{border:'1px solid #ddd', padding:'4px'}}>Totais</td>
                              <td style={{border:'1px solid #ddd', padding:'4px'}}></td>
                              <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalAdiantamentosEntradaCompetencia)}</td>
                              <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalAdiantamentosSaidaCompetencia)}</td>
                              <td style={{border:'1px solid #ddd', padding:'4px', textAlign:'right'}}>R$ {fmt.money(totalAdiantamentosPendentes)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Rodapé com nome do advogado */}
                    <div style={{position:'absolute', bottom:'8px', left:'0', right:'0', borderTop:'1px solid #000', paddingTop:'6px', fontSize:'8px', color:'#666'}}>
                      <div style={{display:'flex', justifyContent:'space-between'}}>
                        <span>Uso exclusivo - Addere e {lawyerName}</span>
                        <span>{fmt.date(new Date())}</span>
                      </div>
                      <div style={{textAlign:'right', marginTop:'3px'}}>Página {pageNum}/{totalPgs}</div>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}


