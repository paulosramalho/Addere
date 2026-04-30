// src/pages/ProcessoDetalhe.jsx — Detalhe de processo + timeline de andamentos
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { fmtDate } from "../lib/formatters";

/* ────────────────────────────────────────── */
/* Classificação de tipo de andamento        */
/* ────────────────────────────────────────── */
const TIPOS = [
  { id: "sentenca",     label: "Sentença",   color: "bg-red-100 text-red-700",     icon: "⚖️",  regex: /sentença|julgamento|mérito|improcedente|procedente/i },
  { id: "despacho",     label: "Despacho",   color: "bg-slate-100 text-slate-600", icon: "📋", regex: /despacho/i },
  { id: "intimacao",    label: "Intimação",  color: "bg-yellow-100 text-yellow-700",icon: "📢", regex: /intima[çc]|cite-se|cita[çc]/i },
  { id: "audiencia",    label: "Audiência",  color: "bg-purple-100 text-purple-700",icon: "🎙️", regex: /audiência|designad/i },
  { id: "prazo",        label: "Prazo",      color: "bg-orange-100 text-orange-700",icon: "⏰", regex: /prazo|impugn|manifestação|contrarraz/i },
  { id: "recurso",      label: "Recurso",    color: "bg-blue-100 text-blue-700",   icon: "📤", regex: /recurso|apelação|agravo|embargos|recursal/i },
  { id: "arquivamento", label: "Arquivamento",color:"bg-slate-100 text-slate-500", icon: "📁", regex: /arquiv|extin/i },
  { id: "juntada",      label: "Juntada",    color: "bg-teal-100 text-teal-700",   icon: "📎", regex: /juntad|petição|documento/i },
];

function classifyAndamento(descricao = "") {
  for (const t of TIPOS) {
    if (t.regex.test(descricao)) return t;
  }
  return { id: "outro", label: "Outro", color: "bg-slate-50 text-slate-500", icon: "📄" };
}

/* ────────────────────────────────────────── */
/* Badges                                    */
/* ────────────────────────────────────────── */
const TRIBUNAL_LABELS = {
  // Tribunais de Justiça Estaduais
  tjac: "TJAC", tjal: "TJAL", tjam: "TJAM", tjap: "TJAP", tjba: "TJBA",
  tjce: "TJCE", tjdft: "TJDFT", tjes: "TJES", tjgo: "TJGO", tjma: "TJMA",
  tjmg: "TJMG", tjms: "TJMS", tjmt: "TJMT", tjpa: "TJPA", tjpb: "TJPB",
  tjpe: "TJPE", tjpi: "TJPI", tjpr: "TJPR", tjrj: "TJRJ", tjrn: "TJRN",
  tjro: "TJRO", tjrr: "TJRR", tjrs: "TJRS", tjsc: "TJSC", tjse: "TJSE",
  tjsp: "TJSP", tjto: "TJTO",
  // Tribunais Regionais Federais
  trf1: "TRF 1ª Região", trf2: "TRF 2ª Região", trf3: "TRF 3ª Região",
  trf4: "TRF 4ª Região", trf5: "TRF 5ª Região", trf6: "TRF 6ª Região",
  // Tribunais Regionais do Trabalho
  trt1: "TRT 1ª Região", trt2: "TRT 2ª Região", trt3: "TRT 3ª Região",
  trt4: "TRT 4ª Região", trt5: "TRT 5ª Região", trt6: "TRT 6ª Região",
  trt7: "TRT 7ª Região", trt8: "TRT 8ª Região", trt9: "TRT 9ª Região",
  trt10: "TRT 10ª Região", trt11: "TRT 11ª Região", trt12: "TRT 12ª Região",
  trt13: "TRT 13ª Região", trt14: "TRT 14ª Região", trt15: "TRT 15ª Região",
  trt16: "TRT 16ª Região", trt17: "TRT 17ª Região", trt18: "TRT 18ª Região",
  trt19: "TRT 19ª Região", trt20: "TRT 20ª Região", trt21: "TRT 21ª Região",
  trt22: "TRT 22ª Região", trt23: "TRT 23ª Região", trt24: "TRT 24ª Região",
  // Superiores
  stj: "STJ", stf: "STF", tst: "TST",
  // Outros
  extrajudicial: "Extrajudicial",
};

function TribunalBadge({ tribunal }) {
  const t = tribunal || "";
  let color = "bg-slate-100 text-slate-700";
  if (t === "stf")                       color = "bg-red-100 text-red-700";
  else if (t === "stj")                  color = "bg-emerald-100 text-emerald-700";
  else if (t === "tst")                  color = "bg-orange-100 text-orange-700";
  else if (t.startsWith("trf"))          color = "bg-indigo-100 text-indigo-700";
  else if (t.startsWith("trt"))          color = "bg-purple-100 text-purple-700";
  else if (t.startsWith("tj"))           color = "bg-blue-100 text-blue-700";
  const label = TRIBUNAL_LABELS[t] || t.toUpperCase();
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {label}
    </span>
  );
}

