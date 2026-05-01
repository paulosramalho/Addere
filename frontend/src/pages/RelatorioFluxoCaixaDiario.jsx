import React, { useEffect, useMemo, useState } from "react";
import logoAddere from "../assets/logo.png";
import { apiFetch, getUser } from "../lib/api";
import { useToast } from "../components/Toast";
import { brlFromCentavos } from '../lib/formatters';

// ===================== Helpers =====================
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

function pickEs(it) {
  const es = String(it?.es || it?.tipo || it?.entradaSaida || "").toUpperCase();
  if (es === "E" || es === "ENTRADA" || es === "IN") return "E";
  if (es === "S" || es === "SAIDA" || es === "OUT") return "S";
  return "—";
}

function pickValorCent(it) {
  return Number(it?.valorCentavos ?? it?.valorCent ?? it?.valor ?? 0);
}

function pickDescricao(it) {
  return it?.historico || it?.descricao || it?.memo || it?.nome || "—";
}

function pickConta(it) {
  return it?.contaNome || it?.conta?.nome || it?.conta || "—";
}

function pickStatus(it) {
  const s = String(it?.statusFluxo || it?.status || "").toUpperCase();
  if (s.includes("PREV")) return "PREVISTO";
  if (s.includes("EFET")) return "EFETIVO";
  return s || "—";
}

