import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

const LIMIT = 30;

// Formata a edição para exibição amigável
function formatEdicao(tribunal, edicao) {
  if (tribunal === "tjpa") return `Ed. ${edicao}`;
  // Para tribunais data-based: edicao = YYYYMMDD
  const s = String(edicao).padStart(8, "0");
  return `${s.slice(6)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}

const TRIBUNAL_LABELS = {
  tjpa: "TJPA", tjsp: "TJSP", tjam: "TJAM",
  trt1: "TRT-1", trt2: "TRT-2", trt3: "TRT-3", trt4: "TRT-4",
  trt5: "TRT-5", trt6: "TRT-6", trt7: "TRT-7", trt8: "TRT-8",
  trt9: "TRT-9", trt10: "TRT-10", trt11: "TRT-11", trt12: "TRT-12",
  trt13: "TRT-13", trt14: "TRT-14", trt15: "TRT-15", trt16: "TRT-16",
  trt17: "TRT-17", trt18: "TRT-18", trt19: "TRT-19", trt20: "TRT-20",
  trt21: "TRT-21", trt22: "TRT-22", trt23: "TRT-23", trt24: "TRT-24",
  trf1: "TRF-1", trf2: "TRF-2", trf3: "TRF-3", trf4: "TRF-4", trf5: "TRF-5",
  stj: "STJ", stf: "STF", tst: "TST",
};

export default function Intimacoes({ user }) {
  const { addToast, confirmToast } = useToast();
  const navigate = useNavigate();
  const isAdmin = user?.role === "ADMIN";

  const [items, setItems]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [syncingDJEN, setSyncingDJEN] = useState(false);
  const [tribunais, setTribunais] = useState([]);

  // Filtros lista
  const [filtroLida, setFiltroLida]     = useState("false");
  const [filtroAdvId, setFiltroAdvId]   = useState("");
  const [filtroTrib, setFiltroTrib]     = useState("");
  const [advogados, setAdvogados]       = useState([]);
  const [page, setPage]                 = useState(1);

  // Sync manual
  const [syncTribunal, setSyncTribunal] = useState("tjpa");
  const [syncEdicao, setSyncEdicao]     = useState("");
  const [syncAno, setSyncAno]           = useState(String(new Date().getFullYear()));
  const [syncData, setSyncData]         = useState(new Date().toISOString().slice(0, 10));
  const [syncCaderno, setSyncCaderno]   = useState("1");

  // Vincular processo
  const [vincularId, setVincularId]           = useState(null);
  const [processoInput, setProcessoInput]     = useState("");
  const [processosSugest, setProcessosSugest] = useState([]);

  useEffect(() => {
    Promise.all([
      apiFetch("/advogados").then(d => setAdvogados((d || []).filter(a => a.ativo))).catch(() => {}),
      apiFetch("/intimacoes/tribunais").then(d => setTribunais(d || [])).catch(() => {}),
    ]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (filtroLida !== "")  params.set("lida", filtroLida);
      if (filtroAdvId)        params.set("advogadoId", filtroAdvId);
      if (filtroTrib)         params.set("tribunal", filtroTrib);
      const d = await apiFetch(`/intimacoes?${params}`);
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch (e) {
      addToast(e?.message || "Erro ao carregar intimações", "error");
    } finally {
      setLoading(false);
    }
  }, [page, filtroLida, filtroAdvId, filtroTrib]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function marcarLida(id, lida) {
    try {
      await apiFetch(`/intimacoes/${id}`, { method: "PATCH", body: JSON.stringify({ lida }) });
      setItems(prev => prev.map(i => i.id === id ? { ...i, lida } : i));
    } catch (e) {
      addToast(e?.message || "Erro", "error");
    }
  }

  async function excluir(id) {
    if (!await confirmToast("Excluir esta intimação?")) return;
    try {
      await apiFetch(`/intimacoes/${id}`, { method: "DELETE" });
      setItems(prev => prev.filter(i => i.id !== id));
      setTotal(t => t - 1);
    } catch (e) {
      addToast(e?.message || "Erro ao excluir", "error");
    }
  }

  async function sincronizar() {
    setSyncing(true);
    try {
      const cfg = tribunais.find(t => t.key === syncTribunal);
      const body = { tribunal: syncTribunal };

      if (cfg?.tipo === "data") {
        body.data    = syncData;
        body.caderno = parseInt(syncCaderno);
      } else {
        if (syncEdicao) body.edicao = parseInt(syncEdicao);
        if (syncAno)    body.ano    = parseInt(syncAno);
      }

      const d = await apiFetch("/intimacoes/sync?forcar=1", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (d.novos > 0) {
        addToast(`${d.novos} intimação(ões) nova(s) importada(s)`, "success");
        load();
      } else {
        addToast("Nenhuma ocorrência encontrada", "info");
      }
    } catch (e) {
      addToast(e?.message || "Erro na sincronização", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function sincronizarDJEN() {
    setSyncingDJEN(true);
    try {
      const d = await apiFetch("/intimacoes/sync-djen?forcar=1", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (d.novos > 0) {
        addToast(`DJEN: ${d.novos} comunicação(ões) nova(s) importada(s)`, "success");
        load();
      } else {
        addToast("DJEN: nenhuma comunicação nova encontrada", "info");
      }
    } catch (e) {
      addToast(e?.message || "Erro na sincronização DJEN", "error");
    } finally {
      setSyncingDJEN(false);
    }
  }

  async function buscarProcessos(q) {
    if (q.length < 3) { setProcessosSugest([]); return; }
    try {
      const d = await apiFetch(`/processos?numero=${encodeURIComponent(q)}&limit=8`);
      setProcessosSugest(d.processos || []);
    } catch { setProcessosSugest([]); }
  }

  async function vincularProcesso(intimacaoId, processoId) {
    try {
      await apiFetch(`/intimacoes/${intimacaoId}`, {
        method: "PATCH",
        body: JSON.stringify({ processoId }),
      });
      const proc = processosSugest.find(p => p.id === processoId);
      setItems(prev => prev.map(i => i.id !== intimacaoId ? i : { ...i, processoId, processo: proc || null }));
      setVincularId(null);
      setProcessoInput("");
      setProcessosSugest([]);
      addToast("Processo vinculado", "success");
    } catch (e) {
      addToast(e?.message || "Erro ao vincular", "error");
    }
  }

  const totalPages = Math.ceil(total / LIMIT);
  const tribunalAtual = tribunais.find(t => t.key === syncTribunal);

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Intimações — DJe</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Publicações capturadas automaticamente dos Diários da Justiça Eletrônico
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-col gap-2 items-end">
            {/* Botão DJEN (busca por OAB — todos os tribunais PJe) */}
            <button
              onClick={sincronizarDJEN}
              disabled={syncingDJEN}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
              title="Busca comunicações no DJEN (TRTs, TRFs, STJ, etc.) por OAB de cada advogado"
            >
              {syncingDJEN ? "Buscando DJEN..." : "⚖ Sincronizar DJEN"}
            </button>

            {/* Seletor de tribunal DJe (PDF) */}
            <div className="flex gap-2 items-center flex-wrap">
              <select
                value={syncTribunal}
                onChange={e => setSyncTribunal(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm"
              >
                {tribunais.map(t => (
                  <option key={t.key} value={t.key}>{t.nome}</option>
                ))}
              </select>

              {/* Campos TJPA (por edição) */}
              {tribunalAtual?.tipo !== "data" && (
                <>
                  <input
                    type="number"
                    placeholder="Edição"
                    value={syncEdicao}
                    onChange={e => setSyncEdicao(e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm w-24"
                  />
                  <input
                    type="number"
                    placeholder="Ano"
                    value={syncAno}
                    onChange={e => setSyncAno(e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm w-20"
                  />
                </>
              )}

              {/* Campos TJSP/TJAM (por data + caderno) */}
              {tribunalAtual?.tipo === "data" && (
                <>
                  <input
                    type="date"
                    value={syncData}
                    onChange={e => setSyncData(e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm"
                  />
                  <select
                    value={syncCaderno}
                    onChange={e => setSyncCaderno(e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm"
                  >
                    {(tribunalAtual?.cadernos || [1, 2]).map(c => (
                      <option key={c} value={c}>Caderno {c}</option>
                    ))}
                  </select>
                </>
              )}

              <button
                onClick={sincronizar}
                disabled={syncing}
                className="bg-primary hover:bg-primary-hover text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
              >
                {syncing ? "Sincronizando..." : "↻ Sincronizar"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <select
          value={filtroLida}
          onChange={e => { setFiltroLida(e.target.value); setPage(1); }}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="false">Não lidas</option>
          <option value="true">Lidas</option>
          <option value="">Todas</option>
        </select>

        <select
          value={filtroTrib}
          onChange={e => { setFiltroTrib(e.target.value); setPage(1); }}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="">Todos os tribunais</option>
          {tribunais.map(t => (
            <option key={t.key} value={t.key}>{t.nome}</option>
          ))}
        </select>

        <select
          value={filtroAdvId}
          onChange={e => { setFiltroAdvId(e.target.value); setPage(1); }}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="">Todos os advogados</option>
          {advogados.map(a => (
            <option key={a.id} value={a.id}>{a.nome}</option>
          ))}
        </select>

        <span className="text-sm text-gray-500">{total} resultado(s)</span>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {filtroLida === "false"
            ? "Nenhuma intimação não lida."
            : "Nenhuma intimação para os filtros selecionados."}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div
              key={item.id}
              className={`border rounded-lg p-4 transition-colors ${
                item.lida ? "bg-white border-gray-200" : "bg-yellow-50 border-yellow-300"
              }`}
            >
              {/* Cabeçalho */}
              <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {!item.lida && (
                    <span className="bg-yellow-500 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
                      Nova
                    </span>
                  )}
                  <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                    {TRIBUNAL_LABELS[item.tribunal] || item.tribunal.toUpperCase()}
                    {" · "}
                    {formatEdicao(item.tribunal, item.edicao)}
                    {item.ano && item.tribunal === "tjpa" ? `/${item.ano}` : ""}
                  </span>
                  {item.advogado && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      {item.advogado.nome}
                    </span>
                  )}
                  {item.termoBusca?.startsWith("DJEN:") ? (
                    <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                      via DJEN
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">
                      Termo: <em>"{item.termoBusca}"</em>
                    </span>
                  )}
                </div>

                {/* Ações */}
                <div className="flex gap-1.5 items-center flex-wrap">
                  {item.processo ? (
                    <button
                      onClick={() => navigate(`/processos/${item.processo.id}`)}
                      className="text-xs text-blue-600 hover:underline border border-blue-200 rounded px-2 py-0.5"
                    >
                      {item.processo.numeroProcesso}
                    </button>
                  ) : (
                    <button
                      onClick={() => setVincularId(vincularId === item.id ? null : item.id)}
                      className="text-xs border rounded px-2 py-0.5 hover:bg-gray-100 text-gray-600"
                    >
                      Vincular processo
                    </button>
                  )}
                  <button
                    onClick={() => marcarLida(item.id, !item.lida)}
                    className="text-xs border rounded px-2 py-0.5 hover:bg-gray-100 text-gray-600"
                  >
                    {item.lida ? "Marcar como nova" : "Marcar como lida"}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => excluir(item.id)}
                      className="text-xs border border-red-200 rounded px-2 py-0.5 hover:bg-red-50 text-red-500"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Trecho do DJe */}
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 border border-gray-200 rounded p-3 max-h-56 overflow-y-auto">
                {item.texto}
              </pre>

              {/* Vincular processo — inline */}
              {vincularId === item.id && (
                <div className="mt-2 relative flex gap-2 items-start flex-wrap">
                  <div className="flex-1 min-w-48 relative">
                    <input
                      type="text"
                      placeholder="Número do processo..."
                      value={processoInput}
                      onChange={e => {
                        setProcessoInput(e.target.value);
                        buscarProcessos(e.target.value);
                      }}
                      className="border rounded px-2 py-1 text-sm w-full"
                    />
                    {processosSugest.length > 0 && (
                      <div className="absolute z-20 top-full left-0 mt-1 bg-white border rounded shadow-lg w-full min-w-72">
                        {processosSugest.map(p => (
                          <button
                            key={p.id}
                            className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 border-b last:border-0"
                            onMouseDown={e => { e.preventDefault(); vincularProcesso(item.id, p.id); }}
                          >
                            <span className="font-mono">{p.numeroProcesso}</span>
                            {p.tribunal && (
                              <span className="text-gray-400 ml-1">
                                ({TRIBUNAL_LABELS[p.tribunal] || p.tribunal.toUpperCase()})
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => { setVincularId(null); setProcessoInput(""); setProcessosSugest([]); }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              <div className="text-xs text-gray-400 mt-1.5">
                Capturado em {new Date(item.createdAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
          >
            ←
          </button>
          <span className="text-sm self-center text-gray-600">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
