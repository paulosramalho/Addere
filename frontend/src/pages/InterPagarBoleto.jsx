// frontend/src/pages/InterPagarBoleto.jsx
// Pagamento de boleto/convênio/tributo via Banco Inter (banking/v2/pagamento)

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { brlFromCentavos } from "../lib/formatters";
import { maskCPFCNPJ, isValidCPFCNPJ } from "../lib/validators";
import { useToast } from "../components/Toast";
import MoneyInput from "../components/ui/MoneyInput";
import EmptyState from "../components/ui/EmptyState";

// ── Autocomplete de beneficiário ──────────────────────────────────────────────

function BeneficiarioInput({ value, onChange }) {
  const [query, setQuery]       = useState(value);
  const [sugestoes, setSugestoes] = useState([]);
  const [aberto, setAberto]     = useState(false);
  const debounceRef             = useRef(null);
  const wrapRef                 = useRef(null);

  // Sincroniza quando valor externo muda (ex: importação PDF)
  useEffect(() => { setQuery(value); }, [value]);

  // Fecha ao clicar fora
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setAberto(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const buscar = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim() || q.length < 2) { setSugestoes([]); setAberto(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const lista = await apiFetch(`/inter/beneficiarios?q=${encodeURIComponent(q)}`);
        setSugestoes(Array.isArray(lista) ? lista : []);
        setAberto(Array.isArray(lista) && lista.length > 0);
      } catch { setSugestoes([]); }
    }, 300);
  }, []);

  function handleChange(e) {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    buscar(v);
  }

  function selecionar(item) {
    setQuery(item.nome);
    onChange(item.nome);
    setSugestoes([]);
    setAberto(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => sugestoes.length > 0 && setAberto(true)}
        placeholder="Nome do beneficiário ou buscar cliente/fornecedor"
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {aberto && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {sugestoes.map((item, i) => (
            <li
              key={i}
              onMouseDown={() => selecionar(item)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 flex items-center justify-between gap-2"
            >
              <span className="font-medium text-slate-800">{item.nome}</span>
              {item.tipo && (
                <span className="text-xs text-slate-400 flex-shrink-0">{item.tipo}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_STYLE = {
  PROCESSANDO: "bg-blue-100 text-blue-800",
  AGENDADO:    "bg-amber-100 text-amber-800",
  REALIZADO:   "bg-green-100 text-green-800",
  CANCELADO:   "bg-slate-100 text-slate-500",
  ERRO:        "bg-red-100 text-red-700",
  MOCK:        "bg-yellow-100 text-yellow-800",
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[status] || "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function todayBRT() {
  const brt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Belem" }));
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, "0")}-${String(brt.getDate()).padStart(2, "0")}`;
}

/** Avança para a próxima segunda se cair em sábado ou domingo */
function nextWorkday(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return nextWorkday(todayBRT());
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function normalizeLinha(v) {
  const d = onlyDigits(v);
  if ([44, 47, 48].includes(d.length)) return d;
  return String(v || "").trim();
}

export default function InterPagarBoleto({ user }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const { addToast, confirmToast } = useToast();
  const fileInputRef = useRef(null);

  // Conta Banco Inter (auto-detectada)
  const [contaInter, setContaInter]     = useState(null);
  const [loadingConta, setLoadingConta] = useState(false);

  // Formulário
  const [linha, setLinha]               = useState("");
  const [valorCentavos, setValorCentavos] = useState(0);
  const [dataPagamento, setDataPagamento] = useState(todayStr());
  const [dataVencimento, setDataVencimento] = useState("");
  const [favorecido, setFavorecido]     = useState("");
  const [historico, setHistorico]       = useState("");

  // Upload PDF
  const [pdfLoading, setPdfLoading]     = useState(false);
  const [pdfInfo, setPdfInfo]           = useState("");
  const [pdfErro, setPdfErro]           = useState("");

  // Envio
  const [sending, setSending]           = useState(false);

  // Histórico recente
  const [recentes, setRecentes]         = useState([]);
  const [loadingRec, setLoadingRec]     = useState(false);

  // DARF form
  const [dCnpjCpf, setDCnpjCpf]               = useState("");
  const [dCodigoReceita, setDCodigoReceita]    = useState("");
  const [dDataVencimento, setDDataVencimento]  = useState("");
  const [dPeriodoApuracao, setDPeriodoApuracao] = useState("");
  const [dNomeEmpresa, setDNomeEmpresa]        = useState("");
  const [dReferencia, setDReferencia]          = useState("");
  const [dTelefone, setDTelefone]              = useState("");
  const [dDescricao, setDDescricao]            = useState("");
  const [dPrincipal, setDPrincipal]            = useState(0);
  const [dJuros, setDJuros]                    = useState(0);
  const [dMulta, setDMulta]                    = useState(0);
  const [sendingDarf, setSendingDarf]          = useState(false);

  // Tab ativa
  const [tab, setTab]                   = useState("boleto");

  // ── Carregar conta Inter ─────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingConta(true);
      try {
        const data   = await apiFetch("/livro-caixa/contas");
        const contas = Array.isArray(data) ? data : data?.contas || [];
        const inter  = contas.find(
          (c) => c?.tipo === "BANCO" && c?.ativa && /banco\s+inter|^inter$/i.test(String(c?.nome || ""))
        ) || contas.find(
          (c) => c?.tipo === "BANCO" && c?.ativa && /inter/i.test(String(c?.nome || ""))
        );
        setContaInter(inter || null);
      } catch (e) {
        addToast(e?.message || "Erro ao carregar contas", "error");
      } finally {
        setLoadingConta(false);
      }
    }
    load();
  }, [addToast]);

  // ── Carregar pagamentos recentes (boletos + DARFs) ───────────────────────────
  async function carregarRecentes() {
    setLoadingRec(true);
    try {
      const [rb, rd] = await Promise.allSettled([
        apiFetch("/inter/pagamentos?limit=15"),
        apiFetch("/inter/pagamentos/darf?limit=15"),
      ]);
      const boletos = (rb.status === "fulfilled" ? rb.value.pagamentos || [] : [])
        .map((p) => ({ ...p, _tipo: "BOLETO" }));
      const darfs   = (rd.status === "fulfilled" ? rd.value.pagamentos || [] : [])
        .map((p) => ({
          ...p,
          _tipo:          "DARF",
          favorecidoNome: p.nomeEmpresa,
          valorCentavos:  p.valorPrincipal + (p.valorJuros || 0) + (p.valorMulta || 0),
        }));
      setRecentes(
        [...boletos, ...darfs]
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 20)
      );
    } catch {
      // silencia
    } finally {
      setLoadingRec(false);
    }
  }

  useEffect(() => { carregarRecentes(); }, []);

  // ── Importar PDF ─────────────────────────────────────────────────────────────
  async function handleImportarPdf(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfErro("");
    setPdfInfo("");
    setPdfLoading(true);
    try {
      const fd = new FormData();
      fd.append("boleto", file);
      const result = await apiFetch("/livro-caixa/boleto/parse-pdf", { method: "POST", body: fd });

      if (result?.linha)        setLinha(normalizeLinha(result.linha));
      if (result?.valorCentavos > 0) setValorCentavos(Number(result.valorCentavos));
      if (result?.vencimento)   { setDataVencimento(result.vencimento); setDataPagamento(nextWorkday(result.vencimento)); }
      if (result?.beneficiario) setFavorecido(result.beneficiario);
      else if (result?.clienteNome) setFavorecido(result.clienteNome);
      if (result?.historico)    setHistorico(result.historico);
      else if (!historico && result?.numeroDocumento) setHistorico(`Documento Nº ${result.numeroDocumento}`);

      setPdfInfo(`Importado: ${file.name}`);
      addToast("Dados do boleto importados.", "success");
    } catch (e) {
      const msg = e?.message || "Falha ao ler PDF";
      setPdfErro(msg);
      addToast(msg, "error");
    } finally {
      setPdfLoading(false);
      if (e.target) e.target.value = "";
    }
  }

  // ── Envio para a API (reutilizado na tentativa de agendamento) ───────────────
  async function _enviarPagamento(linhaFinal, dataPag) {
    await apiFetch("/inter/pagamentos/pagar", {
      method: "POST",
      body: {
        codBarraLinhaDigitavel: linhaFinal,
        valorCentavos:  Number(valorCentavos),
        dataPagamento:  dataPag,
        dataVencimento: dataVencimento || undefined,
        favorecidoNome: favorecido.trim() || undefined,
        historico:      historico.trim(),
        contaId:        Number(contaInter.id),
      },
    });
    addToast(
      dataPag === dataPagamento
        ? "Pagamento enviado ao Banco Inter."
        : `Pagamento agendado para ${new Date(dataPag + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}.`,
      "success"
    );
    setLinha("");
    setValorCentavos(0);
    setDataVencimento("");
    setDataPagamento(todayStr());
    setFavorecido("");
    setHistorico("");
    setPdfInfo("");
    setPdfErro("");
    carregarRecentes();
    setTab("historico");
  }

  // ── Pagar ────────────────────────────────────────────────────────────────────
  async function handlePagar() {
    const linhaFinal = normalizeLinha(linha);
    const digits     = onlyDigits(linhaFinal);

    if (!contaInter?.id) {
      addToast("Conta Banco Inter não encontrada nas contas do Livro Caixa.", "warning");
      return;
    }
    if (![44, 47, 48].includes(digits.length)) {
      addToast("Informe linha digitável ou código de barras válido (44, 47 ou 48 dígitos).", "warning");
      return;
    }
    if (!valorCentavos || valorCentavos <= 0) {
      addToast("Informe o valor.", "warning");
      return;
    }
    if (!dataPagamento) {
      addToast("Informe a data de pagamento.", "warning");
      return;
    }
    if (!historico.trim()) {
      addToast("Informe o histórico.", "warning");
      return;
    }

    const ok = await confirmToast(
      `Pagar ${brlFromCentavos(valorCentavos)} para ${favorecido.trim() || "beneficiário"} em ${dataPagamento}?`
    );
    if (!ok) return;

    setSending(true);
    try {
      await _enviarPagamento(linhaFinal, dataPagamento);
    } catch (e) {
      // Boleto vencido — API Inter não suporta
      if (e.data?.code === "BOLETO_VENCIDO") {
        addToast(e.data.detail || "Boleto vencido: use o Internet Banking Inter.", "warning", 8000);
        return;
      }

      // Horário bancário encerrado → oferecer agendamento
      if (e.data?.code === "HORARIO_EXCEDIDO") {
        setSending(false);
        const dataSugerida = e.data.dataSugerida;
        const fmtSug = dataSugerida
          ? new Date(dataSugerida + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })
          : "próximo dia útil";
        const agendar = await confirmToast(
          `Horário bancário encerrado. Agendar pagamento para ${fmtSug}?`
        );
        if (agendar && dataSugerida) {
          setSending(true);
          try {
            await _enviarPagamento(linhaFinal, dataSugerida);
          } catch (e2) {
            addToast(e2?.message || "Erro ao agendar pagamento.", "error");
          } finally {
            setSending(false);
          }
        }
        return;
      }
      addToast(e?.message || "Erro ao enviar pagamento.", "error");
    } finally {
      setSending(false);
    }
  }

  // ── Pagar DARF ───────────────────────────────────────────────────────────────
  async function handlePagarDarf() {
    if (!contaInter?.id) {
      addToast("Conta Banco Inter não encontrada.", "warning"); return;
    }
    if (!isValidCPFCNPJ(dCnpjCpf)) {
      addToast("CPF ou CNPJ inválido.", "warning"); return;
    }
    if (dCodigoReceita.replace(/\D/g, "").length !== 4) {
      addToast("Código da receita deve ter exatamente 4 dígitos.", "warning"); return;
    }
    if (!dDataVencimento) {
      addToast("Informe a data de vencimento da DARF.", "warning"); return;
    }
    if (!dPeriodoApuracao) {
      addToast("Informe o período de apuração.", "warning"); return;
    }
    if (!dNomeEmpresa.trim()) {
      addToast("Informe o nome da empresa.", "warning"); return;
    }
    if (!dReferencia.trim() || !/^\d+$/.test(dReferencia.trim())) {
      addToast("Referência obrigatória e deve conter apenas números.", "warning"); return;
    }
    if (!dPrincipal || dPrincipal <= 0) {
      addToast("Informe o valor principal.", "warning"); return;
    }
    if (!dDescricao.trim()) {
      addToast("Informe a descrição / histórico.", "warning"); return;
    }

    const total = dPrincipal + dJuros + dMulta;
    const ok = await confirmToast(
      `Pagar DARF ${brlFromCentavos(total)} — receita ${dCodigoReceita} para ${dNomeEmpresa.trim()}?`
    );
    if (!ok) return;

    setSendingDarf(true);
    try {
      await apiFetch("/inter/pagamentos/darf", {
        method: "POST",
        body: {
          cnpjCpf:             dCnpjCpf.replace(/\D/g, ""),
          codigoReceita:       dCodigoReceita.trim(),
          dataVencimento:      dDataVencimento,
          periodoApuracao:     dPeriodoApuracao,
          descricao:           dDescricao.trim(),
          nomeEmpresa:         dNomeEmpresa.trim(),
          referencia:          dReferencia.trim(),
          telefoneEmpresa:     dTelefone.trim() || undefined,
          valorPrincipalCents: dPrincipal,
          valorJurosCents:     dJuros,
          valorMultaCents:     dMulta,
          historico:           dDescricao.trim(),
          contaId:             Number(contaInter.id),
        },
      });
      addToast("DARF enviada ao Banco Inter.", "success");
      setDCnpjCpf(""); setDCodigoReceita(""); setDDataVencimento(""); setDPeriodoApuracao("");
      setDNomeEmpresa(""); setDReferencia(""); setDTelefone(""); setDDescricao("");
      setDPrincipal(0); setDJuros(0); setDMulta(0);
      carregarRecentes();
      setTab("historico");
    } catch (e) {
      addToast(e?.message || "Erro ao enviar DARF.", "error");
    } finally {
      setSendingDarf(false);
    }
  }

  // ── Cancelar agendamento ─────────────────────────────────────────────────────
  async function handleCancelar(pag) {
    const ok = await confirmToast(`Cancelar agendamento de ${brlFromCentavos(pag.valorCentavos)}?`);
    if (!ok) return;
    try {
      await apiFetch(`/inter/pagamentos/${pag.id}/cancelar`, { method: "DELETE" });
      addToast("Agendamento cancelado.", "success");
      carregarRecentes();
    } catch (e) {
      addToast(e?.message || "Erro ao cancelar.", "error");
    }
  }

  // ── Confirmar pagamento realizado ─────────────────────────────────────────────
  async function handleConfirmar(pag) {
    const ok = await confirmToast(`Confirmar pagamento de ${brlFromCentavos(pag.valorCentavos)} para ${pag.favorecidoNome || "beneficiário"} como realizado?`);
    if (!ok) return;
    try {
      await apiFetch(`/inter/pagamentos/${pag.id}/confirmar`, { method: "PATCH" });
      addToast("Pagamento marcado como realizado.", "success");
      carregarRecentes();
    } catch (e) {
      addToast(e?.message || "Erro ao confirmar.", "error");
    }
  }

  // ── Acesso restrito ──────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <EmptyState icon="🔒" title="Acesso restrito" description="Esta área é exclusiva para administradores." />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">

        {/* Cabeçalho + tabs */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-0">
            <h1 className="text-xl font-bold text-slate-900">Pagar Boleto (Banco Inter)</h1>
            <p className="text-sm text-slate-500 mt-0.5">Pagamento de boleto, convênio ou tributo por código de barras.</p>
          </div>
          <div className="flex border-b border-slate-200 mt-4 px-5 gap-1">
            {[["boleto", "Boleto"], ["darf", "DARF"], ["historico", "Histórico / Cancelamento"]].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
                  tab === id
                    ? "border-primary text-primary bg-slate-50"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab: Boleto ── */}
        {tab === "boleto" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            {/* Conta Inter (fixa) */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Conta Banco Inter (débito)</label>
              <input
                disabled
                value={
                  loadingConta
                    ? "Carregando..."
                    : contaInter
                    ? `${contaInter.nome}${contaInter.conta ? ` • Cc ${contaInter.conta}` : ""}`
                    : "Nenhuma conta Inter ativa encontrada"
                }
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-slate-100 text-slate-700"
              />
            </div>

            {/* Linha digitável */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Linha digitável / código de barras</label>
              <textarea
                rows={3}
                value={linha}
                onChange={(e) => setLinha(e.target.value)}
                placeholder="Cole aqui a linha digitável ou código de barras (44, 47 ou 48 dígitos)"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {linha && (
                <p className={`text-xs mt-0.5 ${[44, 47, 48].includes(onlyDigits(linha).length) ? "text-green-700" : "text-red-600"}`}>
                  {onlyDigits(linha).length} dígitos
                </p>
              )}
            </div>

            <MoneyInput value={valorCentavos} onChange={setValorCentavos} label="Valor" />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data de pagamento</label>
              <input
                type="date"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {dataPagamento && dataPagamento > todayBRT() && (
                <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 flex items-center gap-1">
                  <span>📅</span>
                  <span>
                    Agendado para{" "}
                    <strong>{new Date(dataPagamento + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}</strong>
                  </span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Vencimento original <span className="text-slate-400 font-normal">(opcional)</span></label>
              <input
                type="date"
                value={dataVencimento}
                onChange={(e) => setDataVencimento(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Beneficiário <span className="text-slate-400 font-normal">(opcional)</span></label>
              <BeneficiarioInput value={favorecido} onChange={setFavorecido} />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Histórico</label>
              <input
                type="text"
                value={historico}
                onChange={(e) => setHistorico(e.target.value)}
                placeholder="Descrição do pagamento"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Importar PDF + Pagar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleImportarPdf}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pdfLoading}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
              >
                {pdfLoading ? "Lendo arquivo..." : "Importar PDF / Imagem"}
              </button>
              {pdfInfo && <span className="text-xs text-emerald-700">{pdfInfo}</span>}
              {pdfErro && <span className="text-xs text-red-700">{pdfErro}</span>}
            </div>

            <button
              type="button"
              onClick={handlePagar}
              disabled={sending || !contaInter?.id}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold disabled:opacity-60"
            >
              {sending ? "Enviando..." : "Pagar Boleto"}
            </button>
          </div>
        </div>
        )}

        {/* ── Tab: DARF ── */}
        {tab === "darf" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">

          {/* Conta Inter */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Conta Banco Inter (débito)</label>
            <input disabled value={loadingConta ? "Carregando..." : contaInter ? `${contaInter.nome}${contaInter.conta ? ` • Cc ${contaInter.conta}` : ""}` : "Nenhuma conta Inter ativa encontrada"}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-slate-100 text-slate-700" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">CNPJ / CPF do contribuinte</label>
              <input type="text" value={dCnpjCpf} onChange={(e) => setDCnpjCpf(maskCPFCNPJ(e.target.value))}
                placeholder="00.000.000/0001-00"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Código da receita <span className="text-slate-400 font-normal">(4 dígitos)</span></label>
              <input type="text" value={dCodigoReceita} maxLength={4}
                onChange={(e) => setDCodigoReceita(e.target.value.replace(/\D/g, ""))}
                placeholder="1234"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome da empresa</label>
              <input type="text" value={dNomeEmpresa} onChange={(e) => setDNomeEmpresa(e.target.value)}
                placeholder="Razão social"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Referência <span className="text-slate-400 font-normal">(só números)</span></label>
              <input type="text" value={dReferencia} maxLength={30}
                onChange={(e) => setDReferencia(e.target.value.replace(/\D/g, ""))}
                placeholder="Número de referência"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Período de apuração</label>
              <input type="date" value={dPeriodoApuracao} onChange={(e) => setDPeriodoApuracao(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data de vencimento</label>
              <input type="date" value={dDataVencimento} onChange={(e) => setDDataVencimento(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <MoneyInput value={dPrincipal} onChange={setDPrincipal} label="Valor principal" />
            <MoneyInput value={dJuros}    onChange={setDJuros}    label="Valor juros (opcional)" />
            <MoneyInput value={dMulta}    onChange={setDMulta}    label="Valor multa (opcional)" />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Telefone da empresa <span className="text-slate-400 font-normal">(opcional)</span></label>
              <input type="text" value={dTelefone} onChange={(e) => setDTelefone(e.target.value)}
                placeholder="(91) 00000-0000"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Descrição / Histórico</label>
              <input type="text" value={dDescricao} onChange={(e) => setDDescricao(e.target.value)}
                placeholder="Ex.: IRPJ 1º trimestre 2026"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>

          {(dPrincipal + dJuros + dMulta) > 0 && (
            <p className="text-xs text-slate-500">
              Total: <strong className="text-slate-800">{brlFromCentavos(dPrincipal + dJuros + dMulta)}</strong>
              {" "}(principal + juros + multa)
            </p>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={handlePagarDarf} disabled={sendingDarf || !contaInter?.id}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold disabled:opacity-60">
              {sendingDarf ? "Enviando..." : "Pagar DARF"}
            </button>
          </div>
        </div>
        )}

        {/* ── Tab: Histórico / Cancelamento ── */}
        {tab === "historico" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-800">Pagamentos registrados</h2>
            <button
              onClick={carregarRecentes}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100"
            >
              Atualizar
            </button>
          </div>

          {loadingRec ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : recentes.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum pagamento registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100">
                    <th className="pb-2 text-left font-medium">Data</th>
                    <th className="pb-2 text-left font-medium">Tipo</th>
                    <th className="pb-2 text-left font-medium">Beneficiário</th>
                    <th className="pb-2 text-left font-medium">Histórico</th>
                    <th className="pb-2 text-right font-medium">Valor</th>
                    <th className="pb-2 text-center font-medium">Status</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentes.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-2 text-slate-600">
                        {["AGENDADO", "PROCESSANDO"].includes(p.status) && p._tipo === "BOLETO" ? (
                          <span className="inline-flex flex-col">
                            <span className="text-xs font-semibold text-amber-700">Agendado</span>
                            <span>{fmtDate(p.dataPagamento)}</span>
                          </span>
                        ) : fmtDate(p.dataPagamento)}
                      </td>
                      <td className="py-2">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${p._tipo === "DARF" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                          {p._tipo}
                        </span>
                      </td>
                      <td className="py-2 text-slate-700 max-w-[140px] truncate">{p.favorecidoNome || "—"}</td>
                      <td className="py-2 text-slate-500 max-w-[180px] truncate">{p.historico || "—"}</td>
                      <td className="py-2 text-right font-bold text-slate-900">{brlFromCentavos(p.valorCentavos)}</td>
                      <td className="py-2 text-center"><StatusBadge status={p.status} /></td>
                      <td className="py-2 text-right">
                        {["PROCESSANDO", "AGENDADO"].includes(p.status) && p._tipo === "BOLETO" && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleConfirmar(p)}
                              className="text-xs text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded-lg hover:bg-emerald-50"
                            >
                              Confirmar
                            </button>
                            <button
                              onClick={() => handleCancelar(p)}
                              className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded-lg hover:bg-red-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
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
