// src/pages/UtilitariosDisparoEmail.jsx
import React, { useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

function Chip({ label, ok }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        ok
          ? "bg-green-100 text-green-800"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {ok ? "✓" : "—"} {label}
    </span>
  );
}

function Secao({ titulo, dados }) {
  if (!dados) return null;

  const { enviado, motivo, erro, destinatarios, contagens, totalItens } = dados;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800">{titulo}</h3>
        <Chip label={enviado ? "Enviado" : "Não enviado"} ok={enviado} />
      </div>

      {erro && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>
      )}
      {motivo && (
        <p className="text-sm text-slate-500 italic">{motivo}</p>
      )}

      {enviado && destinatarios && (
        <div className="text-sm text-slate-600 space-y-1">
          <p>
            <span className="font-medium">Destinatário(s):</span>{" "}
            {destinatarios.join(", ")}
          </p>
          {contagens && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
              <li>Entradas D-1: <strong>{contagens.entradasD1}</strong></li>
              <li>Entradas D-7: <strong>{contagens.entradasD7}</strong></li>
              <li>Saídas D-1: <strong>{contagens.saidasD1}</strong></li>
              <li>Saídas D-7: <strong>{contagens.saidasD7}</strong></li>
              <li>Repasses pendentes: <strong>{contagens.repassesPendentes}</strong></li>
            </ul>
          )}
          {totalItens !== undefined && (
            <p className="text-xs text-slate-500 mt-2">
              Lançamentos vencidos: <strong>{totalItens}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function UtilitariosDisparoEmail({ user }) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [ts, setTs] = useState(null);
  const [loadingConfirmacao, setLoadingConfirmacao] = useState(false);
  const [resultadoConfirmacao, setResultadoConfirmacao] = useState(null);
  const [loadingCliente, setLoadingCliente] = useState(false);
  const [resultadoCliente, setResultadoCliente] = useState(null);

  async function dispararTesteCliente() {
    if (loadingCliente) return;
    setLoadingCliente(true);
    setResultadoCliente(null);
    try {
      const data = await apiFetch("/admin/teste-emails-cliente", { method: "POST" });
      setResultadoCliente(data);
      addToast(
        data.enviados?.length
          ? `${data.enviados.length} e-mail(s) enviados para ${data.destinatario}`
          : "Nenhum e-mail enviado.",
        data.ok ? "success" : "error"
      );
    } catch (e) {
      addToast(e?.message || "Erro ao enviar.", "error");
    } finally {
      setLoadingCliente(false);
    }
  }

  async function dispararConfirmacao() {
    if (loadingConfirmacao) return;
    setLoadingConfirmacao(true);
    setResultadoConfirmacao(null);
    try {
      const data = await apiFetch("/admin/teste-confirmacao-email", { method: "POST" });
      setResultadoConfirmacao(data);
      addToast(
        data.enviados?.length ? `E-mail enviado para ${data.enviados.join(" e ")}` : "Nenhum e-mail enviado.",
        data.enviados?.length ? "success" : "error"
      );
    } catch (e) {
      addToast(e?.message || "Erro ao enviar.", "error");
    } finally {
      setLoadingConfirmacao(false);
    }
  }

  async function disparar() {
    if (loading) return;
    setLoading(true);
    setResultado(null);
    try {
      const data = await apiFetch("/admin/disparo-teste-email", { method: "POST" });
      setResultado(data.resultado);
      setTs(data.ts);
      const algumEnviado = data.resultado?.alertas?.enviado || data.resultado?.vencidos?.enviado;
      addToast(
        algumEnviado ? "E-mails disparados com sucesso!" : "Nenhum e-mail enviado — sem dados para reportar.",
        algumEnviado ? "success" : "info"
      );
    } catch (e) {
      addToast(e?.message || "Erro ao disparar e-mails.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Disparo de E-mails (Teste)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Executa imediatamente a mesma lógica do scheduler diário das 8h — útil para verificar se os
          e-mails chegam e quais dados estão sendo reportados.
        </p>
      </div>

      {/* ── Confirmação de Serviço ────────────────────────────── */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">Confirmação de Serviço</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Envia um e-mail de teste para <strong>financeiro@amandaramalho.adv.br</strong> e{" "}
            <strong>paulosramalho@gmail.com</strong> — útil para verificar o domínio de envio.
          </p>
        </div>
        <button
          onClick={dispararConfirmacao}
          disabled={loadingConfirmacao}
          className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 transition"
        >
          {loadingConfirmacao ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Enviando…
            </>
          ) : (
            "Enviar Confirmação de Serviço"
          )}
        </button>
        {resultadoConfirmacao && (
          <div className="text-sm text-slate-600 space-y-1 pt-1">
            {resultadoConfirmacao.enviados?.length > 0 && (
              <p>✅ Enviado para: <strong>{resultadoConfirmacao.enviados.join(", ")}</strong></p>
            )}
            {resultadoConfirmacao.erros?.map((e, i) => (
              <p key={i} className="text-red-600">❌ {e.to}: {e.erro}</p>
            ))}
            {resultadoConfirmacao.ts && (
              <p className="text-xs text-slate-400">
                {new Date(resultadoConfirmacao.ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Simulação e-mails ao cliente ─────────────────────── */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">Simulação — E-mails ao Cliente</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Envia os 3 templates de cliente (vencimento D‑1/D‑7, atraso e confirmação de recebimento)
            com dados fictícios para <strong>paulosramalho@gmail.com</strong>.
          </p>
        </div>
        <button
          onClick={dispararTesteCliente}
          disabled={loadingCliente}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          {loadingCliente ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Enviando…
            </>
          ) : (
            "Enviar simulação ao cliente"
          )}
        </button>
        {resultadoCliente && (
          <div className="text-sm text-slate-600 space-y-1 pt-1">
            <p>Destinatário: <strong>{resultadoCliente.destinatario}</strong></p>
            {resultadoCliente.enviados?.map(t => (
              <p key={t} className="text-green-700">✅ {t}</p>
            ))}
            {resultadoCliente.erros?.map((e, i) => (
              <p key={i} className="text-red-600">❌ {e.tipo}: {e.erro}</p>
            ))}
            {resultadoCliente.ts && (
              <p className="text-xs text-slate-400">
                {new Date(resultadoCliente.ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Scheduler diário ─────────────────────────────────── */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Os e-mails serão enviados de verdade para todos os admins ativos. O assunto virá
        prefixado com <strong>[TESTE]</strong> para distinguir dos envios automáticos.
      </div>

      <button
        onClick={disparar}
        disabled={loading}
        className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50 transition"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Disparando…
          </>
        ) : (
          "Disparar e-mails agora"
        )}
      </button>

      {resultado && (
        <div className="space-y-4">
          {ts && (
            <p className="text-xs text-slate-400">
              Executado em:{" "}
              {new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}
            </p>
          )}
          <Secao titulo="Alertas D-7 / D-1" dados={resultado.alertas} />
          <Secao titulo="Vencidos em Aberto" dados={resultado.vencidos} />
        </div>
      )}
    </div>
  );
}
