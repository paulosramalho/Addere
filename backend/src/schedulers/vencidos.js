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

// ── Date formatter helper ────────────────────────────────────────────────────
function _fmtDatePT(d) {
  const _MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
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

// ============================================================
// SCHEDULER — E-mail diário de Vencidos em Aberto (8h BRT = 11h UTC)
// ============================================================
let _ultimoEmailVencidos = null; // "YYYY-MM-DD" — L1 cache

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

function buildEmailVencidos(nomeDestinatario, enriched) {
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

function buildEmailVencidosAdvogado(nomeAdvogado, enriched) {
  const fmtBRL = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const aReceber = enriched.filter(l => l.es === "E");
  const aPagar   = enriched.filter(l => l.es === "S");
  const totalReceber = aReceber.reduce((s, l) => s + l.valorCentavos, 0);
  const totalPagar   = aPagar.reduce((s, l) => s + l.valorCentavos, 0);
  const total        = enriched.reduce((s, l) => s + l.valorCentavos, 0);

  const secaoReceber = aReceber.length > 0 ? `
    <div style="margin-bottom:24px">
      <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:13px;font-weight:700;color:#15803d">💰 A RECEBER</span>
          <span style="font-size:12px;color:#166534;margin-left:8px">${aReceber.length} parcela(s)</span>
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
          <span style="font-size:12px;color:#991b1b;margin-left:8px">${aPagar.length} parcela(s)</span>
        </div>
        <span style="font-size:16px;font-weight:700;color:#b91c1c">${fmtBRL(totalPagar)}</span>
      </div>
      ${_buildTabelaVencidos(aPagar)}
    </div>` : "";

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#1e3a5f;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px">Lançamentos vencidos em aberto — ${nomeAdvogado}</div>
    </div>
    <div style="padding:24px 28px">
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;background:#f1f5f9;border-radius:8px;padding:14px 18px">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600">Total</div>
          <div style="font-size:22px;font-weight:700;color:#0f172a">${fmtBRL(total)}</div>
          <div style="font-size:12px;color:#94a3b8">${enriched.length} parcela(s)</div>
        </div>
        ${aReceber.length > 0 ? `<div style="flex:1;min-width:140px;background:#dcfce7;border-radius:8px;padding:14px 18px">
          <div style="font-size:11px;color:#15803d;text-transform:uppercase;font-weight:600">💰 A receber</div>
          <div style="font-size:22px;font-weight:700;color:#15803d">${fmtBRL(totalReceber)}</div>
          <div style="font-size:12px;color:#166534">${aReceber.length} parcela(s)</div>
        </div>` : ""}
        ${aPagar.length > 0 ? `<div style="flex:1;min-width:140px;background:#fee2e2;border-radius:8px;padding:14px 18px">
          <div style="font-size:11px;color:#b91c1c;text-transform:uppercase;font-weight:600">💸 A pagar</div>
          <div style="font-size:22px;font-weight:700;color:#b91c1c">${fmtBRL(totalPagar)}</div>
          <div style="font-size:12px;color:#991b1b">${aPagar.length} parcela(s)</div>
        </div>` : ""}
      </div>
      ${secaoReceber}
      ${secaoPagar}
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere Control — enviado automaticamente às 8h
    </div>
  </div>
</body></html>`;
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

export function startVencidosScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    const agora = new Date();
    if (agora.getUTCHours() !== 11) return; // 11h UTC = 8h BRT
    const hoje = agora.toISOString().slice(0, 10);
    if (_ultimoEmailVencidos === hoje) return; // L1 cache
    if (!await _schedulerShouldRun("alertas_vencidos", hoje)) { _ultimoEmailVencidos = hoje; return; }
    _ultimoEmailVencidos = hoje;
    await _schedulerMarkRun("alertas_vencidos", hoje);

    try {
      const inicioDia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 3, 0, 0)); // T03:00Z = meia-noite BRT
      const items = await prisma.livroCaixaLancamento.findMany({
        where: { statusFluxo: "PREVISTO", data: { lt: inicioDia } },
        include: { conta: true },
        orderBy: [{ data: "asc" }],
      });
      if (items.length === 0) return; // sem vencidos — não envia

      const agora2 = Date.now();
      const enriched = items.map(l => {
        const dias = Math.floor((agora2 - new Date(l.data).getTime()) / 86400000);
        const risco = dias <= 30 ? "NORMAL" : dias <= 60 ? "ATENCAO" : dias <= 90 ? "ALTO_RISCO" : "DUVIDOSO";
        return { ...l, diasEmAtraso: dias, risco };
      });

      // ── 1. E-mail para admins (lista completa) ──────────────────────────────
      const admins = await prisma.usuario.findMany({
        where: { role: "ADMIN", ativo: true },
        select: { email: true, nome: true },
      });
      if (admins.length > 0) {
        await Promise.allSettled(admins.map(admin => sendEmail({
          to: admin.email,
          subject: `📋 Addere — ${items.length} lançamento(s) vencido(s) em aberto`,
          html: buildEmailVencidos(admin.nome, enriched),
        })));
        console.log(`📧 E-mail vencidos (admins) enviado para ${admins.length} admin(s)`);
      }

      // ── 2. E-mail personalizado para advogados com PARCELA_PREVISTA ─────────
      const parcelaVencidos = enriched.filter(
        l => l.origem === "PARCELA_PREVISTA" && l.referenciaOrigem
      );
      if (parcelaVencidos.length === 0) return;

      // Extrai parcelaId → lancamento
      const parcelaIdParaLanc = new Map(); // parcelaId(number) → lancamento enriched
      for (const l of parcelaVencidos) {
        const m = String(l.referenciaOrigem).match(/PARCELA_(\d+)/);
        if (m) parcelaIdParaLanc.set(Number(m[1]), l);
      }
      const parcelaIds = [...parcelaIdParaLanc.keys()];

      // Busca splits com dados do advogado
      const splits = await prisma.parcelaSplitAdvogado.findMany({
        where: { parcelaId: { in: parcelaIds } },
        include: { advogado: { select: { id: true, nome: true, email: true, ativo: true } } },
      });

      // Agrupa por advogado: advogadoId → { nome, email, vencidos[] }
      const porAdvogado = new Map(); // advogadoId → { nome, email, vencidos[] }
      for (const split of splits) {
        const adv = split.advogado;
        if (!adv.ativo || !adv.email) continue;
        const lanc = parcelaIdParaLanc.get(split.parcelaId);
        if (!lanc) continue;
        if (!porAdvogado.has(adv.id)) {
          porAdvogado.set(adv.id, { nome: adv.nome, email: adv.email, vencidos: [] });
        }
        // Evita duplicatas (mesmo lançamento, dois splits do mesmo advogado)
        const bucket = porAdvogado.get(adv.id);
        if (!bucket.vencidos.find(v => v.id === lanc.id)) {
          bucket.vencidos.push(lanc);
        }
      }

      for (const { nome, email, vencidos } of porAdvogado.values()) {
        const htmlAdv = buildEmailVencidosAdvogado(nome, vencidos);
        await sendEmail({
          to: email,
          subject: `📋 Addere — ${vencidos.length} parcela(s) vencida(s) em aberto`,
          html: htmlAdv,
        });
      }
      if (porAdvogado.size > 0) {
        console.log(`📧 E-mail vencidos (advogados) enviado para ${porAdvogado.size} advogado(s)`);
      }

      // ── 3. E-mail de atraso para clientes (D+1, D+7, D+15) ──────────────────
      const MILESTONES = [1, 7, 15];
      const parcelasAtrasadas = await prisma.parcelaContrato.findMany({
        where: { status: { in: ["PREVISTA", "ATRASADA"] }, vencimento: { lt: inicioDia } },
        include: {
          contrato: {
            select: {
              numeroContrato: true,
              cliente: { select: { id: true, nomeRazaoSocial: true, email: true, naoEnviarEmails: true, telefone: true } },
              repasseAdvogadoPrincipal: { select: { id: true, nome: true, telefone: true, ativo: true } },
              repasseIndicacaoAdvogado: { select: { id: true, nome: true, telefone: true, ativo: true } },
            },
          },
        },
        orderBy: { vencimento: "asc" },
      });
      const inicioDiaMs = inicioDia.getTime();
      const porClienteAtraso = new Map(); // clienteId → { nome, email, parcelas[] }
      for (const p of parcelasAtrasadas) {
        const c = p.contrato?.cliente;
        if (!c?.email || c.naoEnviarEmails) continue;
        const dias = Math.floor((inicioDiaMs - new Date(p.vencimento).getTime()) / 86400000);
        if (!MILESTONES.includes(dias)) continue;
        if (!porClienteAtraso.has(c.id))
          porClienteAtraso.set(c.id, { nome: c.nomeRazaoSocial, email: c.email, parcelas: [] });
        porClienteAtraso.get(c.id).parcelas.push({ ...p, diasEmAtraso: dias });
      }
      for (const { nome, email, parcelas } of porClienteAtraso.values()) {
        await sendEmail({
          to: email,
          subject: `⚠️ Parcela em atraso — Addere`,
          html: buildEmailAtrasoCliente(nome, parcelas),
        });
      }
      if (porClienteAtraso.size > 0)
        console.log(`📧 E-mail atraso (clientes) enviado para ${porClienteAtraso.size} cliente(s)`);

      // ── WhatsApp atraso (D+1, D+7, D+15) ───────────────────────────────────
      if (WA_API_URL && WA_TOKEN) {
        const WA_MILESTONES = [1, 7, 15];
        const fmtWAData = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Belem" });
        const fmtWAVal  = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

        // Clientes
        for (const p of parcelasAtrasadas) {
          const c = p.contrato?.cliente;
          const phone = _waPhone(c?.telefone);
          if (!phone) continue;
          const dias = Math.floor((inicioDiaMs - new Date(p.vencimento).getTime()) / 86400000);
          if (!WA_MILESTONES.includes(dias)) continue;
          sendWhatsAppTemplate(phone, "cliente_parcela_atraso", "pt_BR", [{
            type: "body",
            parameters: [
              { type: "text", text: c.nomeRazaoSocial || "" },
              { type: "text", text: fmtWAVal(p.valorPrevisto) },
              { type: "text", text: String(dias) },
              { type: "text", text: fmtWAData(p.vencimento) },
            ],
          }]).catch(() => {});
        }

        // Advogados (splits) — D+1, D+7, D+15; admins apenas D+15
        const parcelaIdsAtraso = parcelasAtrasadas
          .filter(p => {
            const dias = Math.floor((inicioDiaMs - new Date(p.vencimento).getTime()) / 86400000);
            return WA_MILESTONES.includes(dias);
          })
          .map(p => p.id);

        if (parcelaIdsAtraso.length > 0) {
          const splitsAdv = await prisma.parcelaSplitAdvogado.findMany({
            where: { parcelaId: { in: parcelaIdsAtraso } },
            include: {
              advogado: { select: { id: true, nome: true, telefone: true, ativo: true } },
              parcela: { include: { contrato: { select: { cliente: { select: { nomeRazaoSocial: true } } } } } },
            },
          });
          const _waAtrasoEnviados = new Set(); // evita duplicatas parcelaId:advogadoId
          for (const s of splitsAdv) {
            const adv = s.advogado;
            if (!adv.ativo) continue;
            const phone = _waPhone(adv.telefone);
            if (!phone) continue;
            const p = s.parcela;
            const dias = Math.floor((inicioDiaMs - new Date(p.vencimento).getTime()) / 86400000);
            const clienteNome = p.contrato?.cliente?.nomeRazaoSocial || "";
            _waAtrasoEnviados.add(`${p.id}:${adv.id}`);
            sendWhatsAppTemplate(phone, "advogado_parcela_atraso", "pt_BR", [{
              type: "body",
              parameters: [
                { type: "text", text: adv.nome },
                { type: "text", text: clienteNome },
                { type: "text", text: String(dias) },
                { type: "text", text: fmtWAVal(p.valorPrevisto) },
                { type: "text", text: fmtWAData(p.vencimento) },
              ],
            }]).catch(() => {});
          }
          // Advogado principal e de indicação (não duplicar com splits)
          for (const p of parcelasAtrasadas) {
            const dias = Math.floor((inicioDiaMs - new Date(p.vencimento).getTime()) / 86400000);
            if (!WA_MILESTONES.includes(dias)) continue;
            const clienteNome = p.contrato?.cliente?.nomeRazaoSocial || "";
            for (const adv of [p.contrato?.repasseAdvogadoPrincipal, p.contrato?.repasseIndicacaoAdvogado]) {
              if (!adv || !adv.ativo) continue;
              if (_waAtrasoEnviados.has(`${p.id}:${adv.id}`)) continue;
              const phone = _waPhone(adv.telefone);
              if (!phone) continue;
              _waAtrasoEnviados.add(`${p.id}:${adv.id}`);
              sendWhatsAppTemplate(phone, "advogado_parcela_atraso", "pt_BR", [{
                type: "body",
                parameters: [
                  { type: "text", text: adv.nome },
                  { type: "text", text: clienteNome },
                  { type: "text", text: String(dias) },
                  { type: "text", text: fmtWAVal(p.valorPrevisto) },
                  { type: "text", text: fmtWAData(p.vencimento) },
                ],
              }]).catch(() => {});
            }
          }

          // Admins — apenas D+15
          const parcelaIds15 = parcelasAtrasadas
            .filter(p => Math.floor((inicioDiaMs - new Date(p.vencimento).getTime()) / 86400000) === 15)
            .map(p => p.id);
          if (parcelaIds15.length > 0) {
            const adminsWA = await prisma.usuario.findMany({
              where: { role: "ADMIN", ativo: true },
              select: { nome: true, whatsapp: true, telefone: true },
            });
            for (const p of parcelasAtrasadas.filter(x => parcelaIds15.includes(x.id))) {
              const c = p.contrato?.cliente;
              for (const adm of adminsWA) {
                const phone = _waPhone(adm.whatsapp || adm.telefone);
                if (!phone) continue;
                sendWhatsAppTemplate(phone, "advogado_parcela_atraso", "pt_BR", [{
                  type: "body",
                  parameters: [
                    { type: "text", text: adm.nome || "Admin" },
                    { type: "text", text: c?.nomeRazaoSocial || "" },
                    { type: "text", text: "15" },
                    { type: "text", text: fmtWAVal(p.valorPrevisto) },
                    { type: "text", text: fmtWAData(p.vencimento) },
                  ],
                }]).catch(() => {});
              }
            }
          }
        }
        console.log(`📱 WhatsApp atraso processado`);
      }
    } catch (err) {
      console.error("❌ Erro no e-mail de vencidos:", err.message);
    }
  }, 60 * 60 * 1000); // verifica a cada hora
}

export { _buildTabelaVencidos };
