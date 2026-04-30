// src/pages/UtilitariosRepassesManuais.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";

function moneyMask(v) {
  const digits = String(v || "").replace(/\D/g, "");
  const n = Number(digits || 0);
  return (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function moneyToCentavos(v) {
  const digits = String(v || "").replace(/\D/g, "");
  return Number(digits || 0);
}

function brFromISO(iso) {
  const [a, m, d] = String(iso || "").split("-");
  if (!a || !m || !d) return "";
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${a}`;
}

function fmtDateSafe(d) {
  if (!d) return "—";
  const s = String(d);
  const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dt = mISO
    ? new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]), 12, 0, 0)
    : new Date(d);
  if (!Number.isFinite(dt.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

function fmtBRL(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Derive competencia (month/year) from a payment date ISO string
function competenciaFromDate(isoDate) {
  if (!isoDate) return null;
  const [y, m] = String(isoDate).split("-").map(Number);
  if (!y || !m) return null;
  return { ano: y, mes: m };
}

// Default repasse date = payment month + 1, day 5
function defaultRepasseDateISO(pagDataISO) {
  if (!pagDataISO) {
    const d = new Date();
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 5);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
  const [y, m] = String(pagDataISO).split("-").map(Number);
  const next = new Date(y, m, 5); // month is 0-indexed, so m (1-indexed) = next month
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

export default function UtilitariosRepassesManuais({ user }) {
  const { addToast, confirmToast } = useToast();

  const [base, setBase] = useState({ clientes: [], advogados: [], contas: [] });
  const [loading, setLoading] = useState(true);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [depsError, setDepsError] = useState("");

  // Step 1: payment received (creates AV contract)
  const [pagClienteId, setPagClienteId] = useState("");
  const [pagContaId, setPagContaId] = useState("");
  const [pagDataISO, setPagDataISO] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [pagValorRaw, setPagValorRaw] = useState("");
  const [savingPag, setSavingPag] = useState(false);

  // Step 1b: select existing contract
  const [pagamentos, setPagamentos] = useState([]);
  const [pagamentoSelKey, setPagamentoSelKey] = useState("");
  const [repassesDoContrato, setRepassesDoContrato] = useState([]);
  const [loadingPagamentos, setLoadingPagamentos] = useState(false);

  // Selected contract (from step 1)
  const [selContrato, setSelContrato] = useState(null);

  // Competencia derived from selected contract/payment date
  const comp = useMemo(() => {
    if (selContrato?.dataRecebimentoISO) return competenciaFromDate(selContrato.dataRecebimentoISO);
    if (pagDataISO) return competenciaFromDate(pagDataISO);
    const d = new Date();
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  }, [selContrato?.dataRecebimentoISO, pagDataISO]);

  const ano = comp?.ano || new Date().getFullYear();
  const mes = comp?.mes || (new Date().getMonth() + 1);

  // Step 2: manual entries
  const [lmItems, setLmItems] = useState([
    { id: String(Date.now()), advogadoId: "", tipo: "ADVOGADO", valorRaw: "" },
  ]);
  const [savingLm, setSavingLm] = useState(false);

  const [lancamentos, setLancamentos] = useState([]);
  const [repasses, setRepasses] = useState([]);

  // Step 3: finalization
  const [efContaId, setEfContaId] = useState("");
  const [efMap, setEfMap] = useState({}); // { advogadoId: { valorRaw, dataISO } }
  const [savingEf, setSavingEf] = useState({});

  async function loadBase() {
    const b = await apiFetch("/util/repasses-manuais/base");
    setBase(b || { clientes: [], advogados: [], contas: [] });
  }

  async function loadLancamentos() {
    const data = await apiFetch(`/util/repasses-manuais/lancamentos?ano=${ano}&mes=${mes}`);
    setLancamentos(Array.isArray(data) ? data : []);
  }

  async function loadPagamentosExistentes() {
    setLoadingPagamentos(true);
    try {
      const data = await apiFetch(`/util/repasses-manuais/pagamentos?ano=${ano}&mes=${mes}`);
      const rows = Array.isArray(data) ? data : (data?.rows || data?.itens || []);
      setPagamentos(rows);
    } catch (e) {
      console.error("[UtilitariosRepassesManuais] loadPagamentosExistentes error:", e);
      setPagamentos([]);
    } finally {
      setLoadingPagamentos(false);
    }
  }

  async function loadRepassesDoContrato(contratoId) {
    try {
      if (!contratoId) { setRepassesDoContrato([]); return; }
      const data = await apiFetch(`/util/repasses-manuais/repasses-por-contrato?contratoId=${contratoId}`);
      setRepassesDoContrato(Array.isArray(data) ? data : (data?.rows || []));
    } catch (e) {
      console.error("[UtilitariosRepassesManuais] loadRepassesDoContrato error:", e);
      setRepassesDoContrato([]);
    }
  }

  async function loadRepassesARealizar() {
    const data = await apiFetch(`/util/repasses-manuais/repasses-a-realizar?ano=${ano}&mes=${mes}`);
    setRepasses(data?.rows || []);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadBase(), loadLancamentos(), loadRepassesARealizar(), loadPagamentosExistentes()]);
      } catch (e) {
        addToast(e?.message || "Falha ao carregar dados do utilitário.", "error");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, [ano, mes]);

  const clientesById = useMemo(() => {
    const m = new Map();
    for (const c of base.clientes || []) m.set(c.id, c);
    return m;
  }, [base.clientes]);

  const advogadosById = useMemo(() => {
    const m = new Map();
    for (const a of base.advogados || []) m.set(a.id, a);
    return m;
  }, [base.advogados]);

  useEffect(() => {
    (async () => {
      setLoadingDeps(true);
      setDepsError("");
      try {
        await loadBase();
      } catch (e) {
        const msg = e?.message || "Erro ao carregar listas.";
        setDepsError(msg);
        addToast(msg, "error");
      } finally {
        setLoadingDeps(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  // Auto-select first pagamento when list loads
  useEffect(() => {
    if (pagamentos.length > 0 && !pagamentoSelKey && !selContrato) {
      const first = pagamentos[0];
      const key = `${first.contratoId}:${first.parcelaId}`;
      setPagamentoSelKey(key);
      setSelContrato({
        contratoId: Number(first.contratoId),
        parcelaId: Number(first.parcelaId),
        clienteId: Number(first.clienteId),
        numeroContrato: first.numeroContrato ? String(first.numeroContrato) : null,
        valorRecebidoCentavos: Number(first.valorRecebidoCentavos || 0),
        dataRecebimentoISO: first.dataRecebimento ? String(first.dataRecebimento).slice(0, 10) : "",
      });
      loadRepassesDoContrato(Number(first.contratoId));
    }
    // eslint-disable-next-line
  }, [pagamentos]);

  async function criarPagamentoAvulso(e) {
    e.preventDefault();
    if (savingPag) return;

    const clienteId = Number(pagClienteId);
    const contaId = Number(pagContaId);
    const valorCentavos = moneyToCentavos(pagValorRaw);
    const valorRecebido = Number((valorCentavos / 100).toFixed(2));
    const dataBR = brFromISO(pagDataISO);

    if (!clienteId || !contaId || !dataBR || !valorCentavos) {
      addToast("Preencha cliente, conta de recebimento, data e valor.", "error");
      return;
    }

    setSavingPag(true);
    addToast("Gerando Contrato AV…", "info");

    try {
      const resp = await apiFetch("/pagamentos-avulsos", {
        method: "POST",
        body: {
          clienteId,
          contaId,
          dataRecebimento: dataBR,
          valorRecebido,
          valorRecebidoCentavos: valorCentavos,
          meioRecebimento: "MANUAL",
          observacoes: `AV (utilitário) - ${String(mes).padStart(2, "0")}/${ano}`,
        },
      });

      let contratoId = null;
      if (resp?.contrato?.id != null) contratoId = resp.contrato.id;
      else if (resp?.contratoId != null) contratoId = resp.contratoId;

      let parcelaId = null;
      if (resp?.parcela?.id != null) parcelaId = resp.parcela.id;
      else if (resp?.parcelaId != null) parcelaId = resp.parcelaId;

      let numeroContrato = null;
      if (resp?.contrato?.numeroContrato) numeroContrato = resp.contrato.numeroContrato;
      else if (resp?.numeroContrato) numeroContrato = resp.numeroContrato;

      if (!contratoId || !parcelaId) {
        addToast("Contrato AV foi gerado, mas o backend não retornou IDs. Não dá pra vincular.", "error");
        return;
      }

      setSelContrato({
        contratoId,
        parcelaId,
        clienteId: Number(clienteId),
        numeroContrato,
        valorRecebidoCentavos: valorCentavos,
        dataRecebimentoISO: pagDataISO || "",
      });

      addToast("Contrato AV criado e selecionado para vínculo.", "success");

      setPagClienteId("");
      setPagContaId("");
      setPagValorRaw("");

      await loadLancamentos();
      await loadRepassesARealizar();
      await loadPagamentosExistentes();
    } catch (err) {
      addToast(err?.message || "Falha ao gerar Contrato AV.", "error");
    } finally {
      setSavingPag(false);
    }
  }

  async function criarLancamentoManual(e) {
    e.preventDefault();
    if (savingLm) return;

    if (!selContrato?.contratoId || !selContrato?.parcelaId) {
      addToast("Defina o vínculo: gere/selecione um Contrato AV no passo 1.", "error");
      return;
    }

    const validItems = (lmItems || []).filter(
      (it) => it.advogadoId && moneyToCentavos(it.valorRaw)
    );

    if (!validItems.length) {
      addToast("Informe pelo menos um advogado com valor.", "error");
      return;
    }

    setSavingLm(true);

    try {
      for (const it of validItems) {
        await apiFetch("/util/repasses-manuais/lancamentos", {
          method: "POST",
          body: {
            contratoId: selContrato.contratoId,
            parcelaId: selContrato.parcelaId,
            clienteId: selContrato.clienteId,
            advogadoId: Number(it.advogadoId),
            tipo: it.tipo,
            competenciaAno: Number(ano),
            competenciaMes: Number(mes),
            valorPrevistoCentavos: moneyToCentavos(it.valorRaw),
          },
        });
      }

      addToast("Lançamentos criados com sucesso.", "success");
      setLmItems([{ id: String(Date.now()), advogadoId: "", tipo: "ADVOGADO", valorRaw: "" }]);
      await loadLancamentos();
      await loadRepassesARealizar();
    } catch (err) {
      addToast("Erro ao criar lançamentos.", "error");
    } finally {
      setSavingLm(false);
    }
  }

  async function efetivarRepasse(advogadoId) {
    if (savingEf[advogadoId]) return;

    const efData = efMap[advogadoId] || {};
    const valorEfetivadoCentavos = moneyToCentavos(efData.valorRaw || "");
    const dataRepasseISO = efData.dataISO || "";

    if (!valorEfetivadoCentavos) {
      addToast("Informe o valor efetivamente repassado.", "error");
      return;
    }
    if (!dataRepasseISO) {
      addToast("Informe a data do repasse.", "error");
      return;
    }

    // Validate: repasse month should be payment month + 1
    const repasseComp = competenciaFromDate(dataRepasseISO);
    if (repasseComp && repasseComp.ano === ano && repasseComp.mes === mes) {
      const ok1 = await confirmToast(
        `A data do repasse (${brFromISO(dataRepasseISO)}) está no mesmo mês do pagamento (${String(mes).padStart(2, "0")}/${ano}).\n\nNormalmente o repasse ocorre no mês seguinte.\n\nDeseja continuar mesmo assim?`
      );
      if (!ok1) return;
      const ok2 = await confirmToast(
        "Tem certeza? O repasse ficará registrado no mesmo mês do pagamento. Confirmar?"
      );
      if (!ok2) return;
    }

    setSavingEf((p) => ({ ...p, [advogadoId]: true }));
    addToast("Efetivando repasse…", "info");

    // Look up advogado to determine ehSocio for description
    const adv = advogadosById.get(Number(advogadoId));
    const isSocio = adv?.ehSocio === true;
    const descricaoRepasse = isSocio ? "Antecipação de lucro" : "Prestação de serviços";

    try {
      const resp = await apiFetch("/util/repasses-manuais/efetivar", {
        method: "POST",
        body: {
          advogadoId,
          ano: Number(ano),
          mes: Number(mes),
          dataRepasse: `${dataRepasseISO}T12:00:00Z`,
          valorEfetivadoCentavos,
          contaId: efContaId ? Number(efContaId) : null,
          descricaoRepasse,
        },
      });

      const previsto = (resp?.previstoTotal || 0) / 100;
      const sa = (resp?.saldoAnterior || 0) / 100;
      const sp = (resp?.saldoPosterior || 0) / 100;

      addToast(
        `Efetivado. Previsto: ${previsto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} • Saldo ant.: ${sa.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} • Saldo pós: ${sp.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        "success"
      );

      setEfMap((p) => ({ ...p, [advogadoId]: { valorRaw: "", dataISO: "" } }));
      await loadLancamentos();
      await loadRepassesARealizar();
    } catch (err) {
      addToast(err?.message || "Falha ao efetivar repasse.", "error");
    } finally {
      setSavingEf((p) => ({ ...p, [advogadoId]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-2xl shadow-lg p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Utilitários - Repasses Manuais</h1>
            <p className="text-sm text-gray-600">Para registrar ajustes antigos sem depender das regras/cálculos automáticos.</p>
          </div>
          {comp && (
            <div className="text-sm text-slate-600 font-semibold bg-slate-100 rounded-xl px-4 py-2">
              Competência: {String(mes).padStart(2, "0")}/{ano}
            </div>
          )}
        </div>

        {loadingDeps ? (
          <div className="bg-white rounded-2xl shadow p-4 text-sm text-slate-700">Carregando listas…</div>
        ) : depsError ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">{depsError}</div>
        ) : null}

        {loading ? (
          <div className="text-center text-gray-600 py-10">Carregando...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Step 1: Payment received */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="px-5 py-4 bg-blue-700 text-white">
                <div className="font-bold">1) Pagamento recebido (gera Contrato AV)</div>
                <div className="text-xs text-blue-200">Você informa valor/cliente/data. O sistema cria Contrato AV + Parcela.</div>
              </div>

              <form onSubmit={criarPagamentoAvulso} className="p-5 space-y-3">
                {pagamentos.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 font-semibold mb-1">Selecionar contrato existente</div>
                    <select
                      className="w-full border rounded-xl px-3 py-2"
                      value={pagamentoSelKey}
                      onChange={async (e) => {
                        const key = e.target.value;
                        setPagamentoSelKey(key);
                        if (!key) { setSelContrato(null); setRepassesDoContrato([]); return; }

                        const [cIdStr, pIdStr] = String(key).split(":");
                        const found = (pagamentos || []).find(
                          (x) => Number(x.contratoId) === Number(cIdStr) && Number(x.parcelaId) === Number(pIdStr)
                        );
                        if (!found) { setSelContrato(null); setRepassesDoContrato([]); return; }

                        setSelContrato({
                          contratoId: Number(found.contratoId),
                          parcelaId: Number(found.parcelaId),
                          clienteId: Number(found.clienteId),
                          numeroContrato: found.numeroContrato ? String(found.numeroContrato) : null,
                          valorRecebidoCentavos: Number(found.valorRecebidoCentavos || 0),
                          dataRecebimentoISO: found.dataRecebimento ? String(found.dataRecebimento).slice(0, 10) : "",
                        });
                        await loadRepassesDoContrato(Number(found.contratoId));
                      }}
                    >
                      {pagamentos.map((x) => {
                        const key = `${x.contratoId}:${x.parcelaId}`;
                        const clienteNome = x.clienteNome || clientesById.get(Number(x.clienteId))?.nomeRazaoSocial || `Cliente ${x.clienteId}`;
                        return (
                          <option key={key} value={key}>
                            Nº {x.numeroContrato || x.contratoId} - {clienteNome} - {fmtDateSafe(x.dataRecebimento)} - {fmtBRL(x.valorRecebidoCentavos)}
                          </option>
                        );
                      })}
                    </select>
                    {loadingPagamentos && <div className="text-[11px] text-gray-500 mt-1">Carregando pagamentos…</div>}
                  </div>
                )}

                <div className="border-t pt-3">
                  <div className="text-xs text-gray-500 font-semibold mb-2">Ou criar novo contrato AV</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 font-semibold mb-1">Cliente</div>
                  <select className="w-full border rounded-xl px-3 py-2" value={pagClienteId} onChange={(e) => setPagClienteId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {(base.clientes || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.nomeRazaoSocial}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-xs text-gray-500 font-semibold mb-1">Conta de recebimento</div>
                  <select className="w-full border rounded-xl px-3 py-2" value={pagContaId} onChange={(e) => setPagContaId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {(base.contas || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 font-semibold mb-1">Data do pagamento</div>
                    <input className="w-full border rounded-xl px-3 py-2" type="date" value={pagDataISO} onChange={(e) => setPagDataISO(e.target.value)} />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-semibold mb-1">Valor recebido</div>
                    <input
                      className="w-full border rounded-xl px-3 py-2"
                      value={moneyMask(pagValorRaw)}
                      onChange={(e) => setPagValorRaw(String(e.target.value || "").replace(/\D/g, ""))}
                      placeholder="R$ 0,00"
                    />
                  </div>
                </div>

                <Tooltip content="Cria Contrato AV + Parcela com base no pagamento informado">
                  <button
                    disabled={savingPag}
                    className="w-full px-4 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-70"
                  >
                    {savingPag ? "Gerando…" : "Gerar Contrato AV"}
                  </button>
                </Tooltip>

                {selContrato?.numeroContrato ? (
                  <>
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm">
                      <div className="font-semibold text-blue-900">Contrato AV selecionado para vínculo</div>
                      <div className="text-blue-700">
                        Nº {selContrato.numeroContrato} - {clientesById.get(selContrato.clienteId)?.nomeRazaoSocial || "—"}
                      </div>
                      <div className="text-blue-600 text-xs mt-1">
                        Data: {fmtDateSafe(selContrato.dataRecebimentoISO)} - Valor: {fmtBRL(selContrato.valorRecebidoCentavos)}
                      </div>
                    </div>

                    {repassesDoContrato?.length ? (
                      <div className="mt-2 text-[12px] text-blue-700">
                        <div className="font-semibold">Repasses ligados ao contrato:</div>
                        <ul className="list-disc ml-5">
                          {repassesDoContrato.map((r, idx) => (
                            <li key={r.id || idx}>
                              {r.advogadoNome || r.advogadoId} — {fmtBRL(r.valorPrevistoCentavos)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </form>
            </div>

            {/* Step 2: Manual entries */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="px-5 py-4 bg-emerald-700 text-white">
                <div className="font-bold">2) Lançamentos manuais (por advogado / indicação)</div>
                <div className="text-xs text-emerald-100">Sem modelo de distribuição, sem alíquota automática.</div>
              </div>

              <form onSubmit={criarLancamentoManual} className="p-5 space-y-3">
                <div className={`rounded-2xl border p-4 ${selContrato ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                  <div className="text-xs font-semibold mb-1 text-slate-700">Vínculo do lançamento</div>
                  {selContrato?.numeroContrato ? (
                    <div className="text-sm">
                      <div className="font-semibold text-slate-900">Contrato: Nº {selContrato.numeroContrato}</div>
                      <div className="text-slate-600">
                        Cliente: {clientesById.get(selContrato.clienteId)?.nomeRazaoSocial || "—"}
                        {" - "}Data: {fmtDateSafe(selContrato.dataRecebimentoISO)}
                        {" - "}Valor: {fmtBRL(selContrato.valorRecebidoCentavos)}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-amber-800">
                      Nenhum contrato selecionado. Gere ou selecione um Contrato AV no passo 1.
                    </div>
                  )}
                </div>

                <div className="text-xs text-gray-500 font-semibold">Lançamentos do contrato</div>

                <div className="space-y-3">
                  {(lmItems || []).map((it, idx) => (
                    <div key={it.id} className="border rounded-2xl p-3 bg-white">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-xs font-semibold text-slate-700">Item #{idx + 1}</div>
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-lg border hover:bg-slate-50"
                          onClick={() => {
                            setLmItems((prev) => prev.length === 1 ? prev : prev.filter((x) => x.id !== it.id));
                          }}
                        >
                          Remover
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs text-gray-500 font-semibold mb-1">Advogado</div>
                          <select
                            className="w-full border rounded-xl px-3 py-2"
                            value={it.advogadoId}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLmItems((prev) => prev.map((x) => x.id === it.id ? { ...x, advogadoId: v } : x));
                            }}
                          >
                            <option value="">Selecione…</option>
                            {(base.advogados || []).map((a) => (
                              <option key={a.id} value={a.id}>{a.nome}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <div className="text-xs text-gray-500 font-semibold mb-1">Tipo</div>
                          <select
                            className="w-full border rounded-xl px-3 py-2"
                            value={it.tipo}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLmItems((prev) => prev.map((x) => x.id === it.id ? { ...x, tipo: v } : x));
                            }}
                          >
                            <option value="ADVOGADO">Advogado</option>
                            <option value="INDICACAO">Indicação</option>
                          </select>
                        </div>

                        <div>
                          <div className="text-xs text-gray-500 font-semibold mb-1">Valor do repasse</div>
                          <input
                            className="w-full border rounded-xl px-3 py-2"
                            value={moneyMask(it.valorRaw)}
                            onChange={(e) => {
                              const digits = String(e.target.value || "").replace(/\D/g, "");
                              setLmItems((prev) => prev.map((x) => x.id === it.id ? { ...x, valorRaw: digits } : x));
                            }}
                            placeholder="R$ 0,00"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="w-full px-4 py-2 rounded-xl border bg-white hover:bg-slate-50 text-sm font-semibold"
                  onClick={() => {
                    setLmItems((prev) => [
                      ...prev,
                      { id: String(Date.now() + Math.random()), advogadoId: "", tipo: "ADVOGADO", valorRaw: "" },
                    ]);
                  }}
                >
                  + Adicionar outro advogado
                </button>

                <Tooltip content="Cria lançamentos manuais vinculados ao contrato selecionado">
                  <button
                    disabled={savingLm}
                    className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-70"
                  >
                    {savingLm ? "Adicionando…" : "Adicionar lançamento manual"}
                  </button>
                </Tooltip>
              </form>
            </div>
          </div>
        )}

        {/* Lancamentos table */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 bg-gray-900 text-white flex items-center justify-between">
            <div className="font-bold">Lançamentos manuais — {String(mes).padStart(2, "0")}/{ano}</div>
            <Tooltip content="Recarrega lançamentos e repasses a realizar">
              <button
                className="text-xs bg-white/10 px-3 py-2 rounded-full hover:bg-white/20"
                onClick={async () => {
                  addToast("Atualizando dados…", "info");
                  await loadLancamentos();
                  await loadRepassesARealizar();
                  addToast("Dados atualizados.", "success");
                }}
              >
                Atualizar
              </button>
            </Tooltip>
          </div>
          <div className="p-5 overflow-auto">
            {lancamentos.length === 0 ? (
              <div className="text-gray-600">Nenhum lançamento manual nesta competência.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2">Advogado</th>
                    <th>Cliente</th>
                    <th>Contrato</th>
                    <th>Tipo</th>
                    <th>Data Pgto</th>
                    <th className="text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentos.map((x) => (
                    <tr key={x.id} className="border-t">
                      <td className="py-2 font-semibold">{x.advogado?.nome || x.advogadoId}</td>
                      <td>{x.cliente?.nomeRazaoSocial || x.clienteId}</td>
                      <td>{x.contrato?.numeroContrato || x.contratoId}</td>
                      <td>{x.tipo}</td>
                      <td>{fmtDateSafe(x.parcela?.dataRecebimento || x.createdAt)}</td>
                      <td className="text-right">{fmtBRL(x.valorPrevistoCentavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Step 3: Repasses a realizar */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 bg-indigo-700 text-white">
            <div className="font-bold">3) Repasses a realizar (fechamento do mês)</div>
            <div className="text-xs text-indigo-200">Considera saldo anterior para permitir repasse maior que o gerado.</div>
          </div>

          <div className="p-5 space-y-4">
            {repasses.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 font-semibold mb-1">Conta (Livro Caixa) p/ efetivação</div>
                <select className="w-64 border rounded-xl px-3 py-2" value={efContaId} onChange={(e) => setEfContaId(e.target.value)}>
                  <option value="">(opcional)</option>
                  {(base.contas || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
            )}

            {repasses.length === 0 ? (
              <div className="text-gray-600">Nada a repassar nesta competência.</div>
            ) : (
              repasses.map((r) => {
                const previsto = Number(r.valorPrevistoTotalCentavos || 0);
                const saldoAnterior = Number(r.saldoAnteriorCentavos || 0);
                const totalDisp = Number(r.totalDisponivelCentavos || 0);
                const efData = efMap[r.advogadoId] || {};

                return (
                  <div key={r.advogadoId} className="border rounded-2xl p-4 bg-indigo-50">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <div className="font-bold text-gray-900">{r.advogadoNome}</div>
                        <div className="text-xs text-gray-600">
                          Previsto: {fmtBRL(previsto)}
                          {" • "}Saldo anterior: {fmtBRL(saldoAnterior)}
                          {" • "}Total disponível: {fmtBRL(totalDisp)}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="text-[11px] text-gray-500 font-semibold">Data do repasse</div>
                            <input
                              type="date"
                              className="border rounded-xl px-3 py-2 w-40"
                              value={efData.dataISO || defaultRepasseDateISO(selContrato?.dataRecebimentoISO)}
                              onChange={(e) => setEfMap((p) => ({
                                ...p,
                                [r.advogadoId]: { ...(p[r.advogadoId] || {}), dataISO: e.target.value },
                              }))}
                            />
                          </div>
                          <div>
                            <div className="text-[11px] text-gray-500 font-semibold">Valor repassado</div>
                            <input
                              className="border rounded-xl px-3 py-2 w-44"
                              value={moneyMask(efData.valorRaw || "")}
                              onChange={(e) => setEfMap((p) => ({
                                ...p,
                                [r.advogadoId]: { ...(p[r.advogadoId] || {}), valorRaw: e.target.value },
                              }))}
                              placeholder="R$ 0,00"
                            />
                          </div>
                          <div className="self-end">
                            <button
                              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-70"
                              onClick={() => efetivarRepasse(r.advogadoId)}
                              disabled={!!savingEf[r.advogadoId]}
                            >
                              {savingEf[r.advogadoId] ? "Efetivando…" : "Efetivar"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
