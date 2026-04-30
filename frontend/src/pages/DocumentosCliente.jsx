// src/pages/DocumentosCliente.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch, BASE_URL, getToken } from "../lib/api";
import { useToast } from "../components/Toast";

const TIPOS = [
  { value: "boleto",     label: "Boleto" },
  { value: "nf",         label: "Nota Fiscal" },
  { value: "guia_das",   label: "Guia DAS" },
  { value: "guia_darf",  label: "Guia DARF" },
  { value: "guia_tlpl",  label: "Guia TLPL" },
  { value: "guia_dae",   label: "Guia DAE" },
  { value: "extrato",    label: "Extrato" },
  { value: "contrato",   label: "Contrato" },
  { value: "doc",        label: "Outro" },
];

const MESES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function fmtBytes(b) {
  if (!b) return "-";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Upload Modal ────────────────────────────────────────────────────────────
function UploadModal({ clienteId, clienteNome, ano, mes, onClose, onSuccess }) {
  const [tipo, setTipo] = useState("boleto");
  const [anoN, setAnoN] = useState(ano);
  const [mesN, setMesN] = useState(mes);
  const [arquivo, setArquivo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const fileRef = useRef();

  const nomePreview = arquivo ? (() => {
    const ext = arquivo.name.split(".").pop()?.toLowerCase() || "pdf";
    const prefixo = TIPOS.find(t => t.value === tipo)?.value || "doc";
    const comp = tipo === "contrato" ? "" : `_${anoN}${String(mesN).padStart(2, "0")}`;
    return `${prefixo}${comp}.${ext}`;
  })() : "";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!arquivo) { setErro("Selecione um arquivo."); return; }
    setLoading(true); setErro("");
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      fd.append("tipo", tipo);
      fd.append("ano", anoN);
      fd.append("mes", mesN);
      await apiFetch(`/documentos/${clienteId}/upload`, { method: "POST", body: fd });
      onSuccess();
      onClose();
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Upload de Documento</h2>
        <div>
          <label className="text-sm text-gray-600">Cliente</label>
          <p className="font-medium text-gray-800">{clienteNome}</p>
        </div>
        <div>
          <label className="text-sm text-gray-600 block mb-1">Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {tipo !== "contrato" && (
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-sm text-gray-600 block mb-1">Ano</label>
              <input type="number" value={anoN} onChange={e => setAnoN(e.target.value)} min={2020} max={2099}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex-1">
              <label className="text-sm text-gray-600 block mb-1">Mês</label>
              <select value={mesN} onChange={e => setMesN(parseInt(e.target.value))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
          </div>
        )}
        <div>
          <label className="text-sm text-gray-600 block mb-1">Arquivo</label>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx"
            onChange={e => setArquivo(e.target.files[0] || null)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:border-0 file:rounded file:bg-primary file:text-white file:text-sm" />
        </div>
        {nomePreview && (
          <p className="text-xs text-gray-500">Nome no Drive: <span className="font-mono font-medium">{nomePreview}</span></p>
        )}
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50">
            {loading ? "Enviando..." : "Enviar para o Drive"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Enviar Modal ────────────────────────────────────────────────────────────
function EnviarModal({ clienteId, cliente, arquivo, onClose }) {
  const [canais, setCanais] = useState({ email: true, whatsapp: false });
  const [mensagemWA, setMensagemWA] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultados, setResultados] = useState(null);
  const { addToast } = useToast();

  async function handleEnviar() {
    const selecionados = Object.keys(canais).filter(c => canais[c]);
    if (selecionados.length === 0) { addToast("Selecione ao menos um canal.", "error"); return; }
    setLoading(true);
    try {
      const data = await apiFetch(`/documentos/${clienteId}/enviar`, {
        method: "POST",
        body: JSON.stringify({ driveId: arquivo.driveId, nome: arquivo.nome, canal: selecionados, mensagemWA: mensagemWA || undefined }),
      });
      setResultados(data.resultados);
    } catch (e) { addToast(e.message, "error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Enviar: <span className="font-mono text-sm font-medium text-primary">{arquivo.nome}</span></h2>
        <p className="text-sm text-gray-600">Para: <strong>{cliente.nome}</strong></p>

        {resultados ? (
          <div className="space-y-2">
            {resultados.email !== undefined && (
              <div className={`p-3 rounded-lg text-sm ${resultados.email.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                E-mail: {resultados.email.ok ? "Enviado com sucesso!" : `Erro — ${resultados.email.error}`}
              </div>
            )}
            {resultados.whatsapp !== undefined && (
              <div className={`p-3 rounded-lg text-sm ${resultados.whatsapp.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                WhatsApp: {resultados.whatsapp.ok ? "Enviado com sucesso!" : `Erro — ${resultados.whatsapp.error}`}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover">Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 block">Canal</label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={canais.email} onChange={e => setCanais(p => ({ ...p, email: e.target.checked }))} />
                E-mail{cliente.email ? ` (${cliente.email})` : " (não cadastrado)"}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={canais.whatsapp} onChange={e => setCanais(p => ({ ...p, whatsapp: e.target.checked }))} />
                WhatsApp{cliente.telefone ? ` (${cliente.telefone})` : " (não cadastrado)"}
              </label>
            </div>
            {canais.whatsapp && (
              <div>
                <label className="text-sm text-gray-600 block mb-1">Mensagem WA (opcional)</label>
                <textarea value={mensagemWA} onChange={e => setMensagemWA(e.target.value)} rows={3}
                  placeholder={`Olá ${cliente.nome}, segue seu documento: ${arquivo.nome}`}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              <button onClick={handleEnviar} disabled={loading} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50">
                {loading ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function DocumentosCliente({ user }) {
  const { id: clienteId } = useParams();
  const navigate = useNavigate();
  const { addToast, confirmToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [mes, setMes] = useState(agora.getMonth() + 1);
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [enviarArquivo, setEnviarArquivo] = useState(null);
  const [deletando, setDeletando] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/documentos/${clienteId}?ano=${ano}&mes=${mes}`);
      setDados(d);
    } catch (e) {
      addToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [clienteId, ano, mes]);

  useEffect(() => { carregar(); }, [carregar]);

  async function handleDelete(driveId, nome) {
    if (!await confirmToast(`Remover o arquivo "${nome}" permanentemente do Drive?`)) return;
    setDeletando(driveId);
    try {
      await apiFetch(`/documentos/${clienteId}/${driveId}`, { method: "DELETE" });
      addToast("Arquivo removido.", "success");
      carregar();
    } catch (e) { addToast(e.message, "error"); }
    finally { setDeletando(null); }
  }

  async function handleDownload(driveId, nome) {
    try {
      const token = getToken();
      const res = await fetch(`${BASE_URL}/documentos/${clienteId}/${driveId}/download`, {
        headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
      });
      if (!res.ok) throw new Error("Falha ao baixar arquivo");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nome; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { addToast(e.message, "error"); }
  }

  const anos = Array.from({ length: 10 }, (_, i) => agora.getFullYear() - i);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            {dados?.cliente?.nome || "Carregando..."} — Documentos
          </h1>
          <p className="text-sm text-gray-500">Repositório Google Drive</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select value={ano} onChange={e => setAno(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          {anos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={mes} onChange={e => setMes(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <button onClick={() => setShowUpload(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Novo Upload
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Carregando...</div>
      ) : !dados ? (
        <div className="text-center py-16 text-red-400">Erro ao carregar documentos.</div>
      ) : dados.arquivos.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="font-medium">Nenhum documento para {MESES[mes-1]}/{ano}</p>
          <p className="text-sm mt-1">Clique em "Novo Upload" para adicionar.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dados.arquivos.map(arq => (
            <div key={arq.driveId} className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-primary/30 transition-colors">
              <svg className="w-8 h-8 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm truncate">{arq.nome}</p>
                <p className="text-xs text-gray-400">{fmtBytes(arq.tamanho)} · {arq.criadoEm ? new Date(arq.criadoEm).toLocaleDateString("pt-BR") : ""}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setEnviarArquivo(arq)}
                  title="Enviar por e-mail ou WhatsApp"
                  className="p-2 text-gray-400 hover:text-primary rounded-lg hover:bg-primary/10 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
                <button onClick={() => handleDownload(arq.driveId, arq.nome)}
                  title="Baixar"
                  className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                {isAdmin && (
                  <button onClick={() => handleDelete(arq.driveId, arq.nome)} disabled={deletando === arq.driveId}
                    title="Remover do Drive"
                    className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modais */}
      {showUpload && (
        <UploadModal
          clienteId={clienteId}
          clienteNome={dados?.cliente?.nome || ""}
          ano={ano} mes={mes}
          onClose={() => setShowUpload(false)}
          onSuccess={carregar}
        />
      )}
      {enviarArquivo && dados?.cliente && (
        <EnviarModal
          clienteId={clienteId}
          cliente={dados.cliente}
          arquivo={enviarArquivo}
          onClose={() => setEnviarArquivo(null)}
        />
      )}
    </div>
  );
}
