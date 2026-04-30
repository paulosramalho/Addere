import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import MoneyInput from "../components/ui/MoneyInput";
import EmptyState from "../components/ui/EmptyState";

function pickContaSantander(contas) {
  if (!Array.isArray(contas) || contas.length === 0) return null;
  return (
    contas.find((c) => /banco\s+santander/i.test(String(c?.nome || ""))) ||
    contas.find((c) => /santander/i.test(String(c?.nome || ""))) ||
    contas[0]
  );
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeLinha(value) {
  const d = onlyDigits(value);
  if ([44, 47, 48].includes(d.length)) return d;
  return String(value || "").trim();
}

function formatInputDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function SantanderPagarBoleto({ user }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const { addToast } = useToast();
  const fileInputRef = useRef(null);

  const [loadingContas, setLoadingContas] = useState(false);
  const [contaSantander, setContaSantander] = useState(null);

  const [linhaDigitavel, setLinhaDigitavel] = useState("");
  const [valorCentavos, setValorCentavos] = useState(0);
  const [dataPagamento, setDataPagamento] = useState(formatInputDate(new Date()));
  const [historico, setHistorico] = useState("");
  const [beneficiario, setBeneficiario] = useState("");

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfInfo, setPdfInfo] = useState("");
  const [pdfErro, setPdfErro] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    async function loadContas() {
      setLoadingContas(true);
      try {
        const data = await apiFetch("/livro-caixa/contas");
        const contas = Array.isArray(data) ? data : data?.contas || [];
        const santander = contas.filter(
          (c) =>
            c?.tipo === "BANCO" &&
            c?.ativa &&
            /santander/i.test(String(c?.nome || ""))
        );
        setContaSantander(pickContaSantander(santander));
      } catch (err) {
        addToast(err?.message || "Falha ao carregar conta Santander", "error");
      } finally {
        setLoadingContas(false);
      }
    }
    loadContas();
  }, [addToast]);

  async function handleImportarPdf(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPdfErro("");
    setPdfInfo("");
    setPdfLoading(true);
    try {
      const fd = new FormData();
      fd.append("boleto", file);
      const result = await apiFetch("/livro-caixa/boleto/parse-pdf", {
        method: "POST",
        body: fd,
      });

      const linha = result?.linha ? normalizeLinha(result.linha) : "";
      if (linha) setLinhaDigitavel(linha);
      if (result?.valorCentavos > 0) setValorCentavos(Number(result.valorCentavos));
      if (result?.vencimento) setDataPagamento(result.vencimento);

      if (result?.beneficiario) setBeneficiario(result.beneficiario);
      else if (result?.clienteNome) setBeneficiario(result.clienteNome);

      if (result?.historico) setHistorico(result.historico);
      else if (!historico && result?.numeroDocumento) setHistorico(`Documento Nº ${result.numeroDocumento}`);

      setPdfInfo(
        `Arquivo importado: ${file.name}${result?.fonte ? ` • fonte: ${result.fonte}` : ""}`
      );
      addToast("Dados do boleto importados do PDF.", "success");
    } catch (err) {
      const msg = err?.message || "Falha ao ler PDF";
      setPdfErro(msg);
      addToast(msg, "error");
    } finally {
      setPdfLoading(false);
      if (e.target) e.target.value = "";
    }
  }

  async function handlePagarBoleto() {
    const linha = normalizeLinha(linhaDigitavel);
    const digits = onlyDigits(linha);

    if (!contaSantander?.id) {
      addToast("Conta Santander fixa não encontrada.", "warning");
      return;
    }
    if (![44, 47, 48].includes(digits.length)) {
      addToast("Informe linha digitável/código de barras válido (44, 47 ou 48 dígitos).", "warning");
      return;
    }
    if (!valorCentavos || valorCentavos <= 0) {
      addToast("Informe o valor do boleto.", "warning");
      return;
    }
    if (!dataPagamento) {
      addToast("Informe a data do pagamento.", "warning");
      return;
    }
    if (!historico.trim()) {
      addToast("Informe o histórico.", "warning");
      return;
    }

    setSending(true);
    try {
      await apiFetch("/santander/boletos/pagar", {
        method: "POST",
        body: {
          contaId: Number(contaSantander.id),
          linhaDigitavel: linha,
          codigoBarras: digits.length === 44 ? digits : null,
          valorCentavos: Number(valorCentavos),
          dataPagamento,
          descricao: historico.trim(),
          favorecidoNome: beneficiario.trim() || null,
        },
      });
      addToast("Pagamento de boleto enviado para processamento.", "success");
      setLinhaDigitavel("");
      setValorCentavos(0);
      setHistorico("");
      setBeneficiario("");
      setPdfInfo("");
      setPdfErro("");
    } catch (err) {
      const msg = String(err?.message || "");
      if (
        msg.toLowerCase().includes("404") ||
        msg.toLowerCase().includes("não encontrado") ||
        msg.toLowerCase().includes("nao encontrado") ||
        msg.toLowerCase().includes("not found")
      ) {
        addToast("Integração Santander para pagamento de boleto ainda não publicada.", "info", 6000);
      } else {
        addToast(err?.message || "Falha ao enviar pagamento do boleto.", "error");
      }
    } finally {
      setSending(false);
    }
  }

  if (!isAdmin) {
    return (
      <EmptyState
        icon="🔒"
        title="Acesso restrito"
        description="Esta área é exclusiva para administradores."
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Pagar Boleto (Banco Santander)</h1>
            <p className="text-sm text-slate-500 mt-1">
              Digite os dados do boleto ou importe por arquivo PDF.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Conta Banco Santander (fixa)</label>
              <input
                disabled
                value={
                  loadingContas
                    ? "Carregando..."
                    : contaSantander
                    ? `${contaSantander.nome}${contaSantander.conta ? ` • Cc ${contaSantander.conta}` : ""}`
                    : "Nenhuma conta Santander ativa encontrada"
                }
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-slate-100 text-slate-700"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Linha digitável / código de barras</label>
              <textarea
                rows={3}
                value={linhaDigitavel}
                onChange={(e) => setLinhaDigitavel(e.target.value)}
                placeholder="Cole aqui a linha digitável ou código de barras"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono"
              />
            </div>

            <MoneyInput value={valorCentavos} onChange={setValorCentavos} label="Valor" />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data de pagamento</label>
              <input
                type="date"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Beneficiário (opcional)</label>
              <input
                type="text"
                value={beneficiario}
                onChange={(e) => setBeneficiario(e.target.value)}
                placeholder="Nome do beneficiário"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Histórico</label>
              <input
                type="text"
                value={historico}
                onChange={(e) => setHistorico(e.target.value)}
                placeholder="Descrição do pagamento"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleImportarPdf}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pdfLoading}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
            >
              {pdfLoading ? "Lendo PDF..." : "Ler e Importar Dados de Arquivo PDF"}
            </button>
            {pdfInfo && <span className="text-xs text-emerald-700">{pdfInfo}</span>}
            {pdfErro && <span className="text-xs text-red-700">{pdfErro}</span>}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handlePagarBoleto}
              disabled={sending || !contaSantander?.id}
              className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold disabled:opacity-60"
            >
              {sending ? "Enviando..." : "Pagar Boleto"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
