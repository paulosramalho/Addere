import { useState } from "react";

const CNPJ = "48.744.127/0001-41";
const CODIGO_ACESSO = "tweet352413";

function CopyIcon({ checked = false }) {
  if (checked) {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 10h8a2 2 0 012 2v6a2 2 0 01-2 2h-8a2 2 0 01-2-2v-6a2 2 0 012-2z" />
    </svg>
  );
}

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
              className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border text-slate-700 hover:bg-slate-50 ${
                copiado === "cnpj" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white"
              }`}
              title={copiado === "cnpj" ? "CNPJ copiado" : "Copiar CNPJ"}
              aria-label={copiado === "cnpj" ? "CNPJ copiado" : "Copiar CNPJ"}
            >
              <CopyIcon checked={copiado === "cnpj"} />
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
              className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border text-slate-700 hover:bg-slate-50 ${
                copiado === "codigo" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white"
              }`}
              title={copiado === "codigo" ? "Codigo copiado" : "Copiar codigo de acesso"}
              aria-label={copiado === "codigo" ? "Codigo copiado" : "Copiar codigo de acesso"}
            >
              <CopyIcon checked={copiado === "codigo"} />
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
