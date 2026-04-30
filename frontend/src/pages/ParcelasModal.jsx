// src/components/ParcelasModal.jsx
import api from "../api";
import { useToast } from "../components/Toast";

export default function ParcelasModal({ contrato, onClose, onUpdated }) {
  const { addToast, confirmToast } = useToast();

  async function confirmar(parcela) {
    const ok = await confirmToast("Confirmar recebimento desta parcela?");
    if (!ok) return;

    try {
      await api.patch(`/parcelas/${parcela.id}/confirmar`, {});
      addToast("Parcela confirmada!", "success");
      onUpdated();
    } catch (e) {
      addToast("Erro ao confirmar parcela", "error");
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal large">
        <h2>Parcelas – Contrato {contrato.numeroContrato}</h2>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Vencimento</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>

          <tbody>
            {contrato.parcelas.map((p) => (
              <tr key={p.id}>
                <td>{p.numero}</td>
                <td>{(() => { const s = String(p.vencimento || ""); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); const d = m ? new Date(+m[1], +m[2]-1, +m[3], 12) : new Date(s); return Number.isFinite(d.getTime()) ? d.toLocaleDateString("pt-BR") : "—"; })()}</td>
                <td>
                  R$ {Number(p.valorPrevisto).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
                <td>{p.status}</td>
                <td>
                  {p.status === "PREVISTA" && (
                    <button onClick={() => confirmar(p)}>
                      Confirmar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer>
          <button onClick={onClose}>Fechar</button>
        </footer>
      </div>
    </div>
  );
}
