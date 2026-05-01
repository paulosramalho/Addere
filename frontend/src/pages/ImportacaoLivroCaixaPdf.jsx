import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { brlFromCentavos } from "../lib/formatters";
import { useToast } from "../components/Toast";

export default function ImportacaoLivroCaixaPdf() {
  const { addToast } = useToast();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const [contas, setContas] = useState([]);
  const [pessoasCA, setPessoasCA] = useState([]); // C e A
  const [pessoasFA, setPessoasFA] = useState([]); // F e A

  const [rows, setRows] = useState([]);
  const [busyRowId, setBusyRowId] = useState(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [sessaoId, setSessaoId] = useState(null);
  const [alertaImport, setAlertaImport] = useState(null);
  const [mostrarApenasP, setMostrarApenasP] = useState(false);

  const competenciaLabel = useMemo(() => `${String(mes).padStart(2, "0")}/${ano}`, [ano, mes]);
  const pendingRows = useMemo(() => rows.filter((r) => !r._confirmed), [rows]);
  const confirmedCount = useMemo(() => rows.filter((r) => r._confirmed).length, [rows]);

  useEffect(() => {
    (async () => {
      try {
        const [c, ca, fa] = await Promise.all([
          apiFetch("/livro-caixa/contas"),
          apiFetch("/pessoas?tipos=C,A"),
          apiFetch("/pessoas?tipos=F,A"),
        ]);
        setContas(Array.isArray(c) ? c : []);
        setPessoasCA(Array.isArray(ca) ? ca : []);
        setPessoasFA(Array.isArray(fa) ? fa : []);
      } catch (e) {
        addToast(e?.message || "Erro ao carregar dados base.", "error");
      }
    })();
  }, [addToast]);

  const btn = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  };

  const btnSec = { ...btn, background: "#fff", color: "#111" };

  const input = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #ddd",
  };

  const th = { textAlign: "left", fontSize: 12, color: "#444", padding: "8px 10px", borderBottom: "1px solid #eee" };
  const td = { padding: "8px 10px", borderBottom: "1px solid #f2f2f2", verticalAlign: "top" };

  const onParse = async () => {
    if (!file) { addToast("Selecione um PDF.", "error"); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await apiFetch(`/livro-caixa/importacao/pdf/parse?ano=${ano}&mes=${mes}`, {
        method: "POST",
        body: fd,
      });
      setSessaoId(resp?.sessaoId || null);
      setAlertaImport(resp?.alerta || null);
      setMostrarApenasP(false);
      const items = resp?.items || [];
      setRows(items.map((x) => ({ ...x, _confirmed: x.jaConfirmada === true, _error: "", _result: null })));
      addToast(`Prévia gerada: ${items.length} lançamento(s).`, "success");
    } catch (e) {
      addToast(e?.message || "Erro ao ler PDF.", "error");
    } finally {
      setLoading(false);
    }
  };

  const setRow = (rowId, patch) => {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const confirmRow = async (r) => {
    if (r._confirmed) return true;

    if (!r.contaId && !r.contaNome) {
      setRow(r.rowId, { _error: "Informe uma conta (ou contaNome)." });
      return false;
    }

    const contemNFSe = /NFS-e/i.test(String(r.documento || "")) || /NFS-e/i.test(String(r.historico || ""));
    const viraAvulso = r.es === "E" && (contemNFSe || r.isentoTributacao === true);

    setBusyRowId(r.rowId);
    setRow(r.rowId, { _error: "" });

    try {
      const payload = {
        rowId: r.rowId,
        competenciaAno: ano,
        competenciaMes: mes,
        dataBR: r.dataBR,
        es: r.es,
        documento: r.documento,
        clienteFornecedor: r.clienteFornecedor,
        historico: r.historico,
        valorCentavos: Number(r.valorCentavos || 0),
        localLabel: r.localLabel || r.localLabelFallback || "",
        contaId: r.contaId ? Number(r.contaId) : null,
        contaNome: r.contaNome || "",
        isentoTributacao: !!r.isentoTributacao,
        clienteId: r.clienteId ? Number(r.clienteId) : null,
        sessaoId:              sessaoId,
      };

      const result = await apiFetch("/livro-caixa/importacao/pdf/confirmar-linha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      if (result?.clienteCriado?.id) {
        const novo = result.clienteCriado;
        const upsertSorted = (prev) => {
          const exists = prev.some((x) => x.id === novo.id);
          const merged = exists ? prev : [...prev, novo];
          return merged.sort((a, b) =>
            String(a.nomeRazaoSocial || "").localeCompare(String(b.nomeRazaoSocial || ""), "pt-BR")
          );
        };
        const t = String(novo.tipo || "").toUpperCase();
        if (t === "C") setPessoasCA((prev) => upsertSorted(prev));
        else if (t === "F") setPessoasFA((prev) => upsertSorted(prev));
        else {
          setPessoasCA((prev) => upsertSorted(prev));
          setPessoasFA((prev) => upsertSorted(prev));
        }
        setRow(r.rowId, { clienteId: novo.id });
      }

      setRow(r.rowId, { _confirmed: true, _result: result });
      addToast(`Linha confirmada: ${r.dataBR} (${r.es})`, "success");
      return true;
    } catch (e) {
      setRow(r.rowId, { _error: e?.message || "Erro ao confirmar linha." });
      addToast(e?.message || "Erro ao confirmar linha.", "error");
      return false;
    } finally {
      setBusyRowId(null);
    }
  };

  const confirmAll = async () => {
    if (pendingRows.length === 0) {
      addToast("Nenhuma linha pendente para confirmar.", "warning");
      return;
    }
    setConfirmingAll(true);
    let successCount = 0;
    let errorCount = 0;
    for (const r of pendingRows) {
      const ok = await confirmRow(r);
      if (ok) successCount++;
      else errorCount++;
    }
    setConfirmingAll(false);
    addToast(
      `Confirmação em lote: ${successCount} sucesso, ${errorCount} erro(s).`,
      errorCount > 0 ? "warning" : "success"
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 6px 0" }}>Importação por PDF — Livro Caixa</h2>
      <div style={{ color: "#666", marginBottom: 14 }}>Competência: {competenciaLabel}</div>

      <div style={{ display: "grid", gridTemplateColumns: "140px 120px 1fr auto", gap: 10, alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Ano</div>
          <input style={input} value={ano} onChange={(e) => setAno(Number(e.target.value || 0))} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Mês</div>
          <input style={input} value={mes} onChange={(e) => setMes(Number(e.target.value || 0))} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>PDF</div>
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <button style={btn} onClick={onParse} disabled={loading || confirmingAll}>
          {loading ? "Lendo..." : "Gerar prévia"}
        </button>
      </div>

      {alertaImport && (
        <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10,
          background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e",
          fontSize: 13, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span>
            <strong>Este arquivo já foi importado</strong>{" "}
            em {new Date(alertaImport.criadaEm).toLocaleDateString("pt-BR")} —{" "}
            {alertaImport.linhasConfirmadas}/{alertaImport.totalLinhas} linha(s) confirmada(s).
            {alertaImport.linhasConfirmadas < alertaImport.totalLinhas
              ? " Linhas pendentes ainda podem ser importadas."
              : " Todas as linhas já foram confirmadas."}
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            style={{ ...btn, background: pendingRows.length > 0 ? "#16a34a" : "#999" }}
            onClick={confirmAll}
            disabled={confirmingAll || pendingRows.length === 0}
          >
            {confirmingAll ? "Confirmando..." : `Confirmar Todos (${pendingRows.length})`}
          </button>
          <button onClick={() => setMostrarApenasP((v) => !v)} style={btnSec}>
            {mostrarApenasP ? "Mostrar todas" : `Só pendentes (${rows.filter((r) => !r._confirmed).length})`}
          </button>
          <span style={{ fontSize: 13, color: "#666" }}>
            {confirmedCount} de {rows.length} confirmado(s)
          </span>
        </div>
      )}

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#fafafa" }}>
            <tr>
              <th style={th}>Data</th>
              <th style={th}>E/S</th>
              <th style={th}>Documento</th>
              <th style={th}>Cliente</th>
              <th style={th}>Histórico</th>
              <th style={th}>Valor</th>
              <th style={th}>Conta</th>
              <th style={th}>Flags</th>
              <th style={th}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {(mostrarApenasP ? rows.filter((r) => !r._confirmed) : rows).map((r) => {
              const disabled = r._confirmed || busyRowId === r.rowId;
              const valorFmt = brlFromCentavos(r.valorCentavos);
              const contemNFSe = /NFS-e/i.test(String(r.documento || "")) || /NFS-e/i.test(String(r.historico || ""));
              const isEntrada = r.es === "E";
              const viraAvulso = isEntrada && (contemNFSe || r.isentoTributacao === true);
              return (
                <tr key={r.rowId} style={{ opacity: r._confirmed ? 0.65 : 1 }}>
                  <td style={td}>
                    <input style={input} value={r.dataBR || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { dataBR: e.target.value })} />
                  </td>

                  <td style={td}>
                    <select style={input} value={r.es || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { es: e.target.value })}>
                      <option value="">-</option>
                      <option value="E">E</option>
                      <option value="S">S</option>
                    </select>
                  </td>

                  <td style={td}>
                    <input style={input} value={r.documento || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { documento: e.target.value || null })} />
                  </td>

                  <td style={td}>
                    <select style={input} value={r.clienteId || ""} disabled={disabled}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        const lista = r.es === "S" ? pessoasFA : pessoasCA;
                        const c = lista.find((x) => x.id === id);
                        setRow(r.rowId, { clienteId: id, ...(c?.nomeRazaoSocial ? { clienteFornecedor: c.nomeRazaoSocial } : {}) });
                      }}>
                      <option value="">(opcional) selecione p/ substituir</option>
                      {(r.es === "S" ? pessoasFA : pessoasCA).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nomeRazaoSocial || c.nome || `Cadastro ${c.id}`}{c.tipo ? ` (${c.tipo})` : ""}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>
                      <input type="text" style={input} placeholder="cliente/fornecedor (texto)"
                        value={r.clienteFornecedor || ""} disabled={disabled}
                        onChange={(e) => setRow(r.rowId, { clienteFornecedor: e.target.value })} />
                    </div>
                  </td>

                  <td style={td}>
                    <textarea style={{ ...input, height: 62 }} value={r.historico || ""} disabled={disabled}
                      onChange={(e) => setRow(r.rowId, { historico: e.target.value })} />
                    {r._error ? <div style={{ marginTop: 6, color: "#b00020", fontSize: 12 }}>{r._error}</div> : null}
                  </td>

                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{valorFmt}</div>
                    <div style={{ fontSize: 11, color: "#777" }}>{r.localLabel || ""}</div>
                  </td>

                  <td style={td}>
                    <select style={input} value={r.contaId || ""} disabled={disabled}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        const c = contas.find((x) => x.id === id);
                        setRow(r.rowId, { contaId: id, contaNome: c?.nome || r.contaNome });
                      }}>
                      <option value="">(auto/criar OUTROS)</option>
                      {contas.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome} ({c.tipo})</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>
                      <input style={input} value={r.contaNome || ""} disabled={disabled}
                        onChange={(e) => setRow(r.rowId, { contaNome: e.target.value })}
                        placeholder="Nome da conta (se não existir cria OUTROS)" />
                    </div>
                  </td>

                  <td style={td}>
                    {isEntrada ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {!contemNFSe ? (
                          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                            <input type="checkbox" checked={!!r.isentoTributacao} disabled={disabled}
                              onChange={(e) => setRow(r.rowId, { isentoTributacao: e.target.checked })} />
                            Não tributado?
                          </label>
                        ) : (
                          <div style={{ fontSize: 12, color: "#555" }}>Detectado NFS-e</div>
                        )}

                        <div style={{ fontSize: 12, color: "#777" }}>
                          {viraAvulso ? "Gera contrato AV" : "Vai direto p/ Livro Caixa"}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#777" }}>Saída =&gt; Livro Caixa</div>
                    )}
                  </td>

                  <td style={td}>
                    {r._confirmed ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ padding: "3px 10px", borderRadius: 20, background: "#dcfce7",
                          color: "#15803d", fontSize: 12, fontWeight: 700 }}>
                          ✓ {r.jaConfirmada ? "Já importada" : "Confirmado"}
                        </span>
                        {r.confirmedAt && (
                          <span style={{ fontSize: 11, color: "#6b7280" }}>
                            em {new Date(r.confirmedAt).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                        {r._result && (
                          <div style={{ fontSize: 11, color: "#666" }}>
                            {r._result.numeroContrato
                              ? <div>Contrato: {r._result.numeroContrato}</div>
                              : null}
                            {r._result.livroCaixaLancamentoId
                              ? <div>LC: #{r._result.livroCaixaLancamentoId}</div>
                              : null}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button style={btn} disabled={disabled} onClick={() => confirmRow(r)}>
                        Confirmar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {!rows.length ? (
              <tr>
                <td style={{ padding: 16, color: "#777" }} colSpan={9}>
                  Nenhuma prévia ainda. Selecione um PDF e clique em "Gerar prévia".
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, color: "#777", fontSize: 12 }}>
        Regras: NFS-e =&gt; contrato AV; sem NFS-e =&gt; marque "Não tributado?" para gerar contrato AV; saída sempre vai ao Livro Caixa.
      </div>

    </div>
  );
}
