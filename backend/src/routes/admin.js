import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { sendEmail, EMAIL_FROM } from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppStrict, sendWhatsAppTemplate, _waPhone } from "../lib/whatsapp.js";
import {
  buildEmailAlertaVencimentos,
  buildEmailVencimentoCliente,
  buildEmailVencidos,
  buildEmailAtrasoCliente,
  buildEmailRecebimentoCliente,
} from "../lib/emailTemplates.js";
import { runBoletosAgendadosAgora } from "../schedulers/boletosAgendados.js";

const router = Router();

// ============================================================
// DISPARO MANUAL — teste dos e-mails do scheduler (admin only)
// POST /api/admin/disparo-teste-email
// Executa a mesma lógica dos schedulers sem checar horário nem duplicata
// ============================================================
router.post("/api/admin/disparo-teste-email", authenticate, requireAdmin, async (req, res) => {
  const agora = new Date();
  const resultado = { alertas: null, vencidos: null };

  // ── 1. Alertas D-7/D-1 ──────────────────────────────────────────────────
  try {
    const amanha    = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1));
    const amanhaFim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1, 23, 59, 59, 999));
    const d2        = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 2));
    const d7        = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 7, 23, 59, 59, 999));

    const [rawD1, rawD7, repassesPend, saidasD1, saidasD7] = await Promise.all([
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
      prisma.repassePagamento.findMany({
        where: { status: "PENDENTE" },
        include: { advogado: { select: { nome: true } } },
        orderBy: { competenciaId: "asc" },
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

    // Repasses só entram no alerta a partir do dia 6 do mês
    const diaMesBelemTeste = parseInt(agora.toLocaleDateString("pt-BR", { timeZone: "America/Belem", day: "numeric" }));
    const repassesAlertaTeste = diaMesBelemTeste > 5 ? repassesPend : [];

    const contagens = {
      entradasD1: rawD1.length,
      entradasD7: rawD7.length,
      repassesPendentes: repassesAlertaTeste.length,
      saidasD1: saidasD1.length,
      saidasD7: saidasD7.length,
    };

    const temDados = rawD1.length > 0 || rawD7.length > 0 || repassesAlertaTeste.length > 0 || saidasD1.length > 0 || saidasD7.length > 0;
    if (!temDados) {
      resultado.alertas = { enviado: false, motivo: "Nenhum dado encontrado (sem parcelas/repasses/saídas nos próximos 7 dias)", contagens };
    } else {
      const norm1 = rawD1.map(p => ({ ...p, clienteNome: p.contrato?.cliente?.nomeRazaoSocial, contratoNumero: p.contrato?.numeroContrato }));
      const norm7 = rawD7.map(p => ({ ...p, clienteNome: p.contrato?.cliente?.nomeRazaoSocial, contratoNumero: p.contrato?.numeroContrato }));
      const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { email: true, nome: true } });
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: `[TESTE] ⏰ Addere — Alertas: ${rawD1.length} entrada(s) amanhã · ${saidasD1.length} saída(s) amanhã · ${repassesAlertaTeste.length} repasse(s) pend.`,
          html: buildEmailAlertaVencimentos(admin.nome, norm1, norm7, repassesAlertaTeste, saidasD1, saidasD7),
        });
      }
      // Clientes com parcelas próximas
      const porClienteVencTeste = new Map();
      const _agVencTeste = (lista, slot) => {
        for (const p of lista) {
          const c = p.contrato?.cliente;
          if (!c?.email || c.naoEnviarEmails) continue;
          if (!porClienteVencTeste.has(c.id))
            porClienteVencTeste.set(c.id, { nome: c.nomeRazaoSocial, email: c.email, d1: [], d7: [] });
          porClienteVencTeste.get(c.id)[slot].push(p);
        }
      };
      _agVencTeste(rawD1, "d1");
      _agVencTeste(rawD7, "d7");
      for (const { nome, email, d1, d7 } of porClienteVencTeste.values()) {
        await sendEmail({
          to: email,
          subject: `[TESTE] ⏰ Lembrete — parcela(s) próximas do vencimento`,
          html: buildEmailVencimentoCliente(nome, d1, d7),
        });
      }
      resultado.alertas = { enviado: true, destinatarios: admins.map(a => a.email), clientesAlertados: porClienteVencTeste.size, contagens };
    }
  } catch (err) {
    resultado.alertas = { enviado: false, erro: err.message };
  }

  // ── 2. Vencidos em Aberto ────────────────────────────────────────────────
  try {
    const inicioDia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 3, 0, 0)); // T03:00Z = meia-noite BRT
    const inicioDiaMs = inicioDia.getTime();
    const items = await prisma.livroCaixaLancamento.findMany({
      where: { statusFluxo: "PREVISTO", data: { lt: inicioDia } },
      include: { conta: true },
      orderBy: [{ data: "asc" }],
    });

    if (items.length === 0) {
      resultado.vencidos = { enviado: false, motivo: "Nenhum lançamento vencido em aberto encontrado" };
    } else {
      const agora2 = Date.now();
      const enriched = items.map(l => {
        const dias = Math.floor((agora2 - new Date(l.data).getTime()) / 86400000);
        const risco = dias <= 30 ? "NORMAL" : dias <= 60 ? "ATENCAO" : dias <= 90 ? "ALTO_RISCO" : "DUVIDOSO";
        return { ...l, diasEmAtraso: dias, risco };
      });
      const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { email: true, nome: true } });
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: `[TESTE] 📋 Addere — ${items.length} lançamento(s) vencido(s) em aberto`,
          html: buildEmailVencidos(admin.nome, enriched),
        });
      }
      // Clientes com atraso (milestones D+1, D+7, D+15)
      const MILESTONES_TESTE = [1, 7, 15];
      const parcelasAtrasadasTeste = await prisma.parcelaContrato.findMany({
        where: { status: { in: ["PREVISTA", "ATRASADA"] }, vencimento: { lt: inicioDia } },
        include: { contrato: { select: { numeroContrato: true, cliente: { select: { id: true, nomeRazaoSocial: true, email: true, naoEnviarEmails: true, telefone: true } } } } },
        orderBy: { vencimento: "asc" },
      });
      const porClienteAtrasoTeste = new Map();
      for (const p of parcelasAtrasadasTeste) {
        const c = p.contrato?.cliente;
        if (!c?.email || c.naoEnviarEmails) continue;
        const dias = Math.floor((inicioDiaMs - new Date(p.vencimento).getTime()) / 86400000);
        if (!MILESTONES_TESTE.includes(dias)) continue;
        if (!porClienteAtrasoTeste.has(c.id))
          porClienteAtrasoTeste.set(c.id, { nome: c.nomeRazaoSocial, email: c.email, parcelas: [] });
        porClienteAtrasoTeste.get(c.id).parcelas.push({ ...p, diasEmAtraso: dias });
      }
      for (const { nome, email, parcelas } of porClienteAtrasoTeste.values()) {
        await sendEmail({
          to: email,
          subject: `[TESTE] ⚠️ Parcela em atraso — Addere`,
          html: buildEmailAtrasoCliente(nome, parcelas),
        });
      }
      resultado.vencidos = { enviado: true, destinatarios: admins.map(a => a.email), totalItens: items.length, clientesAtrasoAlertados: porClienteAtrasoTeste.size };
    }
  } catch (err) {
    resultado.vencidos = { enviado: false, erro: err.message };
  }

  res.json({ ok: true, ts: agora.toISOString(), resultado });
});

