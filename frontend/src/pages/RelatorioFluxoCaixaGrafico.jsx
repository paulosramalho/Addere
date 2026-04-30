import React, { useEffect, useMemo, useState } from "react";
import logoAddere from "../assets/logo.png";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { brlFromCentavos } from '../lib/formatters';

// ========= helpers =========
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

// ========= utilitário: Catmull-Rom → cubic bezier (curva suave) =========
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

// ========= simples SVG chart (sem libs) =========
function LineChartSVG({ points, width = 980, height = 260, padding = 44 }) {
  const pts = safeArray(points).filter((p) => Number.isFinite(p?.y));
  if (!pts.length) return <div style={{ color: "#666", fontSize: 12 }}>Sem dados para o período.</div>;

  const ys = pts.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = Math.max(1, maxY - minY);
  const spanX = Math.max(1, pts.length - 1);

  const scaleX = (i) => padding + (i / spanX) * (width - padding * 2);
  const scaleY = (y) => padding + (1 - (y - minY) / spanY) * (height - padding * 2);

  const scaled = pts.map((p, i) => ({ x: scaleX(i), y: scaleY(p.y) }));
  const linePath = smoothPath(scaled);

  // área preenchida (fecha o path pelo eixo x)
  const baseY = scaleY(minY);
  const areaPath = `${linePath} L ${scaled[scaled.length - 1].x.toFixed(2)},${baseY.toFixed(2)} L ${scaled[0].x.toFixed(2)},${baseY.toFixed(2)} Z`;

  const minIdx = ys.indexOf(minY);
  const maxIdx = ys.indexOf(maxY);

  // grid horizontal (4 linhas)
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
    const y = padding + (1 - f) * (height - padding * 2);
    return y;
  });

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico de saldo diário">
      <defs>
        <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2a4a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1a2a4a" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* grid */}
      {gridLines.map((y, i) => (
        <line key={i} x1={padding} y1={y} x2={width - padding} y2={y}
          stroke="#e2e8f0" strokeWidth="1" />
      ))}

      {/* eixos */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />

      {/* área */}
      <path d={areaPath} fill="url(#gradSaldo)" />

      {/* linha suave */}
      <path d={linePath} fill="none" stroke="#1a2a4a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* ponto menor */}
      <circle cx={scaleX(minIdx)} cy={scaleY(minY)} r="5" fill="#fff" stroke="#b8a06a" strokeWidth="2" />
      <text x={scaleX(minIdx) + 8} y={scaleY(minY) + 4} fontSize="10" fill="#b8a06a" fontWeight="600">mín</text>

      {/* ponto maior */}
      <circle cx={scaleX(maxIdx)} cy={scaleY(maxY)} r="5" fill="#fff" stroke="#1a2a4a" strokeWidth="2" />
      <text x={scaleX(maxIdx) + 8} y={scaleY(maxY) + 4} fontSize="10" fill="#1a2a4a" fontWeight="600">máx</text>
    </svg>
  );
}

