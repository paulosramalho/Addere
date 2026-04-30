// src/pages/LogOperacoes.jsx
import React, { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { maskPhoneBR } from "../lib/validators";

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ACAO_LABELS = {
  SECRETARIA_EDITAR_CLIENTE: "Edição de Cliente",
  SECRETARIA_ROLLBACK_CLIENTE: "Rollback de Cliente",
};

const CAMPO_LABELS = { telefone: "Telefone", email: "E-mail" };

function fmtCampo(campo, valor) {
  if (!valor) return "—";
  if (campo === "telefone") return maskPhoneBR(String(valor));
  return String(valor);
}

function Badge({ children, color = "slate" }) {
  const map = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${map[color] || map.slate}`}>
      {children}
    </span>
  );
}

function RollbackModal({ log, onClose, onSuccess }) {
  const { addToast } = useToast();
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(false);

  const antes = log?.dadosAntes || {};
  const depois = log?.dadosDepois || {};
  const campos = Object.keys(antes).filter((k) => antes[k] !== depois[k]);

  useEffect(() => {
    // Pre-select all changed fields
    const init = {};
    campos.forEach((c) => (init[c] = true));
    setSelected(init);
  }, [log?.id]);

  async function handleRollback() {
    const camposSelecionados = Object.keys(selected).filter((k) => selected[k]);
    if (!camposSelecionados.length) {
      addToast("Selecione pelo menos um campo para reverter.", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/log-operacoes/${log.id}/rollback`, {
        method: "POST",
        body: { campos: camposSelecionados },
      });
      addToast(`Rollback realizado: ${res.camposRevertidos?.join(", ")}`, "success");
      onSuccess?.();
      onClose();
    } catch (e) {
      addToast(e?.message || "Falha ao fazer rollback.", "error");
    } finally {
      setLoading(false);
    }
  }

  if (!log) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="text-base font-semibold text-slate-900">Rollback — {log.entidadeNome || `Cliente #${log.entidadeId}`}</div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            Selecione os campos que deseja reverter ao estado anterior (operação de <strong>{fmtDate(log.createdAt)}</strong>):
          </p>

          {campos.length === 0 ? (
            <div className="text-sm text-slate-500">Nenhuma alteração detectada neste log.</div>
          ) : (
            <div className="space-y-2">
              {campos.map((campo) => (
                <label
                  key={campo}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 cursor-pointer hover:bg-slate-100"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    checked={!!selected[campo]}
                    onChange={(e) => setSelected((s) => ({ ...s, [campo]: e.target.checked }))}
                  />
                  <div className="flex-1 text-sm">
                    <div className="font-semibold text-slate-800">{CAMPO_LABELS[campo] || campo}</div>
                    <div className="mt-1 flex gap-4 text-xs">
                      <span className="text-slate-500">
                        Estava: <span className="text-red-600 line-through">{fmtCampo(campo, antes[campo])}</span>
                      </span>
                      <span className="text-slate-500">
                        Foi para: <span className="text-green-700 font-semibold">{fmtCampo(campo, depois[campo])}</span>
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-amber-700">
                      Reverte para: <strong>{fmtCampo(campo, antes[campo])}</strong>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            onClick={handleRollback}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            disabled={loading || campos.length === 0}
          >
            {loading ? "Revertendo..." : "Reverter"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LogOperacoesPage({ user }) {
  const { addToast } = useToast();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [rollbackLog, setRollbackLog] = useState(null);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/log-operacoes?page=${page}&limit=${limit}`);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (e) {
      addToast(e?.message || "Falha ao carregar log.", "error");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xl font-semibold text-slate-900">Log de Operações</div>
          <div className="mt-2 text-sm text-slate-600">Acesso restrito a administradores.</div>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold text-slate-900">Log de Operações</div>
            <div className="mt-1 text-sm text-slate-500">
              Operações realizadas pela Secretária Virtual — {total} registro{total !== 1 ? "s" : ""}
            </div>
          </div>
          <button
            onClick={load}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            disabled={loading}
          >
            Atualizar
          </button>
        </div>

        <div className="overflow-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Quem</th>
                <th className="text-left px-4 py-3 font-semibold">Quando</th>
                <th className="text-left px-4 py-3 font-semibold">Operação</th>
                <th className="text-left px-4 py-3 font-semibold">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold">Alterações</th>
                <th className="text-right px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.map((log) => {
                const antes = log.dadosAntes || {};
                const depois = log.dadosDepois || {};
                const camposAlterados = Object.keys(antes).filter((k) => antes[k] !== depois[k]);
                const isRollback = log.acao === "SECRETARIA_ROLLBACK_CLIENTE";

                return (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{log.usuario?.nome || "—"}</div>
                      <div className="text-xs text-slate-500">{log.usuario?.email || ""}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge color={isRollback ? "amber" : "blue"}>
                        {ACAO_LABELS[log.acao] || log.acao}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{log.entidadeNome || `#${log.entidadeId}`}</td>
                    <td className="px-4 py-3">
                      {camposAlterados.length === 0 ? (
                        <span className="text-slate-400 text-xs">—</span>
                      ) : (
                        <div className="space-y-1">
                          {camposAlterados.map((campo) => (
                            <div key={campo} className="text-xs">
                              <span className="font-semibold text-slate-700">{CAMPO_LABELS[campo] || campo}:</span>{" "}
                              <span className="text-red-500 line-through">{fmtCampo(campo, antes[campo])}</span>{" "}
                              <span className="text-slate-400">→</span>{" "}
                              <span className="text-green-700 font-semibold">{fmtCampo(campo, depois[campo])}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isRollback && camposAlterados.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setRollbackLog(log)}
                          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Reverter
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!logs.length && (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={6}>
                    {loading ? "Carregando..." : "Nenhuma operação registrada."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {rollbackLog && (
        <RollbackModal
          log={rollbackLog}
          onClose={() => setRollbackLog(null)}
          onSuccess={load}
        />
      )}
    </div>
  );
}
