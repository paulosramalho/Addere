// src/pages/ContaCorrenteClientes.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { fmtDate, brlFromCentavos } from '../lib/formatters';
import logoUrl from '../assets/logo.png';

/* ---------- helpers ---------- */
function inputDateValue(iso) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}
function parseCentsFromBRL(str) {
  const clean = String(str || "").replace(/[^\d,]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : Math.round(n * 100);
}
function maskBRLFromDigits(digitsOnly) {
  const digits = String(digitsOnly || "").replace(/\D/g, "");
  if (!digits) return "";
  const n = Number(digits);
  const value = Number.isFinite(n) ? n / 100 : 0;
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtCpfCnpj(value) {
  if (!value) return "—";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length <= 11)
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}
// format signed cents as BRL string with sign
function fmtSigned(cents) {
  if (cents === 0) return "R$ 0,00";
  const abs = Math.abs(cents);
  return (cents > 0 ? "+" : "-") + brlFromCentavos(abs);
}

/* ---------- small UI pieces ---------- */
function Card({ title, subtitle, children, right }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-slate-900">{title}</div>
          {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
        </div>
        {right && <div className="pt-0.5">{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
function Btn({ onClick, disabled, children, tone = "slate", small }) {
  const base = "inline-flex items-center gap-1.5 rounded-xl font-medium transition-colors disabled:opacity-50";
  const size = small ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  const tones = {
    slate: "bg-slate-900 text-white hover:bg-slate-700",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50",
    red: "bg-red-600 text-white hover:bg-red-700",
    green: "bg-emerald-600 text-white hover:bg-emerald-700",
    ghost: "text-slate-600 hover:bg-slate-100",
    amber: "bg-amber-500 text-white hover:bg-amber-600",
  };
  return (
    <button className={`${base} ${size} ${tones[tone] || tones.slate}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function NaturezaBadge({ natureza }) {
  if (natureza === "ABERTURA")
    return <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">Abertura</span>;
  if (natureza === "DEBITO")
    return <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Débito</span>;
  return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Crédito</span>;
}
function SaldoBadge({ cents }) {
  if (cents === 0) return <span className="text-slate-400 text-sm font-medium">R$ 0,00</span>;
  if (cents > 0) return <span className="text-emerald-700 text-sm font-semibold">+{brlFromCentavos(cents)}</span>;
  return <span className="text-red-600 text-sm font-semibold">{brlFromCentavos(cents)}</span>;
}

/* ---------- Saldo Inicial modal ---------- */
function ModalSaldoInicial({ clienteNome, saldoInicialCent, dataAbertura, onSave, onClose, loading }) {
  const abs = Math.abs(saldoInicialCent || 0);
  const naturezaInicial = (saldoInicialCent || 0) >= 0 ? "CREDITO" : "DEBITO";

  const [natureza, setNatureza] = useState(naturezaInicial);
  const [valor, setValor] = useState(abs > 0 ? maskBRLFromDigits(String(abs)) : "");
  const [data, setData] = useState(inputDateValue(dataAbertura) || new Date().toISOString().slice(0, 10));

  function handleSave() {
    const absCents = parseCentsFromBRL(valor);
    const signed = natureza === "CREDITO" ? absCents : -absCents;
    onSave({ saldoInicialCent: signed, dataAbertura: data || null });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-lg font-semibold text-slate-900">Saldo de Abertura</div>
          <div className="text-sm text-slate-500">{clienteNome}</div>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            Define o saldo inicial desta conta antes dos lançamentos registrados no sistema.
          </p>

          {/* Natureza toggle */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Saldo inicial é</label>
            <div className="flex rounded-xl overflow-hidden border border-slate-300">
              {[
                { val: "CREDITO", label: "Crédito — firma deve ao cliente" },
                { val: "DEBITO",  label: "Débito — cliente deve à firma" },
              ].map(({ val, label }) => (
                <button key={val} onClick={() => setNatureza(val)}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    natureza === val
                      ? val === "DEBITO" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Data abertura */}
          <div>
            <label className="text-sm font-medium text-slate-700">Data de abertura</label>
            <input type="date"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              value={data} onChange={(e) => setData(e.target.value)} />
          </div>

          {/* Valor */}
          <div>
            <label className="text-sm font-medium text-slate-700">Valor (R$)</label>
            <input type="text" inputMode="numeric" placeholder="0,00"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              value={valor}
              onChange={(e) => setValor(maskBRLFromDigits(e.target.value.replace(/\D/g, "")))} />
            <p className="mt-1 text-xs text-slate-400">
              Deixe 0,00 para zerar o saldo de abertura.
            </p>
          </div>
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2">
          <Btn tone="outline" onClick={onClose} disabled={loading}>Cancelar</Btn>
          <Btn tone="slate" onClick={handleSave} disabled={loading}>
            {loading ? "Salvando…" : "Salvar"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------- Lançamento modal ---------- */
function ModalLancamento({ clienteNome, lancamento, contas, clienteId, clientesList = [], onSave, onClose, loading }) {
  const isEdit = !!lancamento;
  const [form, setForm] = useState({
    data: isEdit ? inputDateValue(lancamento.data) : new Date().toISOString().slice(0, 10),
    natureza: isEdit ? lancamento.natureza : "DEBITO",
    descricao: isEdit ? lancamento.descricao : "",
    documento: isEdit ? (lancamento.documento || "") : "",
    valor: isEdit ? maskBRLFromDigits(String(lancamento.valorCent)) : "",
    observacoes: isEdit ? (lancamento.observacoes || "") : "",
  });
  const [vincularLC, setVincularLC] = useState(false);
  const [lcContaId, setLcContaId] = useState("");
  const [lcEs, setLcEs] = useState("S"); // DEBITO → Saída; CREDITO → Entrada

  function set(k, v) { setForm((p) => ({ ...p, [k]: v })); }

  function handleNaturezaChange(val) {
    set("natureza", val);
    setLcEs(val === "CREDITO" ? "E" : "S");
  }

  const isClienteCC = lcContaId && String(lcContaId).startsWith("CC:");
  const outrosClientes = clientesList.filter(c => c.id !== clienteId);

  function handleSave() {
    const valorCent = parseCentsFromBRL(form.valor);
    if (!form.data || !form.descricao.trim() || valorCent <= 0) return;
    const payload = {
      data: form.data + "T12:00:00Z", natureza: form.natureza, descricao: form.descricao.trim(),
      documento: form.documento.trim() || null, valorCent, observacoes: form.observacoes.trim() || null,
    };
    if (!isEdit && vincularLC && lcContaId) {
      if (isClienteCC) {
        payload.clienteDestinoId = Number(lcContaId.replace("CC:", ""));
      } else {
        payload.contaId = Number(lcContaId);
        payload.esLc = lcEs;
      }
    }
    onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="text-lg font-semibold text-slate-900">{isEdit ? "Editar Lançamento" : "Novo Lançamento"}</div>
          <div className="text-sm text-slate-500">{clienteNome}</div>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Natureza toggle */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Natureza</label>
            <div className="flex rounded-xl overflow-hidden border border-slate-300">
              {[{ val: "DEBITO", label: "Débito (cliente deve)" }, { val: "CREDITO", label: "Crédito (firma deve)" }].map(({ val, label }) => (
                <button key={val} onClick={() => handleNaturezaChange(val)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    form.natureza === val
                      ? val === "DEBITO" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}>{label}</button>
              ))}
            </div>
          </div>
          {/* Data */}
          <div>
            <label className="text-sm font-medium text-slate-700">Data</label>
            <input type="date"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              value={form.data} onChange={(e) => set("data", e.target.value)} />
          </div>
          {/* Descrição */}
          <div>
            <label className="text-sm font-medium text-slate-700">Descrição</label>
            <input type="text" placeholder="Ex.: Custas judiciais, Acordo recebido..."
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              value={form.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700">Valor (R$)</label>
              <input type="text" inputMode="numeric" placeholder="0,00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                value={form.valor}
                onChange={(e) => set("valor", maskBRLFromDigits(e.target.value.replace(/\D/g, "")))} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Documento (opcional)</label>
              <input type="text" placeholder="NF, Recibo..."
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                value={form.documento} onChange={(e) => set("documento", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Observações (opcional)</label>
            <textarea className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 min-h-[60px]"
              value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} />
          </div>

          {/* Vincular ao Livro Caixa / transferir para CC de cliente — novo lançamento apenas */}
          {!isEdit && (contas.length > 0 || outrosClientes.length > 0) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input id="vincLC" type="checkbox"
                  className="rounded border-slate-300 accent-slate-800 cursor-pointer"
                  checked={vincularLC} onChange={(e) => { setVincularLC(e.target.checked); setLcContaId(""); }} />
                <label htmlFor="vincLC" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Gerar lançamento no Livro Caixa / transferir CC
                </label>
              </div>
              {vincularLC && (
                <>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Conta contábil</label>
                    <select
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 bg-white"
                      value={lcContaId} onChange={(e) => setLcContaId(e.target.value)}>
                      <option value="">Selecione…</option>
                      {contas.length > 0 && (
                        <optgroup label="Contas Bancárias / LC">
                          {contas.map((c) => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                          ))}
                        </optgroup>
                      )}
                      {outrosClientes.length > 0 && (
                        <optgroup label="Conta Corrente de Cliente">
                          {outrosClientes.map((c) => (
                            <option key={c.id} value={`CC:${c.id}`}>{c.nomeRazaoSocial}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  {/* Direção no LC — apenas para contas bancárias */}
                  {lcContaId && !isClienteCC && (
                    <div>
                      <label className="text-xs font-medium text-slate-600">Direção no LC</label>
                      <div className="flex rounded-xl overflow-hidden border border-slate-300 mt-1">
                        {[{ val: "E", label: "Entrada" }, { val: "S", label: "Saída" }].map(({ val, label }) => (
                          <button key={val} type="button" onClick={() => setLcEs(val)}
                            className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                              lcEs === val
                                ? val === "E" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                                : "bg-white text-slate-600 hover:bg-slate-50"
                            }`}>{label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Aviso para CC de cliente */}
                  {isClienteCC && (
                    <p className="text-xs text-slate-500">
                      Transferência entre contas correntes — nenhum lançamento no Livro Caixa.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2 flex-shrink-0 border-t border-slate-100 pt-4">
          <Btn tone="outline" onClick={onClose} disabled={loading}>Cancelar</Btn>
          <Btn tone="slate" onClick={handleSave} disabled={loading}>{loading ? "Salvando…" : "Salvar"}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------- Modal Honorários ---------- */
function ModalHonorarios({ clienteNome, saldoDisponCent, contas, advogados = [], onSave, onClose, loading }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    valor: saldoDisponCent > 0 ? maskBRLFromDigits(String(saldoDisponCent)) : "",
    contaId: "",
    historico: "Honorários advocatícios",
    dataRecebimento: today,
    isentoTributacao: false,
    advogadoId: "",
    indicacaoId: "",
    usaSplitSocio: false,
    splits: [],
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // Defaults após remoção da feature ModeloDistribuicao (sem modelo = caso simples)
  const needsAdvogadoPrincipal = true;
  const hasIndicacao = false;
  const socioBp = 0;
  const splitExcede = false;

  function handleSave() {
    const valorCent = parseCentsFromBRL(form.valor);
    if (valorCent <= 0)          { addToast("Informe um valor válido.", "error"); return; }
    if (!form.contaId)           { addToast("Selecione a conta de destino.", "error"); return; }
    if (!form.historico.trim())  { addToast("Informe o histórico.", "error"); return; }
    if (needsAdvogadoPrincipal && !form.usaSplitSocio && !form.advogadoId)
      { addToast("Selecione o advogado.", "error"); return; }
    if (hasIndicacao && !form.indicacaoId)
      { addToast("Selecione o advogado de indicação.", "error"); return; }
    if (form.usaSplitSocio && !(form.splits || []).some(s => s.advogadoId))
      { addToast("Informe ao menos um advogado no split.", "error"); return; }
    onSave({
      valorCent,
      contaId: Number(form.contaId),
      historico: form.historico.trim(),
      dataRecebimento: form.dataRecebimento ? form.dataRecebimento + "T12:00:00Z" : null,
      isentoTributacao: form.isentoTributacao,
      repasseAdvogadoPrincipalId: (needsAdvogadoPrincipal && form.advogadoId && !form.usaSplitSocio) ? Number(form.advogadoId) : null,
      repasseIndicacaoAdvogadoId: form.indicacaoId ? Number(form.indicacaoId) : null,
      usaSplitSocio: form.usaSplitSocio,
      splits: (form.splits || []).map(s => ({ advogadoId: s.advogadoId ? Number(s.advogadoId) : null, percentual: s.percentual })),
    });
  }

  const lb = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };
  const inp = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none" };
  const contasBanco = contas.filter(c => c.tipo !== "CLIENTES");
  const contaSelecionadaNome = contasBanco.find(c => String(c.id) === String(form.contaId))?.nome || "conta destino";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 440, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>

        {/* Header fixo */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>Registrar Honorários</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{clienteNome}</div>
        </div>

        {/* Body rolável */}
        <div style={{ overflowY: "auto", flex: 1, padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Valor */}
          <div>
            <label style={lb}>Valor (R$) *</label>
            <input style={inp} value={form.valor}
              onChange={e => set("valor", e.target.value)}
              placeholder="16.500,00" />
            {saldoDisponCent > 0 && (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                Saldo disponível: {brlFromCentavos(saldoDisponCent)}
              </div>
            )}
          </div>

          {/* Conta destino */}
          <div>
            <label style={lb}>Conta Destino *</label>
            <select style={inp} value={form.contaId} onChange={e => set("contaId", e.target.value)}>
              <option value="">— selecione —</option>
              {contasBanco.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>

          {/* Histórico */}
          <div>
            <label style={lb}>Histórico *</label>
            <input style={inp} value={form.historico}
              onChange={e => set("historico", e.target.value)}
              placeholder="Honorários advocatícios — ação X" />
          </div>

          {/* Data */}
          <div>
            <label style={lb}>Data *</label>
            <input type="date" style={inp} value={form.dataRecebimento}
              onChange={e => set("dataRecebimento", e.target.value)} />
          </div>

          {/* Resumo */}
          <div style={{ padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, color: "#475569", lineHeight: 1.6 }}>
            ① DÉBITO CC {clienteNome} · ② AV gerado (parcela RECEBIDA) · ③ ENTRADA {contaSelecionadaNome}
          </div>
        </div>

        {/* Footer fixo */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", flexShrink: 0, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn tone="outline" onClick={onClose} disabled={loading}>Cancelar</Btn>
          <Btn tone="green" onClick={handleSave} disabled={loading || splitExcede}>
            {loading ? "Registrando…" : "Registrar Honorários"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------- Modal Enviar E-mail ---------- */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ModalEnviarEmail({ count, clienteEmail, clienteNome, onSend, onClose, loading }) {
  const [selected, setSelected] = useState(new Set()); // emails confirmados
  const [inputVal, setInputVal] = useState("");
  const [advogados, setAdvogados] = useState([]);
  const inputRef = React.useRef(null);

  useEffect(() => {
    apiFetch("/advogados")
      .then((data) => setAdvogados((data || []).filter((a) => a.email)))
      .catch(() => {});
  }, []);

  const sugestoes = [];
  if (count === 1 && clienteEmail)
    sugestoes.push({ label: clienteNome, email: clienteEmail });
  advogados.forEach((a) => sugestoes.push({ label: a.nome, email: a.email }));

  function addEmail(e) {
    const v = e.trim().toLowerCase();
    if (!RE_EMAIL.test(v)) return;
    setSelected((prev) => new Set([...prev, v]));
    setInputVal("");
  }
  function removeEmail(e) {
    setSelected((prev) => { const n = new Set(prev); n.delete(e); return n; });
  }
  function toggleSugestao(e) {
    const v = e.toLowerCase();
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });
    inputRef.current?.focus();
  }
  function handleKeyDown(ev) {
    if (ev.key === "Enter" || ev.key === "," || ev.key === " ") {
      ev.preventDefault();
      addEmail(inputVal);
    } else if (ev.key === "Backspace" && inputVal === "" && selected.size > 0) {
      const last = [...selected].at(-1);
      removeEmail(last);
    }
  }

  const canSend = selected.size > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-lg font-semibold text-slate-900">Enviar por e-mail</div>
          <div className="text-sm text-slate-500">
            {count === 1 ? "1 cliente selecionado" : `${count} clientes selecionados`}
          </div>
        </div>
        <div className="p-5 space-y-4">
          {/* Sugestões */}
          {sugestoes.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-2">Sugestões</div>
              <div className="flex flex-wrap gap-1.5">
                {sugestoes.map((s) => {
                  const ativo = selected.has(s.email.toLowerCase());
                  return (
                    <button key={s.email} type="button" onClick={() => toggleSugestao(s.email)}
                      className={`inline-flex flex-col items-start rounded-xl border px-3 py-1.5 text-left transition-colors ${
                        ativo
                          ? "border-slate-800 bg-slate-800 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}>
                      <span className="text-xs font-medium leading-tight">{s.label}</span>
                      <span className={`text-[11px] leading-tight ${ativo ? "text-slate-300" : "text-slate-400"}`}>
                        {s.email}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Campo destinatários com chips */}
          <div>
            <label className="text-sm font-medium text-slate-700">Destinatários</label>
            <div
              className="mt-1 min-h-[42px] flex flex-wrap gap-1.5 rounded-xl border border-slate-300 px-2 py-1.5 cursor-text focus-within:ring-2 focus-within:ring-slate-200"
              onClick={() => inputRef.current?.focus()}
            >
              {[...selected].map((e) => (
                <span key={e} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {e}
                  <button type="button" onClick={(ev) => { ev.stopPropagation(); removeEmail(e); }}
                    className="text-slate-400 hover:text-slate-700 leading-none">×</button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="email"
                placeholder={selected.size === 0 ? "email@exemplo.com — Enter para adicionar" : ""}
                className="flex-1 min-w-[180px] bg-transparent text-sm outline-none py-0.5"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => { if (inputVal.trim()) addEmail(inputVal); }}
                autoFocus
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">Enter, vírgula ou espaço para confirmar cada e-mail</p>
          </div>
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2">
          <Btn tone="outline" onClick={onClose} disabled={loading}>Cancelar</Btn>
          <Btn tone="slate" onClick={() => onSend([...selected])} disabled={!canSend || loading}>
            {loading ? "Enviando…" : `Enviar${selected.size > 1 ? ` (${selected.size})` : ""}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------- main page ---------- */
export default function ContaCorrenteClientes({ user }) {
  const { addToast, confirmToast } = useToast();

  const [clientes, setClientes] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const [detalhe, setDetalhe] = useState(null); // { cliente, lancamentos }
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);

  const [modal, setModal] = useState(null);         // lancamento modal
  const [modalAbertura, setModalAbertura] = useState(null); // saldo inicial modal
  const [savingModal, setSavingModal] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [modalEmail, setModalEmail] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const [contas,    setContas]    = useState([]);
  const [advogados, setAdvogados] = useState([]);
  const [modalHonorarios, setModalHonorarios] = useState(null); // { clienteId, clienteNome, saldoCent }

  useEffect(() => {
    apiFetch("/livro-caixa/contas").then((data) => setContas(data || [])).catch(() => {});
    apiFetch("/advogados").then((data) => setAdvogados(data || [])).catch(() => {});
  }, []);

  /* ---- load list ---- */
  async function loadList() {
    setLoadingList(true);
    try {
      const data = await apiFetch("/conta-corrente-clientes");
      setClientes(data);
    } catch (err) {
      addToast("Erro ao carregar contas: " + err.message, "error");
    } finally {
      setLoadingList(false);
    }
  }
  useEffect(() => { loadList(); }, []);

  /* ---- load detail ---- */
  async function loadDetalhe(clienteId) {
    setLoadingDetalhe(true);
    try {
      const data = await apiFetch(`/conta-corrente-clientes/${clienteId}/lancamentos`);
      setDetalhe(data);
    } catch (err) {
      addToast("Erro ao carregar lançamentos: " + err.message, "error");
    } finally {
      setLoadingDetalhe(false);
    }
  }

  function voltar() { setDetalhe(null); loadList(); }

  /* ---- selection helpers ---- */
  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === clientes.length ? new Set() : new Set(clientes.map((c) => c.id))
    );
  }

  /* ---- send email ---- */
  async function handleEnviarEmail(destinatarios) {
    setSendingEmail(true);
    try {
      await apiFetch("/conta-corrente-clientes/enviar-email", {
        method: "POST",
        body: JSON.stringify({ clienteIds: [...selectedIds], destinatarios }),
      });
      const d = destinatarios.length;
      addToast(`E-mail enviado para ${d === 1 ? "1 destinatário" : `${d} destinatários`}!`, "success");
      setModalEmail(false);
      setSelectedIds(new Set());
    } catch (err) {
      addToast("Erro ao enviar: " + err.message, "error");
    } finally {
      setSendingEmail(false);
    }
  }

  /* ---- save opening balance ---- */
  async function handleSaveAbertura({ saldoInicialCent, dataAbertura }) {
    setSavingModal(true);
    try {
      await apiFetch(`/conta-corrente-clientes/${modalAbertura.clienteId}/saldo-inicial`, {
        method: "PUT",
        body: JSON.stringify({ saldoInicialCent, dataAbertura }),
      });
      addToast("Saldo de abertura atualizado.", "success");
      setModalAbertura(null);
      if (detalhe) loadDetalhe(detalhe.cliente.id);
      else loadList();
    } catch (err) {
      addToast("Erro ao salvar: " + err.message, "error");
    } finally {
      setSavingModal(false);
    }
  }

  /* ---- save lancamento ---- */
  async function handleSave(formData) {
    setSavingModal(true);
    try {
      if (modal.lancamento) {
        await apiFetch(`/conta-corrente-clientes/lancamentos/${modal.lancamento.id}`, {
          method: "PUT", body: JSON.stringify(formData),
        });
        addToast("Lançamento atualizado.", "success");
      } else {
        await apiFetch(`/conta-corrente-clientes/${modal.clienteId}/lancamentos`, {
          method: "POST", body: JSON.stringify(formData),
        });
        addToast("Lançamento criado.", "success");
      }
      setModal(null);
      if (detalhe) loadDetalhe(detalhe.cliente.id); else loadList();
    } catch (err) {
      addToast("Erro ao salvar: " + err.message, "error");
    } finally {
      setSavingModal(false);
    }
  }

  /* ---- honorários ---- */
  async function handleSaveHonorarios(payload) {
    setSavingModal(true);
    try {
      const res = await apiFetch(`/conta-corrente-clientes/${modalHonorarios.clienteId}/honorarios`, {
        method: "POST",
        body: payload,
      });
      addToast(`Honorários registrados — ${res.numeroAV}`, "success");
      setModalHonorarios(null);
      if (detalhe) loadDetalhe(detalhe.cliente.id); else loadList();
    } catch (err) {
      addToast("Erro ao registrar honorários: " + err.message, "error");
    } finally {
      setSavingModal(false);
    }
  }

  /* ---- delete ---- */
  async function handleDelete(lancamento) {
    const ok = await confirmToast(`Excluir o lançamento "${lancamento.descricao}"?`);
    if (!ok) return;
    try {
      await apiFetch(`/conta-corrente-clientes/lancamentos/${lancamento.id}`, { method: "DELETE" });
      addToast("Lançamento excluído.", "success");
      loadDetalhe(detalhe.cliente.id);
    } catch (err) {
      addToast("Erro ao excluir: " + err.message, "error");
    }
  }

  /* ---- totals ---- */
  const totais = useMemo(() => {
    const totalD = clientes.reduce((s, c) => s + c.totalDebitoCent, 0);
    const totalC = clientes.reduce((s, c) => s + c.totalCreditoCent, 0);
    const totalSI = clientes.reduce((s, c) => s + (c.saldoInicialCent || 0), 0);
    return { totalD, totalC, saldo: totalSI + totalC - totalD };
  }, [clientes]);

  /* ---- DETAIL VIEW ---- */
  if (detalhe) {
    const { cliente, lancamentos } = detalhe;
    const finalSaldo = lancamentos.length > 0
      ? lancamentos[lancamentos.length - 1].saldoAcumCent
      : (cliente.saldoInicialCent || 0);

    // build rows: opening balance row + movements
    const aberturaVal = cliente.saldoInicialCent || 0;
    const aberturaRow = {
      _isAbertura: true,
      id: "__abertura__",
      data: cliente.dataAbertura || null,
      descricao: "Saldo de abertura",
      documento: null,
      natureza: "ABERTURA",
      valorCent: Math.abs(aberturaVal),
      saldoAcumCent: aberturaVal,
    };

    async function gerarPDF() {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = 210;
      const mg = 14;
      const FOOTER_Y  = 288;
      const PAGE_BOTTOM = 276; // margem antes do rodapé

      // — Config e emissor
      let cfg = {};
      try { cfg = await apiFetch("/config-empresa"); } catch (_) {}
      const now = new Date();
      const emitidoEm = now.toLocaleDateString('pt-BR') + ' às ' +
        now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const emissor = user?.nome || user?.email || 'Sistema';

      // — Logo (mantém proporção, altura 5mm)
      let logoImg = null, logoW = 5, logoH = 5;
      try {
        logoImg = new Image();
        logoImg.src = logoUrl;
        await new Promise(res => { logoImg.onload = res; logoImg.onerror = res; });
        logoH = 5;
        logoW = logoImg.naturalHeight > 0 ? (logoImg.naturalWidth / logoImg.naturalHeight) * logoH : 5;
      } catch (_) {}

      const TEXT_X = mg + logoW + 3;

      // — Colunas da tabela (total = W - 2*mg = 182mm)
      const cols = [
        { label: 'Data',      x: mg,       w: 22, align: 'left'   },
        { label: 'Descrição', x: mg + 22,  w: 68, align: 'left'   },
        { label: 'Natureza',  x: mg + 90,  w: 24, align: 'center' },
        { label: 'Valor',     x: mg + 114, w: 34, align: 'right'  },
        { label: 'Saldo',     x: mg + 148, w: 34, align: 'right'  },
      ];

      // — Cabeçalho da tabela (reutilizado ao paginar)
      function drawTableHeader(yPos) {
        doc.setFillColor(30, 41, 59);
        doc.rect(mg, yPos, W - 2 * mg, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        cols.forEach(col => {
          const tx = col.align === 'right' ? col.x + col.w
            : col.align === 'center' ? col.x + col.w / 2 : col.x + 1;
          doc.text(col.label, tx, yPos + 4.5, { align: col.align });
        });
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        return yPos + 7;
      }

      // — Cabeçalho da página (primeira ou continuação)
      function drawPageHeader(isFirst) {
        let y = 11;
        if (isFirst) {
          // Logo
          if (logoImg) {
            try { doc.addImage(logoImg, 'PNG', mg, y, logoW, logoH); } catch (_) {}
          }

          // Nome do escritório — alinhado à direita (getTextWidth para garantir)
          const R = W - mg;
          const nomeEsc = cfg.nome || 'Addere';
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.setTextColor(15, 23, 42);
          doc.text(nomeEsc, R - doc.getTextWidth(nomeEsc), y + 4.5);

          // CNPJ | OAB
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          const idParts = [
            cfg.cnpj        ? `CNPJ: ${cfg.cnpj}` : null,
            cfg.oabRegistro ? `OAB: ${cfg.oabRegistro}` : null,
          ].filter(Boolean);
          if (idParts.length) {
            const idTxt = idParts.join('   ');
            doc.text(idTxt, R - doc.getTextWidth(idTxt), y + 9.5);
          }

          // Telefones
          const telParts = [
            cfg.telefoneFix ? `Tel: ${cfg.telefoneFix}` : null,
            cfg.celular     ? `Cel: ${cfg.celular}`     : null,
          ].filter(Boolean);
          if (telParts.length) {
            const telTxt = telParts.join('   ');
            doc.text(telTxt, R - doc.getTextWidth(telTxt), y + 14);
          }

          // Garantir que y não corte a logo
          y = y + logoH + 3;

          // Linha separadora
          doc.setDrawColor(203, 213, 225);
          doc.line(mg, y, W - mg, y); y += 6;

          // Título + dados do cliente
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.setTextColor(15, 23, 42);
          doc.text('Conta Corrente de Cliente', mg, y); y += 6;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(0, 0, 0);
          doc.text(`Cliente: ${cliente.nomeRazaoSocial}`, mg, y); y += 5;
          if (cliente.cpfCnpj) { doc.text(`CPF/CNPJ: ${fmtCpfCnpj(cliente.cpfCnpj)}`, mg, y); y += 5; }
          y += 2;
        } else {
          // Mini cabeçalho nas páginas seguintes
          let mX = mg;
          if (logoImg) {
            const mH = 8, mW = logoImg.naturalHeight > 0 ? (logoImg.naturalWidth / logoImg.naturalHeight) * mH : 8;
            try { doc.addImage(logoImg, 'PNG', mg, y, mW, mH); } catch (_) {}
            mX = mg + mW + 2;
          }
          const R2 = W - mg;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(15, 23, 42);
          const nomeM = cfg.nome || 'Addere';
          doc.text(nomeM, R2 - doc.getTextWidth(nomeM), y + 4);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          const contTxt = `Conta Corrente — ${cliente.nomeRazaoSocial} (continuação)`;
          doc.text(contTxt, R2 - doc.getTextWidth(contTxt), y + 8.5);
          y += 14;
          doc.setDrawColor(203, 213, 225);
          doc.line(mg, y, W - mg, y); y += 5;
        }
        doc.setTextColor(0, 0, 0);
        return y;
      }

      // — Primeira página
      let y = drawPageHeader(true);
      y = drawTableHeader(y);

      // — Linhas de dados
      const allRows = [aberturaRow, ...lancamentos];
      allRows.forEach((row, i) => {
        if (y > PAGE_BOTTOM) {
          doc.addPage();
          y = drawPageHeader(false);
          y = drawTableHeader(y);
        }
        const even = i % 2 === 0;
        doc.setFillColor(even ? 248 : 255, even ? 250 : 255, even ? 252 : 255);
        doc.rect(mg, y, W - 2 * mg, 6, 'F');

        const dateStr  = row.data ? fmtDate(row.data) : '—';
        const natStr   = row.natureza === 'ABERTURA' ? 'Abertura'
          : row.natureza === 'CREDITO' ? 'Crédito' : 'Débito';
        const valStr   = row._isAbertura
          ? brlFromCentavos(Math.abs(row.saldoAcumCent))
          : row.natureza === 'DEBITO' ? brlFromCentavos(-row.valorCent) : brlFromCentavos(row.valorCent);
        const saldoStr = brlFromCentavos(row.saldoAcumCent);
        const descStr  = doc.splitTextToSize(row.descricao || '—', cols[1].w - 2)[0];

        doc.setFontSize(8);
        doc.text(dateStr,  cols[0].x + 1,              y + 4);
        doc.text(descStr,  cols[1].x + 1,              y + 4);
        doc.text(natStr,   cols[2].x + cols[2].w / 2,  y + 4, { align: 'center' });
        doc.text(valStr,   cols[3].x + cols[3].w,      y + 4, { align: 'right' });
        doc.text(saldoStr, cols[4].x + cols[4].w,      y + 4, { align: 'right' });
        y += 6;
      });

      // — Saldo final
      y += 4;
      doc.setDrawColor(148, 163, 184);
      doc.line(mg, y, W - mg, y); y += 5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      const sfStr = finalSaldo === 0 ? 'R$ 0,00'
        : finalSaldo > 0 ? `+${brlFromCentavos(finalSaldo)}` : brlFromCentavos(finalSaldo);
      doc.text('Saldo Final:', mg, y);
      doc.text(sfStr, W - mg, y, { align: 'right' });

      // — Rodapé em todas as páginas (pós-processado)
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.setDrawColor(203, 213, 225);
        doc.line(mg, FOOTER_Y - 3, W - mg, FOOTER_Y - 3);
        doc.text(`Emitido em ${emitidoEm}, por ${emissor}`, mg, FOOTER_Y);
        doc.text(`Página ${p} de ${totalPages}`, W - mg, FOOTER_Y, { align: 'right' });
      }

      const fileName = `CC_${cliente.nomeRazaoSocial.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '_')}.pdf`;
      doc.save(fileName);
    }

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={voltar} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors">
            ← Voltar
          </button>
          <div className="h-4 w-px bg-slate-300" />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{cliente.nomeRazaoSocial}</h1>
            <div className="text-sm text-slate-500">{cliente.cpfCnpj}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 mb-0.5">Saldo</div>
            <SaldoBadge cents={finalSaldo} />
          </div>
          <Btn tone="slate" small
            onClick={() => setModal({ clienteId: cliente.id, clienteNome: cliente.nomeRazaoSocial, lancamento: null })}>
            + Lançamento
          </Btn>
          <Btn tone="green" small
            onClick={() => setModalHonorarios({ clienteId: cliente.id, clienteNome: cliente.nomeRazaoSocial, saldoCent: finalSaldo })}>
            Honorários
          </Btn>
          <Btn tone="outline" small onClick={gerarPDF}>
            Gerar PDF
          </Btn>
          <Btn tone="outline" small
            onClick={() => setModalAbertura({ clienteId: cliente.id, clienteNome: cliente.nomeRazaoSocial,
              saldoInicialCent: cliente.saldoInicialCent || 0, dataAbertura: cliente.dataAbertura })}>
            Saldo inicial
          </Btn>
        </div>

        {loadingDetalhe ? (
          <div className="text-sm text-slate-500">Carregando…</div>
        ) : (
          <Card title="Movimentos">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="pb-2 font-medium pr-4">Data</th>
                    <th className="pb-2 font-medium pr-4">Descrição</th>
                    <th className="pb-2 font-medium pr-4">Doc</th>
                    <th className="pb-2 font-medium pr-4">Natureza</th>
                    <th className="pb-2 font-medium text-right pr-4">Valor</th>
                    <th className="pb-2 font-medium text-right pr-4">Saldo</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {/* Opening balance row */}
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <td className="py-2 pr-4 text-slate-500">{fmtDate(aberturaRow.data)}</td>
                    <td className="py-2 pr-4 text-slate-600 italic">Saldo de abertura</td>
                    <td className="py-2 pr-4 text-slate-400">—</td>
                    <td className="py-2 pr-4"><NaturezaBadge natureza="ABERTURA" /></td>
                    <td className="py-2 pr-4 text-right text-slate-600 font-mono text-xs">
                      {fmtSigned(aberturaVal)}
                    </td>
                    <td className="py-2 pr-4 text-right"><SaldoBadge cents={aberturaVal} /></td>
                    <td className="py-2 text-right">
                      <Btn tone="ghost" small
                        onClick={() => setModalAbertura({ clienteId: cliente.id, clienteNome: cliente.nomeRazaoSocial,
                          saldoInicialCent: cliente.saldoInicialCent || 0, dataAbertura: cliente.dataAbertura })}>
                        ✏️
                      </Btn>
                    </td>
                  </tr>

                  {lancamentos.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 text-sm">
                        Nenhum lançamento. Clique em "+ Lançamento" para começar.
                      </td>
                    </tr>
                  ) : lancamentos.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 pr-4 whitespace-nowrap text-slate-600">{fmtDate(l.data)}</td>
                      <td className="py-2 pr-4 text-slate-800">
                        {l.descricao}
                        {l.observacoes && <div className="text-xs text-slate-400 mt-0.5">{l.observacoes}</div>}
                      </td>
                      <td className="py-2 pr-4 text-slate-500">{l.documento || "—"}</td>
                      <td className="py-2 pr-4"><NaturezaBadge natureza={l.natureza} /></td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {l.natureza === "CREDITO"
                          ? <span className="text-emerald-700">+{brlFromCentavos(l.valorCent)}</span>
                          : <span className="text-red-600">-{brlFromCentavos(l.valorCent)}</span>}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        <SaldoBadge cents={l.saldoAcumCent} />
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Btn tone="ghost" small onClick={() =>
                          setModal({ clienteId: cliente.id, clienteNome: cliente.nomeRazaoSocial, lancamento: l })}>✏️</Btn>
                        <Btn tone="ghost" small onClick={() => handleDelete(l)}>🗑️</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {modal && <ModalLancamento clienteNome={modal.clienteNome} lancamento={modal.lancamento}
          contas={contas} clienteId={modal.clienteId} clientesList={clientes}
          onSave={handleSave} onClose={() => setModal(null)} loading={savingModal} />}
        {modalAbertura && <ModalSaldoInicial clienteNome={modalAbertura.clienteNome}
          saldoInicialCent={modalAbertura.saldoInicialCent} dataAbertura={modalAbertura.dataAbertura}
          onSave={handleSaveAbertura} onClose={() => setModalAbertura(null)} loading={savingModal} />}
        {modalHonorarios && <ModalHonorarios
          clienteNome={modalHonorarios.clienteNome}
          saldoDisponCent={modalHonorarios.saldoCent}
          contas={contas} advogados={advogados}
          onSave={handleSaveHonorarios} onClose={() => setModalHonorarios(null)} loading={savingModal} />}
      </div>
    );
  }

  /* ---- LIST VIEW ---- */
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Conta Corrente — Clientes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Despesas pagas pelo escritório e valores recebidos de terceiros por cliente
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Btn tone="green" onClick={() => setModalEmail(true)}>
              ✉️ Enviar por e-mail ({selectedIds.size})
            </Btn>
          )}
          <Btn tone="outline" onClick={loadList} disabled={loadingList}>
            {loadingList ? "Carregando…" : "Atualizar"}
          </Btn>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Débitos (clientes devem)", cents: totais.totalD, color: "text-red-600" },
          { label: "Total Créditos (firma deve)", cents: totais.totalC, color: "text-emerald-700" },
          {
            label: totais.saldo >= 0 ? "Saldo (firma deve aos clientes)" : "Saldo (clientes devem à firma)",
            cents: totais.saldo,
            color: totais.saldo >= 0 ? "text-emerald-700" : "text-red-600",
          },
        ].map(({ label, cents, color }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`text-2xl font-bold mt-1 ${color}`}>{brlFromCentavos(Math.abs(cents))}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <Card title="Clientes">
        {loadingList ? (
          <div className="text-sm text-slate-500">Carregando…</div>
        ) : clientes.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">Nenhum cliente ativo encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="pb-2 pr-3 w-8">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 accent-slate-800 cursor-pointer"
                      checked={clientes.length > 0 && selectedIds.size === clientes.length}
                      onChange={toggleAll}
                      title="Selecionar todos"
                    />
                  </th>
                  <th className="pb-2 font-medium pr-4">Cliente</th>
                  <th className="pb-2 font-medium pr-4">CPF/CNPJ</th>
                  <th className="pb-2 font-medium text-right pr-4">Abertura</th>
                  <th className="pb-2 font-medium text-right pr-4">Débitos</th>
                  <th className="pb-2 font-medium text-right pr-4">Créditos</th>
                  <th className="pb-2 font-medium text-right pr-4">Saldo</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => {
                  const isSelected = selectedIds.has(c.id);
                  return (
                  <tr key={c.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50/60" : ""}`}
                    onClick={() => { setLoadingDetalhe(true); loadDetalhe(c.id); }}>
                    <td className="py-2.5 pr-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 accent-slate-800 cursor-pointer"
                        checked={isSelected}
                        onChange={() => toggleSelect(c.id)}
                      />
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{c.nomeRazaoSocial}</td>
                    <td className="py-2.5 pr-4 text-slate-500 font-mono text-xs">{fmtCpfCnpj(c.cpfCnpj)}</td>
                    <td className="py-2.5 pr-4 text-right">
                      {c.saldoInicialCent !== 0
                        ? <span className={c.saldoInicialCent > 0 ? "text-emerald-600 text-xs" : "text-red-500 text-xs"}>
                            {fmtSigned(c.saldoInicialCent)}
                          </span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-red-600">
                      {c.totalDebitoCent > 0 ? brlFromCentavos(c.totalDebitoCent) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-emerald-700">
                      {c.totalCreditoCent > 0 ? brlFromCentavos(c.totalCreditoCent) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-right"><SaldoBadge cents={c.saldoCent} /></td>
                    <td className="py-2.5 text-right">
                      <Btn tone="outline" small onClick={(e) => { e.stopPropagation(); loadDetalhe(c.id); }}>Ver</Btn>
                    </td>
                  </tr>
                  );
                })}

                {/* Total row */}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="py-2.5 pr-3" />
                  <td className="py-2.5 pr-4 text-slate-900" colSpan={2}>TOTAL</td>
                  <td className="py-2.5 pr-4 text-right text-xs text-slate-500">—</td>
                  <td className="py-2.5 pr-4 text-right text-red-600">{totais.totalD > 0 ? brlFromCentavos(totais.totalD) : "—"}</td>
                  <td className="py-2.5 pr-4 text-right text-emerald-700">{totais.totalC > 0 ? brlFromCentavos(totais.totalC) : "—"}</td>
                  <td className="py-2.5 pr-4 text-right"><SaldoBadge cents={totais.saldo} /></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modalEmail && (() => {
        const soUm = selectedIds.size === 1
          ? clientes.find((c) => c.id === [...selectedIds][0])
          : null;
        return (
          <ModalEnviarEmail
            count={selectedIds.size}
            clienteEmail={soUm?.email || null}
            clienteNome={soUm?.nomeRazaoSocial || null}
            onSend={handleEnviarEmail}
            onClose={() => setModalEmail(false)}
            loading={sendingEmail}
          />
        );
      })()}
    </div>
  );
}
