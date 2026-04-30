import React, { useMemo, useState } from "react";
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
function safeArray(v) { return Array.isArray(v) ? v : []; }

function MiniBars({ efetivo, projetado }) {
  const a = Number(efetivo || 0);
  const b = Number(projetado || 0);
  const maxAbs = Math.max(1, Math.abs(a), Math.abs(b));
  const wA = Math.round((Math.abs(a) / maxAbs) * 100);
  const wB = Math.round((Math.abs(b) / maxAbs) * 100);

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 86 }}>Efetivo</div>
        <div style={{ flex: 1, height: 10, background: "#eee" }}>
          <div style={{ width: `${wA}%`, height: 10, background: "#111" }} />
        </div>
        <div style={{ width: 130, textAlign: "right" }}>R$ {brlFromCentavos(a)}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 86 }}>Projetado</div>
        <div style={{ flex: 1, height: 10, background: "#eee" }}>
          <div style={{ width: `${wB}%`, height: 10, background: "#111", opacity: 0.75 }} />
        </div>
        <div style={{ width: 130, textAlign: "right" }}>R$ {brlFromCentavos(b)}</div>
      </div>
    </div>
  );
}

export default function RelatorioFluxoCaixaComparativo() {
  const { addToast } = useToast();

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [dtIni, setDtIni] = useState(toDateInputValue(firstDay));
  const [dtFim, setDtFim] = useState(toDateInputValue(lastDay));

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  async function gerar() {
    setLoading(true);
    setData(null);
    try {
      const qs = new URLSearchParams({ dtIni, dtFim, contaId: "ALL", _ts: String(Date.now()) });
      const resp = await apiFetch(`/relatorios/fluxo-caixa/comparativo?${qs.toString()}`);
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

  const saldoEf = Number(data?.saldoFinalEfetivoCentavos ?? 0);
  const saldoPr = Number(data?.saldoFinalProjetadoCentavos ?? 0);
  const diff = Number(data?.diferencaCentavos ?? 0);
  const impacto = data?.impactoPercentual; // pode ser null
  const diasRiscoEf = Number(data?.diasRiscoEfetivo ?? 0);
  const diasRiscoPr = Number(data?.diasRiscoProjetado ?? 0);
  const previstos = Number(data?.totalPrevistosCentavos ?? 0);

  const sinal = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const diffAbs = Math.abs(diff);

  const serie = useMemo(() => safeArray(data?.serie), [data]);

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
            <h1 className="text-xl font-bold text-slate-900">Relatório — Comparativo Efetivo × Projetado</h1>
            <div className="text-sm text-slate-600 mt-1">
              Período: <b>{brDate(dtIni)}</b> a <b>{brDate(dtFim)}</b> • Conta(s): <b>Todas</b>
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

        <div className="no-print mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          {!data ? (
            <div className="text-sm text-slate-600">Gere o relatório para visualizar.</div>
          ) : (
            <>
              <div className="text-sm font-bold text-slate-900 mb-3">Resumo executivo</div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs text-slate-600 font-semibold">Saldo final (Efetivo)</div>
                  <div className="text-lg font-bold text-slate-900 mt-1">R$ {brlFromCentavos(saldoEf)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs text-slate-600 font-semibold">Saldo final (Projetado)</div>
                  <div className="text-lg font-bold text-slate-900 mt-1">R$ {brlFromCentavos(saldoPr)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs text-slate-600 font-semibold">Impacto dos previstos</div>
                  <div className="text-lg font-bold text-slate-900 mt-1">
                    {sinal}R$ {brlFromCentavos(diffAbs)}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {impacto === null ? "Impacto %: — (base efetiva = 0)" : `Impacto %: ${impacto}%`}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <MiniBars efetivo={saldoEf} projetado={saldoPr} />
              </div>

              <div className="mt-3 text-sm text-slate-800 flex flex-wrap gap-6">
                <div><b>Dias de risco (efetivo):</b> {diasRiscoEf}</div>
                <div><b>Dias de risco (projetado):</b> {diasRiscoPr}</div>
                <div><b>Previstos (net):</b> R$ {brlFromCentavos(previstos)}</div>
              </div>

              <div className="mt-2 text-xs text-slate-600">
                Diferença = saldo final projetado − saldo final efetivo.
              </div>
            </>
          )}
        </div>

        {/* PRINT */}
        <div id="print-area" className="print-only">
          <div className="page">
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <img
                src={logoAMR}
                alt="Amanda Maia Ramalho Advogados"
                style={{ maxHeight: 17, maxWidth: 220, objectFit: "contain", display: "block", margin: "0 auto" }}
              />
            </div>

            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Amanda Maia Ramalho Advogados</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Comparativo — Efetivo × Projetado</div>
            </div>

            <div style={{ borderTop: "2px solid #000", margin: "12px 0" }} />

            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <div><b>Período:</b> {brDate(dtIni)} a {brDate(dtFim)}</div>
              <div><b>Conta(s):</b> Todas</div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 12 }}>RESUMO EXECUTIVO</div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saldo final (Efetivo)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      R$ {brlFromCentavos(saldoEf)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saldo final (Projetado)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      R$ {brlFromCentavos(saldoPr)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Impacto dos previstos (diferença)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      {sinal}R$ {brlFromCentavos(diffAbs)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Impacto percentual</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      {impacto === null ? "—" : `${impacto}%`}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Dias de risco (Efetivo / Projetado)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      {diasRiscoEf} / {diasRiscoPr}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 10 }}>
                <MiniBars efetivo={saldoEf} projetado={saldoPr} />
              </div>

              <div style={{ marginTop: 8, fontSize: 11, color: "#444" }}>
                Previsto (net no período): R$ {brlFromCentavos(previstos)}
              </div>
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