export default function RelatorioFluxoCaixaGrafico() {
  const { addToast } = useToast();

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [dtIni, setDtIni] = useState(toDateInputValue(firstDay));
  const [dtFim, setDtFim] = useState(toDateInputValue(lastDay));

  const [contas, setContas] = useState([]);
  const [contasSelecionadas, setContasSelecionadas] = useState(["ALL"]);

  // Gráfico do MVP: só efetivo (como “foto real”). Projetado entra no bloco 2.
  const incluirPrevistos = false;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiFetch(`/livro-caixa/contas`);
        const list = resp?.items || resp?.rows || resp?.data || resp || [];
        if (Array.isArray(list)) {
          setContas(list.map((c) => ({ id: String(c.id), nome: c.nome || c.apelido || `Conta ${c.id}` })));
        }
      } catch {
        setContas([]);
      }
    })();
  }, []);

  function toggleConta(id) {
    const sid = String(id);
    if (sid === "ALL") return setContasSelecionadas(["ALL"]);
    setContasSelecionadas((prev) => {
      const base = prev.includes("ALL") ? [] : [...prev];
      const has = base.includes(sid);
      const next = has ? base.filter((x) => x !== sid) : [...base, sid];
      return next.length ? next : ["ALL"];
    });
  }

  const labelContas = useMemo(() => {
    if (contasSelecionadas.includes("ALL")) return "Todas";
    const map = new Map(contas.map((c) => [String(c.id), c]));
    const nomes = contasSelecionadas.map((id) => map.get(String(id))?.nome).filter(Boolean);
    return nomes.length ? nomes.join(", ") : "—";
  }, [contasSelecionadas, contas]);

  async function gerar() {
    setLoading(true);
    setData(null);
    try {
      const qs = new URLSearchParams({
        dtIni,
        dtFim,
        incluirPrevistos: incluirPrevistos ? "1" : "0",
        _ts: String(Date.now()),
      });

      const isAll = contasSelecionadas.includes("ALL");
      if (!isAll) contasSelecionadas.forEach((id) => qs.append("contaId", String(id)));
      else qs.set("contaId", "ALL");

      const resp = await apiFetch(`/relatorios/fluxo-caixa/grafico?${qs.toString()}`);
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

  const series = useMemo(() => safeArray(data?.serie || data?.series || []), [data]);

  const points = useMemo(() => {
    return series.map((d) => ({
      x: d?.dia || d?.date || d?.label || "",
      y: Number(d?.saldoCentavos ?? d?.saldo ?? 0),
    }));
  }, [series]);

  const minInfo = useMemo(() => data?.min || null, [data]);
  const maxInfo = useMemo(() => data?.max || null, [data]);

  return (
    <>
      <style>{`
        .print-only { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area { display:block !important; position:absolute; left:0; top:0; width:100%; padding:16px; }
          .no-print { display:none !important; }

          .print-footer {
            position: fixed; bottom: 0; left: 0; right: 0;
            padding: 12px 16px; background: #fff;
          }

          .page { page-break-after: always; padding-bottom: 90px; }
          img { display:block !important; }
        }
      `}</style>

      <div className="p-6">
        <div className="no-print flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Relatório — Desempenho do Caixa (Gráfico)</h1>
            <div className="text-sm text-slate-600 mt-1">
              Período: <b>{brDate(dtIni)}</b> a <b>{brDate(dtFim)}</b> • Conta(s): <b>{labelContas}</b> • <b>Somente efetivo</b>
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

        {/* Filtros */}
        <div className="no-print mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
            <div className="md:col-span-2">
              <div className="text-xs font-semibold text-slate-600 mb-1">Conta(s)</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => toggleConta("ALL")}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    contasSelecionadas.includes("ALL")
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-900"
                  }`}>
                  Todas
                </button>
                {contas.map((c) => {
                  const active = !contasSelecionadas.includes("ALL") && contasSelecionadas.includes(String(c.id));
                  return (
                    <button key={c.id} type="button" onClick={() => toggleConta(c.id)}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"
                      }`}>
                      {c.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Preview (tela) */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          {!data ? (
            <div className="text-sm text-slate-600">Gere o relatório para visualizar.</div>
          ) : (
            <>
              <div className="text-sm font-bold text-slate-900 mb-3">Saldo diário (efetivo)</div>
              <LineChartSVG points={points} />

              <div className="mt-3 text-sm text-slate-700 flex flex-wrap gap-4">
                <div><b>Menor saldo:</b> {minInfo?.dia ? `${minInfo.dia} — R$ ${brlFromCentavos(minInfo.saldoCentavos)}` : "—"}</div>
                <div><b>Maior saldo:</b> {maxInfo?.dia ? `${maxInfo.dia} — R$ ${brlFromCentavos(maxInfo.saldoCentavos)}` : "—"}</div>
              </div>
            </>
          )}
        </div>

        {/* ===================== PRINT AREA ===================== */}
        <div id="print-area" className="print-only">
          <div className="page">
            {/* CABEÇALHO */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ textAlign: "center", marginBottom: 8 }}>
                <img
                  src={logoAMR}
                  alt="Amanda Maia Ramalho Advogados"
                  style={{
                    maxHeight: 17,
                    maxWidth: 220,
                    objectFit: "contain",
                    display: "block",
                    margin: "0 auto",
                  }}
                />
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Amanda Maia Ramalho Advogados</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Desempenho do Caixa — Gráfico</div>
              </div>

              <div style={{ borderTop: "2px solid #000", margin: "12px 0" }} />

              <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                <div><b>Período:</b> {brDate(dtIni)} a {brDate(dtFim)}</div>
                <div><b>Conta(s):</b> {labelContas}</div>
                <div><b>Critério:</b> Somente efetivo</div>
              </div>
            </div>

            {/* GRÁFICO (1 página) */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 12 }}>GRÁFICO DO SALDO DIÁRIO</div>
              <LineChartSVG points={points} />

              <div style={{ marginTop: 10, fontSize: 12, color: "#111", display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div><b>Menor saldo:</b> {minInfo?.dia ? `${minInfo.dia} — R$ ${brlFromCentavos(minInfo.saldoCentavos)}` : "—"}</div>
                <div><b>Maior saldo:</b> {maxInfo?.dia ? `${maxInfo.dia} — R$ ${brlFromCentavos(maxInfo.saldoCentavos)}` : "—"}</div>
              </div>
            </div>

            {/* RODAPÉ FIXO */}
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
