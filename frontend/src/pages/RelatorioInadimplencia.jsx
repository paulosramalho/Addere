import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

const BRL = (cents) => {
  const v = Math.abs(cents) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("pt-BR", { timeZone: "America/Belem" });
};

const RISCO = {
  NORMAL:     { label: "≤ 30 dias",  bg: "bg-green-100",  text: "text-green-800",  border: "border-green-300" },
  ATENCAO:    { label: "31–60 dias", bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-300" },
  ALTO_RISCO: { label: "61–90 dias", bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300" },
  DUVIDOSO:   { label: "> 90 dias",  bg: "bg-red-100",    text: "text-red-800",    border: "border-red-300" },
};

function RiscoBadge({ risco, small }) {
  const r = RISCO[risco] || RISCO.NORMAL;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium
      ${small ? "text-xs" : "text-xs"} ${r.bg} ${r.text} ${r.border}`}>
      {r.label}
    </span>
  );
}

function SummaryCard({ label, value, sub, color = "text-slate-900" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default function RelatorioInadimplencia({ user }) {
  const { addToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  const [diasMinimos, setDiasMinimos] = useState("0");
  const [advogadoId, setAdvogadoId]   = useState("");
  const [advogados, setAdvogados]     = useState([]);
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [expanded, setExpanded]       = useState(new Set());
  const [exporting, setExporting]     = useState(false);

  useEffect(() => {
    if (isAdmin) {
      apiFetch("/advogados").then(d => setAdvogados(Array.isArray(d) ? d : [])).catch(() => {});
    }
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buscar() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (diasMinimos && Number(diasMinimos) > 0) params.set("diasMinimos", diasMinimos);
      if (advogadoId) params.set("advogadoId", advogadoId);
      const result = await apiFetch(`/relatorios/inadimplencia?${params}`);
      setData(result);
      setExpanded(new Set());
    } catch (e) {
      addToast(e?.message || "Erro ao buscar dados.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function exportXLSX() {
    if (!data || !clientes.length) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = [];
      rows.push(["Cliente", "CPF/CNPJ", "Telefone", "Contrato", "Parcela", "Vencimento", "Dias Atraso", "Risco", "Valor (R$)"]);
      for (const { cliente, parcelas } of clientes) {
        for (const p of parcelas) {
          rows.push([
            cliente.nomeRazaoSocial,
            cliente.cpfCnpj || "",
            cliente.telefone || "",
            p.numeroContrato,
            `#${p.numero}`,
            fmtDate(p.vencimento),
            p.diasEmAtraso,
            RISCO[p.risco]?.label || p.risco,
            (p.valorPrevistoCentavos / 100).toFixed(2).replace(".", ","),
          ]);
        }
      }
      rows.push([]);
      rows.push(["Total inadimplente", "", "", "", "", "", "", "", (totais.valorTotalCentavos / 100).toFixed(2).replace(".", ",")]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inadimplência");
      XLSX.writeFile(wb, `inadimplencia_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      addToast("Erro ao exportar Excel.", "error");
    } finally {
      setExporting(false);
    }
  }

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandAll() {
    if (!data) return;
    setExpanded(new Set(data.clientes.map(c => c.cliente.id)));
  }

  function collapseAll() { setExpanded(new Set()); }

  const { clientes = [], totais = {} } = data || {};

  // Breakdown por risco
  const riscoBreakdown = useMemo(() => {
    if (!clientes.length) return null;
    const counts = { NORMAL: 0, ATENCAO: 0, ALTO_RISCO: 0, DUVIDOSO: 0 };
    clientes.forEach(c => counts[c.riscoDominante]++);
    return counts;
  }, [clientes]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Relatório de Inadimplência</h1>
        <p className="mt-1 text-sm text-slate-500">
          Parcelas vencidas (PREVISTA / PENDENTE) agrupadas por cliente, ordenadas por maior débito.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Atraso mínimo (dias)</label>
          <input
            type="number"
            min="0"
            className="w-28 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            value={diasMinimos}
            onChange={e => setDiasMinimos(e.target.value)}
          />
        </div>

        {isAdmin && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Advogado</label>
            <select
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              value={advogadoId}
              onChange={e => setAdvogadoId(e.target.value)}
            >
              <option value="">Todos</option>
              {advogados.map(a => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={buscar}
          disabled={loading}
          className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? "Buscando…" : "Buscar"}
        </button>

        {data && clientes.length > 0 && (
          <button
            onClick={exportXLSX}
            disabled={exporting}
            className="rounded-xl border border-green-600 bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {exporting ? "Exportando…" : "⬇ XLSX"}
          </button>
        )}
      </div>

      {/* Summary */}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              label="Total inadimplente"
              value={BRL(totais.valorTotalCentavos || 0)}
              color="text-red-700"
            />
            <SummaryCard
              label="Clientes em débito"
              value={totais.clientesCount || 0}
              sub="com ao menos 1 parcela vencida"
            />
            <SummaryCard
              label="Parcelas vencidas"
              value={totais.parcelasCount || 0}
            />
            <SummaryCard
              label="Maior atraso"
              value={`${totais.maiorAtraso || 0} dias`}
            />
          </div>

          {riscoBreakdown && (
            <div className="flex flex-wrap gap-2">
              {["NORMAL","ATENCAO","ALTO_RISCO","DUVIDOSO"].map(r => (
                <div key={r} className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium
                  ${RISCO[r].bg} ${RISCO[r].text} ${RISCO[r].border}`}>
                  <span>{RISCO[r].label}</span>
                  <span className="font-bold">— {riscoBreakdown[r]} cliente(s)</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tabela */}
      {data && clientes.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 text-sm">
          Nenhuma parcela inadimplente {Number(diasMinimos) > 0 ? `com mais de ${diasMinimos} dias de atraso` : "encontrada"}.
        </div>
      )}

      {data && clientes.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Controles de expansão */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">
              {clientes.length} cliente(s) inadimplente(s)
            </span>
            <div className="flex gap-2">
              <button onClick={expandAll} className="text-xs text-blue-600 hover:underline">Expandir todos</button>
              <span className="text-slate-300">|</span>
              <button onClick={collapseAll} className="text-xs text-slate-500 hover:underline">Recolher todos</button>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {clientes.map(({ cliente, parcelas, totalDevidoCentavos, maiorAtraso, riscoDominante }) => {
              const open = expanded.has(cliente.id);
              return (
                <div key={cliente.id}>
                  {/* Linha do cliente */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(cliente.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    <span className={`text-slate-400 text-sm transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm truncate">{cliente.nomeRazaoSocial}</span>
                        <RiscoBadge risco={riscoDominante} small />
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {cliente.cpfCnpj || "—"}{cliente.telefone ? ` · ${cliente.telefone}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-red-700 text-sm">{BRL(totalDevidoCentavos)}</div>
                      <div className="text-xs text-slate-400">
                        {parcelas.length} parcela{parcelas.length !== 1 ? "s" : ""} · até {maiorAtraso}d
                      </div>
                    </div>
                  </button>

                  {/* Detalhe das parcelas */}
                  {open && (
                    <div className="bg-slate-50 border-t border-slate-100">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-200">
                            <th className="px-6 py-2 text-left font-medium">Contrato</th>
                            <th className="px-3 py-2 text-left font-medium">Parcela</th>
                            <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                            <th className="px-3 py-2 text-left font-medium">Atraso</th>
                            <th className="px-3 py-2 text-left font-medium">Risco</th>
                            <th className="px-3 py-2 text-right font-medium">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {parcelas.map(p => (
                            <tr key={p.id} className="hover:bg-white">
                              <td className="px-6 py-2 font-medium text-slate-700">{p.numeroContrato}</td>
                              <td className="px-3 py-2 text-slate-600">#{p.numero}</td>
                              <td className="px-3 py-2 text-slate-600">{fmtDate(p.vencimento)}</td>
                              <td className="px-3 py-2 text-slate-600">{p.diasEmAtraso}d</td>
                              <td className="px-3 py-2"><RiscoBadge risco={p.risco} small /></td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-800">{BRL(p.valorPrevistoCentavos)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-200 bg-white">
                            <td colSpan={5} className="px-6 py-2 text-xs font-semibold text-slate-600">Total</td>
                            <td className="px-3 py-2 text-right font-bold text-red-700">{BRL(totalDevidoCentavos)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
