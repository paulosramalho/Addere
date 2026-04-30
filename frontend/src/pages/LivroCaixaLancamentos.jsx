import React, { useEffect, useMemo, useRef, useState } from "react";
import LancamentosTable from "./LancamentosTable.jsx";
import DefinirContaModal from "../components/livroCaixa/DefinirContaModal.jsx";
import PagarBoletoModal from "../components/livroCaixa/PagarBoletoModal.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { apiFetch, getUser } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";

/* ---------- inline new-client form ---------- */
function NovoClienteInline({ onCreated, onCancel, addToast }) {
  const [nome, setNome] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [tipo, setTipo] = useState("C");
  const [saving, setSaving] = useState(false);

  async function handleCriar() {
    if (!nome.trim()) { addToast("Informe o nome.", "warning"); return; }
    if (!cpfCnpj.trim()) { addToast("Informe CPF/CNPJ.", "warning"); return; }
    setSaving(true);
    try {
      const result = await apiFetch("/clients", {
        method: "POST",
        body: { nomeRazaoSocial: nome.trim(), cpfCnpj: cpfCnpj.trim(), tipo },
      });
      addToast(`${nome.trim()} criado com sucesso.`, "success");
      onCreated(result.nomeRazaoSocial || nome.trim());
    } catch (err) {
      addToast("Erro ao criar: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const boxStyle = {
    marginTop: 6, padding: "10px 12px", background: "#f8fafc",
    border: "1px solid #cbd5e1", borderRadius: 8, display: "flex",
    flexDirection: "column", gap: 8,
  };
  const rowStyle = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
  const inputS = { padding: "4px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, flex: 1, minWidth: 120 };

  return (
    <div style={boxStyle}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Novo cliente/fornecedor</div>
      <div style={rowStyle}>
        <input style={{ ...inputS, flex: 2 }} placeholder="Nome / Razão Social *"
          value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        <input style={inputS} placeholder="CPF/CNPJ *"
          value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} />
        <select style={{ ...inputS, flex: "none", width: 110 }} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="C">Cliente</option>
          <option value="F">Fornecedor</option>
          <option value="A">Ambos</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" disabled={saving} onClick={onCancel}
          style={{ padding: "4px 12px", cursor: "pointer", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}>
          Cancelar
        </button>
        <button type="button" disabled={saving} onClick={handleCriar}
          style={{ padding: "4px 12px", cursor: "pointer", background: "#1e293b", color: "#fff", border: "none", borderRadius: 6, fontSize: 13 }}>
          {saving ? "Criando…" : "Criar e selecionar"}
        </button>
      </div>
    </div>
  );
}

export default function LivroCaixaLancamentos() {
  const { addToast } = useToast();
  const _u = useMemo(() => getUser(), []);
  const isAdmin = String(_u?.role || _u?.perfil || _u?.tipo || "").toUpperCase().trim() === "ADMIN";
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [contas, setContas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [advogados, setAdvogados] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [pendencias, setPendencias] = useState([]);

  const [loading, setLoading] = useState(false);

  const [modalContaOpen, setModalContaOpen] = useState(false);
  const [modalContaLancId, setModalContaLancId] = useState(null);

  const [novoOpen, setNovoOpen] = useState(false);
  const [boletoOpen, setBoletoOpen] = useState(false);
  const [confirmState, setConfirmState] = useState(null); // { message, title, onConfirm }
  const pendingConfirmRef = useRef(null);
  const [novo, setNovo] = useState({
    dataISO: "",
    es: "",
    valorMasked: "",
    documento: "",
    clienteFornecedor: "",
    advogadoId: "",
    historico: "",
    contaId: "",
    clienteContaId: "",
    contaOrigemId: "",
    contaDestinoId: "",
    confirmarAgora: false,
  });
  const [customCliente, setCustomCliente] = useState("");

  const [novoErr, setNovoErr] = useState("");

  // Estado para edição
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState(null);
  const [editErr, setEditErr] = useState("");

  // ── Criar AV vinculado a LC existente ──
  const [criarAvLc, setCriarAvLc] = useState(null); // lancamento selecionado
  const [criarAvAdv, setCriarAvAdv] = useState("");
  const [criarAvDescricao, setCriarAvDescricao] = useState("");
  const [criarAvLoading, setCriarAvLoading] = useState(false);
  const [criarAvErr, setCriarAvErr] = useState("");

  function openCriarAV(l) {
    setCriarAvLc(l);
    setCriarAvAdv("");
    setCriarAvDescricao(l.historico || "");
    setCriarAvErr("");
    setCriarAvLoading(false);
  }

  async function handleCriarAV() {
    if (!criarAvLc) return;
    setCriarAvErr("");
    if (!criarAvLc.contaId) { setCriarAvErr("Lançamento sem conta definida. Defina a conta antes de criar o AV."); return; }
    if (!criarAvLc.clienteFornecedor) { setCriarAvErr("Lançamento sem cliente/fornecedor. Edite o lançamento e defina o cliente primeiro."); return; }

    // busca clienteId pelo nome
    const clienteMatch = clientes.find(c => (c.nomeRazaoSocial || c.nome) === criarAvLc.clienteFornecedor);
    if (!clienteMatch) { setCriarAvErr(`Cliente "${criarAvLc.clienteFornecedor}" não encontrado. Verifique o cadastro.`); return; }

    // formata data DD/MM/AAAA a partir do lançamento
    const dataLc = criarAvLc.data
      ? (() => { const d = new Date(criarAvLc.data); const pad = n => String(n).padStart(2,"0"); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`; })()
      : null;
    if (!dataLc) { setCriarAvErr("Data do lançamento inválida."); return; }

    // formata valor
    const valorBRL = `R$ ${(criarAvLc.valorCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

    setCriarAvLoading(true);
    try {
      const resp = await apiFetch("/pagamentos-avulsos", {
        method: "POST",
        body: {
          clienteId: clienteMatch.id,
          contaId: criarAvLc.contaId,
          descricao: criarAvDescricao || null,
          dataRecebimento: dataLc,
          valorRecebido: valorBRL,
          meioRecebimento: "PIX",
          advogadoPrincipalId: criarAvAdv || null,
          lcExistenteId: criarAvLc.id,
        },
      });
      setCriarAvLc(null);
      addToast(`AV criado: ${resp.numeroContrato}`, "success");
      await loadAll();
    } catch (e) {
      setCriarAvErr(e?.message || "Falha ao criar AV.");
    } finally {
      setCriarAvLoading(false);
    }
  }

  // ── Filtros de busca ──
  const [fEs, setFEs] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fHistorico, setFHistorico] = useState("");
  const [fValorMin, setFValorMin] = useState("");
  const [fValorMax, setFValorMax] = useState("");
  const [fContaId, setFContaId] = useState("");
  const [fStatusFluxo, setFStatusFluxo] = useState("");

  const syncedOnceRef = useRef(false);

  const competenciaLabel = useMemo(() => {
    const mm = String(mes).padStart(2, "0");
    return `${mm}/${ano}`;
  }, [ano, mes]);

  const contasNoMes = useMemo(() => {
    const ids = new Set(lancamentos.filter(l => !l._virtualSaldo && l.contaId).map(l => l.contaId));
    return contas.filter(c => ids.has(c.id));
  }, [lancamentos, contas]);

  const hasFilter = !!(fEs || fCliente || fHistorico || fValorMin || fValorMax || fContaId || fStatusFluxo);

  const filteredLancamentos = useMemo(() => {
    if (!hasFilter) return lancamentos;
    return lancamentos.filter((l) => {
      if (l._virtualSaldo) return true;
      if (fEs && l.es !== fEs) return false;
      if (fCliente && !String(l.clienteFornecedor || "").toLowerCase().includes(fCliente.toLowerCase())) return false;
      if (fHistorico && !String(l.historico || "").toLowerCase().includes(fHistorico.toLowerCase())) return false;
      if (fValorMin) { const min = centavosFromMasked(fValorMin); if (l.valorCentavos < min) return false; }
      if (fValorMax) { const max = centavosFromMasked(fValorMax); if (l.valorCentavos > max) return false; }
      if (fContaId && String(l.contaId) !== fContaId) return false;
      if (fStatusFluxo && l.statusFluxo !== fStatusFluxo) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lancamentos, fEs, fCliente, fHistorico, fValorMin, fValorMax, fContaId, fStatusFluxo]);

  function clearFilters() {
    setFEs(""); setFCliente(""); setFHistorico("");
    setFValorMin(""); setFValorMax(""); setFContaId(""); setFStatusFluxo("");
  }

  function normalizeContas(resp) {
    if (Array.isArray(resp)) return resp;
    if (resp && Array.isArray(resp.contas)) return resp.contas;
    return [];
  }

  function isClienteContaElegivel(cliente) {
    const tipo = String(cliente?.tipo || "").trim().toUpperCase();
    return tipo === "C" || tipo === "A" || tipo === "CLIENTE" || tipo === "CLIENTES" || tipo === "";
  }

  async function loadContasOnly() {
    const c1 = await apiFetch("/livro-caixa/contas");
    setContas(normalizeContas(c1));
  }

  async function loadClientes() {
    try {
      const data = await apiFetch("/clients?tipo=A,F");
      setClientes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Erro ao carregar clientes:", e);
    }
  }

  async function loadAll() {
    setLoading(true);
    if (!ano || ano < 2000 || !mes || mes < 1 || mes > 12) {
      addToast("Ano/Mês inválidos.", "error");
      setLoading(false);
      return;
    }

    try {
      const [c1, l1, p1, cli, adv] = await Promise.all([
        apiFetch("/livro-caixa/contas"),
        apiFetch(`/livro-caixa/lancamentos?ano=${ano}&mes=${mes}`),
        apiFetch(`/livro-caixa/pendencias?ano=${ano}&mes=${mes}`),
        apiFetch("/clients"),
        apiFetch("/advogados"),
      ]);

      setContas(normalizeContas(c1));
      setClientes(Array.isArray(cli) ? cli : []);
      setAdvogados(Array.isArray(adv) ? adv : []);

      const base = l1.lancamentos || [];
      const saldoCent = Number(l1.saldoAnteriorCentavos || 0);
      const prevAno = Number(l1.saldoAnteriorAno || ano);
      const prevMes = Number(l1.saldoAnteriorMes || (mes === 1 ? 12 : mes - 1));

      // ✅ Linha virtual do saldo anterior
      const saldoRow = {
        id: `SALDO_${ano}_${mes}`,
        competenciaAno: ano,
        competenciaMes: mes,
        data: new Date(ano, mes - 1, 1, 0, 0, 0),
        documento: "",
        es: "",
        clienteFornecedor: "",
        historico: `Saldo ${String(prevMes).padStart(2, "0")}/${prevAno}`,
        valorCentavos: saldoCent,
        contaId: null,
        conta: null,
        ordemDia: -999,
        origem: "MANUAL",
        status: "OK",
        statusFluxo: "EFETIVADO",
        _virtualSaldo: true,
      };

      // ✅ Adiciona saldo + lançamentos
      setLancamentos([saldoRow, ...base]);
      setPendencias(p1.pendencias || []);
    } catch (e) {
      addToast(e?.message || "Erro ao carregar lançamentos", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  useEffect(() => {
    if (syncedOnceRef.current) return;
    syncedOnceRef.current = true;
    sincronizarPrevistas({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDefinirConta(lancamentoId) {
    setModalContaLancId(lancamentoId);
    setModalContaOpen(true);
  }

  async function onSalvarConta({ lancamentoId, contaId }) {
    try {
      await apiFetch(`/livro-caixa/lancamentos/${lancamentoId}/definir-conta`, {
        method: "PATCH",
        body: { contaId },
      });
      addToast("Conta definida com sucesso!", "success");
      setModalContaOpen(false);
      setModalContaLancId(null);
      await loadAll();
    } catch (e) {
      addToast(e?.message || "Erro ao definir conta", "error");
    }
  }

  async function simularRepasse() {
    try {
      const dataBR = isoToBR(novo.dataISO) || new Date().toLocaleDateString("pt-BR");
      await apiFetch("/livro-caixa/teste/simular-repasse", {
        method: "POST",
        body: {
          competenciaAno: ano,
          competenciaMes: mes,
          dataBR,
          valorCentavos: 123456,
          historico: "Repasse (teste) ⚠ precisa informar conta",
        },
      });
      addToast("Repasse simulado com sucesso!", "success");
      await loadAll();
    } catch (e) {
      addToast(e?.message || "Erro ao simular repasse", "error");
    }
  }

  async function sincronizarPagamentos() {
    setLoading(true);
    try {
      const result = await apiFetch(
        `/livro-caixa/sincronizar-pagamentos?ano=${ano}&mes=${mes}`,
        { method: "POST" }
      );

      addToast(
        `✅ Sincronização de RECEBIDOS concluída! Criados: ${result.criados}, Já existentes: ${result.jaExistentes}`,
        "success"
      );

      await loadAll();
    } catch (e) {
      addToast(e?.message || "Erro ao sincronizar recebidos", "error");
    } finally {
      setLoading(false);
    }
  }

  async function sincronizarPrevistas({ silent = false } = {}) {
    setLoading(true);
    try {
      const result = await apiFetch(
        `/livro-caixa/sincronizar-previstas?ano=${ano}&mes=${mes}`,
        { method: "POST" }
      );

      if (!silent) {
        addToast(
          `✅ Sincronização de PREVISTAS concluída! Criados: ${result.criados}, Já existentes: ${result.jaExistentes}`,
          "success"
        );
      }

      await loadAll();
    } catch (e) {
      if (!silent) {
        addToast(e?.message || "Erro ao sincronizar previstas", "error");
      }
    } finally {
      setLoading(false);
    }
  }

  const resetNovo = () => {
    setNovo({
      dataISO: "", es: "", valorMasked: "", documento: "",
      clienteFornecedor: "", advogadoId: "", historico: "",
      contaId: "", clienteContaId: "", contaOrigemId: "", contaDestinoId: "",
      confirmarAgora: false,
    });
    setCustomCliente("");
  };

  async function criarLancamentoManual() {
    setNovoErr("");
    try {
      const dataBR = isoToBR(novo.dataISO);
      if (!dataBR) throw new Error("Informe a data.");

      if (!["E", "S", "T"].includes(novo.es)) throw new Error("Selecione E/S.");

      const valorCentavos = centavosFromMasked(novo.valorMasked);
      if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error("Informe um valor válido.");

      // ── Transferência entre contas ──
      if (novo.es === "T") {
        const origemRaw  = novo.contaOrigemId;
        const destinoRaw = novo.contaDestinoId;
        if (!origemRaw)  throw new Error("Selecione a Conta Origem.");
        if (!destinoRaw) throw new Error("Selecione a Conta Destino.");
        if (origemRaw === destinoRaw) throw new Error("Conta Origem e Destino devem ser diferentes.");

        const isClienteOrigem  = String(origemRaw).startsWith("c:");
        const isClienteDestino = String(destinoRaw).startsWith("c:");
        const contaOrigemId    = isClienteOrigem  ? null : Number(origemRaw);
        const clienteOrigemId  = isClienteOrigem  ? Number(origemRaw.slice(2)) : null;
        const contaDestinoId   = isClienteDestino ? null : Number(destinoRaw);
        const clienteDestinoId = isClienteDestino ? Number(destinoRaw.slice(2)) : null;

        const clientesFiltrados = clientes.filter(isClienteContaElegivel);
        const nomeOrigem  = isClienteOrigem
          ? clientesFiltrados.find((c) => c.id === clienteOrigemId)?.nomeRazaoSocial || ""
          : contas.find((c) => c.id === contaOrigemId)?.nome || "";
        const nomeDestino = isClienteDestino
          ? clientesFiltrados.find((c) => c.id === clienteDestinoId)?.nomeRazaoSocial || ""
          : contas.find((c) => c.id === contaDestinoId)?.nome || "";

        // Nome do cliente NUNCA aparece em transferências — substituir por "Clientes"
        const cfSaida   = isClienteDestino ? "Clientes" : nomeDestino;
        const cfEntrada = isClienteOrigem  ? "Clientes" : nomeOrigem;

        const [tAno, tMes] = novo.dataISO ? novo.dataISO.split("-").map(Number) : [ano, mes];
        await apiFetch("/livro-caixa/transferencia", {
          method: "POST",
          body: {
            competenciaAno: tAno,
            competenciaMes: tMes,
            dataBR,
            valorCentavos,
            contaOrigemId,
            clienteOrigemId,
            contaDestinoId,
            clienteDestinoId,
            documento: novo.documento || null,
            historico: novo.historico || "Transferência entre contas",
            clienteFornecedorSaida: cfSaida,
            clienteFornecedorEntrada: cfEntrada,
            confirmarAgora: true,
          },
        });

        addToast("Transferência criada com sucesso!", "success");
        setNovoOpen(false);
        resetNovo();
        await loadAll();
        return;
      }

      // ── Lançamento normal (E/S) ──
      const clienteContaIdNum = Number(novo.clienteContaId) || 0;
      const contaIdNum = Number(novo.contaId) || 0;

      // Conta obrigatória apenas quando confirmando agora
      if (novo.confirmarAgora && !clienteContaIdNum && !contaIdNum) throw new Error("Selecione a conta/local para confirmar o lançamento.");

      const advogadoNome =
        novo.advogadoId
          ? (advogados.find((a) => String(a.id) === String(novo.advogadoId))?.nome || "")
          : "";

      const clienteFornecedorFinal =
        advogadoNome ||
        (novo.clienteFornecedor === "__INCLUIR__" ? customCliente.trim() || null : novo.clienteFornecedor || null);

      // Competência sempre derivada da data do lançamento, não da página
      const [compAno, compMes] = novo.dataISO
        ? novo.dataISO.split("-").map(Number)
        : [ano, mes];

      const payload = {
        competenciaAno: compAno,
        competenciaMes: compMes,
        dataBR,
        es: novo.es,
        valorCentavos,
        documento: novo.documento || null,
        clienteFornecedor: clienteFornecedorFinal,
        historico: novo.historico,
        contaId: contaIdNum || null,
        clienteContaId: clienteContaIdNum || null,
        confirmarAgora: !!novo.confirmarAgora,
      };

      // Confirmação explícita quando lançando como EFETIVADO
      if (novo.confirmarAgora) {
        const contaNomeSel = novo.clienteContaId
          ? (contas.find(c => String(c.id) === String(novo.clienteContaId))?.nome || "Conta de cliente")
          : (contas.find(c => String(c.id) === String(novo.contaId))?.nome || "conta selecionada");
        pendingConfirmRef.current = async () => {
          try {
            await apiFetch("/livro-caixa/lancamentos", { method: "POST", body: payload });
            addToast("Lançamento criado com sucesso!", "success");
            setNovoOpen(false);
            resetNovo();
            await loadAll();
          } catch (e) {
            setNovoErr(e?.message || String(e));
          }
        };
        setConfirmState({
          title: "Confirmar lançamento",
          message: `Lançar como EFETIVADO na conta:\n"${contaNomeSel}"\n\nEsta ação não pode ser facilmente desfeita.`,
        });
        return;
      }

      await apiFetch("/livro-caixa/lancamentos", { method: "POST", body: payload });
      addToast("Lançamento criado com sucesso!", "success");
      setNovoOpen(false);
      resetNovo();
      await loadAll();
    } catch (e) {
      setNovoErr(e?.message || String(e));
    }
  }

  function isoToBR(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return "";
    return `${d}/${m}/${y}`;
  }

  function maskBRLFromDigits(digitsOnly) {
    const digits = String(digitsOnly || "").replace(/\D/g, "");
    if (!digits) return "";
    const n = Number(digits);
    const cents = Number.isFinite(n) ? n : 0;
    const value = cents / 100;
    return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function centavosFromMasked(masked) {
    const digits = String(masked || "").replace(/\D/g, "");
    if (!digits) return 0;
    const n = Number(digits);
    return Number.isFinite(n) ? n : 0;
  }

  function dateToISO(d) {
    if (!d) return "";
    // Append T12:00:00 to avoid timezone shift issues
    const str = String(d).includes("T") ? d : `${d}T12:00:00`;
    const dt = new Date(str);
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }

  function openExcluirModal(lancamento) {
    pendingConfirmRef.current = async () => {
      try {
        await apiFetch(`/livro-caixa/lancamentos/${lancamento.id}`, { method: "DELETE" });
        addToast("Lançamento excluído.", "success");
        loadAll();
      } catch (e) {
        addToast(e.message || "Erro ao excluir.", "error");
      }
    };
    setConfirmState({
      title: "Excluir lançamento",
      message: `Excluir o lançamento "${lancamento.historico || lancamento.clienteFornecedor || "#" + lancamento.id}"? Esta ação não pode ser desfeita.`,
    });
  }

  function openEditModal(lancamento) {
    const cf = lancamento.clienteFornecedor || "";
    const advMatch = advogados.find((a) => String(a.nome || "").trim() === String(cf).trim());
    setEditData({
      id: lancamento.id,
      dataISO: dateToISO(lancamento.data),
      es: lancamento.es || "",
      valorMasked: maskBRLFromDigits(lancamento.valorCentavos),
      documento: lancamento.documento || "",
      clienteFornecedor: advMatch ? "" : (lancamento.clienteFornecedor || ""),
      advogadoId: advMatch ? String(advMatch.id) : "",
      historico: lancamento.historico || "",
      contaId: lancamento.contaId ? String(lancamento.contaId) : "",
      clienteContaId: lancamento.clienteContaId ? String(lancamento.clienteContaId) : "",
    });
    setEditErr("");
    setEditOpen(true);
  }

  async function salvarEdicao() {
    setEditErr("");
    try {
      const dataBR = isoToBR(editData.dataISO);
      if (!dataBR) throw new Error("Informe a data.");

      if (editData.es !== "E" && editData.es !== "S") throw new Error("Selecione E/S.");

      const valorCentavos = centavosFromMasked(editData.valorMasked);
      if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error("Informe um valor válido.");

      const advogadoNome =
        editData.advogadoId
          ? (advogados.find((a) => String(a.id) === String(editData.advogadoId))?.nome || "")
          : "";
      const clienteFornecedorFinal = String(advogadoNome || editData.clienteFornecedor || "").trim() || null;

      await apiFetch(`/livro-caixa/lancamentos/${editData.id}`, {
        method: "PUT",
        body: {
          dataBR,
          es: editData.es,
          valorCentavos,
          documento: editData.documento || null,
          clienteFornecedor: clienteFornecedorFinal,
          historico: editData.historico,
          contaId: editData.clienteContaId ? null : (editData.contaId ? Number(editData.contaId) : null),
          clienteContaId: editData.clienteContaId ? Number(editData.clienteContaId) : null,
        },
      });

      addToast("Lançamento atualizado com sucesso!", "success");
      setEditOpen(false);
      setEditData(null);
      await loadAll();
    } catch (e) {
      setEditErr(e?.message || String(e));
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Livro Caixa — Lançamentos</h2>

      {/* Filtro por competência */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, marginBottom: 16 }}>
        <Tooltip content="Selecione o ano para visualizar os lançamentos">
          <label>
            <strong>Ano:</strong>
            <input
              type="number"
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              style={{ marginLeft: 8, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 8, width: 100 }}
            />
          </label>
        </Tooltip>

        <Tooltip content="Selecione o mês para visualizar os lançamentos">
          <label>
            <strong>Mês:</strong>
            <input
              type="number"
              min={1}
              max={12}
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              style={{ marginLeft: 8, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 8, width: 80 }}
            />
          </label>
        </Tooltip>

        <span style={{ marginLeft: 8, fontWeight: 700, fontSize: 14 }}>({competenciaLabel})</span>
      </div>

      {/* Botões de ação */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <Tooltip content="Criar um novo lançamento manual no livro caixa">
          <button
            onClick={() => setNovoOpen(true)}
            style={{
              ...ui.btnPrimary,
              background: "#10b981",
              color: "#fff",
              border: "1px solid #059669",
            }}
          >
            ➕ Novo lançamento
          </button>
        </Tooltip>

        <Tooltip content="Registrar lançamento via boleto (Entrada ou Saída prevista)">
          <button
            onClick={() => setBoletoOpen(true)}
            style={{
              ...ui.btnSecondary,
              background: "#eff6ff",
              border: "1px solid #93c5fd",
              color: "#1d4ed8",
            }}
          >
            🔖 Registrar via Arquivo
          </button>
        </Tooltip>

        <Tooltip content="Recarregar todos os lançamentos">
          <button onClick={loadAll} style={ui.btnSecondary}>
            🔄 Recarregar
          </button>
        </Tooltip>
      </div>

      <div style={{ marginBottom: 10 }}>
        <strong>Pendências:</strong> {pendencias.length} (precisa definir conta)
      </div>

      {/* ── Barra de filtros ── */}
      <div style={filterBar.wrap}>
        <div style={filterBar.group}>
          <span style={filterBar.label}>E/S</span>
          <select value={fEs} onChange={e => setFEs(e.target.value)} style={{ ...filterBar.input, minWidth: 120 }}>
            <option value="">Todos</option>
            <option value="E">Entrada</option>
            <option value="S">Saída</option>
            <option value="T">Transferência</option>
          </select>
        </div>
        <div style={filterBar.group}>
          <span style={filterBar.label}>Cliente/Fornecedor</span>
          <input value={fCliente} onChange={e => setFCliente(e.target.value)} placeholder="Buscar…" style={{ ...filterBar.input, minWidth: 160 }} />
        </div>
        <div style={filterBar.group}>
          <span style={filterBar.label}>Histórico</span>
          <input value={fHistorico} onChange={e => setFHistorico(e.target.value)} placeholder="Buscar…" style={{ ...filterBar.input, minWidth: 160 }} />
        </div>
        <div style={filterBar.group}>
          <span style={filterBar.label}>Valor mín.</span>
          <input inputMode="numeric" value={fValorMin}
            onChange={e => { const d = e.target.value.replace(/\D/g, ""); setFValorMin(d ? maskBRLFromDigits(d) : ""); }}
            placeholder="0,00" style={{ ...filterBar.input, width: 110 }} />
        </div>
        <div style={filterBar.group}>
          <span style={filterBar.label}>Valor máx.</span>
          <input inputMode="numeric" value={fValorMax}
            onChange={e => { const d = e.target.value.replace(/\D/g, ""); setFValorMax(d ? maskBRLFromDigits(d) : ""); }}
            placeholder="0,00" style={{ ...filterBar.input, width: 110 }} />
        </div>
        <div style={filterBar.group}>
          <span style={filterBar.label}>Local</span>
          <select value={fContaId} onChange={e => setFContaId(e.target.value)} style={{ ...filterBar.input, minWidth: 140 }}>
            <option value="">Todos</option>
            {contasNoMes.map(c => <option key={c.id} value={String(c.id)}>{c.nome}</option>)}
          </select>
        </div>
        <div style={filterBar.group}>
          <span style={filterBar.label}>Status</span>
          <select value={fStatusFluxo} onChange={e => setFStatusFluxo(e.target.value)} style={{ ...filterBar.input, minWidth: 130 }}>
            <option value="">Todos</option>
            <option value="EFETIVADO">Efetivado</option>
            <option value="PREVISTO">Previsto</option>
          </select>
        </div>
        {hasFilter && (
          <button onClick={clearFilters} style={filterBar.btnClear}>✕ Limpar</button>
        )}
      </div>
      {hasFilter && (
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
          {filteredLancamentos.filter(l => !l._virtualSaldo).length} de {lancamentos.filter(l => !l._virtualSaldo).length} lançamento(s)
        </div>
      )}

      {loading ? <div>Carregando…</div> : null}

      <LancamentosTable lancamentos={filteredLancamentos} onDefinirConta={openDefinirConta} onRefresh={loadAll} onEditar={openEditModal} onExcluir={openExcluirModal} isAdmin={isAdmin} onCriarAV={openCriarAV} contas={contas} />

      <DefinirContaModal
        open={modalContaOpen}
        lancamentoId={modalContaLancId}
        contas={contas}
        onClose={() => setModalContaOpen(false)}
        onSave={onSalvarConta}
      />

      {/* Modal: Confirmação genérica */}
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel="Confirmar"
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

      {/* Modal: Registrar via Boleto */}
      {boletoOpen && (
        <PagarBoletoModal
          contas={contas}
          competenciaAno={ano}
          competenciaMes={mes}
          onClose={() => setBoletoOpen(false)}
          onSaved={() => { setBoletoOpen(false); loadAll(); }}
        />
      )}

      {/* Modal: Criar AV vinculado a LC */}
      {criarAvLc && (
        <div style={styles.backdrop}>
          <div style={{ ...styles.modal, maxWidth: 480 }}>
            <h3 style={{ margin: "0 0 4px" }}>Criar contrato AV vinculado</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>
              O lançamento existente será atualizado — nenhuma entrada duplicada será criada.
            </p>

            {criarAvErr && (
              <div style={ui.modalError}><strong>Erro:</strong> {criarAvErr}</div>
            )}

            <div style={styles.form}>
              <div style={styles.row}>
                <label style={styles.field}>
                  <span style={styles.label}>Cliente/Fornecedor</span>
                  <input style={{ ...styles.input, background: "#f1f5f9" }} value={criarAvLc.clienteFornecedor || "—"} disabled readOnly />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>Data</span>
                  <input style={{ ...styles.input, background: "#f1f5f9" }} value={criarAvLc.data ? new Date(criarAvLc.data).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—"} disabled readOnly />
                </label>
              </div>
              <div style={styles.row}>
                <label style={styles.field}>
                  <span style={styles.label}>Valor</span>
                  <input style={{ ...styles.input, background: "#f1f5f9" }} value={`R$ ${((criarAvLc.valorCentavos || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} disabled readOnly />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>Conta</span>
                  <input style={{ ...styles.input, background: "#f1f5f9" }} value={contas.find(c => c.id === criarAvLc.contaId)?.nome || criarAvLc.contaId || "—"} disabled readOnly />
                </label>
              </div>
              <label style={styles.field}>
                <span style={styles.label}>Advogado responsável (opcional)</span>
                <select
                  value={criarAvAdv}
                  onChange={e => setCriarAvAdv(e.target.value)}
                  style={styles.input}
                  disabled={criarAvLoading}
                >
                  <option value="">— Sem advogado / sem modelo de distribuição —</option>
                  {advogados.map(a => (
                    <option key={a.id} value={a.id}>{a.nome}</option>
                  ))}
                </select>
              </label>
              <label style={styles.field}>
                <span style={styles.label}>Descrição / Histórico</span>
                <input
                  style={styles.input}
                  value={criarAvDescricao}
                  onChange={e => setCriarAvDescricao(e.target.value)}
                  placeholder="Ex.: Honorários advocatícios"
                  disabled={criarAvLoading}
                />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                style={ui.btnSecondary}
                onClick={() => setCriarAvLc(null)}
                disabled={criarAvLoading}
              >
                Cancelar
              </button>
              <button
                style={{ ...ui.btnPrimary, background: "#d97706", borderColor: "#d97706" }}
                onClick={handleCriarAV}
                disabled={criarAvLoading}
              >
                {criarAvLoading ? "Criando..." : "Criar AV"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo lançamento */}
      {novoOpen ? (
        <div style={styles.backdrop}>
          <div style={styles.modal}>
            <h3>Novo lançamento</h3>

            {novoErr ? (
              <div style={ui.modalError}>
                <strong>Erro:</strong> {novoErr}
              </div>
            ) : null}

            <div style={styles.form}>
              <div style={styles.row}>
                <Tooltip content="Selecione a data do lançamento">
                  <label style={styles.field}>
                    <span style={styles.label}>Data</span>
                    <input
                      type="date"
                      value={novo.dataISO}
                      onChange={(e) => setNovo((s) => ({ ...s, dataISO: e.target.value }))}
                      style={styles.input}
                    />
                  </label>
                </Tooltip>

                <Tooltip content="Tipo: Entrada (E), Saída (S) ou Transferência entre contas (T)">
                  <label style={styles.field}>
                    <span style={styles.label}>E/S</span>
                    <select
                      value={novo.es}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNovo((s) => ({
                          ...s,
                          es: val,
                          historico: val === "T" ? "Transferência entre contas" : (s.historico === "Transferência entre contas" ? "" : s.historico),
                        }));
                      }}
                      style={styles.input}
                    >
                      <option value="">Selecione...</option>
                      <option value="E">Entrada</option>
                      <option value="S">Saída</option>
                      <option value="T">Transferência entre contas</option>
                    </select>
                  </label>
                </Tooltip>

                <Tooltip content="Digite o valor do lançamento em reais">
                  <label style={styles.field}>
                    <span style={styles.label}>Valor</span>
                    <input
                      inputMode="numeric"
                      value={novo.valorMasked}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setNovo((s) => ({ ...s, valorMasked: maskBRLFromDigits(digits) }));
                      }}
                      placeholder="0,00"
                      style={styles.input}
                    />
                  </label>
                </Tooltip>
              </div>

              {novo.es !== "T" && (
              <div style={styles.row}>
                <Tooltip content="Número do documento fiscal (NFS-e, NF, CF, Recibo)">
                  <label style={styles.field}>
                    <span style={styles.label}>NFS-e/NF/CF/RC</span>
                    <input
                      value={novo.documento}
                      onChange={(e) => setNovo((s) => ({ ...s, documento: e.target.value }))}
                      style={styles.input}
                    />
                  </label>
                </Tooltip>

                <Tooltip content="Selecione o cliente ou fornecedor relacionado ao lançamento">
                  <label style={styles.field}>
                    <span style={styles.label}>Cliente/Fornecedor</span>
                    <select
                      value={novo.clienteFornecedor}
                      disabled={!!novo.advogadoId}
                      onChange={(e) =>
                        setNovo((s) => ({
                          ...s,
                          clienteFornecedor: e.target.value,
                          advogadoId: "",
                        }))
                      }
                      style={styles.input}
                    >
                      <option value="">Selecione...</option>
                      <option value="__INCLUIR__">+ Incluir novo...</option>
                      {clientes.map((c) => (
                        <option key={c.id} value={c.nomeRazaoSocial || c.nome}>
                          {c.nomeRazaoSocial || c.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                </Tooltip>
                {/* Inline form to create a new client when "Incluir" is selected */}
                {novo.clienteFornecedor === "__INCLUIR__" && (
                  <NovoClienteInline
                    onCreated={(nome) => {
                      setClientes((prev) => [...prev, { id: Date.now(), nomeRazaoSocial: nome }]);
                      setNovo((s) => ({ ...s, clienteFornecedor: nome }));
                    }}
                    onCancel={() => setNovo((s) => ({ ...s, clienteFornecedor: "" }))}
                    addToast={addToast}
                  />
                )}

              <Tooltip content="Selecione um advogado relacionado ao lançamento (opcional)">
                  <label style={styles.field}>
                    <span style={styles.label}>Advogado</span>
                    <select
                      value={novo.advogadoId}
                      disabled={!!novo.clienteFornecedor}
                      onChange={(e) =>
                        setNovo((s) => ({
                          ...s,
                          advogadoId: e.target.value,
                          clienteFornecedor: "", // ✅ exclusividade
                        }))
                      }
                      style={styles.input}
                    >
                      <option value="">Selecione...</option>
                      {advogados.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                </Tooltip>

              </div>
              )}

              {novo.es !== "T" && (
                <div style={styles.row}>
                  <Tooltip content="Se ativado, o lançamento manual já será criado como EFETIVADO">
                    <label style={{ ...styles.field, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!novo.confirmarAgora}
                        onChange={(e) => setNovo((s) => ({ ...s, confirmarAgora: e.target.checked }))}
                      />
                      <span style={styles.label}>Lançar confirmado</span>
                    </label>
                  </Tooltip>
                </div>
              )}

              {novo.es !== "T" && (
              <div style={styles.row}>
                <Tooltip content="Descreva o motivo ou natureza do lançamento">
                  <label style={{ ...styles.field, flex: 1 }}>
                    <span style={styles.label}>Histórico</span>
                    <input
                      value={novo.historico}
                      onChange={(e) => setNovo((s) => ({ ...s, historico: e.target.value }))}
                      style={styles.input}
                    />
                  </label>
                </Tooltip>
              </div>
              )}

              {novo.es === "T" ? (
                <div style={styles.row}>
                  {[
                    { field: "contaOrigemId",  other: "contaDestinoId", label: "Conta Origem (saída)",   tooltip: "Conta de onde o valor sairá" },
                    { field: "contaDestinoId", other: "contaOrigemId",  label: "Conta Destino (entrada)", tooltip: "Conta que receberá o valor" },
                  ].map(({ field, other, label, tooltip }) => {
                    const clientesFiltrados = clientes.filter(isClienteContaElegivel);
                    const otherVal = String(novo[other] || "");
                    return (
                      <Tooltip key={field} content={tooltip}>
                        <label style={{ ...styles.field, flex: 1 }}>
                          <span style={styles.label}>{label}</span>
                          <select
                            value={novo[field]}
                            onChange={(e) => {
                              const val = e.target.value;
                              setNovo((s) => ({
                                ...s,
                                [field]: val,
                                [other]: s[other] === val ? "" : s[other],
                              }));
                            }}
                            style={styles.input}
                          >
                            <option value="">Selecione...</option>
                            {contas.length > 0 && (
                              <optgroup label="Contas">
                                {contas
                                  .filter((c) => String(c.id) !== otherVal)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>{c.nome}</option>
                                  ))}
                              </optgroup>
                            )}
                            {clientesFiltrados.length > 0 && (
                              <optgroup label="Clientes">
                                {clientesFiltrados
                                  .filter((c) => `c:${c.id}` !== otherVal)
                                  .map((c) => (
                                    <option key={`c:${c.id}`} value={`c:${c.id}`}>
                                      {c.nomeRazaoSocial || c.nome}
                                    </option>
                                  ))}
                              </optgroup>
                            )}
                          </select>
                        </label>
                      </Tooltip>
                    );
                  })}
                </div>
              ) : (
                <div style={styles.row}>
                  {contas.length === 0 ? (
                    <div style={ui.hintWarn}>Nenhuma conta cadastrada/ativa encontrada.</div>
                  ) : null}
                  <Tooltip content="Selecione a conta bancária, caixa ou conta de cliente">
                    <label style={{ ...styles.field, flex: 1 }}>
                      <span style={styles.label}>Local/Conta</span>
                      <select
                        value={novo.clienteContaId ? `c:${novo.clienteContaId}` : novo.contaId}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.startsWith("c:")) {
                            setNovo((s) => ({ ...s, clienteContaId: val.slice(2), contaId: "" }));
                          } else {
                            setNovo((s) => ({ ...s, contaId: val, clienteContaId: "" }));
                          }
                        }}
                        style={styles.input}
                      >
                        <option value="">Selecione...</option>
                        {contas.length > 0 && (
                          <optgroup label="Contas">
                            {contas.map((c) => (
                              <option key={c.id} value={c.id}>{c.nome}</option>
                            ))}
                          </optgroup>
                        )}
                        {clientes.filter(isClienteContaElegivel).length > 0 && (
                          <optgroup label="Clientes">
                            {clientes
                              .filter(isClienteContaElegivel)
                              .map((c) => (
                                <option key={`c:${c.id}`} value={`c:${c.id}`}>
                                  {c.nomeRazaoSocial || c.nome}
                                </option>
                              ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                  </Tooltip>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <Tooltip content="Fechar o modal sem salvar">
                <button
                  onClick={() => {
                    setNovoOpen(false);
                    setNovoErr("");
                  }}
                  style={ui.btnGhost}
                >
                  Cancelar
                </button>
              </Tooltip>

              <Tooltip content="Criar o novo lançamento no livro caixa">
                <button onClick={criarLancamentoManual} style={ui.btnPrimary}>
                  Salvar
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal: Editar lançamento */}
      {editOpen && editData ? (
        <div style={styles.backdrop}>
          <div style={styles.modal}>
            <h3>Editar lançamento</h3>

            {editErr ? (
              <div style={ui.modalError}>
                <strong>Erro:</strong> {editErr}
              </div>
            ) : null}

            <div style={styles.form}>
              <div style={styles.row}>
                <Tooltip content="Data do lançamento">
                  <label style={styles.field}>
                    <span style={styles.label}>Data</span>
                    <input
                      type="date"
                      value={editData.dataISO}
                      onChange={(e) => setEditData((s) => ({ ...s, dataISO: e.target.value }))}
                      style={styles.input}
                    />
                  </label>
                </Tooltip>

                <Tooltip content="Tipo: Entrada (E) ou Saída (S)">
                  <label style={styles.field}>
                    <span style={styles.label}>E/S</span>
                    <select
                      value={editData.es}
                      onChange={(e) => setEditData((s) => ({ ...s, es: e.target.value }))}
                      style={styles.input}
                    >
                      <option value="">Selecione...</option>
                      <option value="E">Entrada</option>
                      <option value="S">Saída</option>
                    </select>
                  </label>
                </Tooltip>

                <Tooltip content="Valor do lançamento">
                  <label style={styles.field}>
                    <span style={styles.label}>Valor</span>
                    <input
                      inputMode="numeric"
                      value={editData.valorMasked}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setEditData((s) => ({ ...s, valorMasked: maskBRLFromDigits(digits) }));
                      }}
                      placeholder="0,00"
                      style={styles.input}
                    />
                  </label>
                </Tooltip>
              </div>

              <div style={styles.row}>
                <Tooltip content="Número do documento fiscal">
                  <label style={styles.field}>
                    <span style={styles.label}>NFS-e/NF/CF/RC</span>
                    <input
                      value={editData.documento}
                      onChange={(e) => setEditData((s) => ({ ...s, documento: e.target.value }))}
                      style={styles.input}
                    />
                  </label>
                </Tooltip>

                <div style={styles.row}>
                  <Tooltip content="Digite para buscar cliente/fornecedor (OU selecione um advogado)">
                    <label style={styles.field}>
                      <span style={styles.label}>Cliente/Fornecedor</span>
                      <input
                        list="edit-clientes-list"
                        value={editData.clienteFornecedor}
                        disabled={!!editData.advogadoId}
                        onChange={(e) =>
                          setEditData((s) => ({
                            ...s,
                            clienteFornecedor: e.target.value,
                            advogadoId: "",
                          }))
                        }
                        placeholder="Digite para buscar..."
                        style={styles.input}
                      />
                      <datalist id="edit-clientes-list">
                        {clientes.map((c) => (
                          <option key={c.id} value={c.nomeRazaoSocial || c.nome} />
                        ))}
                      </datalist>
                    </label>
                  </Tooltip>

                  <Tooltip content="Selecione um advogado (apenas um)">
                    <label style={styles.field}>
                      <span style={styles.label}>Advogado</span>
                      <select
                        value={editData.advogadoId}
                        disabled={!!editData.clienteFornecedor}
                        onChange={(e) =>
                          setEditData((s) => ({
                            ...s,
                            advogadoId: e.target.value,
                            clienteFornecedor: "", // ✅ exclusividade
                          }))
                        }
                        style={styles.input}
                      >
                        <option value="">Selecione...</option>
                        {advogados.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                  </Tooltip>
                </div>
              </div>

              <div style={styles.row}>
                <Tooltip content="Descrição do lançamento">
                  <label style={{ ...styles.field, flex: 1 }}>
                    <span style={styles.label}>Histórico</span>
                    <input
                      value={editData.historico}
                      onChange={(e) => setEditData((s) => ({ ...s, historico: e.target.value }))}
                      style={styles.input}
                    />
                  </label>
                </Tooltip>
              </div>

              <div style={styles.row}>
                <Tooltip content="Conta bancária, caixa ou conta de cliente">
                  <label style={{ ...styles.field, flex: 1 }}>
                    <span style={styles.label}>Local/Conta</span>
                    <select
                      value={editData.clienteContaId ? `c:${editData.clienteContaId}` : editData.contaId}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith("c:")) {
                          setEditData((s) => ({ ...s, clienteContaId: val.slice(2), contaId: "" }));
                        } else {
                          setEditData((s) => ({ ...s, contaId: val, clienteContaId: "" }));
                        }
                      }}
                      style={styles.input}
                    >
                      <option value="">Selecione...</option>
                      {contas.length > 0 && (
                        <optgroup label="Contas">
                          {contas.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {clientes.filter(isClienteContaElegivel).length > 0 && (
                        <optgroup label="Clientes">
                          {clientes
                            .filter(isClienteContaElegivel)
                            .map((c) => (
                              <option key={`c:${c.id}`} value={`c:${c.id}`}>
                                {c.nomeRazaoSocial || c.nome}
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                  </label>
                </Tooltip>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <Tooltip content="Cancelar edição">
                <button
                  onClick={() => {
                    setEditOpen(false);
                    setEditData(null);
                    setEditErr("");
                  }}
                  style={ui.btnGhost}
                >
                  Cancelar
                </button>
              </Tooltip>

              <Tooltip content="Salvar alterações">
                <button onClick={salvarEdicao} style={ui.btnPrimary}>
                  Salvar
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.40)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    width: "min(780px, 100%)",
    background: "#fff",
    borderRadius: 14,
    padding: 18,
    border: "1px solid rgba(0,0,0,0.10)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 10,
  },
  row: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: "1 1 220px",
    minWidth: 220,
  },
  label: {
    fontSize: 12,
    opacity: 0.75,
    fontWeight: 600,
  },
  input: {
    height: 40,
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.15)",
    padding: "0 12px",
    outline: "none",
  },
};

const filterBar = {
  wrap: {
    display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end",
    margin: "10px 0 8px", padding: "12px 14px",
    background: "#f8fafc", borderRadius: 10, border: "1px solid #e5e7eb",
  },
  group: { display: "flex", flexDirection: "column", gap: 3 },
  label: { fontSize: 11, fontWeight: 600, color: "#64748b", whiteSpace: "nowrap" },
  input: {
    height: 34, borderRadius: 8, border: "1px solid #d1d5db",
    padding: "0 10px", fontSize: 13, outline: "none", minWidth: 120,
  },
  btnClear: {
    height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #d1d5db",
    background: "#fff", color: "#64748b", fontSize: 12, cursor: "pointer",
    fontWeight: 600, alignSelf: "flex-end",
  },
};

const ui = {
  btnPrimary: {
    height: 40,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#111",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnSecondary: {
    height: 40,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    color: "#111",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnGhost: {
    height: 40,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "transparent",
    color: "#111",
    fontWeight: 600,
    cursor: "pointer",
  },
  modalError: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    background: "#ffe9e9",
    border: "1px solid #ffb6b6",
  },
  hintWarn: {
    marginBottom: 8,
    padding: "8px 10px",
    borderRadius: 10,
    background: "#fff8e8",
    border: "1px solid #f1c40f",
    fontSize: 12,
  },
};