// ============================================================
// POST /api/admin/teste-emails-cliente
// Envia simulação dos 3 templates de cliente para paulosramalho@gmail.com
// ============================================================
router.post("/api/admin/teste-emails-cliente", authenticate, requireAdmin, async (req, res) => {
  const DEST = "paulosramalho@gmail.com";
  const NOME = "Paulo Ramalho (Simulação)";
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  // Dados fictícios para simular parcelas
  const parcelaFake = (numero, diasVencimento) => {
    const d = new Date();
    d.setDate(d.getDate() + diasVencimento);
    return {
      numero,
      vencimento: d,
      valorPrevisto: (1500 + numero * 250).toFixed(2),
      contrato: { numeroContrato: `AMR-2025-00${numero}` },
    };
  };

  const erros = [];
  const enviados = [];

  // 1. E-mail de vencimento próximo (D-1 e D-7)
  try {
    await sendEmail({
      to: DEST,
      subject: `[SIMULAÇÃO] ⏰ Lembrete — parcela(s) próximas do vencimento`,
      html: buildEmailVencimentoCliente(NOME, [parcelaFake(3, 1)], [parcelaFake(4, 5), parcelaFake(5, 7)]),
    });
    enviados.push("vencimento");
  } catch (e) { erros.push({ tipo: "vencimento", erro: e.message }); }

  // 2. E-mail de atraso (D+1 e D+7)
  try {
    const atrasada1 = { ...parcelaFake(1, -1), diasEmAtraso: 1 };
    const atrasada7 = { ...parcelaFake(2, -7), diasEmAtraso: 7 };
    atrasada1.vencimento = new Date(Date.now() - 86400000);
    atrasada7.vencimento = new Date(Date.now() - 7 * 86400000);
    await sendEmail({
      to: DEST,
      subject: `[SIMULAÇÃO] ⚠️ Parcela em atraso — Addere`,
      html: buildEmailAtrasoCliente(NOME, [atrasada1, atrasada7]),
    });
    enviados.push("atraso");
  } catch (e) { erros.push({ tipo: "atraso", erro: e.message }); }

  // 3. E-mail de confirmação de recebimento
  try {
    await sendEmail({
      to: DEST,
      subject: `[SIMULAÇÃO] ✅ Pagamento recebido — Addere`,
      html: buildEmailRecebimentoCliente(NOME, {
        numeroContrato: "AMR-2025-001",
        numeroParcela: 2,
        dataRecebimento: hoje,
        valorRecebido: 1750,
        meioRecebimento: "PIX",
      }),
    });
    enviados.push("recebimento");
  } catch (e) { erros.push({ tipo: "recebimento", erro: e.message }); }

  res.json({ ok: erros.length === 0, destinatario: DEST, enviados, erros, ts: new Date().toISOString() });
});