/* ────────────────────────────────────────── */
/* URL de consulta por tribunal               */
/* ────────────────────────────────────────── */
function consultaUrl(tribunal, numero) {
  const n = encodeURIComponent(numero);
  switch (tribunal) {
    // ── Tribunais de Justiça Estaduais ──────────────────────
    case "tjpa": return `https://tucujuris.tjpa.jus.br/pjekz/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjrr": return `https://tucumaque.tjrr.jus.br/pjekz/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjsp": {
      const m = numero.match(/^(\d+-\d+\.\d+)\.\d+\.\d+\.(\d+)$/);
      if (m) return `https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&numeroDigitoAnoUnificado=${encodeURIComponent(m[1])}&foroNumeroUnificado=${m[2]}`;
      return `https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&numeroDigitoAnoUnificado=${n}`;
    }
    case "tjrj": return `https://www3.tjrj.jus.br/consultaprocessual/index.html#/consultapublica/processo/${n}`;
    case "tjmg": return `https://processo.tjmg.jus.br/jurisprudencia/consulta/processo.html#busca/numeroProcesso/${n}`;
    case "tjrs": return `https://www.tjrs.jus.br/novo/buscas-e-processos/processos/?query=${n}`;
    case "tjpr": return `https://portal.tjpr.jus.br/web/guest/pesquisa-processual?query=${n}`;
    case "tjsc": return `https://esaj.tjsc.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&query=${n}`;
    case "tjba": return `https://esaj.tjba.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&query=${n}`;
    case "tjce": return `https://esaj.tjce.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&query=${n}`;
    case "tjpe": return `https://srv01.tjpe.jus.br/consultaprocessual/processo/${n}`;
    case "tjma": return `https://pje.tjma.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjpi": return `https://pje.tjpi.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjam": return `https://consultasaj.tjam.jus.br/cposg5/search.do?cbPesquisa=NUMPROC&query=${n}`;
    case "tjac": return `https://esaj.tjac.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&query=${n}`;
    case "tjap": return `https://pje.tjap.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjro": return `https://pje.tjro.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjto": return `https://esaj.tjto.jus.br/pjecor/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjpb": return `https://pje.tjpb.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjrn": return `https://pje1.tjrn.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjal": return `https://pje.tjal.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjse": return `https://pje.tjse.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjgo": return `https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=1&query=${n}`;
    case "tjmt": return `https://pje.tjmt.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "tjms": return `https://esaj.tjms.jus.br/cpo5/search.do?cbPesquisa=NUMPROC&query=${n}`;
    case "tjes": return `https://sistemas.tjes.jus.br/apes/internet/jsp/apes/main.jsp?q=${n}`;
    case "tjdft": return `https://www.tjdft.jus.br/consultas/processos?query=${n}`;
    // ── TRFs ───────────────────────────────────────────────
    case "trf1": return `https://processual.trf1.jus.br/consultaProcessual/processo.php?proc=${n}&secao=TRF1`;
    case "trf2": return `https://eproc2g.trf2.jus.br/eproc2/controlador.php?acao=processo_consulta_publica&num_processo=${n}`;
    case "trf3": return `https://web.trf3.jus.br/base/consultaProcessual?acao=pesquisar&numProcesso=${n}`;
    case "trf4": return `https://eproc.trf4.jus.br/eproc/externo_controlador.php?acao=processo_seleciona_publica&num_processo=${n}`;
    case "trf5": return `https://pje.trf5.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    case "trf6": return `https://pje.trf6.jus.br/pje/ConsultaPublica/listView.seam?ca=${n}`;
    // ── TRTs ───────────────────────────────────────────────
    case "trt1": return `https://pje.trt1.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt2": return `https://pje.trt2.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt3": return `https://pje.trt3.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt4": return `https://pje.trt4.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt5": return `https://pje.trt5.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt6": return `https://pje.trt6.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt7": return `https://pje.trt7.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt8": return `https://pje.trt8.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt9": return `https://pje.trt9.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt10": return `https://pje.trt10.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt11": return `https://pje.trt11.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt12": return `https://pje.trt12.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt13": return `https://pje.trt13.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt14": return `https://pje.trt14.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt15": return `https://pje.trt15.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt16": return `https://pje.trt16.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt17": return `https://pje.trt17.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt18": return `https://pje.trt18.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt19": return `https://pje.trt19.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt20": return `https://pje.trt20.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt21": return `https://pje.trt21.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt22": return `https://pje.trt22.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt23": return `https://pje.trt23.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    case "trt24": return `https://pje.trt24.jus.br/consultaprocessual/pages/consultas/ProcessoConsulta.seam?numProcesso=${n}`;
    // ── Superiores ─────────────────────────────────────────
    case "stj":  return `https://processo.stj.jus.br/processo/pesquisa/?tipoPesquisa=tipoPesquisaNumeroRegistro&termo=${n}`;
    case "stf":  return `https://portal.stf.jus.br/processos/listar.asp?numero=${n}`;
    case "tst":  return `https://consultaprocessual.tst.jus.br/consultaProcessual/consultaTst.do?query=${n}`;
    default:     return null;
  }
}

