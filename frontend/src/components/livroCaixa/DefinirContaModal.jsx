import React, { useMemo, useState } from "react";

export default function DefinirContaModal({ open, lancamentoId, contas, onClose, onSave }) {
  const [contaId, setContaId] = useState("");

  const options = useMemo(() => contas || [], [contas]);

  if (!open) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h3>Informar conta</h3>
        <div style={{ margin: "8px 0 12px" }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Lançamento:</strong> #{lancamentoId}
          </div>

          <label style={{ display: "block" }}>
            Conta/Local
            <select value={contaId} onChange={(e) => setContaId(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
              <option value="">Selecione...</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancelar</button>
          <button
            onClick={() => onSave?.({ lancamentoId, contaId: Number(contaId) })}
            disabled={!contaId}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 60,
  },
  modal: {
    width: "min(520px, 100%)",
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    border: "1px solid #ddd",
  },
};
