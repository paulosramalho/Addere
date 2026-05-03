import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppTemplate } from "../lib/whatsapp.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";

const IS_TEST = process.env.NODE_ENV === "test";

// ── WhatsApp config (read from env at module load time) ──────────────────────
const WA_API_URL = process.env.WA_PHONE_NUMBER_ID
  ? `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  : null;
const WA_TOKEN = process.env.WA_TOKEN || null;

// ── Phone normalizer (E.164 for WA) ─────────────────────────────────────────
function _waPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return "55" + digits;
  return digits.length >= 8 ? "55" + digits : null;
}

// ============================================================
// SCHEDULER — E-mail diário de Alertas de Vencimento D-7/D-1 (8h BRT = 11h UTC)
// ============================================================
let _ultimoEmailAlertas = null; // "YYYY-MM-DD" — L1 cache (sobrevivência ao reinício: veja _schedulerShouldRun)

function buildEmailAlertaVencimentos(nome, parcelas1dia, parcelas7dias, saidas1dia, saidas7dias) {
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

    </div>
    <div style="padding:16px 28px;background:#f1f5f9;text-align:center;font-size:11px;color:#94a3b8">
      Addere On — notificação automática
    </div>
  </div>
</body></html>`;
}

// ── Helpers de formatação de e-mail ─────────────────────────────────────────
const _MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function _fmtDatePT(d) {
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

function _mesAliuqota(competenciaMes, competenciaAno) {
  // Alíquota é definida para M+1 (mês seguinte ao pagamento)
  const mesIdx = competenciaMes; // 1-based → após +1 fica no próximo
  if (mesIdx >= 12) return { nome: _MESES_PT[0], ano: competenciaAno + 1 };
  return { nome: _MESES_PT[mesIdx], ano: competenciaAno };
}

// ── E-mails para clientes: vencimento próximo ────────────────────────────────
function buildEmailVencimentoCliente(nomeCliente, parcelas1dia, parcelas7dias) {
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

// ── Aviso imediato ao cliente quando parcelas estão dentro da janela de alerta ──
async function _dispararAvisoImediatoParcelas(contrato) {
  const cliente = contrato.cliente;
  if (!cliente?.email || cliente.naoEnviarEmails) return;

  const hoje = new Date();
  const inicioDiaMs = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());

  const d1 = [], d7 = [], atrasadas = [];

  for (const p of contrato.parcelas || []) {
    if (p.status !== "PREVISTA") continue;
    const vencMs = new Date(p.vencimento).getTime();
    const dias = Math.floor((vencMs - inicioDiaMs) / 86400000);
    const enriched = { ...p, contrato: { numeroContrato: contrato.numeroContrato } };
    if (dias < 0)      atrasadas.push({ ...enriched, diasEmAtraso: Math.abs(dias) });
    else if (dias <= 1) d1.push(enriched);
    else if (dias <= 7) d7.push(enriched);
    // dias > 7 → scheduler cobre em tempo normal
  }

  if (d1.length > 0 || d7.length > 0) {
    await sendEmail({
      to: cliente.email,
      subject: `⏰ Lembrete — parcela(s) próximas do vencimento`,
      html: buildEmailVencimentoCliente(cliente.nomeRazaoSocial, d1, d7),
    });
    console.log(`📧 Aviso imediato (vencimento próximo) enviado para ${cliente.email}`);
  }

  if (atrasadas.length > 0) {
    await sendEmail({
      to: cliente.email,
      subject: `⚠️ Parcela em atraso — Addere`,
      html: buildEmailAtrasoCliente(cliente.nomeRazaoSocial, atrasadas),
    });
    console.log(`📧 Aviso imediato (atraso) enviado para ${cliente.email}`);
  }
}

// ── E-mails para clientes: parcela em atraso ─────────────────────────────────
function buildEmailAtrasoCliente(nomeCliente, parcelas) {
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

export function startVencimentosScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    const agora = new Date();
    if (agora.getUTCHours() !== 11) return; // 11h UTC = 8h BRT
    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoEmailAlertas === hoje) return; // L1 cache
    if (!await _schedulerShouldRun("alertas_diarios", hoje)) { _ultimoEmailAlertas = hoje; return; }
    _ultimoEmailAlertas = hoje;
    await _schedulerMarkRun("alertas_diarios", hoje);

    try {
      // D-1: parcelas vencendo amanhã
      const amanha = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1));
      const amanhaFim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1, 23, 59, 59, 999));

      // D-2 a D-7: parcelas vencendo nos próximos 7 dias (excluindo amanhã)
      const d2 = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 2));
      const d7 = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 7, 23, 59, 59, 999));

      const [rawD1, rawD7, saidasD1, saidasD7] = await Promise.all([
        prisma.parcelaContrato.findMany({
          where: { status: { in: ["PREVISTA", "ATRASADA"] }, vencimento: { gte: amanha, lte: amanhaFim } },
          include: { contrato: { select: { numeroContrato: true, cliente: { select: { id: true, nomeRazaoSocial: true, email: true, naoEnviarEmails: true, telefone: true } } } } },
          orderBy: { vencimento: "asc" },
        }),
        prisma.parcelaContrato.findMany({
          where: { status: { in: ["PREVISTA", "ATRASADA"] }, vencimento: { gte: d2, lte: d7 } },
          include: { contrato: { select: { numeroContrato: true, cliente: { select: { id: true, nomeRazaoSocial: true, email: true, naoEnviarEmails: true, telefone: true } } } } },
          orderBy: { vencimento: "asc" },
        }),
        prisma.livroCaixaLancamento.findMany({
          where: { es: "S", statusFluxo: "PREVISTO", data: { gte: amanha, lte: amanhaFim } },
          orderBy: { data: "asc" },
          select: { id: true, data: true, clienteFornecedor: true, historico: true, valorCentavos: true },
        }),
        prisma.livroCaixaLancamento.findMany({
          where: { es: "S", statusFluxo: "PREVISTO", data: { gte: d2, lte: d7 } },
          orderBy: { data: "asc" },
          select: { id: true, data: true, clienteFornecedor: true, historico: true, valorCentavos: true },
        }),
      ]);

      if (rawD1.length === 0 && rawD7.length === 0 && saidasD1.length === 0 && saidasD7.length === 0) return;

      // Normaliza dados para o template
      const norm1 = rawD1.map(p => ({ ...p, clienteNome: p.contrato?.cliente?.nomeRazaoSocial, contratoNumero: p.contrato?.numeroContrato }));
      const norm7 = rawD7.map(p => ({ ...p, clienteNome: p.contrato?.cliente?.nomeRazaoSocial, contratoNumero: p.contrato?.numeroContrato }));

      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { email: true, nome: true, whatsapp: true, telefone: true },
      });

      await Promise.allSettled(admins.map(admin => sendEmail({
        to: admin.email,
        subject: `⏰ Addere — Alertas financeiros: ${rawD1.length} entrada(s) amanhã · ${saidasD1.length} saída(s) amanhã`,
        html: buildEmailAlertaVencimentos(admin.nome, norm1, norm7, saidasD1, saidasD7),
      })));
      for (const admin of admins) {

        // WhatsApp — envia resumo compacto (não-operacional até ZAPI_INSTANCE_ID ser configurado)
        if (admin.whatsapp || admin.telefone) {
          const linhas = [
            `⏰ *Addere — Resumo financeiro ${new Date().toLocaleDateString("pt-BR")}*`,
            ``,
            `🔴 Entradas amanhã: *${rawD1.length}*`,
            `🟡 Entradas próx. 7 dias: *${rawD7.length}*`,
            `🟠 Saídas amanhã: *${saidasD1.length}*`,
            `🟢 Saídas próx. 7 dias: *${saidasD7.length}*`,
          ];
          sendWhatsApp(admin.whatsapp || admin.telefone, linhas.join("\n")).catch(() => {});
        }
      }
      if (admins.length > 0) {
        console.log(`📧 Alertas D-7/D-1 enviados para ${admins.length} admin(s)`);
      }

      // ── E-mail para clientes (D-1 / D-7) ─────────────────────────────────────
      const porClienteVenc = new Map(); // clienteId → { nome, email, d1[], d7[] }
      const _agruparVenc = (lista, slot) => {
        for (const p of lista) {
          const c = p.contrato?.cliente;
          if (!c?.email || c.naoEnviarEmails) continue;
          if (!porClienteVenc.has(c.id))
            porClienteVenc.set(c.id, { nome: c.nomeRazaoSocial, email: c.email, d1: [], d7: [] });
          porClienteVenc.get(c.id)[slot].push(p);
        }
      };
      _agruparVenc(rawD1, "d1");
      _agruparVenc(rawD7, "d7");
      await Promise.allSettled([...porClienteVenc.values()].map(({ nome, email, d1, d7 }) => sendEmail({
        to: email,
        subject: `⏰ Lembrete — parcela(s) próximas do vencimento`,
        html: buildEmailVencimentoCliente(nome, d1, d7),
      })));
      if (porClienteVenc.size > 0)
        console.log(`📧 Alertas vencimento (clientes) enviados para ${porClienteVenc.size} cliente(s)`);

      // ── WhatsApp vencimento (D-1 e D-2..D-7, igual ao e-mail) ───────────────
      if (WA_API_URL && WA_TOKEN) {
        const fmtWAData = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Belem" });
        const fmtWAVal  = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
        const _sendVencWA = (parcelas) => {
          for (const p of parcelas) {
            const c = p.contrato?.cliente;
            const phone = _waPhone(c?.telefone);
            if (!phone) continue;
            sendWhatsAppTemplate(phone, "vencimento_parcela", "pt_BR", [{
              type: "body",
              parameters: [
                { type: "text", text: c.nomeRazaoSocial || "" },
                { type: "text", text: fmtWAVal(p.valorPrevisto) },
                { type: "text", text: fmtWAData(p.vencimento) },
              ],
            }]).catch(() => {});
          }
        };
        _sendVencWA(rawD1);
        _sendVencWA(rawD7);
        const totalWA = rawD1.length + rawD7.length;
        if (totalWA > 0) console.log(`📱 WhatsApp vencimento: D-1=${rawD1.length} D-2..D-7=${rawD7.length}`);
      }
    } catch (err) {
      console.error("❌ Erro no e-mail de alertas:", err.message);
    }
  }, 60 * 60 * 1000);
}

