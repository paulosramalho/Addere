import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { brlFromCentavos, formatCpfCnpj } from "../lib/formatters";
import { useToast } from "../components/Toast";

const TIPO_LABEL = { C: "Cliente", F: "Fornecedor", A: "Ambos" };

function clienteLabel(cliente) {
  if (!cliente) return "";
  const doc = cliente.cpfCnpj ? ` - ${formatCpfCnpj(cliente.cpfCnpj)}` : "";
  return `${cliente.nomeRazaoSocial}${doc}`;
}

function Badge({ children, tone = "slate" }) {
  const cls = {
    slate: "border-slate-200 bg-slate-100 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    red: "border-red-200 bg-red-50 text-red-700",
    green: "border-green-200 bg-green-50 text-green-700",
  }[tone] || "border-slate-200 bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function ClienteResumo({ cliente, tone }) {
  if (!cliente) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        Nenhum cadastro selecionado.
      </div>
    );
  }

  return (
    <div className={`rounded-lg border bg-white p-4 ${tone === "red" ? "border-red-200" : "border-blue-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-slate-900">{cliente.nomeRazaoSocial}</div>
          <div className="mt-1 text-sm text-slate-600">{cliente.cpfCnpj ? formatCpfCnpj(cliente.cpfCnpj) : "Sem CPF/CNPJ"}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Badge tone={cliente.ativo ? "green" : "slate"}>{cliente.ativo ? "Ativo" : "Inativo"}</Badge>
          <Badge tone="blue">{TIPO_LABEL[cliente.tipo] || cliente.tipo || "Tipo"}</Badge>
        </div>
      </div>
    </div>
  );
}

function ClientePicker({ label, value, query, onQuery, onSelect, clientes, disabledIds = [], tone }) {
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();

  const filtrados = useMemo(() => {
    const base = q
      ? clientes.filter((cliente) => {
          const nome = String(cliente.nomeRazaoSocial || "").toLowerCase();
          const doc = String(cliente.cpfCnpj || "").replace(/\D/g, "");
          const buscaDoc = q.replace(/\D/g, "");
          return nome.includes(q) || (!!buscaDoc && doc.includes(buscaDoc));
        })
      : clientes;
    return base.filter((cliente) => !disabledIds.includes(cliente.id)).slice(0, 12);
  }, [clientes, disabledIds, q]);

  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700">{label}</label>
      <div className="relative mt-1">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            if (value) onSelect(null);
            onQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Digite nome ou CPF/CNPJ"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              onQuery("");
              setOpen(false);
            }}
            className="absolute right-2 top-2 rounded px-2 text-sm font-semibold text-slate-500 hover:bg-slate-100"
          >
            Limpar
          </button>
        ) : null}
        {open && filtrados.length > 0 ? (
          <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {filtrados.map((cliente) => (
              <button
                key={cliente.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(cliente);
                  onQuery(clienteLabel(cliente));
                  setOpen(false);
                }}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{cliente.nomeRazaoSocial}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone === "red" ? "border-red-200 text-red-700" : "border-blue-200 text-blue-700"}`}>
                    {TIPO_LABEL[cliente.tipo] || cliente.tipo || "Tipo"}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{cliente.cpfCnpj ? formatCpfCnpj(cliente.cpfCnpj) : "Sem CPF/CNPJ"}</div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3">
        <ClienteResumo cliente={value} tone={tone} />
      </div>
    </div>
  );
}

function CountRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{Number(value || 0).toLocaleString("pt-BR")}</span>
    </div>
  );
}

