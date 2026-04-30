// src/pages/ComprovantesRecebidos.jsx
import React, { useEffect, useState, useCallback } from "react";
import { BASE_URL, apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { fmtDate } from "../lib/formatters";

function Badge({ children, tone = "gray" }) {
  const cls = {
    gray:   "bg-slate-100 text-slate-600",
    green:  "bg-green-100 text-green-700",
    amber:  "bg-amber-100 text-amber-700",
    blue:   "bg-blue-100 text-blue-700",
    red:    "bg-red-100 text-red-700",
  }[tone] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Classifica a categoria de uma mensagem pelo assunto
function categoriaAssunto(assunto = "") {
  const s = assunto.toLowerCase();
  if (s.includes("pix")) return "Pix";
  if (s.includes("boleto")) return "Boleto";
  if (s.includes("transfer")) return "Transferência";
  if (s.includes("dep\u00f3sito") || s.includes("deposito")) return "Depósito";
  if (s.includes("comprovante") || s.includes("recibo") || s.includes("quita\u00e7\u00e3o") || s.includes("quitacao")) return "Comprovante";
  if (s.includes("pagamento")) return "Pagamento";
  return "Outros";
}

const ABAS = ["Todos", "Pix", "Boleto", "Transferência", "Depósito", "Comprovante", "Pagamento", "Outros"];

export default function RespostasClientes({ user }) {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState("pendentes"); // "pendentes" | "todos"
  const [aba, setAba] = useState("Todos");
  const [vinculandoId, setVinculandoId] = useState(null);
  const [parcelaInput, setParcelaInput] = useState("");
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  // ── Estado do painel de palavras-chave ──
  const [palavras, setPalavras] = useState([]);
  const [palavrasLoaded, setPalavrasLoaded] = useState(false);
  const [novaPalavra, setNovaPalavra] = useState("");
  const [salvandoPalavra, setSalvandoPalavra] = useState(false);

  async function loadPalavras() {
    try {
      const data = await apiFetch("/admin/gmail-palavras");
      setPalavras(Array.isArray(data) ? data : []);
      setPalavrasLoaded(true);
    } catch (e) {
      addToast(e?.message || "Erro ao carregar palavras-chave.", "error");
    }
  }

  async function adicionarPalavra() {
    if (!novaPalavra.trim()) return;
    setSalvandoPalavra(true);
    try {
      await apiFetch("/admin/gmail-palavras", { method: "POST", body: { palavra: novaPalavra.trim() } });
      setNovaPalavra("");
      await loadPalavras();
    } catch (e) {
      addToast(e?.message || "Erro ao adicionar.", "error");
    } finally {
      setSalvandoPalavra(false);
    }
  }

  async function togglePalavra(id, ativoAtual) {
    try {
      await apiFetch(`/admin/gmail-palavras/${id}`, { method: "PATCH", body: { ativo: !ativoAtual } });
      await loadPalavras();
    } catch (e) {
      addToast(e?.message || "Erro.", "error");
    }
  }

  async function excluirPalavra(id) {
    try {
      await apiFetch(`/admin/gmail-palavras/${id}`, { method: "DELETE" });
      await loadPalavras();
    } catch (e) {
      addToast(e?.message || "Erro ao excluir.", "error");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filtro === "pendentes" ? "?revisado=false" : "";
      const data = await apiFetch(`/comprovantes${params}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      addToast(e?.message || "Erro ao carregar.", "error");
    } finally {
      setLoading(false);
    }
  }, [filtro]);

  // Carrega ao entrar na página e ao trocar filtro
  useEffect(() => { load(); }, [load]);

  async function marcarRevisado(id) {
    try {
      await apiFetch(`/comprovantes/${id}/revisado`, { method: "PATCH" });
      addToast("Marcado como revisado.", "success");
      load();
    } catch (e) {
      addToast(e?.message || "Erro.", "error");
    }
  }

  async function vincular(id) {
    const num = parseInt(parcelaInput);
    if (!num || isNaN(num)) {
      addToast("Informe um ID de parcela válido.", "error");
      return;
    }
    try {
      await apiFetch(`/comprovantes/${id}/vincular`, { method: "PATCH", body: { parcelaId: num } });
      addToast("Parcela vinculada.", "success");
      setVinculandoId(null);
      setParcelaInput("");
      load();
    } catch (e) {
      addToast(e?.message || "Erro.", "error");
    }
  }

  function downloadAnexo(anexoId, nomeArquivo) {
    const token = localStorage.getItem("addere_token");
    const url = `${BASE_URL}/comprovantes/anexo/${anexoId}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nomeArquivo;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => addToast("Erro ao baixar arquivo.", "error"));
  }

  const pendentes = rows.filter(r => !r.revisado).length;

  // Filtra por aba
  const rowsFiltrados = aba === "Todos"
    ? rows
    : rows.filter(r => categoriaAssunto(r.assunto) === aba);

  // Conta por aba para exibir badge
  const contagemPorAba = {};
  for (const a of ABAS) {
    contagemPorAba[a] = a === "Todos"
      ? rows.length
      : rows.filter(r => categoriaAssunto(r.assunto) === a).length;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Respostas de Clientes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Mensagens detectadas na caixa de entrada do Gmail (financeiro@amandaramalho.adv.br) enviadas por clientes cadastrados.
          </p>
        </div>
        {pendentes > 0 && (
          <Badge tone="amber">{pendentes} pendente{pendentes > 1 ? "s" : ""}</Badge>
        )}
      </div>

      {/* Filtro revisado/todos + botão atualizar */}
      <div className="flex gap-2 flex-wrap">
        {["pendentes", "todos"].map(f => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition ${
              filtro === f
                ? "bg-primary text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {f === "pendentes" ? "Pendentes de revisão" : "Todos"}
          </button>
        ))}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      {/* Abas por categoria */}
      <div className="flex gap-1 flex-wrap border-b border-slate-200 pb-0">
        {ABAS.map(a => {
          const count = contagemPorAba[a] || 0;
          const ativa = aba === a;
          // Esconde abas vazias (exceto Todos)
          if (a !== "Todos" && count === 0) return null;
          return (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                ativa
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {a}
              {count > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                  ativa ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-500"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Lista vazia */}
      {rowsFiltrados.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center">
          <p className="text-slate-400 text-sm">Nenhuma mensagem encontrada.</p>
          {filtro === "pendentes" && (
            <p className="text-slate-400 text-xs mt-1">Mude o filtro para "Todos" para ver mensagens já revisadas.</p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {rowsFiltrados.map(row => (
          <div
            key={row.id}
            className={`rounded-xl border bg-white shadow-sm overflow-hidden ${
              row.revisado ? "border-slate-200" : "border-amber-300"
            }`}
          >
            {/* Cabeçalho */}
            <div className={`px-5 py-3 flex items-center justify-between gap-3 flex-wrap ${
              row.revisado ? "bg-slate-50" : "bg-amber-50"
            }`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800 text-sm">
                  {row.cliente?.nomeRazaoSocial || row.remetenteEmail}
                </span>
                <span className="text-xs text-slate-400">{row.remetenteEmail}</span>
                {row.revisado
                  ? <Badge tone="green">Revisado</Badge>
                  : <Badge tone="amber">Pendente</Badge>}
                {row.anexos?.length > 0 && (
                  <Badge tone="blue">📎 {row.anexos.length} anexo{row.anexos.length > 1 ? "s" : ""}</Badge>
                )}
                <Badge tone="gray">{categoriaAssunto(row.assunto)}</Badge>
              </div>
              <span className="text-xs text-slate-400">{fmtDateTime(row.recebidoEm)}</span>
            </div>

            {/* Corpo */}
            <div className="px-5 py-4 space-y-3">
              {/* Assunto */}
              <p className="text-sm text-slate-700">
                <span className="font-medium text-slate-500 text-xs uppercase tracking-wide mr-2">Assunto</span>
                {row.assunto || "—"}
              </p>

              {/* Parcela vinculada */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-500 text-xs uppercase tracking-wide">Parcela</span>
                {row.parcela ? (
                  <span className="text-sm text-slate-700">
                    #{row.parcela.numero} — Contrato {row.parcela.contrato?.numeroContrato || "—"}
                    <span className="ml-1 text-xs text-slate-400">(ID {row.parcela.id})</span>
                  </span>
                ) : (
                  <span className="text-sm text-slate-400 italic">Não vinculada</span>
                )}
                <button
                  onClick={() => { setVinculandoId(row.id === vinculandoId ? null : row.id); setParcelaInput(""); }}
                  className="text-xs text-primary hover:underline"
                >
                  {vinculandoId === row.id ? "Cancelar" : "Vincular"}
                </button>
              </div>

              {/* Form de vínculo manual */}
              {vinculandoId === row.id && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={parcelaInput}
                    onChange={e => setParcelaInput(e.target.value)}
                    placeholder="ID da parcela"
                    className="w-36 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => vincular(row.id)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover"
                  >
                    Salvar
                  </button>
                </div>
              )}

              {/* Corpo do e-mail */}
              {row.corpoTexto && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">Ver conteúdo da mensagem</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-600 max-h-40 overflow-auto">
                    {row.corpoTexto}
                  </pre>
                </details>
              )}

              {/* Anexos */}
              {row.anexos?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {row.anexos.map(anx => (
                    <button
                      key={anx.id}
                      onClick={() => downloadAnexo(anx.id, anx.nomeArquivo)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
                    >
                      📎 {anx.nomeArquivo}
                      <span className="text-slate-400">({fmtBytes(anx.tamanhoBytes)})</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Ações */}
              {!row.revisado && (
                <div className="pt-1">
                  <button
                    onClick={() => marcarRevisado(row.id)}
                    className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-700"
                  >
                    ✓ Marcar como revisado
                  </button>
                </div>
              )}
              {row.revisado && row.revisadoEm && (
                <p className="text-xs text-slate-400">Revisado em {fmtDateTime(row.revisadoEm)}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Painel de palavras-chave — admin only */}
      {isAdmin && (
        <details
          className="rounded-xl border border-slate-200 bg-white shadow-sm"
          onToggle={e => { if (e.target.open && !palavrasLoaded) loadPalavras(); }}
        >
          <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-slate-700 select-none list-none flex items-center gap-2">
            <span>⚙️ Palavras-chave do filtro Gmail</span>
            <span className="ml-auto text-xs font-normal text-slate-400">clique para expandir</span>
          </summary>
          <div className="px-5 pb-5 pt-3 space-y-4">
            <p className="text-xs text-slate-500">
              Apenas e-mails cujo assunto contenha ao menos uma dessas palavras serão registrados.
            </p>

            {/* Lista de chips */}
            <div className="flex flex-wrap gap-2">
              {palavras.map(p => (
                <span
                  key={p.id}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium border transition ${
                    p.ativo
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-slate-100 text-slate-400 border-slate-200 line-through"
                  }`}
                >
                  <button
                    onClick={() => togglePalavra(p.id, p.ativo)}
                    title={p.ativo ? "Desativar" : "Reativar"}
                    className="hover:opacity-70"
                  >
                    {p.palavra}
                  </button>
                  <button
                    onClick={() => excluirPalavra(p.id)}
                    title="Excluir"
                    className="ml-0.5 text-slate-400 hover:text-red-500 font-bold leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
              {palavras.length === 0 && palavrasLoaded && (
                <span className="text-xs text-slate-400 italic">Nenhuma palavra cadastrada — todos os e-mails serão ignorados.</span>
              )}
            </div>

            {/* Adicionar nova palavra */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={novaPalavra}
                onChange={e => setNovaPalavra(e.target.value)}
                onKeyDown={e => e.key === "Enter" && adicionarPalavra()}
                placeholder="Nova palavra-chave…"
                className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={adicionarPalavra}
                disabled={salvandoPalavra || !novaPalavra.trim()}
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {salvandoPalavra ? "Salvando…" : "Adicionar"}
              </button>
            </div>
            <p className="text-xs text-slate-400">Clique na palavra para ativar/desativar · × para excluir</p>
          </div>
        </details>
      )}
    </div>
  );
}