function groupByDia(rows) {
  const map = new Map();
  for (const r of rows) {
    const d = new Date(r?.data || r?.dataHora || r?.dt || r?.createdAt);
    const key = Number.isNaN(d.getTime())
      ? "—"
      : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  // ordena por dia
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

// ===================== Page =====================
export default function RelatorioFluxoCaixaDiario() {
  const { addToast } = useToast();

  const user = useMemo(() => getUser(), []);
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [dtIni, setDtIni] = useState(toDateInputValue(firstDay));
  const [dtFim, setDtFim] = useState(toDateInputValue(lastDay));

  const [contas, setContas] = useState([]);
  const [contasSelecionadas, setContasSelecionadas] = useState(["ALL"]);
  const [incluirPrevistos, setIncluirPrevistos] = useState(true); // diário normalmente usa ambos

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiFetch(`/livro-caixa/contas`);
        const list = resp?.items || resp?.rows || resp?.data || resp || [];
        if (Array.isArray(list)) {
          setContas(list.map((c) => ({
            id: String(c.id),
            nome: c.nome || c.apelido || c.descricao || `Conta ${c.id}`,
          })));
        }
      } catch (e) {
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

      const resp = await apiFetch(`/relatorios/fluxo-caixa/diario?${qs.toString()}`);
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

  const rows = useMemo(() => {
    const r = data?.lancamentos || data?.rows || data?.items || [];
    return Array.isArray(r) ? r : [];
  }, [data]);

  const saldoInicialCent = useMemo(() => Number(data?.saldoInicialCentavos ?? 0), [data]);

  const dias = useMemo(() => groupByDia(rows), [rows]);

  // Calcula saldo dia a dia (considerando ordem cronológica por data)
  const diasComTotais = useMemo(() => {
    let running = saldoInicialCent;
    return dias.map(([ymd, list]) => {
      const ordenado = [...list].sort((a, b) => {
        const da = new Date(a?.data || a?.dataHora || a?.dt || 0).getTime();
        const db = new Date(b?.data || b?.dataHora || b?.dt || 0).getTime();
        return (da || 0) - (db || 0);
      });

      let ent = 0;
      let sai = 0;
      for (const it of ordenado) {
        const v = pickValorCent(it);
        const es = pickEs(it);
        if (es === "E") ent += v;
        if (es === "S") sai += v;
      }

      running = running + ent - sai;

      return {
        ymd,
        br: ymd === "—" ? "—" : `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`,
        items: ordenado,
        entradasCent: ent,
        saidasCent: sai,
        saldoAoFinalDoDiaCent: running,
      };
    });
  }, [dias, saldoInicialCent]);

  const totais = useMemo(() => {
    const ent = diasComTotais.reduce((acc, d) => acc + d.entradasCent, 0);
    const sai = diasComTotais.reduce((acc, d) => acc + d.saidasCent, 0);
    const saldoFinal = saldoInicialCent + ent - sai;
    return { ent, sai, saldoFinal };
  }, [diasComTotais, saldoInicialCent]);

  return (
    <>
      <style>{`
        .print-only { display: none; }

        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }

          #print-area {
            display: block !important;
            position: absolute;
            left: 0; top: 0;
            width: 100%;
            padding: 16px;
          }
          .no-print { display: none !important; }

          .print-footer {
            position: fixed;
            bottom: 0; left: 0; right: 0;
            padding: 12px 16px;
            background: #fff;
          }

          .page {
            page-break-after: always;
            padding-bottom: 100px;
          }

          img { display: block !important; }
        }
      `}</style>

      <div className="p-6">
        <div className="no-print flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Relatório — Fluxo de Caixa Diário</h1>
            <div className="text-sm text-slate-600 mt-1">
              Período: <b>{brDate(dtIni)}</b> a <b>{brDate(dtFim)}</b> • Conta(s): <b>{labelContas}</b> •{" "}
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

          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={incluirPrevistos} onChange={(e) => setIncluirPrevistos(e.target.checked)} />
              Incluir previstos
            </label>
          </div>
        </div>

        {/* Resumo de tela */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          {!data ? (
            <div className="text-sm text-slate-600">Gere o relatório para visualizar.</div>
          ) : (
            <>
              <div className="text-sm font-bold text-slate-900 mb-3">Totais do período</div>
              <table className="min-w-full text-sm">
                <tbody>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700">Saldo inicial</td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-900">R$ {brlFromCentavos(saldoInicialCent)}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700">Entradas</td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-900">R$ {brlFromCentavos(totais.ent)}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700">Saídas</td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-900">R$ {brlFromCentavos(totais.sai)}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700 font-bold">Saldo final</td>
                    <td className="py-2 pr-4 text-right font-bold text-slate-900">R$ {brlFromCentavos(totais.saldoFinal)}</td>
                  </tr>
                </tbody>
              </table>
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
                  alt="Addere"
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
                <div style={{ fontSize: 18, fontWeight: 800 }}>Addere</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Fluxo de Caixa Diário (Detalhado)</div>
              </div>

              <div style={{ borderTop: "2px solid #000", margin: "12px 0" }} />

              <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                <div><b>Período:</b> {brDate(dtIni)} a {brDate(dtFim)}</div>
                <div><b>Conta(s):</b> {labelContas}</div>
                <div><b>Critério:</b> {incluirPrevistos ? "Efetivo + Previsto" : "Somente efetivo"}</div>
              </div>
            </div>

            {/* RESUMO GERAL DO PERÍODO */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 12 }}>RESUMO DO PERÍODO</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saldo inicial</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      R$ {brlFromCentavos(saldoInicialCent)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Entradas</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      R$ {brlFromCentavos(totais.ent)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saídas</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      R$ {brlFromCentavos(totais.sai)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8, fontWeight: 800 }}>Saldo final</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      R$ {brlFromCentavos(totais.saldoFinal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* DETALHAMENTO DIA A DIA */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 12 }}>DETALHAMENTO (DIA A DIA)</div>

              {diasComTotais.map((d, i) => (
                <div key={d.ymd || i} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                    Dia: {d.br}
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "left" }}>Conta</th>
                        <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "left" }}>Descrição</th>
                        <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "center" }}>Status</th>
                        <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "center" }}>E/S</th>
                        <th style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((it, j) => {
                        const status = pickStatus(it);
                        const isPrev = status === "PREVISTO";
                        return (
                          <tr key={j} style={isPrev ? { color: "#666", fontStyle: "italic" } : undefined}>
                            <td style={{ border: "1px solid #DDD", padding: 6 }}>{pickConta(it)}</td>
                            <td style={{ border: "1px solid #DDD", padding: 6 }}>{pickDescricao(it)}</td>
                            <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "center" }}>{status}</td>
                            <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "center" }}>{pickEs(it)}</td>
                            <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right" }}>
                              R$ {brlFromCentavos(pickValorCent(it))}
                            </td>
                          </tr>
                        );
                      })}

                      {/* Subtotais do dia */}
                      <tr>
                        <td colSpan={3} style={{ border: "1px solid #DDD", padding: 6, fontWeight: 700 }}>
                          Subtotais do dia
                        </td>
                        <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "center", fontWeight: 700 }}>
                          —
                        </td>
                        <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right", fontWeight: 800 }}>
                          Entradas: R$ {brlFromCentavos(d.entradasCent)} • Saídas: R$ {brlFromCentavos(d.saidasCent)}
                        </td>
                      </tr>

                      <tr>
                        <td colSpan={4} style={{ border: "1px solid #DDD", padding: 6, fontWeight: 800 }}>
                          Saldo após o dia
                        </td>
                        <td style={{ border: "1px solid #DDD", padding: 6, textAlign: "right", fontWeight: 800 }}>
                          R$ {brlFromCentavos(d.saldoAoFinalDoDiaCent)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
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
