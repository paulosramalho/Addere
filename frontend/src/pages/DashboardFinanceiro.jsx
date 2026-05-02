import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import { centsToBRL } from '../lib/formatters';
import MercadoWidget from "../components/MercadoWidget";

const TIPO_CONTA_LABELS = {
  BANCO:          { label: "Banco",            bg: "#dbeafe", color: "#1e40af" },
  APLICACAO:      { label: "Aplicação",        bg: "#d1fae5", color: "#065f46" },
  CAIXA:          { label: "Caixa",            bg: "#fef9c3", color: "#854d0e" },
  CLIENTES:       { label: "Clientes",         bg: "#ede9fe", color: "#5b21b6" },
  CARTAO_CREDITO: { label: "Cartão de Crédito",bg: "#fee2e2", color: "#991b1b" },
  CARTAO_DEBITO:  { label: "Cartão de Débito", bg: "#fce7f3", color: "#9d174d" },
  OUTROS:         { label: "Outros",           bg: "#f3f4f6", color: "#374151" },
};

function formatDate(d) {
  if (!d) return "—";
  const s = String(d);
  const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dt = mISO
    ? new Date(Date.UTC(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]), 12, 0, 0))
    : new Date(d);
  if (!Number.isFinite(dt.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getUTCDate())}/${pad(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
}

// Ícones SVG
function IconWallet() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

function IconTrendUp() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

function IconTrendDown() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

// Card de estatística
function StatCard({ title, value, subtitle, icon, color = "blue", trend }) {
  const colors = {
    blue: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", icon: "#3b82f6" },
    green: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", icon: "#22c55e" },
    red: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", icon: "#ef4444" },
    amber: { bg: "#fffbeb", border: "#fde68a", text: "#92400e", icon: "#f59e0b" },
    purple: { bg: "#faf5ff", border: "#e9d5ff", text: "#6b21a8", icon: "#a855f7" },
    slate: { bg: "#f8fafc", border: "#e2e8f0", text: "#334155", icon: "#64748b" },
  };

  const c = colors[color] || colors.blue;

  return (
    <div
      style={{
        background: c.bg,
        border: `2px solid ${c.border}`,
        borderRadius: 12,
        padding: 20,
        transition: "all 0.2s",
        cursor: "default",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: c.text, opacity: 0.8, letterSpacing: "0.5px" }}>
            {title}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: c.text, marginTop: 8 }}>
            {value}
          </div>
          {subtitle && (
            <div style={{ fontSize: 13, color: c.text, opacity: 0.7, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
              {trend === "up" && <span style={{ color: "#22c55e" }}>▲</span>}
              {trend === "down" && <span style={{ color: "#ef4444" }}>▼</span>}
              {subtitle}
            </div>
          )}
        </div>
        <div style={{ color: c.icon, opacity: 0.8 }}>{icon}</div>
      </div>
    </div>
  );
}

// Badge de origem
function getOrigemLabel(origem) {
  const labels = {
    MANUAL: "Manual",
    PAGAMENTO_RECEBIDO: "Recebimento",
    PARCELA_PREVISTA: "Parcela Prevista",
    PARCELA_FIXA_AUTOMATICA: "Legado",
    REPASSES_REALIZADOS: "Legado",
    EMPRESTIMO_SOCIO_PAGAMENTO: "Legado",
    DESPESA: "Despesa",
  };
  return labels[origem] || origem;
}

export default function DashboardFinanceiro({ user }) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  async function loadData() {
    setLoading(true);
    setErr("");
    try {
      const resp = await apiFetch(`/dashboard/financeiro?ano=${ano}&mes=${mes}`);
      setData(resp);
    } catch (e) {
      setErr(e.message || "Erro ao carregar dashboard");
      addToast(e.message || "Erro ao carregar dashboard", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ height: 40, background: "#e2e8f0", borderRadius: 8, width: 300, marginBottom: 24 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} style={{ height: 130, background: "#e2e8f0", borderRadius: 12 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: "#fef2f2", border: "2px solid #fecaca", borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 600, color: "#991b1b", fontSize: 18 }}>Erro ao carregar</div>
          <div style={{ color: "#b91c1c", marginTop: 8 }}>{err}</div>
          <button
            onClick={loadData}
            style={{
              marginTop: 16,
              padding: "10px 20px",
              background: "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const resultadoMes = data.mesSumario?.resultadoCentavos || 0;
  const resultadoAno = data.anoSumario?.resultadoCentavos || 0;
  const saldoComposicao = data.saldoAtualComposicao || null;
  const saldoPorConta = data.saldoPorConta || [];
  const saldoPorContaTotais = saldoPorConta.reduce((acc, conta) => ({
    saldoInicialCentavos: acc.saldoInicialCentavos + (conta.saldoInicialCentavos || 0),
    entradasCentavos: acc.entradasCentavos + (conta.entradasCentavos || 0),
    saidasCentavos: acc.saidasCentavos + (conta.saidasCentavos || 0),
    saldoCentavos: acc.saldoCentavos + (conta.saldoCentavos || 0),
  }), { saldoInicialCentavos: 0, entradasCentavos: 0, saidasCentavos: 0, saldoCentavos: 0 });
  const diferencaSaldoContas = saldoComposicao?.diferencaSaldoContasCentavos ?? (data.saldoAtualCentavos - saldoPorContaTotais.saldoCentavos);
  const statusDiferenteOk = saldoComposicao?.statusDiferenteOk;
  const totalExcluidosSaldo = (saldoComposicao?.semConta?.count || 0)
    + (saldoComposicao?.foraContasAtivas?.count || 0)
    + (statusDiferenteOk?.count || 0);

  return (
    <div style={{ padding: 24, background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0f172a", margin: 0 }}>Dashboard Financeiro</h1>
            <p style={{ color: "#64748b", marginTop: 4 }}>Visão geral das finanças • {mes === 0 ? `Ano ${ano}` : `${meses[mes - 1]} de ${ano}`}</p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Tooltip content="Selecione o mês ou visualize todo o ano">
              <select
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
                style={{
                  padding: "10px 16px",
                  border: "2px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <option value={0}>Todo o ano</option>
                {meses.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </Tooltip>
            <Tooltip content="Selecione o ano">
              <select
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                style={{
                  padding: "10px 16px",
                  border: "2px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                {Array.from({ length: 10 }, (_, i) => hoje.getFullYear() - i).map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Tooltip>
            <Tooltip content="Atualizar dados">
              <button
                onClick={loadData}
                style={{
                  padding: "10px 20px",
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Atualizar
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Mercado Financeiro */}
        <MercadoWidget />

        {/* Cards principais */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
          <Tooltip content="Saldo total de todas as contas (apenas lançamentos efetivados)">
            <StatCard
              title="Saldo Atual"
              value={centsToBRL(data.saldoAtualCentavos)}
              subtitle="Todas as contas"
              icon={<IconWallet />}
              color={data.saldoAtualCentavos >= 0 ? "green" : "red"}
            />
          </Tooltip>

          <Tooltip content={`Total de receitas recebidas ${mes === 0 ? `em ${ano}` : `em ${meses[mes - 1]}`}`}>
            <StatCard
              title={mes === 0 ? `Entradas ${ano}` : `Entradas ${meses[mes - 1]}`}
              value={centsToBRL(data.mesSumario?.entradasCentavos)}
              subtitle={`${data.mesSumario?.quantidadeLancamentos || 0} lançamentos ${mes === 0 ? "no ano" : "no mês"}`}
              icon={<IconTrendUp />}
              color="green"
            />
          </Tooltip>

          <Tooltip content={`Total de despesas pagas ${mes === 0 ? `em ${ano}` : `em ${meses[mes - 1]}`}`}>
            <StatCard
              title={mes === 0 ? `Saídas ${ano}` : `Saídas ${meses[mes - 1]}`}
              value={centsToBRL(data.mesSumario?.saidasCentavos)}
              icon={<IconTrendDown />}
              color="red"
            />
          </Tooltip>

          <Tooltip content={`Resultado (Entradas - Saídas) ${mes === 0 ? `do ano ${ano}` : `do mês de ${meses[mes - 1]}`}`}>
            <StatCard
              title={mes === 0 ? `Resultado ${ano}` : "Resultado do Mês"}
              value={centsToBRL(resultadoMes)}
              subtitle={resultadoMes >= 0 ? "Superávit" : "Déficit"}
              icon={<IconChart />}
              color={resultadoMes >= 0 ? "blue" : "amber"}
              trend={resultadoMes >= 0 ? "up" : "down"}
            />
          </Tooltip>

          {mes !== 0 && (
            <Tooltip content={`Resultado acumulado do ano de ${ano}`}>
              <StatCard
                title={`Resultado ${ano}`}
                value={centsToBRL(resultadoAno)}
                subtitle={`Entradas: ${centsToBRL(data.anoSumario?.entradasCentavos)}`}
                icon={<IconChart />}
                color={resultadoAno >= 0 ? "purple" : "amber"}
                trend={resultadoAno >= 0 ? "up" : "down"}
              />
            </Tooltip>
          )}

          <Tooltip content="Lançamentos que precisam de revisão ou estão pendentes de conta">
            <StatCard
              title="Pendências"
              value={data.pendencias || 0}
              subtitle={data.pendencias > 0 ? "Atenção necessária" : "Tudo em ordem"}
              icon={<IconAlert />}
              color={data.pendencias > 0 ? "amber" : "slate"}
            />
          </Tooltip>
        </div>

        {saldoComposicao && (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                  <IconWallet /> Composição do Saldo Atual
                </h3>
                <div style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>
                  Até {formatDate(saldoComposicao.dataFinal)} | {saldoComposicao.lancamentosCount || 0} lançamentos considerados
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: data.saldoAtualCentavos >= 0 ? "#16a34a" : "#dc2626" }}>
                {centsToBRL(data.saldoAtualCentavos)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 0, borderBottom: "1px solid #e2e8f0" }}>
              {[
                { label: "Saldo inicial", value: saldoComposicao.saldoInicialCentavos, color: "#0f172a" },
                { label: "Entradas efetivadas", value: saldoComposicao.entradasCentavos, color: "#16a34a", prefix: "+" },
                { label: "Saídas efetivadas", value: saldoComposicao.saidasCentavos, color: "#dc2626", prefix: "-" },
                { label: "Saldo calculado", value: saldoComposicao.totalCentavos, color: saldoComposicao.totalCentavos >= 0 ? "#16a34a" : "#dc2626" },
              ].map((item, idx) => (
                <div key={item.label} style={{ padding: 16, borderRight: idx < 3 ? "1px solid #e2e8f0" : "none" }}>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>{item.label}</div>
                  <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: item.color }}>
                    {item.prefix || ""}{centsToBRL(item.value)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: 16, display: "grid", gap: 8, fontSize: 13, color: "#334155" }}>
              <div>
                Regra: {saldoComposicao.regra || "Somente lançamentos efetivados do Livro Caixa."}
              </div>
              <div>
                Fórmula: {centsToBRL(saldoComposicao.saldoInicialCentavos)} + {centsToBRL(saldoComposicao.entradasCentavos)} - {centsToBRL(saldoComposicao.saidasCentavos)} = <strong>{centsToBRL(saldoComposicao.totalCentavos)}</strong>
              </div>
              <div>
                Total da tabela Saldo por Conta: <strong>{centsToBRL(saldoPorContaTotais.saldoCentavos)}</strong>. Diferença para o card: <strong style={{ color: diferencaSaldoContas === 0 ? "#16a34a" : "#dc2626" }}>{centsToBRL(diferencaSaldoContas)}</strong>.
              </div>
              {totalExcluidosSaldo > 0 && (
                <div style={{ marginTop: 4, padding: 12, borderRadius: 8, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                  {statusDiferenteOk?.count > 0 && (
                    <div>
                      Ignorados por status diferente de OK: {centsToBRL(statusDiferenteOk.liquidoCentavos)} ({statusDiferenteOk.count} lançamento(s)).
                      {Array.isArray(statusDiferenteOk.porStatus) && statusDiferenteOk.porStatus.length > 0 && (
                        <span> {statusDiferenteOk.porStatus.map((s) => `${s.status}: ${centsToBRL(s.liquidoCentavos)}`).join(" | ")}</span>
                      )}
                    </div>
                  )}
                  {saldoComposicao.semConta?.count > 0 && (
                    <div>
                      Ignorados sem conta: {centsToBRL(saldoComposicao.semConta.liquidoCentavos)} ({saldoComposicao.semConta.count} lançamento(s)).
                    </div>
                  )}
                  {saldoComposicao.foraContasAtivas?.count > 0 && (
                    <div>
                      Ignorados em contas inativas ou fora da lista: {centsToBRL(saldoComposicao.foraContasAtivas.liquidoCentavos)} ({saldoComposicao.foraContasAtivas.count} lançamento(s)).
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Segunda linha de cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
          <Tooltip content="Contratos de pagamento ativos no sistema">
            <StatCard
              title="Contratos Ativos"
              value={data.contratosAtivos || 0}
              icon={<IconDocument />}
              color="blue"
            />
          </Tooltip>

          <Tooltip content="Parcelas em atraso">
            <StatCard
              title="Parcelas Atrasadas"
              value={data.parcelas?.atrasadas || 0}
              subtitle={data.parcelas?.atrasadas > 0 ? centsToBRL(data.parcelas?.valorAtrasadoCentavos) : "Nenhuma"}
              icon={<IconClock />}
              color={data.parcelas?.atrasadas > 0 ? "red" : "green"}
            />
          </Tooltip>

          <Tooltip content="Lançamentos previstos (ainda não efetivados)">
            <StatCard
              title="Previstos"
              value={data.previstos?.count || 0}
              subtitle={`E: ${centsToBRL(data.previstos?.entradasCentavos)} | S: ${centsToBRL(data.previstos?.saidasCentavos)}`}
              icon={<IconClock />}
              color="slate"
            />
          </Tooltip>
        </div>

        {/* Inadimplência */}
        {data.inadimplencia && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
            <Tooltip content="Clientes com ao menos uma parcela vencida e não recebida. Clique para ver o relatório.">
              <div onClick={() => navigate("/relatorios/inadimplencia")} style={{ cursor: "pointer" }}>
                <StatCard
                  title="Clientes Inadimplentes"
                  value={data.inadimplencia.clientesCount}
                  subtitle={`${data.inadimplencia.parcelasCount} parcela(s) · ${centsToBRL(data.inadimplencia.valorCentavos)}`}
                  icon={<IconAlert />}
                  color={data.inadimplencia.clientesCount > 0 ? "red" : "green"}
                />
              </div>
            </Tooltip>

            <Tooltip content="Taxa de inadimplência = valor vencido / total a receber. Clique para ver o relatório.">
              <div onClick={() => navigate("/relatorios/inadimplencia")} style={{ cursor: "pointer" }}>
                <StatCard
                  title="Taxa de Inadimplência"
                  value={`${data.inadimplencia.taxaPercent?.toFixed(1) || "0,0"}%`}
                  subtitle={data.inadimplencia.taxaPercent > 10 ? "Acima do limite recomendado" : "Dentro do esperado"}
                  icon={<IconChart />}
                  color={data.inadimplencia.taxaPercent > 10 ? "amber" : "slate"}
                  trend={data.inadimplencia.taxaPercent > 10 ? "down" : undefined}
                />
              </div>
            </Tooltip>

            <Tooltip content="Parcelas a vencer nos próximos 30 dias">
              <StatCard
                title="A Vencer (30 dias)"
                value={data.proximasVencer?.length || 0}
                subtitle={`Total: ${centsToBRL((data.proximasVencer || []).reduce((s, p) => s + p.valorPrevistoCentavos, 0))}`}
                icon={<IconClock />}
                color="blue"
              />
            </Tooltip>
          </div>
        )}

        {/* Próximas a vencer */}
        {data.proximasVencer?.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", background: "#eff6ff" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1e40af", display: "flex", alignItems: "center", gap: 8 }}>
                <IconClock /> Próximas a Vencer (30 dias)
              </h3>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Cliente</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Contrato / Parcela</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Vencimento</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.proximasVencer.map((p, idx) => {
                  const venc = new Date(p.vencimento);
                  const dias = Math.ceil((venc.getTime() - Date.now()) / 86400000);
                  return (
                    <tr key={p.id} style={{ borderBottom: idx < data.proximasVencer.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 500, color: "#0f172a", fontSize: 14 }}>{p.clienteNome}</td>
                      <td style={{ padding: "12px 8px", color: "#64748b", fontSize: 13 }}>{p.numeroContrato} · #{p.numero}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13 }}>
                        <span style={{ color: dias <= 5 ? "#dc2626" : dias <= 15 ? "#d97706" : "#0f172a" }}>
                          {formatDate(p.vencimento)}{" "}
                          <span style={{ fontSize: 11, opacity: 0.7 }}>({dias}d)</span>
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#16a34a", fontSize: 14 }}>
                        {centsToBRL(p.valorPrevistoCentavos)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Grid principal */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24 }}>
          {/* Top Entradas */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", background: "#f0fdf4" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#166534", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#22c55e" }}>▲</span> Top 5 Entradas {mes === 0 ? "do Ano" : "do Mês"}
              </h3>
            </div>
            <div style={{ padding: 0 }}>
              {data.topEntradas?.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {data.topEntradas.map((item, idx) => (
                      <tr key={item.id} style={{ borderBottom: idx < data.topEntradas.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        <td style={{ padding: "12px 16px", width: 40 }}>
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: "#dcfce7",
                            color: "#166534",
                            fontWeight: 700,
                            fontSize: 12,
                          }}>
                            {idx + 1}
                          </span>
                        </td>
                        <td style={{ padding: "12px 8px" }}>
                          <div style={{ fontWeight: 500, color: "#0f172a", fontSize: 14 }}>{item.descricao}</div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                            {formatDate(item.data)} • {getOrigemLabel(item.origem)}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <span style={{ fontWeight: 700, color: "#16a34a", fontSize: 15 }}>
                            {centsToBRL(item.valorCentavos)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  Nenhuma entrada registrada {mes === 0 ? "no ano" : "no mês"}
                </div>
              )}
            </div>
          </div>

          {/* Top Saídas */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", background: "#fef2f2" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#991b1b", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#ef4444" }}>▼</span> Top 5 Saídas {mes === 0 ? "do Ano" : "do Mês"}
              </h3>
            </div>
            <div style={{ padding: 0 }}>
              {data.topSaidas?.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {data.topSaidas.map((item, idx) => (
                      <tr key={item.id} style={{ borderBottom: idx < data.topSaidas.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        <td style={{ padding: "12px 16px", width: 40 }}>
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: "#fee2e2",
                            color: "#991b1b",
                            fontWeight: 700,
                            fontSize: 12,
                          }}>
                            {idx + 1}
                          </span>
                        </td>
                        <td style={{ padding: "12px 8px" }}>
                          <div style={{ fontWeight: 500, color: "#0f172a", fontSize: 14 }}>{item.descricao}</div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                            {formatDate(item.data)} • {getOrigemLabel(item.origem)}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <span style={{ fontWeight: 700, color: "#dc2626", fontSize: 15 }}>
                            {centsToBRL(item.valorCentavos)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  Nenhuma saída registrada {mes === 0 ? "no ano" : "no mês"}
                </div>
              )}
            </div>
          </div>

          {/* Histórico Mensal */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", background: "#eff6ff" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1e40af", display: "flex", alignItems: "center", gap: 8 }}>
                <IconChart /> {mes === 0 ? `Histórico Mensal de ${ano}` : "Histórico dos Últimos 6 Meses"}
              </h3>
            </div>
            <div style={{ padding: 0 }}>
              {data.historicoMensal?.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Mês</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#16a34a" }}>Entradas</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#dc2626" }}>Saídas</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.historicoMensal.map((item, idx) => (
                      <tr key={item.label} style={{ borderBottom: idx < data.historicoMensal.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 600, color: "#0f172a" }}>{item.label}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#16a34a", fontWeight: 500 }}>
                          {centsToBRL(item.entradasCentavos)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#dc2626", fontWeight: 500 }}>
                          {centsToBRL(item.saidasCentavos)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: item.resultadoCentavos >= 0 ? "#16a34a" : "#dc2626" }}>
                          {item.resultadoCentavos >= 0 ? "+" : ""}{centsToBRL(item.resultadoCentavos)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  Nenhum histórico disponível
                </div>
              )}
            </div>
          </div>

          {/* Saldo por Conta */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", background: "#faf5ff" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#6b21a8", display: "flex", alignItems: "center", gap: 8 }}>
                <IconWallet /> Saldo por Conta
              </h3>
            </div>
            <div style={{ padding: 0, overflowX: "auto" }}>
              {saldoPorConta.length > 0 ? (
                <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Conta</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Saldo inicial</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#16a34a" }}>Entradas</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#dc2626" }}>Saídas</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saldoPorConta.map((conta, idx) => (
                      <tr key={conta.id} style={{ borderBottom: idx < saldoPorConta.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 500, color: "#0f172a" }}>
                          <div>{conta.nome}</div>
                          {(() => {
                            const t = TIPO_CONTA_LABELS[conta.tipo] || { label: conta.tipo, bg: "#f3f4f6", color: "#374151" };
                            return (
                              <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: t.bg, color: t.color }}>
                                {t.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#334155", fontWeight: 500 }}>
                          {centsToBRL(conta.saldoInicialCentavos)}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#16a34a", fontWeight: 500 }}>
                          {conta.entradasCentavos > 0 ? centsToBRL(conta.entradasCentavos) : "-"}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#dc2626", fontWeight: 500 }}>
                          {conta.saidasCentavos > 0 ? centsToBRL(conta.saidasCentavos) : "-"}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: conta.saldoCentavos >= 0 ? "#16a34a" : "#dc2626" }}>
                          {centsToBRL(conta.saldoCentavos)}
                        </td>
                      </tr>
                    ))}
                    {/* Total — soma dos saldos das contas (exclui lançamentos sem conta) */}
                    <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 700, color: "#0f172a" }}>Total</td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#334155" }}>
                        {centsToBRL(saldoPorContaTotais.saldoInicialCentavos)}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                        {centsToBRL(saldoPorContaTotais.entradasCentavos)}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#dc2626" }}>
                        {centsToBRL(saldoPorContaTotais.saidasCentavos)}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 800, fontSize: 16, color: saldoPorContaTotais.saldoCentavos >= 0 ? "#16a34a" : "#dc2626" }}>
                        {centsToBRL(saldoPorContaTotais.saldoCentavos)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  Nenhuma conta cadastrada
                </div>
              )}
            </div>
          </div>

          {/* Totais por Origem */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", gridColumn: "span 2" }}>
            <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#334155", display: "flex", alignItems: "center", gap: 8 }}>
                Movimentação por Origem ({mes === 0 ? ano : meses[mes - 1]})
              </h3>
            </div>
            <div style={{ padding: 0 }}>
              {data.totaisPorOrigem?.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Origem</th>
                      <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Qtd</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#16a34a" }}>Entradas</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#dc2626" }}>Saídas</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#64748b" }}>Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.totaisPorOrigem.map((item, idx) => {
                      const liquido = item.entradasCentavos - item.saidasCentavos;
                      return (
                        <tr key={item.origem} style={{ borderBottom: idx < data.totaisPorOrigem.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{
                              display: "inline-block",
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              background: "#f1f5f9",
                              color: "#334155",
                            }}>
                              {getOrigemLabel(item.origem)}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center", color: "#64748b" }}>{item.count}</td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#16a34a", fontWeight: 500 }}>
                            {item.entradasCentavos > 0 ? centsToBRL(item.entradasCentavos) : "—"}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#dc2626", fontWeight: 500 }}>
                            {item.saidasCentavos > 0 ? centsToBRL(item.saidasCentavos) : "—"}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: liquido >= 0 ? "#16a34a" : "#dc2626" }}>
                            {liquido >= 0 ? "+" : ""}{centsToBRL(liquido)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  Nenhuma movimentação no mês
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
