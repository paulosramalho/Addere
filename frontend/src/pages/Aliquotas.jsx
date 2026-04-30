import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";

/* utils */
function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function formatBpAsPercentString(bpInt) {
  const bp = Math.max(0, Number(bpInt) || 0); // bp = centésimos de %
  const s = (bp / 100).toFixed(2);
  return s.replace(".", ",");
}

function inputToBpDigits(raw) {
  // pega só dígitos; limita para caber em 0..100,00% => 0..10000 bp
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  if (!Number.isFinite(n)) return 0;
  return Math.min(n, 10000);
}

function normalizePercentOnBlur(raw) {
  // normaliza para vírgula e remove vírgula final
  const v = String(raw ?? "").trim();
  if (!v) return "";

  let s = v.replace(/[^\d.,]/g, "");
  s = s.replace(".", ",");

  // se terminou com separador, remove
  if (s.endsWith(",") || s.endsWith(".")) s = s.slice(0, -1);

  // se tem decimal, limita 2 casas
  const parts = s.split(",");
  const i = (parts[0] || "").replace(/\D/g, "").slice(0, 3);
  const d = (parts[1] || "").replace(/\D/g, "").slice(0, 2);

  if (!d) return i;
  return `${i},${d}`;
}

function percentToBp(str) {
  // "12,34" -> 1234
  const s = String(str || "").trim().replace(".", ",");
  if (!s) return NaN;
  const [iRaw, dRaw = ""] = s.split(",");
  const i = Number(iRaw || "0");
  if (!Number.isFinite(i)) return NaN;
  const d2 = (dRaw + "00").slice(0, 2);
  const d = Number(d2);
  if (!Number.isFinite(d)) return NaN;
  return i * 100 + d;
}

function bpToPercent0(bp) {
  const n = Number(bp || 0);
  const v = (n / 100).toFixed(2);
  return v.replace(".", ",");
}

/* UI atoms (simples) */
function Button({ className = "", ...props }) {
  return (
    <button
      {...props}
      className={`rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 ${className}`}
    />
  );
}

function PrimaryButton({ className = "", ...props }) {
  return (
    <button
      {...props}
      className={`rounded-xl bg-blue-700 text-white px-3 py-2 text-sm font-semibold hover:bg-blue-800 disabled:opacity-60 ${className}`}
    />
  );
}

