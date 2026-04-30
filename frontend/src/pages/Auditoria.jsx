// src/pages/Auditoria.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

const ACOES = [
  "CONFIRMAR_PARCELA",
  "CANCELAR_PARCELA",
  "RETIFICAR_PARCELA",
  "REALIZAR_REPASSE",
];

const ACAO_BADGE = {
  CONFIRMAR_PARCELA:  { label: "Confirmar Parcela",  cls: "bg-green-100 text-green-800" },
  CANCELAR_PARCELA:   { label: "Cancelar Parcela",   cls: "bg-red-100 text-red-800" },
  RETIFICAR_PARCELA:  { label: "Retificar Parcela",  cls: "bg-yellow-100 text-yellow-800" },
  REALIZAR_REPASSE:   { label: "Realizar Repasse",   cls: "bg-blue-100 text-blue-800" },
};

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function JsonDetails({ data }) {
  if (!data) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <pre className="text-xs bg-slate-50 rounded p-2 overflow-x-auto text-slate-700 max-w-xs whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function Auditoria({ user }) {
  const isAdmin = user?.role === "ADMIN";

  const [registros, setRegistros] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // filtros
  const [filtroAcao, setFiltroAcao] = useState("");
  const [filtroInicio, setFiltroInicio] = useState("");
  const [filtroFim, setFiltroFim] = useState("");
  const [filtroUsuarioId, setFiltroUsuarioId] = useState("");

  // usuários (para o select)
  const [usuarios, setUsuarios] = useState([]);

  // expandir linha
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch("/usuarios")
      .then((r) => setUsuarios(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, [isAdmin]);

  const fetchData = useCallback(async (pg = 1) => {
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ page: pg, pageSize: PAGE_SIZE });
      if (filtroAcao) params.set("acao", filtroAcao);
      if (filtroInicio) params.set("dataInicio", filtroInicio);
      if (filtroFim) params.set("dataFim", filtroFim);
      if (filtroUsuarioId) params.set("usuarioId", filtroUsuarioId);

      const data = await apiFetch(`/auditoria?${params}`);
      setRegistros(data.data || []);
      setTotal(data.total || 0);
      setPage(pg);
    } catch (e) {
      setErro(e.message || "Erro ao carregar auditoria.");
    } finally {
      setLoading(false);
    }
  }, [filtroAcao, filtroInicio, filtroFim, filtroUsuarioId]);

  useEffect(() => {
    if (isAdmin) fetchData(1);
  }, [isAdmin, fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleFiltrar(e) {
    e.preventDefault();
    fetchData(1);
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-slate-500">
        Acesso restrito a administradores.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Auditoria de Eventos</h1>

      {/* Filtros */}
      <form onSubmit={handleFiltrar} className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Ação</label>
          <select
            value={filtroAcao}
            onChange={(e) => setFiltroAcao(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todas</option>
            {ACOES.map((a) => (
              <option key={a} value={a}>{ACAO_BADGE[a]?.label || a}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Usuário</label>
          <select
            value={filtroUsuarioId}
            onChange={(e) => setFiltroUsuarioId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Data início</label>
          <input
            type="date"
            value={filtroInicio}
            onChange={(e) => setFiltroInicio(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Data fim</label>
          <input
            type="date"
            value={filtroFim}
            onChange={(e) => setFiltroFim(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Carregando…" : "Filtrar"}
        </button>

        <button
          type="button"
          onClick={() => {
            setFiltroAcao("");
            setFiltroInicio("");
            setFiltroFim("");
            setFiltroUsuarioId("");
          }}
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200"
        >
          Limpar
        </button>
      </form>

      {erro && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{erro}</div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Data/Hora</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Usuário</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Ação</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Entidade</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">ID</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">IP</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {registros.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-400">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
            {registros.map((r) => {
              const badge = ACAO_BADGE[r.acao] || { label: r.acao, cls: "bg-slate-100 text-slate-700" };
              const isOpen = expanded === r.id;
              return (
                <React.Fragment key={r.id}>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{r.usuario?.nome || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.entidade}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.entidadeId}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.ip || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        {isOpen ? "Fechar" : "Ver"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">Dados Antes</p>
                            <JsonDetails data={r.dadosAntes} />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">Dados Depois</p>
                            <JsonDetails data={r.dadosDepois} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>{total} registro(s) encontrado(s)</span>
        <div className="flex gap-2 items-center">
          <button
            disabled={page <= 1}
            onClick={() => fetchData(page - 1)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100"
          >
            ← Anterior
          </button>
          <span className="px-2">Página {page} de {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => fetchData(page + 1)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100"
          >
            Próxima →
          </button>
        </div>
      </div>
    </div>
  );
}
