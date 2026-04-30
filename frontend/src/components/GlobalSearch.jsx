// src/components/GlobalSearch.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";

function onlyDigits(v) { return String(v || "").replace(/\D/g, ""); }
function maskCpfCnpj(v = "") {
  const d = onlyDigits(v);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  }
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Debounce search
  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setResults(null); setOpen(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await apiFetch(`/busca-global?q=${encodeURIComponent(q.trim())}`);
        setResults(d);
        setOpen(true);
      } catch (err) { console.error("GlobalSearch:", err); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Fechar ao clicar fora
  useEffect(() => {
    function handle(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Atalho Ctrl+K / Cmd+K
  useEffect(() => {
    function handle(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);

  function go(path) {
    setQ("");
    setResults(null);
    setOpen(false);
    navigate(path);
  }

  const hasResults = results && (
    results.clientes?.length || results.contratos?.length || results.advogados?.length
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Buscar… (Ctrl+K)"
          className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 focus:bg-white transition-all placeholder-slate-400"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && (
        <div className="absolute right-0 left-0 top-full mt-1 z-50 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-h-80 overflow-y-auto">
          {!hasResults ? (
            <div className="px-4 py-6 text-center text-xs text-slate-400">
              Nenhum resultado para "{q}"
            </div>
          ) : (
            <>
              {results.clientes?.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-100">
                    Clientes
                  </div>
                  {results.clientes.map(c => (
                    <button key={c.id} onClick={() => go(`/clientes?busca=${encodeURIComponent(c.nomeRazaoSocial)}`)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                      <span className="text-base">👤</span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 truncate">{c.nomeRazaoSocial}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{maskCpfCnpj(c.cpfCnpj)}</div>
                      </div>
                      {!c.ativo && <span className="ml-auto text-[9px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 shrink-0">Inativo</span>}
                    </button>
                  ))}
                </div>
              )}

              {results.contratos?.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-100">
                    Contratos
                  </div>
                  {results.contratos.map(c => (
                    <button key={c.id} onClick={() => go(`/contratos/${c.id}`)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                      <span className="text-base">📄</span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 truncate">{c.numeroContrato}</div>
                        <div className="text-[10px] text-slate-400 truncate">{c.cliente?.nomeRazaoSocial}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {results.advogados?.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-100">
                    Advogados
                  </div>
                  {results.advogados.map(a => (
                    <button key={a.id} onClick={() => go(`/advogados?busca=${encodeURIComponent(a.nome)}`)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                      <span className="text-base">⚖️</span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 truncate">{a.nome}</div>
                        {a.oab && <div className="text-[10px] text-slate-400">OAB: {a.oab}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
