import React, { useEffect } from "react";

/**
 * Modal de confirmação genérico — substitui window.confirm.
 *
 * Props:
 *   title      — título do modal (opcional)
 *   message    — texto/JSX da mensagem
 *   onConfirm  — chamado ao clicar em Confirmar
 *   onCancel   — chamado ao clicar em Cancelar ou fechar
 *   confirmLabel — rótulo do botão de confirmar (padrão: "Confirmar")
 *   cancelLabel  — rótulo do botão de cancelar (padrão: "Cancelar")
 *   danger     — se true, botão de confirmar fica vermelho
 */
export default function ConfirmModal({
  title = "Confirmar",
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
}) {
  // Fechar com Escape
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onCancel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
  };
  const box = {
    background: "#fff", borderRadius: 12, padding: "24px 28px",
    width: "min(420px, 94vw)", boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
  };
  const btnConfirm = {
    padding: "8px 20px", borderRadius: 8, border: "none",
    background: danger ? "#dc2626" : "#1e3a5f",
    color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
  };
  const btnCancel = {
    padding: "8px 18px", borderRadius: 8, border: "1px solid #d1d5db",
    background: "#f8fafc", color: "#374151", fontSize: 14, cursor: "pointer",
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={box}>
        <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a", marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, marginBottom: 22, whiteSpace: "pre-wrap" }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={btnCancel}>{cancelLabel}</button>
          <button onClick={onConfirm} style={btnConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
