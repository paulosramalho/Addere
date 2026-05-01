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

// Catmull-Rom → cubic bezier (curva suave)
function smoothPath(pts) {
  if (pts.length < 2) return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const t = 0.4;
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) * t;
    const cp1y = p1.y + (p2.y - p0.y) * t;
    const cp2x = p2.x - (p3.x - p1.x) * t;
    const cp2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function ChartSVG({ series, width = 980, height = 300, padding = 44 }) {
  const pts = safeArray(series).map((p) => ({
    ef: Number(p?.saldoEfetivoCentavos ?? 0),
    pr: Number(p?.saldoProjetadoCentavos ?? 0),
  }));
  if (!pts.length) return <div style={{ color: "#666", fontSize: 12 }}>Sem dados para o período.</div>;

  const ys = pts.flatMap((p) => [p.ef, p.pr]).filter(Number.isFinite);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = Math.max(1, maxY - minY);

  const spanX = Math.max(1, pts.length - 1);
  const scaleX = (i) => padding + (i / spanX) * (width - padding * 2);
  const scaleY = (v) => padding + (1 - (v - minY) / spanY) * (height - padding * 2);

  const scaledEf = pts.map((p, i) => ({ x: scaleX(i), y: scaleY(p.ef) }));
  const scaledPr = pts.map((p, i) => ({ x: scaleX(i), y: scaleY(p.pr) }));

  const pathEf = smoothPath(scaledEf);
  const pathPr = smoothPath(scaledPr);

  const baseY = scaleY(minY);
  const areaEf = `${pathEf} L ${scaledEf[scaledEf.length - 1].x.toFixed(2)},${baseY.toFixed(2)} L ${scaledEf[0].x.toFixed(2)},${baseY.toFixed(2)} Z`;

  const showZero = minY < 0 && maxY > 0;
  const y0 = scaleY(0);

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => padding + (1 - f) * (height - padding * 2));

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Desempenho do caixa">
      <defs>
        <linearGradient id="gradEfDes" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2a4a" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#1a2a4a" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* grid */}
      {gridLines.map((y, i) => (
        <line key={i} x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeWidth="1" />
      ))}

      {/* eixos */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />

      {showZero && (
        <line x1={padding} y1={y0} x2={width - padding} y2={y0} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
      )}

      {/* área efetivo */}
      <path d={areaEf} fill="url(#gradEfDes)" />

      {/* linha efetivo */}
      <path d={pathEf} fill="none" stroke="#1a2a4a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* linha projetado (tracejada dourada) */}
      <path d={pathPr} fill="none" stroke="#b8a06a" strokeWidth="2" strokeDasharray="7 4" strokeLinecap="round" strokeLinejoin="round" />

      {/* legenda */}
      <rect x={padding} y={padding - 24} width="18" height="3" fill="#1a2a4a" rx="1" />
      <text x={padding + 22} y={padding - 18} fontSize="10" fill="#1a2a4a" fontWeight="600">Efetivo</text>

      <rect x={padding + 90} y={padding - 24} width="18" height="3" fill="#b8a06a" rx="1" />
      <text x={padding + 112} y={padding - 18} fontSize="10" fill="#b8a06a" fontWeight="600">Projetado</text>
    </svg>
  );
}

export default function RelatorioFluxoCaixaDesempenho() {
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
      const resp = await apiFetch(`/relatorios/fluxo-caixa/desempenho?${qs.toString()}`);
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
            <h1 className="text-xl font-bold text-slate-900">Relatório — Desempenho do Caixa (Gráfico)</h1>
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
              <div className="text-sm font-bold text-slate-900 mb-2">Efetivo × Projetado (diário)</div>
              <ChartSVG series={serie} />

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Menor saldo (Efetivo)</div>
                  <div className="mt-1 font-bold">R$ {brlFromCentavos(data?.minEfetivo?.saldoCentavos ?? 0)}</div>
                  <div className="text-xs text-slate-600">{data?.minEfetivo?.dia ?? "—"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Maior saldo (Efetivo)</div>
                  <div className="mt-1 font-bold">R$ {brlFromCentavos(data?.maxEfetivo?.saldoCentavos ?? 0)}</div>
                  <div className="text-xs text-slate-600">{data?.maxEfetivo?.dia ?? "—"}</div>
                </div>
              </div>

              <div className="mt-3 text-sm text-slate-800 flex flex-wrap gap-6">
                <div><b>Dias no vermelho (efetivo):</b> {Number(data?.diasNegativosEfetivo ?? 0)}</div>
                <div><b>Dias no vermelho (projetado):</b> {Number(data?.diasNegativosProjetado ?? 0)}</div>
              </div>
            </>
          )}
        </div>

        {/* PRINT */}
        <div id="print-area" className="print-only">
          <div className="page">
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <img src={logoAMR} alt="Addere"
                style={{ maxHeight: 17, maxWidth: 220, objectFit: "contain", display: "block", margin: "0 auto" }} />
            </div>

            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Addere</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Desempenho do Caixa — Gráfico</div>
            </div>

            <div style={{ borderTop: "2px solid #000", margin: "12px 0" }} />

            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <div><b>Período:</b> {brDate(dtIni)} a {brDate(dtFim)}</div>
              <div><b>Conta(s):</b> Todas</div>
            </div>

            <div style={{ marginTop: 12 }}>
              <ChartSVG series={serie} />
              <div style={{ marginTop: 10, fontSize: 11, color: "#444" }}>
                Menor saldo (Efetivo): <b>R$ {brlFromCentavos(data?.minEfetivo?.saldoCentavos ?? 0)}</b> em <b>{data?.minEfetivo?.dia ?? "—"}</b>
                {" • "}
                Maior saldo (Efetivo): <b>R$ {brlFromCentavos(data?.maxEfetivo?.saldoCentavos ?? 0)}</b> em <b>{data?.maxEfetivo?.dia ?? "—"}</b>
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#444" }}>
                Dias no vermelho — Efetivo: <b>{Number(data?.diasNegativosEfetivo ?? 0)}</b> • Projetado: <b>{Number(data?.diasNegativosProjetado ?? 0)}</b>
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
