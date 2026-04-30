import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";

export default function Seguranca2FA({ user }) {
  const { addToast } = useToast();
  const [totpEnabled, setTotpEnabled] = useState(null); // null = carregando
  const [step, setStep] = useState("idle"); // "idle" | "setup" | "disable"
  const [qrUrl, setQrUrl] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch("/auth/2fa/status")
      .then((d) => setTotpEnabled(d.totpEnabled))
      .catch(() => setTotpEnabled(false));
  }, []);

  async function startSetup() {
    setLoading(true);
    try {
      const resp = await apiFetch("/auth/2fa/setup", { method: "POST" });
      setQrUrl(resp.qrCodeUrl);
      setManualKey(resp.secret);
      setCode("");
      setStep("setup");
    } catch (e) {
      addToast(e?.message || "Erro ao iniciar configuração 2FA.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function verifySetup(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/auth/2fa/verify-setup", {
        method: "POST",
        body: { code: code.replace(/\s/g, "") },
      });
      addToast("2FA ativado com sucesso!", "success");
      setTotpEnabled(true);
      setStep("idle");
      setCode("");
      setQrUrl("");
      setManualKey("");
    } catch (e) {
      addToast(e?.message || "Código inválido. Tente novamente.", "error");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function disable2FA(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/auth/2fa/disable", {
        method: "POST",
        body: { code: code.replace(/\s/g, "") },
      });
      addToast("2FA desativado.", "success");
      setTotpEnabled(false);
      setStep("idle");
      setCode("");
    } catch (e) {
      addToast(e?.message || "Código inválido. Tente novamente.", "error");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  if (totpEnabled === null) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <p className="text-slate-500 text-sm">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Segurança — Autenticação em 2 Fatores</h1>
        <p className="mt-1 text-sm text-slate-500">
          Proteja sua conta com um código gerado pelo Google Authenticator ou app similar (TOTP).
        </p>
      </div>

      {/* Status atual */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl
            ${totpEnabled ? "bg-green-100" : "bg-slate-100"}`}>
            {totpEnabled ? "🔐" : "🔓"}
          </div>
          <div>
            <div className="font-semibold text-slate-900 text-sm">
              Autenticação em 2 Fatores
            </div>
            <div className={`text-xs font-medium ${totpEnabled ? "text-green-700" : "text-slate-500"}`}>
              {totpEnabled ? "Ativa" : "Desativada"}
            </div>
          </div>
        </div>

        {step === "idle" && (
          <>
            {!totpEnabled ? (
              <button
                onClick={startSetup}
                disabled={loading}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? "Aguarde…" : "Ativar 2FA"}
              </button>
            ) : (
              <button
                onClick={() => { setStep("disable"); setCode(""); }}
                className="rounded-xl border border-red-300 text-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-50"
              >
                Desativar
              </button>
            )}
          </>
        )}
      </div>

      {/* Setup wizard */}
      {step === "setup" && (
        <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm space-y-5">
          <h2 className="font-semibold text-slate-900">Configurar Autenticador</h2>

          <div className="space-y-2 text-sm text-slate-600">
            <p><span className="font-semibold text-slate-900">1.</span> Abra o Google Authenticator (ou Authy) no seu celular.</p>
            <p><span className="font-semibold text-slate-900">2.</span> Toque em <strong>+</strong> e escaneie o QR code abaixo.</p>
            <p><span className="font-semibold text-slate-900">3.</span> Digite o código de 6 dígitos gerado pelo app.</p>
          </div>

          {qrUrl && (
            <div className="flex flex-col items-center gap-3">
              <img src={qrUrl} alt="QR Code 2FA" className="w-44 h-44 rounded-xl border border-slate-200 shadow" />
              {manualKey && (
                <div className="text-center">
                  <div className="text-xs text-slate-500 mb-1">Ou insira a chave manualmente:</div>
                  <code className="bg-slate-100 rounded px-3 py-1 text-xs font-mono text-slate-700 break-all select-all">
                    {manualKey}
                  </code>
                </div>
              )}
            </div>
          )}

          <form onSubmit={verifySetup} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Código de verificação</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-center text-xl font-mono tracking-[0.4em] outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                required
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? "Verificando…" : "Confirmar e Ativar"}
              </button>
              <button
                type="button"
                onClick={() => { setStep("idle"); setCode(""); setQrUrl(""); setManualKey(""); }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Disable flow */}
      {step === "disable" && (
        <div className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Desativar 2FA</h2>
          <p className="text-sm text-slate-600">
            Para confirmar, insira o código atual gerado pelo seu aplicativo autenticador.
          </p>
          <form onSubmit={disable2FA} className="space-y-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-center text-xl font-mono tracking-[0.4em] outline-none focus:ring-2 focus:ring-red-300"
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              required
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {loading ? "Desativando…" : "Confirmar Desativação"}
              </button>
              <button
                type="button"
                onClick={() => { setStep("idle"); setCode(""); }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Info box */}
      {step === "idle" && !totpEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Recomendado para administradores.</strong> Com o 2FA ativado, além da senha será necessário
          um código temporário gerado pelo seu celular a cada login.
        </div>
      )}
    </div>
  );
}
