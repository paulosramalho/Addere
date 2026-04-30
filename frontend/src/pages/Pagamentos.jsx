// src/pages/Pagamentos.jsx      26/01
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Can from "../components/Can";

import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import { formatBRLFromDecimal, toDDMMYYYY } from '../lib/formatters';
import EmptyState from "../components/ui/EmptyState";
import BoletoCriarModal from "../components/BoletoCriarModal";

/* ---------------- helpers ---------------- */
function toDateOnly(d) {
  if (!d) return null;

  // Se vier "DD/MM/AAAA", parse correto
  if (typeof d === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const parsed = parseDateDDMMYYYY(d); // já existe no arquivo
    if (!parsed) return null;
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  // Se vier "YYYY-MM-DD" (ou DateTime começando assim), trate como data-only local.
  // Isso evita o bug D-1 quando o backend manda 00:00:00Z.
  if (typeof d === "string") {
    const mISO = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) {
      const yyyy = Number(mISO[1]);
      const mm = Number(mISO[2]);
      const dd = Number(mISO[3]);
      const local = new Date(yyyy, mm - 1, dd);
      if (!Number.isFinite(local.getTime())) return null;
      local.setHours(0, 0, 0, 0);
      return local;
    }
  }

  // Caso geral (Date, ISO etc.)
  const x = new Date(d);
  if (!Number.isFinite(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x;
}

function isParcelaAtrasada(p) {
  if (!p) return false;
  if (p.status !== "PREVISTA") return false;
  if (!p.vencimento) return false;

  const hoje = toDateOnly(new Date());
  const venc = toDateOnly(p.vencimento);

  if (!hoje || !venc) return false;

  // Atrasado somente se vencimento já passou (vencimento == hoje NÃO é atrasado)
  return venc < hoje;
}

function hasParcelaAtrasada(contrato) {
  const ps = contrato?.parcelas || [];
  return ps.some(isParcelaAtrasada);
}

function DateInput({ label, value, onChange, onBlur, error, disabled, className = "" }) {
  // value: "DD/MM/AAAA"  |  input[type=date] usa "YYYY-MM-DD"
  const toISO = (ddmmyyyy) => {
    if (!ddmmyyyy) return "";
    const m = String(ddmmyyyy).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return "";
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  };

  const fromISO = (iso) => {
    if (!iso) return "";
    const [yyyy, mm, dd] = iso.split("-");
    if (!yyyy || !mm || !dd) return "";
    return `${dd}/${mm}/${yyyy}`;
  };

  return (
    <label className={`block ${className}`}>
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <input
        type="date"
        className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50
          ${error ? "border-red-400 focus:ring-red-200 bg-red-50" : "border-slate-300 focus:ring-slate-200 bg-white"}`}
        value={toISO(value)}
        onChange={(e) => onChange(fromISO(e.target.value))}
        onBlur={onBlur}
        disabled={disabled}
      />
      {error && <p className="mt-1 text-xs text-red-600 font-medium">{error}</p>}
    </label>
  );
}

function onlyDigits(v = "") {
  return String(v ?? "").replace(/\D/g, "");
}

// moeda (máscara tipo centavos):
function maskBRLFromDigits(digits = "") {
  const d = onlyDigits(digits);
  const n = d ? BigInt(d) : 0n;
  const intPart = n / 100n;
  const decPart = n % 100n;

  const intStr = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${intStr},${decPart.toString().padStart(2, "0")}`;
}

function parseDateDDMMYYYY(s) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 1900) return null;
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return dt;
}

function normalizeForma(fp) {
  const v = String(fp || "").toUpperCase();
  if (v === "AVISTA") return "À vista";
  if (v === "PARCELADO") return "Parcelado";
  if (v === "ENTRADA_PARCELAS") return "Entrada + Parcelas";
  return fp || "—";
}

function computeStatusContrato(contrato) {
  const parcelas = contrato?.parcelas || [];
  if (!parcelas.length) return "EM_DIA";

  // PRIORIDADE: RENEGOCIADO
  if (Array.isArray(contrato?.contratosFilhos) && contrato.contratosFilhos.length > 0) {
    return "RENEGOCIADO";
  }

  const allCanceladas = parcelas.every((p) => p.status === "CANCELADA");
  if (allCanceladas) return "CANCELADO";

  // ✅ CORREÇÃO: Aceitar qualquer status finalizado
  const statusFinalizados = ["RECEBIDA", "REPASSE_EFETUADO", "CANCELADA"];
  const allEncerradas = parcelas.every((p) => statusFinalizados.includes(p.status));
  if (allEncerradas) return "QUITADO";

  // Verificar atraso SOMENTE nas PREVISTAS
  const hasAtrasada = parcelas
    .filter(p => p.status === "PREVISTA")
    .some((p) => isParcelaAtrasada(p));
  
  if (hasAtrasada) return "ATRASADO";

  return "EM_DIA";
}

/* ---------------- UI components ---------------- */
function Card({ title, right, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
        <div className="text-xl font-semibold text-slate-900">{title}</div>
        {right ? <div className="pt-0.5">{right}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Badge({ children, tone = "slate" }) {
  const map = {
    slate: "bg-slate-600 text-white",
    green: "bg-green-600 text-white",
    red: "bg-red-600 text-white",
    blue: "bg-blue-600 text-white",
    amber: "bg-amber-500 text-white",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" type="button">
            ✕
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer ? <div className="px-5 py-4 border-t border-slate-200 flex-shrink-0">{footer}</div> : null}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, onBlur, placeholder, disabled, type = "text", error }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <input
        className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50
          ${error ? "border-red-400 focus:ring-red-200 bg-red-50" : "border-slate-300 focus:ring-slate-200 bg-white"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        type={type}
      />
      {error && <p className="mt-1 text-xs text-red-600 font-medium">{error}</p>}
    </label>
  );
}

function Select({ label, value, onChange, disabled, children }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <select
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {children}
      </select>
    </label>
  );
}

function Textarea({ label, value, onChange, placeholder, disabled }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <textarea
        className="mt-1 w-full min-h-[110px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

/* ---------------- Page ---------------- */
export default function PagamentosPage({ user }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const { addToast, confirmToast } = useToast();

  const [loading, setLoading] = useState(false);

  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterForma, setFilterForma] = useState("");
  const [filterAdvogadoId, setFilterAdvogadoId] = useState("");
  const [filterDateDe, setFilterDateDe] = useState("");
  const [filterDateAte, setFilterDateAte] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const [renegProcessando, setRenegProcessando] = useState(false);

  // modal novo contrato
  const [openNovo, setOpenNovo] = useState(false);
  const [modalError, setModalError] = useState("");
  const [fe, setFe] = useState({}); // field errors
  function feClear(k) { setFe(p => ({ ...p, [k]: "" })); }
  function feSet(k, v) { setFe(p => ({ ...p, [k]: v })); }

  const [renegociarId, setRenegociarId] = useState(null);

  // modal parcelas
  const [openParcelas, setOpenParcelas] = useState(false);
  const [selectedContrato, setSelectedContrato] = useState(null);

  // clientes para select no modal
  const [clientes, setClientes] = useState([]);

  // form contrato
  const [clienteId, setClienteId] = useState("");
  const [numeroContrato, setNumeroContrato] = useState("");
  const [valorTotalDigits, setValorTotalDigits] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("AVISTA");

  // avista
  const [avistaVenc, setAvistaVenc] = useState("");

  // parcelado
  const [parcelasQtd, setParcelasQtd] = useState("3");
  const [parcelasPrimeiroVenc, setParcelasPrimeiroVenc] = useState("");

  // entrada + parcelas
  const [entradaValorDigits, setEntradaValorDigits] = useState("");
  const [entradaVenc, setEntradaVenc] = useState("");
  const [entradaParcelasQtd, setEntradaParcelasQtd] = useState("3");
  const [entradaParcelasPrimeiroVenc, setEntradaParcelasPrimeiroVenc] = useState("");

  const [observacoes, setObservacoes] = useState("");
  const [isentoTributacao, setIsentoTributacao] = useState(false);

  // confirmar parcela
  const [confirming, setConfirming] = useState(false);
  const [confOpen, setConfOpen] = useState(false);
  const [confParcela, setConfParcela] = useState(null);
  const [confErrMsg, setConfErrMsg] = useState("");
  const [confData, setConfData] = useState("");
  const [confMeio, setConfMeio] = useState("PIX");
  const [confValorDigits, setConfValorDigits] = useState("");

  const [contas, setContas] = useState([]);
  const [confContaId, setConfContaId] = useState("");

  // confirmação extra quando recebido > previsto
  const [confExtraOpen, setConfExtraOpen] = useState(false);
  const [confExtraResumo, setConfExtraResumo] = useState({ previstoCents: 0, recebidoCents: 0, diffCents: 0 });

  // cancelamento de parcela
  const [cancelOpen, setCancelOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelParcela, setCancelParcela] = useState(null);
  const [cancelMotivo, setCancelMotivo] = useState("");

  // corrigir data de recebimento (admin — parcelas RECEBIDA com data errada)
  const [corrigirOpen, setCorrigirOpen] = useState(false);
  const [corrigirParcela, setCorrigirParcela] = useState(null);
  const [corrigirData, setCorrigirData] = useState("");
  const [corrigirLoading, setCorrigirLoading] = useState(false);
  const [corrigirErr, setCorrigirErr] = useState("");

  // emissão de boleto via modal
  const [boletoEmitindo, setBoletoEmitindo] = useState(null);
  const [boletoModalParcela, setBoletoModalParcela] = useState(null);

  function handleEmitirBoleto(parcela) {
    setBoletoModalParcela(parcela);
  }

  async function handleBoletoConfirm({ historico, multaPerc, moraPercMes, validadeDias }) {
    const parcela = boletoModalParcela;
    setBoletoEmitindo(parcela.id);
    try {
      const boleto = await apiFetch("/boletos/emitir", {
        method: "POST",
        body: JSON.stringify({ parcelaId: parcela.id, historico, multaPerc, moraPercMes, validadeDias }),
      });
      setBoletoModalParcela(null);
      const sufixo = boleto.modo === "mock" ? " (simulação)" : "";
      addToast(`Boleto emitido${sufixo}! Cliente notificado por e-mail e WhatsApp.`, "success", 6000);
    } catch (e) {
      addToast(e.message || "Erro ao emitir boleto", "error");
    } finally {
      setBoletoEmitindo(null);
    }
  }

  function openCorrigirData(p) {
    setCorrigirParcela(p);
    setCorrigirData(p.dataRecebimento ? toDDMMYYYY(p.dataRecebimento) : "");
    setCorrigirErr("");
    setCorrigirOpen(true);
  }

  async function handleCorrigirData() {
    if (!corrigirParcela) return;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(corrigirData)) {
      setCorrigirErr("Informe a data no formato DD/MM/AAAA.");
      return;
    }
    setCorrigirLoading(true);
    setCorrigirErr("");
    try {
      await apiFetch(`/parcelas/${corrigirParcela.id}/corrigir-data`, {
        method: "PATCH",
        body: { dataRecebimento: corrigirData },
      });
      setCorrigirOpen(false);
      addToast("Data de recebimento corrigida.", "success");
      await load();
    } catch (e) {
      setCorrigirErr(e?.message || "Falha ao corrigir data.");
    } finally {
      setCorrigirLoading(false);
    }
  }

  // bulk select / confirm / cancel
  const [selectedParcelas, setSelectedParcelas] = useState(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkCancelMotivo, setBulkCancelMotivo] = useState('');

  async function load() {
    setLoading(true);
    try {
      const ts = Date.now();
      const data = await apiFetch(`/contratos?ts=${ts}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      addToast(e?.message || "Falha ao carregar contratos.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadClientes() {
    try {
      const data = await apiFetch("/clients?tipo=C,A");
      setClientes(Array.isArray(data) ? data : []);
    } catch {
      setClientes([]);
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    const params = new URLSearchParams(location.search || "");

    const id = params.get("renegociar");
    if (!id) return;

    // ✅ novo
    if (!Array.isArray(rows) || rows.length === 0) return;

    (async () => {
      setError("");
      try {
        // 1) carrega o contrato pai
        const pai = await apiFetch(`/contratos/${id}`);

        // 2) calcula saldo pendente = soma das PREVISTAS
        const parcelas = Array.isArray(pai?.parcelas) ? pai.parcelas : [];
        const pendente = parcelas
          .filter((p) => p.status === "PREVISTA")
          .reduce((acc, p) => acc + Number(p?.valorPrevisto || 0), 0);

        // 3) sugere novo número (mantém o padrão raiz-Rn)
        const base = String(pai?.numeroContrato || "").trim() || String(id);
        const m = base.match(/^(.*?)(-R(\d+))?$/i);
        const root = m ? m[1] : base;

        let nextR = 1;

        // calcula pelo que já existe na lista (mais robusto que depender da cadeia)
        try {
          const re = new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-R(\\d+)$`, "i");
          let maxR = 0;

          for (const r of rows || []) {
            const num = String(r?.numeroContrato || "").trim();
            const mm = num.match(re);
            if (mm) {
              const n = Number(mm[1]);
              if (Number.isFinite(n)) maxR = Math.max(maxR, n);
            }
          }

          nextR = maxR > 0 ? maxR + 1 : 1;
        } catch {
          nextR = 1;
        }

        const novoNumero = `${root}-R${nextR}`;

        // 4) abre modal com campos pré-preenchidos
        resetNovo();
        setRenegociarId(Number(id));
        setNumeroContrato(novoNumero);

        // cliente do contrato pai (prioriza clienteId, senão cliente.id)
        const cid = pai?.clienteId ?? pai?.cliente?.id ?? "";
        setClienteId(cid ? String(cid) : "");

        // mantém observações atuais do pai e adiciona a linha de renegociação (sem duplicar)
        const baseObs = String(pai?.observacoes || "").trim();
        // 🔒 NÃO adiciona texto automático aqui.
        // O backend já normaliza e grava a mensagem correta.
        setObservacoes(String(pai?.observacoes || "").trim());

        // pendente vem em number (reais) -> converter para dígitos centavos (máscara)
        const cents = Math.round((Number(pendente) || 0) * 100);
        setValorTotalDigits(String(cents));

        setModalError("");
        setOpenNovo(true);
        await loadClientes();

        // 5) limpa o query param pra não reabrir
        navigate("/pagamentos", { replace: true });
      } catch (e) {
        navigate("/pagamentos", { replace: true });
        addToast(e?.message || "Falha ao preparar renegociação.", "error"); // ✅ SUBSTITUIR
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, location.search, rows]);

  useEffect(() => {
    if (!openParcelas || !selectedContrato) return;
    const fresh = rows.find((r) => r.id === selectedContrato.id);
    if (fresh) setSelectedContrato(fresh);
  }, [rows, openParcelas, selectedContrato]);

  function resetNovo() {
    setClienteId("");
    setNumeroContrato("");
    setValorTotalDigits("");
    setFormaPagamento("AVISTA");
    setAvistaVenc("");
    setParcelasQtd("3");
    setParcelasPrimeiroVenc("");
    setEntradaValorDigits("");
    setEntradaVenc("");
    setEntradaParcelasQtd("3");
    setEntradaParcelasPrimeiroVenc("");
    setObservacoes("");
    setIsentoTributacao(false);
  }

  function clearFilters() {
    setFilterStatus("");
    setFilterForma("");
    setFilterAdvogadoId("");
    setFilterDateDe("");
    setFilterDateAte("");
  }

  function openNovoContrato() {
    resetNovo();
    setModalError("");
    setFe({});
    setOpenNovo(true);
    loadClientes();

    // Prefill do número do contrato (AAAAMMDDSSS), mas mantendo editável
    (async () => {
      try {
        const r = await apiFetch("/contratos/next-numero");
        if (r?.numeroContrato || r?.numero) {
          setNumeroContrato(r.numeroContrato || r.numero);
        }
      } catch (e) {
        // se falhar, não bloqueia o modal
        console.warn("Falha ao buscar next-numero do contrato:", e);
      }
    })();
  }

  function openParcelasModal(contrato) {
    setSelectedContrato(contrato);
    setOpenParcelas(true);
  }

  async function toggleContrato(contrato) {
    setLoading(true);
    try {
      await apiFetch(`/contratos/${contrato.id}/toggle`, { method: "PATCH" });
      await load();
      addToast("Contrato atualizado com sucesso!", "success"); // ✅ ADICIONAR
    } catch (e) {
      addToast(e?.message || "Falha ao ativar/inativar contrato.", "error"); // ✅ SUBSTITUIR
    } finally {
      setLoading(false);
    }
  }

  function validateNovo() {
    if (!clienteId) return "Selecione o cliente.";
    if (!String(numeroContrato || "").trim()) return "Informe o número do contrato.";
    if (!valorTotalDigits) return "Informe o valor total.";

    const total = BigInt(onlyDigits(valorTotalDigits) || "0");
    if (total <= 0n) return "O valor total precisa ser maior que zero.";

    if (formaPagamento === "AVISTA") {
      if (!parseDateDDMMYYYY(avistaVenc)) return "Informe um vencimento válido (DD/MM/AAAA) para o à vista.";
    }

    if (formaPagamento === "PARCELADO") {
      const n = Number(parcelasQtd || 0);
      if (!n || n < 1) return "Informe a quantidade de parcelas.";
      if (!parseDateDDMMYYYY(parcelasPrimeiroVenc)) return "Informe o primeiro vencimento (DD/MM/AAAA).";
    }

    if (formaPagamento === "ENTRADA_PARCELAS") {
      const entrada = BigInt(onlyDigits(entradaValorDigits) || "0");
      if (entrada <= 0n) return "Informe o valor da entrada.";
      if (!parseDateDDMMYYYY(entradaVenc)) return "Informe o vencimento da entrada (DD/MM/AAAA).";

      const n = Number(entradaParcelasQtd || 0);
      if (!n || n < 1) return "Informe a quantidade de parcelas após a entrada.";
      if (!parseDateDDMMYYYY(entradaParcelasPrimeiroVenc)) return "Informe o primeiro vencimento das parcelas (DD/MM/AAAA).";

      if (entrada >= total) return "A entrada deve ser menor que o valor total.";
    }

    return null;
  }

  async function salvarContrato() {
    const msg = validateNovo();
    if (msg) {
      // Destacar o campo específico com erro
      if (msg.includes("cliente")) feSet("clienteId", msg);
      else if (msg.includes("número")) feSet("numero", msg);
      else if (msg.includes("valor")) feSet("valor", msg);
      else setModalError(msg);
      return;
    }

    setFe({});
    setModalError("");
    setLoading(true);
    try {
      const payload = {
        clienteId: Number(clienteId),
        numeroContrato: String(numeroContrato).trim(),
        valorTotal: onlyDigits(valorTotalDigits),
        formaPagamento,
        observacoes: observacoes ? String(observacoes).trim() : null,
        ...(renegociarId ? {} : {isentoTributacao: Boolean(isentoTributacao) }),
      };

      if (formaPagamento === "AVISTA") {
        payload.avista = { vencimento: avistaVenc };
      }

      if (formaPagamento === "PARCELADO") {
        payload.parcelas = {
          quantidade: Number(parcelasQtd),
          primeiroVencimento: parcelasPrimeiroVenc,
        };
      }

      if (formaPagamento === "ENTRADA_PARCELAS") {
        payload.entrada = { valor: onlyDigits(entradaValorDigits), vencimento: entradaVenc };
        payload.parcelas = {
          quantidade: Number(entradaParcelasQtd),
          primeiroVencimento: entradaParcelasPrimeiroVenc,
        };
      }

      if (renegociarId) {
        await apiFetch(`/contratos/${renegociarId}/renegociar`, { method: "POST", body: payload });
        addToast("Contrato renegociado com sucesso!", "success"); // ✅ ADICIONAR
        setRenegociarId(null);
      } else {
        await apiFetch("/contratos", { method: "POST", body: payload });
        addToast("Contrato criado com sucesso!", "success"); // ✅ ADICIONAR
      }
      setOpenNovo(false);
      await load();
    } catch (e) {
      setModalError(e?.message || "Falha ao salvar contrato.");
    } finally {
      setLoading(false);
    }
  }

  async function loadContas() {
    try {
      const data = await apiFetch("/livro-caixa/contas");
      setContas(Array.isArray(data) ? data : (data?.contas || []));
    } catch {
      setContas([]);
    }
  }

  function openConfirmParcela(parcela) {
    setConfParcela(parcela);
    setConfData(toDDMMYYYY(new Date()));
    setConfMeio(String(parcela?.meioRecebimento || "PIX"));
    const cents = Math.round(Number(parcela?.valorPrevisto || 0) * 100);
    setConfValorDigits(String(Math.max(0, cents)));
    setConfErrMsg("");
    setFe({});
    setConfOpen(true);
    setConfContaId("");
    loadContas();
  }

  function openCancelParcela(parcela) {
    setCancelParcela(parcela);
    setCancelMotivo("");
    setCancelOpen(true);
  }

  async function cancelarParcela() {
    if (!cancelParcela) return;

    const motivo = String(cancelMotivo || "").trim();
    if (!motivo) {
      addToast("Motivo do cancelamento é obrigatório.", "error"); // ✅ SUBSTITUIR
      return;
    }

    setCanceling(true);
    try {
      await apiFetch(`/parcelas/${cancelParcela.id}/cancelar`, {
        method: "PATCH",
        body: { motivo },
      });

      setSelectedContrato((prev) => {
        if (!prev) return prev;
        const parcelas = (prev.parcelas || []).map((p) =>
          p.id === cancelParcela.id
            ? { ...p, status: "CANCELADA", motivoCancelamento: motivo }
            : p
        );
        return { ...prev, parcelas };
      });

      setCancelOpen(false);
      setCancelParcela(null);
      setCancelMotivo("");
      addToast("Parcela cancelada com sucesso!", "success"); // ✅ ADICIONAR

      await load();
    } catch (e) {
      addToast(e?.message || "Falha ao cancelar parcela.", "error"); // ✅ SUBSTITUIR
    } finally {
      setCanceling(false);
    }
  }

  async function confirmarRecebimento() {
    if (!confParcela) return;

    if (!parseDateDDMMYYYY(confData)) {
      setConfErrMsg("Data de recebimento inválida (DD/MM/AAAA).");
      return;
    }

    const previstoCents = Math.round(Number(confParcela?.valorPrevisto || 0) * 100);
    const recebidoCents = Number(onlyDigits(confValorDigits) || "0");

    if (!recebidoCents || recebidoCents <= 0) {
      setConfErrMsg("Informe o valor recebido.");
      return;
    }

    // Regra: nunca permitir receber menos que o previsto
    if (previstoCents > 0 && recebidoCents < previstoCents) {
      setConfErrMsg("Não é permitido receber valor menor que o previsto da parcela.");
      return;
    }

    // Se for maior, exige confirmação extra (juros/multa/outros acréscimos)
    if (previstoCents > 0 && recebidoCents > previstoCents) {
      const diffCents = recebidoCents - previstoCents;
      setConfExtraResumo({ previstoCents, recebidoCents, diffCents });
      setConfExtraOpen(true);
      return;
    }

    // Igual ao previsto -> confirma direto
    await doConfirmarRecebimento();
  }

  async function doConfirmarRecebimento() {
    if (!confParcela) return;

    setConfErrMsg("");
    setConfirming(true);

    if (!confContaId) {
      setConfErrMsg("Selecione a conta para registrar o recebimento.");
      return;
    }

    try {
      const body = {
        dataRecebimento: confData,
        meioRecebimento: confMeio,
        valorRecebido: onlyDigits(confValorDigits),
        contaId: Number(confContaId),
      };

      await apiFetch(`/parcelas/${confParcela.id}/confirmar`, { method: "PATCH", body });

      setConfOpen(false);
      setConfExtraOpen(false);
      addToast("Recebimento confirmado com sucesso!", "success"); // ✅ ADICIONAR
      await load();
    } catch (e) {
      setConfErrMsg(e?.message || "Falha ao confirmar recebimento.");
    } finally {
      setConfirming(false);
    }
  }
    
  async function fetchContrato(id) {
    try {
      const data = await apiFetch(`/contratos/${id}`);
      setSelectedContrato(data);
      setRows(prev => prev.map(r => r.id === id ? data : r));
    } catch {
      await load();
    }
  }

  // Parcelas selecionáveis = PREVISTA ou ATRASADA
  const parcelasSelecionalveis = (selectedContrato?.parcelas || []).filter(
    p => p.status === 'PREVISTA' || p.status === 'ATRASADA'
  );
  const allSelected = parcelasSelecionalveis.length > 0 && parcelasSelecionalveis.every(p => selectedParcelas.has(p.id));

  function toggleParcela(id) {
    setSelectedParcelas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedParcelas(new Set());
    } else {
      setSelectedParcelas(new Set(parcelasSelecionalveis.map(p => p.id)));
    }
  }

  async function executeBulkConfirm() {
    const ids = [...selectedParcelas];
    const parcelas = (selectedContrato?.parcelas || []).filter(p => ids.includes(p.id));
    setBulkProcessing(true);
    setBulkProgress({ done: 0, total: parcelas.length });
    let erros = 0;
    for (let i = 0; i < parcelas.length; i++) {
      const p = parcelas[i];
      try {
        const dataStr = confData ? (confData.includes('/') ? confData.split('/').reverse().join('-') : confData) : new Date().toISOString().slice(0, 10);
        await apiFetch(`/parcelas/${p.id}/confirmar`, {
          method: 'PATCH',
          body: {
            dataRecebimento: dataStr,
            meioRecebimento: confMeio || 'PIX',
            valorRecebido: String(Math.round(Number(p.valorPrevisto) * 100)),
            contaId: confContaId ? Number(confContaId) : null,
          },
        });
      } catch {
        erros++;
      }
      setBulkProgress({ done: i + 1, total: parcelas.length });
    }
    setBulkProcessing(false);
    setBulkConfirmOpen(false);
    setSelectedParcelas(new Set());
    if (erros > 0) addToast(`${erros} parcela(s) com erro.`, 'warning');
    else addToast(`${parcelas.length} parcela(s) confirmada(s).`, 'success');
    await fetchContrato(selectedContrato.id);
  }

  async function executeBulkCancel() {
    if (!bulkCancelMotivo.trim()) return;
    const ids = [...selectedParcelas];
    setBulkProcessing(true);
    setBulkProgress({ done: 0, total: ids.length });
    let erros = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        await apiFetch(`/parcelas/${ids[i]}/cancelar`, {
          method: 'PATCH',
          body: { motivo: bulkCancelMotivo },
        });
      } catch {
        erros++;
      }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setBulkProcessing(false);
    setBulkCancelOpen(false);
    setSelectedParcelas(new Set());
    setBulkCancelMotivo('');
    if (erros > 0) addToast(`${erros} parcela(s) com erro.`, 'warning');
    else addToast(`${ids.length} parcela(s) cancelada(s).`, 'success');
    await fetchContrato(selectedContrato.id);
  }

  const [exporting, setExporting] = useState(false);

  async function exportXLSX() {
    if (!filtered.length) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const STATUS_LABEL = { ATIVO: "Ativo", QUITADO: "Quitado", CANCELADO: "Cancelado", RENEGOCIADO: "Renegociado", EM_ATRASO: "Em atraso" };
      const FORMA_LABEL = { AVISTA: "À vista", PARCELADO: "Parcelado", ENTRADA_PARCELAS: "Entrada+Parcelas" };
      const wsData = [["Nº Contrato", "Cliente", "Forma", "Status", "Valor Total (R$)", "Parcelas", "Pagas", "Em atraso", "Advogado"]];
      for (const c of filtered) {
        const parcelas = c.parcelas || [];
        const pagas = parcelas.filter(p => p.status === "RECEBIDA" || p.status === "REPASSE_EFETUADO").length;
        const atrasadas = parcelas.filter(p => p.status === "ATRASADA").length;
        wsData.push([
          c.numeroContrato,
          c.cliente?.nomeRazaoSocial || "",
          FORMA_LABEL[c.formaPagamento] || c.formaPagamento,
          STATUS_LABEL[computeStatusContrato(c)] || computeStatusContrato(c),
          Number(c.valorTotal || 0).toFixed(2).replace(".", ","),
          parcelas.length,
          pagas,
          atrasadas,
          c.repasseAdvogadoPrincipal?.nome || "",
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Contratos");
      XLSX.writeFile(wb, `contratos_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      addToast("Erro ao exportar Excel.", "error");
    } finally {
      setExporting(false);
    }
  }

  const advogadoOptions = useMemo(() => {
    const map = new Map();
    for (const c of rows || []) {
      const princ = c?.repasseAdvogadoPrincipal;
      if (princ?.id && princ?.nome) map.set(princ.id, { id: princ.id, nome: princ.nome });
      const indic = c?.repasseIndicacaoAdvogado;
      if (indic?.id && indic?.nome) map.set(indic.id, { id: indic.id, nome: indic.nome });
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [rows]);

  const hasActiveFilters = !!(filterStatus || filterForma || filterAdvogadoId || filterDateDe || filterDateAte);

  const filtered = useMemo(() => {
    let result = rows || [];

    // 1) Text search
    const qq = String(q || "").trim().toLowerCase();
    if (qq) {
      const qDigits = onlyDigits(qq);
      result = result.filter((c) => {
        const numero = String(c?.numeroContrato || "").toLowerCase();
        const nome = String(c?.cliente?.nomeRazaoSocial || "").toLowerCase();
        const cpf = onlyDigits(c?.cliente?.cpfCnpj || "");
        return (
          numero.includes(qq) ||
          nome.includes(qq) ||
          (qDigits && cpf.includes(qDigits))
        );
      });
    }

    // 2) Contract status
    if (filterStatus) {
      result = result.filter((c) => computeStatusContrato(c) === filterStatus);
    }

    // 3) Payment method
    if (filterForma) {
      result = result.filter((c) => String(c?.formaPagamento || "").toUpperCase() === filterForma);
    }

    // 4) Advogado
    if (filterAdvogadoId) {
      const advId = Number(filterAdvogadoId);
      result = result.filter((c) =>
        c?.repasseAdvogadoPrincipal?.id === advId || c?.repasseIndicacaoAdvogado?.id === advId
      );
    }

    // 5) Date range (parcela vencimento)
    if (filterDateDe || filterDateAte) {
      const de = filterDateDe ? toDateOnly(filterDateDe) : null;
      const ate = filterDateAte ? toDateOnly(filterDateAte) : null;
      result = result.filter((c) => {
        const parcelas = c?.parcelas || [];
        if (!parcelas.length) return false;
        return parcelas.some((p) => {
          const venc = toDateOnly(p.vencimento);
          if (!venc) return false;
          if (de && venc < de) return false;
          if (ate && venc > ate) return false;
          return true;
        });
      });
    }

    return result;
  }, [rows, q, filterStatus, filterForma, filterAdvogadoId, filterDateDe, filterDateAte]);

  const parcelasDoContrato = selectedContrato?.parcelas || [];

  const totalPrevisto = parcelasDoContrato.reduce(
    (sum, p) => sum + Number(p?.valorPrevisto || 0),
    0
  );

  const totalRecebido = parcelasDoContrato
    .filter((p) => p.status === "RECEBIDA" || p.status === "REPASSE_EFETUADO")
    .reduce((sum, p) => sum + Number(p?.valorRecebido || 0), 0);

  // ✅ Base de comparação SEM acréscimos
  const totalRecebidoSemAcrescimo = parcelasDoContrato.reduce((sum, p) => {
    if (p?.status !== "RECEBIDA" && p?.status !== "REPASSE_EFETUADO") return sum;

    const vp = Number(p?.valorPrevisto || 0);
    const vr = Number(p?.valorRecebido || 0);

    if (!vr || vr <= 0) return sum;

    return sum + Math.min(vr, vp);
  }, 0);

  // ✅ Diferença do TOTAL agora ignora acréscimos
  const diferencaTotais = totalRecebidoSemAcrescimo - totalPrevisto;

  const searchRow = (
    <div className="flex items-center gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por contrato, cliente, CPF/CNPJ…"
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"  
      />
      <Tooltip content="Atualizar lista de contratos">
        <button
          type="button"
          onClick={() => load()}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
          disabled={loading}
          title="Atualizar"
        >
          Atualizar
        </button>
      </Tooltip>
    </div>
  );

  const filterRow = (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="block min-w-[160px]">
        <span className="text-xs font-medium text-slate-600">Status</span>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        >
          <option value="">Todos</option>
          <option value="EM_DIA">Em dia</option>
          <option value="ATRASADO">Atrasado</option>
          <option value="QUITADO">Quitado</option>
          <option value="CANCELADO">Cancelado</option>
          <option value="RENEGOCIADO">Renegociado</option>
        </select>
      </label>

      <label className="block min-w-[170px]">
        <span className="text-xs font-medium text-slate-600">Forma de pagamento</span>
        <select
          value={filterForma}
          onChange={(e) => setFilterForma(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        >
          <option value="">Todos</option>
          <option value="AVISTA">{"\u00C0"} vista</option>
          <option value="PARCELADO">Parcelado</option>
          <option value="ENTRADA_PARCELAS">Entrada + Parcelas</option>
        </select>
      </label>

      <label className="block min-w-[200px]">
        <span className="text-xs font-medium text-slate-600">Advogado</span>
        <select
          value={filterAdvogadoId}
          onChange={(e) => setFilterAdvogadoId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        >
          <option value="">Todos</option>
          {advogadoOptions.map((adv) => (
            <option key={adv.id} value={String(adv.id)}>{adv.nome}</option>
          ))}
        </select>
      </label>

      <label className="block min-w-[150px]">
        <span className="text-xs font-medium text-slate-600">Vencimento de</span>
        <input
          type="date"
          value={filterDateDe}
          onChange={(e) => setFilterDateDe(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        />
      </label>

      <label className="block min-w-[150px]">
        <span className="text-xs font-medium text-slate-600">Vencimento at{"\u00E9"}</span>
        <input
          type="date"
          value={filterDateAte}
          onChange={(e) => setFilterDateAte(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
        />
      </label>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );

  return (
    <div className="p-6">
      <Card
        title="Recebimentos"
        right={
          <div className="flex gap-2">
            {filtered.length > 0 && (
              <Tooltip content="Exportar lista filtrada para Excel">
                <button
                  type="button"
                  onClick={exportXLSX}
                  disabled={exporting}
                  className="rounded-xl border border-green-600 bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 transition disabled:opacity-70"
                >
                  {exporting ? "…" : "⬇ XLSX"}
                </button>
              </Tooltip>
            )}
            {isAdmin && (
              <>
                <Tooltip content="Criar novo contrato de pagamento">
                  <button
                    type="button"
                    onClick={openNovoContrato}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition disabled:opacity-70"
                    disabled={loading}
                  >
                    + Novo Contrato
                  </button>
                </Tooltip>

                <Tooltip content="Criar recebimento avulso (sem contrato)">
                  <button
                    type="button"
                    onClick={() => navigate("/pagamentos-avulsos")}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
                    disabled={loading}
                  >
                    + Novo Recebimento
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        }
      >
        {searchRow}
        {filterRow}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
        ) : null}

        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Contrato</th>
                <th className="text-left px-4 py-3 font-semibold min-w-[320px]">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Valor total</th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Valor recebido</th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Valor pendente</th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Forma</th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Parcelas</th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                <th className="text-right px-4 py-3 font-semibold whitespace-nowrap">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {filtered.map((c) => {
                const parcelas = c?.parcelas || [];
                const qtdParcelas = c?.resumo?.qtdParcelas ?? c?.totais?.totalParcelas ?? parcelas.length;
                const qtdRecebidas =
                  c?.resumo?.qtdRecebidas ?? c?.totais?.parcelasRecebidas ?? parcelas.filter((p) => p.status === "RECEBIDA" || p.status === "REPASSE_EFETUADO").length;

                const st = computeStatusContrato(c);
                const status = st === "ATRASADO"
                ? { label: "Atrasado", tone: "red" }
                  : st === "RENEGOCIADO"
                ? { label: "Renegociado", tone: "amber" }
                  : st === "QUITADO"
                ? { label: "Quitado", tone: "green" }
                  : st === "CANCELADO"
                ? { label: "Cancelado", tone: "slate" }
                  : { label: "Em dia", tone: "blue" };
 
                const totalRecebidoLinha =
                  Number(
                    parcelas
                      .filter((p) => p.status === "RECEBIDA" || p.status === "REPASSE_EFETUADO")
                      .reduce((sum, p) => sum + Number(p?.valorRecebido || 0), 0)
                ) || 0;

                const valorTotalLinha = Number(c?.valorTotal || 0) || 0;
                const pendenteLinha = Math.max(0, valorTotalLinha - totalRecebidoLinha);

                return (
                  <tr key={c.id} className="bg-white">
                    <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {isAdmin ? (
                        <Link to={`/contratos/${c.id}`} className="hover:underline" title="Abrir contrato">
                          {c.numeroContrato}
                        </Link>
                      ) : (
                        <span title="Contrato (admin-only)">{c.numeroContrato}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{c?.cliente?.nomeRazaoSocial || "—"}</td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">R$ {formatBRLFromDecimal(c.valorTotal)}</td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                      R$ {formatBRLFromDecimal(totalRecebidoLinha)}
                    </td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                      R$ {formatBRLFromDecimal(pendenteLinha)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{normalizeForma(c.formaPagamento)}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {qtdRecebidas}/{qtdParcelas}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">

                        {st !== "RENEGOCIADO" && st !== "CANCELADO" ? (
                          <Tooltip content="Ver e gerenciar parcelas do contrato">
                            <button
                              type="button"
                              onClick={() => openParcelasModal(c)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                              disabled={loading}
                            >
                              Parcelas
                            </button>
                          </Tooltip>
                        ) : (
                          <span className="text-slate-400 text-sm">—</span>
                        )}

                        <Can when={isAdmin && st !== "QUITADO" && st !== "RENEGOCIADO"}>
                          <button
                            type="button"
                            onClick={() => toggleContrato(c)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                            disabled={loading}
                          >
                            {c?.ativo ? "Inativar" : "Ativar"}
                          </button>
                        </Can>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!filtered.length ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      compact
                      icon={loading ? null : "📄"}
                      title={loading ? "Carregando..." : "Nenhum contrato encontrado."}
                      description={!loading && "Ajuste os filtros ou crie um novo contrato."}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------- Modal: Novo Contrato ---------- */}
      <Modal
        open={openNovo}
        title="Novo Contrato de Pagamento"
        onClose={() => { setOpenNovo(false); setModalError(""); }}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpenNovo(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvarContrato}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              disabled={loading}
            >
              Salvar
            </button>
          </div>
        }
      >
        {modalError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {modalError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Select
              label="Cliente *"
              value={clienteId}
              onChange={(v) => { setClienteId(v); feClear("clienteId"); }}
              disabled={loading || !!renegociarId}
            >
              <option value="">Selecione…</option>
              {clientes.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.nomeRazaoSocial}
                </option>
              ))}
            </Select>
            {fe.clienteId && <p className="mt-1 text-xs text-red-600 font-medium">{fe.clienteId}</p>}
          </div>

          <Input
            label="Número do contrato *"
            value={numeroContrato}
            onChange={(v) => { setNumeroContrato(v); feClear("numero"); }}
            onBlur={() => { if (!String(numeroContrato || "").trim()) feSet("numero", "Número do contrato obrigatório."); else feClear("numero"); }}
            placeholder="Ex.: 20250904001A"
            disabled={loading || !!renegociarId}
            error={fe.numero}
          />

          <label className="block">
            <div className="text-sm font-medium text-slate-700">Valor total *</div>
            <div className="mt-1 relative">
              <input
                className={`w-full rounded-xl border pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50
                  ${fe.valor ? "border-red-400 focus:ring-red-200 bg-red-50" : "border-slate-300 focus:ring-slate-200 bg-white"}`}
                value={maskBRLFromDigits(valorTotalDigits)}
                onChange={(e) => { setValorTotalDigits(onlyDigits(e.target.value)); feClear("valor"); }}
                onBlur={() => {
                  const v = BigInt(onlyDigits(valorTotalDigits) || "0");
                  if (v <= 0n) feSet("valor", "Informe um valor maior que zero.");
                  else feClear("valor");
                }}
                placeholder="0,00"
                disabled={loading || !!renegociarId}
                inputMode="numeric"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">R$</div>
            </div>
            {fe.valor
              ? <p className="mt-1 text-xs text-red-600 font-medium">{fe.valor}</p>
              : <div className="mt-1 text-xs text-slate-500">Digite normalmente: 1→0,01; 12→0,12; 123→1,23; 123456→1.234,56</div>
            }
          </label>

          <Select label="Forma de pagamento" value={formaPagamento} onChange={setFormaPagamento} disabled={loading}>
            <option value="AVISTA">À vista</option>
            <option value="PARCELADO">Parcelado</option>
            <option value="ENTRADA_PARCELAS">Entrada + Parcelas</option>
          </Select>

          {!renegociarId && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={!!isentoTributacao}
                onChange={(e) => setIsentoTributacao(e.target.checked)}
                disabled={loading}
              />
              <span>Isento de tributação</span>
            </div>

          )}

        </div>

        {/* detalhamento conforme forma */}
        {formaPagamento === "AVISTA" ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <DateInput
            label="Vencimento (à vista) *"
            value={avistaVenc}
            onChange={(v) => { setAvistaVenc(v); feClear("avistaVenc"); }}
            onBlur={() => { if (!parseDateDDMMYYYY(avistaVenc)) feSet("avistaVenc", "Informe o vencimento (DD/MM/AAAA)."); else feClear("avistaVenc"); }}
            error={fe.avistaVenc}
            disabled={loading}
          />
          </div>
        ) : null}

        {formaPagamento === "PARCELADO" ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Quantidade de parcelas *"
              value={parcelasQtd}
              onChange={(v) => { setParcelasQtd(onlyDigits(v)); feClear("parcelasQtd"); }}
              onBlur={() => { const n = Number(parcelasQtd || 0); if (!n || n < 1) feSet("parcelasQtd", "Informe ao menos 1 parcela."); else feClear("parcelasQtd"); }}
              error={fe.parcelasQtd}
              placeholder="Ex.: 6"
              disabled={loading}
              inputMode="numeric"
            />
            <DateInput
              label="1º vencimento *"
              value={parcelasPrimeiroVenc}
              onChange={(v) => { setParcelasPrimeiroVenc(v); feClear("parcelasVenc"); }}
              onBlur={() => { if (!parseDateDDMMYYYY(parcelasPrimeiroVenc)) feSet("parcelasVenc", "Informe o primeiro vencimento."); else feClear("parcelasVenc"); }}
              error={fe.parcelasVenc}
              disabled={loading}
            />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 flex items-center">
              O backend divide o valor automaticamente e ajusta os centavos.
            </div>
          </div>
        ) : null}

        {formaPagamento === "ENTRADA_PARCELAS" ? (
          <div className="mt-4 space-y-4">
            {/* Linha 1: Entrada (valor e vencimento) + vencimento 1ª parcela */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <div className="text-sm font-medium text-slate-700">Valor Entrada *</div>
                <div className="mt-1 relative">
                  <input
                    className={`w-full rounded-xl border pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50
                      ${fe.entradaValor ? "border-red-400 focus:ring-red-200 bg-red-50" : "border-slate-300 focus:ring-slate-200 bg-white"}`}
                    value={maskBRLFromDigits(entradaValorDigits)}
                    onChange={(e) => { setEntradaValorDigits(onlyDigits(e.target.value)); feClear("entradaValor"); }}
                    onBlur={() => { const v = BigInt(onlyDigits(entradaValorDigits) || "0"); if (v <= 0n) feSet("entradaValor", "Informe o valor da entrada."); else feClear("entradaValor"); }}
                    placeholder="0,00"
                    disabled={loading}
                    inputMode="numeric"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">R$</div>
                </div>
                {fe.entradaValor && <p className="mt-1 text-xs text-red-600 font-medium">{fe.entradaValor}</p>}
              </label>

              <DateInput
                label="Vencimento Entrada *"
                value={entradaVenc}
                onChange={(v) => { setEntradaVenc(v); feClear("entradaVenc"); }}
                onBlur={() => { if (!parseDateDDMMYYYY(entradaVenc)) feSet("entradaVenc", "Informe o vencimento da entrada."); else feClear("entradaVenc"); }}
                error={fe.entradaVenc}
                disabled={loading}
              />

              <DateInput
                label="Vencimento 1ª Parcela *"
                value={entradaParcelasPrimeiroVenc}
                onChange={(v) => { setEntradaParcelasPrimeiroVenc(v); feClear("entradaParcelasVenc"); }}
                onBlur={() => { if (!parseDateDDMMYYYY(entradaParcelasPrimeiroVenc)) feSet("entradaParcelasVenc", "Informe o vencimento da 1ª parcela."); else feClear("entradaParcelasVenc"); }}
                error={fe.entradaParcelasVenc}
                disabled={loading}
              />
            </div>
   
            {/* Linha 2: Quantidade de parcelas + aviso */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Qtd. parcelas (após entrada) *"
                value={entradaParcelasQtd}
                onChange={(v) => { setEntradaParcelasQtd(onlyDigits(v)); feClear("entradaParcelasQtd"); }}
                onBlur={() => { const n = Number(entradaParcelasQtd || 0); if (!n || n < 1) feSet("entradaParcelasQtd", "Informe ao menos 1 parcela."); else feClear("entradaParcelasQtd"); }}
                error={fe.entradaParcelasQtd}
                placeholder="Ex.: 5"
                disabled={loading}
                inputMode="numeric"
              />

              <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 flex items-center">
                A entrada fica como parcela nº 1. O backend divide o restante automaticamente e ajusta os centavos.
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <Textarea label="Observações" value={observacoes} onChange={setObservacoes} placeholder="Notas internas…" disabled={loading} />
        </div>
      </Modal>

      {/* ---------- Modal: Parcelas ---------- */}
      <Modal
        open={openParcelas}
        title={
          selectedContrato
            ? `Controle de Parcelas do Contrato ${selectedContrato.numeroContrato} - ${selectedContrato?.cliente?.nomeRazaoSocial || ""}`
            : "Controle de Parcelas"
        }
        onClose={() => { setOpenParcelas(false); setSelectedParcelas(new Set()); }}
        footer={
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setOpenParcelas(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Fechar
            </button>
          </div>
        }
      >
        {!selectedContrato ? (
          <div className="text-sm text-slate-600">Selecione um contrato.</div>
        ) : (
          <div className="space-y-4">
            {isAdmin && selectedParcelas.size > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, marginBottom: 8,
              }}>
                <span style={{ fontSize: 13, color: '#1d4ed8', fontWeight: 600 }}>
                  {selectedParcelas.size} selecionada(s)
                </span>
                <button
                  onClick={() => { setConfData(toDDMMYYYY(new Date())); setConfMeio('PIX'); setConfContaId(''); loadContas(); setBulkConfirmOpen(true); }}
                  style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #16a34a', background: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >Confirmar Selecionadas</button>
                <button
                  onClick={() => { setBulkCancelMotivo(''); setBulkCancelOpen(true); }}
                  style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #dc2626', background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >Cancelar Selecionadas</button>
                <button
                  onClick={() => setSelectedParcelas(new Set())}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #94a3b8', background: '#f1f5f9', color: '#475569', fontSize: 12, cursor: 'pointer' }}
                >Desmarcar</button>
              </div>
            )}
            <div className="overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    {isAdmin && (
                      <th style={{ padding: '8px', width: 32 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          title="Selecionar todas PREVISTAS/ATRASADAS"
                        />
                      </th>
                    )}
                    <th className="text-left px-4 py-3 font-semibold">#</th>
                    <th className="text-left px-4 py-3 font-semibold">Vencimento</th>
                    <th className="text-left px-4 py-3 font-semibold">Previsto</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-left px-4 py-3 font-semibold">Recebido</th>
                    <th className="text-left px-4 py-3 font-semibold">Diferença</th>
                    <th className="text-left px-4 py-3 font-semibold">Meio</th>
                    <th className="text-right px-4 py-3 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(selectedContrato.parcelas || []).map((p) => (
                    <tr key={p.id} className="bg-white">
                      {isAdmin && (
                        <td style={{ padding: '8px', width: 32 }}>
                          {(p.status === 'PREVISTA' || p.status === 'ATRASADA') && (
                            <input
                              type="checkbox"
                              checked={selectedParcelas.has(p.id)}
                              onChange={() => toggleParcela(p.id)}
                            />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 font-semibold text-slate-900">{p.numero}</td>
                      <td className="px-4 py-3 text-slate-800">{toDDMMYYYY(p.vencimento)}</td>
                      <td className="px-4 py-3 text-slate-800">R$ {formatBRLFromDecimal(p.valorPrevisto)}</td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.status === "CANCELADA" ? (
                          <div className="space-y-1">
                            <Badge tone="slate">Cancelada</Badge>
                            <div className="text-xs text-slate-500">
                              {p.canceladaEm ? `Cancelada em ${toDDMMYYYY(p.canceladaEm)}` : "Cancelada"}
                              {p.canceladaPor?.nome ? ` por ${p.canceladaPor.nome}` : ""}
                            </div>
                            {p.cancelamentoMotivo ? (
                              <div className="text-xs text-slate-500 truncate max-w-[260px]" title={p.cancelamentoMotivo}>
                                Motivo: {p.cancelamentoMotivo}
                              </div>
                            ) : null}
                          </div>
                        ) : p.status === "RECEBIDA" ? (
                          <Badge tone="green">Recebida</Badge>
                        ) : p.status === "REPASSE_EFETUADO" ? (
                          <Badge tone="green">Repasse efetuado</Badge>
                        ) : isParcelaAtrasada(p) ? (
                          <Badge tone="red">Atrasada</Badge>
                        ) : (
                          <Badge tone="blue">Prevista</Badge>
                        )}
                        {/* ✅ Debug temporário */}
                        {process.env.NODE_ENV === 'development' && (
                          <div className="text-[10px] text-slate-400 mt-1">
                            DB: {p.status}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-slate-800">
                        {p.valorRecebido ? `R$ ${formatBRLFromDecimal(p.valorRecebido)}` : "—"}
                        {p.dataRecebimento ? (
                          <div className="text-xs text-slate-500 mt-1">{toDDMMYYYY(p.dataRecebimento)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                        {(() => {
                          const diff = Number(p?.valorRecebido || 0) - Number(p?.valorPrevisto || 0);
                          if (!Number.isFinite(diff) || diff <= 0) return "—";
                          return `+R$ ${formatBRLFromDecimal(diff)}`;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{p.meioRecebimento || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {isAdmin && p.status === "PREVISTA" ? (
                            <Tooltip content="Confirmar recebimento desta parcela">
                              <button
                                type="button"
                                onClick={() => openConfirmParcela(p)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                              >
                                Receber Parcela
                              </button>
                            </Tooltip>
                          ) : isAdmin && (p.status === "RECEBIDA" || p.status === "REPASSE_EFETUADO") ? (
                            <Tooltip content="Corrigir data de recebimento (dados históricos incorretos)">
                              <button
                                type="button"
                                onClick={() => openCorrigirData(p)}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                              >
                                Corrigir data
                              </button>
                            </Tooltip>
                          ) : (
                            <span className="text-slate-400 text-sm">—</span>
                          )}
 
                          {isAdmin && p.status === "PREVISTA" && (() => {
                            const temBoleto = p.boletos?.length > 0;
                            return (
                              <Tooltip content={temBoleto ? "Boleto já emitido — emitir novo?" : "Emitir boleto bancário para esta parcela"}>
                                <button
                                  type="button"
                                  onClick={() => handleEmitirBoleto(p)}
                                  disabled={boletoEmitindo === p.id}
                                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                                    temBoleto
                                      ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                      : "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                                  }`}
                                >
                                  {boletoEmitindo === p.id ? "..." : temBoleto ? "✓ Boleto" : "Boleto"}
                                </button>
                              </Tooltip>
                            );
                          })()}

                          {isAdmin && p.status !== "RECEBIDA" && p.status !== "CANCELADA" ? (
                            <button
                              type="button"
                              onClick={() => openCancelParcela(p)}
                              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                            >
                              Cancelar
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!(selectedContrato.parcelas || []).length ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                        Nenhuma parcela cadastrada.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div>
                <div className="text-slate-500">Total previsto</div>
                <div className="font-semibold text-slate-900">R$ {formatBRLFromDecimal(totalPrevisto)}</div>
              </div>

              <div>
                <div className="text-slate-500">Total recebido</div>
                <div className="font-semibold text-slate-900">R$ {formatBRLFromDecimal(totalRecebido)}</div>
              </div>

              <div>
                <div className="text-slate-500">Diferença</div>
                <div className={`font-semibold ${diferencaTotais < 0 ? "text-red-600" : diferencaTotais > 0 ? "text-blue-600" : "text-slate-900"}`}>
                  R$ {formatBRLFromDecimal(diferencaTotais)}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- Modal: Confirmar recebimento ---------- */}
      <Modal
        open={confOpen}
        title={confParcela ? `Receber Parcela — Parcela ${confParcela.numero}` : "Receber Parcela"}
        onClose={() => { setConfOpen(false); setConfErrMsg(""); }}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              disabled={confirming}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmarRecebimento}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
              disabled={confirming}
            >
              Confirmar
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DateInput
            label="Data do recebimento *"
            value={confData}
            onChange={(v) => { setConfData(v); feClear("confData"); }}
            onBlur={() => { if (!parseDateDDMMYYYY(confData)) feSet("confData", "Data inválida."); else feClear("confData"); }}
            error={fe.confData}
            disabled={confirming}
          />

          <Select label="Meio" value={confMeio} onChange={setConfMeio} disabled={confirming}>
            <option value="PIX">PIX</option>
            <option value="TED">TED</option>
            <option value="BOLETO">BOLETO</option>
            <option value="CARTAO">CARTÃO</option>
            <option value="DINHEIRO">DINHEIRO</option>
            <option value="OUTRO">OUTRO</option>
          </Select>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">Valor recebido (R$) *</div>

            <div className="mt-1 relative">
              <input
                className={`w-full rounded-xl border pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50
                  ${fe.confValor ? "border-red-400 focus:ring-red-200 bg-red-50" : "border-slate-300 focus:ring-slate-200 bg-white"}`}
                value={maskBRLFromDigits(confValorDigits)}
                onChange={(e) => {
                  setConfValorDigits(onlyDigits(e.target.value));
                  if (confErrMsg) setConfErrMsg("");
                  feClear("confValor");
                }}
                onBlur={() => { const v = Number(onlyDigits(confValorDigits) || "0"); if (!v || v <= 0) feSet("confValor", "Informe o valor recebido."); else feClear("confValor"); }}
                placeholder="0,00"
                disabled={confirming}
                inputMode="numeric"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">R$</div>
            </div>

            {fe.confValor
              ? <p className="mt-1 text-xs text-red-600 font-medium">{fe.confValor}</p>
              : <div className="mt-1 text-xs text-slate-500">
                  Deve ser <strong>igual ou maior</strong> que o valor previsto da parcela. Se for maior, o complemento será tratado como{" "}
                  <strong>juros/multa/outros acréscimos</strong>.
                </div>
            }
          </label>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Conta (obrigatória)</div>
            <select
              value={confContaId}
              onChange={(e) => { setConfContaId(e.target.value); feClear("confConta"); }}
              onBlur={() => { if (!confContaId) feSet("confConta", "Selecione a conta."); else feClear("confConta"); }}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: fe.confConta ? "1px solid #f87171" : "1px solid #ddd", background: fe.confConta ? "#fef2f2" : "white" }}
            >
              <option value="">— selecione —</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            {fe.confConta && <p className="mt-1 text-xs text-red-600 font-medium">{fe.confConta}</p>}
          </div>

        </div>
        {confErrMsg && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {confErrMsg}
          </div>
        )}
      </Modal>

      {/* ---------- Modal: Confirmação de complemento (recebido > previsto) ---------- */}
      <Modal
        open={confExtraOpen}
        title="Confirmar recebimento com acréscimos"
        onClose={() => (!confirming ? setConfExtraOpen(false) : null)}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfExtraOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              disabled={confirming}
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={doConfirmarRecebimento}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
              disabled={confirming}
            >
              Confirmar e gravar
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">Valor previsto</div>
            <div className="mt-1 font-semibold text-slate-900">
              R$ {formatBRLFromDecimal(confExtraResumo.previstoCents / 100)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">Valor recebido (informado)</div>
            <div className="mt-1 font-semibold text-slate-900">
              R$ {formatBRLFromDecimal(confExtraResumo.recebidoCents / 100)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500">Complemento</div>
            <div className="mt-1 font-semibold text-blue-600">
              +R$ {formatBRLFromDecimal(confExtraResumo.diffCents / 100)}
            </div>
            <div className="mt-1 text-xs text-slate-500">Classificação: juros/multa/outros acréscimos.</div>
          </div>
        </div>
      </Modal>      
      <Modal
        open={cancelOpen}
        onClose={() => (!canceling ? setCancelOpen(false) : null)}
        title="Cancelar parcela"
      >
        <div className="space-y-4">
          <div className="text-sm text-slate-700">
            Você está cancelando a parcela{" "}
            <span className="font-semibold">{cancelParcela?.numero}</span>. Informe o
            motivo (obrigatório).
          </div>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">Motivo</div>
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              value={cancelMotivo}
              onChange={(e) => setCancelMotivo(e.target.value)}
              placeholder="Ex.: Renegociação / cancelamento do acordo"
              disabled={canceling}
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              onClick={() => setCancelOpen(false)}
              disabled={canceling}
            >
              Fechar
            </button>

            <button
              type="button"
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              onClick={cancelarParcela}
              disabled={canceling}
            >
              {canceling ? "Cancelando..." : "Cancelar"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ===== MODAL CORRIGIR DATA DE RECEBIMENTO ===== */}
      {corrigirOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => !corrigirLoading && setCorrigirOpen(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Corrigir data de recebimento</h3>
            <p className="text-sm text-slate-500 mb-4">
              Parcela <strong>{corrigirParcela?.numero}</strong> — atual:{" "}
              <strong>{corrigirParcela?.dataRecebimento ? toDDMMYYYY(corrigirParcela.dataRecebimento) : "não preenchida"}</strong>
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Nova data (DD/MM/AAAA)</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                  value={corrigirData}
                  onChange={e => setCorrigirData(e.target.value)}
                  placeholder="DD/MM/AAAA"
                  disabled={corrigirLoading}
                  maxLength={10}
                />
              </div>
              {corrigirErr && <p className="text-sm text-red-600">{corrigirErr}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                  onClick={() => setCorrigirOpen(false)}
                  disabled={corrigirLoading}
                >
                  Fechar
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                  onClick={handleCorrigirData}
                  disabled={corrigirLoading}
                >
                  {corrigirLoading ? "Salvando..." : "Salvar data"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== BULK CONFIRM MODAL ===== */}
      {bulkConfirmOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => !bulkProcessing && setBulkConfirmOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              Confirmar {selectedParcelas.size} Parcela(s)
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Cada parcela será confirmada com o valor previsto individual. Os campos abaixo são compartilhados.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Data de Recebimento</label>
                <input
                  type="date"
                  value={confData.includes('/') ? confData.split('/').reverse().join('-') : confData}
                  onChange={e => setConfData(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Meio de Recebimento</label>
                <select
                  value={confMeio}
                  onChange={e => setConfMeio(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {['PIX','TED','DOC','BOLETO','CARTÃO','DINHEIRO','CHEQUE','OUTRO'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Conta de Destino</label>
                <select
                  value={confContaId}
                  onChange={e => setConfContaId(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— selecione —</option>
                  {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>
            {bulkProcessing && (
              <div className="mt-4 text-sm text-blue-700 font-semibold">
                Confirmando {bulkProgress.done} de {bulkProgress.total}…
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setBulkConfirmOpen(false)}
                disabled={bulkProcessing}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold"
              >Cancelar</button>
              <button
                onClick={executeBulkConfirm}
                disabled={bulkProcessing || !confContaId}
                className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
              >Confirmar Todas</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== BULK CANCEL MODAL ===== */}
      {bulkCancelOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => !bulkProcessing && setBulkCancelOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              Cancelar {selectedParcelas.size} Parcela(s)
            </h3>
            <div>
              <label className="text-xs font-semibold text-slate-600">Motivo do cancelamento</label>
              <textarea
                value={bulkCancelMotivo}
                onChange={e => setBulkCancelMotivo(e.target.value)}
                rows={3}
                placeholder="Descreva o motivo..."
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            {bulkProcessing && (
              <div className="mt-4 text-sm text-red-700 font-semibold">
                Cancelando {bulkProgress.done} de {bulkProgress.total}…
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setBulkCancelOpen(false)}
                disabled={bulkProcessing}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold"
              >Fechar</button>
              <button
                onClick={executeBulkCancel}
                disabled={bulkProcessing || !bulkCancelMotivo.trim()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
              >Cancelar Todas</button>
            </div>
          </div>
        </div>
      )}

      {boletoModalParcela && (
        <BoletoCriarModal
          parcela={boletoModalParcela}
          loading={boletoEmitindo === boletoModalParcela.id}
          onConfirm={handleBoletoConfirm}
          onClose={() => setBoletoModalParcela(null)}
        />
      )}

    </div>
  );
}