function ConfirmModal({ open, onClose, onConfirm, from, to, preview, loading }) {
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (open) setConfirmText("");
  }, [open]);

  if (!open) return null;

  const canConfirm = confirmText.trim().toUpperCase() === "EXCLUIR";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/45" onClick={loading ? undefined : onClose} />
      <div className="relative w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Confirmar normalização</h2>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-semibold uppercase text-red-700">A - será excluído</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{from?.nomeRazaoSocial}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="text-xs font-semibold uppercase text-blue-700">B - permanecerá</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{to?.nomeRazaoSocial}</div>
            </div>
          </div>

          {preview ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <CountRow label="Lançamentos movidos" value={preview.counts?.lancamentosTotal} />
              <CountRow label="Contratos movidos" value={preview.counts?.contratos} />
              <CountRow label="Conta corrente movida" value={preview.counts?.contaCorrente} />
              <CountRow label="Comprovantes movidos" value={preview.counts?.comprovantes} />
              <CountRow label="Processos movidos" value={preview.counts?.processosTotal} />
              <CountRow label="Boletos movidos" value={preview.counts?.boletosTotal} />
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-semibold text-slate-700">Digite EXCLUIR para confirmar</label>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
              disabled={loading}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || loading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            {loading ? "Normalizando..." : "Mover e apagar A"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NormalizacaoClientesFornecedores() {
  const { addToast } = useToast();
  const [clientes, setClientes] = useState([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [queryA, setQueryA] = useState("");
  const [queryB, setQueryB] = useState("");
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function carregarClientes() {
    setLoadingClientes(true);
    try {
      const data = await apiFetch("/clients?includeInativo=true&limit=2000");
      setClientes(Array.isArray(data) ? data : []);
    } catch (error) {
      addToast(error?.message || "Erro ao carregar clientes/fornecedores.", "error");
    } finally {
      setLoadingClientes(false);
    }
  }

  useEffect(() => {
    carregarClientes();
  }, []);

  useEffect(() => {
    let cancelado = false;
    setPreview(null);
    setLastResult(null);

    if (!a || !b || a.id === b.id) return;

    setLoadingPreview(true);
    apiFetch(`/clients/${a.id}/normalizacao-preview/${b.id}`)
      .then((data) => {
        if (!cancelado) setPreview(data);
      })
      .catch((error) => {
        if (!cancelado) addToast(error?.message || "Erro ao montar prévia.", "error");
      })
      .finally(() => {
        if (!cancelado) setLoadingPreview(false);
      });

    return () => {
      cancelado = true;
    };
  }, [a?.id, b?.id]);

  const podeConfirmar = !!a && !!b && a.id !== b.id && !!preview && !loadingPreview;

  async function confirmarNormalizacao() {
    if (!podeConfirmar) return;
    setSubmitting(true);
    try {
      const result = await apiFetch(`/clients/${a.id}/merge-into/${b.id}`, { method: "POST" });
      setLastResult(result);
      addToast(result?.message || "Normalização concluída.", "success");
      setConfirmOpen(false);
      setA(null);
      setQueryA("");
      setPreview(null);
      await carregarClientes();
    } catch (error) {
      addToast(error?.message || "Erro ao normalizar.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Normalização de Clientes/Fornecedores</h1>
        <p className="mt-1 text-sm text-slate-600">Mover A para B e apagar o cadastro A.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        {loadingClientes ? (
          <div className="py-10 text-center text-sm text-slate-500">Carregando cadastros...</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ClientePicker
              label="A - cadastro que será excluído"
              value={a}
              query={queryA}
              onQuery={setQueryA}
              onSelect={setA}
              clientes={clientes}
              disabledIds={b ? [b.id] : []}
              tone="red"
            />
            <ClientePicker
              label="B - cadastro que permanecerá"
              value={b}
              query={queryB}
              onQuery={setQueryB}
              onSelect={setB}
              clientes={clientes}
              disabledIds={a ? [a.id] : []}
              tone="blue"
            />
          </div>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-slate-900">Prévia</h2>
            {loadingPreview ? (
              <div className="mt-4 text-sm text-slate-500">Calculando impacto...</div>
            ) : preview ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-500">Lançamentos</div>
                  <div className="mt-1 text-xl font-bold text-slate-900">{preview.counts?.lancamentosTotal || 0}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-500">Contratos</div>
                  <div className="mt-1 text-xl font-bold text-slate-900">{preview.counts?.contratos || 0}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-500">Outros vínculos</div>
                  <div className="mt-1 text-xl font-bold text-slate-900">
                    {(preview.counts?.contaCorrente || 0) + (preview.counts?.comprovantes || 0) + (preview.counts?.processosTotal || 0) + (preview.counts?.boletosTotal || 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-500">Saldo inicial</div>
                  <div className="mt-1 text-xl font-bold text-slate-900">{brlFromCentavos(preview.counts?.saldoInicialCent || 0)}</div>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-500">Selecione A e B para calcular a prévia.</div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!podeConfirmar}
            className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 lg:mt-8"
          >
            Confirmar escolha
          </button>
        </div>

        {lastResult ? (
          <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            {lastResult.message}
          </div>
        ) : null}
      </div>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmarNormalizacao}
        from={a}
        to={b}
        preview={preview}
        loading={submitting}
      />
    </div>
  );
}
