// src/pages/RepassesARealizar.jsx - VERSÃO CORRIGIDA FINAL
import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import ConfirmModal from "../components/ConfirmModal.jsx";

function monthOptions() {
  return [
    { v: 1, t: "Jan" }, { v: 2, t: "Fev" }, { v: 3, t: "Mar" }, { v: 4, t: "Abr" },
    { v: 5, t: "Mai" }, { v: 6, t: "Jun" }, { v: 7, t: "Jul" }, { v: 8, t: "Ago" },
    { v: 9, t: "Set" }, { v: 10, t: "Out" }, { v: 11, t: "Nov" }, { v: 12, t: "Dez" },
  ];
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateToBR(date) {
  if (!date) return "—";
  // Append T12:00:00 to avoid timezone shift issues
  const str = String(date).includes("T") ? date : `${date}T12:00:00`;
  const d = new Date(str);
  if (isNaN(d)) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function toDateInputValue(date) {
  // Append T12:00:00 to avoid timezone shift issues
  const str = String(date).includes("T") ? date : `${date}T12:00:00`;
  const d = new Date(str);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatCentsToBRL(cents) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskCurrency(value) {
  // Remove tudo exceto dígitos
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";

  // Converte para número e formata
  const cents = Number(digits);
  return formatCentsToBRL(cents);
}

function maskDate(value) {
  const numbers = value.replace(/\D/g, "");
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 4) return `${numbers.slice(0, 2)}/${numbers.slice(2)}`;
  return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}/${numbers.slice(4, 8)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  // Append T12:00:00 to avoid timezone shift issues
  const str = String(dateStr).includes("T") ? dateStr : `${dateStr}T12:00:00`;
  const d = new Date(str);
  if (isNaN(d)) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default function RepassesARealizarPage({ user }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const { addToast } = useToast();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [contas, setContas] = useState([]);

  // Modal de detalhes dos lançamentos
  const [modalLancamentos, setModalLancamentos] = useState({
    open: false,
    advogadoNome: "",
    lancamentos: [],
    adiantamentos: [],
    loading: false,
    hasChanged: false,
  });

  const [editingRepasse, setEditingRepasse] = useState({ idx: null, inputValue: "" });

  // Formulário de adiantamento (dentro do modal de lançamentos)
  const [adtForm, setAdtForm] = useState({ open: false, clienteId: "", valorPrevisto: "", valorAdiantado: "", obs: "", saving: false });
  const [editingAdt, setEditingAdt] = useState(null); // { id, clienteId, valorPrevisto, valorAdiantado, obs, saving }
  const [clientes, setClientes] = useState([]);
  const [clientesLoaded, setClientesLoaded] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const pendingConfirmRef = useRef(null);

  const [modalRealizar, setModalRealizar] = useState({
    open: false,
    advogadoId: null,
    advogadoNome: "",
    valorPrevisto: "0.00",
    percentualReal: "0.00",
    saldoDisponivel: "0.00",
    valorEfetivadoCents: 0,
    valorEfetivadoDisplay: "0,00",
    dataRepasseISO: toDateInputValue(new Date()),
    observacoes: "",
    contaIdRepasse: "",
    contaIdParcelaFixa: "",
    usarSplitContas: false,
    contasSplit: [],
    loading: false,
    error: "",
    parcelaFixaAtiva: false,
    parcelaFixaNome: "",
    parcelaFixaValorCentavos: 0,
    confirmarParcelaFixa: true,
    ehSocio: false,
    // Abatimento de adiantamentos
    usarAbatimento: false,
    loadingAdiantamentos: false,
    adiantamentosPendentes: [], // [{id, clienteNome, competenciaAno, competenciaMes, saldoCentavos}]
    abatimentoModo: "selecionar", // "selecionar" | "valor"
    abatimentoItens: [], // [{id, checked, valorAbaterCentavos, valorAbaterDisplay}] para modo selecionar
    abatimentoValorCents: 0, // para modo FIFO por valor
    abatimentoValorDisplay: "",
  });

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await apiFetch(`/repasses/a-realizar?ano=${ano}&mes=${mes}`);
      console.log('✅ Dados recebidos do backend:', res);
      setData(res);
    } catch (e) {
      setErr(e?.message || "Erro ao carregar repasses");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadAdiantamentosPendentes(advogadoId) {
    setModalRealizar(prev => ({ ...prev, loadingAdiantamentos: true }));
    try {
      const res = await apiFetch(`/repasses/adiantamentos-pendentes?advogadoId=${advogadoId}`);
      const lista = res || [];
      const itens = lista.map(a => ({
        id: a.id,
        clienteNome: a.clienteNome,
        competenciaAno: a.competenciaAno,
        competenciaMes: a.competenciaMes,
        saldoCentavos: a.saldoCentavos,
        checked: false,
        valorAbaterCentavos: a.saldoCentavos,
        valorAbaterDisplay: formatCentsToBRL(a.saldoCentavos),
      }));
      setModalRealizar(prev => ({ ...prev, adiantamentosPendentes: lista, abatimentoItens: itens, loadingAdiantamentos: false }));
    } catch (e) {
      console.error("Erro ao carregar adiantamentos:", e);
      setModalRealizar(prev => ({ ...prev, adiantamentosPendentes: [], abatimentoItens: [], loadingAdiantamentos: false }));
    }
  }

  async function loadContas() {
    try {
      const res = await apiFetch("/livro-caixa/contas");
      setContas(res || []);
    } catch (e) {
      console.error("Erro ao carregar contas:", e);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);
  useEffect(() => { loadContas(); }, []);

  async function abrirModalLancamentos(advogadoId, advogadoNome) {
    setEditingRepasse({ idx: null, inputValue: "" });
    setAdtForm({ open: false, clienteId: "", valorPrevisto: "", valorAdiantado: "", obs: "", saving: false });
    setModalLancamentos({
      open: true,
      advogadoId,
      advogadoNome,
      lancamentos: [],
      adiantamentos: [],
      loading: true,
      hasChanged: false,
    });

    try {
      const res = await apiFetch(`/repasses/a-realizar/${advogadoId}/lancamentos?ano=${ano}&mes=${mes}`);
      setModalLancamentos({
        open: true,
        advogadoId,
        advogadoNome,
        lancamentos: res?.lancamentos || [],
        adiantamentos: res?.adiantamentos || [],
        loading: false,
        hasChanged: false,
      });
    } catch (e) {
      console.error("Erro ao carregar lançamentos:", e);
      setModalLancamentos({
        open: true,
        advogadoId,
        advogadoNome,
        lancamentos: [],
        adiantamentos: [],
        loading: false,
        hasChanged: false,
      });
    }
  }

  async function salvarAdiantamento() {
    const { clienteId, valorPrevisto, valorAdiantado, obs } = adtForm;
    if (!clienteId) { addToast("Selecione o cliente", "error"); return; }
    const adtCents = parseInt(valorAdiantado.replace(/\D/g, ""), 10) || 0;
    if (!adtCents) { addToast("Informe o valor do adiantamento", "error"); return; }
    const prevCents = parseInt(valorPrevisto.replace(/\D/g, ""), 10) || 0;
    setAdtForm(f => ({ ...f, saving: true }));
    try {
      const res = await apiFetch("/adiantamentos-socios", {
        method: "POST",
        body: JSON.stringify({
          advogadoId: modalLancamentos.advogadoId,
          clienteId: parseInt(clienteId),
          competenciaAno: ano,
          competenciaMes: mes,
          valorPrevistoCentavos: prevCents,
          valorAdiantadoCentavos: adtCents,
          observacoes: obs || null,
          dataRegistro: new Date().toISOString().slice(0, 10),
        }),
      });
      setModalLancamentos(prev => ({
        ...prev,
        adiantamentos: [...prev.adiantamentos, res],
        hasChanged: true,
      }));
      setAdtForm({ open: false, clienteId: "", valorPrevisto: "", valorAdiantado: "", obs: "", saving: false });
      addToast("Adiantamento registrado!", "success");
    } catch (err) {
      addToast(err.message || "Erro ao registrar adiantamento", "error");
      setAdtForm(f => ({ ...f, saving: false }));
    }
  }

  async function abrirFormAdiantamento() {
    if (!clientesLoaded) {
      try {
        const res = await apiFetch("/clients?tipo=C,A");
        setClientes(Array.isArray(res) ? res : []);
        setClientesLoaded(true);
      } catch { setClientes([]); }
    }
    setAdtForm({ open: true, clienteId: "", valorPrevisto: "", valorAdiantado: "", obs: "", saving: false });
  }

  async function abrirEdicaoAdt(a) {
    if (!clientesLoaded) {
      try {
        const res = await apiFetch("/clients?tipo=C,A");
        setClientes(Array.isArray(res) ? res : []);
        setClientesLoaded(true);
      } catch { setClientes([]); }
    }
    setEditingAdt({
      id: a.id,
      clienteId: String(a.clienteId),
      valorPrevisto: a.valorPrevistoCentavos > 0 ? maskCurrency(String(a.valorPrevistoCentavos)) : "",
      valorAdiantado: maskCurrency(String(a.valorAdiantadoCentavos)),
      obs: a.observacoes || "",
      saving: false,
    });
  }

  async function salvarEdicaoAdt() {
    if (!editingAdt) return;
    const adtCents = parseInt(editingAdt.valorAdiantado.replace(/\D/g, ""), 10) || 0;
    if (!adtCents) { addToast("Informe o valor do adiantamento", "error"); return; }
    const prevCents = parseInt(editingAdt.valorPrevisto.replace(/\D/g, ""), 10) || 0;
    setEditingAdt(e => ({ ...e, saving: true }));
    try {
      const res = await apiFetch(`/adiantamentos-socios/${editingAdt.id}`, {
        method: "PUT",
        body: JSON.stringify({
          clienteId: parseInt(editingAdt.clienteId),
          valorPrevistoCentavos: prevCents,
          valorAdiantadoCentavos: adtCents,
          observacoes: editingAdt.obs || null,
        }),
      });
      setModalLancamentos(prev => ({
        ...prev,
        adiantamentos: prev.adiantamentos.map(a => a.id === editingAdt.id ? res : a),
        hasChanged: true,
      }));
      setEditingAdt(null);
      addToast("Adiantamento atualizado!", "success");
    } catch (err) {
      addToast(err.message || "Erro ao salvar", "error");
      setEditingAdt(e => ({ ...e, saving: false }));
    }
  }

  function excluirAdt(id) {
    pendingConfirmRef.current = async () => {
      try {
        await apiFetch(`/adiantamentos-socios/${id}`, { method: "DELETE" });
        setModalLancamentos(prev => ({
          ...prev,
          adiantamentos: prev.adiantamentos.filter(a => a.id !== id),
          hasChanged: true,
        }));
        addToast("Adiantamento excluído!", "success");
      } catch (err) {
        addToast(err.message || "Erro ao excluir", "error");
      }
    };
    setConfirmState({ title: "Excluir adiantamento", message: "Confirma a exclusão deste adiantamento? Esta ação não pode ser desfeita.", danger: true });
  }

  async function abrirModalRealizar(item) {
    const { advogadoId, advogadoNome, valorTotal, parcelaFixaAtiva, parcelaFixaNome, parcelaFixaValorCentavos, ehSocio, chavePix } = item;
    console.log('🎯 CLICOU REALIZAR:', item);

    try {
      const verificacao = await apiFetch(
        `/repasses/verificar-duplicata?advogadoId=${advogadoId}&ano=${ano}&mes=${mes}`
      );

      if (verificacao.jaRealizado) {
        addToast(
          `Este repasse já foi realizado em ${formatDate(verificacao.repasse.dataRepasse)} - Valor: ${money(verificacao.repasse.valorEfetivado)}. Se necessário realizar novo pagamento, aguarde a atualização da página.`,
          "warning"
        );
        await load();
        return;
      }
    } catch (e) {
      console.error("Erro ao verificar duplicata:", e);
    }

    // ✅ Valor já vem em reais do backend
    const valorPrevistoFinal = Number(valorTotal || 0);

    // Buscar lançamentos para calcular percentual
    let percentualReal = 0;
    try {
      const lancamentos = await apiFetch(`/repasses/a-realizar/${advogadoId}/lancamentos?ano=${ano}&mes=${mes}`);      
      if (lancamentos?.lancamentos?.length > 0) {
        const liquidoTotal = lancamentos.lancamentos.reduce((sum, l) => sum + Number(l.liquido || 0), 0);
        const repasseTotal = lancamentos.lancamentos.reduce((sum, l) => sum + Number(l.valorRepasse || 0), 0);

        if (liquidoTotal > 0) {
          percentualReal = (repasseTotal / liquidoTotal) * 100;
        }

        console.log('📊 Lançamentos:', {
          qtd: lancamentos.lancamentos.length,
          liquidoTotal,
          repasseTotal,
          percentual: percentualReal.toFixed(2) + '%'
        });
      }
    } catch (e) {
      console.error("Erro ao buscar lançamentos:", e);
    }

    // Buscar saldo acumulado
    let saldoAcumulado = 0;
    try {
      const resSaldo = await apiFetch(`/repasses/saldos?advogadoId=${advogadoId}`);
      if (resSaldo?.saldos?.[0]?.saldo) {
        saldoAcumulado = Number(resSaldo.saldos[0].saldo);
      }
      console.log('💰 Saldo acumulado:', saldoAcumulado);
    } catch (e) {
      console.error("Erro ao buscar saldo:", e);
    }

    // ✅ CORREÇÃO: Converter para centavos apenas uma vez
    const previstoCentavos = Math.round(valorPrevistoFinal * 100);

    setModalRealizar({
      open: true,
      advogadoId,
      advogadoNome,
      valorPrevisto: valorPrevistoFinal.toFixed(2),
      percentualReal: percentualReal.toFixed(2),
      saldoDisponivel: saldoAcumulado.toFixed(2),
      valorEfetivadoCents: previstoCentavos,
      valorEfetivadoDisplay: formatCentsToBRL(previstoCentavos),
      dataRepasseISO: toDateInputValue(new Date()),
      observacoes: "",
      contaIdRepasse: "",
      contaIdParcelaFixa: "",
      usarSplitContas: false,
      contasSplit: [],
      loading: false,
      error: "",
      parcelaFixaAtiva: !!parcelaFixaAtiva,
      parcelaFixaNome: parcelaFixaNome || "",
      parcelaFixaValorCentavos: parcelaFixaValorCentavos || 0,
      confirmarParcelaFixa: true,
      ehSocio: !!ehSocio,
      // Pix
      chavePix: chavePix || null,
      enviarPixAposRealizar: false,
      // Abatimento — reset ao abrir
      usarAbatimento: false,
      loadingAdiantamentos: true,
      adiantamentosPendentes: [],
      abatimentoModo: "selecionar",
      abatimentoItens: [],
      abatimentoValorCents: 0,
      abatimentoValorDisplay: "",
    });
    // Carrega adiantamentos ao abrir o modal (em background)
    loadAdiantamentosPendentes(advogadoId);
  }

  function fecharModal() {
    setModalRealizar({
      ...modalRealizar,
      open: false,
      error: "",
    });
  }

  async function confirmarRepasse() {
    const { advogadoId, valorEfetivadoCents, dataRepasseISO, observacoes, contaIdRepasse, contaIdParcelaFixa, usarSplitContas, contasSplit, confirmarParcelaFixa, parcelaFixaAtiva, parcelaFixaValorCentavos, ehSocio, usarAbatimento, abatimentoModo, abatimentoItens, abatimentoValorCents, adiantamentosPendentes } = modalRealizar;

    // Calcular abatimentos a enviar
    let adiantamentosAbater = [];
    if (usarAbatimento) {
      if (abatimentoModo === "selecionar") {
        adiantamentosAbater = abatimentoItens
          .filter(i => i.checked && i.valorAbaterCentavos > 0)
          .map(i => ({ id: i.id, valorAbaterCentavos: i.valorAbaterCentavos }));
      } else {
        // FIFO: distribuir o valor informado pelos adiantamentos mais antigos
        let remaining = abatimentoValorCents;
        for (const adt of adiantamentosPendentes) {
          if (remaining <= 0) break;
          const usar = Math.min(remaining, adt.saldoCentavos);
          if (usar > 0) {
            adiantamentosAbater.push({ id: adt.id, valorAbaterCentavos: usar });
            remaining -= usar;
          }
        }
      }
    }
    const valorAbatimentoTotal = adiantamentosAbater.reduce((s, a) => s + a.valorAbaterCentavos, 0);

    // Gera empréstimo apenas quando há repasse variável E sócio tem parcela fixa desmarcada
    const geraEmprestimo = ehSocio && parcelaFixaAtiva && parcelaFixaValorCentavos > 0 && !confirmarParcelaFixa && valorEfetivadoCents > 0;
    // Valor líquido após abatimento
    const valorLiquidoCents = valorEfetivadoCents - valorAbatimentoTotal;
    // Sem movimento quando não gera empréstimo e o líquido (após abatimento) é zero
    const semMovimento = !geraEmprestimo && valorLiquidoCents <= 0 &&
      (!parcelaFixaAtiva || parcelaFixaValorCentavos === 0 || !confirmarParcelaFixa);

    if (!semMovimento) {
      if (usarSplitContas) {
        if (contasSplit.length === 0) {
          setModalRealizar({ ...modalRealizar, error: "Adicione ao menos uma conta no split" });
          return;
        }
        if (contasSplit.some(s => !s.contaId)) {
          setModalRealizar({ ...modalRealizar, error: "Selecione a conta em todas as linhas do split" });
          return;
        }
        const splitTotal = contasSplit.reduce((s, c) => s + c.valorCentavos, 0);
        const cashEsperado = valorLiquidoCents;
        if (splitTotal !== cashEsperado) {
          setModalRealizar({ ...modalRealizar, error: `Soma das contas (${money(splitTotal / 100)}) deve ser igual ao valor a transferir (${money(cashEsperado / 100)})` });
          return;
        }
      } else if (!contaIdRepasse) {
        setModalRealizar({ ...modalRealizar, error: "Selecione a conta do repasse" });
        return;
      }

      // Validar data ISO apenas quando há movimento financeiro
      if (!dataRepasseISO || !/^\d{4}-\d{2}-\d{2}$/.test(dataRepasseISO)) {
        setModalRealizar({ ...modalRealizar, error: "Data inválida" });
        return;
      }
    }

    // Converter data ISO para DD/MM/AAAA para o backend (só quando há movimento)
    let dataRepasseDDMMYYYY = undefined;
    if (dataRepasseISO) {
      const [year, month, day] = dataRepasseISO.split("-");
      dataRepasseDDMMYYYY = `${day}/${month}/${year}`;
    }

    console.log('💳 Validação de valores:', {
      previsto: Number(modalRealizar.valorPrevisto),
      efetivado: valorEfetivadoCents / 100,
      saldo: Number(modalRealizar.saldoDisponivel),
      diferenca: (valorEfetivadoCents / 100) - Number(modalRealizar.valorPrevisto),
    });

    try {
      setModalRealizar({ ...modalRealizar, loading: true, error: "" });

      await apiFetch("/repasses/realizar", {
        method: "POST",
        body: JSON.stringify({
          advogadoId,
          ano,
          mes,
          valorEfetivado: String(valorEfetivadoCents),
          dataRepasse: dataRepasseDDMMYYYY,
          observacoes,
          contaIdRepasse: usarSplitContas ? "" : contaIdRepasse,
          contaIdParcelaFixa: contaIdParcelaFixa || undefined,
          contasSplit: usarSplitContas ? contasSplit.map(s => ({ contaId: s.contaId, valorCentavos: s.valorCentavos })) : undefined,
          confirmarParcelaFixa: !!confirmarParcelaFixa,
          adiantamentosAbater: adiantamentosAbater.length > 0 ? adiantamentosAbater : undefined,
          enviarPixAposRealizar: !!modalRealizar.enviarPixAposRealizar,
        }),
      });

      addToast("Repasse realizado com sucesso!", "success");
      fecharModal();
      await load();
    } catch (error) {
      console.error("Erro ao realizar repasse:", error);
      setModalRealizar({
        ...modalRealizar,
        loading: false,
        error: error?.message || "Erro ao realizar repasse",
      });
    }
  }

  const rows = Array.isArray(data?.items) ? data.items : [];

  return (
    <div style={{ padding: 16 }}>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          danger={confirmState.danger}
          onConfirm={async () => {
            setConfirmState(null);
            if (pendingConfirmRef.current) {
              await pendingConfirmRef.current();
              pendingConfirmRef.current = null;
            }
          }}
          onCancel={() => { setConfirmState(null); pendingConfirmRef.current = null; }}
        />
      )}
      <div style={card}>
        <div style={header}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            Repasses — A Realizar
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ opacity: 0.8, fontSize: 13 }}>Competência:</span>
            <span style={pill}>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={pillSelect}>
                {monthOptions().map((m) => (
                  <option key={m.v} value={m.v}>{m.t}</option>
                ))}
              </select>
              <input
                type="number"
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                style={pillYear}
              />
            </span>
          </div>
        </div>

        {err && <div style={errBox}>{err}</div>}

        {data?.aliquota?.avisoAliquota && (
          <div style={warningBox}>ℹ️ {data.aliquota.avisoAliquota}</div>
        )}

        {data?.periodo?.descricao && (
          <div style={infoBox}>📅 {data.periodo.descricao}</div>
        )}

        <div style={{ padding: "0 12px 12px" }}>
          {loading ? <div>Carregando…</div> : null}

          {!loading && (
            <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={th}>Advogado</th>
                    <th style={th}>OAB</th>
                    <th style={thNum}>
                      <Tooltip content="Valor total do repasse baseado nas parcelas recebidas">
                        Valor Total
                      </Tooltip>
                    </th>
                    <th style={thNum}>
                      <Tooltip content="Parcela fixa mensal do advogado">
                        Parcela Fixa
                      </Tooltip>
                    </th>
                    <th style={th}>
                      <Tooltip content="Quantidade de parcelas que compõem este repasse">
                        Parcelas
                      </Tooltip>
                    </th>
                    {isAdmin && (
                      <th style={th}>
                        <Tooltip content="Ações disponíveis para este repasse">
                          Ações
                        </Tooltip>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.advogadoId}>
                      <td style={td}>
                        <Tooltip content="Clique para ver detalhes dos lançamentos">
                          <button
                            style={btnLink}
                            onClick={() => abrirModalLancamentos(r.advogadoId, r.advogadoNome)}
                          >
                            {r.advogadoNome}
                          </button>
                        </Tooltip>
                        {r.ehSocio && (
                          <span style={{ marginLeft: 6, fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#dbeafe", color: "#1e40af", fontWeight: 600 }}>Sócio</span>
                        )}
                      </td>
                      <td style={td}>{r.advogadoOab || "—"}</td>
                      <td style={tdNum}>
                        <Tooltip content="Clique para ver detalhes dos lançamentos">
                          <button
                            style={btnLinkValue}
                            onClick={() => abrirModalLancamentos(r.advogadoId, r.advogadoNome)}
                          >
                            {money(r.valorTotal)}
                          </button>
                        </Tooltip>
                      </td>
                      <td style={tdNum}>
                        {r.parcelaFixaAtiva
                          ? money(r.parcelaFixaValorCentavos / 100)
                          : "—"}
                      </td>
                      <td style={td}>{r.quantidadeParcelas}</td>
                      {isAdmin && (
                        <td style={td}>
                          <Tooltip content="Clique para realizar este repasse">
                            <button style={btnAction} onClick={() => abrirModalRealizar(r)}>
                              💰 Realizar
                            </button>
                          </Tooltip>
                        </td>
                      )}
                    </tr>
                  ))}

                  {!rows.length && (
                    <tr>
                      <td style={{ ...td, padding: 14, opacity: 0.8 }} colSpan={6}>
                        Nenhum repasse a realizar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* MODAL LANÇAMENTOS */}
      {modalLancamentos.open && (
        <div style={backdrop} onMouseDown={() => {
          if (modalLancamentos.hasChanged) load();
          setModalLancamentos({ ...modalLancamentos, open: false, hasChanged: false });
        }}>
          <div style={modalSmall} onMouseDown={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                Lançamentos — {modalLancamentos.advogadoNome}
              </div>
              <button style={closeBtn} onClick={() => {
                if (modalLancamentos.hasChanged) load();
                setModalLancamentos({ ...modalLancamentos, open: false, hasChanged: false });
              }}>✕</button>
            </div>

            <div style={modalBody}>
              {modalLancamentos.loading ? (
                <div>Carregando…</div>
              ) : (
                <div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={thSmall}>Contrato</th>
                        <th style={thSmall}>Cliente</th>
                        <th style={thSmallNum}>Líquido</th>
                        <th style={thSmallNum}>%</th>
                        <th style={thSmallNum}>Repasse</th>
                        {isAdmin && <th style={thSmall}>Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {modalLancamentos.lancamentos.map((l, idx) => {
                        const isEditing = editingRepasse.idx === idx;
                        const hasOverride = l.valorRepasseOverrideCentavos !== null && l.valorRepasseOverrideCentavos !== undefined;
                        const strikeTd = { ...tdSmallNum, ...(l.excluirDoRepasse ? { textDecoration: "line-through" } : {}) };
                        return (
                          <tr key={idx} style={l.excluirDoRepasse ? { opacity: 0.5, background: "#f9fafb" } : {}}>
                            <td style={tdSmall}>
                              <span style={l.excluirDoRepasse ? { textDecoration: "line-through" } : {}}>
                                {l.numeroContrato}
                              </span>
                              {l.excluirDoRepasse && (
                                <span style={{ marginLeft: 6, fontSize: 10, background: "#e5e7eb", color: "#6b7280", borderRadius: 4, padding: "1px 5px", fontWeight: 600, whiteSpace: "nowrap" }}>
                                  excluído do repasse
                                </span>
                              )}
                            </td>
                            <td style={{ ...tdSmall, ...(l.excluirDoRepasse ? { textDecoration: "line-through" } : {}) }}>{l.clienteNome}</td>
                            <td style={strikeTd}>{money(l.liquido)}</td>
                            <td style={strikeTd}>{(Number(l.percentualBp || 0) / 100).toFixed(2)}%</td>
                            <td style={{ ...tdSmallNum, whiteSpace: "nowrap" }}>
                              {isEditing ? (
                                <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                                  <input
                                    autoFocus
                                    type="text"
                                    inputMode="numeric"
                                    style={{ width: 90, fontSize: 12, padding: "1px 4px", border: "1px solid #6366f1", borderRadius: 3 }}
                                    value={editingRepasse.inputValue}
                                    onChange={(e) => setEditingRepasse((p) => ({ ...p, inputValue: maskCurrency(e.target.value) }))}
                                    onKeyDown={async (e) => {
                                      if (e.key === "Escape") setEditingRepasse({ idx: null, inputValue: "" });
                                      if (e.key === "Enter") {
                                        const cents = parseInt(editingRepasse.inputValue.replace(/\D/g, ""), 10) || 0;
                                        if (!cents) return;
                                        try {
                                          const res = await apiFetch(`/parcelas/${l.parcelaId}/repasse-override`, { method: "PUT", body: JSON.stringify({ advogadoId: modalLancamentos.advogadoId, valorCentavos: cents }) });
                                          setModalLancamentos((prev) => ({ ...prev, lancamentos: prev.lancamentos.map((x, i) => i === idx ? { ...x, valorRepasse: (cents / 100).toFixed(2), valorRepasseOverrideCentavos: cents } : x), hasChanged: true }));
                                          setEditingRepasse({ idx: null, inputValue: "" });
                                        } catch { addToast("Erro ao salvar override", "error"); }
                                      }
                                    }}
                                  />
                                  <button title="Salvar" style={{ fontSize: 11, padding: "1px 5px", borderRadius: 3, border: "1px solid #6366f1", background: "#6366f1", color: "#fff", cursor: "pointer" }}
                                    onClick={async () => {
                                      const cents = parseInt(editingRepasse.inputValue.replace(/\D/g, ""), 10) || 0;
                                      if (!cents) return;
                                      try {
                                        await apiFetch(`/parcelas/${l.parcelaId}/repasse-override`, { method: "PUT", body: JSON.stringify({ advogadoId: modalLancamentos.advogadoId, valorCentavos: cents }) });
                                        setModalLancamentos((prev) => ({ ...prev, lancamentos: prev.lancamentos.map((x, i) => i === idx ? { ...x, valorRepasse: (cents / 100).toFixed(2), valorRepasseOverrideCentavos: cents } : x), hasChanged: true }));
                                        setEditingRepasse({ idx: null, inputValue: "" });
                                      } catch { addToast("Erro ao salvar override", "error"); }
                                    }}>✓</button>
                                  <button title="Cancelar" style={{ fontSize: 11, padding: "1px 5px", borderRadius: 3, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}
                                    onClick={() => setEditingRepasse({ idx: null, inputValue: "" })}>✕</button>
                                </span>
                              ) : (
                                <span style={{ display: "inline-flex", gap: 4, alignItems: "center", ...(l.excluirDoRepasse ? { textDecoration: "line-through" } : {}) }}>
                                  <span style={hasOverride ? { color: "#6366f1", fontWeight: 700 } : {}}>{money(l.valorRepasse)}</span>
                                  {hasOverride && (
                                    <span title={`Calculado: ${money(l.valorRepasseCalculado)}`} style={{ fontSize: 10, color: "#6b7280", cursor: "default" }}>({money(l.valorRepasseCalculado)})</span>
                                  )}
                                  {isAdmin && !l.excluirDoRepasse && (
                                    <button title="Editar valor de repasse" style={{ fontSize: 10, padding: "0 4px", borderRadius: 3, border: "1px solid #d1d5db", background: "transparent", cursor: "pointer", color: "#6b7280", lineHeight: 1.4 }}
                                      onClick={() => setEditingRepasse({ idx, inputValue: maskCurrency(String(Math.round((Number(l.valorRepasse) || 0) * 100))) })}>✎</button>
                                  )}
                                  {isAdmin && hasOverride && (
                                    <button title="Restaurar valor calculado" style={{ fontSize: 10, padding: "0 4px", borderRadius: 3, border: "1px solid #fca5a5", background: "transparent", cursor: "pointer", color: "#ef4444", lineHeight: 1.4 }}
                                      onClick={async () => {
                                        try {
                                          await apiFetch(`/parcelas/${l.parcelaId}/repasse-override/${modalLancamentos.advogadoId}`, { method: "DELETE" });
                                          setModalLancamentos((prev) => ({ ...prev, lancamentos: prev.lancamentos.map((x, i) => i === idx ? { ...x, valorRepasse: x.valorRepasseCalculado, valorRepasseOverrideCentavos: null } : x), hasChanged: true }));
                                        } catch { addToast("Erro ao restaurar valor", "error"); }
                                      }}>↺</button>
                                  )}
                                </span>
                              )}
                            </td>
                            {isAdmin && (
                              <td style={tdSmall}>
                                <button
                                  title={l.excluirDoRepasse ? "Incluir no repasse" : "Excluir do repasse"}
                                  style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, border: "1px solid #d1d5db", background: l.excluirDoRepasse ? "#f3f4f6" : "#fff", color: l.excluirDoRepasse ? "#6b7280" : "#374151", cursor: "pointer", whiteSpace: "nowrap" }}
                                  onClick={async () => {
                                    try {
                                      const res = await apiFetch(`/parcelas/${l.parcelaId}/excluir-do-repasse`, { method: "PATCH" });
                                      setModalLancamentos((prev) => ({
                                        ...prev,
                                        lancamentos: prev.lancamentos.map((x, i) => i === idx ? { ...x, excluirDoRepasse: res.excluirDoRepasse } : x),
                                        hasChanged: true,
                                      }));
                                    } catch {
                                      addToast("Erro ao atualizar parcela", "error");
                                    }
                                  }}
                                >
                                  {l.excluirDoRepasse ? "Incluir" : "Excluir"}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Seção de adiantamentos */}
                {isAdmin && (
                  <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#374151" }}>Adiantamentos nesta competência</span>
                      {!adtForm.open && (
                        <button
                          style={{ fontSize: 12, padding: "3px 10px", borderRadius: 5, border: "1px solid #6366f1", background: "#ede9fe", color: "#4f46e5", cursor: "pointer", fontWeight: 600 }}
                          onClick={abrirFormAdiantamento}
                        >+ Registrar Adiantamento</button>
                      )}
                    </div>

                    {/* Lista de adiantamentos existentes */}
                    {modalLancamentos.adiantamentos.length > 0 && (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 8 }}>
                        <thead>
                          <tr style={{ background: "#f5f3ff" }}>
                            <th style={{ ...thSmall, color: "#4f46e5" }}>Cliente</th>
                            <th style={{ ...thSmallNum, color: "#4f46e5" }}>Prev.</th>
                            <th style={{ ...thSmallNum, color: "#4f46e5" }}>Adiantado</th>
                            <th style={{ ...thSmallNum, color: "#4f46e5" }}>Devolvido</th>
                            <th style={{ ...thSmall, color: "#4f46e5" }}>Status</th>
                            <th style={{ ...thSmall, color: "#4f46e5" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {modalLancamentos.adiantamentos.map(a => {
                            const saldo = Math.max(0, a.valorAdiantadoCentavos - a.valorDevolvidoCentavos);
                            const isEditingThis = editingAdt?.id === a.id;
                            if (isEditingThis) {
                              return (
                                <tr key={a.id} style={{ background: "#f5f3ff" }}>
                                  <td style={tdSmall} colSpan={6}>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 1fr auto", gap: 6, alignItems: "center" }}>
                                      <select
                                        value={editingAdt.clienteId}
                                        onChange={e => setEditingAdt(p => ({ ...p, clienteId: e.target.value }))}
                                        style={{ fontSize: 12, padding: "3px 5px", border: "1px solid #c4b5fd", borderRadius: 4 }}
                                      >
                                        <option value="">Cliente...</option>
                                        {clientes.map(c => <option key={c.id} value={c.id}>{c.nomeRazaoSocial}</option>)}
                                      </select>
                                      <input type="text" inputMode="numeric" placeholder="Prev." value={editingAdt.valorPrevisto}
                                        onChange={e => setEditingAdt(p => ({ ...p, valorPrevisto: maskCurrency(e.target.value) }))}
                                        style={{ fontSize: 12, padding: "3px 5px", border: "1px solid #c4b5fd", borderRadius: 4 }} />
                                      <input type="text" inputMode="numeric" placeholder="Adiantado" value={editingAdt.valorAdiantado}
                                        onChange={e => setEditingAdt(p => ({ ...p, valorAdiantado: maskCurrency(e.target.value) }))}
                                        style={{ fontSize: 12, padding: "3px 5px", border: "1px solid #c4b5fd", borderRadius: 4 }} />
                                      <input type="text" placeholder="Obs." value={editingAdt.obs}
                                        onChange={e => setEditingAdt(p => ({ ...p, obs: e.target.value }))}
                                        style={{ fontSize: 12, padding: "3px 5px", border: "1px solid #c4b5fd", borderRadius: 4 }} />
                                      <span style={{ display: "inline-flex", gap: 4 }}>
                                        <button onClick={salvarEdicaoAdt} disabled={editingAdt.saving}
                                          style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "none", background: "#6366f1", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                                          {editingAdt.saving ? "…" : "✓"}
                                        </button>
                                        <button onClick={() => setEditingAdt(null)}
                                          style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}>✕</button>
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }
                            return (
                              <tr key={a.id}>
                                <td style={tdSmall}>{a.clienteNome}</td>
                                <td style={tdSmallNum}>{a.valorPrevistoCentavos > 0 ? money(a.valorPrevistoCentavos / 100) : "—"}</td>
                                <td style={{ ...tdSmallNum, fontWeight: 700, color: "#4f46e5" }}>{money(a.valorAdiantadoCentavos / 100)}</td>
                                <td style={tdSmallNum}>{a.valorDevolvidoCentavos > 0 ? money(a.valorDevolvidoCentavos / 100) : "—"}</td>
                                <td style={tdSmall}>
                                  {a.quitado
                                    ? <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 10, background: "#d1fae5", color: "#065f46", fontWeight: 600 }}>Quitado</span>
                                    : saldo > 0
                                      ? <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>Pendente</span>
                                      : null}
                                </td>
                                <td style={{ ...tdSmall, whiteSpace: "nowrap" }}>
                                  <button title="Editar" onClick={() => abrirEdicaoAdt(a)}
                                    style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, border: "1px solid #d1d5db", background: "transparent", cursor: "pointer", marginRight: 3 }}>✎</button>
                                  <button title="Excluir" onClick={() => excluirAdt(a.id)}
                                    style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, border: "1px solid #fca5a5", background: "transparent", cursor: "pointer", color: "#ef4444" }}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {modalLancamentos.adiantamentos.length === 0 && !adtForm.open && (
                      <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Nenhum adiantamento nesta competência.</p>
                    )}

                    {/* Formulário novo adiantamento */}
                    {adtForm.open && (
                      <div style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 8, padding: 12, marginTop: 4 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "#4f46e5", display: "block", marginBottom: 2 }}>Cliente</label>
                            <select
                              value={adtForm.clienteId}
                              onChange={e => setAdtForm(f => ({ ...f, clienteId: e.target.value }))}
                              style={{ width: "100%", fontSize: 12, padding: "4px 6px", border: "1px solid #c4b5fd", borderRadius: 5 }}
                            >
                              <option value="">Selecione o cliente...</option>
                              {clientes.map(c => <option key={c.id} value={c.id}>{c.nomeRazaoSocial}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "#4f46e5", display: "block", marginBottom: 2 }}>Valor previsto (R$)</label>
                            <input
                              type="text" inputMode="numeric" placeholder="0,00"
                              value={adtForm.valorPrevisto}
                              onChange={e => setAdtForm(f => ({ ...f, valorPrevisto: maskCurrency(e.target.value) }))}
                              style={{ width: "100%", fontSize: 12, padding: "4px 6px", border: "1px solid #c4b5fd", borderRadius: 5, boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "#4f46e5", display: "block", marginBottom: 2 }}>Valor adiantado (R$)</label>
                            <input
                              type="text" inputMode="numeric" placeholder="0,00"
                              value={adtForm.valorAdiantado}
                              onChange={e => setAdtForm(f => ({ ...f, valorAdiantado: maskCurrency(e.target.value) }))}
                              style={{ width: "100%", fontSize: 12, padding: "4px 6px", border: "1px solid #c4b5fd", borderRadius: 5, boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "#4f46e5", display: "block", marginBottom: 2 }}>Observações</label>
                            <input
                              type="text" placeholder="Opcional"
                              value={adtForm.obs}
                              onChange={e => setAdtForm(f => ({ ...f, obs: e.target.value }))}
                              style={{ width: "100%", fontSize: 12, padding: "4px 6px", border: "1px solid #c4b5fd", borderRadius: 5, boxSizing: "border-box" }}
                            />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={salvarAdiantamento}
                            disabled={adtForm.saving}
                            style={{ fontSize: 12, padding: "4px 14px", borderRadius: 5, border: "none", background: "#6366f1", color: "#fff", fontWeight: 700, cursor: "pointer", opacity: adtForm.saving ? 0.6 : 1 }}
                          >{adtForm.saving ? "Salvando…" : "Salvar"}</button>
                          <button
                            onClick={() => setAdtForm(f => ({ ...f, open: false }))}
                            style={{ fontSize: 12, padding: "4px 12px", borderRadius: 5, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}
                          >Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                </div>
              )}
            </div>

            <div style={modalFooter}>
              <button style={btnSecondary} onClick={() => {
                if (modalLancamentos.hasChanged) load();
                setModalLancamentos({ ...modalLancamentos, open: false, hasChanged: false });
              }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REALIZAR REPASSE */}
      {modalRealizar.open && (
        <div style={backdrop} onMouseDown={fecharModal}>
          <div style={modal} onMouseDown={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                Realizar Repasse — {modalRealizar.advogadoNome}
              </div>
              <button style={closeBtn} onClick={fecharModal}>✕</button>
            </div>

            <div style={modalBody}>
              {modalRealizar.error && (
                <div style={{ ...errBox, marginBottom: 16 }}>{modalRealizar.error}</div>
              )}

              {/* INFO CARD */}
              {(() => {
                const abatTotal = modalRealizar.usarAbatimento
                  ? modalRealizar.abatimentoModo === "selecionar"
                    ? modalRealizar.abatimentoItens.filter(i => i.checked).reduce((s, i) => s + i.valorAbaterCentavos, 0)
                    : modalRealizar.abatimentoValorCents
                  : 0;
                const cashTransferir = modalRealizar.valorEfetivadoCents - abatTotal;
                return (
                  <div style={infoCard}>
                    <div style={infoRow}>
                      <span style={infoLabel}>Repasse — {modalRealizar.percentualReal}% do líquido:</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: "#10b981" }}>
                        {money(Number(modalRealizar.valorPrevisto))}
                      </span>
                    </div>
                    <div style={infoRow}>
                      <span style={infoLabel}>Saldo Acumulado:</span>
                      <span style={infoValue}>{money(Number(modalRealizar.saldoDisponivel))}</span>
                    </div>
                    <div style={infoRow}>
                      <span style={infoLabel}>Máximo Permitido:</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#0369a1" }}>
                        {money(Number(modalRealizar.valorPrevisto) + Number(modalRealizar.saldoDisponivel))}
                      </span>
                    </div>
                    {abatTotal > 0 && (
                      <>
                        <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "6px 0" }} />
                        <div style={infoRow}>
                          <span style={infoLabel}>Abatimento selecionado:</span>
                          <span style={{ fontWeight: 600, color: "#7c3aed" }}>− {money(abatTotal / 100)}</span>
                        </div>
                        <div style={infoRow}>
                          <span style={infoLabel}>Valor a transferir (cash):</span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: cashTransferir >= 0 ? "#0369a1" : "#ef4444" }}>
                            {money(Math.max(cashTransferir, 0) / 100)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ABATIMENTO DE ADIANTAMENTOS — só renderiza se houver adiantamentos (ou ainda carregando) */}
              {(modalRealizar.loadingAdiantamentos || modalRealizar.adiantamentosPendentes.length > 0) && (() => {
                const totalAbat = modalRealizar.usarAbatimento
                  ? modalRealizar.abatimentoModo === "selecionar"
                    ? modalRealizar.abatimentoItens.filter(i => i.checked).reduce((s, i) => s + i.valorAbaterCentavos, 0)
                    : modalRealizar.abatimentoValorCents
                  : 0;
                const temAdiantamentos = modalRealizar.adiantamentosPendentes.length > 0;
                return (
                  <div style={{ border: "1px solid #e0e7ff", borderRadius: 8, padding: 14, background: "#f5f3ff" }}>
                    <style>{`@keyframes _amrPing{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:0.5}} ._amrPing{animation:_amrPing 1.1s ease-in-out infinite}`}</style>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: modalRealizar.loading || !temAdiantamentos ? "default" : "pointer", fontSize: 13, fontWeight: 600, color: "#4c1d95" }}>
                      <input
                        type="checkbox"
                        checked={modalRealizar.usarAbatimento}
                        disabled={modalRealizar.loading || !temAdiantamentos}
                        onChange={(e) => {
                          setModalRealizar(prev => ({ ...prev, usarAbatimento: e.target.checked, abatimentoItens: prev.abatimentoItens.map(i => ({ ...i, checked: false })), abatimentoValorCents: 0, abatimentoValorDisplay: "" }));
                        }}
                        style={{ width: 16, height: 16 }}
                      />
                      Abater adiantamentos
                      {temAdiantamentos && !modalRealizar.usarAbatimento && (
                        <span className="_amrPing" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", marginLeft: 2 }} title={`${modalRealizar.adiantamentosPendentes.length} adiantamento(s) pendente(s)`} />
                      )}
                      {modalRealizar.loadingAdiantamentos && (
                        <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400 }}>carregando...</span>
                      )}
                    </label>

                    {modalRealizar.usarAbatimento && temAdiantamentos && (
                      <div style={{ marginTop: 12 }}>
                        {modalRealizar.loadingAdiantamentos ? (
                          <div style={{ fontSize: 12, color: "#6b7280" }}>Carregando...</div>
                        ) : (
                          <>
                            {/* Toggle modo */}
                            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                              {["selecionar", "valor"].map(modo => (
                                <button
                                  key={modo}
                                  onClick={() => setModalRealizar(prev => ({ ...prev, abatimentoModo: modo, abatimentoItens: prev.abatimentoItens.map(i => ({ ...i, checked: false })), abatimentoValorCents: 0, abatimentoValorDisplay: "" }))}
                                  disabled={modalRealizar.loading}
                                  style={{ fontSize: 12, padding: "3px 12px", borderRadius: 20, border: "1px solid #7c3aed", background: modalRealizar.abatimentoModo === modo ? "#7c3aed" : "#fff", color: modalRealizar.abatimentoModo === modo ? "#fff" : "#7c3aed", cursor: "pointer" }}
                                >
                                  {modo === "selecionar" ? "Selecionar" : "Por valor (FIFO)"}
                                </button>
                              ))}
                            </div>

                            {modalRealizar.abatimentoModo === "selecionar" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {modalRealizar.abatimentoItens.map((item, idx) => (
                                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", borderRadius: 6, padding: "6px 10px", border: "1px solid #ddd6fe" }}>
                                    <input
                                      type="checkbox"
                                      checked={item.checked}
                                      disabled={modalRealizar.loading}
                                      onChange={(e) => {
                                        const arr = [...modalRealizar.abatimentoItens];
                                        arr[idx] = { ...arr[idx], checked: e.target.checked };
                                        setModalRealizar(prev => ({ ...prev, abatimentoItens: arr }));
                                      }}
                                      style={{ width: 14, height: 14 }}
                                    />
                                    <div style={{ flex: 1, fontSize: 12 }}>
                                      <div style={{ fontWeight: 600 }}>{item.clienteNome}</div>
                                      <div style={{ color: "#6b7280" }}>{String(item.competenciaMes).padStart(2,"0")}/{item.competenciaAno} — saldo: {money(item.saldoCentavos / 100)}</div>
                                    </div>
                                    {item.checked && (
                                      <input
                                        type="text"
                                        value={item.valorAbaterDisplay}
                                        disabled={modalRealizar.loading}
                                        onChange={(e) => {
                                          const digits = e.target.value.replace(/\D/g, "");
                                          const cents = Math.min(Number(digits) || 0, item.saldoCentavos);
                                          const arr = [...modalRealizar.abatimentoItens];
                                          arr[idx] = { ...arr[idx], valorAbaterCentavos: cents, valorAbaterDisplay: digits ? formatCentsToBRL(cents) : "" };
                                          setModalRealizar(prev => ({ ...prev, abatimentoItens: arr }));
                                        }}
                                        placeholder="0,00"
                                        style={{ width: 90, padding: "4px 8px", borderRadius: 4, border: "1px solid #c4b5fd", fontSize: 12, textAlign: "right" }}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div>
                                <div style={{ fontSize: 12, color: "#4c1d95", marginBottom: 6 }}>
                                  Total disponível: {money(modalRealizar.adiantamentosPendentes.reduce((s, a) => s + a.saldoCentavos, 0) / 100)} — distribuído do mais antigo para o mais recente
                                </div>
                                <input
                                  type="text"
                                  value={modalRealizar.abatimentoValorDisplay}
                                  disabled={modalRealizar.loading}
                                  onChange={(e) => {
                                    const digits = e.target.value.replace(/\D/g, "");
                                    const maxCents = modalRealizar.adiantamentosPendentes.reduce((s, a) => s + a.saldoCentavos, 0);
                                    const cents = Math.min(Number(digits) || 0, maxCents);
                                    setModalRealizar(prev => ({ ...prev, abatimentoValorCents: cents, abatimentoValorDisplay: digits ? formatCentsToBRL(cents) : "" }));
                                  }}
                                  placeholder="0,00"
                                  style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #c4b5fd", fontSize: 13, width: 140 }}
                                />
                              </div>
                            )}

                            {totalAbat > 0 && (
                              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: "#5b21b6", background: "#ede9fe", padding: "6px 10px", borderRadius: 6 }}>
                                Abatimento total: {money(totalAbat / 100)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* PARCELA FIXA */}
              {modalRealizar.parcelaFixaAtiva && modalRealizar.parcelaFixaValorCentavos > 0 && (
                <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                        {modalRealizar.parcelaFixaNome || "Parcela Fixa Mensal"}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#78350f", marginTop: 4 }}>
                        {money(modalRealizar.parcelaFixaValorCentavos / 100)}
                      </div>
                    </div>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={modalRealizar.confirmarParcelaFixa}
                      onChange={(e) => setModalRealizar({ ...modalRealizar, confirmarParcelaFixa: e.target.checked })}
                      disabled={modalRealizar.loading}
                      style={{ width: 16, height: 16 }}
                    />
                    Confirmar Parcela Fixa
                  </label>

                  {!modalRealizar.confirmarParcelaFixa && modalRealizar.ehSocio && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#1e40af", background: "#dbeafe", padding: "6px 10px", borderRadius: 6 }}>
                      Será registrado como empréstimo do sócio para despesas
                    </div>
                  )}
                  {!modalRealizar.confirmarParcelaFixa && !modalRealizar.ehSocio && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#065f46", background: "#d1fae5", padding: "6px 10px", borderRadius: 6 }}>
                      Valor será adicionado ao saldo do advogado
                    </div>
                  )}
                </div>
              )}

              {/* FORM */}
              {(() => {
                const geraEmprestimo = modalRealizar.ehSocio && modalRealizar.parcelaFixaAtiva && modalRealizar.parcelaFixaValorCentavos > 0 && !modalRealizar.confirmarParcelaFixa && modalRealizar.valorEfetivadoCents > 0;
                const totalAbatRender = modalRealizar.usarAbatimento
                  ? modalRealizar.abatimentoModo === "selecionar"
                    ? modalRealizar.abatimentoItens.filter(i => i.checked).reduce((s, i) => s + i.valorAbaterCentavos, 0)
                    : modalRealizar.abatimentoValorCents
                  : 0;
                const valorLiquidoRender = modalRealizar.valorEfetivadoCents - totalAbatRender;
                const semMovimento = !geraEmprestimo && valorLiquidoRender <= 0 &&
                  (!modalRealizar.parcelaFixaAtiva || modalRealizar.parcelaFixaValorCentavos === 0 || !modalRealizar.confirmarParcelaFixa);
              return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <Tooltip content="Valor que será efetivamente transferido ao advogado">
                    <label style={label}>Valor Efetivado (R$)</label>
                  </Tooltip>
                  <input
                    type="text"
                    value={modalRealizar.valorEfetivadoDisplay}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "");
                      const cents = Number(digits) || 0;
                      setModalRealizar({
                        ...modalRealizar,
                        valorEfetivadoCents: cents,
                        valorEfetivadoDisplay: digits ? formatCentsToBRL(cents) : "",
                      });
                    }}
                    placeholder="0,00"
                    style={input}
                    disabled={modalRealizar.loading}
                  />
                  <div style={{ fontSize: 12, marginTop: 4, color: "#64748b" }}>
                    Digite apenas números: 123456 = R$ 1.234,56
                  </div>
                </div>

                {!semMovimento && (
                  <div>
                    <Tooltip content="Data em que o repasse foi ou será realizado">
                      <label style={label}>Data do Repasse</label>
                    </Tooltip>
                    <input
                      type="date"
                      value={modalRealizar.dataRepasseISO}
                      onChange={(e) => setModalRealizar({ ...modalRealizar, dataRepasseISO: e.target.value })}
                      style={input}
                      disabled={modalRealizar.loading}
                    />
                  </div>
                )}

                {!semMovimento && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* CONTA DO REPASSE ou SPLIT */}
                    {!modalRealizar.usarSplitContas ? (
                      <div>
                        <Tooltip content="Conta bancária de onde sairá o valor">
                          <label style={label}>Conta do Repasse *</label>
                        </Tooltip>
                        <select
                          value={modalRealizar.contaIdRepasse}
                          onChange={(e) => setModalRealizar({ ...modalRealizar, contaIdRepasse: e.target.value })}
                          style={input}
                          disabled={modalRealizar.loading}
                        >
                          <option value="">Selecione a conta</option>
                          {contas.map((c) => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label style={label}>Distribuição entre contas *</label>
                        {(() => {
                          const contasUsadas = new Set(modalRealizar.contasSplit.map(s => String(s.contaId)).filter(Boolean));
                          const splitTotal = modalRealizar.contasSplit.reduce((s, c) => s + c.valorCentavos, 0);
                          const somaCompleta = splitTotal === modalRealizar.valorEfetivadoCents;
                          return (
                            <>
                              {modalRealizar.contasSplit.map((sp, si) => (
                                <div key={si} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                                  <select
                                    value={sp.contaId}
                                    onChange={(e) => {
                                      const arr = [...modalRealizar.contasSplit];
                                      arr[si] = { ...arr[si], contaId: e.target.value };
                                      setModalRealizar({ ...modalRealizar, contasSplit: arr });
                                    }}
                                    style={{ ...input, flex: 1, marginBottom: 0 }}
                                    disabled={modalRealizar.loading}
                                  >
                                    <option value="">Conta</option>
                                    {contas
                                      .filter(c => String(c.id) === String(sp.contaId) || !contasUsadas.has(String(c.id)))
                                      .map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                  </select>
                                  <input
                                    type="text"
                                    value={sp.valorDisplay}
                                    onChange={(e) => {
                                      const digits = e.target.value.replace(/\D/g, "");
                                      const cents = Number(digits) || 0;
                                      const arr = [...modalRealizar.contasSplit];
                                      arr[si] = { ...arr[si], valorCentavos: cents, valorDisplay: digits ? formatCentsToBRL(cents) : "" };
                                      setModalRealizar({ ...modalRealizar, contasSplit: arr });
                                    }}
                                    placeholder="0,00"
                                    style={{ ...input, width: 100, marginBottom: 0 }}
                                    disabled={modalRealizar.loading}
                                  />
                                  {modalRealizar.contasSplit.length > 1 && (
                                    <button
                                      style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", color: "#ef4444", cursor: "pointer", fontSize: 14 }}
                                      onClick={() => {
                                        const arr = modalRealizar.contasSplit.filter((_, i) => i !== si);
                                        setModalRealizar({ ...modalRealizar, contasSplit: arr });
                                      }}
                                    >×</button>
                                  )}
                                </div>
                              ))}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                                <button
                                  disabled={somaCompleta || modalRealizar.loading || contasUsadas.size >= contas.length}
                                  style={{ fontSize: 12, padding: "3px 10px", borderRadius: 4, border: "1px solid #6366f1", background: somaCompleta ? "#f3f4f6" : "#f5f3ff", color: somaCompleta ? "#9ca3af" : "#6366f1", cursor: somaCompleta ? "not-allowed" : "pointer" }}
                                  onClick={() => setModalRealizar({ ...modalRealizar, contasSplit: [...modalRealizar.contasSplit, { contaId: "", valorCentavos: 0, valorDisplay: "" }] })}
                                >+ Conta</button>
                                <span style={{ fontSize: 12, color: somaCompleta ? "#10b981" : "#ef4444" }}>
                                  {money(splitTotal / 100)} de {money(modalRealizar.valorEfetivadoCents / 100)}
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* TOGGLE SPLIT */}
                    {modalRealizar.valorEfetivadoCents > 0 && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "#374151" }}>
                        <input
                          type="checkbox"
                          checked={modalRealizar.usarSplitContas}
                          disabled={modalRealizar.loading}
                          onChange={(e) => {
                            const usar = e.target.checked;
                            const primeiraContaId = modalRealizar.contaIdRepasse || "";
                            setModalRealizar({
                              ...modalRealizar,
                              usarSplitContas: usar,
                              contasSplit: usar
                                ? [{ contaId: primeiraContaId, valorCentavos: modalRealizar.valorEfetivadoCents, valorDisplay: formatCentsToBRL(modalRealizar.valorEfetivadoCents) }]
                                : [],
                            });
                          }}
                        />
                        Dividir pagamento entre contas
                      </label>
                    )}

                    {/* CONTA DA PARCELA FIXA */}
                    {modalRealizar.parcelaFixaAtiva && modalRealizar.parcelaFixaValorCentavos > 0 && modalRealizar.confirmarParcelaFixa && (
                      <div>
                        <label style={label}>Conta da Parcela Fixa</label>
                        <select
                          value={modalRealizar.contaIdParcelaFixa}
                          onChange={(e) => setModalRealizar({ ...modalRealizar, contaIdParcelaFixa: e.target.value })}
                          style={input}
                          disabled={modalRealizar.loading}
                        >
                          <option value="">Mesma conta do repasse</option>
                          {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Tooltip content="Observações opcionais sobre este repasse">
                    <label style={label}>Observações</label>
                  </Tooltip>
                  <textarea
                    value={modalRealizar.observacoes}
                    onChange={(e) => setModalRealizar({ ...modalRealizar, observacoes: e.target.value })}
                    style={{ ...input, minHeight: 80, resize: "vertical" }}
                    disabled={modalRealizar.loading}
                  />
                </div>

                {/* ── PAINEL PIX ── */}
                {(() => {
                  const contaSelecionada = contas.find(c => String(c.id) === String(modalRealizar.contaIdRepasse));
                  const contaEhInter = !!(contaSelecionada?.interContaId);
                  const temChavePix  = !!(modalRealizar.chavePix);
                  if (!contaEhInter || !temChavePix) return null;
                  return (
                    <div style={{ border: "1px solid #bfdbfe", borderRadius: 8, padding: 14, background: "#eff6ff" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#1e40af" }}>💸 Envio via Pix</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={!!modalRealizar.enviarPixAposRealizar}
                            onChange={e => setModalRealizar(m => ({ ...m, enviarPixAposRealizar: e.target.checked }))}
                            disabled={modalRealizar.loading}
                          />
                          Enviar Pix automaticamente
                        </label>
                      </div>
                      {modalRealizar.enviarPixAposRealizar && (
                        <div style={{ fontSize: 12, color: "#1e40af" }}>
                          <div>Chave: <strong>{modalRealizar.chavePix}</strong></div>
                          <div>Conta: <strong>{contaSelecionada?.nome}</strong></div>
                        </div>
                      )}
                      {!modalRealizar.enviarPixAposRealizar && (
                        <p style={{ margin: 0, fontSize: 12, color: "#3b82f6" }}>
                          Desmarque para realizar sem Pix agora.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
              );})()}
            </div>

            <div style={modalFooter}>
              <button style={btnSecondary} onClick={fecharModal} disabled={modalRealizar.loading}>
                Cancelar
              </button>
              <Tooltip content={modalRealizar.loading ? "Processando..." : "Confirmar e realizar o repasse"}>
                <button style={btnPrimary} onClick={confirmarRepasse} disabled={modalRealizar.loading}>
                  {modalRealizar.loading ? "Realizando..." : "✓ Confirmar Repasse"}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// STYLES
const card = { border: "1px solid #ddd", borderRadius: 8, background: "#fff" };
const header = { padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const errBox = { margin: "0 12px 12px", padding: 10, background: "#fee", border: "1px solid #f99", borderRadius: 8 };
const warningBox = { margin: "0 12px 12px", padding: 10, background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, fontSize: 13 };
const infoBox = { margin: "0 12px 12px", padding: 10, background: "#e0e7ff", border: "1px solid #6366f1", borderRadius: 8, fontSize: 13, color: "#3730a3" };

const th = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #ddd", fontSize: 12, fontWeight: 600 };
const thNum = { ...th, textAlign: "right" };
const td = { padding: "10px 8px", borderBottom: "1px solid #eee", fontSize: 13 };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const thSmall = { textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 600 };
const thSmallNum = { ...thSmall, textAlign: "right" };
const tdSmall = { padding: "8px 6px", borderBottom: "1px solid #f3f4f6", fontSize: 12 };
const tdSmallNum = { ...tdSmall, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const pill = { display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#f8fafc", fontSize: 12, fontWeight: 600 };
const pillSelect = { border: "none", background: "transparent" };
const pillYear = { width: 84, border: "none", background: "transparent", fontWeight: 600 };

const btnLink = { border: "none", background: "transparent", padding: 0, color: "#0369a1", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontSize: 13 };
const btnLinkValue = { ...btnLink, fontVariantNumeric: "tabular-nums" };
const btnAction = { padding: "6px 12px", borderRadius: 6, border: "1px solid #10b981", background: "#d1fae5", color: "#065f46", fontSize: 13, fontWeight: 600, cursor: "pointer" };

const backdrop = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 9999 };
const modal = { width: "min(600px, 100%)", background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "90vh" };
const modalSmall = { width: "min(700px, 100%)", background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "80vh" };
const modalHeader = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottom: "1px solid #e5e7eb", background: "#f8fafc" };
const modalBody = { padding: 20, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 };
const modalFooter = { padding: 20, borderTop: "1px solid #e5e7eb", background: "#f8fafc", display: "flex", gap: 12, justifyContent: "flex-end" };
const closeBtn = { border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b" };

const infoCard = { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const infoRow = { display: "flex", alignItems: "center", justifyContent: "space-between" };
const infoLabel = { fontSize: 13, opacity: 0.8, fontWeight: 600 };
const infoValue = { fontSize: 14, fontWeight: 600 };

const label = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const input = { width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontFamily: "inherit" };

const btnSecondary = { padding: "10px 20px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#0f172a", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnPrimary = { padding: "10px 20px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };