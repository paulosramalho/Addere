import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import Can from "../components/Can";

export default function PagamentosAvulsos() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modelos, setModelos] = useState([]);
  const [advogados, setAdvogados] = useState([]);
  const [clientes, setClientes] = useState([]);

  const [contas, setContas] = useState([]);

  // cache de itens por modelo (porque /modelo-distribuicao não vem com itens)
  const [itensByModeloId, setItensByModeloId] = useState({});

  const [form, setForm] = useState({
    clienteId: "",
    descricao: "",
    dataRecebimento: "", // DD/MM/AAAA
    valorRecebido: "", // máscara R$
    meioRecebimento: "PIX",
    isentoTributacao: false,
    modeloDistribuicaoId: "",
    advogadoPrincipalId: "",
    advogadoIndicacaoId: "",
    usaSplitSocio: false,
    splits: [], // { advogadoId, percentual } em %
    contaId: "",
  });

  // percentual do SÓCIO (em bp) do modelo selecionado
  const socioBp = useMemo(() => {
    if (!form.modeloDistribuicaoId) return 0;
    const id = Number(form.modeloDistribuicaoId);
    const itens = itensByModeloId[id] || [];
    if (!Array.isArray(itens) || !itens.length) return 0;

    const itemSocio = itens.find((it) => {
      const a = String(it.destinoTipo || "").toUpperCase();
      const b = String(it.destinatario || "").toUpperCase();
      return a === "SOCIO" || b === "SOCIO";
    });

    const bp = itemSocio ? Number(itemSocio.percentualBp) : 0;
    return Number.isFinite(bp) ? bp : 0;
  }, [form.modeloDistribuicaoId, itensByModeloId]);

  // ✅ Só precisa pedir advogado se o modelo tiver SOCIO (e não for a linha de INDICACAO)
  const needsAdvogadoPrincipal = useMemo(() => {
    if (!form.modeloDistribuicaoId) return true; // sem modelo selecionado, mantém comportamento atual
    const id = Number(form.modeloDistribuicaoId);
    const itens = itensByModeloId[id] || [];
    if (!Array.isArray(itens) || itens.length === 0) return true; // sem itens carregados, mantém comportamento atual

    return itens.some((it) => {
      const tipo = String(it?.destinoTipo || "").toUpperCase();
      const dest = String(it?.destinatario || "").toUpperCase();
      return tipo === "SOCIO" && dest !== "INDICACAO";
    });
  }, [form.modeloDistribuicaoId, itensByModeloId]);

  // percentual de INDICAÇÃO (em bp) do modelo selecionado
  const indicacaoBp = useMemo(() => {
    if (!form.modeloDistribuicaoId) return 0;
    const id = Number(form.modeloDistribuicaoId);
    const itens = itensByModeloId[id] || [];
    if (!Array.isArray(itens) || !itens.length) return 0;

    const itemIndic = itens.find((it) => {
      const a = String(it.destinoTipo || "").toUpperCase();
      const b = String(it.destinatario || "").toUpperCase();
      
      // compatível com o back (server.js) — aceita variações
      return (
        a === "INDICACAO" ||
        a === "INDICACAO_ADVOGADO" ||
        b === "INDICACAO"
      );
    });

    const bp = itemIndic ? Number(itemIndic.percentualBp) : 0;
    return Number.isFinite(bp) ? bp : 0;
  }, [form.modeloDistribuicaoId, itensByModeloId]);

  const hasIndicacao = indicacaoBp > 0;

  // soma dos splits (em bp)
  const somaSplitsBp = useMemo(() => {
    if (!form.usaSplitSocio) return 0;

    return (form.splits || []).reduce((acc, s) => {
      if (!s || !s.percentual) return acc;
      const raw = String(s.percentual).replace("%", "").trim().replace(/\./g, "").replace(",", ".");
      const n = Number(raw);
      if (!Number.isFinite(n)) return acc;
      return acc + Math.round(n * 100); // % -> bp
    }, 0);
  }, [form.splits, form.usaSplitSocio]);

  // helpers simples
  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
  const moneyMask = (value) => {
    const d = onlyDigits(value);
    if (!d) return "";
    const n = Number(d);
    const cents = n / 100;
    return cents.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const percentMask = (value) => {
    const d = onlyDigits(value);
    if (!d) return "";
    const n = Number(d) / 100;
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const isoToBR = (iso) => {
    if (!iso || typeof iso !== "string") return "";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return "";
    return `${d}/${m}/${y}`;
  };

  const brToISO = (br) => {
    if (!br || typeof br !== "string") return "";
    const [d, m, y] = br.split("/");
    if (!y || !m || !d) return "";
    return `${y}-${m}-${d}`;
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [m, a, c] = await Promise.all([
          apiFetch("/modelo-distribuicao?ativo=true"),
          apiFetch("/advogados"),
          apiFetch("/clients?tipo=C,A"),
        ]);

        const cs = await apiFetch("/livro-caixa/contas");
        setContas(Array.isArray(cs) ? cs : []);

        setModelos(m || []);
        setAdvogados(a || []);
        setClientes(c || []);
      } catch (e) {
        addToast(e?.message || "Erro ao carregar dados de Recebimentos Avulsos.", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // quando escolhe um modelo, busca os itens dele (1x)
  useEffect(() => {
    (async () => {
      try {
        const id = form.modeloDistribuicaoId ? Number(form.modeloDistribuicaoId) : null;
        if (!id) return;
        if (itensByModeloId[id]) return;

        const itens = await apiFetch(`/modelo-distribuicao/${id}/itens`);
        setItensByModeloId((m) => ({ ...m, [id]: Array.isArray(itens) ? itens : [] }));
      } catch (e) {
        addToast("Erro ao carregar itens do modelo", "error");
      }
    })();
  }, [form.modeloDistribuicaoId]);

  const btn = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  };

  const btnSec = {
    ...btn,
    background: "#fff",
    color: "#111",
  };

  const card = {
    border: "1px solid #eee",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
  };

  const input = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
  };

  const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

  const removeSplit = (idx) => {
    setForm((f) => ({
      ...f,
      splits: (f.splits || []).filter((_, i) => i !== idx),
    }));
  };

  const onSave = async () => {
    try {
      setSaving(true);

      if (!form.clienteId) {
        addToast("Selecione o Cliente.", "error");
        return;
      }

      if (!form.contaId) {
        addToast("Selecione a Conta.", "error");
        return;
      }

      // ✅ Só exige advogado principal se o modelo tiver SOCIO (não-indicação) e não estiver em modo split
      if (needsAdvogadoPrincipal && !form.usaSplitSocio && !form.advogadoPrincipalId) {
        addToast("Selecione o Advogado.", "error");
        return;
      }

      // ✅ Se o modelo tem INDICAÇÃO, exigir o advogado de indicação
      if (hasIndicacao && !form.advogadoIndicacaoId) {
        addToast("Selecione o Advogado de Indicação.", "error");
        return;
      }

      const payload = {
        clienteId: Number(form.clienteId),
        contaId: Number(form.contaId),
        descricao: String(form.descricao || "").trim(),
        dataRecebimento: form.dataRecebimento,
        valorRecebido: form.valorRecebido,
        meioRecebimento: form.meioRecebimento,
        isentoTributacao: !!form.isentoTributacao,
        modeloDistribuicaoId: form.modeloDistribuicaoId ? Number(form.modeloDistribuicaoId) : null,
        advogadoPrincipalId: (needsAdvogadoPrincipal && form.advogadoPrincipalId) ? Number(form.advogadoPrincipalId) : null,
        advogadoIndicacaoId: form.advogadoIndicacaoId ? Number(form.advogadoIndicacaoId) : null,
        usaSplitSocio: !!form.usaSplitSocio,
        splits: (form.splits || []).map((s) => ({
          advogadoId: s.advogadoId ? Number(s.advogadoId) : null,
          percentual: s.percentual,
        })),
      };

      await apiFetch("/pagamentos-avulsos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      // limpa
      setForm({
        clienteId: "",
        descricao: "",
        dataRecebimento: "",
        valorRecebido: "",
        meioRecebimento: "PIX",
        isentoTributacao: false,
        modeloDistribuicaoId: "",
        advogadoPrincipalId: "",
        advogadoIndicacaoId: "",
        usaSplitSocio: false,
        splits: [],
        contaId: "",
      });

      addToast("Recebimento avulso salvo com sucesso!", "success");
    } catch (e) {
      addToast(e?.message || "Erro ao salvar Recebimento avulso.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 16 }}>Carregando…</div>;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Recebimentos Avulsos</div>
          <Tooltip content="Voltar para a página de Recebimentos">
            <button style={btnSec} type="button" onClick={() => navigate("/pagamentos")}>
              Voltar
            </button>
          </Tooltip>
        </div>

        <div style={{ height: 1, background: "#eee", margin: "12px 0" }} />

        <div style={grid}>
          <div>
            <label>Cliente</label>
            <Tooltip content="Selecione o cliente que realizou o pagamento">
              <select
                style={input}
                value={form.clienteId}
                onChange={(e) => setForm((f) => ({ ...f, clienteId: e.target.value }))}
              >
                <option value="">— Selecione —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nomeRazaoSocial}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>

          <div>
            <label>Meio</label>
            <Tooltip content="Meio de recebimento utilizado">
              <select
                style={input}
                value={form.meioRecebimento}
                onChange={(e) => setForm((f) => ({ ...f, meioRecebimento: e.target.value }))}
              >
                <option value="PIX">PIX</option>
                <option value="TED">TED</option>
                <option value="BOLETO">BOLETO</option>
                <option value="CARTAO">CARTÃO</option>
                <option value="DINHEIRO">DINHEIRO</option>
                <option value="OUTRO">OUTRO</option>
              </select>
            </Tooltip>
          </div>

          <div>
            <label>Data do recebimento</label>
            <Tooltip content="Data em que o pagamento foi recebido">
              <input
                type="date"
                style={input}
                value={brToISO(form.dataRecebimento)}
                onChange={(e) => setForm((f) => ({ ...f, dataRecebimento: isoToBR(e.target.value) }))}
              />
            </Tooltip>
          </div>

          <div>
            <label>Valor recebido (R$)</label>
            <Tooltip content="Valor total recebido (formatação automática)">
              <input
                style={input}
                value={form.valorRecebido}
                onChange={(e) => setForm((f) => ({ ...f, valorRecebido: moneyMask(e.target.value) }))}
                placeholder="R$ 0,00"
              />
            </Tooltip>
          </div>

          <div>
            <label>Conta (obrigatória)</label>
            <Tooltip content="Conta bancária onde o valor foi recebido">
              <select
                style={input}
                value={form.contaId}
                onChange={(e) => setForm((f) => ({ ...f, contaId: e.target.value }))}
              >
                <option value="">— Selecione —</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24 }}>
            <Tooltip content="Marque se este recebimento está isento de tributação">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!form.isentoTributacao}
                  onChange={(e) => setForm((f) => ({ ...f, isentoTributacao: e.target.checked }))}
                />
                <span>Isento de tributação</span>
              </label>
            </Tooltip>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label>Descrição</label>
            <Tooltip content="Descreva o motivo do recebimento (diligência, audiência, etc.)">
              <input
                style={input}
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                placeholder="Diligência, audiência, parecer, etc."
              />
            </Tooltip>
          </div>

          <div>
            <label>Modelo de Distribuição</label>
            <Tooltip content="Selecione o modelo de distribuição de honorários a ser aplicado">
              <select
                style={input}
                value={form.modeloDistribuicaoId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    modeloDistribuicaoId: e.target.value,
                    // modelo mudou: limpa campos dependentes
                    advogadoIndicacaoId: "",
                    advogadoPrincipalId: "", // será preenchido só se o modelo exigir
                  }))
                }
              >
                <option value="">—</option>
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.codigo ? `${m.codigo} — ${m.descricao || ""}` : (m.descricao || `Modelo #${m.id}`)}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>

          {/* Indicação — exclui advogado principal e lawyers já nos splits */}
          {hasIndicacao && (
            <div>
              <label>Advogado (Indicação)</label>
              <Tooltip content="Advogado responsável pela indicação (obrigatório quando o modelo tiver Indicação)">
                <select
                  style={input}
                  value={form.advogadoIndicacaoId}
                  onChange={(e) => setForm((f) => ({ ...f, advogadoIndicacaoId: e.target.value }))}
                >
                  <option value="">—</option>
                  {advogados
                    .filter((a) => {
                      if (String(a.id) === String(form.advogadoIndicacaoId)) return true;
                      if (!form.usaSplitSocio && form.advogadoPrincipalId && String(a.id) === String(form.advogadoPrincipalId)) return false;
                      if (form.usaSplitSocio && (form.splits || []).some((s) => s.advogadoId && String(s.advogadoId) === String(a.id))) return false;
                      return true;
                    })
                    .map((a) => (
                      <option key={a.id} value={a.id}>{a.nome}</option>
                    ))}
                </select>
              </Tooltip>
            </div>
          )}

          {/* Advogado + Split toggle inline */}
          {needsAdvogadoPrincipal && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              {!form.usaSplitSocio && (
                <div style={{ flex: 1 }}>
                  <label>Advogado</label>
                  <Tooltip content="Advogado principal responsável pelo recebimento">
                    <select
                      style={input}
                      value={form.advogadoPrincipalId}
                      onChange={(e) => setForm((f) => ({ ...f, advogadoPrincipalId: e.target.value }))}
                    >
                      <option value="">—</option>
                      {advogados
                        .filter((a) =>
                          String(a.id) === String(form.advogadoPrincipalId) ||
                          !form.advogadoIndicacaoId ||
                          String(a.id) !== String(form.advogadoIndicacaoId)
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>{a.nome}</option>
                        ))}
                    </select>
                  </Tooltip>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={form.usaSplitSocio}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      const rows = [];
                      if (form.advogadoPrincipalId) {
                        rows.push({ advogadoId: form.advogadoPrincipalId, percentual: "" });
                      }
                      setForm((f) => ({ ...f, usaSplitSocio: true, splits: rows, advogadoPrincipalId: "" }));
                    } else {
                      setForm((f) => ({ ...f, usaSplitSocio: false, splits: [] }));
                    }
                  }}
                />
                <span>Split</span>
              </div>
            </div>
          )}
        </div>

        {form.usaSplitSocio && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <strong>Splits</strong>

            {/* Rows já preenchidas */}
            {(form.splits || []).map((s, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10, alignItems: "center" }}>
                <select
                  style={input}
                  value={s.advogadoId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({
                      ...f,
                      splits: f.splits.map((x, i) => (i === idx ? { ...x, advogadoId: v } : x)),
                    }));
                  }}
                >
                  <option value="">— advogado —</option>
                  {advogados
                    .filter((a) =>
                      String(a.id) === String(s.advogadoId) ||
                      (
                        !(form.splits || []).some((x, i) => i !== idx && x.advogadoId && String(x.advogadoId) === String(a.id)) &&
                        (!form.advogadoIndicacaoId || String(a.id) !== String(form.advogadoIndicacaoId))
                      )
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>{a.nome}</option>
                    ))}
                </select>

                <input
                  style={input}
                  inputMode="numeric"
                  value={s.percentual}
                  onChange={(e) => {
                    const v = percentMask(e.target.value);
                    setForm((f) => ({
                      ...f,
                      splits: f.splits.map((x, i) => (i === idx ? { ...x, percentual: v } : x)),
                    }));
                  }}
                  placeholder="0,00"
                />

                <button style={btnSec} onClick={() => removeSplit(idx)}>
                  Remover
                </button>
              </div>
            ))}

            {/* Linha extra automática enquanto houver % disponível */}
            {somaSplitsBp < (socioBp > 0 ? socioBp : 10000) && (
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10, alignItems: "center" }}>
                <select
                  style={input}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setForm((f) => ({
                      ...f,
                      splits: [...(f.splits || []), { advogadoId: e.target.value, percentual: "" }],
                    }));
                  }}
                >
                  <option value="">— advogado —</option>
                  {advogados
                    .filter((a) =>
                      !(form.splits || []).some((s) => s.advogadoId && String(s.advogadoId) === String(a.id)) &&
                      (!form.advogadoIndicacaoId || String(a.id) !== String(form.advogadoIndicacaoId))
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>{a.nome}</option>
                    ))}
                </select>
                <input style={{ ...input, background: "#f8f8f8", color: "#aaa" }} placeholder="0,00" disabled />
                <div />
              </div>
            )}
          </div>
        )}

        {form.usaSplitSocio && somaSplitsBp > socioBp && (
          <div style={{ color: "#b91c1c", marginTop: 8, fontSize: 13 }}>
            A soma dos splits ({(somaSplitsBp / 100).toFixed(2)}%) excede o percentual definido no modelo aplicado (
            {(socioBp / 100).toFixed(2)}%).
          </div>
        )}

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Tooltip
            content={
              form.usaSplitSocio && somaSplitsBp > socioBp
                ? "Corrija os splits antes de salvar"
                : "Salvar recebimento avulso"
            }
          >
            <button
              style={{
                ...btn,
                opacity: form.usaSplitSocio && somaSplitsBp > socioBp ? 0.5 : 1,
                cursor: form.usaSplitSocio && somaSplitsBp > socioBp ? "not-allowed" : "pointer",
              }}
              disabled={saving || (form.usaSplitSocio && somaSplitsBp > socioBp)}
              onClick={onSave}
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}