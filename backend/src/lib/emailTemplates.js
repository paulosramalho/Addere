// ============================================================
// Email template functions shared between scheduler (server.js)
// and admin route module (routes/admin.js)
// ============================================================

const _MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

export function _fmtDatePT(d) {
  // Aceita Date, ISO string ("2026-02-25") ou qualquer valor
  let iso;
  if (d instanceof Date) {
    iso = d.toISOString();
  } else {
    iso = String(d);
  }
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  const dia = parseInt(m[3], 10);
  const mes = _MESES_PT[parseInt(m[2], 10) - 1] || m[2];
  const ano = m[1];
  return `${dia} de ${mes} de ${ano}`;
}

function _buildTabelaVencidos(lista) {
  const fmtBRL = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const riscoLabel = { NORMAL: "Normal", ATENCAO: "Atenção", ALTO_RISCO: "Alto Risco", DUVIDOSO: "Duvidoso" };
  const riscoCor = { NORMAL: "#6b7280", ATENCAO: "#92400e", ALTO_RISCO: "#c2410c", DUVIDOSO: "#b91c1c" };
  const riscoBg = { NORMAL: "#f1f5f9", ATENCAO: "#fef3c7", ALTO_RISCO: "#ffedd5", DUVIDOSO: "#fee2e2" };
  if (!lista.length) return "<p style='font-size:13px;color:#94a3b8;margin:0'>Nenhum lançamento nesta categoria.</p>";
  const linhas = lista.map(l => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">${_fmtDatePT(l.data)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">${l.clienteFornecedor || l.historico || "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;max-width:160px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${l.historico || "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600">${fmtBRL(l.valorCentavos)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${l.diasEmAtraso}d</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">
        <span style="background:${riscoBg[l.risco]};color:${riscoCor[l.risco]};padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600">${riscoLabel[l.risco]}</span>
      </td>
    </tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr style="background:#f8fafc">
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:left;border-bottom:2px solid #e5e7eb">Data</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:left;border-bottom:2px solid #e5e7eb">Cliente/Fornecedor</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:left;border-bottom:2px solid #e5e7eb">Histórico</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right;border-bottom:2px solid #e5e7eb">Valor</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;border-bottom:2px solid #e5e7eb">Dias</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;border-bottom:2px solid #e5e7eb">Risco</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
  </table>`;
}

export function buildEmailAlertaVencimentos(nome, parcelas1dia, parcelas7dias, repassesPendentes, saidas1dia, saidas7dias) {
  const fmtBRL = (c) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDate = (d) => {
    const s = d instanceof Date ? d.toISOString() : String(d);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  };

  const secao1 = parcelas1dia.length === 0 ? `<p style="color:#64748b;font-size:13px">Nenhuma parcela vence amanhã.</p>` : `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#fee2e2">
        <th style="padding:8px;text-align:left;border-bottom:1px solid #fca5a5">Cliente</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid #fca5a5">Contrato</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid #fca5a5">Parcela</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid #fca5a5">Valor</th>
      </tr></thead>
      <tbody>${parcelas1dia.map(p => `
        <tr style="border-bottom:1px solid #fee2e2">
          <td style="padding:8px">${p.clienteNome || "—"}</td>
          <td style="padding:8px">${p.contratoNumero || "—"}</td>
          <td style="padding:8px">#${p.numero}</td>
          <td style="padding:8px;text-align:right;font-weight:600">${fmtBRL(Number(p.valorPrevisto || 0) * 100)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  const secao2 = parcelas7dias.length === 0 ? `<p style="color:#64748b;font-size:13px">Nenhuma parcela vence nos próximos 7 dias.</p>` : `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#fef9c3">
        <th style="padding:8px;text-align:left;border-bottom:1px solid #fde047">Cliente</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid #fde047">Contrato</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid #fde047">Parcela</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid #fde047">Vencimento</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid #fde047">Valor</th>
      </tr></thead>
      <tbody>${parcelas7dias.map(p => `
        <tr style="border-bottom:1px solid #fef9c3">
          <td style="padding:8px">${p.clienteNome || "—"}</td>
          <td style="padding:8px">${p.contratoNumero || "—"}</td>
          <td style="padding:8px">#${p.numero}</td>
          <td style="padding:8px">${fmtDate(p.vencimento)}</td>
          <td style="padding:8px;text-align:right;font-weight:600">${fmtBRL(Number(p.valorPrevisto || 0) * 100)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  const secao3 = repassesPendentes.length === 0 ? `<p style="color:#64748b;font-size:13px">Nenhum repasse pendente.</p>` : `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#dbeafe">
        <th style="padding:8px;text-align:left;border-bottom:1px solid #93c5fd">Advogado</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid #93c5fd">Competência</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid #93c5fd">Valor Previsto</th>
      </tr></thead>
      <tbody>${repassesPendentes.map(r => `
        <tr style="border-bottom:1px solid #dbeafe">
          <td style="padding:8px">${r.advogado?.nome || "—"}</td>
          <td style="padding:8px">${String(r.competenciaMes).padStart(2,"0")}/${r.competenciaAno}</td>
          <td style="padding:8px;text-align:right;font-weight:600">${fmtBRL(Number(r.valorPrevisto || 0) * 100)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  const _tblSaidas = (lista, corBg, corBorda) => lista.length === 0
    ? `<p style="color:#64748b;font-size:13px">Nenhum lançamento de saída previsto.</p>`
    : `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:${corBg}">
        <th style="padding:8px;text-align:left;border-bottom:1px solid ${corBorda}">Fornecedor/Histórico</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid ${corBorda}">Data</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid ${corBorda}">Valor</th>
      </tr></thead>
      <tbody>${lista.map(l => `
        <tr style="border-bottom:1px solid ${corBg}">
          <td style="padding:8px">${l.clienteFornecedor || l.historico || "—"}</td>
          <td style="padding:8px">${fmtDate(l.data)}</td>
          <td style="padding:8px;text-align:right;font-weight:600">${fmtBRL(l.valorCentavos)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  const secao4 = _tblSaidas(saidas1dia, "#fff7ed", "#fdba74");
  const secao5 = _tblSaidas(saidas7dias, "#f0fdf4", "#86efac");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
  <div style="max-width:640px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="background:#1e3a5f;padding:24px 28px">
      <div style="color:#fff;font-size:22px;font-weight:700">Addere</div>
      <div style="color:#93c5fd;font-size:14px;margin-top:4px">Alerta Financeiro — ${new Date().toLocaleDateString("pt-BR")}</div>
    </div>
    <div style="padding:24px 28px">
      <p style="color:#334155;margin:0 0 4px 0;font-size:15px">Olá, <strong>${nome}</strong>.</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px 0">Resumo financeiro do dia — entradas e saídas previstas.</p>

      <!-- ── ENTRADAS ── -->
      <div style="font-size:13px;font-weight:700;color:#475569;letter-spacing:.05em;text-transform:uppercase;margin-bottom:12px">↓ Entradas a Receber</div>

      <!-- D-1 ENTRADAS -->
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:18px">🔴</span>
          <span style="font-weight:700;color:#dc2626;font-size:15px">Vencem AMANHÃ (${parcelas1dia.length} parcela${parcelas1dia.length !== 1 ? "s" : ""})</span>
        </div>
        ${secao1}
      </div>

      <!-- D-7 ENTRADAS -->
      <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:16px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:18px">🟡</span>
          <span style="font-weight:700;color:#ca8a04;font-size:15px">Próximos 7 dias (${parcelas7dias.length} parcela${parcelas7dias.length !== 1 ? "s" : ""})</span>
        </div>
        ${secao2}
      </div>

      <!-- ── SAÍDAS ── -->
      <div style="font-size:13px;font-weight:700;color:#475569;letter-spacing:.05em;text-transform:uppercase;margin-bottom:12px">↑ Saídas Previstas (Livro Caixa)</div>

      <!-- D-1 SAÍDAS -->
      <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:18px">🟠</span>
          <span style="font-weight:700;color:#ea580c;font-size:15px">Saídas AMANHÃ (${saidas1dia.length} lançamento${saidas1dia.length !== 1 ? "s" : ""})</span>
        </div>
        ${secao4}
      </div>

      <!-- D-7 SAÍDAS -->
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:18px">🟢</span>
          <span style="font-weight:700;color:#16a34a;font-size:15px">Saídas próximos 7 dias (${saidas7dias.length} lançamento${saidas7dias.length !== 1 ? "s" : ""})</span>
        </div>
        ${secao5}
      </div>

      <!-- REPASSES -->
      <div style="font-size:13px;font-weight:700;color:#475569;letter-spacing:.05em;text-transform:uppercase;margin-bottom:12px">↑ Repasses a Efetuar</div>
      <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:18px">🔵</span>
          <span style="font-weight:700;color:#1d4ed8;font-size:15px">Repasses Pendentes (${repassesPendentes.length} repasse${repassesPendentes.length !== 1 ? "s" : ""})</span>
        </div>
        ${secao3}
      </div>
    </div>
    <div style="padding:16px 28px;background:#f1f5f9;text-align:center;font-size:11px;color:#94a3b8">
      Addere Control — notificação automática
    </div>
  </div>
</body></html>`;
}

export function buildEmailVencidos(nomeDestinatario, enriched) {
  const fmtBRL = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const riscoLabel = { NORMAL: "Normal", ATENCAO: "Atenção", ALTO_RISCO: "Alto Risco", DUVIDOSO: "Duvidoso" };
  const riscoCor = { NORMAL: "#6b7280", ATENCAO: "#92400e", ALTO_RISCO: "#c2410c", DUVIDOSO: "#b91c1c" };
  const riscoBg = { NORMAL: "#f1f5f9", ATENCAO: "#fef3c7", ALTO_RISCO: "#ffedd5", DUVIDOSO: "#fee2e2" };

  const aReceber = enriched.filter(l => l.es === "E");
  const aPagar   = enriched.filter(l => l.es === "S");
  const totalReceber = aReceber.reduce((s, l) => s + l.valorCentavos, 0);
  const totalPagar   = aPagar.reduce((s, l) => s + l.valorCentavos, 0);
  const total        = enriched.reduce((s, l) => s + l.valorCentavos, 0);

  const contagens = enriched.reduce(
    (acc, l) => { acc[l.risco] = (acc[l.risco] || 0) + 1; return acc; },
    {}
  );

  const cardsRisco = ["NORMAL", "ATENCAO", "ALTO_RISCO", "DUVIDOSO"].map(r => `
    <td style="padding:12px 16px;text-align:center;background:${riscoBg[r]};border-radius:8px;margin:4px">
      <div style="font-size:11px;font-weight:600;color:${riscoCor[r]};text-transform:uppercase">${riscoLabel[r]}</div>
      <div style="font-size:22px;font-weight:700;color:${riscoCor[r]}">${contagens[r] || 0}</div>
    </td>`).join("<td style='width:8px'></td>");

  const secaoReceber = aReceber.length > 0 ? `
    <div style="margin-bottom:24px">
      <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:13px;font-weight:700;color:#15803d">💰 A RECEBER</span>
          <span style="font-size:12px;color:#166534;margin-left:8px">${aReceber.length} lançamento(s)</span>
        </div>
        <span style="font-size:16px;font-weight:700;color:#15803d">${fmtBRL(totalReceber)}</span>
      </div>
      ${_buildTabelaVencidos(aReceber)}
    </div>` : "";

  const secaoPagar = aPagar.length > 0 ? `
    <div style="margin-bottom:24px">
      <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:13px;font-weight:700;color:#b91c1c">💸 A PAGAR</span>
          <span style="font-size:12px;color:#991b1b;margin-left:8px">${aPagar.length} lançamento(s)</span>
        </div>
        <span style="font-size:16px;font-weight:700;color:#b91c1c">${fmtBRL(totalPagar)}</span>
      </div>
      ${_buildTabelaVencidos(aPagar)}
    </div>` : "";

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#1e3a5f;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px">Resumo diário — Vencidos em Aberto</div>
      <div style="font-size:12px;color:#bfdbfe;margin-top:4px">Mensagem direcionada à ${nomeDestinatario}</div>
    </div>
    <div style="padding:24px 28px">
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;background:#f1f5f9;border-radius:8px;padding:14px 18px">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600">Total geral</div>
          <div style="font-size:22px;font-weight:700;color:#0f172a">${fmtBRL(total)}</div>
          <div style="font-size:12px;color:#94a3b8">${enriched.length} lançamento(s)</div>
        </div>
        ${aReceber.length > 0 ? `<div style="flex:1;min-width:140px;background:#dcfce7;border-radius:8px;padding:14px 18px">
          <div style="font-size:11px;color:#15803d;text-transform:uppercase;font-weight:600">💰 A receber</div>
          <div style="font-size:22px;font-weight:700;color:#15803d">${fmtBRL(totalReceber)}</div>
          <div style="font-size:12px;color:#166534">${aReceber.length} lançamento(s)</div>
        </div>` : ""}
        ${aPagar.length > 0 ? `<div style="flex:1;min-width:140px;background:#fee2e2;border-radius:8px;padding:14px 18px">
          <div style="font-size:11px;color:#b91c1c;text-transform:uppercase;font-weight:600">💸 A pagar</div>
          <div style="font-size:22px;font-weight:700;color:#b91c1c">${fmtBRL(totalPagar)}</div>
          <div style="font-size:12px;color:#991b1b">${aPagar.length} lançamento(s)</div>
        </div>` : ""}
      </div>
      <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px"><tr>${cardsRisco}</tr></table>
      ${secaoReceber}
      ${secaoPagar}
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere Control — enviado automaticamente às 8h
    </div>
  </div>
</body></html>`;
}

export function buildEmailVencimentoCliente(nomeCliente, parcelas1dia, parcelas7dias) {
  const fmtBRL = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtData = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const linhasTabela = (lista) => lista.map(p => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">${p.contrato?.numeroContrato || "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${p.numero}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${fmtData(p.vencimento)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600">${fmtBRL(p.valorPrevisto)}</td>
    </tr>`).join("");

  const tabelaHeader = `<table style="width:100%;border-collapse:collapse;margin-top:8px">
    <thead><tr style="background:#f8fafc">
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:left;border-bottom:2px solid #e5e7eb">Contrato</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;border-bottom:2px solid #e5e7eb">Parcela</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;border-bottom:2px solid #e5e7eb">Vencimento</th>
      <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right;border-bottom:2px solid #e5e7eb">Valor</th>
    </tr></thead><tbody>`;

  const secaoD1 = parcelas1dia.length > 0 ? `
    <div style="background:#fee2e2;border-left:4px solid #ef4444;border-radius:6px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:700;color:#b91c1c;margin-bottom:6px">Vence amanhã (${parcelas1dia.length} parcela${parcelas1dia.length > 1 ? "s" : ""})</div>
      ${tabelaHeader}${linhasTabela(parcelas1dia)}</tbody></table>
    </div>` : "";

  const secaoD7 = parcelas7dias.length > 0 ? `
    <div style="background:#fef9c3;border-left:4px solid #eab308;border-radius:6px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:700;color:#854d0e;margin-bottom:6px">Vence nos próximos 7 dias (${parcelas7dias.length} parcela${parcelas7dias.length > 1 ? "s" : ""})</div>
      ${tabelaHeader}${linhasTabela(parcelas7dias)}</tbody></table>
    </div>` : "";

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#1e3a5f;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px">Lembrete de vencimento de parcela</div>
    </div>
    <div style="padding:24px 28px">
      <p style="font-size:14px;color:#374151;margin:0 0 20px">Olá, <strong>${nomeCliente}</strong>.<br>
      Identificamos parcela(s) próximas do vencimento vinculadas ao(s) seu(s) contrato(s) com Addere.</p>
      ${secaoD1}${secaoD7}
      <p style="font-size:13px;color:#6b7280;margin-top:20px">Para dúvidas ou mais informações, entre em contato com nosso escritório.</p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere — aviso automático · Para não receber estes e-mails, solicite opt-out ao escritório.
    </div>
  </div>
</body></html>`;
}

export function buildEmailAtrasoCliente(nomeCliente, parcelas) {
  const fmtBRL = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtData = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const linhasTabela = parcelas.map(p => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">${p.contrato?.numeroContrato || "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${p.numero}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${fmtData(p.vencimento)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;font-weight:600;color:#b91c1c">${p.diasEmAtraso} dia${p.diasEmAtraso > 1 ? "s" : ""}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600">${fmtBRL(p.valorPrevisto)}</td>
    </tr>`).join("");

  const ehReincidencia = parcelas.some(p => p.diasEmAtraso > 1);
  const subtitulo = ehReincidencia ? "Lembrete: parcela(s) em atraso" : "Parcela(s) vencida(s) em aberto";

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#7f1d1d;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#fca5a5;margin-top:4px">${subtitulo}</div>
    </div>
    <div style="padding:24px 28px">
      <p style="font-size:14px;color:#374151;margin:0 0 20px">Olá, <strong>${nomeCliente}</strong>.<br>
      Constatamos que a(s) parcela(s) abaixo encontra(m)-se vencida(s) e ainda não foram regularizadas.</p>
      <div style="background:#fee2e2;border-left:4px solid #ef4444;border-radius:6px;padding:14px 16px;margin-bottom:16px">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:rgba(0,0,0,.04)">
            <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:left;border-bottom:2px solid #fca5a5">Contrato</th>
            <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;border-bottom:2px solid #fca5a5">Parcela</th>
            <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;border-bottom:2px solid #fca5a5">Vencimento</th>
            <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:center;border-bottom:2px solid #fca5a5">Atraso</th>
            <th style="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right;border-bottom:2px solid #fca5a5">Valor</th>
          </tr></thead>
          <tbody>${linhasTabela}</tbody>
        </table>
      </div>
      <p style="font-size:13px;color:#6b7280;margin-top:20px">Pedimos que entre em contato com nosso escritório para regularização ou esclarecimentos.</p>
      <p style="font-size:13px;color:#6b7280;margin-top:10px">Caso já tenha efetuado o pagamento, por favor, desconsidere essa mensagem. Agradecemos se puder nos enviar o comprovante de pagamento, para ajustarmos nossos registros.</p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere — aviso automático · Para não receber estes e-mails, solicite opt-out ao escritório.
    </div>
  </div>
</body></html>`;
}

export function buildEmailRecebimentoCliente(nomeCliente, { numeroContrato, numeroParcela, dataRecebimento, valorRecebido, meioRecebimento }) {
  const fmtBRL = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const meioPT = { PIX: "Pix", BOLETO: "Boleto", TRANSFERENCIA: "Transferência", DINHEIRO: "Dinheiro", CARTAO: "Cartão", CHEQUE: "Cheque" };

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#14532d;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#86efac;margin-top:4px">Confirmação de pagamento recebido</div>
    </div>
    <div style="padding:24px 28px">
      <p style="font-size:14px;color:#374151;margin:0 0 20px">Olá, <strong>${nomeCliente}</strong>.<br>
      Confirmamos o recebimento do pagamento referente à parcela abaixo.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px 24px;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;width:160px">Contrato</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${numeroContrato || "—"}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Parcela</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${numeroParcela}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Data</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${dataRecebimento}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Forma</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${meioPT[meioRecebimento] || meioRecebimento}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Valor</td>
            <td style="padding:6px 0;font-size:16px;font-weight:700;color:#166534">${fmtBRL(valorRecebido)}</td>
          </tr>
        </table>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0">Em caso de dúvidas, entre em contato com nosso escritório.</p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere — confirmação automática de pagamento.
    </div>
  </div>
</body></html>`;
}
