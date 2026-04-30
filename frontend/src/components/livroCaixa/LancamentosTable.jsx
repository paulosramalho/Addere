import React from "react";
import { useToast } from "../Toast";
import { apiFetch } from "../../lib/api";

function centsToBRL(c) {
  const v = Number(c || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(d) {
  if (!d) return "—";
  const s = String(d);
  const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dt = mISO
    ? new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]), 12, 0, 0)
    : new Date(d);
  if (!Number.isFinite(dt.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

function getOrigemBadge(origem) {
  const badges = {
    MANUAL: { bg: "#e0f2fe", color: "#0369a1", label: "Manual" },
    PAGAMENTO_RECEBIDO: { bg: "#dcfce7", color: "#15803d", label: "Recebimento" },
    PARCELA_PREVISTA: { bg: "#fef3c7", color: "#a16207", label: "Parcela Prevista" },
    REPASSES_REALIZADOS: { bg: "#fef3c7", color: "#a16207", label: "Repasse" },
    EMPRESTIMO_SOCIO_PAGAMENTO: { bg: "#ede9fe", color: "#6d28d9", label: "Empréstimo" },
    DESPESA: { bg: "#fee2e2", color: "#b91c1c", label: "Despesa" },
  };
  
  const badge = badges[origem] || { bg: "#f3f4f6", color: "#6b7280", label: origem };
  
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: badge.bg,
        color: badge.color,
      }}
    >
      {badge.label}
    </span>
  );
}

function getStatusFluxoBadge(statusFluxo) {
  if (statusFluxo === "EFETIVADO") {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          background: "#dcfce7",
          color: "#15803d",
        }}
      >
        ✓ Efetivado
      </span>
    );
  }
  
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: "#e0f2fe",
        color: "#0369a1",
      }}
    >
      📅 Previsto
    </span>
  );
}

function getStatusBadge(status) {
  if (status === "OK") {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          background: "#dcfce7",
          color: "#15803d",
        }}
      >
        ✓ OK
      </span>
    );
  }
  
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: "#fef3c7",
        color: "#a16207",
      }}
    >
      ⚠ Pendente
    </span>
  );
}

export default function LancamentosTable({ lancamentos, onDefinirConta, onRefresh, onEditar, onExcluir, isAdmin }) {
  const { addToast } = useToast();

  if (!lancamentos || lancamentos.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: "center", opacity: 0.7 }}>
        Nenhum lançamento encontrado.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#fafafa" }}>
            <th style={th}>Data</th>
            <th style={th}>NFS-e/NF/CF/RC</th>
            <th style={th}>E/S</th>
            <th style={th}>Cliente/Fornecedor</th>
            <th style={th}>Histórico</th>
            <th style={th}>Valor</th>
            <th style={th}>Local</th>
            <th style={th}>Origem</th>
            <th style={th}>Fluxo</th>
            <th style={th}>Status</th>
            <th style={th}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {lancamentos.map((l) => {
            const isPendente = l.status === "PENDENTE_CONTA";
            const isEntrada = l.es === "E";
            
            return (
              <tr
                key={l.id}
                style={{
                  background: isPendente ? "#fffbeb" : "#fff",
                  borderLeft: isPendente ? "3px solid #f59e0b" : "3px solid transparent",
                }}
              >
                <td style={td}>{formatDate(l.data)}</td>
                <td style={td}>{l.documento || "—"}</td>
                <td style={td}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: isEntrada ? "#15803d" : "#b91c1c",
                    }}
                  >
                    {l.es}
                  </span>
                </td>
                <td
                  style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}
                  title={l.clienteFornecedor || undefined}
                >
                  {l.clienteFornecedor || "—"}
                </td>
                <td
                  style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}
                  title={l.historico || undefined}
                >
                  {l.historico}
                </td>
                <td
                  style={{
                    ...td,
                    textAlign: "right",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: isEntrada ? "#15803d" : "#b91c1c",
                  }}
                >
                  {centsToBRL(l.valorCentavos)}
                </td>
                <td
                  style={{ ...td, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}
                  title={l.conta?.nome || l.localLabelFallback || undefined}
                >
                  {l.conta?.nome || l.localLabelFallback || "—"}
                </td>
                <td style={td}>{getOrigemBadge(l.origem)}</td>
                <td style={td}>{getStatusFluxoBadge(l.statusFluxo)}</td>
                <td style={td}>{getStatusBadge(l.status)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {isPendente && (
                      <button
                        onClick={() => onDefinirConta(l.id)}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: "1px solid #f59e0b",
                          background: "#fef3c7",
                          color: "#92400e",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Definir conta
                      </button>
                    )}
                    {onEditar && (
                      <button
                        onClick={() => onEditar(l)}
                        title="Editar"
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: "1px solid #93c5fd",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Editar
                      </button>
                    )}
                    {isAdmin && onExcluir && (
                      <button
                        onClick={() => onExcluir(l)}
                        title="Excluir"
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: "1px solid #fca5a5",
                          background: "#fef2f2",
                          color: "#b91c1c",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  fontWeight: 600,
  whiteSpace: "nowrap",
  fontSize: 12,
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};