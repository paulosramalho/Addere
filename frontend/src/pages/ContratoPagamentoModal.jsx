// src/components/ContratoPagamentoModal.jsx
import { useEffect, useState } from "react";
import api from "../api";
import { useToast } from "./Toast";
import { Tooltip } from "./Tooltip";

export default function ContratoPagamentoModal({ onClose, onSaved }) {
  const { addToast } = useToast();

  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    clienteId: "",
    numeroContrato: "",
    valorTotal: "",
    formaPagamento: "AVISTA",
    observacoes: "",
  });

  useEffect(() => {
    loadClientes();
  }, []);

  async function loadClientes() {
    try {
      const response = await api.get("/clientes");
      setClientes(response.data || []);
    } catch (e) {
      addToast("Erro ao carregar clientes", "error");
    }
  }

  async function salvar() {
    if (!form.clienteId) {
      addToast("Selecione o cliente", "error");
      return;
    }

    if (!form.numeroContrato.trim()) {
      addToast("Informe o número do contrato", "error");
      return;
    }

    if (!form.valorTotal.trim()) {
      addToast("Informe o valor total", "error");
      return;
    }

    try {
      setLoading(true);
      await api.post("/contratos", form);
      addToast("Contrato criado com sucesso!", "success");
      if (typeof onSaved === "function") onSaved();
    } catch (e) {
      addToast(e.response?.data?.message || "Erro ao salvar contrato", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Novo Contrato de Pagamento</h2>

        <Tooltip content="Selecione o cliente vinculado a este contrato">
          <select
            value={form.clienteId}
            onChange={(e) => setForm({ ...form, clienteId: e.target.value })}
            disabled={loading}
          >
            <option value="">Selecione o cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nomeRazaoSocial}
              </option>
            ))}
          </select>
        </Tooltip>

        <Tooltip content="Número de identificação do contrato">
          <input
            placeholder="Número do contrato"
            value={form.numeroContrato}
            onChange={(e) =>
              setForm({ ...form, numeroContrato: e.target.value })
            }
            disabled={loading}
          />
        </Tooltip>

        <Tooltip content="Valor total do contrato em reais (ex: 1234.56)">
          <input
            placeholder="Valor total (ex: 123456 → 1.234,56)"
            value={form.valorTotal}
            onChange={(e) =>
              setForm({ ...form, valorTotal: e.target.value })
            }
            disabled={loading}
          />
        </Tooltip>

        <Tooltip content="Escolha a forma de pagamento do contrato">
          <select
            value={form.formaPagamento}
            onChange={(e) =>
              setForm({ ...form, formaPagamento: e.target.value })
            }
            disabled={loading}
          >
            <option value="AVISTA">À vista</option>
            <option value="PARCELADO">Parcelado</option>
            <option value="ENTRADA_PARCELAS">Entrada + Parcelas</option>
          </select>
        </Tooltip>

        <Tooltip content="Observações ou notas adicionais sobre o contrato">
          <textarea
            placeholder="Observações"
            value={form.observacoes}
            onChange={(e) =>
              setForm({ ...form, observacoes: e.target.value })
            }
            disabled={loading}
          />
        </Tooltip>

        <footer>
          <button onClick={() => onClose?.()} disabled={loading}>
            Cancelar
          </button>

          <Tooltip content={loading ? "Salvando..." : "Criar contrato com as informações preenchidas"}>
            <button
              type="button"
              className="btn-primary"
              onClick={salvar}
              disabled={loading}
            >

              {loading ? "Salvando..." : "Salvar"}
            </button>
          </Tooltip>
        </footer>
      </div>
    </div>
  );
}