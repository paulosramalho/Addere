// frontend/src/pages/Boletos.jsx
// Gerenciamento de Boletos (Inter/Santander) — listagem, consulta, alteração e cancelamento

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../lib/api";
import { brlFromCentavos } from "../lib/formatters";
import { useToast } from "../components/Toast";

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "",           label: "Todos"     },
  { value: "EMITIDO",   label: "Emitido"   },
  { value: "PAGO",      label: "Pago"      },
  { value: "CANCELADO", label: "Cancelado" },
  { value: "EXPIRADO",  label: "Expirado"  },
];

const STATUS_STYLE = {
  EMITIDO:   "bg-blue-100 text-blue-800",
  PAGO:      "bg-green-100 text-green-800",
  CANCELADO: "bg-slate-100 text-slate-500",
  EXPIRADO:  "bg-red-100 text-red-700",
};

const MODO_STYLE = {
  mock:       "bg-yellow-100 text-yellow-800",
  sandbox:    "bg-purple-100 text-purple-800",
  production: "bg-emerald-100 text-emerald-800",
};

const MODO_LABEL = { mock: "Simulação", sandbox: "Sandbox", production: "Produção" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function fmtDatetime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Sub-componentes de badge ───────────────────────────────────────────────────

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[status] || "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function ModoBadge({ modo }) {
  if (!modo) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${MODO_STYLE[modo] || "bg-slate-100 text-slate-600"}`}>
      {MODO_LABEL[modo] || modo}
    </span>
  );
}

// ── Modal Detalhes ────────────────────────────────────────────────────────────

function ModalDetalhes({ boleto, onClose, onCancelar, onAlterar, onSincronizar, isAdmin, bankName = "Inter", sincronizando }) {
  const [copied, setCopied] = useState(null);

  function copiar(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const CopyBtn = ({ text, field, label = "Copiar" }) => (
    <button
      onClick={() => copiar(text, field)}
      className="flex-shrink-0 text-xs px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors"
    >
      {copied === field ? "✓ Copiado" : label}
    </button>
  );

  const Field = ({ label, children }) => (
    <div>
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  );

  const canAlterar     = isAdmin && boleto.status === "EMITIDO";
  const canCancelar    = isAdmin && boleto.status === "EMITIDO";
  const canSincronizar = isAdmin && boleto.status === "EMITIDO";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex-shrink-0 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">Boleto #{boleto.id}</h3>
              {boleto.docNum && (
                <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{boleto.docNum}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={boleto.status} />
              <ModoBadge modo={boleto.modo} />
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 min-h-0 p-6 space-y-4">
          {/* QR code */}
          {boleto.qrCodeImagem && (
            <div className="flex justify-center">
              <img
                src={`data:image/png;base64,${boleto.qrCodeImagem}`}
                alt="QR Code PIX"
                className="w-36 h-36 border border-slate-200 rounded-xl"
              />
            </div>
          )}

          {/* Campos principais */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cliente">
              <span className="font-medium">{boleto.pagadorNome || boleto.cliente?.nomeRazaoSocial || "—"}</span>
            </Field>
            <Field label="Valor">
              <span className="font-bold text-slate-900">{brlFromCentavos(boleto.valorCentavos)}</span>
            </Field>
            <Field label="Vencimento">
              {fmtDate(boleto.dataVencimento)}
              {boleto.validadeDias && (
                <span className="text-xs text-slate-400 ml-1">({boleto.validadeDias}d validade)</span>
              )}
            </Field>
            <Field label="Emitido em">
              {fmtDatetime(boleto.createdAt)}
            </Field>
            {boleto.parcela && (
              <Field label="Parcela">
                #{boleto.parcela.numero} — Contrato {boleto.parcela.contrato?.numeroContrato || boleto.parcela.contratoId}
              </Field>
            )}
            {boleto.historico && (
              <Field label="Histórico">
                <span className="text-slate-700">{boleto.historico}</span>
              </Field>
            )}
            {boleto.multaPerc != null && (
              <Field label="Multa">
                {Number(boleto.multaPerc).toFixed(2).replace(".", ",")}%
              </Field>
            )}
            {boleto.moraPercMes != null && (
              <Field label="Mora (%/mês)">
                {Number(boleto.moraPercMes).toFixed(2).replace(".", ",")}%
              </Field>
            )}
            {boleto.dataPagamento && (
              <Field label="Pago em">
                <span className="text-green-700 font-semibold">{fmtDate(boleto.dataPagamento)}</span>
              </Field>
            )}
            {boleto.valorPagoCent && (
              <Field label="Valor pago">
                <span className="text-green-700 font-semibold">{brlFromCentavos(boleto.valorPagoCent)}</span>
              </Field>
            )}
          </div>

          {/* Nosso número */}
          {boleto.nossoNumero && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Nosso Número</div>
              <div className="bg-slate-50 rounded-lg p-2 font-mono text-sm text-slate-800 flex items-center justify-between gap-2">
                <span className="break-all">{boleto.nossoNumero}</span>
                <CopyBtn text={boleto.nossoNumero} field="nosso" />
              </div>
            </div>
          )}

          {/* Linha digitável */}
          {boleto.linhaDigitavel && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Linha Digitável</div>
              <div className="bg-slate-50 rounded-lg p-2 font-mono text-sm text-slate-800 flex items-center justify-between gap-2">
                <span className="break-all leading-relaxed">{boleto.linhaDigitavel}</span>
                <CopyBtn text={boleto.linhaDigitavel} field="linha" />
              </div>
            </div>
          )}

          {/* Código de barras */}
          {boleto.codigoBarras && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Código de Barras</div>
              <div className="bg-slate-50 rounded-lg p-2 font-mono text-xs text-slate-700 flex items-center justify-between gap-2">
                <span className="break-all">{boleto.codigoBarras}</span>
                <CopyBtn text={boleto.codigoBarras} field="barras" />
              </div>
            </div>
          )}

          {/* PIX copia e cola */}
          {boleto.pixCopiaECola && (
            <div>
              <div className="text-xs text-slate-500 mb-1">PIX Copia e Cola</div>
              <div className="bg-blue-50 rounded-lg p-2 font-mono text-xs text-blue-800 flex items-center justify-between gap-2">
                <span className="break-all line-clamp-3">{boleto.pixCopiaECola}</span>
                <CopyBtn text={boleto.pixCopiaECola} field="pix" />
              </div>
            </div>
          )}

          {/* PDF no Drive */}
          {boleto.pdfUrl && (
            <a
              href={`https://drive.google.com/file/d/${boleto.pdfUrl}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-700 hover:text-blue-900 font-medium"
            >
              <span>📄</span> Abrir PDF no Drive
            </a>
          )}

          {/* Aviso mock */}
          {boleto.modo === "mock" && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
              <strong>Modo Simulação:</strong> dados gerados localmente, boleto não registrado no Banco {bankName}.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex-shrink-0 flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 text-sm">
            Fechar
          </button>
          {canAlterar && (
            <button onClick={() => onAlterar(boleto)}
              className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 font-semibold text-sm">
              Alterar Vencimento
            </button>
          )}
          {canSincronizar && (
            <button onClick={() => onSincronizar(boleto)} disabled={sincronizando === boleto.id}
              className="flex-1 rounded-xl bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 font-semibold text-sm disabled:opacity-50">
              {sincronizando === boleto.id ? "..." : "Sincronizar"}
            </button>
          )}
          {canCancelar && (
            <button onClick={() => onCancelar(boleto)}
              className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white px-4 py-2 font-semibold text-sm">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Modal Alterar Vencimento ──────────────────────────────────────────────────

function ModalAlterar({ boleto, onClose, onConfirm, loading, bankName = "Inter" }) {
  const [dataVenc, setDataVenc] = useState(
    boleto.dataVencimento ? boleto.dataVencimento.slice(0, 10) : ""
  );
  const [multaPerc, setMultaPerc]     = useState(String(Number(boleto.multaPerc   ?? 2)));
  const [moraPerc,  setMoraPerc]      = useState(String(Number(boleto.moraPercMes ?? 1)));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Alterar Boleto #{boleto.id}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nova data de vencimento</label>
            <input
              type="date"
              value={dataVenc}
              onChange={(e) => setDataVenc(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Multa (%)</label>
              <input
                type="number" min="0" max="10" step="0.01"
                value={multaPerc}
                onChange={(e) => setMultaPerc(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mora (%/mês)</label>
              <input
                type="number" min="0" max="5" step="0.01"
                value={moraPerc}
                onChange={(e) => setMoraPerc(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            A alteração será registrada no sistema e enviada ao Banco {bankName} (em modo produção).
          </p>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button onClick={onClose} disabled={loading}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 text-sm">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm({ dataVencimento: dataVenc, multaPerc: parseFloat(multaPerc), moraPercMes: parseFloat(moraPerc) })}
            disabled={loading || !dataVenc}
            className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 font-semibold text-sm disabled:opacity-60"
          >
            {loading ? "Salvando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Validação campos mínimos para boleto ──────────────────────────────────────

const CAMPOS_BOLETO = [
  { campo: "cpfCnpj",  label: "CPF / CNPJ", tipo: "text",  obrigatorio: true  },
  { campo: "email",    label: "E-mail",      tipo: "email", obrigatorio: false },
];

function checkCamposMinimos(cliente) {
  return CAMPOS_BOLETO.filter(({ campo }) => !cliente?.[campo]?.trim());
}

// ── Modal Campos Faltando ─────────────────────────────────────────────────────

function ModalCamposFaltando({ cliente, camposFaltando, onIncluir, onCancelar }) {
  const [valores, setValores] = useState(
    Object.fromEntries(camposFaltando.map(c => [c.campo, ""]))
  );
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState(null);

  async function handleIncluir() {
    const obrigFaltando = camposFaltando.filter(c => c.obrigatorio && !valores[c.campo]?.trim());
    if (obrigFaltando.length > 0) {
      setErro(`${obrigFaltando[0].label} é obrigatório`);
      return;
    }
    setLoading(true);
    try {
      await apiFetch(`/clients/${cliente.id}`, { method: "PUT", body: valores });
      onIncluir({ ...cliente, ...valores });
    } catch (err) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-900">Dados insuficientes para boleto</h3>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-sm font-semibold text-amber-900">{cliente.nomeRazaoSocial}</p>
            <p className="text-xs text-amber-700 mt-0.5">
              não possui todos os dados necessários para emissão do boleto.
            </p>
          </div>

          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Campos a preencher:</p>

          {camposFaltando.map(({ campo, label, tipo, obrigatorio }) => (
            <div key={campo}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {label}{obrigatorio && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <input
                type={tipo}
                value={valores[campo]}
                onChange={e => setValores(v => ({ ...v, [campo]: e.target.value }))}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}

          {erro && <p className="text-sm text-red-600">{erro}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button onClick={onCancelar} disabled={loading}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button onClick={handleIncluir} disabled={loading}
            className="flex-1 rounded-xl bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60">
            {loading ? "Salvando..." : "Incluir"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal Emitir ──────────────────────────────────────────────────────────────

function ModalEmitir({ onClose, onSuccess, apiBase = "/boletos" }) {
  const [tipo, setTipo]     = useState("parcela");
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState(null);

  // Parcela
  const [parcelaQuery, setParcelaQuery] = useState("");
  const [parcelaSugest, setParcelaSugest] = useState([]);
  const [parcelaSel, setParcelaSel]       = useState(null);

  // Avulso
  const [clienteQuery, setClienteQuery]   = useState("");
  const [clienteSugest, setClienteSugest] = useState([]);
  const [clienteSel, setClienteSel]       = useState(null);
  const [valorAvulso, setValorAvulso]     = useState("");
  const [vencAvulso, setVencAvulso]       = useState("");

  // Campos comuns
  const [historico, setHistorico]     = useState("Honorários advocatícios");
  const [multaPerc, setMultaPerc]     = useState("2");
  const [moraPerc,  setMoraPerc]      = useState("1");
  const [validade,  setValidade]      = useState("30");

  // Validação de campos
  const [camposFaltandoState, setCamposFaltandoState] = useState(null); // { cliente, campos }

  const debounceC = useRef(null);
  const debounceP = useRef(null);

  useEffect(() => {
    if (!clienteQuery.trim() || tipo !== "avulso") { setClienteSugest([]); return; }
    clearTimeout(debounceC.current);
    debounceC.current = setTimeout(async () => {
      try {
        const r = await apiFetch(`/clients?q=${encodeURIComponent(clienteQuery)}&limit=8`);
        setClienteSugest(r.clients || r.data || []);
      } catch { /* ignore */ }
    }, 300);
  }, [clienteQuery, tipo]);

  useEffect(() => {
    if (!parcelaQuery.trim() || tipo !== "parcela") { setParcelaSugest([]); return; }
    clearTimeout(debounceP.current);
    debounceP.current = setTimeout(async () => {
      try {
        const r = await apiFetch(`/parcelas?q=${encodeURIComponent(parcelaQuery)}&status=PREVISTA&limit=10`);
        setParcelaSugest(r.parcelas || r.data || []);
      } catch { /* ignore */ }
    }, 300);
  }, [parcelaQuery, tipo]);

  async function _fazerEmissao(body) {
    setLoading(true);
    try {
      const boleto = await apiFetch(`${apiBase}/emitir`, { method: "POST", body: JSON.stringify(body) });
      onSuccess(boleto);
    } catch (err) {
      setErro(err.message || "Erro ao emitir boleto");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro(null);
    if (!historico.trim()) { setErro("Histórico é obrigatório"); return; }

    const common = {
      historico:    historico.trim(),
      multaPerc:    parseFloat(multaPerc),
      moraPercMes:  parseFloat(moraPerc),
      validadeDias: parseInt(validade, 10),
    };

    // Determina cliente para validação
    let clienteAtual = null;
    let body = null;

    if (tipo === "parcela") {
      if (!parcelaSel) { setErro("Selecione uma parcela"); return; }
      clienteAtual = parcelaSel.contrato?.cliente || null;
      body = { parcelaId: parcelaSel.id, ...common };
    } else {
      if (!clienteSel) { setErro("Selecione um cliente"); return; }
      const centavos = Math.round(parseFloat(valorAvulso.replace(",", ".")) * 100);
      if (!centavos || centavos <= 0) { setErro("Valor inválido"); return; }
      if (!vencAvulso) { setErro("Informe o vencimento"); return; }
      clienteAtual = clienteSel;
      body = { clienteId: clienteSel.id, valorCentavos: centavos, dataVencimento: vencAvulso, ...common };
    }

    // Verifica campos mínimos
    if (clienteAtual) {
      const faltando = checkCamposMinimos(clienteAtual);
      if (faltando.length > 0) {
        setCamposFaltandoState({ cliente: clienteAtual, campos: faltando, body });
        return;
      }
    }

    await _fazerEmissao(body);
  }

  function handleCamposIncluidos(clienteAtualizado) {
    if (!camposFaltandoState) return;
    const { body } = camposFaltandoState;
    setCamposFaltandoState(null);
    // Atualiza referência local do cliente selecionado
    if (tipo === "avulso") setClienteSel(clienteAtualizado);
    _fazerEmissao(body);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex-shrink-0 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Emitir Boleto</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <form id="emitir-form" onSubmit={handleSubmit} className="overflow-y-auto flex-1 min-h-0 p-6 space-y-4">
          {/* Tipo */}
          <div className="flex gap-2">
            {[["parcela", "Vincular Parcela"], ["avulso", "Avulso"]].map(([v, l]) => (
              <button key={v} type="button"
                onClick={() => { setTipo(v); setErro(null); }}
                className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                  tipo === v ? "bg-blue-700 text-white border-blue-700" : "bg-white text-slate-600 border-slate-300 hover:border-blue-400"
                }`}
              >{l}</button>
            ))}
          </div>

          {/* Parcela ou Avulso */}
          {tipo === "parcela" ? (
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700 mb-1">Buscar Parcela</label>
              <input type="text" placeholder="Número do contrato, cliente..."
                value={parcelaQuery}
                onChange={(e) => { setParcelaQuery(e.target.value); setParcelaSel(null); }}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {parcelaSugest.length > 0 && !parcelaSel && (
                <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                  {parcelaSugest.map((p) => (
                    <li key={p.id}>
                      <button type="button"
                        onMouseDown={() => { setParcelaSel(p); setParcelaQuery(`Parcela #${p.numero} — ${p.contrato?.cliente?.nomeRazaoSocial || ""}`); setParcelaSugest([]); }}
                        className="w-full text-left px-4 py-2 hover:bg-blue-50 text-sm">
                        <span className="font-medium">Parcela #{p.numero}</span>
                        <span className="text-slate-500 ml-1">— {p.contrato?.cliente?.nomeRazaoSocial || ""}</span>
                        <span className="float-right text-blue-700 font-semibold">{brlFromCentavos(Math.round(Number(p.valorPrevisto) * 100))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {parcelaSel && (
                <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
                  <div className="font-semibold text-blue-900">{parcelaSel.contrato?.cliente?.nomeRazaoSocial || "Cliente"}</div>
                  <div className="text-blue-700">Parcela #{parcelaSel.numero} · {brlFromCentavos(Math.round(Number(parcelaSel.valorPrevisto) * 100))} · Vence {fmtDate(parcelaSel.vencimento)}</div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">Cliente</label>
                <input type="text" placeholder="Nome, CPF ou CNPJ..."
                  value={clienteQuery}
                  onChange={(e) => { setClienteQuery(e.target.value); setClienteSel(null); }}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {clienteSugest.length > 0 && !clienteSel && (
                  <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {clienteSugest.map((c) => (
                      <li key={c.id}>
                        <button type="button"
                          onMouseDown={() => { setClienteSel(c); setClienteQuery(c.nomeRazaoSocial); setClienteSugest([]); }}
                          className="w-full text-left px-4 py-2 hover:bg-blue-50 text-sm">
                          <span className="font-medium">{c.nomeRazaoSocial}</span>
                          <span className="text-slate-400 text-xs ml-2">{c.cpfCnpj}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {clienteSel && (
                  <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-2 text-sm text-blue-900 font-medium">{clienteSel.nomeRazaoSocial}</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Valor (R$)</label>
                  <input type="text" placeholder="0,00" value={valorAvulso}
                    onChange={(e) => setValorAvulso(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Vencimento</label>
                  <input type="date" value={vencAvulso}
                    onChange={(e) => setVencAvulso(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </>
          )}

          {/* Histórico */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Histórico <span className="text-red-500">*</span></label>
            <textarea value={historico}
              onChange={(e) => setHistorico(e.target.value)}
              maxLength={160}
              rows={2}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Multa / Mora / Validade */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Multa (%)</label>
              <input type="number" min="0" max="10" step="0.01" value={multaPerc}
                onChange={(e) => setMultaPerc(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mora (%/mês)</label>
              <input type="number" min="0" max="5" step="0.01" value={moraPerc}
                onChange={(e) => setMoraPerc(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Validade (dias)</label>
              <input type="number" min="1" max="60" value={validade}
                onChange={(e) => setValidade(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{erro}</div>
          )}
        </form>

        <div className="px-6 py-4 border-t border-slate-200 flex-shrink-0 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 text-sm">
            Cancelar
          </button>
          <button type="submit" form="emitir-form" disabled={loading}
            className="flex-1 rounded-xl bg-blue-700 text-white px-4 py-2 font-semibold hover:bg-blue-800 text-sm disabled:opacity-60">
            {loading ? "Emitindo..." : "Emitir Boleto"}
          </button>
        </div>
      </div>

      {/* Modal de campos faltando — sobrepõe o ModalEmitir */}
      {camposFaltandoState && (
        <ModalCamposFaltando
          cliente={camposFaltandoState.cliente}
          camposFaltando={camposFaltandoState.campos}
          onIncluir={handleCamposIncluidos}
          onCancelar={() => setCamposFaltandoState(null)}
        />
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function Boletos({ user, bank = "inter" }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const { addToast, confirmToast } = useToast();
  const bankKey = String(bank || "inter").toLowerCase();
  const isSantander = bankKey === "santander";
  const bankName = isSantander ? "Santander" : "Inter";
  const apiBase = isSantander ? "/santander/boletos" : "/boletos";

  const [boletos, setBoletos]           = useState([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [pages, setPages]               = useState(1);
  const [loading, setLoading]           = useState(false);
  const [modo, setModo]                 = useState(null);

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [vencDe, setVencDe]             = useState("");
  const [vencAte, setVencAte]           = useState("");

  // Modais
  const [showEmitir, setShowEmitir]     = useState(false);
  const [detalhe, setDetalhe]           = useState(null);
  const [alterando, setAlterando]       = useState(null); // boleto sendo alterado
  const [salvandoAlt, setSalvandoAlt]   = useState(false);
  const [cancelando, setCancelando]     = useState(null);
  const [sincronizando, setSincronizando] = useState(null);

  const debounceQ = useRef(null);
  const [buscaDebounced, setBuscaDebounced] = useState("");

  useEffect(() => {
    clearTimeout(debounceQ.current);
    debounceQ.current = setTimeout(() => setBuscaDebounced(buscaCliente), 400);
  }, [buscaCliente]);

  const LIMIT = 25;

  const carregar = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT });
      if (filtroStatus)    params.set("status", filtroStatus);
      if (buscaDebounced)  params.set("q", buscaDebounced);
      if (vencDe)          params.set("vencDe", vencDe);
      if (vencAte)         params.set("vencAte", vencAte);
      const r = await apiFetch(`${apiBase}?${params}`);
      setBoletos(r.boletos || []);
      setTotal(r.total || 0);
      setPages(r.pages || 1);
      setPage(p);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiBase, filtroStatus, buscaDebounced, vencDe, vencAte]);

  useEffect(() => { carregar(1); }, [carregar]);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch(`${apiBase}/config/modo`).then((r) => setModo(r.modo)).catch(() => {});
  }, [apiBase, isAdmin]);

  async function handleCancelar(boleto) {
    const ok = await confirmToast(`Cancelar boleto #${boleto.id} — ${brlFromCentavos(boleto.valorCentavos)}?`);
    if (!ok) return;
    setCancelando(boleto.id);
    try {
      await apiFetch(`${apiBase}/${boleto.id}/cancelar`, { method: "POST" });
      setDetalhe(null);
      carregar(page);
      addToast("Boleto cancelado.", "success");
    } catch (e) {
      addToast(e.message || "Erro ao cancelar boleto", "error");
    } finally {
      setCancelando(null);
    }
  }

  async function handleSincronizar(boleto) {
    setSincronizando(boleto.id);
    try {
      const r = await apiFetch(`${apiBase}/${boleto.id}/sincronizar`, { method: "POST" });
      if (r.sincronizado) {
        addToast(`Status atualizado: ${r.statusAnterior} → ${r.boleto.status}`, "success");
        if (detalhe?.id === boleto.id) setDetalhe((d) => ({ ...d, status: r.boleto.status }));
        carregar(page);
      } else {
        addToast("Boleto já sincronizado.", "info");
      }
    } catch (e) {
      addToast(e.message || "Erro ao sincronizar boleto", "error");
    } finally {
      setSincronizando(null);
    }
  }

  async function handleAlterar({ dataVencimento, multaPerc, moraPercMes }) {
    setSalvandoAlt(true);
    try {
      const updated = await apiFetch(`${apiBase}/${alterando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ dataVencimento, multaPerc, moraPercMes }),
      });
      setAlterando(null);
      // Atualiza o detalhe aberto se for o mesmo boleto
      if (detalhe?.id === updated.id) setDetalhe((d) => ({ ...d, ...updated }));
      carregar(page);
      addToast("Vencimento atualizado.", "success");
    } catch (e) {
      addToast(e.message || "Erro ao alterar boleto", "error");
    } finally {
      setSalvandoAlt(false);
    }
  }

  // Contagens por status para as tabs
  const countByStatus = {};
  boletos.forEach((b) => { countByStatus[b.status] = (countByStatus[b.status] || 0) + 1; });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Boletos {bankName}</h1>
            <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-2">
              {total} boleto{total !== 1 ? "s" : ""}
              {modo && <ModoBadge modo={modo} />}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowEmitir(true)}
              className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 rounded-xl font-semibold text-sm shadow-sm transition-colors"
            >
              + Emitir Boleto
            </button>
          )}
        </div>

        {/* Tabs de status */}
        <div className="flex gap-1 mb-4">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFiltroStatus(tab.value)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                filtroStatus === tab.value
                  ? "bg-blue-700 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:border-blue-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filtros adicionais */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4 flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Buscar cliente</label>
            <input
              type="text"
              placeholder="Nome, CPF ou CNPJ..."
              value={buscaCliente}
              onChange={(e) => setBuscaCliente(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Vencimento de</label>
            <input type="date" value={vencDe} onChange={(e) => setVencDe(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Vencimento até</label>
            <input type="date" value={vencAte} onChange={(e) => setVencAte(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {(buscaCliente || vencDe || vencAte) && (
            <button
              onClick={() => { setBuscaCliente(""); setVencDe(""); setVencAte(""); }}
              className="text-xs text-slate-500 hover:text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {/* Tabela */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Carregando...</div>
          ) : boletos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <div className="text-4xl mb-3">🏦</div>
              <div className="font-medium">Nenhum boleto encontrado</div>
              {isAdmin && filtroStatus === "" && !buscaCliente && (
                <div className="text-sm mt-1">Clique em "Emitir Boleto" para começar</div>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">N° Doc.</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Vencimento</th>
                  <th className="text-right px-4 py-3">Valor</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-center px-4 py-3 hidden lg:table-cell">Modo</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {boletos.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 truncate max-w-[180px]">{b.pagadorNome || b.cliente?.nomeRazaoSocial || "—"}</div>
                      {b.parcela && (
                        <div className="text-xs text-slate-400">Parcela #{b.parcela.numero} · {b.parcela.contrato?.numeroContrato || ""}</div>
                      )}
                      <div className="text-xs text-slate-400 md:hidden">{fmtDate(b.dataVencimento)}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 hidden md:table-cell">
                      {b.docNum || `#${b.id}`}
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{fmtDate(b.dataVencimento)}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">{brlFromCentavos(b.valorCentavos)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3 text-center hidden lg:table-cell"><ModoBadge modo={b.modo} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetalhe(b)}
                          className="text-blue-600 hover:text-blue-800 text-xs px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors font-medium"
                        >
                          Ver
                        </button>
                        {isAdmin && b.status === "EMITIDO" && (
                          <>
                            <button
                              onClick={() => setAlterando(b)}
                              className="text-amber-600 hover:text-amber-800 text-xs px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors font-medium"
                            >
                              Alterar
                            </button>
                            <button
                              onClick={() => handleSincronizar(b)}
                              disabled={sincronizando === b.id}
                              className="text-slate-600 hover:text-slate-800 text-xs px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors font-medium disabled:opacity-50"
                            >
                              {sincronizando === b.id ? "..." : "Sync"}
                            </button>
                            <button
                              onClick={() => handleCancelar(b)}
                              disabled={cancelando === b.id}
                              className="text-red-600 hover:text-red-800 text-xs px-2 py-1 rounded-lg hover:bg-red-50 transition-colors font-medium disabled:opacity-50"
                            >
                              {cancelando === b.id ? "..." : "Cancelar"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Paginação */}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => carregar(page - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm disabled:opacity-40 hover:bg-slate-50">
              ← Anterior
            </button>
            <span className="text-sm text-slate-500">Página {page} de {pages}</span>
            <button disabled={page >= pages} onClick={() => carregar(page + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm disabled:opacity-40 hover:bg-slate-50">
              Próxima →
            </button>
          </div>
        )}
      </div>

      {/* Modais */}
      {showEmitir && (
        <ModalEmitir
          apiBase={apiBase}
          onClose={() => setShowEmitir(false)}
          onSuccess={(boleto) => { setShowEmitir(false); setDetalhe(boleto); carregar(1); addToast("Boleto emitido! PDF/e-mail sendo processados.", "success"); }}
        />
      )}
      {detalhe && !alterando && (
        <ModalDetalhes
          boleto={detalhe}
          bankName={bankName}
          isAdmin={isAdmin}
          onClose={() => setDetalhe(null)}
          onCancelar={handleCancelar}
          onAlterar={(b) => setAlterando(b)}
          onSincronizar={handleSincronizar}
          sincronizando={sincronizando}
        />
      )}
      {alterando && (
        <ModalAlterar
          boleto={alterando}
          bankName={bankName}
          loading={salvandoAlt}
          onClose={() => setAlterando(null)}
          onConfirm={handleAlterar}
        />
      )}
    </div>
  );
}
