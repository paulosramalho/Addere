import React from "react";
import { Tooltip } from "../Tooltip";

function centsToBRL(c) {
  const v = Number(c || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PreviewResumo({ saldoAnteriorCentavos, pendenciasCount, totaisPorLocal, reconciliacaoClientes }) {

  return (
    <div style={styles.container}>
      <div style={styles.cardsContainer}>
        <Tooltip content="Saldo acumulado do mês anterior, antes dos lançamentos do mês atual">
          <div style={styles.card}>
            <div style={styles.cardLabel}>Saldo anterior</div>
            <div style={styles.cardValue}>
              {centsToBRL(saldoAnteriorCentavos)}
            </div>
          </div>
        </Tooltip>

        <Tooltip content="Quantidade de lançamentos que ainda precisam ter uma conta definida">
          <div style={styles.card}>
            <div style={styles.cardLabel}>Pendências</div>
            <div style={styles.cardValue}>
              {pendenciasCount} {pendenciasCount > 0 ? "⚠️" : "✅"}
            </div>
          </div>
        </Tooltip>
      </div>

      <div style={{ marginTop: 16 }}>
        <Tooltip content="Resumo dos valores de entrada e saída por conta/local (apenas lançamentos com status OK)">
          <div style={styles.sectionTitle}>Totais por local (somente OK)</div>
        </Tooltip>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={th} title="Nome da conta bancária ou caixa">Local</th>
                <th style={thRight} title="Total de entradas (receitas)">Entradas</th>
                <th style={thRight} title="Total de saídas (despesas)">Saídas</th>
                <th style={thRight} title="Saldo da conta (Entradas - Saídas)">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {[...(totaisPorLocal || [])].sort((a, b) => (a.local || "").localeCompare(b.local || "", "pt-BR")).map((t) => {
                const saldoCentavos = t.saldoCentavos ?? ((t.entradasCentavos || 0) - (t.saidasCentavos || 0));
                const isClientes = (t.local || "").toLowerCase().includes("clientes");
                const rec = isClientes ? reconciliacaoClientes : null;
                const alertaCC = rec && !rec.ok;
                const difFmt = rec ? centsToBRL(Math.abs(rec.diferenca)) : "";
                const alertaTitle = alertaCC
                  ? `Divergência: LC R$ ${centsToBRL(rec.saldoLC)} vs CC R$ ${centsToBRL(rec.saldoCC)} (diferença ${rec.diferenca > 0 ? "+" : "-"}${difFmt})`
                  : isClientes && rec?.ok ? "LC e Conta Corrente Clientes estão em equilíbrio ✓" : undefined;
                return (
                  <tr key={t.local} style={{ ...styles.tableRow, ...(alertaCC ? { background: "#fff7ed" } : {}) }}>
                    <td style={td}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {t.local}
                        {isClientes && rec && (
                          <Tooltip content={alertaTitle}>
                            <span style={{
                              fontSize: 15,
                              cursor: "help",
                              color: alertaCC ? "#ea580c" : "#16a34a",
                            }}>
                              {alertaCC ? "⚠️" : "✓"}
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td style={{ ...td, color: "#059669", fontWeight: 600, textAlign: "right" }}>
                      {centsToBRL(t.entradasCentavos)}
                    </td>
                    <td style={{ ...td, color: "#dc2626", fontWeight: 600, textAlign: "right" }}>
                      {centsToBRL(-t.saidasCentavos)}
                    </td>
                    <td style={{ ...td, color: saldoCentavos >= 0 ? "#1e40af" : "#dc2626", fontWeight: 700, textAlign: "right" }}>
                      {centsToBRL(saldoCentavos)}
                    </td>
                  </tr>
                );
              })}
              {(!totaisPorLocal || totaisPorLocal.length === 0) ? (
                <tr>
                  <td style={{ ...td, textAlign: "center", opacity: 0.6 }} colSpan={4}>
                    Sem totais (ainda não há lançamentos OK).
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Alerta de reconciliação — aparece mesmo que "Clientes" não esteja no mês atual */}
        {reconciliacaoClientes && !reconciliacaoClientes.ok && (
          <div style={styles.alertaCC}>
            ⚠️ <strong>Conta Clientes desbalanceada.</strong>{" "}
            LC acumulado: <strong>{centsToBRL(reconciliacaoClientes.saldoLC)}</strong> ·
            CC total: <strong>{centsToBRL(reconciliacaoClientes.saldoCC)}</strong> ·
            Diferença: <strong style={{ color: "#dc2626" }}>{centsToBRL(reconciliacaoClientes.diferenca)}</strong>
          </div>
        )}

        {pendenciasCount > 0 ? (
          <div style={styles.warningBox}>
            ⚠️ Existem lançamentos sem conta definida. Eles aparecem na prévia, mas não entram nos totais por local e bloqueiam a emissão.
          </div>
        ) : null}
      </div>
    </div>
  );
}

const styles = {
  container: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    background: "#fafbfc",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  cardsContainer: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
  },
  card: {
    background: "#fff",
    padding: 14,
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    minWidth: 160,
    cursor: "help",
    transition: "all 0.2s",
  },
  cardLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 6,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  cardValue: {
    fontSize: 20,
    fontWeight: 700,
    color: "#111",
  },
  sectionTitle: {
    fontWeight: 700,
    marginBottom: 10,
    fontSize: 14,
    color: "#374151",
    cursor: "help",
  },
  tableContainer: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    background: "#fff",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  tableRow: {
    transition: "background-color 0.2s",
  },
  warningBox: {
    marginTop: 12,
    padding: 12,
    background: "#fff8e8",
    border: "1px solid #f1c40f",
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 1.5,
  },
  alertaCC: {
    marginTop: 12,
    padding: 12,
    background: "#fff7ed",
    border: "1px solid #ea580c",
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#7c2d12",
  },
};

const th = {
  textAlign: "left",
  padding: 12,
  borderBottom: "2px solid #e5e7eb",
  background: "#f9fafb",
  fontSize: 13,
  fontWeight: 700,
  color: "#374151",
  whiteSpace: "nowrap",
  cursor: "help",
};

const thRight = {
  ...th,
  textAlign: "right",
};

const td = {
  padding: 12,
  borderBottom: "1px solid #f3f4f6",
  fontSize: 14,
  color: "#1f2937",
  verticalAlign: "middle",
};