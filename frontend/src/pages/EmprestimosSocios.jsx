import React, { useState, useEffect } from "react";
import { apiFetch, getUser } from "../lib/api";
import { useToast } from "../components/Toast";
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const maskBRL = (raw) => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const MONTHS_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const fmt = {
  date: (d) => {
    if (!d) return "—";
    const str = String(d).includes("T") ? d : `${d}T12:00:00`;
    const dt = new Date(str);
    if (isNaN(dt)) return "—";
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yy = dt.getFullYear();
    return `${dd}/${mm}/${yy}`;
  },
  money: (cents) => {
    const val = Number(cents || 0) / 100;
    return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
};

export default function EmprestimosSocios({ user }) {
  const { addToast } = useToast();
  const userInfo = user || getUser();
  const isAdmin = (userInfo?.role || "").toUpperCase() === "ADMIN";

  const now = new Date();
  const [tab, setTab] = useState("emprestimos"); // "emprestimos" | "adiantamentos"
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(0); // 0 = todos
  const [lawyerId, setLawyerId] = useState("ALL");
  const [lawyers, setLawyers] = useState([]);
  const [contas, setContas] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [anosResumo, setAnosResumo] = useState([]);

  // Adiantamentos tab state
  const [dataAdt, setDataAdt] = useState(null);
  const [loadingAdt, setLoadingAdt] = useState(false);
  const [anosResumoAdt, setAnosResumoAdt] = useState([]);
  // Modal devolução
  const [modalDev, setModalDev] = useState(null); // { id, valorAdiantadoCentavos, valorDevolvidoCentavos, saldoCentavos, nome, competencia }
  const [devValor, setDevValor] = useState("");
  const [devData, setDevData] = useState("");
  const [devSaving, setDevSaving] = useState(false);

  // Modal de pagamento
  const [modalPagar, setModalPagar] = useState(null); // { id, valorCentavos, valorPagoCentavos, saldoCentavos, nome, competencia }
  const [pagData, setPagData] = useState("");
  const [pagValor, setPagValor] = useState("");
  const [pagConta, setPagConta] = useState("");
  const [pagandoId, setPagandoId] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch("/advogados")
      .then(res => {
        const list = Array.isArray(res) ? res : res?.items || [];
        setLawyers(list.filter(a => a.ativo));
      })
      .catch(() => setLawyers([]));
    apiFetch("/livro-caixa/contas")
      .then(res => setContas(Array.isArray(res) ? res : res?.contas || []))
      .catch(() => setContas([]));
    apiFetch("/emprestimos-socios/anos-resumo")
      .then(res => setAnosResumo(Array.isArray(res) ? res : []))
      .catch(() => setAnosResumo([]));
    apiFetch("/adiantamentos-socios/anos-resumo")
      .then(res => setAnosResumoAdt(Array.isArray(res) ? res : []))
      .catch(() => setAnosResumoAdt([]));
  }, [isAdmin]);

  const abrirAno = (ano, tabAtiva) => {
    setYear(ano);
    setMonth(0);
    setLawyerId("ALL");
    const t = tabAtiva || tab;
    const params = new URLSearchParams({ ano, mes: 0 });
    if (t === "emprestimos") {
      setLoading(true);
      setData(null);
      apiFetch(`/relatorios/emprestimos-socios?${params}`)
        .then(res => setData(res))
        .catch(err => addToast(err.message || "Erro", "error"))
        .finally(() => setLoading(false));
    } else {
      setLoadingAdt(true);
      setDataAdt(null);
      apiFetch(`/relatorios/adiantamentos-socios?${params}`)
        .then(res => setDataAdt(res))
        .catch(err => addToast(err.message || "Erro", "error"))
        .finally(() => setLoadingAdt(false));
    }
  };

  const confirmarDevolucao = async () => {
    if (!modalDev) return;
    if (!devData) { addToast("Informe a data", "error"); return; }
    const cents = parseInt(devValor.replace(/\D/g, ""), 10) || 0;
    if (!cents) { addToast("Informe o valor", "error"); return; }
    setDevSaving(true);
    try {
      await apiFetch(`/adiantamentos-socios/${modalDev.id}/devolver`, {
        method: "PATCH",
        body: JSON.stringify({ valorDevolvidoCentavos: cents, dataQuitacao: devData }),
      });
      addToast("Devolução registrada!", "success");
      setModalDev(null);
      fetchAdiantamentos();
      apiFetch("/adiantamentos-socios/anos-resumo")
        .then(r => setAnosResumoAdt(Array.isArray(r) ? r : []))
        .catch(() => {});
    } catch (err) {
      addToast(err.message || "Erro", "error");
    } finally {
      setDevSaving(false);
    }
  };

  const fetchAdiantamentos = async () => {
    setLoadingAdt(true);
    setDataAdt(null);
    try {
      const params = new URLSearchParams({ ano: year, mes: month });
      if (lawyerId !== "ALL") params.set("advogadoId", lawyerId);
      const res = await apiFetch(`/relatorios/adiantamentos-socios?${params}`);
      setDataAdt(res);
    } catch (err) {
      addToast(err.message || "Erro ao buscar adiantamentos", "error");
    } finally {
      setLoadingAdt(false);
    }
  };

  const fetchEmprestimos = async () => {
    setLoading(true);
    setData(null);
    try {
      const params = new URLSearchParams({ ano: year, mes: month });
      if (lawyerId !== "ALL") params.set("advogadoId", lawyerId);
      const res = await apiFetch(`/relatorios/emprestimos-socios?${params}`);
      setData(res);
    } catch (err) {
      addToast(err.message || "Erro ao buscar empréstimos", "error");
    } finally {
      setLoading(false);
    }
  };

  const abrirModalPagar = (item, nomeAdvogado) => {
    const saldo = item.saldoCentavos ?? Math.max(0, item.valorCentavos - (item.valorPagoCentavos || 0));
    setPagData(todayISO());
    setPagValor(maskBRL(String(saldo)));
    setPagConta("");
    setModalPagar({ id: item.id, valorCentavos: item.valorCentavos, valorPagoCentavos: item.valorPagoCentavos || 0, saldoCentavos: saldo, nome: nomeAdvogado, competencia: item.competencia });
  };

  const confirmarPagamento = async () => {
    if (!modalPagar) return;
    if (!pagData) { addToast("Data inválida", "error"); return; }
    if (!pagConta) { addToast("Selecione a conta contábil", "error"); return; }
    const isoDate = pagData;
    const valorNum = parseFloat(pagValor.replace(/\./g, "").replace(",", "."));
    if (isNaN(valorNum) || valorNum <= 0) { addToast("Valor inválido", "error"); return; }
    const valorCentavos = Math.round(valorNum * 100);

    setPagandoId(modalPagar.id);
    try {
      const res = await apiFetch(`/emprestimos-socios/${modalPagar.id}/quitar`, {
        method: "PATCH",
        body: JSON.stringify({ dataPagamento: isoDate, valorPagamentoCentavos: valorCentavos, contaId: parseInt(pagConta) }),
      });
      addToast(res.message || "Pagamento registrado!", "success");
      setModalPagar(null);
      fetchEmprestimos();
      apiFetch("/emprestimos-socios/anos-resumo")
        .then(r => setAnosResumo(Array.isArray(r) ? r : []))
        .catch(() => {});
    } catch (err) {
      addToast(err.message || "Erro ao registrar pagamento", "error");
    } finally {
      setPagandoId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-gray-500">Acesso restrito a administradores.</div>
    );
  }

  const buscar = () => tab === "emprestimos" ? fetchEmprestimos() : fetchAdiantamentos();

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Empréstimos &amp; Adiantamentos de Sócios</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {[
          { key: "emprestimos", label: "Empréstimos" },
          { key: "adiantamentos", label: "Adiantamentos" },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setData(null); setDataAdt(null); }}
            className={`px-5 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
              tab === t.key
                ? "bg-white border border-b-white border-gray-200 -mb-px text-primary"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Ano</label>
            <input
              type="number"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              min="2020"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Mês (0 = todos)</label>
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value={0}>Todos</option>
              {MONTHS_FULL.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Advogado</label>
            <select
              value={lawyerId}
              onChange={e => setLawyerId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="ALL">Todos</option>
              {lawyers.map(l => (
                <option key={l.id} value={l.id}>{l.nome}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={buscar}
              disabled={loading || loadingAdt}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {(loading || loadingAdt) ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </div>
      </div>

      {/* ── EMPRÉSTIMOS ── */}
      {tab === "emprestimos" && (
        <>
          {!data ? (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
              Clique em "Buscar" para visualizar os empréstimos.
            </div>
          ) : data.emprestimos?.length === 0 ? (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-500">Nenhum empréstimo encontrado.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="text-sm text-amber-800 font-semibold">Total Pendente (Saldo)</div>
                  <div className="text-xl font-bold text-amber-900">R$ {fmt.money(data.totalGeralPendenteCentavos || 0)}</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="text-sm text-green-800 font-semibold">Total Quitado</div>
                  <div className="text-xl font-bold text-green-900">R$ {fmt.money(data.totalGeralQuitadoCentavos || 0)}</div>
                </div>
              </div>
              {data.emprestimos.map((grupo) => (
                <div key={grupo.advogadoId} className="bg-white border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-gray-800">{grupo.advogadoNome}</div>
                    <div className="text-sm text-gray-600">
                      Saldo pendente: <b className="text-amber-700">R$ {fmt.money(grupo.totalPendenteCentavos)}</b>
                      {grupo.totalQuitadoCentavos > 0 && (
                        <span className="ml-3">Quitado: <b className="text-green-700">R$ {fmt.money(grupo.totalQuitadoCentavos)}</b></span>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-2">Competência</th>
                        <th className="text-right p-2">Valor</th>
                        <th className="text-right p-2">Pago</th>
                        <th className="text-right p-2">Saldo</th>
                        <th className="text-left p-2">Descrição</th>
                        <th className="text-center p-2">Status</th>
                        <th className="text-left p-2">Dt. Empréstimo</th>
                        <th className="text-left p-2">Dt. Pagamento</th>
                        <th className="text-center p-2">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {grupo.items.map((item) => {
                        const saldo = item.saldoCentavos ?? Math.max(0, item.valorCentavos - (item.valorPagoCentavos || 0));
                        return (
                          <tr key={item.id}>
                            <td className="p-2">{item.competencia}</td>
                            <td className="text-right p-2 font-semibold">R$ {fmt.money(item.valorCentavos)}</td>
                            <td className="text-right p-2 text-blue-700">{item.valorPagoCentavos > 0 ? `R$ ${fmt.money(item.valorPagoCentavos)}` : "—"}</td>
                            <td className="text-right p-2 font-semibold text-amber-700">{!item.quitado ? `R$ ${fmt.money(saldo)}` : "—"}</td>
                            <td className="p-2 text-gray-600">{item.descricao}</td>
                            <td className="text-center p-2">
                              {item.quitado
                                ? <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700 font-semibold">Quitado</span>
                                : item.valorPagoCentavos > 0
                                  ? <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700 font-semibold">Parcial</span>
                                  : <span className="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-700 font-semibold">Pendente</span>}
                            </td>
                            <td className="p-2 text-gray-600">{fmt.date(item.dataRegistro)}</td>
                            <td className="p-2 text-gray-600">{item.dataQuitacao ? fmt.date(item.dataQuitacao) : "—"}</td>
                            <td className="text-center p-2">
                              {!item.quitado && (
                                <button onClick={() => abrirModalPagar(item, grupo.advogadoNome)} className="px-3 py-1 text-xs bg-green-600 text-white rounded font-semibold hover:bg-green-700">Pagar</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* Anos — Empréstimos */}
          {anosResumo.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Empréstimos por Ano</h2>
              <div className="flex flex-wrap gap-2">
                {anosResumo.map(({ ano, status, pendentes, total }) => {
                  const quitado = status === "Quitados";
                  const isSelected = year === ano;
                  return (
                    <button key={ano} onClick={() => !isSelected && abrirAno(ano, "emprestimos")} disabled={isSelected} title={`${total} empréstimo(s), ${pendentes} pendente(s)`}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-all
                        ${isSelected ? (quitado ? "bg-green-600 text-white border-green-600 cursor-default" : "bg-amber-500 text-white border-amber-500 cursor-default")
                          : (quitado ? "bg-green-50 text-green-700 border-green-300 hover:bg-green-100" : "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100")}`}>
                      <span>{ano}</span>
                      <span className={`text-xs font-normal ${isSelected ? "opacity-90" : "opacity-70"}`}>{status}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ADIANTAMENTOS ── */}
      {tab === "adiantamentos" && (
        <>
          {!dataAdt ? (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
              Clique em "Buscar" para visualizar os adiantamentos.
            </div>
          ) : dataAdt.adiantamentos?.length === 0 ? (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-500">Nenhum adiantamento encontrado.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="text-sm text-amber-800 font-semibold">Total Pendente (Saldo)</div>
                  <div className="text-xl font-bold text-amber-900">R$ {fmt.money(dataAdt.totalGeralPendenteCentavos || 0)}</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="text-sm text-green-800 font-semibold">Total Quitado</div>
                  <div className="text-xl font-bold text-green-900">R$ {fmt.money(dataAdt.totalGeralQuitadoCentavos || 0)}</div>
                </div>
              </div>
              {dataAdt.adiantamentos.map((grupo) => (
                <div key={grupo.advogadoId} className="bg-white border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-gray-800">{grupo.advogadoNome}</div>
                    <div className="text-sm text-gray-600">
                      Pendente: <b className="text-amber-700">R$ {fmt.money(grupo.totalPendenteCentavos)}</b>
                      {grupo.totalQuitadoCentavos > 0 && (
                        <span className="ml-3">Quitado: <b className="text-green-700">R$ {fmt.money(grupo.totalQuitadoCentavos)}</b></span>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-2">Competência</th>
                        <th className="text-left p-2">Cliente</th>
                        <th className="text-right p-2">Prev.</th>
                        <th className="text-right p-2">Adiantado</th>
                        <th className="text-right p-2">Devolvido</th>
                        <th className="text-right p-2">Saldo</th>
                        <th className="text-center p-2">Status</th>
                        <th className="text-left p-2">Dt. Registro</th>
                        <th className="text-center p-2">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {grupo.items.map((item) => (
                        <tr key={item.id}>
                          <td className="p-2">{item.competencia}</td>
                          <td className="p-2 text-gray-700">{item.clienteNome}</td>
                          <td className="text-right p-2 text-gray-500">{item.valorPrevistoCentavos > 0 ? `R$ ${fmt.money(item.valorPrevistoCentavos)}` : "—"}</td>
                          <td className="text-right p-2 font-semibold text-purple-700">R$ {fmt.money(item.valorAdiantadoCentavos)}</td>
                          <td className="text-right p-2 text-blue-700">{item.valorDevolvidoCentavos > 0 ? `R$ ${fmt.money(item.valorDevolvidoCentavos)}` : "—"}</td>
                          <td className="text-right p-2 font-semibold text-amber-700">{!item.quitado ? `R$ ${fmt.money(item.saldoCentavos)}` : "—"}</td>
                          <td className="text-center p-2">
                            {item.quitado
                              ? <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700 font-semibold">Quitado</span>
                              : item.valorDevolvidoCentavos > 0
                                ? <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700 font-semibold">Parcial</span>
                                : <span className="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-700 font-semibold">Pendente</span>}
                          </td>
                          <td className="p-2 text-gray-600">{fmt.date(item.dataRegistro)}</td>
                          <td className="text-center p-2">
                            {!item.quitado && (
                              <button
                                onClick={() => {
                                  setDevValor(maskBRL(String(item.saldoCentavos)));
                                  setDevData(new Date().toISOString().slice(0, 10));
                                  setModalDev({ id: item.id, valorAdiantadoCentavos: item.valorAdiantadoCentavos, valorDevolvidoCentavos: item.valorDevolvidoCentavos, saldoCentavos: item.saldoCentavos, nome: grupo.advogadoNome, competencia: item.competencia });
                                }}
                                className="px-3 py-1 text-xs bg-purple-600 text-white rounded font-semibold hover:bg-purple-700"
                              >Devolver</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* Anos — Adiantamentos */}
          {anosResumoAdt.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Adiantamentos por Ano</h2>
              <div className="flex flex-wrap gap-2">
                {anosResumoAdt.map(({ ano, status, pendentes, total }) => {
                  const quitado = status === "Quitados";
                  const isSelected = year === ano;
                  return (
                    <button key={ano} onClick={() => !isSelected && abrirAno(ano, "adiantamentos")} disabled={isSelected} title={`${total} adiantamento(s), ${pendentes} pendente(s)`}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-all
                        ${isSelected ? (quitado ? "bg-green-600 text-white border-green-600 cursor-default" : "bg-purple-600 text-white border-purple-600 cursor-default")
                          : (quitado ? "bg-green-50 text-green-700 border-green-300 hover:bg-green-100" : "bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100")}`}>
                      <span>{ano}</span>
                      <span className={`text-xs font-normal ${isSelected ? "opacity-90" : "opacity-70"}`}>{status}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal pagamento empréstimo */}
      {modalPagar && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">Registrar Pagamento</h2>
              <p className="text-sm text-gray-500 mb-4">{modalPagar.nome} — Competência {modalPagar.competencia}</p>
              <div className="space-y-2 mb-4 text-sm bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between"><span className="text-gray-600">Valor do empréstimo:</span><span className="font-semibold">R$ {fmt.money(modalPagar.valorCentavos)}</span></div>
                {modalPagar.valorPagoCentavos > 0 && <div className="flex justify-between"><span className="text-gray-600">Já pago:</span><span className="text-blue-700 font-semibold">R$ {fmt.money(modalPagar.valorPagoCentavos)}</span></div>}
                <div className="flex justify-between border-t pt-2"><span className="text-gray-700 font-semibold">Saldo restante:</span><span className="text-amber-700 font-bold">R$ {fmt.money(modalPagar.saldoCentavos)}</span></div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Data do pagamento</label>
                  <input type="date" value={pagData} onChange={e => setPagData(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Valor pago (R$)</label>
                  <input type="text" inputMode="numeric" value={pagValor} onChange={e => setPagValor(maskBRL(e.target.value))} placeholder="0,00" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Conta contábil</label>
                  <select value={pagConta} onChange={e => setPagConta(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Selecione a conta...</option>
                    {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setModalPagar(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarPagamento} disabled={!!pagandoId} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                {pagandoId ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal devolução adiantamento */}
      {modalDev && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">Registrar Devolução</h2>
              <p className="text-sm text-gray-500 mb-4">{modalDev.nome} — Competência {modalDev.competencia}</p>
              <div className="space-y-2 mb-4 text-sm bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between"><span className="text-gray-600">Adiantado:</span><span className="font-semibold text-purple-700">R$ {fmt.money(modalDev.valorAdiantadoCentavos)}</span></div>
                {modalDev.valorDevolvidoCentavos > 0 && <div className="flex justify-between"><span className="text-gray-600">Já devolvido:</span><span className="text-blue-700 font-semibold">R$ {fmt.money(modalDev.valorDevolvidoCentavos)}</span></div>}
                <div className="flex justify-between border-t pt-2"><span className="text-gray-700 font-semibold">Saldo pendente:</span><span className="text-amber-700 font-bold">R$ {fmt.money(modalDev.saldoCentavos)}</span></div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Data da devolução</label>
                  <input type="date" value={devData} onChange={e => setDevData(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Valor devolvido (R$)</label>
                  <input type="text" inputMode="numeric" value={devValor} onChange={e => setDevValor(maskBRL(e.target.value))} placeholder="0,00" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setModalDev(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarDevolucao} disabled={devSaving} className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
                {devSaving ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
