import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";

export default function LivroCaixaEmissao() {
  const { addToast } = useToast();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [pendCount, setPendCount] = useState(0);
  const [pendDetail, setPendDetail] = useState({ semConta: 0, previstos: 0 });
  const [loading, setLoading] = useState(false);

  const competenciaLabel = useMemo(() => `${String(mes).padStart(2, "0")}/${ano}`, [ano, mes]);

  async function refreshPend() {
    setLoading(true);
    try {
      const p = await apiFetch(`/livro-caixa/pendencias?ano=${ano}&mes=${mes}`);
      setPendCount((p?.pendencias || []).length);
      setPendDetail({ semConta: p?.semConta ?? 0, previstos: p?.previstos ?? 0 });
    } catch (e) {
      addToast(e?.message || "Erro ao carregar pendências", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshPend();
  }, [ano, mes]);

  async function emitir() {
    if (pendCount > 0) {
      addToast("Resolva as pendências antes de emitir o Livro Caixa", "error");
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("addere_token");
      const baseUrl = import.meta.env.VITE_API_URL || "https://addere.onrender.com/api";
      const url = `${baseUrl}/livro-caixa/pdf?ano=${ano}&mes=${mes}`;

      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: "Erro ao gerar PDF" }));
        throw new Error(err.message || "Erro ao gerar PDF");
      }

      // Download do PDF
      const blob = await resp.blob();
      const mesesNomes = [
        "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
      ];
      const mesNome = mesesNomes[mes] || `Mes${mes}`;
      const fileName = `Livro_Caixa_${ano}_${String(mes).padStart(2, "0")}_${mesNome}.pdf`;

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      addToast("Livro Caixa gerado com sucesso!", "success");
    } catch (e) {
      addToast(e?.message || "Erro ao emitir Livro Caixa", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-xl font-semibold text-slate-900">Livro Caixa — Emissão</h2>
          <p className="mt-1 text-sm text-slate-600">Selecione o período e emita o Livro Caixa</p>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Ano</label>
              <Tooltip content="Ano da competência">
                <input
                  type="number"
                  value={ano}
                  onChange={(e) => setAno(Number(e.target.value))}
                  className="w-28 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                />
              </Tooltip>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mês</label>
              <Tooltip content="Mês da competência (1-12)">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={mes}
                  onChange={(e) => setMes(Number(e.target.value))}
                  className="w-20 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                />
              </Tooltip>
            </div>

            <div className="flex items-end">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
                <div className="text-xs text-slate-600">Competência</div>
                <div className="text-lg font-bold text-slate-900">{competenciaLabel}</div>
              </div>
            </div>

            <div className="flex items-end">
              <Tooltip content="Recarregar contagem de pendências">
                <button
                  onClick={refreshPend}
                  disabled={loading}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition disabled:opacity-70"
                >
                  {loading ? "Carregando…" : "Recarregar"}
                </button>
              </Tooltip>
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${pendCount > 0 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
            <div className="flex items-center gap-3">
              <div className="text-2xl">
                {pendCount > 0 ? "⚠️" : "✅"}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">
                  Pendências do mês: <span className="text-lg">{pendCount}</span>
                </div>
                {pendCount > 0 ? (
                  <div className="mt-1 text-xs text-amber-700 space-y-0.5">
                    {pendDetail.semConta > 0 && (
                      <div>• {pendDetail.semConta} lançamento{pendDetail.semConta > 1 ? "s" : ""} sem conta bancária informada — use "Informar conta" nos Lançamentos.</div>
                    )}
                    {pendDetail.previstos > 0 && (
                      <div>• {pendDetail.previstos} lançamento{pendDetail.previstos > 1 ? "s" : ""} ainda <strong>Previsto</strong> (não efetivado) — efetive ou remova nos Lançamentos.</div>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-green-700">
                    Tudo pronto! Você pode emitir o Livro Caixa.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Tooltip content={pendCount > 0 ? "Resolva as pendências antes de emitir" : "Gerar PDF do Livro Caixa"}>
              <button
                onClick={emitir}
                disabled={loading || pendCount > 0}
                className={`rounded-xl px-6 py-2.5 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  pendCount > 0
                    ? "bg-slate-300 text-slate-600"
                    : "bg-blue-700 text-white hover:bg-blue-800"
                }`}
              >
                {loading ? "Emitindo…" : "Emitir Livro Caixa"}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}