/* ────────────────────────────────────────── */
/* Componente de nota inline por andamento   */
/* ────────────────────────────────────────── */
function NotaInline({ andamentoId, notaInicial, onSaved }) {
  const { addToast } = useToast();
  const [editing, setEditing]   = useState(false);
  const [texto,   setTexto]     = useState(notaInicial || "");
  const [saving,  setSaving]    = useState(false);
  const taRef = useRef(null);

  function startEdit() {
    setTexto(notaInicial || "");
    setEditing(true);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/processos/andamentos/${andamentoId}/nota`, {
        method: "PATCH",
        body: JSON.stringify({ nota: texto }),
      });
      onSaved(texto);
      setEditing(false);
    } catch (e) {
      addToast(e?.message || "Erro ao salvar nota", "error");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setTexto(notaInicial || "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="mt-1.5">
        {notaInicial ? (
          <div
            onClick={startEdit}
            className="flex items-start gap-1.5 cursor-pointer group"
            title="Clique para editar a nota"
          >
            <span className="text-xs text-amber-600 flex-shrink-0 mt-0.5">📝</span>
            <p className="text-xs text-amber-700 leading-relaxed group-hover:underline">{notaInicial}</p>
          </div>
        ) : (
          <button
            onClick={startEdit}
            className="text-xs text-slate-300 hover:text-amber-500 transition flex items-center gap-1"
          >
            <span>+ nota</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5" onClick={e => e.stopPropagation()}>
      <textarea
        ref={taRef}
        value={texto}
        onChange={e => setTexto(e.target.value)}
        rows={2}
        placeholder="Adicione uma nota sobre este andamento..."
        className="w-full text-xs border border-amber-300 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 bg-amber-50"
      />
      <div className="flex gap-1.5">
        <button
          onClick={save}
          disabled={saving}
          className="px-2.5 py-1 bg-amber-500 text-white rounded text-xs font-semibold hover:bg-amber-600 transition disabled:opacity-50"
        >
          {saving ? "..." : "Salvar"}
        </button>
        <button
          onClick={cancel}
          className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded text-xs font-semibold hover:bg-slate-200 transition"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────── */
/* Calculadora de prazos                     */
/* ────────────────────────────────────────── */

/** Easter Sunday (Meeus/Jones/Butcher algorithm) */
function calcEaster(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

/** Fixed + moveable Brazilian national holidays for a given year */
function feriadosDoAno(year) {
  const fixed = [
    [1,  0], // 01 jan
    [21, 3], // 21 abr
    [1,  4], // 01 mai
    [7,  8], // 07 set
    [12, 9], // 12 out
    [2, 10], // 02 nov
    [15,10], // 15 nov
    [20,10], // 20 nov (Consciência Negra — Lei 14.759/2023)
    [25,11], // 25 dez
  ].map(([d, m]) => new Date(year, m, d).toDateString());

  const easter = calcEaster(year);
  const add = n => { const d = new Date(easter); d.setDate(d.getDate() + n); return d.toDateString(); };
  const moveable = [
    add(-48), // Carnaval segunda
    add(-47), // Carnaval terça
    add(-2),  // Sexta-feira Santa
    add(60),  // Corpus Christi
  ];

  return new Set([...fixed, ...moveable]);
}

/** CNJ end-of-year recess: Dec 20 → Jan 6 */
function isRecesso(date) {
  const m = date.getMonth(), d = date.getDate();
  return (m === 11 && d >= 20) || (m === 0 && d <= 6);
}

/** True if date is a business day (not Sat/Sun/holiday, optionally not recess) */
function isDiaUtil(date, feriados, exclRecesso) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  if (feriados.has(date.toDateString())) return false;
  if (exclRecesso && isRecesso(date)) return false;
  return true;
}

/** Advance date past non-working days until we land on a business day */
function proximoDiaUtil(date, feriados, exclRecesso) {
  const d = new Date(date);
  while (!isDiaUtil(d, feriados, exclRecesso)) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Calculate deadline.
 * tipo: "corridos" | "uteis" | "processual"
 * For "corridos": add N calendar days, then push to next business day.
 * For "uteis" / "processual": count only business days.
 */
function calcularPrazo(dataBase, dias, tipo, exclRecesso) {
  const base = new Date(dataBase);
  // exclude start date (prazo começa a contar no dia seguinte — CPC art. 224)
  base.setDate(base.getDate() + 1);

  // build holiday set for potentially spanning years
  const anos = new Set([base.getFullYear(), base.getFullYear() + 1]);
  let feriados = new Set();
  for (const y of anos) feriadosDoAno(y).forEach(f => feriados.add(f));

  const incRecesso = tipo === "processual" ? exclRecesso : false;

  if (tipo === "corridos") {
    const result = new Date(base);
    result.setDate(result.getDate() + dias - 1);
    // if lands on non-business day, move forward
    return proximoDiaUtil(result, feriados, incRecesso);
  }

  // uteis or processual: count business days one by one
  let result = new Date(base);
  let count = 0;
  // if start (day after base) is not util, advance first
  while (!isDiaUtil(result, feriados, incRecesso)) result.setDate(result.getDate() + 1);
  count = 1;
  while (count < dias) {
    result.setDate(result.getDate() + 1);
    if (isDiaUtil(result, feriados, incRecesso)) count++;
  }
  return result;
}

const DIAS_RAPIDOS = [5, 10, 15, 30, 60, 90, 120];
const DIAS_SEMANA  = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];

function CalcPrazo({ dataAndamento, onUsarData }) {
  const hoje = new Date();
  const baseDefault = dataAndamento
    ? new Date(dataAndamento).toISOString().slice(0, 10)
    : hoje.toISOString().slice(0, 10);

  const [dataBase,    setDataBase]    = useState(baseDefault);
  const [dias,        setDias]        = useState(15);
  const [diasCustom,  setDiasCustom]  = useState("");
  const [tipo,        setTipo]        = useState("uteis");
  const [exclRecesso, setExclRecesso] = useState(true);
  const [isCustom,    setIsCustom]    = useState(false);

  const qtdDias = isCustom ? (parseInt(diasCustom) || 0) : dias;

  const resultado = (() => {
    if (!dataBase || qtdDias <= 0) return null;
    try { return calcularPrazo(dataBase, qtdDias, tipo, exclRecesso); }
    catch { return null; }
  })();

  const resultStr = resultado
    ? resultado.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    : null;

  function aplicar() {
    if (!resultado) return;
    const iso = resultado.toISOString().slice(0, 10) + "T17:00"; // fim do expediente
    onUsarData(iso);
  }

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-orange-500">⏱️</span>
        <p className="text-xs font-bold text-orange-700 uppercase tracking-wide">Calculadora de Prazo</p>
      </div>

      {/* Linha 1: data base + quantidade */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Data base</label>
          <input
            type="date"
            value={dataBase}
            onChange={e => setDataBase(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Prazo (dias)</label>
          <div className="flex gap-1">
            <select
              value={isCustom ? "custom" : String(dias)}
              onChange={e => {
                if (e.target.value === "custom") { setIsCustom(true); }
                else { setIsCustom(false); setDias(parseInt(e.target.value)); }
              }}
              className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {DIAS_RAPIDOS.map(d => (
                <option key={d} value={String(d)}>{d} dias</option>
              ))}
              <option value="custom">Outro...</option>
            </select>
            {isCustom && (
              <input
                type="number"
                min="1"
                max="365"
                value={diasCustom}
                onChange={e => setDiasCustom(e.target.value)}
                placeholder="Nº"
                className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            )}
          </div>
        </div>
      </div>

      {/* Linha 2: tipo + recesso */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Contagem</label>
          <select
            value={tipo}
            onChange={e => setTipo(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="corridos">Dias corridos</option>
            <option value="uteis">Dias úteis (CPC art. 219)</option>
            <option value="processual">Prazo processual (+ recesso)</option>
          </select>
        </div>
        {tipo === "processual" && (
          <label className="flex items-center gap-1.5 cursor-pointer mt-4">
            <input
              type="checkbox"
              checked={exclRecesso}
              onChange={e => setExclRecesso(e.target.checked)}
              className="w-3.5 h-3.5 accent-orange-500"
            />
            <span className="text-xs text-slate-600">Excl. recesso CNJ</span>
          </label>
        )}
      </div>

      {/* Resultado */}
      {resultado ? (
        <div className="bg-white border border-orange-300 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Vencimento</p>
            <p className="text-sm font-bold text-orange-700 capitalize">{resultStr}</p>
            {isRecesso(resultado) && (
              <p className="text-xs text-amber-600 mt-0.5">⚠️ Cai em recesso forense</p>
            )}
          </div>
          <button
            onClick={aplicar}
            className="flex-shrink-0 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-bold hover:bg-orange-600 transition"
          >
            Usar esta data →
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-400 text-center py-1">Preencha data base e quantidade de dias</p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────── */
/* Modal Gerar Prazo                         */
/* ────────────────────────────────────────── */
function GerarPrazoModal({ andamento, processo, onClose }) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);

  const fmt = d => d.toISOString().slice(0, 16);
  const hoje = new Date();
  const defaultDate = new Date(hoje.getTime() + 15 * 24 * 60 * 60 * 1000);

  const [titulo,     setTitulo]     = useState(`Prazo — ${processo?.numeroProcesso || ""}`);
  const [dataInicio, setDataInicio] = useState(fmt(defaultDate));
  const [dataFim,    setDataFim]    = useState(fmt(defaultDate));
  const [tipo,       setTipo]       = useState("PRAZO");
  const [descricao,  setDescricao]  = useState(andamento?.descricao?.slice(0, 400) || "");

  function aplicarData(iso) {
    setDataInicio(iso);
    setDataFim(iso);
  }

  async function salvar() {
    if (!titulo || !dataInicio) return;
    setSaving(true);
    try {
      await apiFetch("/agenda", {
        method: "POST",
        body: JSON.stringify({
          titulo,
          dataInicio: new Date(dataInicio).toISOString(),
          dataFim: new Date(dataFim || dataInicio).toISOString(),
          tipo,
          descricao,
        }),
      });
      addToast("Prazo criado na agenda!", "success");
      onClose();
    } catch (e) {
      addToast(e?.message || "Erro ao criar prazo", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg space-y-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Gerar Prazo na Agenda</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {/* Calculadora */}
        <CalcPrazo
          dataAndamento={andamento?.dataAndamento}
          onUsarData={aplicarData}
        />

        {/* Campos do evento */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Título *</label>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Data/hora início *</label>
              <input
                type="datetime-local"
                value={dataInicio}
                onChange={e => { setDataInicio(e.target.value); setDataFim(e.target.value); }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fim</label>
              <input
                type="datetime-local"
                value={dataFim}
                onChange={e => setDataFim(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo</label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="PRAZO">Prazo Processual</option>
              <option value="AUDIENCIA">Audiência</option>
              <option value="REUNIAO">Reunião</option>
              <option value="OUTRO">Outro</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Descrição</label>
            <textarea
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={salvar}
            disabled={saving || !titulo || !dataInicio}
            className="flex-1 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover transition disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Criar na agenda"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-200 transition"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────── */
/* Página principal                          */
/* ────────────────────────────────────────── */
export default function ProcessoDetalhe({ user }) {
  const { processoId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isAdmin   = String(user?.role || "").toUpperCase() === "ADMIN";
  const canManage = user?.tipoUsuario !== "SECRETARIA_VIRTUAL";

  const [processo,       setProcesso]       = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [syncing,        setSyncing]        = useState(false);
  const [savingStatus,   setSavingStatus]   = useState(false);
  const [markingLidos,   setMarkingLidos]   = useState(false);
  const [showImport,     setShowImport]     = useState(false);
  const [importTexto,    setImportTexto]    = useState("");
  const [importing,      setImporting]      = useState(false);
  const [portalSyncing,  setPortalSyncing]  = useState(false);
  const [portalNovos,    setPortalNovos]    = useState(null); // null = não rodou ainda

  // Filtro de andamentos (client-side)
  const [filtroTexto,  setFiltroTexto]  = useState("");
  const [filtroTipo,   setFiltroTipo]   = useState("");

  // Modal gerar prazo
  const [prazoModal, setPrazoModal] = useState(null); // andamento selecionado

  // Modal captura segredo de justiça via PJe
  const [segredoModal,    setSegredoModal]    = useState(false);
  const [segredoLogin,    setSegredoLogin]    = useState("");
  const [segredoSenha,    setSegredoSenha]    = useState("");
  const [segredoToken,    setSegredoToken]    = useState("");
  const [segredoInst,     setSegredoInst]     = useState("1G");
  const [segredoTrib,     setSegredoTrib]     = useState("");
  const [segredoLoading,  setSegredoLoading]  = useState(false);
  const [tribunaisPJe,    setTribunaisPJe]    = useState([]);

  useEffect(() => {
    loadProcesso();
    apiFetch("/processos/tribunais-pje").then(d => setTribunaisPJe(d || [])).catch(() => {});
  }, [processoId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function autoSyncPortal(tribunal) {
    if (!["tjsp", "tjpa"].includes(tribunal)) return;
    setPortalSyncing(true);
    try {
      const d = await apiFetch(`/processos/${processoId}/sync-portal`, { method: "POST" });
      if (!d.skipped && d.novos > 0) {
        setPortalNovos(d.novos);
        loadProcesso({ skipPortalSync: true }); // recarrega com novos andamentos
      }
    } catch { /* silencioso */ } finally {
      setPortalSyncing(false);
    }
  }

  async function loadProcesso(opts = {}) {
    setLoading(true);
    try {
      const d = await apiFetch(`/processos/${processoId}`);
      setProcesso(d);
      // Auto-sync do portal ao abrir pela primeira vez
      if (!opts.skipPortalSync) autoSyncPortal(d.tribunal);
    } catch (e) {
      addToast(e?.message || "Erro ao carregar processo", "error");
      navigate("/processos");
    } finally {
      setLoading(false);
    }
  }

  async function alterarStatus(novoStatus) {
    if (!isAdmin || savingStatus) return;
    setSavingStatus(true);
    try {
      await apiFetch(`/processos/${processoId}`, { method: "PATCH", body: JSON.stringify({ status: novoStatus }) });
      setProcesso(p => ({ ...p, status: novoStatus }));
      addToast(`Status atualizado para ${novoStatus}`, "success");
    } catch (e) {
      addToast(e?.message || "Erro ao atualizar status", "error");
    } finally {
      setSavingStatus(false);
    }
  }

  async function toggleMonitorado() {
    if (!canManage || savingStatus) return;
    const novoValor = !processo.monitorado;
    setSavingStatus(true);
    try {
      await apiFetch(`/processos/${processoId}`, { method: "PATCH", body: JSON.stringify({ monitorado: novoValor }) });
      setProcesso(p => ({ ...p, monitorado: novoValor }));
      addToast(novoValor ? "Monitoramento ativado" : "Monitoramento desativado", "success");
    } catch (e) {
      addToast(e?.message || "Erro ao atualizar monitoramento", "error");
    } finally {
      setSavingStatus(false);
    }
  }

  async function sincronizar() {
    if (!isAdmin) return;
    setSyncing(true);
    try {
      const d = await apiFetch(`/processos/${processoId}/sync-numero`, { method: "POST" });
      const msg = d.message
        || `${d.novosAndamentos} andamento(s) novo(s)${d.statusMudou ? ` · Status → ${d.status}` : ""}`;
      addToast(msg, "success");
      loadProcesso({ skipPortalSync: true });
    } catch (e) {
      addToast(e?.message || "Erro ao sincronizar", "error");
    } finally {
      setSyncing(false);
    }
  }

  function abrirSegredoModal() {
    // Pré-seleciona o tribunal do processo se suportado no PJe
    const tribProcesso = processo?.tribunal || "";
    const suportado = tribunaisPJe.find(t => t.key === tribProcesso);
    setSegredoTrib(suportado ? tribProcesso : (tribunaisPJe[0]?.key || "tjpa"));
    setSegredoInst("1G");
    setSegredoLogin("");
    setSegredoSenha("");
    setSegredoToken("");
    setSegredoModal(true);
  }

  async function capturarSegredo(e) {
    e.preventDefault();
    if (!segredoLogin || !segredoSenha) return;
    setSegredoLoading(true);
    try {
      const tribConfig = tribunaisPJe.find(t => t.key === segredoTrib);
      const d = await apiFetch(`/processos/${processoId}/capturar-segredo`, {
        method: "POST",
        body: JSON.stringify({
          tribunal: segredoTrib,
          instancia: segredoInst,
          login: segredoLogin,
          senha: segredoSenha,
          token: segredoToken || undefined,
        }),
      });
      setSegredoModal(false);
      if (d.novos > 0) {
        addToast(`${d.novos} andamento(s) novo(s) capturado(s) via PJe`, "success");
        loadProcesso({ skipPortalSync: true });
      } else {
        addToast(`Captura concluída — ${d.total} andamento(s) já registrado(s), nenhum novo`, "info");
      }
    } catch (e) {
      addToast(e?.message || "Erro na captura via PJe", "error");
    } finally {
      setSegredoLoading(false);
    }
  }

  async function importarMovimentos() {
    if (!importTexto.trim()) return;
    setImporting(true);
    try {
      const d = await apiFetch(`/processos/${processoId}/importar-movimentos`, {
        method: "POST",
        body: JSON.stringify({ texto: importTexto }),
      });
      addToast(`${d.novos} novo(s) andamento(s) importado(s)${d.ignorados ? ` · ${d.ignorados} já existiam` : ""}`, "success");
      setShowImport(false);
      setImportTexto("");
      loadProcesso({ skipPortalSync: true });
    } catch (e) {
      addToast(e?.message || "Erro ao importar", "error");
    } finally {
      setImporting(false);
    }
  }

  async function marcarTodosLidos() {
    if (markingLidos) return;
    setMarkingLidos(true);
    try {
      const d = await apiFetch(`/processos/${processoId}/marcar-lidos`, { method: "PATCH" });
      setProcesso(p => ({
        ...p,
        andamentos: p.andamentos.map(a => ({ ...a, notificado: true })),
      }));
      addToast(`${d.count} andamento(s) marcado(s) como lido`, "success");
    } catch (e) {
      addToast(e?.message || "Erro ao marcar lidos", "error");
    } finally {
      setMarkingLidos(false);
    }
  }

  function handleNotaSaved(andamentoId, novaNota) {
    setProcesso(p => ({
      ...p,
      andamentos: p.andamentos.map(a =>
        a.id === andamentoId ? { ...a, nota: novaNota } : a
      ),
    }));
  }

  // Cor de acento por tribunal (pattern-based)
  function getTribunalAccent(t = "") {
    if (t === "stf")          return "border-red-500";
    if (t === "stj")          return "border-emerald-500";
    if (t === "tst")          return "border-orange-500";
    if (t.startsWith("trf")) return "border-indigo-500";
    if (t.startsWith("trt")) return "border-purple-500";
    if (t.startsWith("tj"))  return "border-blue-500";
    return "border-slate-400";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
        <svg className="w-8 h-8 animate-spin mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Carregando processo...
      </div>
    );
  }

  if (!processo) return null;

  const andamentos = processo.andamentos || [];
  const novosCount = andamentos.filter(a => !a.notificado).length;
  const url = consultaUrl(processo.tribunal, processo.numeroProcesso);
  const accentBorder = getTribunalAccent(processo.tribunal);

  const ultimoAnd = andamentos[0]; // já ordenados DESC
  const ultimaData = ultimoAnd?.dataAndamento
    ? new Date(ultimoAnd.dataAndamento).toLocaleDateString("pt-BR")
    : "—";

  // Filtro client-side
  const andamentosFiltrados = andamentos.filter(a => {
    if (filtroTexto && !a.descricao?.toLowerCase().includes(filtroTexto.toLowerCase())) return false;
    if (filtroTipo) {
      const tipo = classifyAndamento(a.descricao);
      if (tipo.id !== filtroTipo) return false;
    }
    return true;
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* Voltar */}
      <button
        onClick={() => navigate("/processos")}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
        </svg>
        Processos
      </button>

      {/* ── Card principal ─────────────────────────────── */}
      <div className={`bg-white rounded-2xl shadow-sm border-l-4 ${accentBorder} border border-slate-200 overflow-hidden`}>

        {/* Cabeçalho do card */}
        <div className="px-6 pt-5 pb-4">
          {/* Badges de topo */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <TribunalBadge tribunal={processo.tribunal} />

            {isAdmin ? (
              <select
                value={processo.status}
                onChange={e => alterarStatus(e.target.value)}
                disabled={savingStatus}
                className={`text-xs font-semibold rounded-full px-2.5 py-0.5 border-0 outline-none cursor-pointer disabled:opacity-50 ${
                  processo.status === "ATIVO"
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                <option value="ATIVO">● ATIVO</option>
                <option value="ARQUIVADO">● ARQUIVADO</option>
              </select>
            ) : (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                processo.status === "ATIVO" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block ${processo.status === "ATIVO" ? "bg-green-500" : "bg-slate-400"}`} />
                {processo.status}
              </span>
            )}

            {canManage && (
              <button
                onClick={toggleMonitorado}
                disabled={savingStatus}
                title={processo.monitorado ? "Desativar monitoramento diário" : "Ativar monitoramento diário"}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50 ${
                  processo.monitorado
                    ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                    : "bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200"
                }`}
              >
                <span>{processo.monitorado ? "👁 Monitorado" : "👁 Pausado"}</span>
              </button>
            )}

            {novosCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600 animate-pulse">
                {novosCount} novo{novosCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Número do processo */}
          <h1 className="text-2xl font-bold text-slate-800 font-mono tracking-tight leading-tight break-all">
            {processo.numeroProcesso}
          </h1>

          {/* Classe e assunto */}
          {(processo.classe || processo.assunto) && (
            <div className="mt-2 space-y-0.5">
              {processo.classe && (
                <p className="text-sm font-semibold text-slate-600">{processo.classe}</p>
              )}
              {processo.assunto && (
                <p className="text-xs text-slate-400 leading-relaxed">{processo.assunto}</p>
              )}
            </div>
          )}
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/60">
          <div className="px-5 py-3">
            <p className="text-xs text-slate-400 font-medium">Advogado</p>
            <p className="text-sm font-semibold text-slate-700 mt-0.5 truncate">{processo.advogado?.nome || "—"}</p>
            <p className="text-xs text-slate-400">{processo.advogado?.oab}</p>
          </div>
          <div className="px-5 py-3">
            <p className="text-xs text-slate-400 font-medium">Cliente</p>
            <p className="text-sm font-semibold text-slate-700 mt-0.5 truncate">{processo.clienteNome || "—"}</p>
            {processo.posicaoCliente && (
              <p className="text-xs text-slate-400">{processo.posicaoCliente}</p>
            )}
          </div>
          <div className="px-5 py-3">
            <p className="text-xs text-slate-400 font-medium">Ajuizamento</p>
            <p className="text-sm font-semibold text-slate-700 mt-0.5">
              {processo.dataAjuizamento ? fmtDate(processo.dataAjuizamento) : "—"}
            </p>
          </div>
          <div className="px-5 py-3">
            <p className="text-xs text-slate-400 font-medium">Última movimentação</p>
            <p className="text-sm font-semibold text-slate-700 mt-0.5">{ultimaData}</p>
            <p className="text-xs text-slate-400">{andamentos.length} andamento{andamentos.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {/* Botões de ação */}
        <div className="px-6 py-3 border-t border-slate-100 flex flex-wrap gap-2">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 hover:border-slate-400 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Ver no tribunal
            </a>
          )}
          {canManage && (
            <button
              onClick={abrirSegredoModal}
              disabled={segredoLoading}
              className="inline-flex items-center gap-2 px-4 py-2 border border-amber-300 text-amber-700 bg-amber-50 rounded-lg text-xs font-semibold hover:bg-amber-100 transition disabled:opacity-50"
              title="Capturar andamentos de processo em segredo de justiça via PJe"
            >
              🔐 Capturar via PJe
            </button>
          )}
          {isAdmin && (
            <>
              <button
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
                title="Colar movimentações do portal do tribunal"
              >
                📋 Importar do Portal
              </button>
              <button
                onClick={sincronizar}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-hover transition disabled:opacity-50"
              >
                <svg className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? "Sincronizando..." : "Sincronizar"}
              </button>
            </>
          )}
          {/* Indicador de sync automático com portal TJSP */}
          {portalSyncing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 italic">
              <svg className="w-3.5 h-3.5 animate-spin text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Buscando atualizações do portal...
            </span>
          )}
          {!portalSyncing && portalNovos > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold">
              ✅ {portalNovos} andamento{portalNovos !== 1 ? "s" : ""} novo{portalNovos !== 1 ? "s" : ""} do portal
            </span>
          )}
        </div>
      </div>

      {/* ── Timeline de andamentos ─────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/40">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="font-bold text-slate-700 text-sm">Linha do Tempo</h2>
              <span className="text-xs text-slate-400">
                {andamentos.length} movimentaç{andamentos.length !== 1 ? "ões" : "ão"}
                {andamentosFiltrados.length !== andamentos.length && (
                  <span className="ml-1 text-blue-500">· {andamentosFiltrados.length} visível{andamentosFiltrados.length !== 1 ? "is" : ""}</span>
                )}
              </span>
            </div>
            {novosCount > 0 && (
              <button
                onClick={marcarTodosLidos}
                disabled={markingLidos}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-xs font-semibold hover:bg-white transition disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                {markingLidos ? "..." : `Marcar ${novosCount} como lido${novosCount !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>

          {/* Filtros */}
          {andamentos.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                value={filtroTexto}
                onChange={e => setFiltroTexto(e.target.value)}
                placeholder="Buscar nos andamentos..."
                className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              />
              <select
                value={filtroTipo}
                onChange={e => setFiltroTipo(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">Todos os tipos</option>
                {TIPOS.map(t => (
                  <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                ))}
              </select>
              {(filtroTexto || filtroTipo) && (
                <button
                  onClick={() => { setFiltroTexto(""); setFiltroTipo(""); }}
                  className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-xs hover:bg-slate-200 transition"
                >
                  Limpar
                </button>
              )}
            </div>
          )}
        </div>

        {/* Timeline body */}
        {andamentos.length === 0 ? (
          <div className="text-center py-14 text-slate-400">
            <svg className="w-10 h-10 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm font-medium">Nenhum andamento registrado</p>
            <p className="text-xs mt-1">Sincronize para buscar movimentações no DataJud</p>
          </div>
        ) : andamentosFiltrados.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <p className="text-sm">Nenhum andamento corresponde ao filtro</p>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-0">
            {andamentosFiltrados.map((a, i) => {
              const isNovo   = !a.notificado;
              const tipo     = classifyAndamento(a.descricao);
              const isLast   = i === andamentosFiltrados.length - 1;
              const andUrl   = consultaUrl(processo.tribunal, processo.numeroProcesso);
              const dataStr  = a.dataAndamento
                ? new Date(a.dataAndamento).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
                : "—";

              // dot color from tipo
              const dotColors = {
                sentenca: "bg-red-500",     despacho:     "bg-slate-400",
                intimacao:"bg-yellow-500",  audiencia:    "bg-purple-500",
                prazo:    "bg-orange-500",  recurso:      "bg-blue-500",
                arquivamento:"bg-slate-300",juntada:      "bg-teal-500",
                outro:    "bg-slate-300",
              };
              const dotColor  = dotColors[tipo.id] || "bg-slate-300";
              const lineColor = isNovo ? "bg-red-200" : "bg-slate-200";

              return (
                <div key={a.id} className="flex gap-4">
                  {/* Coluna da linha + ponto */}
                  <div className="flex flex-col items-center flex-shrink-0 w-8 pt-1">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white ${dotColor} ${isNovo ? "ring-red-300 shadow-sm shadow-red-200" : ""}`} />
                    {!isLast && <div className={`w-px flex-1 mt-1 ${lineColor}`} style={{ minHeight: "1.5rem" }} />}
                  </div>

                  {/* Card do andamento */}
                  <div className={`flex-1 mb-4 rounded-xl border px-4 py-3 transition-colors ${
                    isNovo
                      ? "border-red-200 bg-red-50/40"
                      : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/50"
                  }`}>
                    {/* Cabeçalho: tipo + data + NOVO */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${tipo.color}`}>
                        {tipo.icon} {tipo.label}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums">{dataStr}</span>
                      {isNovo && (
                        <span className="ml-auto px-1.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-600 tracking-wide">NOVO</span>
                      )}
                    </div>

                    {/* Texto do andamento */}
                    <p className="text-sm text-slate-700 leading-relaxed">{a.descricao}</p>

                    {/* Nota inline */}
                    <NotaInline
                      andamentoId={a.id}
                      notaInicial={a.nota}
                      onSaved={novaNota => handleNotaSaved(a.id, novaNota)}
                    />

                    {/* Rodapé: ações */}
                    <div className="flex items-center gap-3 mt-2.5 pt-2 border-t border-slate-100">
                      {andUrl && (
                        <a
                          href={andUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-slate-400 hover:text-blue-600 transition flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          Ver no tribunal
                        </a>
                      )}
                      <button
                        onClick={() => setPrazoModal(a)}
                        className="text-xs text-slate-400 hover:text-orange-600 transition flex items-center gap-1 ml-auto"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Gerar prazo
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Gerar Prazo */}
      {prazoModal && (
        <GerarPrazoModal
          andamento={prazoModal}
          processo={processo}
          onClose={() => setPrazoModal(null)}
        />
      )}

      {/* Modal Importar do Portal */}
      {showImport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 620, padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>Importar movimentações do portal</h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748b" }}>
              Cole o texto copiado do portal do tribunal (ESAJ, PJe, e-SAJ, etc.).<br/>
              Linhas no formato <strong>DD/MM/AAAA&nbsp;&nbsp;Descrição</strong> são reconhecidas automaticamente.
            </p>
            <textarea
              value={importTexto}
              onChange={e => setImportTexto(e.target.value)}
              rows={14}
              placeholder={"15/09/2025   Arquivado Provisoriamente\nCertidão de Cartório - CUSTAS...\n25/07/2025   Certidão de Publicação Expedida\n..."}
              style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontFamily: "monospace", resize: "vertical", outline: "none", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                onClick={() => { setShowImport(false); setImportTexto(""); }}
                style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
              >
                Cancelar
              </button>
              <button
                onClick={importarMovimentos}
                disabled={importing || !importTexto.trim()}
                style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#1e40af", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700, opacity: importing || !importTexto.trim() ? 0.6 : 1 }}
              >
                {importing ? "Importando..." : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Capturar via PJe (segredo de justiça) ──────────────────── */}
      {segredoModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 480, padding: 24, boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔐 Capturar via PJe</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#78716c" }}>
                  Suas credenciais são usadas apenas nesta sessão e <strong>não são salvas</strong>.
                </p>
              </div>
              <button onClick={() => setSegredoModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={capturarSegredo} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Tribunal</label>
                  <select
                    value={segredoTrib}
                    onChange={e => { setSegredoTrib(e.target.value); setSegredoInst("1G"); }}
                    style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}
                    required
                  >
                    {tribunaisPJe.map(t => (
                      <option key={t.key} value={t.key}>{t.nome}</option>
                    ))}
                  </select>
                </div>
                <div style={{ width: 80 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Instância</label>
                  <select
                    value={segredoInst}
                    onChange={e => setSegredoInst(e.target.value)}
                    style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}
                  >
                    {(tribunaisPJe.find(t => t.key === segredoTrib)?.instancias || ["1G"]).map(i => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>CPF / Login</label>
                <input
                  type="text"
                  value={segredoLogin}
                  onChange={e => setSegredoLogin(e.target.value)}
                  placeholder="000.000.000-00"
                  autoComplete="off"
                  style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Senha</label>
                <input
                  type="password"
                  value={segredoSenha}
                  onChange={e => setSegredoSenha(e.target.value)}
                  autoComplete="current-password"
                  style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }}
                  required
                />
              </div>

              {processo?.advogado?.hasPjeSeed ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                  <span style={{ color: "#15803d", fontWeight: 700 }}>&#10003;</span>
                  <span style={{ color: "#166534" }}>SEED PJe configurado — 2FA gerado automaticamente</span>
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                    Token 2FA <span style={{ fontWeight: 400, color: "#9ca3af" }}>(se o portal exigir)</span>
                  </label>
                  <input
                    type="text"
                    value={segredoToken}
                    onChange={e => setSegredoToken(e.target.value)}
                    placeholder="123456"
                    maxLength={8}
                    inputMode="numeric"
                    style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }}
                  />
                  <div style={{ marginTop: 4, fontSize: 11, color: "#9ca3af" }}>
                    Configure o SEED PJe no seu perfil para 2FA automático.
                  </div>
                </div>
              )}

              <p style={{ margin: 0, fontSize: 11, color: "#b45309", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px" }}>
                A captura pode levar até 90 segundos. Aguarde sem fechar esta janela.
              </p>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setSegredoModal(false)}
                  disabled={segredoLoading}
                  style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={segredoLoading || !segredoLogin || !segredoSenha}
                  style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: "#b45309", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700, opacity: segredoLoading || !segredoLogin || !segredoSenha ? 0.6 : 1 }}
                >
                  {segredoLoading ? "Capturando..." : "Capturar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
