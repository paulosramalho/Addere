export default function EmissaoNotaFiscal() {
  return (
    <div className="max-w-lg mx-auto mt-10">
      <h1 className="text-xl font-semibold text-slate-800 mb-6">Emissão de Nota Fiscal</h1>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        <div className="px-6 py-5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Portal NFS-e Belém</span>
          <a
            href="https://notafiscal.belem.pa.gov.br/notafiscal/paginas/portal/#/login"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition"
          >
            Abrir Portal →
          </a>
        </div>

        <div className="px-6 py-5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">CNPJ</span>
          <span className="font-mono text-sm text-slate-800 select-all">27.678.566/0001-23</span>
        </div>

        <div className="px-6 py-5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Código de Acesso</span>
          <span className="font-mono text-sm text-slate-800 select-all">231208</span>
        </div>
      </div>
    </div>
  );
}
