import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function StatCard({ title, value, subtitle, icon, color = "blue" }) {
  const colorClasses = {
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    green: "bg-green-50 border-green-200 text-green-900",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    purple: "bg-purple-50 border-purple-200 text-purple-900",
  };

  const iconColorClasses = {
    blue: "text-blue-600",
    green: "text-green-600",
    amber: "text-amber-600",
    purple: "text-purple-600",
  };

  return (
    <div className={`rounded-xl border-2 ${colorClasses[color]} p-6 transition-all hover:shadow-lg`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-sm font-semibold uppercase tracking-wide opacity-75">
            {title}
          </div>
          <div className="mt-3 text-3xl font-bold">
            {value}
          </div>
          {subtitle && (
            <div className="mt-2 text-sm font-medium opacity-75">
              {subtitle}
            </div>
          )}
        </div>
        {icon && (
          <div className={`ml-4 ${iconColorClasses[color]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

function IconCalendar() {
  return (
    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconTrend() {
  return (
    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

export default function DashboardRepasses({ user }) {
  const { addToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [advogados, setAdvogados] = useState([]);
  const [financas, setFinancas] = useState(null);

  // Filtros
  const hoje = new Date();
  const [filtros, setFiltros] = useState({
    ano: hoje.getFullYear(),
    mes: hoje.getMonth() + 1,
    advogadoId: "",
  });

  useEffect(() => {
    if (isAdmin) loadAdvogados();
    if (!isAdmin) loadFinancas();
  }, []);

  useEffect(() => {
    loadDashboard();
    if (isAdmin && filtros.advogadoId) loadFinancas(filtros.advogadoId);
  }, [filtros]);

  async function loadAdvogados() {
    try {
      const resp = await apiFetch("/advogados");
      setAdvogados(resp || []);
    } catch (err) {
      addToast(err?.message || "Erro ao carregar advogados", "error");
    }
  }

  async function loadFinancas(advogadoId) {
    try {
      const params = advogadoId ? `?advogadoId=${advogadoId}` : "";
      const resp = await apiFetch(`/repasses/minha-financas${params}`);
      setFinancas(resp);
    } catch {
      // silently ignore — cards simply won't show
    }
  }

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");
      
      const params = new URLSearchParams();
      if (filtros.ano) params.append("ano", filtros.ano);
      if (filtros.mes) params.append("mes", filtros.mes);
      if (filtros.advogadoId) params.append("advogadoId", filtros.advogadoId);
      
      const resp = await apiFetch(`/repasses/dashboard?${params.toString()}`);
      setData(resp);
    } catch (err) {
      const errorMsg = err?.message || "Erro ao carregar dashboard";
      setError(errorMsg);
      addToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }

  function handleFiltroChange(campo, valor) {
    setFiltros(prev => ({ ...prev, [campo]: valor }));
  }

  function limparFiltros() {
    setFiltros({
      ano: hoje.getFullYear(),
      mes: hoje.getMonth() + 1,
      advogadoId: "",
    });
    addToast("Filtros limpos com sucesso", "success");
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-64"></div>
          <div className="h-32 bg-slate-200 rounded"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-40 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl bg-red-50 border-2 border-red-200 p-6">
          <div className="font-semibold text-red-900 text-lg">Erro ao carregar</div>
          <div className="mt-2 text-red-700">{error}</div>
          <Tooltip content="Tentar carregar novamente">
            <button
              onClick={loadDashboard}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
            >
              Tentar novamente
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const advogadoSelecionado = advogados.find(a => a.id === Number(filtros.advogadoId));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard de Repasses</h1>
          <p className="mt-1 text-slate-600">Visão geral do sistema de repasses</p>
        </div>
        <Tooltip content="Atualizar dados do dashboard">
          <button
            onClick={loadDashboard}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Atualizar
          </button>
        </Tooltip>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border-2 border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-900">Filtros</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Ano */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Ano
            </label>
            <Tooltip content="Filtrar repasses por ano">
              <select
                value={filtros.ano}
                onChange={(e) => handleFiltroChange("ano", Number(e.target.value))}
                className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition"
              >
                {Array.from({ length: 5 }, (_, i) => hoje.getFullYear() - i).map(ano => (
                  <option key={ano} value={ano}>{ano}</option>
                ))}
              </select>
            </Tooltip>
          </div>

          {/* Mês */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Mês
            </label>
            <Tooltip content="Filtrar repasses por mês específico ou ver todos">
              <select
                value={filtros.mes}
                onChange={(e) => handleFiltroChange("mes", Number(e.target.value) || "")}
                className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Todos</option>
                <option value="1">Janeiro</option>
                <option value="2">Fevereiro</option>
                <option value="3">Março</option>
                <option value="4">Abril</option>
                <option value="5">Maio</option>
                <option value="6">Junho</option>
                <option value="7">Julho</option>
                <option value="8">Agosto</option>
                <option value="9">Setembro</option>
                <option value="10">Outubro</option>
                <option value="11">Novembro</option>
                <option value="12">Dezembro</option>
              </select>
            </Tooltip>
          </div>

          {/* Advogado (somente admin) */}
          {isAdmin && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Advogado
            </label>
            <Tooltip content="Filtrar repasses por advogado específico">
              <select
                value={filtros.advogadoId}
                onChange={(e) => handleFiltroChange("advogadoId", e.target.value)}
                className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Todos</option>
                {advogados.map(adv => (
                  <option key={adv.id} value={adv.id}>
                    {adv.nome}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>
          )}

          {/* Botão Limpar */}
          <div className="flex items-end">
            <Tooltip content="Resetar todos os filtros para valores padrão">
              <button
                onClick={limparFiltros}
                className="w-full px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-semibold hover:bg-slate-200 transition"
              >
                Limpar Filtros
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Info de filtros ativos */}
        {(filtros.advogadoId || !filtros.mes) && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                Exibindo dados para:
                {filtros.advogadoId && ` ${advogadoSelecionado?.nome}`}
                {!filtros.mes && ` • Todos os meses de ${filtros.ano}`}
                {filtros.mes && ` • ${filtros.mes}/${filtros.ano}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Tooltip content="Número de competências que ainda estão em processo de apuração">
          <StatCard
            title="Competências Abertas"
            value={data.competenciasAbertas}
            subtitle="Períodos em apuração"
            icon={<IconCalendar />}
            color="blue"
          />
        </Tooltip>

        <Tooltip content="Repasses que ainda não foram processados e pagos">
          <StatCard
            title="Repasses Pendentes"
            value={data.repassesPendentes.quantidade}
            subtitle={formatCurrency(parseFloat(data.repassesPendentes.valorTotal))}
            icon={<IconClock />}
            color="amber"
          />
        </Tooltip>

        <Tooltip content="Total de repasses já processados e pagos no período">
          <StatCard
            title={filtros.mes ? `Realizados ${filtros.mes}/${filtros.ano}` : `Realizados ${filtros.ano}`}
            value={data.repassesRealizados?.quantidade || 0}
            subtitle={formatCurrency(parseFloat(data.repassesRealizados?.valorTotal || "0"))}
            icon={<IconCheck />}
            color="green"
          />
        </Tooltip>

        <Tooltip content="Valor médio calculado por repasse realizado">
          <StatCard
            title="Ticket Médio"
            value={
              data.repassesRealizados?.quantidade > 0
                ? formatCurrency(
                    parseFloat(data.repassesRealizados.valorTotal) / data.repassesRealizados.quantidade
                  )
                : "R$ 0,00"
            }
            subtitle="Valor médio por repasse"
            icon={<IconTrend />}
            color="purple"
          />
        </Tooltip>
      </div>

      {/* Finanças do Advogado — Saldo / Empréstimos / Adiantamentos / Balanço */}
      {financas && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">Minha Situação Financeira</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Tooltip content="Saldo acumulado disponível para repasse">
              <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-2">Saldo Disponível</div>
                <div className="text-2xl font-bold text-blue-900">{formatCurrency(parseFloat(financas.saldo))}</div>
              </div>
            </Tooltip>
            <Tooltip content="Empréstimos: crédito do advogado sobre o escritório (escritório deve ao advogado)">
              <div className="rounded-xl border-2 border-green-200 bg-green-50 p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-2">Empréstimos</div>
                <div className="text-2xl font-bold text-green-900">{formatCurrency(parseFloat(financas.emprestimos))}</div>
              </div>
            </Tooltip>
            <Tooltip content="Adiantamentos: crédito do escritório sobre o advogado (advogado deve ao escritório)">
              <div className="rounded-xl border-2 border-red-200 bg-red-50 p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-2">Adiantamentos</div>
                <div className="text-2xl font-bold text-red-900">{formatCurrency(parseFloat(financas.adiantamentos))}</div>
              </div>
            </Tooltip>
            <Tooltip content="Balanço líquido: Saldo + Empréstimos (a receber do escritório) − Adiantamentos (a devolver ao escritório)">
              <div className={`rounded-xl border-2 p-5 ${parseFloat(financas.balance) >= 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${parseFloat(financas.balance) >= 0 ? "text-green-700" : "text-red-700"}`}>Balanço Líquido</div>
                <div className={`text-2xl font-bold ${parseFloat(financas.balance) >= 0 ? "text-green-900" : "text-red-900"}`}>{formatCurrency(parseFloat(financas.balance))}</div>
              </div>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Saldo do Advogado (se filtrado) */}
      {data.saldoAdvogado && (
        <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-blue-900">{data.saldoAdvogado.advogadoNome}</h2>
              <p className="text-sm text-blue-700">OAB: {data.saldoAdvogado.advogadoOab}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <Tooltip content="Saldo acumulado disponível para saque">
              <div className="bg-white rounded-lg p-4">
                <div className="text-sm text-slate-600 mb-1">Saldo Disponível</div>
                <div className="text-2xl font-bold text-blue-900">
                  {formatCurrency(parseFloat(data.saldoAdvogado.saldo))}
                </div>
              </div>
            </Tooltip>
            
            <Tooltip content="Data da última atualização do saldo">
              <div className="bg-white rounded-lg p-4">
                <div className="text-sm text-slate-600 mb-1">Última Atualização</div>
                <div className="text-lg font-semibold text-slate-900">
                  {(() => { const s = String(data.saldoAdvogado.ultimaAtualizacao || ""); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); const d = m ? new Date(+m[1], +m[2]-1, +m[3], 12) : new Date(s); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('pt-BR') : '—'; })()}
                </div>
              </div>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Advogados */}
        <div className="rounded-xl border-2 border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              {filtros.advogadoId ? 'Advogado Selecionado' : 'Top 5 Advogados'}
            </h2>
          </div>
          
          {data.topAdvogados && data.topAdvogados.length > 0 ? (
            <div className="space-y-3">
              {data.topAdvogados.map((adv, index) => (
                <Tooltip key={adv.advogadoId} content={`${adv.quantidade} repasse${adv.quantidade > 1 ? 's' : ''} totalizando ${formatCurrency(parseFloat(adv.valorTotal))}`}>
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 hover:border-purple-300 transition">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 shrink-0 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-purple-600">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{adv.advogadoNome}</div>
                          <div className="text-sm text-slate-600">OAB: {adv.advogadoOab}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-purple-900">
                          {formatCurrency(parseFloat(adv.valorTotal))}
                        </div>
                        <div className="text-sm text-slate-600">
                          {adv.quantidade} repasse{adv.quantidade > 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <p>Nenhum repasse realizado no período</p>
            </div>
          )}
        </div>

        {/* Histórico Mensal */}
        <div className="rounded-xl border-2 border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-900">Últimos 6 Meses</h2>
          </div>

          {data.historicoMensal && data.historicoMensal.length > 0 ? (
            <div className="space-y-2">
              {data.historicoMensal.map((item) => (
                <Tooltip key={item.label} content={`${item.quantidade} repasse${item.quantidade !== 1 ? 's' : ''} em ${item.label}`}>
                  <div className="flex items-center justify-between gap-4 p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-16 shrink-0 text-sm font-semibold text-slate-700">
                        {item.label}
                      </div>
                      <div className="text-sm text-slate-500">
                        {item.quantidade} repasse{item.quantidade !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="font-bold text-blue-900 shrink-0">
                      {formatCurrency(parseFloat(item.valor))}
                    </div>
                  </div>
                </Tooltip>
              ))}
              
              <div className="pt-3 mt-3 border-t border-slate-200">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-slate-700">Total do Período</span>
                  <span className="text-lg font-bold text-blue-900">
                    {formatCurrency(
                      data.historicoMensal.reduce((sum, item) => sum + parseFloat(item.valor), 0)
                    )}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <p>Nenhum histórico disponível</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}