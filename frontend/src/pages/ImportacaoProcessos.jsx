// src/pages/ImportacaoProcessos.jsx — Importação de processos via xlsx (Projuris/Astrea)
import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BASE_URL, getToken } from "../lib/api";
import { useToast } from "../components/Toast";

export default function ImportacaoProcessos({ user }) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const fileInputRef = useRef(null);

  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragging,     setDragging]     = useState(false);

  async function importXlsx(file) {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE_URL}/processos/importar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro na importação");
      setImportResult(data);
      addToast(
        `${data.processosImportados} processo(s) importado(s) · ${data.clientesCriados} cliente(s) criado(s)`,
        "success"
      );
    } catch (e) {
      addToast(e?.message || "Erro ao importar", "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(xlsx|xls)$/i.test(file.name)) importXlsx(file);
    else if (file) addToast("Selecione um arquivo .xlsx ou .xls", "error");
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/processos")}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          Voltar aos processos
        </button>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-800">Importação de Processos</h1>
        <p className="text-sm text-slate-500 mt-1">
          Importe processos a partir de um relatório exportado do Projuris ou Astrea (.xlsx)
        </p>
      </div>

      {/* Área de upload */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={e => importXlsx(e.target.files?.[0])}
        />

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !importing && fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-12 cursor-pointer transition ${
            dragging
              ? "border-blue-400 bg-blue-50"
              : importing
              ? "border-slate-200 bg-slate-50 cursor-not-allowed"
              : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/40"
          }`}
        >
          {importing ? (
            <>
              <svg className="w-12 h-12 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-sm font-semibold text-slate-600">Importando processos...</p>
              <p className="text-xs text-slate-400">Aguarde enquanto processamos o arquivo</p>
            </>
          ) : (
            <>
              <svg className="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700">
                  Arraste o arquivo aqui ou clique para selecionar
                </p>
                <p className="text-xs text-slate-400 mt-1">Formatos aceitos: .xlsx, .xls</p>
              </div>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition"
              >
                Selecionar arquivo
              </button>
            </>
          )}
        </div>

        {/* Instruções */}
        <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-200 text-sm text-amber-800">
          <p className="font-semibold mb-2">Como exportar do Projuris:</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Acesse <strong>Processos → Listar Processos</strong></li>
            <li>Aplique os filtros desejados (advogado, status, etc.)</li>
            <li>Clique em <strong>Exportar → Excel (.xlsx)</strong></li>
            <li>Faça o upload do arquivo exportado aqui</li>
          </ol>
        </div>
      </div>

      {/* Resultado da importação */}
      {importResult && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800 text-lg">Resultado da Importação</h2>
            <button
              onClick={() => setImportResult(null)}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              Limpar
            </button>
          </div>

          {/* Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex flex-col items-center justify-center bg-green-50 text-green-700 px-4 py-4 rounded-xl">
              <span className="text-3xl font-bold">{importResult.processosImportados}</span>
              <span className="text-xs mt-1 font-medium">processos importados</span>
            </div>
            <div className="flex flex-col items-center justify-center bg-blue-50 text-blue-700 px-4 py-4 rounded-xl">
              <span className="text-3xl font-bold">{importResult.clientesCriados}</span>
              <span className="text-xs mt-1 font-medium">clientes criados</span>
            </div>
            <div className="flex flex-col items-center justify-center bg-slate-50 text-slate-700 px-4 py-4 rounded-xl">
              <span className="text-3xl font-bold">{importResult.clientesEncontrados}</span>
              <span className="text-xs mt-1 font-medium">clientes já cadastrados</span>
            </div>
            {importResult.erros?.length > 0 && (
              <div className="flex flex-col items-center justify-center bg-red-50 text-red-700 px-4 py-4 rounded-xl">
                <span className="text-3xl font-bold">{importResult.erros.length}</span>
                <span className="text-xs mt-1 font-medium">erros</span>
              </div>
            )}
          </div>

          {/* Erros */}
          {importResult.erros?.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-red-600 font-semibold">
                Ver erros ({importResult.erros.length})
              </summary>
              <ul className="mt-3 space-y-1.5 pl-4">
                {importResult.erros.map((e, i) => (
                  <li key={i} className="text-red-700 text-xs">
                    <span className="font-mono text-slate-500">[{e.identificador}]</span> {e.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Clientes com dados faltantes */}
          {importResult.relatorioFaltantes?.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-amber-700 mb-3">
                Clientes com dados faltantes ({importResult.relatorioFaltantes.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-amber-200 rounded-xl overflow-hidden">
                  <thead className="bg-amber-50">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-amber-800">Cliente</th>
                      <th className="px-4 py-2.5 font-semibold text-amber-800 text-center">CPF/CNPJ</th>
                      <th className="px-4 py-2.5 font-semibold text-amber-800 text-center">E-mail</th>
                      <th className="px-4 py-2.5 font-semibold text-amber-800 text-center">Telefone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {importResult.relatorioFaltantes.map(c => (
                      <tr key={c.id} className="hover:bg-amber-50 transition">
                        <td className="px-4 py-2 text-slate-700">{c.nome}</td>
                        <td className="px-4 py-2 text-center">
                          {c.faltaCpf
                            ? <span className="text-red-500 font-bold">✗</span>
                            : <span className="text-green-600">✓</span>}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {c.faltaEmail
                            ? <span className="text-red-500 font-bold">✗</span>
                            : <span className="text-green-600">✓</span>}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {c.faltaTelefone
                            ? <span className="text-red-500 font-bold">✗</span>
                            : <span className="text-green-600">✓</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={() => navigate("/processos")}
              className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover transition"
            >
              Ver processos importados
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
