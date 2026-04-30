// src/pages/Processos.jsx — Acompanhamento de processos judiciais
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { fmtDate } from "../lib/formatters";
import EmptyState from "../components/ui/EmptyState";

const TRIBUNAIS = [
  { value: "",              label: "Todos os tribunais" },
  // Superiores
  { value: "stf",           label: "STF" },
  { value: "stj",           label: "STJ" },
  { value: "tst",           label: "TST" },
  // TRFs
  { value: "trf1",          label: "TRF 1ª Região (AM, BA, DF, GO, MA, MG, MT, PA, PI, RO, RR, TO)" },
  { value: "trf2",          label: "TRF 2ª Região (ES, RJ)" },
  { value: "trf3",          label: "TRF 3ª Região (MS, SP)" },
  { value: "trf4",          label: "TRF 4ª Região (PR, RS, SC)" },
  { value: "trf5",          label: "TRF 5ª Região (AL, CE, PB, PE, RN, SE)" },
  { value: "trf6",          label: "TRF 6ª Região (MG)" },
  // TRTs (mais usados no Pará/Norte/Nordeste primeiro)
  { value: "trt8",          label: "TRT 8ª Região (PA, AP)" },
  { value: "trt1",          label: "TRT 1ª Região (RJ)" },
  { value: "trt2",          label: "TRT 2ª Região (SP – capital e grande SP)" },
  { value: "trt3",          label: "TRT 3ª Região (MG)" },
  { value: "trt4",          label: "TRT 4ª Região (RS)" },
  { value: "trt5",          label: "TRT 5ª Região (BA)" },
  { value: "trt6",          label: "TRT 6ª Região (PE)" },
  { value: "trt7",          label: "TRT 7ª Região (CE)" },
  { value: "trt9",          label: "TRT 9ª Região (PR)" },
  { value: "trt10",         label: "TRT 10ª Região (DF, TO)" },
  { value: "trt11",         label: "TRT 11ª Região (AM, RR)" },
  { value: "trt12",         label: "TRT 12ª Região (SC)" },
  { value: "trt13",         label: "TRT 13ª Região (PB)" },
  { value: "trt14",         label: "TRT 14ª Região (AC, RO)" },
  { value: "trt15",         label: "TRT 15ª Região (SP – interior)" },
  { value: "trt16",         label: "TRT 16ª Região (MA)" },
  { value: "trt17",         label: "TRT 17ª Região (ES)" },
  { value: "trt18",         label: "TRT 18ª Região (GO)" },
  { value: "trt19",         label: "TRT 19ª Região (AL)" },
  { value: "trt20",         label: "TRT 20ª Região (SE)" },
  { value: "trt21",         label: "TRT 21ª Região (RN)" },
  { value: "trt22",         label: "TRT 22ª Região (PI)" },
  { value: "trt23",         label: "TRT 23ª Região (MT)" },
  { value: "trt24",         label: "TRT 24ª Região (MS)" },
  // TJs Estaduais
  { value: "tjpa",          label: "TJPA" },
  { value: "tjsp",          label: "TJSP" },
  { value: "tjrj",          label: "TJRJ" },
  { value: "tjmg",          label: "TJMG" },
  { value: "tjrs",          label: "TJRS" },
  { value: "tjpr",          label: "TJPR" },
  { value: "tjsc",          label: "TJSC" },
  { value: "tjba",          label: "TJBA" },
  { value: "tjce",          label: "TJCE" },
  { value: "tjpe",          label: "TJPE" },
  { value: "tjma",          label: "TJMA" },
  { value: "tjam",          label: "TJAM" },
  { value: "tjrr",          label: "TJRR" },
  { value: "tjap",          label: "TJAP" },
  { value: "tjro",          label: "TJRO" },
  { value: "tjto",          label: "TJTO" },
  { value: "tjac",          label: "TJAC" },
  { value: "tjal",          label: "TJAL" },
  { value: "tjpb",          label: "TJPB" },
  { value: "tjpi",          label: "TJPI" },
  { value: "tjrn",          label: "TJRN" },
  { value: "tjse",          label: "TJSE" },
  { value: "tjgo",          label: "TJGO" },
  { value: "tjms",          label: "TJMS" },
  { value: "tjmt",          label: "TJMT" },
  { value: "tjes",          label: "TJES" },
  { value: "tjdft",         label: "TJDFT" },
  // Outros
  { value: "extrajudicial", label: "Extrajudicial" },
];

