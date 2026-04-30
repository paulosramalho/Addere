import React, { useState } from "react";
import logoAddere from "../assets/logo.png";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

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
function brlFromCentavos(c) {
  const n = Number(c || 0) / 100;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Card({ title, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-xs text-slate-600 font-semibold">{title}</div>
      <div className="text-lg font-bold text-slate-900 mt-1">{value}</div>
      {sub ? <div className="text-xs text-slate-600 mt-1">{sub}</div> : null}
    </div>
  );
}

export default function RelatorioSaudeFinanceira() {
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
      const resp = await apiFetch(`/relatorios/fluxo-caixa/saude?${qs.toString()}`);
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

  const ef = data?.efetivo;
  const pr = data?.projetado;

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
            <h1 className="text-xl font-bold text-slate-900">Relatório — Saúde Financeira do Período</h1>
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
              <div className="text-sm font-bold text-slate-900 mb-3">Check-up (executivo)</div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card
                  title="Saldo inicial (Efetivo)"
                  value={`R$ ${brlFromCentavos(ef?.saldoInicialCentavos ?? 0)}`}
                />
                <Card
                  title="Saldo final (Efetivo)"
                  value={`R$ ${brlFromCentavos(ef?.saldoFinalCentavos ?? 0)}`}
                  sub={`Δ no período: R$ ${brlFromCentavos((ef?.saldoFinalCentavos ?? 0) - (ef?.saldoInicialCentavos ?? 0))}`}
                />
                <Card
                  title="Dias no vermelho (Efetivo)"
                  value={`${ef?.diasNoVermelho ?? 0} dia(s)`}
                  sub={`${ef?.percNoVermelho ?? 0}% do período`}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <Card
                  title="Saldo final (Projetado)"
                  value={`R$ ${brlFromCentavos(pr?.saldoFinalCentavos ?? 0)}`}
                />
                <Card
                  title="Dependência de previstos"
                    value={
                      data?.dependenciaPrevistosPerc == null
                        ? "—"
                        : `${data.dependenciaPrevistosPerc}%`
                      }
                      sub={`Previstos (net): R$ ${brlFromCentavos(data?.previstosNetCentavos ?? 0)}`}
                    />
                <Card
                  title="Dias no vermelho (Projetado)"
                  value={`${pr?.diasNoVermelho ?? 0} dia(s)`}
                  sub={`${pr?.percNoVermelho ?? 0}% do período`}
                />
              </div>

              <div className="mt-4 text-sm text-slate-800">
                <div className="font-semibold mb-2">Extremos do período</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs text-slate-600 font-semibold">Menor saldo (Efetivo)</div>
                    <div className="mt-1 font-bold">R$ {brlFromCentavos(ef?.menorSaldo?.saldoCentavos ?? 0)}</div>
                    <div className="text-xs text-slate-600">{ef?.menorSaldo?.dia ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs text-slate-600 font-semibold">Maior saldo (Efetivo)</div>
                    <div className="mt-1 font-bold">R$ {brlFromCentavos(ef?.maiorSaldo?.saldoCentavos ?? 0)}</div>
                    <div className="text-xs text-slate-600">{ef?.maiorSaldo?.dia ?? "—"}</div>
                  </div>
                </div>
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
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Saúde Financeira do Período</div>
            </div>

            <div style={{ borderTop: "2px solid #000", margin: "12px 0" }} />

            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <div><b>Período:</b> {brDate(dtIni)} a {brDate(dtFim)}</div>
              <div><b>Conta(s):</b> Todas</div>
            </div>

            <div style={{ marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saldo inicial (Efetivo)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      R$ {brlFromCentavos(ef?.saldoInicialCentavos ?? 0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saldo final (Efetivo)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      R$ {brlFromCentavos(ef?.saldoFinalCentavos ?? 0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Dias no vermelho (Efetivo)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      {ef?.diasNoVermelho ?? 0} ({ef?.percNoVermelho ?? 0}%)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saldo final (Projetado)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      R$ {brlFromCentavos(pr?.saldoFinalCentavos ?? 0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Dependência de previstos</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      {data?.dependenciaPrevistosPerc === null ? "—" : `${data?.dependenciaPrevistosPerc}%`}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Previstos (net no período)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      R$ {brlFromCentavos(data?.previstosNetCentavos ?? 0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Dias no vermelho (Projetado)</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      {pr?.diasNoVermelho ?? 0} ({pr?.percNoVermelho ?? 0}%)
                    </td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 10, fontSize: 11, color: "#444" }}>
                Menor saldo (Efetivo): <b>R$ {brlFromCentavos(ef?.menorSaldo?.saldoCentavos ?? 0)}</b> em <b>{ef?.menorSaldo?.dia ?? "—"}</b>
                {" • "}
                Maior saldo (Efetivo): <b>R$ {brlFromCentavos(ef?.maiorSaldo?.saldoCentavos ?? 0)}</b> em <b>{ef?.maiorSaldo?.dia ?? "—"}</b>
              </div>
            </div>

            <div className="print-footer">
              <div style={{ borderTop: "2px solid #000", marginBottom: 6 }} />
              <div style={{ fontSize: 10, color: "#444", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>Uso exclusivo do Advogado • Documento gerado automaticamente pelo sistema Addere – Controle de Gestão Financeira</div>
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
