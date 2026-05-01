// frontend/src/pages/RelatorioFluxoCaixaConsolidado.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch, getUser } from "../lib/api";
import { useToast } from "../components/Toast";
import logoAddere from "../assets/logo.png";
import { brlFromCentavos } from '../lib/formatters';

// ===================== Helpers =====================
function pad2(n) {
  return String(n).padStart(2, "0");
}

function brDate(dt) {
  if (!dt) return "—";
  // Append T12:00:00 to avoid timezone shift issues
  const str = String(dt).includes("T") ? dt : `${dt}T12:00:00`;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function ymd(dt) {
  // input: Date -> YYYY-MM-DD
  const d = new Date(dt);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toDateInputValue(d) {
  // <input type="date" /> expects YYYY-MM-DD
  return ymd(d);
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function sumCent(items, key) {
  return safeArray(items).reduce((acc, it) => acc + Number(it?.[key] ?? 0), 0);
}

// ===================== Page =====================
export default function RelatorioFluxoCaixaConsolidado() {
  const { addToast } = useToast();

  const user = useMemo(() => getUser(), []);
  const isAdmin =
    String(user?.role || user?.perfil || user?.tipo || "")
      .toUpperCase()
      .trim() === "ADMIN";

  const now = new Date();

  // default: mês corrente
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [dtIni, setDtIni] = useState(toDateInputValue(firstDay));
  const [dtFim, setDtFim] = useState(toDateInputValue(lastDay));

  // contas
  const [contas, setContas] = useState([]);
  const [contasSelecionadas, setContasSelecionadas] = useState(["ALL"]); // "ALL" ou ids
  const [incluirPrevistos, setIncluirPrevistos] = useState(false);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  // carregar contas (se houver endpoint)
  useEffect(() => {
    (async () => {
      try {
        // ajuste se seu backend tiver outro path:
        // - /livro-caixa/contas
        // - /contas
        // - /bancos/contas
        const resp = await apiFetch(`/livro-caixa/contas`);
        const list = resp?.items || resp?.rows || resp?.data || resp || [];
        if (Array.isArray(list)) {
          setContas(
            list.map((c) => ({
              id: String(c.id),
              nome: c.nome || c.apelido || c.descricao || `Conta ${c.id}`,
              banco: c.bancoNome || c.banco || "",
            }))
          );
        } else {
          setContas([]);
        }
      } catch (e) {
        // sem contas no sistema? não trava o relatório
        console.warn("[RelatorioFluxoCaixaConsolidado] contas não carregadas:", e?.message);
        setContas([]);
      }
    })();
  }, []);

  const labelContas = useMemo(() => {
    if (contasSelecionadas.includes("ALL")) return "Todas";
    const map = new Map(contas.map((c) => [String(c.id), c]));
    const nomes = contasSelecionadas
      .map((id) => map.get(String(id))?.nome)
      .filter(Boolean);
    return nomes.length ? nomes.join(", ") : "—";
  }, [contasSelecionadas, contas]);

  function toggleConta(id) {
    const sid = String(id);

    // se clicar em "ALL"
    if (sid === "ALL") {
      setContasSelecionadas(["ALL"]);
      return;
    }

    // remove ALL e alterna seleção
    setContasSelecionadas((prev) => {
      const base = prev.includes("ALL") ? [] : [...prev];
      const has = base.includes(sid);
      const next = has ? base.filter((x) => x !== sid) : [...base, sid];
      return next.length ? next : ["ALL"];
    });
  }

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

      if (!contasSelecionadas.includes("ALL")) {
        // envia múltiplas contas
        contasSelecionadas.forEach((id) => qs.append("contaId", String(id)));
      } else {
        qs.set("contaId", "ALL");
      }

      // ✅ endpoint sugerido (ajuste se o seu backend usar outro)
      // Retorno esperado (em centavos):
      // {
      //   periodo: { dtIni, dtFim },
      //   contas: [{id,nome,...}] ou "ALL",
      //   incluirPrevistos: boolean,
      //   saldoInicialCentavos,
      //   entradasCentavos,
      //   saidasCentavos,
      //   saldoFinalCentavos,
      //   observacao,
      // }
      const resp = await apiFetch(`/relatorios/fluxo-caixa/consolidado?${qs.toString()}`);

      setData(resp);

      // feedback mínimo
      addToast("Relatório gerado com sucesso.", "success");
    } catch (e) {
      console.error("[RelatorioFluxoCaixaConsolidado] erro:", e);
      addToast(e?.message || "Falha ao gerar relatório.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function gerarEImprimir() {
    await gerar();
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  // Normalização (caso backend devolva com outros nomes)
  const resumo = useMemo(() => {
    const sIni =
      Number(data?.saldoInicialCentavos ?? data?.saldoInicial ?? data?.totais?.saldoInicialCentavos ?? 0) || 0;

    const ent =
      Number(data?.entradasCentavos ?? data?.entradas ?? data?.totais?.entradasCentavos ?? 0) || 0;

    const sai =
      Number(data?.saidasCentavos ?? data?.saidas ?? data?.totais?.saidasCentavos ?? 0) || 0;

    const sFim =
      Number(
        data?.saldoFinalCentavos ??
          data?.saldoFinal ??
          data?.totais?.saldoFinalCentavos ??
          (sIni + ent - sai)
      ) || 0;

    return {
      saldoInicialCentavos: sIni,
      entradasCentavos: ent,
      saidasCentavos: sai,
      saldoFinalCentavos: sFim,
    };
  }, [data]);

  const obsPrevistos = incluirPrevistos
    ? "Inclui previstos (efetivo + previsto)."
    : "Não inclui previstos (somente efetivo).";

  return (
    <>
      <style>{`
        .print-only { display: none; }

        @media print {
          body * { visibility: hidden !important; }

          #print-area,
          #print-area * { visibility: visible !important; }

          #print-area {
            display: block !important;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 16px;
          }

          .no-print { display: none !important; }

          /* Rodapé fixo real */
          .print-footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 12px 16px;
            background: #fff;
          }

          /* espaço para rodapé não sobrepor */
          .page {
            page-break-after: always;
            padding-bottom: 90px;
          }

          img { display: block !important; }
        }
      `}</style>

      <div className="p-6">
        {/* Header + ações */}
        <div className="no-print flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Relatório — Fluxo de Caixa Consolidado</h1>
            <div className="text-sm text-slate-600 mt-1">
              Período: <b>{brDate(dtIni)}</b> a <b>{brDate(dtFim)}</b> • Conta(s): <b>{labelContas}</b>
              {" "}• {incluirPrevistos ? <b>Efetivo + Previsto</b> : <b>Somente efetivo</b>}
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
              <input
                type="date"
                value={dtIni}
                onChange={(e) => setDtIni(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Data final</div>
              <input
                type="date"
                value={dtFim}
                onChange={(e) => setDtFim(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-xs font-semibold text-slate-600 mb-1">Conta(s)</div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toggleConta("ALL")}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    contasSelecionadas.includes("ALL")
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-900"
                  }`}
                >
                  Todas
                </button>

                {contas.map((c) => {
                  const active = !contasSelecionadas.includes("ALL") && contasSelecionadas.includes(String(c.id));
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleConta(c.id)}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"
                      }`}
                      title={c.banco ? `${c.banco}` : ""}
                    >
                      {c.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={incluirPrevistos}
                onChange={(e) => setIncluirPrevistos(e.target.checked)}
              />
              Incluir previstos
            </label>

            <div className="text-xs text-slate-500">{obsPrevistos}</div>
          </div>
        </div>

        {/* Resultado (tela) */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Foto do caixa no período</h2>

          {!data ? (
            <div className="text-sm text-slate-600">Gere o relatório para visualizar os valores.</div>
          ) : (
            <>
              <table className="min-w-full text-sm">
                <tbody>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700">Saldo inicial</td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-900">
                      R$ {brlFromCentavos(resumo.saldoInicialCentavos)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700">Entradas</td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-900">
                      R$ {brlFromCentavos(resumo.entradasCentavos)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700">Saídas</td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-900">
                      R$ {brlFromCentavos(resumo.saidasCentavos)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-700 font-bold">Saldo final</td>
                    <td className="py-2 pr-4 text-right font-bold text-slate-900">
                      R$ {brlFromCentavos(resumo.saldoFinalCentavos)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-3 text-xs text-slate-500">
                Observação: {data?.observacao || obsPrevistos}
              </div>
            </>
          )}
        </div>

        {/* ===================== PRINT AREA ===================== */}
        <div id="print-area" className="print-only">
          <div className="page">
            {/* CABEÇALHO PDF */}
            <div style={{ marginBottom: 10 }}>
              {/* LOGO */}
              <div style={{ textAlign: "center", marginBottom: 8 }}>
                <img
                  src={logoAMR}
                  alt="Addere"
                  style={{
                    maxHeight: 17, // ajuste aqui
                    maxWidth: 220, // ajuste aqui
                    objectFit: "contain",
                    display: "block",
                    margin: "0 auto",
                  }}
                />
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Addere</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Fluxo de Caixa Consolidado</div>
              </div>

              {/* Linha horizontal (visível no print) */}
              <div style={{ borderTop: "2px solid #000", margin: "12px 0" }} />

              <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                <div><b>Período:</b> {brDate(dtIni)} a {brDate(dtFim)}</div>
                <div><b>Conta(s):</b> {labelContas}</div>
                <div><b>Critério:</b> {incluirPrevistos ? "Efetivo + Previsto" : "Somente efetivo"}</div>
              </div>
            </div>

            {/* RESUMO PDF */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 12 }}>RESUMO DO PERÍODO</div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saldo inicial</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      R$ {brlFromCentavos(resumo.saldoInicialCentavos)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Entradas</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      R$ {brlFromCentavos(resumo.entradasCentavos)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8 }}>Saídas</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 700 }}>
                      R$ {brlFromCentavos(resumo.saidasCentavos)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #DDD", padding: 8, fontWeight: 800 }}>Saldo final</td>
                    <td style={{ border: "1px solid #DDD", padding: 8, textAlign: "right", fontWeight: 800 }}>
                      R$ {brlFromCentavos(resumo.saldoFinalCentavos)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 8, fontSize: 11, color: "#444" }}>
                <b>Observação:</b> {data?.observacao || obsPrevistos}
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
