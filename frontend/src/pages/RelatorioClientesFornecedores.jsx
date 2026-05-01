import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import logoSrc from "../assets/logo.png";

export default function RelatorioClientesFornecedores() {
  const { addToast } = useToast();
  const now = new Date();

  // Filtros
  const [tipo, setTipo] = useState("C"); // C=Cliente, F=Fornecedor, A=Ambos
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const clienteInputRef = useRef(null);
  const [dataInicio, setDataInicio] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
  );
  const [dataFim, setDataFim] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0]
  );
  const [statusFiltro, setStatusFiltro] = useState(""); // "", PREVISTO, EFETIVADO

  // Dados
  const [clientes, setClientes] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingClientes, setLoadingClientes] = useState(true);

  // Fechar sugestões ao clicar fora
  useEffect(() => {
    function handleClick(e) {
      if (clienteInputRef.current && !clienteInputRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const clientesFiltrados = useMemo(() => {
    if (!clienteQuery.trim()) return clientes;
    const q = clienteQuery.toLowerCase();
    return clientes.filter((c) => c.nomeRazaoSocial.toLowerCase().includes(q));
  }, [clientes, clienteQuery]);

  // Carregar lista de clientes/fornecedores
  useEffect(() => {
    (async () => {
      setLoadingClientes(true);
      try {
        const tipoQuery = tipo === "A" ? "C,F,A" : tipo === "C" ? "C,A" : "F,A";
        const data = await apiFetch(`/clients?tipo=${tipoQuery}`);
        setClientes(Array.isArray(data) ? data : []);
      } catch (e) {
        addToast(e?.message || "Erro ao carregar clientes/fornecedores.", "error");
      } finally {
        setLoadingClientes(false);
      }
    })();
  }, [tipo, addToast]);

  // Buscar lançamentos
  const buscar = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tipo) params.append("tipo", tipo);
      if (clienteId) params.append("clienteId", clienteId);
      if (dataInicio) params.append("dataInicio", dataInicio);
      if (dataFim) params.append("dataFim", dataFim);
      if (statusFiltro) params.append("statusFluxo", statusFiltro);

      const data = await apiFetch(`/relatorios/clientes-fornecedores?${params.toString()}`);
      setLancamentos(Array.isArray(data?.lancamentos) ? data.lancamentos : []);
      addToast(`${data?.lancamentos?.length || 0} lançamento(s) encontrado(s).`, "success");
    } catch (e) {
      addToast(e?.message || "Erro ao buscar lançamentos.", "error");
      setLancamentos([]);
    } finally {
      setLoading(false);
    }
  };

  // Agregações
  const resumo = useMemo(() => {
    const totalEntradas = lancamentos
      .filter((l) => l.es === "E")
      .reduce((acc, l) => acc + (l.valorCentavos || 0), 0);
    const totalSaidas = lancamentos
      .filter((l) => l.es === "S")
      .reduce((acc, l) => acc + (l.valorCentavos || 0), 0);
    const totalPrevistos = lancamentos
      .filter((l) => l.statusFluxo === "PREVISTO")
      .reduce((acc, l) => acc + (l.valorCentavos || 0), 0);
    const totalEfetivados = lancamentos
      .filter((l) => l.statusFluxo === "EFETIVADO")
      .reduce((acc, l) => acc + (l.valorCentavos || 0), 0);

    return { totalEntradas, totalSaidas, totalPrevistos, totalEfetivados };
  }, [lancamentos]);

  // Agrupamento por cliente/fornecedor
  const porCliente = useMemo(() => {
    const map = new Map();
    for (const l of lancamentos) {
      const key = l.clienteFornecedor || "Não especificado";
      if (!map.has(key)) {
        map.set(key, { nome: key, entradas: 0, saidas: 0, total: 0, count: 0 });
      }
      const item = map.get(key);
      item.count++;
      if (l.es === "E") {
        item.entradas += l.valorCentavos || 0;
      } else {
        item.saidas += l.valorCentavos || 0;
      }
      item.total = item.entradas - item.saidas;
    }
    return Array.from(map.values())
      .filter((item) => item.entradas !== 0 || item.saidas !== 0)
      .sort((a, b) => b.total - a.total);
  }, [lancamentos]);

  const formatCurrency = (centavos) =>
    (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    // Append T12:00:00 to avoid timezone shift issues
    const str = String(dateStr).includes("T") ? dateStr : `${dateStr}T12:00:00`;
    const d = new Date(str);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Relatório de Clientes e Fornecedores</h1>
        <p className="text-sm text-slate-600 mt-1">
          Controle de pagamentos recebidos e realizados por cliente/fornecedor
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Filtros</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
            <select
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value);
                setClienteId("");
                setClienteQuery("");
              }}
            >
              <option value="C">Clientes</option>
              <option value="F">Fornecedores</option>
              <option value="A">Todos</option>
            </select>
          </div>

          <div ref={clienteInputRef} className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {tipo === "F" ? "Fornecedor" : tipo === "A" ? "Cliente/Fornecedor" : "Cliente"}
            </label>
            <input
              type="text"
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={loadingClientes ? "Carregando..." : "Todos (digite para filtrar)"}
              disabled={loadingClientes}
              value={clienteQuery}
              onChange={(e) => {
                setClienteQuery(e.target.value);
                setClienteId("");
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
            />
            {clienteId && (
              <button
                onClick={() => { setClienteId(""); setClienteQuery(""); }}
                className="absolute right-2 top-[30px] text-slate-400 hover:text-slate-600 text-lg leading-none"
                title="Limpar"
              >×</button>
            )}
            {showSuggestions && clientesFiltrados.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-56 overflow-y-auto text-sm">
                {!clienteQuery.trim() && (
                  <li
                    className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-slate-500"
                    onMouseDown={() => { setClienteId(""); setClienteQuery(""); setShowSuggestions(false); }}
                  >
                    Todos
                  </li>
                )}
                {clientesFiltrados.map((c) => (
                  <li
                    key={c.id}
                    className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${clienteId === String(c.id) ? "bg-blue-50 font-medium text-blue-700" : "text-slate-800"}`}
                    onMouseDown={() => { setClienteId(String(c.id)); setClienteQuery(c.nomeRazaoSocial); setShowSuggestions(false); }}
                  >
                    {c.nomeRazaoSocial}
                    <span className="ml-1 text-xs text-slate-400">({c.tipo})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data Início</label>
            <input
              type="date"
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data Fim</label>
            <input
              type="date"
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="PREVISTO">Previsto</option>
              <option value="EFETIVADO">Efetivado</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={buscar}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>
      </div>

      {/* Resumo */}
      {lancamentos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
            <div className="text-xs font-medium text-green-700 mb-1">Total Entradas</div>
            <div className="text-xl font-bold text-green-800">{formatCurrency(resumo.totalEntradas)}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="text-xs font-medium text-red-700 mb-1">Total Saídas</div>
            <div className="text-xl font-bold text-red-800">{formatCurrency(resumo.totalSaidas)}</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
            <div className="text-xs font-medium text-yellow-700 mb-1">Total Previsto</div>
            <div className="text-xl font-bold text-yellow-800">{formatCurrency(resumo.totalPrevistos)}</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <div className="text-xs font-medium text-blue-700 mb-1">Total Efetivado</div>
            <div className="text-xl font-bold text-blue-800">{formatCurrency(resumo.totalEfetivados)}</div>
          </div>
        </div>
      )}

      {/* Agrupamento por Cliente/Fornecedor */}
      {porCliente.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Resumo por {tipo === "F" ? "Fornecedor" : tipo === "A" ? "Cliente/Fornecedor" : "Cliente"}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left text-xs font-semibold text-slate-600 px-4 py-3">Nome</th>
                  <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Qtd</th>
                  <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Entradas</th>
                  <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Saídas</th>
                  <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {porCliente.map((item, idx) => (
                  <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{item.nome}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">{item.count}</td>
                    <td className="px-4 py-3 text-sm text-green-600 text-right font-medium">
                      {formatCurrency(item.entradas)}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600 text-right font-medium">
                      {formatCurrency(item.saidas)}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-bold ${item.total >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {formatCurrency(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lista detalhada */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            Lançamentos ({lancamentos.length})
          </h2>
          {lancamentos.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // Export PDF via print with header/footer
                  const tipoLabel = tipo === "F" ? "Fornecedores" : tipo === "A" ? "Clientes e Fornecedores" : "Clientes";
                  const dataAtual = new Date().toLocaleDateString("pt-BR");
                  const horaAtual = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

                  const printContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                      <meta charset="UTF-8">
                      <title>Relatório de ${tipoLabel} - Addere</title>
                      <style>
                        @page {
                          size: A4 portrait;
                          margin: 1.5cm 1cm;
                        }

                        * { margin: 0; padding: 0; box-sizing: border-box; }

                        body {
                          font-family: Arial, sans-serif;
                          font-size: 10px;
                          background: white;
                        }

                        .page {
                          position: relative;
                          min-height: 25cm;
                          padding-bottom: 60px;
                        }

                        .header {
                          text-align: center;
                          border-bottom: 2px solid #000;
                          padding-bottom: 10px;
                          margin-bottom: 15px;
                        }

                        .header img {
                          height: 22px;
                          margin-bottom: 5px;
                        }

                        .header .company {
                          font-size: 14px;
                          font-weight: bold;
                        }

                        .header .report-title {
                          font-size: 12px;
                          font-weight: 600;
                          margin-top: 3px;
                        }

                        .info-line {
                          font-size: 10px;
                          margin-bottom: 10px;
                          display: flex;
                          justify-content: space-between;
                        }

                        .section-title {
                          font-size: 11px;
                          font-weight: bold;
                          margin: 15px 0 8px 0;
                          padding-bottom: 3px;
                          border-bottom: 1px solid #ccc;
                        }

                        .summary {
                          display: flex;
                          gap: 15px;
                          margin-bottom: 15px;
                          flex-wrap: wrap;
                        }

                        .summary-item {
                          padding: 8px 12px;
                          border: 1px solid #ddd;
                          border-radius: 4px;
                          background: #f9f9f9;
                        }

                        .summary-item .label {
                          font-size: 9px;
                          color: #666;
                        }

                        .summary-item .value {
                          font-size: 12px;
                          font-weight: bold;
                        }

                        table {
                          width: 100%;
                          border-collapse: collapse;
                          margin-top: 8px;
                          font-size: 9px;
                        }

                        th, td {
                          border: 1px solid #ccc;
                          padding: 5px 6px;
                          text-align: left;
                        }

                        th {
                          background: #f0f0f0;
                          font-weight: bold;
                          font-size: 9px;
                        }

                        .right { text-align: right; }
                        .center { text-align: center; }
                        .entrada { color: #16a34a; }
                        .saida { color: #dc2626; }

                        .footer {
                          position: absolute;
                          bottom: 0;
                          left: 0;
                          right: 0;
                          border-top: 1px solid #ccc;
                          padding-top: 8px;
                          font-size: 8px;
                          color: #666;
                          display: flex;
                          justify-content: space-between;
                        }

                        @media print {
                          .page { page-break-after: always; }
                          .page:last-child { page-break-after: avoid; }
                        }
                      </style>
                    </head>
                    <body>
                      <div class="page">
                        <!-- Header -->
                        <div class="header">
                          <img src="${logoSrc}" alt="Logo Addere" />
                          <div class="company">Addere</div>
                          <div class="report-title">Relatório de ${tipoLabel}</div>
                        </div>

                        <!-- Info -->
                        <div class="info-line">
                          <span><strong>Período:</strong> ${formatDate(dataInicio)} a ${formatDate(dataFim)}</span>
                          <span><strong>Gerado em:</strong> ${dataAtual} às ${horaAtual}</span>
                        </div>

                        <!-- Summary -->
                        <div class="section-title">RESUMO GERAL</div>
                        <div class="summary">
                          <div class="summary-item">
                            <div class="label">Total Entradas</div>
                            <div class="value entrada">${formatCurrency(resumo.totalEntradas)}</div>
                          </div>
                          <div class="summary-item">
                            <div class="label">Total Saídas</div>
                            <div class="value saida">${formatCurrency(resumo.totalSaidas)}</div>
                          </div>
                          <div class="summary-item">
                            <div class="label">Total Previsto</div>
                            <div class="value">${formatCurrency(resumo.totalPrevistos)}</div>
                          </div>
                          <div class="summary-item">
                            <div class="label">Total Efetivado</div>
                            <div class="value">${formatCurrency(resumo.totalEfetivados)}</div>
                          </div>
                        </div>

                        <!-- Resumo por Cliente/Fornecedor -->
                        <div class="section-title">RESUMO POR ${tipo === "F" ? "FORNECEDOR" : tipo === "A" ? "CLIENTE/FORNECEDOR" : "CLIENTE"}</div>
                        <table>
                          <thead>
                            <tr>
                              <th>Nome</th>
                              <th class="right">Qtd</th>
                              <th class="right">Entradas</th>
                              <th class="right">Saídas</th>
                              <th class="right">Saldo</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${porCliente.map(item => `
                              <tr>
                                <td>${item.nome}</td>
                                <td class="right">${item.count}</td>
                                <td class="right entrada">${formatCurrency(item.entradas)}</td>
                                <td class="right saida">${formatCurrency(item.saidas)}</td>
                                <td class="right ${item.total >= 0 ? 'entrada' : 'saida'}">${formatCurrency(item.total)}</td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>

                        <!-- Lançamentos Detalhados -->
                        <div class="section-title">LANÇAMENTOS DETALHADOS (${lancamentos.length})</div>
                        <table>
                          <thead>
                            <tr>
                              <th style="width:60px">Data</th>
                              <th class="center" style="width:50px">E/S</th>
                              <th>Cliente/Fornecedor</th>
                              <th>Histórico</th>
                              <th class="right" style="width:80px">Valor</th>
                              <th class="center" style="width:60px">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${lancamentos.map(l => `
                              <tr>
                                <td>${formatDate(l.data)}</td>
                                <td class="center ${l.es === 'E' ? 'entrada' : 'saida'}">${l.es === 'E' ? 'E' : 'S'}</td>
                                <td>${l.clienteFornecedor || '—'}</td>
                                <td>${(l.historico || '—').substring(0, 40)}${(l.historico?.length || 0) > 40 ? '...' : ''}</td>
                                <td class="right ${l.es === 'E' ? 'entrada' : 'saida'}">${formatCurrency(l.valorCentavos)}</td>
                                <td class="center">${l.statusFluxo === 'EFETIVADO' ? 'Efetivado' : 'Previsto'}</td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>

                        <!-- Footer -->
                        <div class="footer">
                          <span>Addere - Sistema de Gestão Financeira</span>
                          <span>Relatório de ${tipoLabel} - ${formatDate(dataInicio)} a ${formatDate(dataFim)}</span>
                        </div>
                      </div>

                      <script>
                        window.onload = () => setTimeout(() => window.print(), 300);
                      </script>
                    </body>
                    </html>
                  `;

                  const printWindow = window.open('', '_blank', 'width=800,height=600');
                  if (!printWindow) {
                    addToast("Bloqueador de pop-up ativo. Permita pop-ups.", "warning");
                    return;
                  }
                  printWindow.document.write(printContent);
                  printWindow.document.close();
                }}
                className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                PDF
              </button>
              <button
                onClick={() => {
                  // Export CSV
                  const headers = ["Data", "E/S", "Cliente/Fornecedor", "Histórico", "Valor", "Status"];
                  const rows = lancamentos.map((l) => [
                    formatDate(l.data),
                    l.es,
                    l.clienteFornecedor || "",
                    l.historico || "",
                    (l.valorCentavos / 100).toFixed(2).replace(".", ","),
                    l.statusFluxo,
                  ]);
                  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
                  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `relatorio-clientes-fornecedores-${dataInicio}-${dataFim}.csv`;
                  a.click();
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                CSV
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left text-xs font-semibold text-slate-600 px-4 py-3">Data</th>
                <th className="text-center text-xs font-semibold text-slate-600 px-4 py-3">E/S</th>
                <th className="text-left text-xs font-semibold text-slate-600 px-4 py-3">Cliente/Fornecedor</th>
                <th className="text-left text-xs font-semibold text-slate-600 px-4 py-3">Histórico</th>
                <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Valor</th>
                <th className="text-center text-xs font-semibold text-slate-600 px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {lancamentos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    {loading ? "Carregando..." : "Nenhum lançamento encontrado. Use os filtros e clique em Buscar."}
                  </td>
                </tr>
              ) : (
                lancamentos.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-900">{formatDate(l.data)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                        l.es === "E" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>
                        {l.es === "E" ? "Entrada" : "Saída"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900">{l.clienteFornecedor || "—"}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">{l.historico || "—"}</td>
                    <td className={`px-4 py-3 text-sm text-right font-semibold ${
                      l.es === "E" ? "text-green-600" : "text-red-600"
                    }`}>
                      {formatCurrency(l.valorCentavos)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        l.statusFluxo === "EFETIVADO" ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {l.statusFluxo === "EFETIVADO" ? "Efetivado" : "Previsto"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