export {
  _dispararAvisoImediatoParcelas,
  buildEmailAlertaVencimentos,
  buildEmailVencimentoCliente,
  buildEmailAtrasoCliente,
  buildEmailRecebimentoCliente,
  buildEmailAcuseRecebimentoCliente,
  _fmtDatePT,
  _MESES_PT,
  _mesAliuqota,
};

// ── E-mail: confirmação de recebimento ao cliente ─────────────────────────────
function buildEmailRecebimentoCliente(nomeCliente, { numeroContrato, numeroParcela, dataRecebimento, valorRecebido, meioRecebimento }) {
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

// ── Acuse de recebimento ao cliente (resposta automática ao comprovante) ──────
function buildEmailAcuseRecebimentoCliente(nomeCliente, assuntoOriginal, parcelaConfirmada) {
  const msgParcela = parcelaConfirmada
    ? "O pagamento foi registrado automaticamente e estará disponível para revisão da nossa equipe em breve."
    : "Nossa equipe irá analisar e registrar o pagamento em breve.";
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#14532d;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#86efac;margin-top:4px">Confirmação de recebimento</div>
    </div>
    <div style="padding:24px 28px">
      <p style="font-size:14px;color:#374151;margin:0 0 16px">Olá, <strong>${nomeCliente}</strong>.</p>
      <p style="font-size:14px;color:#374151;margin:0 0 12px">Recebemos sua mensagem referente a <em>"${assuntoOriginal}"</em>.</p>
      <p style="font-size:14px;color:#374151;margin:0 0 20px">${msgParcela}</p>
      <p style="font-size:13px;color:#6b7280;margin:0">Em caso de dúvidas, entre em contato com nosso escritório.</p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere — resposta automática · Por favor, não responda a este e-mail.
    </div>
  </div>
</body></html>`;
}