const STATUS_OPTS = [
  { value: "",          label: "Todos" },
  { value: "ATIVO",     label: "Ativo" },
  { value: "ARQUIVADO", label: "Arquivado" },
];

export default function Processos({ user }) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const isAdmin    = String(user?.role || "").toUpperCase() === "ADMIN";
  const canManage  = user?.tipoUsuario !== "SECRETARIA_VIRTUAL";

  const [processos,  setProcessos]  = useState([]);
  const [advogados,  setAdvogados]  = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [syncing,    setSyncing]    = useState(false);

  // Modal nova captura
  const [showCaptura,   setShowCaptura]   = useState(false);
  const [capNumero,     setCapNumero]     = useState("");
  const [capTribunal,   setCapTribunal]   = useState("tjpa");
  const [capAdvogadoId, setCapAdvogadoId] = useState("");
  const [capLoading,    setCapLoading]    = useState(false);

  const [filtAdv,            setFiltAdv]            = useState("");
  const [filtTrib,           setFiltTrib]           = useState("");
  const [filtStatus,         setFiltStatus]         = useState("ATIVO");
  const [filtNumero,         setFiltNumero]         = useState("");
  const [filtCliente,        setFiltCliente]        = useState("");
  const [filtAjuizIni,       setFiltAjuizIni]       = useState("");
  const [filtAjuizFim,       setFiltAjuizFim]       = useState("");
  const [filtUltimaAndIni,   setFiltUltimaAndIni]   = useState("");
  const [filtUltimaAndFim,   setFiltUltimaAndFim]   = useState("");
  const [filtComNovos,       setFiltComNovos]       = useState(false);

  const LIMIT = 50;

  // load aceita overrides explícitos para evitar closure stale ao mudar filtro
  async function load(p = 1, overrides = {}) {
    const adv          = "adv"          in overrides ? overrides.adv          : filtAdv;
    const trib         = "trib"         in overrides ? overrides.trib         : filtTrib;
    const stat         = "stat"         in overrides ? overrides.stat         : filtStatus;
    const numero       = "numero"       in overrides ? overrides.numero       : filtNumero;
    const cliente      = "cliente"      in overrides ? overrides.cliente      : filtCliente;
    const ajuizIni     = "ajuizIni"     in overrides ? overrides.ajuizIni     : filtAjuizIni;
    const ajuizFim     = "ajuizFim"     in overrides ? overrides.ajuizFim     : filtAjuizFim;
    const ultiIni      = "ultiIni"      in overrides ? overrides.ultiIni      : filtUltimaAndIni;
    const ultiFim      = "ultiFim"      in overrides ? overrides.ultiFim      : filtUltimaAndFim;
    const comNovos     = "comNovos"     in overrides ? overrides.comNovos     : filtComNovos;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT });
      if (adv)      params.set("advogadoId",        adv);
      if (trib)     params.set("tribunal",           trib);
      if (stat)     params.set("status",             stat);
      if (numero)   params.set("numero",             numero);
      if (cliente)  params.set("clienteNome",        cliente);
      if (ajuizIni) params.set("ajuizamentoInicio",  ajuizIni);
      if (ajuizFim) params.set("ajuizamentoFim",     ajuizFim);
      if (ultiIni)  params.set("ultimaAndInicio",    ultiIni);
      if (ultiFim)  params.set("ultimaAndFim",       ultiFim);
      if (comNovos) params.set("comNovos",           "1");
      const d = await apiFetch(`/processos?${params}`);
      setProcessos(d.processos || []);
      setTotal(d.total || 0);
      setPage(p);
    } catch (e) {
      addToast(e?.message || "Erro ao carregar processos", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    apiFetch("/advogados")
      .then(d => {
        const lista = Array.isArray(d) ? d : [];
        setAdvogados(lista);
        // Pré-seleciona o próprio advogado se não for admin
        if (!isAdmin && lista.length === 1) setCapAdvogadoId(String(lista[0].id));
      })
      .catch(() => {});
    load(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function capturar(e) {
    e.preventDefault();
    if (!capNumero.trim() || !capTribunal || !capAdvogadoId) {
      addToast("Preencha número, tribunal e advogado.", "error");
      return;
    }
    setCapLoading(true);
    try {
      const d = await apiFetch("/processos/capturar", {
        method: "POST",
        body: JSON.stringify({
          numeroProcesso: capNumero.trim(),
          tribunal: capTribunal,
          advogadoId: parseInt(capAdvogadoId),
        }),
      });
      const msg = d.jaExistia
        ? `Processo atualizado · ${d.novosAndamentos} andamento(s) novo(s)${!d.encontradoNoDataJud ? " (não encontrado no DataJud)" : ""}`
        : `Processo cadastrado · ${d.novosAndamentos} andamento(s) importado(s)${!d.encontradoNoDataJud ? " (não encontrado no DataJud)" : ""}`;
      addToast(msg, "success");
      setShowCaptura(false);
      setCapNumero("");
      load(1);
      if (!d.jaExistia && d.processo?.id) navigate(`/processos/${d.processo.id}`);
    } catch (err) {
      addToast(err?.message || "Erro ao capturar processo", "error");
    } finally {
      setCapLoading(false);
    }
  }

  async function syncAll() {
    if (!canManage) return;
    setSyncing(true);
    try {
      const params = new URLSearchParams();
      if (filtAdv)  params.set("advogadoId", filtAdv);
      if (filtTrib) params.set("tribunal",   filtTrib);
      const qs = params.toString() ? `?${params}` : "";
      const d = await apiFetch(`/processos/sync${qs}`, { method: "POST" });
      addToast(d.message || "Sincronização iniciada em background.", "success");
    } catch (e) {
      addToast(e?.message || "Erro ao sincronizar", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function syncAdv(advogadoId, nome) {
    if (!canManage) return;
    setSyncing(true);
    try {
      const qs = filtTrib ? `?tribunal=${filtTrib}` : "";
      const d = await apiFetch(`/processos/sync/${advogadoId}${qs}`, { method: "POST" });
      addToast(`${nome}: ${d.processos} processo(s), ${d.novosAndamentos} andamento(s) novo(s)`, "success");
      load(page);
    } catch (e) {
      addToast(e?.message || "Erro ao sincronizar", "error");
    } finally {
      setSyncing(false);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Processos Judiciais</h1>
          <p className="text-sm text-slate-500 mt-1">
            Acompanhamento automático via DataJud (CNJ) · {total} processo(s)
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCaptura(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              Nova Captura
            </button>
            {isAdmin && (
              <button
                onClick={syncAll}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover transition disabled:opacity-50"
              >
                <svg className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? "Sincronizando..." : "Sincronizar Todos"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filtros */}
      <form onSubmit={e => { e.preventDefault(); load(1); }} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
        {/* Linha 1: selects rápidos + novos */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Advogado</label>
            <select
              value={filtAdv}
              onChange={e => { const v = e.target.value; setFiltAdv(v); load(1, { adv: v }); }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos</option>
              {advogados.map(a => (
                <option key={a.id} value={a.id}>{a.nome} ({a.oab})</option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tribunal</label>
            <select
              value={filtTrib}
              onChange={e => { const v = e.target.value; setFiltTrib(v); load(1, { trib: v }); }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TRIBUNAIS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
            <select
              value={filtStatus}
              onChange={e => { const v = e.target.value; setFiltStatus(v); load(1, { stat: v }); }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none pb-2">
            <input
              type="checkbox"
              checked={filtComNovos}
              onChange={e => { setFiltComNovos(e.target.checked); load(1, { comNovos: e.target.checked }); }}
              className="w-4 h-4 rounded accent-blue-600"
            />
            <span className="text-sm font-medium text-slate-700">Somente com novos</span>
          </label>
        </div>

        {/* Linha 2: texto + datas */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nº do processo</label>
            <input
              type="text"
              value={filtNumero}
              onChange={e => setFiltNumero(e.target.value)}
              placeholder="0000000-00.0000..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Cliente</label>
            <input
              type="text"
              value={filtCliente}
              onChange={e => setFiltCliente(e.target.value)}
              placeholder="Nome do cliente..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Abertura de</label>
            <input type="date" value={filtAjuizIni} onChange={e => setFiltAjuizIni(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">até</label>
            <input type="date" value={filtAjuizFim} onChange={e => setFiltAjuizFim(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Últ. andamento de</label>
            <input type="date" value={filtUltimaAndIni} onChange={e => setFiltUltimaAndIni(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">até</label>
            <input type="date" value={filtUltimaAndFim} onChange={e => setFiltUltimaAndFim(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2 pb-0.5">
            <button type="submit"
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition">
              Buscar
            </button>
            <button type="button"
              onClick={() => {
                setFiltNumero(""); setFiltCliente("");
                setFiltAjuizIni(""); setFiltAjuizFim("");
                setFiltUltimaAndIni(""); setFiltUltimaAndFim("");
                load(1, { numero: "", cliente: "", ajuizIni: "", ajuizFim: "", ultiIni: "", ultiFim: "" });
              }}
              className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-200 transition">
              Limpar
            </button>
          </div>
        </div>
      </form>

      {/* Tabela */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <svg className="w-6 h-6 animate-spin mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Carregando...
          </div>
        ) : processos.length === 0 ? (
          <EmptyState
            icon="📋"
            title="Nenhum processo encontrado"
            description={isAdmin ? 'Clique em "Sincronizar Todos" para buscar processos no DataJud (CNJ).' : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Número</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Tribunal</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Advogado</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Cliente</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Assunto</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Último Andamento</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Novos</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {processos.map(p => {
                  const novos = p._count?.andamentos || 0;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/processos/${p.id}`)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {p.numeroProcesso}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 uppercase">
                          {p.tribunal}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-medium">{p.advogado?.nome}</div>
                        <div className="text-xs text-slate-400">{p.advogado?.oab}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[200px]">
                        {p.clienteNome ? (
                          <>
                            <div className="truncate text-sm">{p.clienteNome}</div>
                            {p.posicaoCliente && (
                              <div className="text-xs text-slate-400">{p.posicaoCliente}</div>
                            )}
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">
                        <div className="truncate">{p.assunto || p.classe || "—"}</div>
                        {p.dataAjuizamento && (
                          <div className="text-xs text-slate-400">Abertura: {fmtDate(p.dataAjuizamento)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">
                        {p.ultimoAndamento ? (
                          <>
                            <div className="truncate text-sm">{p.ultimoAndamento}</div>
                            {p.ultimaDataAnd && (
                              <div className="text-xs text-slate-400">{fmtDate(p.ultimaDataAnd)}</div>
                            )}
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {novos > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">
                            {novos} novo{novos !== 1 ? "s" : ""}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => syncAdv(p.advogado?.id, p.advogado?.nome)}
                            disabled={syncing}
                            title="Sincronizar este advogado"
                            className="text-slate-400 hover:text-blue-600 transition disabled:opacity-30"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <span className="text-sm text-slate-500">
              {total} processo(s) · página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => load(page - 1)}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 transition"
              >
                Anterior
              </button>
              <button
                onClick={() => load(page + 1)}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 transition"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal — Nova Captura */}
      {showCaptura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Nova Captura por CNJ</h2>
              <button onClick={() => setShowCaptura(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={capturar} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Número CNJ</label>
                <input
                  type="text"
                  value={capNumero}
                  onChange={e => setCapNumero(e.target.value)}
                  placeholder="0000000-00.0000.0.00.0000"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Tribunal</label>
                <select
                  value={capTribunal}
                  onChange={e => setCapTribunal(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {TRIBUNAIS.filter(t => t.value).map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Advogado responsável</label>
                <select
                  value={capAdvogadoId}
                  onChange={e => setCapAdvogadoId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Selecione...</option>
                  {advogados.map(a => (
                    <option key={a.id} value={a.id}>{a.nome} ({a.oab})</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-500">
                O sistema buscará o processo no DataJud (CNJ) e importará os andamentos automaticamente.
                Se não encontrado, o processo será cadastrado sem dados do DataJud.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCaptura(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={capLoading}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {capLoading && (
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {capLoading ? "Buscando..." : "Capturar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
