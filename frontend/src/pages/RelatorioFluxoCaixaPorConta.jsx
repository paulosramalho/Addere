import React, { useEffect, useMemo, useState } from "react";
import logoAddere from "../assets/logo.png";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { brlFromCentavos } from '../lib/formatters';

function pad2(n) { return String(n).padStart(2, "0"); }
function brDate(dt) {
  if (!dt) return "—";
  // Append T12:00:00 to avoid timezone shift issues
  const str = String(dt).includes("T") ? dt : `${dt}T12:00:00`;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function toDateInputValue(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export default function RelatorioFluxoCaixaPorConta() {
  const { addToast } = useToast();

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [dtIni, setDtIni] = useState(toDateInputValue(firstDay));
  const [dtFim, setDtFim] = useState(toDateInputValue(lastDay));

  // aqui faz sentido “ALL” fixo (é o relatório por conta)
  const [incluirPrevistos, setIncluirPrevistos] = useState(true);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  async function gerar() {
    setLoading(true);
    setData(null);
    try {
      const qs = new URLSearchParams({
        dtIni,
        dtFim,
        incluirPrevistos: incluirPrevistos ? "1" : "0",
        contaId: "ALL",
        _ts: String(Date.now()),
      });

      const resp = await apiFetch(`/relatorios/fluxo-caixa/por-conta?${qs.toString()}`);
      setData(resp);
      addToast("Relatório gerado com sucesso.", "success");
    } catch (e) {
      console.error(e);
      addToast(e?.message || "Falha ao gerar relatório.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function gerarEImprimir() {
    await gerar();
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  const contas = useMemo(() => (Array.isArray(data?.contas) ? data.contas : []), [data]);

  return (
    <>
      <style>{`
        .print-only { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area { display:block !important; position:absolute; left:0; top:0; width:100%; padding:16px; }
          .no-print { display:none !important; }
          .print-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 16px; background: #fff; }
          .page { page-break-after: always; padding-bottom: 90px; }
          img { display:block !important; }
        }
      `}</style>

      <div className="p-6">
        <div className="no-print flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Relatório — Fluxo de Caixa por Conta</h1>
            <div className="text-sm text-slate-600 mt-1">
              Período: <b>{brDate(dtIni)}</b> a <b>{brDate(dtFim)}</b> • Conta(s): <b>Todas</b> •{" "}
              {incluirPrevistos ? <b>Efetivo + Previsto</b> : <b>Somente efetivo</b>}
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <button
              onClick={gerar}
              disabled={loading}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {loading ? "Gerando..." : "Gerar"}
            </button>
            <button
              onClick={gerarEImprimir}
              className="rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 px-4 py-2 text-sm font-semibold"
            >
              PDF
            </button>
          </div>
        </div>

        {/* filtros */}
        <div className="no-print mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Data inicial</div>
              <input type="date" value={dtIni} onChange={(e) => setDtIni(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Data final</div>
              <input type="date" value={dtFim} onChange={(e) => setDtFim(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700 mb-2">
                <input type="checkbox" checked={incluirPrevistos} onChange={(e) => setIncluirPrevistos(e.target.checked)} />
                Incluir previstos
              </label>
            </div>
          </div>
        </div>

        {/* tela */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          {!data ? (
            <div className="text-sm text-slate-600">Gere o relatório para visualizar.</div>
          ) : (
            <>
              <div className="text-sm font-bold text-slate-900 mb-3">Resumo por conta</div>

              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-2 text-left">Conta</th>
                    <th className="py-2 text-right">Saldo inicial</th>
                    <th className="py-2 text-right">Entradas</th>
                    <th className="py-2 text-right">Saídas</th>
                    <th className="py-2 text-right">Saldo final</th>
                    <th className="py-2 text-right">Qtd. lanç.</th>
                  </tr>
                </thead>
                <tbody>
                  {contas.map((c) => (
                    <tr key={c.contaId} className="border-t border-slate-100">
                      <td className="py-2 pr-3">{c.contaNome}</td>
                      <td className="py-2 text-right">R$ {brlFromCentavos(c.saldoInicialCentavos)}</td>
                      <td className="py-2 text-right">R$ {brlFromCentavos(c.entradasCentavos)}</td>
                      <td className="py-2 text-right">R$ {brlFromCentavos(c.saidasCentavos)}</td>
                      <td className="py-2 text-right font-semibold">R$ {brlFromCentavos(c.saldoFinalCentavos)}</td>
                      <td className="py-2 text-right">{c.qtdLancamentos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* PRINT */}
        <div id="print-area" className="print-only">
          <div className="page">
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <img
                src={logoAMR}
                alt="Addere"
                style={{ maxHeight: 17, maxWidth: 220, objectFit: "contain", display: "block", margin: "0 auto" }}
              />
            </div>

            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Addere</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Fluxo de Caixa — Por Conta</div>
            </div>

            <div style={{ borderTop: "2px solid #000", margin: "12px 0" }} />

            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <div><b>Período:</b> {brDate(dtIni)} a {brDate(dtFim)}</div>
              <div><b>Conta(s):</b> Todas</div>
              <div><b>Critério:</b> {incluirPrevistos ? "Efetivo + Previsto" : "Somente efetivo"}</div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 12 }}>RESUMO POR CONTA</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "left" }}>Conta</th>
                    <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>Saldo inicial</th>
                    <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>Entradas</th>
                    <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>Saídas</th>
                    <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>Saldo final</th>
                    <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>Qtd.</th>
                  </tr>
                </thead>
                <tbody>
                  {contas.map((c) => (
                    <tr key={c.contaId}>
                      <td style={{ border: "1px solid #DDD", padding: 6 }}>{c.contaNome}</td>
                      <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>R$ {brlFromCentavos(c.saldoInicialCentavos)}</td>
                      <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>R$ {brlFromCentavos(c.entradasCentavos)}</td>
                      <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>R$ {brlFromCentavos(c.saidasCentavos)}</td>
                      <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right", fontWeight: 700 }}>R$ {brlFromCentavos(c.saldoFinalCentavos)}</td>
                      <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>{c.qtdLancamentos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="print-footer">
              <div style={{ borderTop: "2px solid #000", marginBottom: 6 }} />
              <div style={{ fontSize: 10, color: "#444", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  Uso exclusivo do Advogado • Documento gerado automaticamente pelo sistema Addere – Controle de Gestão Financeira
                </div>
                <div style={{ whiteSpace: "nowrap" }}>{brDate(new Date())}</div>
              </div>
              <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>
                Em caso de divergência, contatar o financeiro.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
