// src/pages/ConfiguracaoEmpresa.jsx
import React, { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

const EMPTY = {
  nome: "", nomeFantasia: "", cnpj: "", oabRegistro: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
  telefoneFix: "", celular: "", whatsapp: "",
};

/* ---- masks ---- */
function maskCNPJ(v) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2)  return d;
  if (d.length <= 5)  return `${d.slice(0,2)}.${d.slice(2)}`;
  if (d.length <= 8)  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function maskCEP(v) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

function maskPhone(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0)  return "";
  if (d.length <= 2)   return `(${d}`;
  if (d.length <= 6)   return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10)  return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,3)} ${d.slice(3,7)}-${d.slice(7)}`;
}

/* ---- CNPJ validation (check digits) ---- */
function validarCNPJ(cnpj) {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  function calc(base) {
    let sum = 0, pos = base.length - 7;
    for (let i = base.length; i >= 1; i--) {
      sum += parseInt(base[base.length - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  }
  return parseInt(d[12]) === calc(d.slice(0,12)) &&
         parseInt(d[13]) === calc(d.slice(0,13));
}

/* ---- wa.me helper ---- */
function waPhone(raw) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 0) return null;
  return d.startsWith("55") ? d : "55" + d;
}

/* ---- Field component ---- */
function Field({ label, value, onChange, placeholder, hint, maxLength, readOnly, error, suffix }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <div className="flex gap-1">
        <input
          type="text"
          className={`flex-1 rounded-xl border px-3 py-2 text-sm outline-none
            ${readOnly
              ? "bg-slate-50 border-slate-200 text-slate-600 cursor-default"
              : error
              ? "border-red-400 focus:ring-2 focus:ring-red-200"
              : "border-slate-300 focus:ring-2 focus:ring-blue-300"}`}
          value={value}
          onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder={readOnly ? "" : (placeholder || "")}
          maxLength={maxLength}
        />
        {suffix}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      {hint && !readOnly && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/* ---- Modal de envio ---- */
function EnvioModal({ canal, cfg, onClose }) {
  const { addToast } = useToast();
  const [destinatario, setDestinatario] = useState("");
  const [enviando, setEnviando] = useState(false);

  const isWA    = canal === "whatsapp";
  const label   = isWA ? "Número de WhatsApp" : "E-mail do destinatário";
  const placeholder = isWA ? "Ex: 91999887766" : "Ex: cliente@email.com";

  async function handleEnviar() {
    if (!destinatario.trim()) { addToast(`Informe o ${label.toLowerCase()}`, "error"); return; }
    setEnviando(true);
    try {
      await apiFetch("/config-empresa/enviar", {
        method: "POST",
        body: { canal, destinatario: destinatario.trim() },
      });
      addToast(`Enviado com sucesso via ${isWA ? "WhatsApp" : "e-mail"}!`, "success");
      onClose();
    } catch (e) {
      addToast(e.message || "Erro ao enviar", "error");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-900">
            {isWA ? "💬 Enviar via WhatsApp" : "✉️ Enviar por E-mail"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">{label}</label>
            <input
              type={isWA ? "tel" : "email"}
              value={destinatario}
              onChange={e => setDestinatario(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-sm"
            />
          </div>
          <p className="text-xs text-slate-400">
            Será enviado: dados da empresa, CNPJ{" "}
            {isWA ? "e dados bancários (Ag, Cc, Pix)." : "e dados bancários."}
          </p>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 text-sm">
            Cancelar
          </button>
          <button onClick={handleEnviar} disabled={enviando || !destinatario.trim()}
            className={`flex-1 rounded-xl text-white px-4 py-2 font-semibold text-sm disabled:opacity-50 ${isWA ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"}`}>
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- CardEnvio ---- */
function CardEnvio({ cfg, contas }) {
  const { addToast } = useToast();
  const bancos = contas.filter(c => c.tipo === "BANCO" && c.ativa);
  const [envioCanal, setEnvioCanal] = useState(null); // null | "email" | "whatsapp"

  const endereco = [
    cfg.logradouro, cfg.numero, cfg.complemento, cfg.bairro,
    cfg.cidade && cfg.estado ? `${cfg.cidade}/${cfg.estado}` : cfg.cidade || cfg.estado,
    cfg.cep,
  ].filter(Boolean).join(", ");

  function copiar() {
    const linhas = [cfg.nomeFantasia || cfg.nome];
    if (endereco) linhas.push(endereco);
    if (cfg.cnpj) linhas.push(`CNPJ: ${cfg.cnpj}`);
    if (cfg.whatsapp) linhas.push(`📱 ${cfg.whatsapp}`);
    if (bancos.length) {
      linhas.push("", "Dados Bancários:");
      bancos.forEach(b => {
        linhas.push("", `🏦 ${b.nome}`);
        if (b.agencia) linhas.push(`  Ag: ${b.agencia}`);
        if (b.conta)   linhas.push(`  Cc: ${b.conta}`);
        if (b.chavePix1) linhas.push(`  Pix: ${b.chavePix1}`);
        if (b.chavePix2) linhas.push(`  Pix: ${b.chavePix2}`);
      });
    }
    navigator.clipboard.writeText(linhas.join("\n"))
      .then(() => addToast("Copiado!", "success"))
      .catch(() => addToast("Erro ao copiar", "error"));
  }

  return (
    <>
    {envioCanal && <EnvioModal canal={envioCanal} cfg={cfg} onClose={() => setEnvioCanal(null)} />}
    <section className="rounded-2xl border border-blue-200 bg-blue-50">
      <div className="px-5 py-4 border-b border-blue-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-semibold text-blue-900">Enviar ao cliente</div>
          <div className="text-xs text-blue-600 mt-0.5">Dados de contato e bancários formatados</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={copiar}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors">
            📋 Copiar
          </button>
          <button onClick={() => setEnvioCanal("email")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
            ✉️ E-mail
          </button>
          <button onClick={() => setEnvioCanal("whatsapp")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors">
            💬 WhatsApp
          </button>
        </div>
      </div>

      <div className="p-5">
        {/* Identificação */}
        <div className="mb-3">
          <div className="text-lg font-bold text-slate-900">{cfg.nomeFantasia || cfg.nome}</div>
          {endereco && <div className="text-sm text-slate-600 mt-0.5">{endereco}</div>}
          {cfg.cnpj && <div className="text-sm text-slate-500">CNPJ: {cfg.cnpj}</div>}
        </div>

        {/* Telefones */}
        {(cfg.telefoneFix || cfg.celular || cfg.whatsapp) && (
          <div className="flex flex-wrap gap-3 mb-4">
            {cfg.telefoneFix && <span className="text-sm text-slate-700">📞 {cfg.telefoneFix}</span>}
            {cfg.celular     && <span className="text-sm text-slate-700">📱 {cfg.celular}</span>}
            {cfg.whatsapp    && (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700">
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-green-600 shrink-0">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                {cfg.whatsapp}
              </span>
            )}
          </div>
        )}

        {/* Contas bancárias */}
        {bancos.length > 0 && (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Dados bancários
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {bancos.map(b => (
                <div key={b.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
                  <div className="font-semibold text-slate-800 text-sm">🏦 {b.nome}</div>
                  {(b.agencia || b.conta) && (
                    <div className="flex gap-4 text-xs text-slate-600">
                      {b.agencia && <span><span className="font-semibold text-slate-700">Ag:</span> {b.agencia}</span>}
                      {b.conta   && <span><span className="font-semibold text-slate-700">Cc:</span> {b.conta}</span>}
                    </div>
                  )}
                  {b.chavePix1 ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Pix:</span>
                      <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg break-all">
                        {b.chavePix1}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic">Chave Pix não cadastrada</div>
                  )}
                  {b.chavePix2 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Pix 2:</span>
                      <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg break-all">
                        {b.chavePix2}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {!cfg.nome && bancos.length === 0 && (
          <div className="text-sm text-slate-400 italic">
            Preencha os dados da empresa para habilitar o envio.
          </div>
        )}
      </div>
    </section>
    </>
  );
}

/* ---- página principal ---- */
export default function ConfiguracaoEmpresa({ user }) {
  const { addToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  const [form,    setForm]    = useState(EMPTY);
  const [contas,  setContas]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cnpjError,  setCnpjError]  = useState("");
  const [waStatus,   setWaStatus]   = useState(null); // null | "ok" | "warn"
  const cepTimer = useRef(null);

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  useEffect(() => {
    Promise.all([
      apiFetch("/config-empresa"),
      apiFetch("/livro-caixa/contas"),
    ])
      .then(([cfg, cts]) => {
        setForm({ ...EMPTY, ...cfg });
        setContas(Array.isArray(cts) ? cts : []);
      })
      .catch(e => addToast("Erro ao carregar dados: " + e.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  /* ---- field handlers ---- */
  function handleCNPJ(raw) {
    const masked = maskCNPJ(raw);
    set("cnpj", masked);
    const digits = masked.replace(/\D/g, "");
    if (digits.length === 14) {
      setCnpjError(validarCNPJ(masked) ? "" : "CNPJ inválido");
    } else {
      setCnpjError("");
    }
  }

  function handleCEP(raw) {
    const masked = maskCEP(raw);
    set("cep", masked);
    const digits = masked.replace(/\D/g, "");
    clearTimeout(cepTimer.current);
    if (digits.length === 8) {
      cepTimer.current = setTimeout(() => buscarCEP(digits), 400);
    }
  }

  async function buscarCEP(digits) {
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) {
        addToast("CEP não encontrado.", "error");
      } else {
        setForm(p => ({
          ...p,
          logradouro: data.logradouro || p.logradouro,
          bairro:     data.bairro     || p.bairro,
          cidade:     data.localidade || p.cidade,
          estado:     data.uf         || p.estado,
        }));
      }
    } catch {
      addToast("Erro ao consultar CEP.", "error");
    } finally {
      setCepLoading(false);
    }
  }

  function handlePhone(field, raw) {
    set(field, maskPhone(raw));
    if (field === "whatsapp") setWaStatus(null);
  }

  function verificarWhatsApp() {
    const num = waPhone(form.whatsapp);
    if (!num || num.replace(/\D/g,"").length < 12) {
      addToast("Informe um número de celular válido antes de verificar.", "warn");
      return;
    }
    window.open(`https://wa.me/${num}`, "_blank");
    setWaStatus("ok");
  }

  async function handleSave(e) {
    e.preventDefault();
    if (cnpjError) { addToast("Corrija o CNPJ antes de salvar.", "error"); return; }
    setSaving(true);
    try {
      await apiFetch("/config-empresa", { method: "PUT", body: JSON.stringify(form) });
      addToast("Configurações salvas.", "success");
    } catch (err) {
      addToast("Erro ao salvar: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-500 py-8">Carregando…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dados da Empresa</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {isAdmin
            ? "Informações utilizadas em relatórios, PDFs e cabeçalhos."
            : "Dados de contato e bancários da empresa."}
        </p>
      </div>

      {/* Card de envio — visível para todos */}
      <CardEnvio cfg={form} contas={contas} />

      {/* Formulário de edição — somente admin */}
      {isAdmin && (
        <form onSubmit={handleSave} className="space-y-6">

          {/* Identificação */}
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="px-5 py-4 border-b border-slate-200">
              <div className="text-base font-semibold text-slate-800">Identificação</div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Field label="Razão Social" value={form.nome}
                  onChange={v => set("nome", v)} placeholder="Addere" />
              </div>
              <div className="md:col-span-2">
                <Field label="Nome de Fantasia" value={form.nomeFantasia}
                  onChange={v => set("nomeFantasia", v)} placeholder="Ex.: Addere" />
              </div>
              <Field label="CNPJ" value={form.cnpj}
                onChange={handleCNPJ}
                placeholder="00.000.000/0001-00"
                maxLength={18}
                error={cnpjError} />
            </div>
          </section>

          {/* Endereço */}
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="px-5 py-4 border-b border-slate-200">
              <div className="text-base font-semibold text-slate-800">Endereço</div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-6 gap-4">
              {/* CEP primeiro */}
              <div className="md:col-span-2">
                <Field label={cepLoading ? "CEP (buscando…)" : "CEP"}
                  value={form.cep}
                  onChange={handleCEP}
                  placeholder="00000-000"
                  maxLength={9}
                  hint="Preencha para buscar o endereço automaticamente" />
              </div>
              <div className="md:col-span-4">
                <Field label="Logradouro" value={form.logradouro}
                  onChange={v => set("logradouro", v)} placeholder="Rua, Avenida, Travessa…" />
              </div>
              <div className="md:col-span-2">
                <Field label="Número / Sala" value={form.numero}
                  onChange={v => set("numero", v)} placeholder="Ex.: 1402" />
              </div>
              <div className="md:col-span-4">
                <Field label="Complemento" value={form.complemento}
                  onChange={v => set("complemento", v)} placeholder="Bloco, Andar…" />
              </div>
              <div className="md:col-span-3">
                <Field label="Bairro" value={form.bairro}
                  onChange={v => set("bairro", v)} />
              </div>
              <div className="md:col-span-2">
                <Field label="Cidade" value={form.cidade}
                  onChange={v => set("cidade", v)} placeholder="Belém" />
              </div>
              <div className="md:col-span-1">
                <Field label="UF" value={form.estado}
                  onChange={v => set("estado", v.toUpperCase())}
                  placeholder="PA" maxLength={2} />
              </div>
            </div>
          </section>

          {/* Telefones */}
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="px-5 py-4 border-b border-slate-200">
              <div className="text-base font-semibold text-slate-800">Telefones</div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Fixo" value={form.telefoneFix}
                onChange={v => handlePhone("telefoneFix", v)}
                placeholder="(91) 0000-0000"
                maxLength={14} />
              <Field label="Celular" value={form.celular}
                onChange={v => handlePhone("celular", v)}
                placeholder="(91) 9 0000-0000"
                maxLength={16} />
              <Field label="WhatsApp" value={form.whatsapp}
                onChange={v => handlePhone("whatsapp", v)}
                placeholder="(91) 9 0000-0000"
                maxLength={16}
                hint="Mesmo número configurado na API"
                suffix={
                  <button type="button" onClick={verificarWhatsApp}
                    title="Abre wa.me para verificar se o número está no WhatsApp"
                    className="px-2.5 py-2 rounded-xl border border-green-400 bg-green-50 text-green-700 text-xs font-semibold hover:bg-green-100 transition-colors whitespace-nowrap">
                    Verificar
                  </button>
                } />
            </div>
            {waStatus === "ok" && (
              <div className="px-5 pb-4 text-xs text-slate-500">
                Uma janela do WhatsApp foi aberta. Se o número não aparecer como contato válido, pode não estar cadastrado no WhatsApp.
              </div>
            )}
          </section>

          <div className="text-xs text-slate-400 italic">
            As chaves Pix são cadastradas em Configurações → Contas Contábeis (tipo Banco).
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !!cnpjError}
              className="px-6 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
