import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import MoneyInput from "../components/ui/MoneyInput";
import EmptyState from "../components/ui/EmptyState";

const TAB_ROUTES = {
  "enviar-pix": "/santander/operacoes/enviar-pix",
  "receber-pix": "/santander/operacoes/receber-pix",
  "pagar-boletos": "/santander/operacoes/pagar-boletos",
  gerenciamento: "/santander/operacoes",
};

const TAB_LABELS = {
  "enviar-pix": "Enviar Pix",
  "receber-pix": "Receber Pix",
  "pagar-boletos": "Pagar Boletos",
  gerenciamento: "Gerenciamento",
};

const TIPO_LABEL = {
  PIX_ENVIADO: "Pix enviado",
  PIX_RECEBIDO: "Pix recebido",
  BOLETO_PAGO: "Boleto pago",
};

const STATUS_META = {
  PROCESSANDO: { label: "Processando", className: "bg-amber-100 text-amber-800" },
  CONCLUIDO: { label: "Concluido", className: "bg-emerald-100 text-emerald-800" },
  ERRO: { label: "Erro", className: "bg-red-100 text-red-800" },
  PENDENTE_INTEGRACAO: { label: "Pendente integracao", className: "bg-slate-100 text-slate-700" },
};

function formatInputDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(String(value).includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function barcodeType(digits) {
  if (digits.length === 44) return "Codigo de barras";
  if (digits.length === 47) return "Linha digitavel (titulo bancario)";
  if (digits.length === 48) return "Linha digitavel (arrecadacao)";
  return "";
}

function normalizeTipo(raw, fallback = "PIX_ENVIADO") {
  const s = String(raw || "").toUpperCase();
  if (s.includes("BOLETO")) return "BOLETO_PAGO";
  if (s.includes("RECEB")) return "PIX_RECEBIDO";
  if (s.includes("PIX")) return "PIX_ENVIADO";
  return fallback;
}

function normalizeStatus(raw) {
  const s = String(raw || "").toUpperCase();
  if (["CONCLUIDO", "CONCLUIDO", "REALIZADO", "PAGO", "SUCESSO", "SUCCESS", "LIQUIDADO"].includes(s)) {
    return "CONCLUIDO";
  }
  if (["ERRO", "FALHA", "NEGADO", "RECUSADO", "CANCELADO", "REJEITADO", "FAILED"].includes(s)) {
    return "ERRO";
  }
  if (["PENDENTE_INTEGRACAO", "MOCK"].includes(s)) {
    return "PENDENTE_INTEGRACAO";
  }
  return "PROCESSANDO";
}

function normalizeOperation(item, origem = "api", fallbackTipo = "PIX_ENVIADO") {
  const tipo = normalizeTipo(item?.tipo || item?.operationType, fallbackTipo);
  const valorCentavos = item?.valorCentavos != null
    ? Number(item.valorCentavos)
    : Math.round(Number(item?.valor || 0) * 100);

  return {
    id: item?.id || item?.operacaoId || item?.codigoSolicitacao || `${origem}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dataHora: item?.dataHora || item?.createdAt || item?.data || item?.updatedAt || new Date().toISOString(),
    tipo,
    status: normalizeStatus(item?.status || item?.situacao || item?.estado),
    valorCentavos: Number.isFinite(valorCentavos) ? valorCentavos : 0,
    nomeDestino: item?.favorecidoNome || item?.nomeDestino || item?.pagadorNome || item?.remetenteNome || item?.nome || "",
    chavePix: item?.chavePix || item?.chave || item?.pixKey || "",
    codigoBarras: item?.codigoBarras || item?.linhaDigitavel || "",
    descricao: item?.descricao || item?.historico || item?.memo || "",
    protocolo: item?.protocolo || item?.endToEndId || item?.nsu || item?.txid || null,
    contaId: item?.contaId || item?.conta?.id || null,
    contaNome: item?.contaNome || item?.conta?.nome || "",
    origem,
  };
}

function normalizeRecebimento(item, idx = 0) {
  const valorCentavos = item?.valorCentavos != null
    ? Number(item.valorCentavos)
    : Math.round(Math.abs(Number(item?.valor || 0)) * 100);

  return {
    id: item?.id || item?.txid || item?.endToEndId || `rx-${idx}-${Date.now()}`,
    dataHora: item?.dataHora || item?.dataEntrada || item?.dataTransacao || item?.data || new Date().toISOString(),
    valorCentavos: Number.isFinite(valorCentavos) ? valorCentavos : 0,
    remetenteNome: item?.remetenteNome || item?.nomeRemetente || item?.descricao || "—",
    txid: item?.txid || item?.endToEndId || "",
    status: normalizeStatus(item?.status || item?.situacao),
  };
}

function extractArray(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

function isEndpointMissingError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("404") || msg.includes("nao encontrado") || msg.includes("não encontrado") || msg.includes("not found");
}

function supportLabel(value) {
  if (value === true) return "Ativo";
  if (value === false) return "Pendente";
  return "Aguardando";
}

function supportClass(value) {
  if (value === true) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (value === false) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.PROCESSANDO;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export default function SantanderOperacoes({ user, initialTab = "gerenciamento" }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const navigate = useNavigate();
  const { addToast } = useToast();

  const today = formatInputDate(new Date());
  const firstDayOfMonth = formatInputDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [tab, setTab] = useState(TAB_ROUTES[initialTab] ? initialTab : "gerenciamento");
  const [support, setSupport] = useState({ operacoes: null, pixEnviar: null, pixReceber: null, boletoPagar: null });

  const [contasSantander, setContasSantander] = useState([]);
  const [loadingContas, setLoadingContas] = useState(false);

  const [opsApi, setOpsApi] = useState([]);
  const [opsLocal, setOpsLocal] = useState([]);
  const [loadingOps, setLoadingOps] = useState(false);

  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroBusca, setFiltroBusca] = useState("");

  const [pixForm, setPixForm] = useState({
    contaId: "",
    favorecidoNome: "",
    chavePix: "",
    tipoChave: "",
    cpfCnpj: "",
    valorCentavos: 0,
    descricao: "",
  });
  const [sendingPix, setSendingPix] = useState(false);

  const [recFiltro, setRecFiltro] = useState({ de: firstDayOfMonth, ate: today, contaId: "" });
  const [recebimentos, setRecebimentos] = useState([]);
  const [loadingRecebimentos, setLoadingRecebimentos] = useState(false);

  const [boletoForm, setBoletoForm] = useState({
    contaId: "",
    linhaDigitavel: "",
    valorCentavos: 0,
    descricao: "",
    dataPagamento: today,
  });
  const [payingBoleto, setPayingBoleto] = useState(false);

  useEffect(() => {
    setTab(TAB_ROUTES[initialTab] ? initialTab : "gerenciamento");
  }, [initialTab]);

  useEffect(() => {
    async function carregarContas() {
      setLoadingContas(true);
      try {
        const data = await apiFetch("/livro-caixa/contas");
        const contas = Array.isArray(data) ? data : data?.contas || [];
        const santander = contas.filter((c) => c?.tipo === "BANCO" && c?.ativa && String(c?.nome || "").toLowerCase().includes("santander"));
        setContasSantander(santander);
      } catch (err) {
        addToast(err?.message || "Falha ao carregar contas bancarias", "error");
      } finally {
        setLoadingContas(false);
      }
    }
    carregarContas();
  }, [addToast]);

  useEffect(() => {
    if (contasSantander.length !== 1) return;
    const contaId = String(contasSantander[0].id);
    setPixForm((prev) => (prev.contaId ? prev : { ...prev, contaId }));
    setRecFiltro((prev) => (prev.contaId ? prev : { ...prev, contaId }));
    setBoletoForm((prev) => (prev.contaId ? prev : { ...prev, contaId }));
  }, [contasSantander]);

  const carregarOperacoes = useCallback(async ({ silent = false } = {}) => {
    setLoadingOps(true);
    try {
      const data = await apiFetch("/santander/operacoes?limit=200");
      const lista = extractArray(data, ["operacoes", "items", "data"]);
      setOpsApi(lista.map((item) => normalizeOperation(item, "api")));
      setSupport((prev) => ({ ...prev, operacoes: true }));
    } catch (err) {
      if (isEndpointMissingError(err)) {
        setSupport((prev) => ({ ...prev, operacoes: false }));
        if (!silent) addToast("Endpoint de gestao Santander ainda nao publicado. Exibindo registros locais.", "info", 5000);
      } else {
        addToast(err?.message || "Falha ao carregar operacoes Santander", "error");
      }
    } finally {
      setLoadingOps(false);
    }
  }, [addToast]);

  useEffect(() => {
    carregarOperacoes({ silent: true });
  }, [carregarOperacoes]);

  const operacoes = useMemo(() => {
    const map = new Map();
    [...opsApi, ...opsLocal].forEach((op) => {
      if (!op?.id) return;
      if (!map.has(String(op.id))) map.set(String(op.id), op);
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
  }, [opsApi, opsLocal]);

  const operacoesFiltradas = useMemo(() => {
    const q = filtroBusca.trim().toLowerCase();
    return operacoes.filter((op) => {
      if (filtroTipo && op.tipo !== filtroTipo) return false;
      if (filtroStatus && op.status !== filtroStatus) return false;
      if (!q) return true;
      const target = [op.nomeDestino, op.descricao, op.protocolo, op.chavePix, op.codigoBarras].filter(Boolean).join(" ").toLowerCase();
      return target.includes(q);
    });
  }, [operacoes, filtroTipo, filtroStatus, filtroBusca]);

  const addLocalOperation = useCallback((op) => {
    const record = normalizeOperation({ ...op, status: "PENDENTE_INTEGRACAO" }, "local", op.tipo);
    setOpsLocal((prev) => [record, ...prev]);
  }, []);

  function goToTab(nextTab) {
    setTab(nextTab);
    navigate(TAB_ROUTES[nextTab] || TAB_ROUTES.gerenciamento);
  }

  async function handleEnviarPix(e) {
    e.preventDefault();

    const contaId = pixForm.contaId || (contasSantander.length === 1 ? String(contasSantander[0].id) : "");
    if (contasSantander.length > 0 && !contaId) {
      addToast("Selecione a conta Santander de origem.", "warning");
      return;
    }
    if (!pixForm.favorecidoNome.trim()) {
      addToast("Informe o favorecido.", "warning");
      return;
    }
    if (!pixForm.chavePix.trim()) {
      addToast("Informe a chave Pix.", "warning");
      return;
    }
    if (!pixForm.valorCentavos || pixForm.valorCentavos <= 0) {
      addToast("Informe o valor do Pix.", "warning");
      return;
    }

    const payload = {
      contaId: contaId ? Number(contaId) : null,
      favorecidoNome: pixForm.favorecidoNome.trim(),
      chavePix: pixForm.chavePix.trim(),
      tipoChave: pixForm.tipoChave || null,
      cpfCnpjFavorecido: pixForm.cpfCnpj.trim() || null,
      valorCentavos: Number(pixForm.valorCentavos),
      descricao: pixForm.descricao.trim() || null,
    };

    setSendingPix(true);
    try {
      const data = await apiFetch("/santander/pix/enviar", { method: "POST", body: payload });
      const source = data?.operacao || data?.pix || data;
      const op = normalizeOperation(
        { ...source, ...payload, tipo: "PIX_ENVIADO", status: source?.status || "PROCESSANDO" },
        "api",
        "PIX_ENVIADO"
      );
      setOpsApi((prev) => [op, ...prev]);
      setSupport((prev) => ({ ...prev, pixEnviar: true }));
      addToast("Pix enviado para processamento Santander.", "success");
      setPixForm((prev) => ({ ...prev, favorecidoNome: "", chavePix: "", tipoChave: "", cpfCnpj: "", valorCentavos: 0, descricao: "" }));
      goToTab("gerenciamento");
    } catch (err) {
      if (isEndpointMissingError(err)) {
        setSupport((prev) => ({ ...prev, pixEnviar: false }));
        addLocalOperation({
          tipo: "PIX_ENVIADO",
          contaId: payload.contaId,
          valorCentavos: payload.valorCentavos,
          nomeDestino: payload.favorecidoNome,
          chavePix: payload.chavePix,
          descricao: payload.descricao,
        });
        addToast("Integracao Pix Santander pendente. Operacao registrada localmente.", "warning", 6000);
      } else {
        addToast(err?.message || "Falha ao enviar Pix Santander", "error");
      }
    } finally {
      setSendingPix(false);
    }
  }

  async function handleConsultarRecebimentos() {
    if (!recFiltro.de || !recFiltro.ate) {
      addToast("Informe o periodo para consulta.", "warning");
      return;
    }
    if (recFiltro.de > recFiltro.ate) {
      addToast("Periodo invalido: data inicial maior que data final.", "warning");
      return;
    }

    setLoadingRecebimentos(true);
    try {
      const params = new URLSearchParams({ de: recFiltro.de, ate: recFiltro.ate });
      if (recFiltro.contaId) params.set("contaId", recFiltro.contaId);
      const data = await apiFetch(`/santander/pix/recebidos?${params.toString()}`);
      const lista = extractArray(data, ["recebimentos", "transacoes", "items", "data"]);
      setRecebimentos(lista.map((item, idx) => normalizeRecebimento(item, idx)));
      setSupport((prev) => ({ ...prev, pixReceber: true }));
    } catch (err) {
      if (isEndpointMissingError(err)) {
        setSupport((prev) => ({ ...prev, pixReceber: false }));
        setRecebimentos([]);
        addToast("Consulta de Pix recebidos Santander ainda nao publicada.", "info");
      } else {
        addToast(err?.message || "Falha ao consultar Pix recebidos", "error");
      }
    } finally {
      setLoadingRecebimentos(false);
    }
  }

  async function handlePagarBoleto(e) {
    e.preventDefault();

    const contaId = boletoForm.contaId || (contasSantander.length === 1 ? String(contasSantander[0].id) : "");
    if (contasSantander.length > 0 && !contaId) {
      addToast("Selecione a conta Santander para debito.", "warning");
      return;
    }

    const digits = onlyDigits(boletoForm.linhaDigitavel);
    if (![44, 47, 48].includes(digits.length)) {
      addToast("Informe codigo valido de 44, 47 ou 48 digitos.", "warning");
      return;
    }

    const payload = {
      contaId: contaId ? Number(contaId) : null,
      linhaDigitavel: boletoForm.linhaDigitavel.trim(),
      codigoBarras: digits.length === 44 ? digits : null,
      valorCentavos: boletoForm.valorCentavos > 0 ? Number(boletoForm.valorCentavos) : null,
      dataPagamento: boletoForm.dataPagamento || null,
      descricao: boletoForm.descricao.trim() || null,
    };

    setPayingBoleto(true);
    try {
      const data = await apiFetch("/santander/boletos/pagar", { method: "POST", body: payload });
      const source = data?.operacao || data?.pagamento || data;
      const op = normalizeOperation(
        { ...source, ...payload, tipo: "BOLETO_PAGO", status: source?.status || "PROCESSANDO" },
        "api",
        "BOLETO_PAGO"
      );
      setOpsApi((prev) => [op, ...prev]);
      setSupport((prev) => ({ ...prev, boletoPagar: true }));
      addToast("Pagamento de boleto enviado ao Santander.", "success");
      setBoletoForm((prev) => ({ ...prev, linhaDigitavel: "", valorCentavos: 0, descricao: "" }));
      goToTab("gerenciamento");
    } catch (err) {
      if (isEndpointMissingError(err)) {
        setSupport((prev) => ({ ...prev, boletoPagar: false }));
        addLocalOperation({
          tipo: "BOLETO_PAGO",
          contaId: payload.contaId,
          valorCentavos: payload.valorCentavos || 0,
          codigoBarras: digits,
          descricao: payload.descricao,
        });
        addToast("Integracao de boletos pendente. Registro salvo localmente.", "warning", 6000);
      } else {
        addToast(err?.message || "Falha ao pagar boleto Santander", "error");
      }
    } finally {
      setPayingBoleto(false);
    }
  }

  if (!isAdmin) {
    return (
      <EmptyState
        icon="??"
        title="Acesso restrito"
        description="Esta area de operacoes bancarias Santander e exclusiva para administradores."
      />
    );
  }

  const digitsBoleto = onlyDigits(boletoForm.linhaDigitavel);
  const tipoCodigo = barcodeType(digitsBoleto);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Operacoes Bco. Santander</h1>
            <p className="text-sm text-slate-500 mt-1">
              Painel preparado para envio/recebimento de Pix, pagamento de boletos e gestao operacional.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["Envio Pix", support.pixEnviar],
              ["Recebimento Pix", support.pixReceber],
              ["Pagamento Boletos", support.boletoPagar],
              ["Gestao API", support.operacoes],
            ].map(([label, value]) => (
              <span key={label} className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${supportClass(value)}`}>
                {label}: {supportLabel(value)}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex flex-wrap gap-2">
            {Object.keys(TAB_ROUTES).map((key) => (
              <button
                key={key}
                onClick={() => goToTab(key)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  tab === key
                    ? "bg-blue-700 text-white"
                    : "bg-slate-50 text-slate-700 border border-slate-200 hover:border-blue-300"
                }`}
              >
                {TAB_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        {(loadingContas || contasSantander.length === 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            {loadingContas ? (
              <span>Carregando contas Santander...</span>
            ) : (
              <span>
                Nenhuma conta Santander ativa foi encontrada em <a href="/livro-caixa/contas" className="underline font-semibold">Contas Contabeis</a>.
              </span>
            )}
          </div>
        )}

        {tab === "enviar-pix" && (
          <form onSubmit={handleEnviarPix} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Enviar Pix</h2>
              <button type="button" onClick={() => goToTab("gerenciamento")} className="text-xs text-slate-500 hover:text-slate-700">
                Ver gerenciamento
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Conta Santander</label>
                <select
                  value={pixForm.contaId}
                  onChange={(e) => setPixForm((prev) => ({ ...prev, contaId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Selecione...</option>
                  {contasSantander.map((conta) => (
                    <option key={conta.id} value={conta.id}>{conta.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de chave</label>
                <select
                  value={pixForm.tipoChave}
                  onChange={(e) => setPixForm((prev) => ({ ...prev, tipoChave: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Automatico</option>
                  <option value="CPF">CPF</option>
                  <option value="CNPJ">CNPJ</option>
                  <option value="EMAIL">E-mail</option>
                  <option value="TELEFONE">Telefone</option>
                  <option value="EVP">Aleatoria</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Favorecido</label>
                <input
                  type="text"
                  value={pixForm.favorecidoNome}
                  onChange={(e) => setPixForm((prev) => ({ ...prev, favorecidoNome: e.target.value }))}
                  placeholder="Nome completo ou razao social"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chave Pix</label>
                <input
                  type="text"
                  value={pixForm.chavePix}
                  onChange={(e) => setPixForm((prev) => ({ ...prev, chavePix: e.target.value }))}
                  placeholder="CPF, CNPJ, e-mail, telefone ou EVP"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">CPF/CNPJ do favorecido (opcional)</label>
                <input
                  type="text"
                  value={pixForm.cpfCnpj}
                  onChange={(e) => setPixForm((prev) => ({ ...prev, cpfCnpj: e.target.value }))}
                  placeholder="Apenas numeros"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <MoneyInput
                value={pixForm.valorCentavos}
                onChange={(v) => setPixForm((prev) => ({ ...prev, valorCentavos: v }))}
                label="Valor"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Descricao (opcional)</label>
              <input
                type="text"
                value={pixForm.descricao}
                onChange={(e) => setPixForm((prev) => ({ ...prev, descricao: e.target.value }))}
                placeholder="Ex: repasse abril/2026"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={sendingPix}
                className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {sendingPix ? "Enviando..." : "Confirmar envio Pix"}
              </button>
            </div>
          </form>
        )}

        {tab === "receber-pix" && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Receber Pix</h2>
              <button onClick={handleConsultarRecebimentos} className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold">
                Atualizar
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">De</label>
                <input
                  type="date"
                  value={recFiltro.de}
                  onChange={(e) => setRecFiltro((prev) => ({ ...prev, de: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Ate</label>
                <input
                  type="date"
                  value={recFiltro.ate}
                  onChange={(e) => setRecFiltro((prev) => ({ ...prev, ate: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Conta Santander (opcional)</label>
                <select
                  value={recFiltro.contaId}
                  onChange={(e) => setRecFiltro((prev) => ({ ...prev, contaId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Todas</option>
                  {contasSantander.map((conta) => (
                    <option key={conta.id} value={conta.id}>{conta.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            {loadingRecebimentos ? (
              <div className="text-sm text-slate-500 py-6 text-center">Consultando recebimentos...</div>
            ) : recebimentos.length === 0 ? (
              <EmptyState compact icon="??" title="Nenhum recebimento no periodo" description="Use Atualizar para consultar a API Santander assim que estiver disponivel." />
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="text-left px-3 py-2">Data/Hora</th>
                      <th className="text-left px-3 py-2">Remetente</th>
                      <th className="text-left px-3 py-2">TxId / E2E</th>
                      <th className="text-right px-3 py-2">Valor</th>
                      <th className="text-center px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recebimentos.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700">{fmtDateTime(item.dataHora)}</td>
                        <td className="px-3 py-2 text-slate-900">{item.remetenteNome || "—"}</td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-600">{item.txid || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-700">+{brl(item.valorCentavos)}</td>
                        <td className="px-3 py-2 text-center"><StatusBadge status={item.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "pagar-boletos" && (
          <form onSubmit={handlePagarBoleto} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Pagar Boleto (codigo de barras)</h2>
              <button type="button" onClick={() => goToTab("gerenciamento")} className="text-xs text-slate-500 hover:text-slate-700">
                Ver gerenciamento
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Conta Santander</label>
                <select
                  value={boletoForm.contaId}
                  onChange={(e) => setBoletoForm((prev) => ({ ...prev, contaId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Selecione...</option>
                  {contasSantander.map((conta) => (
                    <option key={conta.id} value={conta.id}>{conta.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data do pagamento</label>
                <input
                  type="date"
                  value={boletoForm.dataPagamento}
                  onChange={(e) => setBoletoForm((prev) => ({ ...prev, dataPagamento: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Linha digitavel / codigo de barras</label>
              <textarea
                value={boletoForm.linhaDigitavel}
                onChange={(e) => setBoletoForm((prev) => ({ ...prev, linhaDigitavel: e.target.value }))}
                rows={3}
                placeholder="Cole aqui o codigo de barras ou a linha digitavel"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono"
              />
              <div className="mt-1 text-xs text-slate-500">
                {tipoCodigo ? `${tipoCodigo} detectado (${digitsBoleto.length} digitos).` : "Aceita 44, 47 ou 48 digitos."}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <MoneyInput
                value={boletoForm.valorCentavos}
                onChange={(v) => setBoletoForm((prev) => ({ ...prev, valorCentavos: v }))}
                label="Valor (opcional, confirme antes de pagar)"
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descricao (opcional)</label>
                <input
                  type="text"
                  value={boletoForm.descricao}
                  onChange={(e) => setBoletoForm((prev) => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Ex: aluguel escritorio abril/2026"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={payingBoleto}
                className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {payingBoleto ? "Enviando..." : "Confirmar pagamento"}
              </button>
            </div>
          </form>
        )}

        {tab === "gerenciamento" && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Gerenciamento de Operacoes</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {operacoes.length} operacao(oes) registrada(s) entre API e fallback local.
                </p>
              </div>
              <button
                onClick={() => carregarOperacoes({ silent: false })}
                disabled={loadingOps}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {loadingOps ? "Atualizando..." : "Atualizar da API"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Tipo</label>
                <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
                  <option value="">Todos</option>
                  <option value="PIX_ENVIADO">Pix enviado</option>
                  <option value="PIX_RECEBIDO">Pix recebido</option>
                  <option value="BOLETO_PAGO">Boleto pago</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Status</label>
                <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
                  <option value="">Todos</option>
                  <option value="PROCESSANDO">Processando</option>
                  <option value="CONCLUIDO">Concluido</option>
                  <option value="ERRO">Erro</option>
                  <option value="PENDENTE_INTEGRACAO">Pendente integracao</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Busca livre</label>
                <input
                  type="text"
                  value={filtroBusca}
                  onChange={(e) => setFiltroBusca(e.target.value)}
                  placeholder="Favorecido, TxId, chave Pix, codigo de barras..."
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>

            {operacoesFiltradas.length === 0 ? (
              <EmptyState compact icon="???" title="Sem operacoes para os filtros aplicados" description="Use as abas de execucao para iniciar Pix ou pagamentos." />
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="text-left px-3 py-2">Data/Hora</th>
                      <th className="text-left px-3 py-2">Tipo</th>
                      <th className="text-left px-3 py-2">Destino/Descricao</th>
                      <th className="text-left px-3 py-2">Conta</th>
                      <th className="text-right px-3 py-2">Valor</th>
                      <th className="text-center px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Protocolo</th>
                      <th className="text-center px-3 py-2">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operacoesFiltradas.map((op) => (
                      <tr key={op.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDateTime(op.dataHora)}</td>
                        <td className="px-3 py-2 text-slate-900 font-medium">{TIPO_LABEL[op.tipo] || op.tipo}</td>
                        <td className="px-3 py-2">
                          <div className="text-slate-900">{op.nomeDestino || "—"}</div>
                          {op.descricao && <div className="text-xs text-slate-500 mt-0.5">{op.descricao}</div>}
                          {!op.descricao && op.chavePix && <div className="text-xs text-slate-500 mt-0.5 font-mono">{op.chavePix}</div>}
                          {!op.descricao && !op.chavePix && op.codigoBarras && <div className="text-xs text-slate-500 mt-0.5 font-mono">{op.codigoBarras}</div>}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{op.contaNome || (op.contaId ? `Conta #${op.contaId}` : "—")}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{brl(op.valorCentavos)}</td>
                        <td className="px-3 py-2 text-center"><StatusBadge status={op.status} /></td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-600">{op.protocolo || "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">
                            {op.origem === "api" ? "API" : "Local"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
