// src/pages/FluxodeCaixa.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import { brlFromCentavos } from '../lib/formatters';

export default function FluxodeCaixa() {
  const { addToast } = useToast();

  const [contas, setContas] = useState([]);
  const [contaId, setContaId] = useState("ALL"); // "ALL" | id

  // período (inclusive)
  const [inicioISO, setInicioISO] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  });
  const [fimISO, setFimISO] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    // último dia do mês atual
    const last = new Date(y, d.getMonth() + 1, 0).getDate();
    return `${y}-${m}-${String(last).padStart(2, "0")}`;
  });

  const [loading, setLoading] = useState(false);
  const [linhas, setLinhas] = useState([]); // linhas já com saldo
  const [resumo, setResumo] = useState(null); // {saldoInicial, entradas, saidas, saldoFinal}

  const [agruparPorDia, setAgruparPorDia] = useState(true);
  const [considerarPrevistos, setConsiderarPrevistos] = useState(true);

  function isoToBR(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return "";
    return `${d}/${m}/${y}`;
  }

  function parseISODate(iso) {
    // cria como local time (00:00)
    const [y, m, d] = (iso || "").split("-").map((x) => Number(x));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 0, 0, 0);
  }

  function monthKey(y, m) {
    return `${y}-${String(m).padStart(2, "0")}`;
  }

  function enumerateMonths(dtIni, dtFim) {
    const out = [];
    const cur = new Date(dtIni.getFullYear(), dtIni.getMonth(), 1);
    const end = new Date(dtFim.getFullYear(), dtFim.getMonth(), 1);
    while (cur <= end) {
      out.push({ ano: cur.getFullYear(), mes: cur.getMonth() + 1, key: monthKey(cur.getFullYear(), cur.getMonth() + 1) });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  function dateKey(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function enumerateDays(dtIni, dtFim) {
    const out = [];
    const cur = new Date(dtIni.getFullYear(), dtIni.getMonth(), dtIni.getDate(), 0, 0, 0);
    const end = new Date(dtFim.getFullYear(), dtFim.getMonth(), dtFim.getDate(), 0, 0, 0);
    while (cur <= end) {
      out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  async function loadContas() {
    const c1 = await apiFetch("/livro-caixa/contas");
    const arr = Array.isArray(c1) ? c1 : (c1?.contas || []);
    setContas(arr);
  }

  async function carregar() {
    const dtIni = parseISODate(inicioISO);
    const dtFim = parseISODate(fimISO);
    if (!dtIni || !dtFim) {
      addToast("Informe início e fim do período.", "error");
      return;
    }
    if (dtFim < dtIni) {
      addToast("Período inválido: fim menor que início.", "error");
      return;
    }

    setLoading(true);
    setResumo(null);
    setLinhas([]);

    try {
      await loadContas();

      const months = enumerateMonths(dtIni, dtFim);

      // 1) busca todos os meses em paralelo
      const results = await Promise.all(
        months.map(({ ano, mes }) => apiFetch(`/livro-caixa/lancamentos?ano=${ano}&mes=${mes}`))
      );

      // 2) saldo inicial do período = saldoAnterior do PRIMEIRO mês
      const first = results[0] || {};

      let runningEfet = Number(first?.saldoAnteriorCentavos || 0); // só EFETIVADO
      let runningProj = Number(first?.saldoAnteriorCentavos || 0); // EFETIVADO + PREVISTO

      // este "running" é o que aparece na tabela/cards (depende do toggle)
      let running = Number(first?.saldoAnteriorCentavos || 0);

      // 3) junta lançamentos de todos os meses
      let all = [];
      for (let i = 0; i < results.length; i++) {
        const pack = results[i] || {};
        const arr = pack?.lancamentos || [];

        // normaliza data e filtra por período
        for (const l of arr) {
          let dt = null;
          if (l?.data) {
            const s = String(l.data);
            const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            dt = mISO
              ? new Date(Date.UTC(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]), 12, 0, 0))
              : new Date(l.data);
            if (!Number.isFinite(dt.getTime())) dt = null;
          }
          if (!dt) continue;

          // período inclusive
          if (dt < dtIni) continue;
          if (dt > new Date(Date.UTC(dtFim.getUTCFullYear(), dtFim.getUTCMonth(), dtFim.getUTCDate(), 23, 59, 59))) continue;

          // filtro conta
          if (contaId !== "ALL") {
            const cid = Number(contaId);
            if (Number(l?.contaId) !== cid) continue;
          }

          all.push({ ...l, _dt: dt });
        }
      }  

      // 4) ordena por data e, se existir, por ordemDia/id
      all.sort((a, b) => {
        const da = a._dt.getTime();
        const db = b._dt.getTime();
        if (da !== db) return da - db;
        const oa = Number(a.ordemDia ?? 0);
        const ob = Number(b.ordemDia ?? 0);
        if (oa !== ob) return oa - ob;
        return String(a.id).localeCompare(String(b.id));
      });

      // 5) calcula saldo e resumo
      let entradas = 0;
      let saidas = 0;

      const computed = all.map((l) => {
        const es = String(l.es || "");
        const val = Number(l.valorCentavos || 0);
        const tipoFluxo = String(l.statusFluxo || ""); // PREVISTO | EFETIVADO
        const isPrevisto = tipoFluxo === "PREVISTO";
        const isEfetivado = tipoFluxo === "EFETIVADO";

        // Regra correta de impacto no Fluxo de Caixa
        const impactaFluxo =
          isEfetivado || (considerarPrevistos && isPrevisto);


        if (impactaFluxo) {
          if (es === "E") {
            running += val;
            entradas += val;
          } else if (es === "S") {
            running -= val;
            saidas += val;
          }
        }
        
        // ✅ Sempre calcula os dois saldos para tooltip/gráfico
        if (isEfetivado) {
          if (es === "E") runningEfet += val;
          else if (es === "S") runningEfet -= val;
    
          if (es === "E") runningProj += val;
          else if (es === "S") runningProj -= val;
        } else if (isPrevisto) {
          // previsto só entra no projetado
          if (es === "E") runningProj += val;
          else if (es === "S") runningProj -= val;
        }

        return {
          ...l,
          dataBR: l?._dt ? l._dt.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "",
          localLabel: l?.conta?.nome || l?.localLabelFallback || "—",
          _tipo: String(l.statusFluxo || ""), // PREVISTO | EFETIVADO
          _saldoApos: running,
          _isPrevisto: isPrevisto,
          _isEfetivado: isEfetivado,
          _impactaFluxo: impactaFluxo,
          _saldoEfetApos: runningEfet,
          _saldoProjApos: runningProj,
        };
      });

      setLinhas(computed);
      setResumo({
        saldoInicial: Number(first?.saldoAnteriorCentavos || 0),
        entradas,
        saidas,
        saldoFinal: running,
      });
    } catch (e) {
      addToast(e?.message || "Erro ao carregar fluxo de caixa.", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicioISO, fimISO, contaId, considerarPrevistos]);

  const tituloConta = useMemo(() => {
    if (contaId === "ALL") return "Todas";
    const c = contas.find((x) => Number(x.id) === Number(contaId));
    return c?.nome || `#${contaId}`;
  }, [contaId, contas]);

  const rowsToRender = useMemo(() => {
    if (!agruparPorDia) return linhas;

    const out = [];
    let curKey = null;

    let diaEntradas = 0;
    let diaSaidas = 0;
    let diaSaldoApos = null;
    let diaLabel = "";

    const flushSubtotal = () => {
      if (!curKey) return;
      out.push({
        id: `SUBTOTAL_${curKey}`,
        _subtotal: true,
        dataBR: diaLabel,
        entradasCentavos: diaEntradas,
        saidasCentavos: diaSaidas,
        _saldoApos: diaSaldoApos ?? 0,
      });
    };

    for (const l of linhas) {
      const dt = l._dt ? l._dt : (l.data ? new Date(l.data) : null);
      const key = dt
        ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
        : "SEM_DATA";

      if (curKey !== null && key !== curKey) {
        flushSubtotal();
        diaEntradas = 0;
        diaSaidas = 0;
        diaSaldoApos = null;
      }

      curKey = key;
      diaLabel = l.dataBR || (dt ? dt.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");

      const impacta = !!l._impactaFluxo;
      const es = String(l.es || "");
      const val = Number(l.valorCentavos || 0);

      if (impacta) {
        if (es === "E") diaEntradas += val;
        if (es === "S") diaSaidas += val;
      }

      diaSaldoApos = l._saldoApos;

      out.push(l);
    }

    flushSubtotal();
    return out;
  }, [linhas, agruparPorDia]);

  const resumoPorConta = useMemo(() => {
    if (contaId !== "ALL") return [];

    const map = new Map();

    for (const l of linhas) {
      const cid = Number(l.contaId);
      const nome = l?.conta?.nome || "—";

      if (!map.has(cid)) {
        map.set(cid, {
          contaId: cid,
          nome,
          entradas: 0,
          saidas: 0,
          liquido: 0,
          qtd: 0,
          qtdPrev: 0,
          qtdEfet: 0,
        });
      }
      const row = map.get(cid);

      row.qtd += 1;
    const tipo = String(l.statusFluxo || "");
      if (tipo === "PREVISTO") row.qtdPrev += 1;
      if (tipo === "EFETIVADO") row.qtdEfet += 1;

      const ok = String(l.status || "OK") === "OK";
      if (!ok) continue;

      const es = String(l.es || "");
      const val = Number(l.valorCentavos || 0);

      if (es === "E") row.entradas += val;
      if (es === "S") row.saidas += val;
      row.liquido = row.entradas - row.saidas;
    }

    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [linhas, contaId]);

  const dailySeriesEfetivo = useMemo(() => {
    const dtIni = parseISODate(inicioISO);
    const dtFim = parseISODate(fimISO);
    if (!dtIni || !dtFim) return [];

    const saldoInicial = Number(resumo?.saldoInicial || 0);
    const fechamentoPorDia = new Map();

    for (const l of linhas) {
      const dt = l._dt ? l._dt : (l.data ? new Date(l.data) : null);
      if (!dt) continue;
      fechamentoPorDia.set(dateKey(dt), Number(l._saldoEfetApos || 0));
    }

    const dias = enumerateDays(dtIni, dtFim);
    const out = [];
    let running = saldoInicial;

    for (const d of dias) {
      const key = dateKey(d);
      if (fechamentoPorDia.has(key)) running = fechamentoPorDia.get(key);
      out.push({ key, label: d.toLocaleDateString("pt-BR", { timeZone: "UTC" }), saldoCentavos: running });
    }
    return out;
  }, [linhas, inicioISO, fimISO, resumo]);

  const dailySeriesProjetado = useMemo(() => {
    const dtIni = parseISODate(inicioISO);
    const dtFim = parseISODate(fimISO);
    if (!dtIni || !dtFim) return [];

    const saldoInicial = Number(resumo?.saldoInicial || 0);
    const fechamentoPorDia = new Map();

    for (const l of linhas) {
      const dt = l._dt ? l._dt : (l.data ? new Date(l.data) : null);
      if (!dt) continue;
      fechamentoPorDia.set(dateKey(dt), Number(l._saldoProjApos || 0));
    }

    const dias = enumerateDays(dtIni, dtFim);
    const out = [];
    let running = saldoInicial;

    for (const d of dias) {
      const key = dateKey(d);
      if (fechamentoPorDia.has(key)) running = fechamentoPorDia.get(key);
      out.push({ key, label: d.toLocaleDateString("pt-BR", { timeZone: "UTC" }), saldoCentavos: running });
    }
    return out;
  }, [linhas, inicioISO, fimISO, resumo]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Livro Caixa — Fluxo de Caixa</h2>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", margin: "12px 0" }}>
        <label style={styles.field}>
          <span style={styles.label}>Conta</span>
          <select value={contaId} onChange={(e) => setContaId(e.target.value)} style={styles.input}>
            <option value="ALL">Todas</option>
            {contas.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Início</span>
          <input type="date" value={inicioISO} onChange={(e) => setInicioISO(e.target.value)} style={styles.input} />
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Fim</span>
          <input type="date" value={fimISO} onChange={(e) => setFimISO(e.target.value)} style={styles.input} />
        </label>
 
        <label style={{ display: "flex", alignItems: "center", gap: 8, height: 40 }}>
          <input
            type="checkbox"
            checked={agruparPorDia}
            onChange={(e) => setAgruparPorDia(e.target.checked)}
          />
          <span style={{ fontSize: 13, opacity: 0.85, fontWeight: 700 }}>Agrupar por dia</span>
        </label>
        
        <label style={{ display: "flex", alignItems: "center", gap: 8, height: 40 }}>
          <input
            type="checkbox"
            checked={considerarPrevistos}
            onChange={(e) => setConsiderarPrevistos(e.target.checked)}
          />
          <span style={{ fontSize: 13, opacity: 0.85, fontWeight: 700 }}>Considerar previstos nos totais</span>
        </label>

        <Tooltip content="Recarregar fluxo de caixa no período">
          <button onClick={carregar} disabled={loading} style={{ ...ui.btnPrimary, opacity: loading ? 0.6 : 1 }}>
            🔄 Carregar
          </button>
        </Tooltip>

        <div style={{ marginLeft: 8, fontSize: 13, opacity: 0.8 }}>
          <strong>Conta:</strong> {tituloConta} &nbsp;|&nbsp; <strong>Período:</strong> {isoToBR(inicioISO)} a {isoToBR(fimISO)}
        </div>
      </div>

      {resumo ? (
        <div style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardLabel}>Saldo inicial</div>
            <div style={styles.cardValue}>R$ {brlFromCentavos(resumo.saldoInicial)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardLabel}>Entradas (OK)</div>
            <div style={styles.cardValue}>R$ {brlFromCentavos(resumo.entradas)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardLabel}>Saídas (OK)</div>
            <div style={styles.cardValue}>R$ {brlFromCentavos(resumo.saidas)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardLabel}>Saldo final</div>
            <div style={styles.cardValue}>R$ {brlFromCentavos(resumo.saldoFinal)}</div>
          </div>
        </div>
      ) : null}

      {loading ? <div>Carregando…</div> : null}
   
      <SaldoDiarioChart
        seriesDisplay={considerarPrevistos ? dailySeriesProjetado : dailySeriesEfetivo}
        seriesEfetivo={dailySeriesEfetivo}
        seriesProjetado={dailySeriesProjetado}
        brlFromCentavos={brlFromCentavos}
      />

      {contaId === "ALL" && resumoPorConta.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ margin: "10px 0" }}>Sumário por conta (no período)</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Conta</th>
                  <th style={styles.thRight}>Entradas</th>
                  <th style={styles.thRight}>Saídas</th>
                  <th style={styles.thRight}>Líquido</th>
                  <th style={styles.thRight}>Qtd</th>
                  <th style={styles.thRight}>Prev</th>
                  <th style={styles.thRight}>Efet</th>
                </tr>
              </thead>
              <tbody>
                {resumoPorConta.map((r) => (
                  <tr key={`RES_${r.contaId}`}>
                    <td style={styles.td}>{r.nome}</td>
                    <td style={styles.tdRight}>R$ {brlFromCentavos(r.entradas)}</td>
                    <td style={styles.tdRight}>R$ {brlFromCentavos(r.saidas)}</td>
                    <td style={styles.tdRight}><strong>R$ {brlFromCentavos(r.liquido)}</strong></td>
                    <td style={styles.tdRight}>{r.qtd}</td>
                    <td style={styles.tdRight}>{r.qtdPrev}</td>
                    <td style={styles.tdRight}>{r.qtdEfet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Data</th>
              <th style={styles.th}>Tipo</th>
              <th style={styles.th}>E/S</th>
              <th style={styles.th}>Conta</th>
              <th style={styles.th}>Histórico</th>
              <th style={styles.thRight}>Valor</th>
              <th style={styles.thRight}>Saldo após</th>
            </tr>
          </thead>
          <tbody>
            {rowsToRender.map((l) => {
              // ✅ subtotal do dia
              if (l._subtotal) {
                return (
                  <tr key={String(l.id)} style={{ background: "#f7f7f7" }}>
                    <td style={{ ...styles.td, fontWeight: 900 }}>{l.dataBR}</td>
                    <td style={styles.td} colSpan={3}>
                      <span style={{ fontWeight: 900, opacity: 0.8 }}>Subtotal do dia</span>
                    </td>
                      <td style={styles.td}>
                      <span style={{ opacity: 0.75 }}>Entradas - Saídas</span>
                    </td>
                    <td style={styles.tdRight}>
                      <span style={{ fontWeight: 900 }}>
                        R$ {brlFromCentavos(Number(l.entradasCentavos || 0) - Number(l.saidasCentavos || 0))}
                      </span>
                    </td>
                    <td style={styles.tdRight}>
                      <span style={{ fontWeight: 900 }}>R$ {brlFromCentavos(l._saldoApos)}</span>
                    </td>
                  </tr>
                );
              }
      
              const tipo = l._tipo || "—";
              const es = l.es || "—";
              const isPrev = String(tipo).toUpperCase() === "PREVISTO";
              const badge = isPrev ? styles.badgePrev : styles.badgeEfet;
    
              const val = Number(l.valorCentavos || 0);
              const signed = es === "S" ? -val : val;

              return (
                <tr
                  key={String(l.id)}
                  style={{
                    background: isPrev ? "#fffaf0" : "#fff",
                    opacity: l._isPrevisto && !l._impactaFluxo ? 0.55 : 1,
                  }}
                >
                  <td style={styles.td}>{l.dataBR || "—"}</td>
                  <td style={styles.td}>
                    <span style={badge}>
                      {tipo}{l._isPrevisto && !l._impactaFluxo ? " (não considerado)" : ""}
                    </span>
                  </td>
                  <td style={styles.td}>{es}</td>
                  <td style={styles.td}>{l.localLabel}</td>
                  <td style={styles.td}>{l.historico || "—"}</td>
                  <td style={styles.tdRight}>R$ {brlFromCentavos(signed)}</td>
                  <td style={styles.tdRight}>R$ {brlFromCentavos(l._saldoApos)}</td>
                </tr>
              );
            })}

            {!loading && rowsToRender.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 14, textAlign: "center", opacity: 0.7 }}>
                  Nenhum lançamento no período.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ui = {
  btnPrimary: {
    height: 40,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#111",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
};

// Catmull-Rom → cubic bezier (curva suave)
function smoothPath(pts) {
  if (pts.length < 2) return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const t = 0.4;
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) * t;
    const cp1y = p1.y + (p2.y - p0.y) * t;
    const cp2x = p2.x - (p3.x - p1.x) * t;
    const cp2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function SaldoDiarioChart({ seriesDisplay, seriesEfetivo, seriesProjetado, brlFromCentavos }) {
  const [hoverIdx, setHoverIdx] = React.useState(null);

  // ✅ padroniza: "series" é o que desenha na tela
  const series = seriesDisplay || [];


  const W = 980;
  const H = 260;
  const padL = 56;
  const padR = 16;
  const padT = 18;
  const padB = 38;

  if (!series || series.length === 0) {
    return (
      <div style={{ marginTop: 14, padding: 12, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, background: "#fff" }}>
        <strong>Desempenho diário</strong>
        <div style={{ marginTop: 8, opacity: 0.7 }}>Sem dados no período.</div>
      </div>
    );
  }

  const vals = series.map((p) => Number(p.saldoCentavos || 0));
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 0);

  const span = maxV - minV || 1;

  const xOf = (i) => {
    const n = series.length;
    if (n === 1) return padL;
    const usable = W - padL - padR;
    return padL + (usable * i) / (n - 1);
  };

  const yOf = (v) => {
    const usable = H - padT - padB;
    const t = (v - minV) / span; // 0..1
    // svg: y cresce para baixo
    return padT + usable * (1 - t);
  };

  const yZero = yOf(0);

  // cria segmentos com cor por sinal (azul >=0 / vermelho <0), com split ao cruzar zero
  const segments = [];
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i];
    const b = series[i + 1];
    const ax = xOf(i);
    const ay = yOf(a.saldoCentavos);
    const bx = xOf(i + 1);
    const by = yOf(b.saldoCentavos);

    const aPos = a.saldoCentavos >= 0;
    const bPos = b.saldoCentavos >= 0;

    if (aPos === bPos) {
      segments.push({ x1: ax, y1: ay, x2: bx, y2: by, pos: aPos });
    } else {
      // cruza zero: interpolar ponto de cruzamento
      const va = a.saldoCentavos;
      const vb = b.saldoCentavos;
      const t = (0 - va) / (vb - va); // 0..1
      const ix = ax + (bx - ax) * t;
      const iy = yZero;

      segments.push({ x1: ax, y1: ay, x2: ix, y2: iy, pos: aPos });
      segments.push({ x1: ix, y1: iy, x2: bx, y2: by, pos: bPos });
    }
  }

  // ticks simples no eixo Y (min, 0, max)
  const ticks = [
    { v: maxV, y: yOf(maxV), label: brlFromCentavos(maxV) },
    { v: 0, y: yZero, label: "0,00" },
    { v: minV, y: yOf(minV), label: brlFromCentavos(minV) },
  ];

  // rótulos no eixo X: primeiro e último dia
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <div style={{ marginTop: 14, padding: 12, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <strong>Desempenho diário (Saldo)</strong>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {first.label} → {last.label}
        </div>
      </div>
 
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", marginTop: 10 }}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const vbX = (x / rect.width) * W;

          const n = series.length;
          if (n <= 0) return;

          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < n; i++) {
            const xi = xOf(i);
            const d = Math.abs(xi - vbX);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
          setHoverIdx(best);
        }}
      >
        {/* eixo 0 */}
        <line x1={padL} y1={yZero} x2={W - padR} y2={yZero} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />

        {/* ticks Y */}
        {ticks.map((t, idx) => (
          <g key={`tick_${idx}`}>
            <line x1={padL - 6} y1={t.y} x2={padL} y2={t.y} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
            <text x={padL - 10} y={t.y + 4} fontSize="11" textAnchor="end" fill="rgba(0,0,0,0.75)">
              {t.label}
            </text>
          </g>
        ))}

        {/* crosshair (linha vertical do hover) */}
        {hoverIdx !== null ? (
          <line
            x1={xOf(hoverIdx)}
            y1={padT}
            x2={xOf(hoverIdx)}
            y2={H - padB}
            stroke="rgba(0,0,0,0.18)"
            strokeWidth="1"
          />
        ) : null}

        {/* segmentos agrupados como paths suaves */}
        {(() => {
          const groups = [];
          let cur = null;
          for (const seg of segments) {
            if (!cur || cur.pos !== seg.pos) {
              if (cur) groups.push(cur);
              cur = { pos: seg.pos, pts: [{ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }] };
            } else {
              cur.pts.push({ x: seg.x2, y: seg.y2 });
            }
          }
          if (cur) groups.push(cur);
          return groups.map((g, idx) => (
            <path
              key={`grp_${idx}`}
              d={smoothPath(g.pts)}
              fill="none"
              stroke={g.pos ? "#1d4ed8" : "#dc2626"}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ));
        })()}

        {/* pontos */}
        {series.map((p, i) => {
          const x = xOf(i);
          const y = yOf(p.saldoCentavos);
          const pos = p.saldoCentavos >= 0;
          return (
            <g key={`pt_${p.key}`}>
              <circle cx={x} cy={y} r="3" fill={pos ? "#1d4ed8" : "#dc2626"} />
              <title>{`${p.label} — R$ ${brlFromCentavos(p.saldoCentavos)}`}</title>
            </g>
          );
        })}

        {/* labels X (primeiro/último) */}
        <text x={padL} y={H - 12} fontSize="11" textAnchor="start" fill="rgba(0,0,0,0.7)">
          {first.label}
        </text>
        <text x={W - padR} y={H - 12} fontSize="11" textAnchor="end" fill="rgba(0,0,0,0.7)">
          {last.label}
        </text>
      </svg>

      {hoverIdx !== null ? (
        <div style={{
          marginTop: 8,
          padding: "10px 12px",
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 12,
          background: "#fff",
          display: "inline-block",
          fontSize: 13
        }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>
            {seriesDisplay[hoverIdx]?.label}
          </div>
          <div>
            <strong>Efetivo:</strong> R$ {brlFromCentavos(seriesEfetivo[hoverIdx]?.saldoCentavos || 0)}
          </div>
          <div>
            <strong>Efetivo + Previsto:</strong> R$ {brlFromCentavos(seriesProjetado[hoverIdx]?.saldoCentavos || 0)}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12, opacity: 0.8 }}>
        <span>● <span style={{ color: "#1d4ed8", fontWeight: 900 }}>Azul</span>: saldo ≥ 0</span>
        <span>● <span style={{ color: "#dc2626", fontWeight: 900 }}>Vermelho</span>: saldo &lt; 0</span>
      </div>
    </div>
  );
}

const styles = {
  field: { display: "flex", flexDirection: "column", gap: 6, minWidth: 220 },
  label: { fontSize: 12, opacity: 0.75, fontWeight: 700 },
  input: {
    height: 40,
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.15)",
    padding: "0 12px",
    outline: "none",
    background: "#fff",
  },

  cards: { display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr))", gap: 10, marginTop: 12 },
  card: { background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: 12 },
  cardLabel: { fontSize: 12, opacity: 0.7, fontWeight: 700 },
  cardValue: { fontSize: 18, fontWeight: 900, marginTop: 6 },

  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(0,0,0,0.08)" },
  th: { textAlign: "left", padding: "10px 12px", fontSize: 12, opacity: 0.75, borderBottom: "1px solid rgba(0,0,0,0.08)", background: "#fafafa" },
  thRight: { textAlign: "right", padding: "10px 12px", fontSize: 12, opacity: 0.75, borderBottom: "1px solid rgba(0,0,0,0.08)", background: "#fafafa" },
  td: { padding: "10px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)", fontSize: 13, verticalAlign: "top" },
  tdRight: { padding: "10px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)", fontSize: 13, textAlign: "right", verticalAlign: "top" },

  badgePrev: { display: "inline-block", padding: "3px 8px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: "#fff3cd", border: "1px solid #ffe69c" },
  badgeEfet: { display: "inline-block", padding: "3px 8px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: "#d1e7dd", border: "1px solid #a3cfbb" },
};