// ============================================================
// POST /api/admin/teste-confirmacao-email
// ============================================================
router.post("/api/admin/teste-confirmacao-email", authenticate, requireAdmin, async (req, res) => {
  const agora = new Date();
  const dataFmt = agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
  const horaFmt = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#1e3a5f;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px">Confirmação de Serviço — Envio de Teste</div>
    </div>
    <div style="padding:28px">
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:18px 22px;margin-bottom:22px">
        <div style="font-size:15px;font-weight:600;color:#1e3a5f;margin-bottom:12px">✅ Serviço de e-mail operacional</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:5px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;width:120px">Data</td>
            <td style="padding:5px 0;font-size:14px;color:#0f172a">${dataFmt}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Horário</td>
            <td style="padding:5px 0;font-size:14px;color:#0f172a">${horaFmt}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Domínio</td>
            <td style="padding:5px 0;font-size:14px;color:#0f172a">${EMAIL_FROM}</td>
          </tr>
        </table>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;font-size:13px;color:#92400e;margin-bottom:22px">
        <strong>⚠️ Este é um e-mail de teste.</strong> Nenhuma ação é necessária. Ele foi disparado manualmente
        pelo painel de administração do sistema Addere Control para verificar o funcionamento do serviço de envio
        de e-mails após alteração de domínio.
      </div>
      <p style="font-size:13px;color:#64748b;margin:0">
        Se você recebeu esta mensagem, o serviço de e-mail está configurado corretamente
        e operando normalmente. Caso não reconheça o remetente, ignore esta mensagem.
      </p>
    </div>
    <div style="background:#f1f5f9;padding:14px 28px;text-align:center;font-size:11px;color:#94a3b8">
      Addere — Sistema de Controles Financeiros
    </div>
  </div>
</body></html>`;

  const destinatarios = ["financeiro@amandaramalho.adv.br", "paulosramalho@gmail.com"];
  const enviados = [];
  const erros = [];

  for (const to of destinatarios) {
    try {
      await sendEmail({ to, subject: "[TESTE] Confirmação de Serviço — Addere", html });
      enviados.push(to);
    } catch (err) {
      erros.push({ to, erro: err.message });
    }
  }

  res.json({ ok: true, ts: agora.toISOString(), enviados, erros });
});

// ============================================================
// ALÍQUOTAS
// ============================================================

router.get("/api/aliquotas", authenticate, async (req, res) => {
  try {
    const aliquotas = await prisma.aliquota.findMany({
      orderBy: [{ ano: "desc" }, { mes: "desc" }],
    });
    res.json(aliquotas);
  } catch (error) {
    console.error("Erro ao buscar alíquotas:", error);
    res.status(500).json({ message: "Erro ao buscar alíquotas." });
  }
});

router.post("/api/aliquotas", authenticate, async (req, res) => {
  try {
    const { mes, ano, percentualBp } = req.body;

    const aliquota = await prisma.aliquota.create({
      data: { mes, ano, percentualBp },
    });

    res.status(201).json(aliquota);
  } catch (error) {
    console.error("Erro ao criar alíquota:", error);
    res.status(500).json({ message: "Erro ao criar alíquota." });
  }
});

router.put("/api/aliquotas/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { percentualBp } = req.body;

    const aliquota = await prisma.aliquota.update({
      where: { id: parseInt(id) },
      data: { percentualBp },
    });

    res.json(aliquota);
  } catch (error) {
    console.error("Erro ao atualizar alíquota:", error);
    res.status(500).json({ message: "Erro ao atualizar alíquota." });
  }
});

router.delete("/api/aliquotas/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const aliquotaId = parseInt(id);

    if (isNaN(aliquotaId)) {
      return res.status(400).json({ message: "ID inválido." });
    }

    // Buscar a alíquota primeiro
    const aliquota = await prisma.aliquota.findUnique({
      where: { id: aliquotaId }
    });

    if (!aliquota) {
      return res.status(404).json({ message: "Alíquota não encontrada." });
    }

    // Aliquota não tem FK — pode excluir livremente
    await prisma.aliquota.delete({
      where: { id: aliquotaId }
    });

    res.json({
      message: "Alíquota excluída com sucesso.",
      aliquota: {
        mes: aliquota.mes,
        ano: aliquota.ano
      }
    });

  } catch (error) {
    console.error("❌ Erro ao excluir alíquota:", error);

    // Tratamento de erros do Prisma
    if (error.code === 'P2003') {
      return res.status(400).json({
        message: "Esta alíquota está em uso por outros registros e não pode ser excluída."
      });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({
        message: "Alíquota não encontrada."
      });
    }

    res.status(500).json({
      message: "Erro ao excluir alíquota.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============================================================
// MODELOS DE DISTRIBUIÇÃO
// ============================================================

router.get("/api/modelo-distribuicao", authenticate, async (req, res) => {
  try {
    const somenteAtivos = req.query.ativo === "true";
    const modelos = await prisma.modeloDistribuicao.findMany({
      ...(somenteAtivos ? { where: { ativo: true } } : {}),
      include: {
        itens: {
          orderBy: { ordem: "asc" },
        },
      },
      orderBy: { codigo: "asc" },
    });

    res.json(modelos);
  } catch (error) {
    console.error("Erro ao listar modelos:", error);
    res.status(500).json({ message: "Erro ao listar modelos de distribuição" });
  }
});

router.get("/api/modelo-distribuicao/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const modelo = await prisma.modeloDistribuicao.findUnique({
      where: { id: parseInt(id) },
      include: {
        itens: {
          orderBy: { ordem: "asc" },
        },
      },
    });

    if (!modelo) {
      return res.status(404).json({ message: "Modelo não encontrado" });
    }

    res.json(modelo);
  } catch (error) {
    console.error("Erro ao buscar modelo:", error);
    res.status(500).json({ message: "Erro ao buscar modelo" });
  }
});

router.get("/api/modelo-distribuicao/:id/itens", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const itens = await prisma.modeloDistribuicaoItem.findMany({
      where: { modeloId: parseInt(id) },
      orderBy: { ordem: "asc" },
    });

    res.json(itens);
  } catch (error) {
    console.error("Erro ao buscar itens do modelo:", error);
    res.status(500).json({ message: "Erro ao buscar itens do modelo" });
  }
});

// ✅ Adicionar itens ao modelo (usado pelo front de Configurações)
router.post(
  "/api/modelo-distribuicao/:id/itens",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      // aceita tanto { itens: [...] } quanto um item único { destinoTipo, percentualBp, ... }
      const bodyItens = Array.isArray(req.body?.itens) ? req.body.itens : null;
      const itemUnico = !bodyItens ? req.body : null;

      const modeloId = parseInt(id);
      if (!modeloId || Number.isNaN(modeloId)) {
        return res.status(400).json({ message: "ID do modelo inválido" });
      }

      const modeloExiste = await prisma.modeloDistribuicao.findUnique({
        where: { id: modeloId },
        select: { id: true },
      });
      if (!modeloExiste) {
        return res.status(404).json({ message: "Modelo não encontrado" });
      }

      const itensParaInserir = bodyItens ? bodyItens : [itemUnico];

      if (!itensParaInserir || itensParaInserir.length === 0) {
        return res.status(400).json({ message: "Nenhum item informado" });
      }

      // calcula a próxima ordem automaticamente (se não vier)
      const qtdAtual = await prisma.modeloDistribuicaoItem.count({
        where: { modeloId },
      });

      const data = itensParaInserir.map((it, idx) => {
        if (!it?.destinoTipo) {
          throw new Error("destinoTipo é obrigatório em todos os itens");
        }
        const bp = parseInt(it.percentualBp);
        if (Number.isNaN(bp)) {
          throw new Error("percentualBp inválido em um dos itens");
        }

        return {
          modeloId,
          ordem: Number.isFinite(it.ordem) ? parseInt(it.ordem) : (qtdAtual + idx + 1),
          origem: it.origem || "REPASSE",
          periodicidade: it.periodicidade || "INCIDENTAL",
          destinoTipo: it.destinoTipo,
          destinatario: it.destinatario || null,
          percentualBp: bp,
        };
      });

      // cria (em lote quando possível)
      if (data.length > 1) {
        await prisma.modeloDistribuicaoItem.createMany({ data });
      } else {
        await prisma.modeloDistribuicaoItem.create({ data: data[0] });
      }

      // devolve o modelo completo já com itens ordenados (pra UI atualizar card)
      const modeloCompleto = await prisma.modeloDistribuicao.findUnique({
        where: { id: modeloId },
        include: { itens: { orderBy: { ordem: "asc" } } },
      });

      res.status(201).json(modeloCompleto);
    } catch (error) {
      console.error("Erro ao adicionar itens ao modelo:", error);
      res.status(500).json({
        message: error?.message || "Erro ao adicionar itens ao modelo",
      });
    }
  }
);

// Alterar item de modelo de distribuição
router.put("/api/modelo-distribuicao/itens/:itemId", authenticate, requireAdmin, async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (!itemId || Number.isNaN(itemId)) return res.status(400).json({ message: "ID do item inválido." });

    const { ordem, destinoTipo, percentualBp, destinatario } = req.body;
    const data = {};
    if (ordem !== undefined) data.ordem = parseInt(ordem);
    if (destinoTipo !== undefined) data.destinoTipo = destinoTipo;
    if (percentualBp !== undefined) data.percentualBp = parseInt(percentualBp);
    if (destinatario !== undefined) data.destinatario = destinatario || null;

    const item = await prisma.modeloDistribuicaoItem.update({
      where: { id: itemId },
      data,
    });
    res.json(item);
  } catch (error) {
    console.error("Erro ao alterar item do modelo:", error);
    if (error.code === "P2025") return res.status(404).json({ message: "Item não encontrado." });
    res.status(500).json({ message: "Erro ao alterar item do modelo." });
  }
});

// Excluir item de modelo de distribuição
router.delete("/api/modelo-distribuicao/itens/:itemId", authenticate, requireAdmin, async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (!itemId || Number.isNaN(itemId)) return res.status(400).json({ message: "ID do item inválido." });
    await prisma.modeloDistribuicaoItem.delete({ where: { id: itemId } });
    res.json({ message: "Item excluído com sucesso." });
  } catch (error) {
    console.error("Erro ao excluir item do modelo:", error);
    if (error.code === "P2025") return res.status(404).json({ message: "Item não encontrado." });
    res.status(500).json({ message: "Erro ao excluir item do modelo." });
  }
});

// ============================================================
// ALIASES (plural) - compatibilidade com o front antigo
// ============================================================

router.get("/api/modelos-distribuicao", authenticate, async (req, res) => {
  try {
    const somenteAtivos = req.query.ativo === "true";
    const modelos = await prisma.modeloDistribuicao.findMany({
      ...(somenteAtivos ? { where: { ativo: true } } : {}),
      include: { itens: { orderBy: { ordem: "asc" } } },
      orderBy: { codigo: "asc" },
    });
    res.json(modelos);
  } catch (error) {
    console.error("Erro ao listar modelos (alias plural):", error);
    res.status(500).json({ message: "Erro ao listar modelos de distribuição" });
  }
});

router.get("/api/modelos-distribuicao/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const modelo = await prisma.modeloDistribuicao.findUnique({
      where: { id: parseInt(id) },
      include: { itens: { orderBy: { ordem: "asc" } } },
    });
    if (!modelo) return res.status(404).json({ message: "Modelo não encontrado" });
    res.json(modelo);
  } catch (error) {
    console.error("Erro ao buscar modelo (alias plural):", error);
    res.status(500).json({ message: "Erro ao buscar modelo" });
  }
});

router.get("/api/modelos-distribuicao/:id/itens", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const itens = await prisma.modeloDistribuicaoItem.findMany({
      where: { modeloId: parseInt(id) },
      orderBy: { ordem: "asc" },
    });
    res.json(itens);
  } catch (error) {
    console.error("Erro ao buscar itens do modelo (alias plural):", error);
    res.status(500).json({ message: "Erro ao buscar itens do modelo" });
  }
});

router.post("/api/modelo-distribuicao", authenticate, requireAdmin, async (req, res) => {
  try {
    const { codigo, cod, descricao, origem, periodicidade, itens } = req.body;
    const codigoFinal = String((codigo ?? cod) || "").trim();
    const descricaoFinal = String(descricao || "").trim();

    if (!codigoFinal || !descricaoFinal) {
      return res.status(400).json({
        message: "Código e descrição são obrigatórios",
      });
    }

    const itensArr = Array.isArray(itens) ? itens : [];

    // ✅ Fluxo permitido: criar modelo sem itens e cadastrar depois via tela "Itens"
    if (itensArr.length > 0) {
      const somaPercentuais = itensArr.reduce((sum, item) => {
        return sum + parseInt(item.percentualBp || 0);
      }, 0);

      if (somaPercentuais !== 10000) {
        return res.status(400).json({
          message: `Soma dos percentuais deve ser 100% (10000 bp). Atual: ${somaPercentuais} bp`,
        });
      }
    }

    const existente = await prisma.modeloDistribuicao.findUnique({
      where: { codigo: codigoFinal },
    });

    if (existente) {
      return res.status(400).json({
        message: `Já existe um modelo com o código '${codigoFinal}'`,
      });
    }

    const dataCreate = {
      codigo: codigoFinal,
      descricao: descricaoFinal,
      origem: origem || "REPASSE",
      periodicidade: periodicidade || "INCIDENTAL",
    };

    if (itensArr.length > 0) {
      dataCreate.itens = {
        create: itensArr.map((item, index) => ({
          ordem: index + 1,
          origem: item.origem || origem || "REPASSE",
          periodicidade: item.periodicidade || periodicidade || "INCIDENTAL",
          destinoTipo: item.destinoTipo,
          destinatario: item.destinatario || null,
          percentualBp: parseInt(item.percentualBp),
        })),
      };
    }

    const modelo = await prisma.modeloDistribuicao.create({
      data: dataCreate,
      include: {
        itens: { orderBy: { ordem: "asc" } },
      },
    });

    res.status(201).json(modelo);
  } catch (error) {
    console.error("Erro ao criar modelo:", error);
    res.status(500).json({ message: "Erro ao criar modelo" });
  }
});

router.put("/api/modelo-distribuicao/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo, descricao, origem, periodicidade, itens, ativo } = req.body;

    if (itens && Array.isArray(itens)) {
      const somaPercentuais = itens.reduce((sum, item) => {
        return sum + parseInt(item.percentualBp || 0);
      }, 0);

      if (somaPercentuais !== 10000) {
        return res.status(400).json({
          message: `Soma dos percentuais deve ser 100% (10000 bp). Atual: ${somaPercentuais} bp`,
        });
      }
    }

    const modelo = await prisma.$transaction(async (tx) => {
      const modeloAtualizado = await tx.modeloDistribuicao.update({
        where: { id: parseInt(id) },
        data: {
          codigo,
          descricao,
          origem,
          periodicidade,
          ativo,
        },
      });

      if (itens && Array.isArray(itens)) {
        await tx.modeloDistribuicaoItem.deleteMany({
          where: { modeloId: parseInt(id) },
        });

        await tx.modeloDistribuicaoItem.createMany({
          data: itens.map((item, index) => ({
            modeloId: parseInt(id),
            ordem: index + 1,
            origem: item.origem || origem || "REPASSE",
            periodicidade: item.periodicidade || periodicidade || "INCIDENTAL",
            destinoTipo: item.destinoTipo,
            destinatario: item.destinatario || null,
            percentualBp: parseInt(item.percentualBp),
          })),
        });
      }

      return modeloAtualizado;
    });

    const modeloCompleto = await prisma.modeloDistribuicao.findUnique({
      where: { id: parseInt(id) },
      include: {
        itens: {
          orderBy: { ordem: "asc" },
        },
      },
    });

    res.json(modeloCompleto);
  } catch (error) {
    console.error("Erro ao atualizar modelo:", error);

    if (error.code === "P2025") {
      return res.status(404).json({ message: "Modelo não encontrado" });
    }

    res.status(500).json({ message: "Erro ao atualizar modelo" });
  }
});

router.delete("/api/modelo-distribuicao/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const emUso = await prisma.contratoPagamento.count({
      where: {
        modeloDistribuicaoId: parseInt(id),
        ativo: true,
      },
    });

    if (emUso > 0) {
      return res.status(400).json({
        message: `Este modelo está em uso por ${emUso} contrato(s) ativo(s)`,
      });
    }

    const modelo = await prisma.modeloDistribuicao.update({
      where: { id: parseInt(id) },
      data: { ativo: false },
    });

    res.json({
      message: "Modelo desativado com sucesso",
      modelo,
    });
  } catch (error) {
    console.error("Erro ao desativar modelo:", error);

    if (error.code === "P2025") {
      return res.status(404).json({ message: "Modelo não encontrado" });
    }

    res.status(500).json({ message: "Erro ao desativar modelo" });
  }
});

router.post("/api/modelo-distribuicao/validar", authenticate, async (req, res) => {
  try {
    const { itens } = req.body;

    if (!itens || !Array.isArray(itens)) {
      return res.status(400).json({ message: "Itens inválidos" });
    }

    const somaPercentuais = itens.reduce((sum, item) => {
      return sum + parseInt(item.percentualBp || 0);
    }, 0);

    const valido = somaPercentuais === 10000;

    res.json({
      valido,
      somaBp: somaPercentuais,
      somaPercentual: (somaPercentuais / 100).toFixed(2),
      diferenca: valido ? 0 : 10000 - somaPercentuais,
      diferencaPercentual: valido ? "0.00" : ((10000 - somaPercentuais) / 100).toFixed(2),
    });
  } catch (error) {
    console.error("Erro ao validar modelo:", error);
    res.status(500).json({ message: "Erro ao validar modelo" });
  }
});

// ============================================================
// CONFIG ESCRITÓRIO — singleton
// ============================================================

router.get("/api/config-escritorio", authenticate, async (req, res) => {
  try {
    let config = await prisma.configEscritorio.findFirst();
    if (!config) config = await prisma.configEscritorio.create({ data: {} });
    res.json(config);
  } catch (e) {
    res.status(500).json({ message: "Erro ao buscar configurações", error: e.message });
  }
});

router.put("/api/config-escritorio", authenticate, requireAdmin, async (req, res) => {
  try {
    const fields = ["nome","nomeFantasia","cnpj","oabRegistro","logradouro","numero","complemento",
                    "bairro","cidade","estado","cep","telefoneFix","celular","whatsapp"];
    let config = await prisma.configEscritorio.findFirst();
    if (!config) config = await prisma.configEscritorio.create({ data: {} });
    const data = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) data[f] = String(req.body[f]).trim();
    }
    const updated = await prisma.configEscritorio.update({ where: { id: config.id }, data });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: "Erro ao salvar configurações", error: e.message });
  }
});

// ── Envio de dados do escritório (e-mail ou WhatsApp) ──────────────────────
router.post("/api/config-escritorio/enviar", authenticate, async (req, res) => {
  try {
    const { canal, destinatario } = req.body;
    if (!canal || !destinatario) return res.status(400).json({ message: "canal e destinatario obrigatórios" });

    const [cfg, contas] = await Promise.all([
      prisma.configEscritorio.findFirst(),
      prisma.livroCaixaConta.findMany({ where: { tipo: "BANCO", ativa: true }, orderBy: { ordem: "asc" } }),
    ]);

    const nome = cfg?.nomeFantasia || cfg?.nome || "Addere";
    const endereco = [cfg?.logradouro, cfg?.numero, cfg?.complemento, cfg?.bairro,
                      cfg?.cidade && cfg?.estado ? `${cfg.cidade}/${cfg.estado}` : cfg?.cidade || cfg?.estado,
                      cfg?.cep].filter(Boolean).join(", ");

    function fmtPix(c) {
      const d = (c || "").replace(/\D/g, "");
      if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)} (CNPJ)`;
      return c;
    }

    if (canal === "whatsapp") {
      const linhas = [`*${nome}*`];
      if (endereco) linhas.push(endereco);
      if (cfg?.oabRegistro) linhas.push(cfg.oabRegistro);
      if (cfg?.cnpj) linhas.push(`CNPJ: ${cfg.cnpj}`);
      if (cfg?.whatsapp) linhas.push(`📱 ${cfg.whatsapp}`);
      if (contas.length) {
        linhas.push("", "━━━━━━━━━━━━━━━━━━━━", "*Dados Bancários*");
        for (const b of contas) {
          linhas.push("", `🏦 *${b.nome}*`);
          if (b.agencia || b.conta) {
            const ag = b.agencia ? `Ag: ${b.agencia}` : "";
            const cc = b.conta   ? `Cc: ${b.conta}`   : "";
            linhas.push([ag, cc].filter(Boolean).join("   |   "));
          }
          if (b.chavePix1) linhas.push(`✦ Pix: ${fmtPix(b.chavePix1)}`);
          if (b.chavePix2) linhas.push(`✦ Pix: ${fmtPix(b.chavePix2)}`);
        }
      }
      const waPhone = _waPhone(destinatario);
      // Monta variáveis do template dados_escritorio
      const v1 = nome;
      const v2 = [
        endereco,
        cfg?.oabRegistro,
        cfg?.cnpj ? `CNPJ: ${cfg.cnpj}` : "",
        cfg?.whatsapp ? `📱 ${cfg.whatsapp}` : "",
      ].filter(Boolean).join("\n");
      const v3 = contas.length ? contas.map(b => {
        const partes = [`${b.nome}`];
        if (b.agencia || b.conta) partes.push(`  Ag: ${b.agencia || "—"} | Cc: ${b.conta || "—"}`);
        if (b.chavePix1) partes.push(`  Pix: ${fmtPix(b.chavePix1)}`);
        if (b.chavePix2) partes.push(`  Pix: ${fmtPix(b.chavePix2)}`);
        return partes.join("\n");
      }).join("\n\n") : "Consulte o escritório.";

      try {
        // Tenta mensagem livre (requer janela de 24h aberta)
        await sendWhatsAppStrict(waPhone, linhas.join("\n"));
      } catch (errLivre) {
        // Fora da janela de 24h → usa template proativo
        if (String(errLivre.message).includes("24h")) {
          await sendWhatsAppTemplate(waPhone, "info_pagamento", "pt_BR", [
            { type: "body", parameters: [
              { type: "text", text: v1 },
              { type: "text", text: v2 },
              { type: "text", text: v3 },
            ]},
          ]);
        } else {
          throw errLivre;
        }
      }
      return res.json({ ok: true });
    }

    if (canal === "email") {
      const bancoRows = contas.map(b => {
        const ag = b.agencia ? `<span style="font-size:11px;color:#555"><b>Ag:</b> ${b.agencia}</span>` : "";
        const cc = b.conta   ? `<span style="font-size:11px;color:#555"><b>Cc:</b> ${b.conta}</span>` : "";
        const p1 = b.chavePix1 ? `<div style="font-size:11px;margin-top:4px">✦ Pix: <code style="background:#f0fdf4;color:#15803d;padding:1px 6px;border-radius:4px">${fmtPix(b.chavePix1)}</code></div>` : "";
        const p2 = b.chavePix2 ? `<div style="font-size:11px;margin-top:2px">✦ Pix: <code style="background:#f0fdf4;color:#15803d;padding:1px 6px;border-radius:4px">${fmtPix(b.chavePix2)}</code></div>` : "";
        return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;background:#fff">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px">🏦 ${b.nome}</div>
          ${ag || cc ? `<div style="display:flex;gap:16px;margin-bottom:4px">${ag}${cc}</div>` : ""}
          ${p1}${p2}
        </div>`;
      }).join("");

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:520px;margin:0 auto;padding:20px">
  <div style="background:#1a3a5c;padding:18px 24px;border-radius:8px 8px 0 0">
    <div style="font-size:18px;font-weight:700;color:#fff">${nome}</div>
    ${endereco ? `<div style="font-size:12px;color:#a8c4e0;margin-top:2px">${endereco}</div>` : ""}
  </div>
  <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:18px 24px;background:#f8fafc">
    ${cfg?.oabRegistro ? `<div style="font-size:13px;color:#555;margin-bottom:2px">${cfg.oabRegistro}</div>` : ""}
    ${cfg?.cnpj        ? `<div style="font-size:13px;color:#555;margin-bottom:2px">CNPJ: ${cfg.cnpj}</div>` : ""}
    ${cfg?.whatsapp    ? `<div style="font-size:13px;color:#555;margin-bottom:12px">📱 ${cfg.whatsapp}</div>` : ""}
    ${contas.length ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:.05em;margin-bottom:8px">Dados Bancários</div>${bancoRows}` : ""}
  </div>
  <p style="font-size:10px;color:#aaa;margin-top:12px;text-align:center">Enviado por Addere Control</p>
</body></html>`;

      await sendEmail({
        to: destinatario,
        subject: `Dados de contato — ${nome}`,
        html,
      });
      return res.json({ ok: true });
    }

    res.status(400).json({ message: "canal inválido (use email ou whatsapp)" });
  } catch (e) {
    console.error("❌ config-escritorio/enviar:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/admin/boletos-agendados/run ─────────────────────────────────────
// Trigger manual do scheduler de emissão agendada (admin only)

router.post("/api/admin/boletos-agendados/run", authenticate, requireAdmin, async (_req, res) => {
  try {
    const resultado = await runBoletosAgendadosAgora();
    res.json(resultado);
  } catch (e) {
    console.error("❌ boletos-agendados/run:", e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