function DangerButton({ className = "", ...props }) {
  return (
    <button
      {...props}
      className={`rounded-xl bg-red-600 text-white px-3 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60 ${className}`}
    />
  );
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
          <div className="font-semibold text-slate-900">{title}</div>
          <button className="text-slate-500 hover:text-slate-800" onClick={onClose} type="button">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function AliquotasPage() {
  const { addToast, confirmToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ mes: "", ano: "", percentual: "" });
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch("/aliquotas", { method: "GET" });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      addToast(e?.message || "Falha ao carregar alíquotas.", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = String(q || "").toLowerCase().trim();
    if (!s) return rows;
    return rows.filter((r) => {
      const key = `${String(r.mes).padStart(2, "0")}/${String(r.ano)} ${bpToPercent0(r.percentualBp)}`
        .toLowerCase();
      return key.includes(s);
    });
  }, [rows, q]);

  function openCreate() {
    setEditing(null);
    setError("");
    setForm({ mes: "", ano: "", percentual: "" });
    setModalOpen(true);
  }

  function openEdit(r) {
    setEditing(r);
    setError("");
    setForm({
      mes: String(r.mes).padStart(2, "0"),
      ano: String(r.ano),
      percentual: bpToPercent0(r.percentualBp),
    });
    setModalOpen(true);
  }

  async function save() {
    setError("");

    const mes = Number(onlyDigits(form.mes));
    const ano = Number(onlyDigits(form.ano));
    const percentualBp = percentToBp(form.percentual);

    if (!Number.isFinite(mes) || mes < 1 || mes > 12) { addToast("Mês inválido (01 a 12).", "warning"); return setError("Mês inválido (01 a 12)."); }
    if (!Number.isFinite(ano) || ano < 1900 || ano > 2100) { addToast("Ano inválido (AAAA).", "warning"); return setError("Ano inválido (AAAA)."); }
    if (!Number.isFinite(percentualBp) || percentualBp < 0 || percentualBp > 10000) {
      addToast("Percentual inválido (0,00 a 100,00).", "warning");
      return setError("Percentual inválido (0,00 a 100,00).");
    }

    try {
      if (editing?.id) {
        await apiFetch(`/aliquotas/${editing.id}`, {
          method: "PUT",
          body: { mes, ano, percentualBp },
        });
        addToast("Alíquota atualizada com sucesso!", "success");
      } else {
        await apiFetch(`/aliquotas`, {
          method: "POST",
          body: { mes, ano, percentualBp },
        });
        addToast("Alíquota criada com sucesso!", "success");
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      const msg = e?.message || "Falha ao salvar.";
      setError(msg);
      addToast(msg, "error");
    }
  }

  async function remove(r) {
    const ok = await confirmToast(`Excluir alíquota ${String(r.mes).padStart(2, "0")}/${r.ano}?`);
    if (!ok) return;
    try {
      await apiFetch(`/aliquotas/${r.id}`, { method: "DELETE" });
      addToast("Alíquota excluída com sucesso!", "success");
      await load();
    } catch (e) {
      addToast(e?.message || "Falha ao excluir alíquota.", "error");
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div>
          {/* Header do card */}
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xl font-semibold text-slate-900">Alíquotas</div>

            <Tooltip content="Criar nova alíquota">
              <PrimaryButton type="button" onClick={openCreate}>
                + Novo
              </PrimaryButton>
            </Tooltip>
          </div>

          {/* Conteúdo do card */}
          <div className="p-5 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por mês/ano ou percentual…"
                className="w-full md:flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              />

              <div className="flex items-center gap-2 whitespace-nowrap justify-end">
                <div className="text-sm text-slate-600">
                  {loading ? "Carregando…" : `${filtered.length} item(ns)`}
                </div>
                <Tooltip content="Atualizar lista de alíquotas">
                  <Button type="button" onClick={load} disabled={loading}>
                    Atualizar
                  </Button>
                </Tooltip>
              </div>
            </div>

            {/* tabela continua aqui embaixo como já está */}

            <div className="overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-[700px] w-full text-sm">
                <thead className="bg-white text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Mês</th>
                    <th className="text-left px-4 py-3 font-semibold">Ano</th>
                    <th className="text-right px-4 py-3 font-semibold">Percentual (%)</th>
                    <th className="text-right px-4 py-3 font-semibold">Ações</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200 bg-white">
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3">{String(r.mes).padStart(2, "0")}</td>
                      <td className="px-4 py-3">{r.ano}</td>
                      <td className="px-4 py-3 text-right">{bpToPercent0(r.percentualBp)}%</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Tooltip content="Editar esta alíquota">
                            <Button type="button" onClick={() => openEdit(r)}>
                              Editar
                            </Button>
                          </Tooltip>
                          <Tooltip content="Excluir esta alíquota">
                            <DangerButton type="button" onClick={() => remove(r)}>
                              Excluir
                            </DangerButton>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!filtered.length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        Nenhuma alíquota cadastrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Editar Alíquota" : "Nova Alíquota"}
        onClose={() => setModalOpen(false)}
      >
        {error ? (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1">Mês (MM)</label>
            <input
              value={form.mes}
              onChange={(e) => setForm((s) => ({ ...s, mes: onlyDigits(e.target.value).slice(0, 2) }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="01"
              inputMode="numeric"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1">Ano (AAAA)</label>
            <input
              value={form.ano}
              onChange={(e) => setForm((s) => ({ ...s, ano: onlyDigits(e.target.value).slice(0, 4) }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="2026"
              inputMode="numeric"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1">Percentual (%)</label>
            <input
              value={form.percentual}
              onChange={(e) => {
                const bp = inputToBpDigits(e.target.value);          // ex: "123" => 123 bp
                const str = formatBpAsPercentString(bp);            // => "1,23"
                setForm((s) => ({ ...s, percentual: str }));
              }}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="0,00"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" onClick={() => setModalOpen(false)}>
            Cancelar
          </Button>
          <PrimaryButton type="button" onClick={save}>
            Salvar
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
}