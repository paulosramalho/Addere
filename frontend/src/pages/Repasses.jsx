// src/pages/Repasses.jsx - EM APURAÇÃO (PREVISTAS)
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

function monthOptions() {
  return [
    { v: 1, t: "Jan" }, { v: 2, t: "Fev" }, { v: 3, t: "Mar" }, { v: 4, t: "Abr" },
    { v: 5, t: "Mai" }, { v: 6, t: "Jun" }, { v: 7, t: "Jul" }, { v: 8, t: "Ago" },
    { v: 9, t: "Set" }, { v: 10, t: "Out" }, { v: 11, t: "Nov" }, { v: 12, t: "Dez" },
  ];
}

export default function RepassesPage({ user }) {
  const { addToast } = useToast();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      // ✅ CORRIGIDO: endpoint /em-apuracao (parcelas PREVISTAS)
      const res = await apiFetch(`/repasses/em-apuracao?ano=${ano}&mes=${mes}`);
      setData(res);
    } catch (e) {
      const msg = e?.message || "Erro ao carregar prévia.";
      setErr(msg);
      addToast(msg, "error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  async function exportXLSX() {
    if (!linhasVisiveis.length) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      const headers = [
        'Contrato', 'Cliente', 'Parcela', 'Vencimento',
        'Valor Bruto (R$)', 'Alíquota', 'Imposto (R$)', 'Líquido (R$)',
        ...advogadoCols.map(c => c.nome),
        'Escritório (R$)', 'Fundo Reserva (R$)',
      ];

      const rows = linhasVisiveis.map(item => {
        const advMap = new Map((item.advogados || []).map(a => [a.advogadoId, a.valorReais]));
        return [
          item.contratoNumero,
          item.clienteNome,
          item.parcelaNumero,
          formatDate(item.dataVencimento),
          Number(item.valorBruto || 0),
          item.isentoTributacao ? 'Isento' : `${item.aliquotaPercentual}%`,
          Number(item.imposto || 0),
          Number(item.liquido || 0),
          ...advogadoCols.map(c => Number(advMap.get(c.id) || 0)),
          Number(item.escritorio || 0),
          Number(item.fundoReserva || 0),
        ];
      });

      const wsData = [headers, ...rows];
      if (totalsRow) {
        wsData.push([
          'TOTAIS', '', '', '',
          totalsRow.valor, '', totalsRow.imposto, totalsRow.liquido,
          ...advogadoCols.map(c => totalsRow.advTot.get(c.id) || 0),
          totalsRow.escritorio, totalsRow.fundoReserva,
        ]);
      }

      const mm = String(mes).padStart(2, '0');
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, `Repasses ${mm}-${ano}`);
      XLSX.writeFile(wb, `repasses_apuracao_${mm}_${ano}.xlsx`);
    } catch (e) {
      addToast('Erro ao exportar Excel.', 'error');
    } finally {
      setExporting(false);
    }
  }

  const linhasVisiveis = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items;
  }, [data]);

  const advogadoCols = useMemo(() => {
    if (!linhasVisiveis.length) return [];
    const map = new Map();
    for (const item of linhasVisiveis) {
      for (const adv of item.advogados || []) {
        map.set(adv.advogadoId, adv.advogadoNome);
      }
    }
    return [...map.entries()].map(([id, nome]) => ({ id, nome }));
  }, [linhasVisiveis]);

  const totalsRow = useMemo(() => {
    if (!linhasVisiveis.length) return null;
    const advTot = new Map();
    let valor = 0;
    let imposto = 0;
    let liquido = 0;
    let escritorio = 0;
    let fundoReserva = 0;

    for (const item of linhasVisiveis) {
      valor += Number(item.valorBruto || 0);
      imposto += Number(item.imposto || 0);
      liquido += Number(item.liquido || 0);
      escritorio += Number(item.escritorio || 0);
      fundoReserva += Number(item.fundoReserva || 0);
      
      for (const adv of item.advogados || []) {
        const id = adv.advogadoId;
        advTot.set(id, (advTot.get(id) || 0) + Number(adv.valorReais || 0));
      }
    }

    return { valor, imposto, liquido, escritorio, fundoReserva, advTot };
  }, [linhasVisiveis]);

  return (
    <div style={{ padding: 16 }}>
      <div style={card}>

        {/* ✅ HEADER */}
        <div style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: "22px" }}>
            Repasses - Em Apuração
          </h2>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            
            {/* Competência (M) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ opacity: 0.8, fontSize: 12 }}>Competência (M):</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #3b82f6",
                  background: "#dbeafe",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1e40af",
                }}
              >
                <select 
                  value={mes} 
                  onChange={(e) => setMes(Number(e.target.value))} 
                  style={{ border: "none", background: "transparent", fontWeight: 700, color: "#1e40af" }}
                >
                  {monthOptions().map((m) => (
                    <option key={m.v} value={m.v}>{m.t}</option>
                  ))}
                </select>

                <input
                  type="number"
                  value={ano}
                  onChange={(e) => setAno(Number(e.target.value))}
                  style={{ width: 84, border: "none", background: "transparent", fontWeight: 700, color: "#1e40af" }}
                />
              </span>
            </div>

            {/* Referência (M-1) */}
            {data?.referencia && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ opacity: 0.8, fontSize: 12 }}>Ref. (M-1):</span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #64748b",
                    background: "#f1f5f9",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#334155",
                  }}
                >
                  {String(data.referencia.mes).padStart(2, "0")}/{data.referencia.ano}
                </span>
              </div>
            )}

            {/* Alíquota */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ opacity: 0.8, fontWeight: 600, fontSize: 12 }}>Alíquota</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #10b981",
                  background: "#d1fae5",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#065f46",
                }}
              >
                {data?.aliquota?.percentual || "0.00"}%
                {data?.aliquota?.avisoAliquota && (
                  <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>*</span>
                )}
              </span>
            </div>

            {/* Exportar XLSX */}
            {linhasVisiveis.length > 0 && (
              <button
                onClick={exportXLSX}
                disabled={exporting}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid #16a34a",
                  background: exporting ? "#f0fdf4" : "#dcfce7",
                  color: "#15803d",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: exporting ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {exporting ? "Exportando…" : "⬇ XLSX"}
              </button>
            )}
          </div>
        </div>

        {/* ✅ AVISOS */}
        <div style={{ padding: "0 12px" }}>
          {err && (
            <div style={{ marginBottom: 12, padding: 10, background: "#fee2e2", border: "1px solid #ef4444", borderRadius: 8 }}>
              {err}
            </div>
          )}

          {data?.aliquota?.avisoAliquota && (
            <div style={{ 
              marginBottom: 12, 
              padding: 10, 
              background: "#fef3c7", 
              border: "1px solid #f59e0b", 
              borderRadius: 8,
              fontSize: 13,
            }}>
              ℹ️ {data.aliquota.avisoAliquota}
            </div>
          )}

          {data?.periodo?.descricao && (
            <div style={{ 
              marginBottom: 12, 
              padding: 10, 
              background: "#e0e7ff", 
              border: "1px solid #6366f1", 
              borderRadius: 8,
              fontSize: 13,
              color: "#3730a3",
            }}>
              📅 {data.periodo.descricao}
            </div>
          )}

          {data?.alerta && (
            <div style={{ 
              marginBottom: 12, 
              padding: 10, 
              background: "#fff3cd", 
              border: "1px solid #ffc107", 
              borderRadius: 8,
              fontWeight: 600,
            }}>
              {data.alerta}
            </div>
          )}

          {data?.mensagem && (
            <div style={{ 
              marginBottom: 12, 
              padding: 10, 
              background: "#d1ecf1", 
              border: "1px solid #0c5460", 
              borderRadius: 8,
            }}>
              {data.mensagem}
            </div>
          )}
        </div>

        {/* ✅ LEGENDA - AJUSTADA para PREVISTAS */}
        {data?.items?.length > 0 && (
          <div style={{ 
            padding: "0 12px 12px",
            fontSize: 12,
            opacity: 0.7,
          }}>
            💡 <strong>Em Apuração:</strong> Parcelas <strong>PREVISTAS</strong> com vencimento em <strong>{String(data.referencia?.mes).padStart(2, "0")}/{data.referencia?.ano} (M-1)</strong>, estimativa de pagamento em <strong>{String(mes).padStart(2, "0")}/{ano} (M)</strong>
          </div>
        )}

        {/* TABELA */}
        <div style={{ padding: "0 12px 12px" }}>
          {loading && <div>Carregando…</div>}

          {!loading && linhasVisiveis.length > 0 && (
            <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                <thead>
                  <tr style={{ background: "#f6f6f6" }}>
                    <th style={th}>Contrato</th>
                    <th style={th}>Cliente</th>
                    <th style={th}>Parcela</th>
                    <th style={th}>Vencimento</th>
                    <th style={th}>Valor</th>
                    <th style={th}>Alíquota</th>
                    <th style={th}>Imposto</th>
                    <th style={th}>Líquido</th>
                    {advogadoCols.map((c) => (
                      <th key={c.id} style={th}>{c.nome}</th>
                    ))}
                    <th style={th}>Escritório</th>
                    <th style={th}>Fundo Reserva</th>
                  </tr>
                </thead>

                <tbody>
                  {linhasVisiveis.map((item) => {
                    const advMap = new Map(
                      (item.advogados || []).map((a) => [a.advogadoId, a.valorReais])
                    );

                    return (
                      <tr key={item.parcelaId}>
                        <td style={td}>{item.contratoNumero}</td>
                        <td style={td}>{item.clienteNome}</td>
                        <td style={td}>{item.parcelaNumero}</td>
                        {/* ✅ MUDANÇA: mostrar vencimento ao invés de dataRecebimento */}
                        <td style={td}>{formatDate(item.dataVencimento)}</td>
                        <td style={tdNum}>{money(item.valorBruto)}</td>
                        <td style={tdNum}>
                          {item.isentoTributacao ? (
                            <span style={{ fontSize: 11, opacity: 0.7 }}>Isento</span>
                          ) : (
                            `${item.aliquotaPercentual}%`
                          )}
                        </td>
                        <td style={tdNum}>{money(item.imposto)}</td>
                        <td style={tdNum}>{money(item.liquido)}</td>

                        {advogadoCols.map((c) => (
                          <td key={c.id} style={tdNum}>{money(advMap.get(c.id) || 0)}</td>
                        ))}

                        <td style={tdNum}>{money(item.escritorio)}</td>
                        <td style={tdNum}>{money(item.fundoReserva)}</td>
                      </tr>
                    );
                  })}

                  {totalsRow && (
                    <tr style={{ background: "#fafafa", fontWeight: 700 }}>
                      <td style={td} colSpan={4}>Totais</td>
                      <td style={tdNum}>{money(totalsRow.valor)}</td>
                      <td style={td} />
                      <td style={tdNum}>{money(totalsRow.imposto)}</td>
                      <td style={tdNum}>{money(totalsRow.liquido)}</td>

                      {advogadoCols.map((c) => (
                        <td key={c.id} style={tdNum}>{money(totalsRow.advTot.get(c.id) || 0)}</td>
                      ))}
  
                      <td style={tdNum}>{money(totalsRow.escritorio)}</td>
                      <td style={tdNum}>{money(totalsRow.fundoReserva)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && linhasVisiveis.length === 0 && !data?.alerta && !data?.mensagem && (
            <div style={{ marginTop: 12, opacity: 0.8 }}>
              Nenhuma parcela prevista no período.
            </div>
          )}
        </div>   
      </div>             
    </div>       
  );
}

const card = {
  border: "1px solid #ddd",
  borderRadius: 8,
  background: "#fff",
};

const th = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #ddd", whiteSpace: "nowrap", fontSize: 12 };
const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
  fontSize: 13,
};

const tdNum = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

function formatDate(dateStr) {
  if (!dateStr) return "-";
  // Append T12:00:00 to avoid timezone shift issues
  const str = String(dateStr).includes("T") ? dateStr : `${dateStr}T12:00:00`;
  const d = new Date(str);
  if (isNaN(d)) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}