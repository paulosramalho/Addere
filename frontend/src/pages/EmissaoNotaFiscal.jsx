import { useState } from "react";

const CNPJ = "48.744.127/0001-41";
const CODIGO_ACESSO = "tweet352413";

export default function EmissaoNotaFiscal() {
  const [copiado, setCopiado] = useState("");

  async function copiar(valor, campo) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(campo);
    } catch {
      setCopiado("erro");
    } finally {
      window.setTimeout(() => setCopiado(""), 1600);
    }
  }

  return (
    <div className="max-w-lg mx-auto mt-10">
      <h1 className="text-xl font-semibold text-slate-800 mb-6">Emissao de Nota Fiscal</h1>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        <div className="px-6 py-5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Portal NFS-e Belem</span>
          <a
            href="https://notafiscal.belem.pa.gov.br/notafiscal/paginas/portal/#/login"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition"
          >
            Abrir Portal
          </a>
        </div>

        <div className="px-6 py-5 flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-slate-600">CNPJ</span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-slate-800 select-all">{CNPJ}</span>
            <button
              type="button"
              onClick={() => copiar(CNPJ, "cnpj")}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {copiado === "cnpj" ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>

        <div className="px-6 py-5 flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-slate-600">Codigo de Acesso</span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-slate-800 select-all">{CODIGO_ACESSO}</span>
            <button
              type="button"
              onClick={() => copiar(CODIGO_ACESSO, "codigo")}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {copiado === "codigo" ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      </div>

      {copiado === "erro" && (
        <div className="mt-3 text-sm text-red-600">Nao foi possivel copiar automaticamente.</div>
      )}
    </div>
  );
}
