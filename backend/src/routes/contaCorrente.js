import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { sendEmail } from "../lib/email.js";
import { gerarNumeroContratoComPrefixo } from "../lib/contratoHelpers.js";

const router = Router();

// ============================================================
// CONTA CORRENTE POR CLIENTE
// ============================================================

// GET /api/conta-corrente-clientes/reconciliacao
// Compara saldo acumulado da conta "Clientes" no LC com a somatória das CCs
router.get("/api/conta-corrente-clientes/reconciliacao", authenticate, async (req, res) => {
  try {
    // 1. Conta "Clientes" no LC
    const contaClientes = await prisma.livroCaixaConta.findFirst({
      where: { nome: { contains: "Clientes", mode: "insensitive" } },
      select: { id: true, nome: true, saldoInicialCent: true },
    });

    // 2. Saldo LC: apenas lançamentos na conta "Clientes" (contaId = contaClientes.id)
    // Não incluir LCs de outras contas (ex: Banco Inter) que possuem clienteContaId — esses são
    // honorários cujo recebimento foi direto em outra conta, e não devem compor o saldo Clientes.
    const lcUnion = contaClientes
      ? await prisma.livroCaixaLancamento.findMany({
          where: {
            statusFluxo: "EFETIVADO",
            contaId: contaClientes.id,
          },
          select: { id: true, es: true, valorCentavos: true },
        })
      : [];

    const saldoLC = (contaClientes?.saldoInicialCent || 0) +
      lcUnion.reduce((s, l) => s + (l.es === "E" ? l.valorCentavos : -l.valorCentavos), 0);

    // 3. Saldo CC: somatória de todos os clientes ativos
    const clientes = await prisma.cliente.findMany({
      where: { ativo: true },
      select: {
        id: true,
        nomeRazaoSocial: true,
        saldoInicialCent: true,
        contaCorrente: { select: { natureza: true, valorCent: true } },
      },
    });

    const detalhes = clientes
      .map((c) => {
        const creditos = c.contaCorrente.filter((l) => l.natureza === "CREDITO").reduce((s, l) => s + l.valorCent, 0);
        const debitos  = c.contaCorrente.filter((l) => l.natureza === "DEBITO").reduce((s, l) => s + l.valorCent, 0);
        const saldo    = (c.saldoInicialCent || 0) + creditos - debitos;
        return { id: c.id, nome: c.nomeRazaoSocial, saldo };
      })
      .filter((c) => c.saldo !== 0);

    const saldoCC = detalhes.reduce((s, c) => s + c.saldo, 0);
    const diferenca = saldoLC - saldoCC;

    res.json({
      saldoLC,
      saldoCC,
      diferenca,
      ok: diferenca === 0,
      contaClientesId: contaClientes?.id || null,
      detalhes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/conta-corrente-clientes
// Lista todos os clientes (tipo C ou A) com totais de débito/crédito e saldo
router.get("/api/conta-corrente-clientes", authenticate, async (req, res) => {
  try {
    const clientes = await prisma.cliente.findMany({
      where: { ativo: true, tipo: { in: ["C", "A"] } },
      orderBy: { nomeRazaoSocial: "asc" },
      include: { contaCorrente: true },
    });

    const result = clientes
      .map((c) => {
        const totalDebitoCent = c.contaCorrente
          .filter((l) => l.natureza === "DEBITO")
          .reduce((s, l) => s + l.valorCent, 0);
        const totalCreditoCent = c.contaCorrente
          .filter((l) => l.natureza === "CREDITO")
          .reduce((s, l) => s + l.valorCent, 0);
        // saldo inclui saldo inicial (signed)
        const saldoCent = (c.saldoInicialCent || 0) + totalCreditoCent - totalDebitoCent;
        return {
          id: c.id,
          nomeRazaoSocial: c.nomeRazaoSocial,
          cpfCnpj: c.cpfCnpj,
          email: c.email || null,
          tipo: c.tipo,
          saldoInicialCent: c.saldoInicialCent || 0,
          dataAbertura: c.dataAbertura,
          totalDebitoCent,
          totalCreditoCent,
          saldoCent,
        };
      })
      .filter((c) => c.saldoInicialCent > 0 || c.totalCreditoCent > 0 || c.totalDebitoCent > 0);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/conta-corrente-clientes/:clienteId/lancamentos
// Retorna lançamentos do cliente em ordem cronológica + saldo acumulado por linha
router.get("/api/conta-corrente-clientes/:clienteId/lancamentos", authenticate, async (req, res) => {
  try {
    const clienteId = Number(req.params.clienteId);
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado." });

    const lancamentos = await prisma.contaCorrenteCliente.findMany({
      where: { clienteId },
      orderBy: [{ data: "asc" }, { createdAt: "asc" }],
    });

    // running balance starts from opening balance
    let saldoAcumCent = cliente.saldoInicialCent || 0;
    const comSaldo = lancamentos.map((l) => {
      saldoAcumCent += l.natureza === "CREDITO" ? l.valorCent : -l.valorCent;
      return { ...l, saldoAcumCent };
    });

    res.json({ cliente, lancamentos: comSaldo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/conta-corrente-clientes/:clienteId/saldo-inicial
// Atualiza saldo de abertura e data de abertura do cliente
router.put("/api/conta-corrente-clientes/:clienteId/saldo-inicial", authenticate, async (req, res) => {
  try {
    const clienteId = Number(req.params.clienteId);
    const { saldoInicialCent, dataAbertura } = req.body;

    const updated = await prisma.cliente.update({
      where: { id: clienteId },
      data: {
        saldoInicialCent: saldoInicialCent !== undefined ? Number(saldoInicialCent) : undefined,
        dataAbertura: dataAbertura ? new Date(dataAbertura) : null,
      },
    });

    res.json({
      saldoInicialCent: updated.saldoInicialCent,
      dataAbertura: updated.dataAbertura,
    });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ message: "Cliente não encontrado." });
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/conta-corrente-clientes/:clienteId/lancamentos
// Campos opcionais:
//   contaId (Int) + esLc ("E"|"S") → cria LC atomicamente na conta indicada (transferência CC→banco)
//   clienteDestinoId (Int)          → transferência CC→CC: cria DÉBITO+CRÉDITO sem LC
router.post("/api/conta-corrente-clientes/:clienteId/lancamentos", authenticate, async (req, res) => {
  try {
    const clienteId = Number(req.params.clienteId);
    const { data, descricao, documento, valorCent, natureza, observacoes, contaId, esLc, clienteDestinoId } = req.body;

    if (!data || !descricao || !valorCent || !natureza) {
      return res.status(400).json({ message: "Campos obrigatórios: data, descricao, valorCent, natureza." });
    }
    if (!["DEBITO", "CREDITO"].includes(natureza)) {
      return res.status(400).json({ message: "natureza deve ser DEBITO ou CREDITO." });
    }
    if (contaId && !["E", "S"].includes(esLc)) {
      return res.status(400).json({ message: "esLc deve ser 'E' ou 'S' quando contaId é informado." });
    }
    if (clienteDestinoId && Number(clienteDestinoId) === clienteId) {
      return res.status(400).json({ message: "Cliente de destino deve ser diferente do cliente de origem." });
    }

    const dataObj = new Date(data);
    const descricaoStr = String(descricao).trim();
    const docStr = documento ? String(documento).trim() : null;
    const valorNum = Number(valorCent);

    // Verifica se cliente existe
    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, nomeRazaoSocial: true },
    });
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado." });

    let lancamento;

    if (clienteDestinoId) {
      // Transferência CC→CC: DÉBITO no origem + CRÉDITO no destino, sem entradas no LC
      const destId = Number(clienteDestinoId);
      const destino = await prisma.cliente.findUnique({
        where: { id: destId },
        select: { id: true, nomeRazaoSocial: true },
      });
      if (!destino) return res.status(404).json({ message: "Cliente de destino não encontrado." });

      const naturezaDest = natureza === "DEBITO" ? "CREDITO" : "DEBITO";
      const [ccEntry] = await prisma.$transaction([
        prisma.contaCorrenteCliente.create({
          data: { clienteId, data: dataObj, descricao: descricaoStr, documento: docStr, valorCent: valorNum, natureza, observacoes: observacoes ? String(observacoes).trim() : null },
        }),
        prisma.contaCorrenteCliente.create({
          data: { clienteId: destId, data: dataObj, descricao: descricaoStr, documento: docStr, valorCent: valorNum, natureza: naturezaDest, observacoes: observacoes ? String(observacoes).trim() : null },
        }),
      ]);
      lancamento = ccEntry;
    } else if (contaId) {
      // Transferência entre contas: CC + dois LCs (Conta Clientes + conta destino)
      const [contaDestino, contaClientes] = await Promise.all([
        prisma.livroCaixaConta.findUnique({ where: { id: Number(contaId) }, select: { nome: true } }),
        prisma.livroCaixaConta.findFirst({ where: { nome: "Clientes" } }),
      ]);
      const nomeDestino = contaDestino?.nome || "Conta";
      const esContaClientes = esLc === "E" ? "S" : "E"; // sentido oposto na Conta Clientes

      const ops = [
        prisma.contaCorrenteCliente.create({
          data: {
            clienteId,
            data: dataObj,
            descricao: descricaoStr,
            documento: docStr,
            valorCent: valorNum,
            natureza,
            observacoes: observacoes ? String(observacoes).trim() : null,
          },
        }),
        // LC na conta destino (ex: Banco XYZ) com clienteFornecedor = "Clientes"
        prisma.livroCaixaLancamento.create({
          data: {
            competenciaAno:    dataObj.getFullYear(),
            competenciaMes:    dataObj.getMonth() + 1,
            data:              dataObj,
            documento:         docStr,
            es:                esLc,
            clienteFornecedor: "Clientes",
            historico:         descricaoStr,
            valorCentavos:     valorNum,
            contaId:           Number(contaId),
            clienteContaId:    clienteId,
            ordemDia:          0,
            origem:            "MANUAL",
            status:            "OK",
            statusFluxo:       "EFETIVADO",
          },
        }),
        // LC em Conta Clientes com clienteFornecedor = nome da conta destino
        ...(contaClientes ? [prisma.livroCaixaLancamento.create({
          data: {
            competenciaAno:    dataObj.getFullYear(),
            competenciaMes:    dataObj.getMonth() + 1,
            data:              dataObj,
            documento:         docStr,
            es:                esContaClientes,
            clienteFornecedor: nomeDestino,
            historico:         descricaoStr,
            valorCentavos:     valorNum,
            contaId:           contaClientes.id,
            clienteContaId:    clienteId,
            ordemDia:          0,
            origem:            "MANUAL",
            status:            "OK",
            statusFluxo:       "EFETIVADO",
          },
        })] : []),
      ];

      const [ccEntry] = await prisma.$transaction(ops);
      lancamento = ccEntry;
    } else {
      // Sem contaId: cria CC + LC na conta Clientes (id=5) atomicamente
      const contaClientes = await prisma.livroCaixaConta.findFirst({ where: { nome: "Clientes" } });
      const esLcClientes = natureza === "CREDITO" ? "E" : "S";
      const [ccEntry] = await prisma.$transaction([
        prisma.contaCorrenteCliente.create({
          data: {
            clienteId,
            data: dataObj,
            descricao: descricaoStr,
            documento: docStr,
            valorCent: valorNum,
            natureza,
            observacoes: observacoes ? String(observacoes).trim() : null,
          },
        }),
        ...(contaClientes ? [prisma.livroCaixaLancamento.create({
          data: {
            competenciaAno:    dataObj.getFullYear(),
            competenciaMes:    dataObj.getMonth() + 1,
            data:              dataObj,
            documento:         docStr,
            es:                esLcClientes,
            clienteFornecedor: "Clientes",
            historico:         descricaoStr,
            valorCentavos:     valorNum,
            contaId:           contaClientes.id,
            clienteContaId:    clienteId,
            ordemDia:          0,
            origem:            "MANUAL",
            status:            "OK",
            statusFluxo:       "EFETIVADO",
          },
        })] : []),
      ]);
      lancamento = ccEntry;
    }

    res.status(201).json(lancamento);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/conta-corrente-clientes/lancamentos/:id
router.put("/api/conta-corrente-clientes/lancamentos/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data, descricao, documento, valorCent, natureza, observacoes } = req.body;

    if (natureza && !["DEBITO", "CREDITO"].includes(natureza)) {
      return res.status(400).json({ message: "natureza deve ser DEBITO ou CREDITO." });
    }

    const updated = await prisma.contaCorrenteCliente.update({
      where: { id },
      data: {
        ...(data !== undefined && { data: new Date(data) }),
        ...(descricao !== undefined && { descricao: String(descricao).trim() }),
        ...(documento !== undefined && { documento: documento ? String(documento).trim() : null }),
        ...(valorCent !== undefined && { valorCent: Number(valorCent) }),
        ...(natureza !== undefined && { natureza }),
        ...(observacoes !== undefined && { observacoes: observacoes ? String(observacoes).trim() : null }),
        updatedAt: new Date(),
      },
    });

    res.json(updated);
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ message: "Lançamento não encontrado." });
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/conta-corrente-clientes/lancamentos/:id
router.delete("/api/conta-corrente-clientes/lancamentos/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.contaCorrenteCliente.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ message: "Lançamento não encontrado." });
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/conta-corrente-clientes/enviar-email
// Envia extrato de conta corrente de um ou mais clientes por e-mail
router.post("/api/conta-corrente-clientes/enviar-email", authenticate, async (req, res) => {
  try {
    const { clienteIds, destinatarios } = req.body;
    if (!Array.isArray(clienteIds) || clienteIds.length === 0)
      return res.status(400).json({ message: "Informe ao menos um cliente." });
    if (!Array.isArray(destinatarios) || destinatarios.length === 0)
      return res.status(400).json({ message: "Informe ao menos um destinatário." });
    const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid = destinatarios.find((d) => !reEmail.test(d));
    if (invalid)
      return res.status(400).json({ message: `E-mail inválido: ${invalid}` });

    function fmtBRL(cents) {
      return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }
    function fmtDate(iso) {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString("pt-BR");
    }
    function fmtSigned(cents) {
      if (cents === 0) return "R$ 0,00";
      return (cents > 0 ? "+" : "") + fmtBRL(cents);
    }

    let cfg = {};
    try { cfg = await prisma.configuracaoEscritorio.findFirst() || {}; } catch (_) {}
    const nomeEscritorio = cfg.nomeFantasia || cfg.nome || "Addere";

    // build one section per client
    const sections = [];
    for (const rawId of clienteIds) {
      const clienteId = Number(rawId);
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cliente) continue;

      const lancamentos = await prisma.contaCorrenteCliente.findMany({
        where: { clienteId },
        orderBy: [{ data: "asc" }, { createdAt: "asc" }],
      });

      let saldoAcumCent = cliente.saldoInicialCent || 0;
      const comSaldo = lancamentos.map((l) => {
        saldoAcumCent += l.natureza === "CREDITO" ? l.valorCent : -l.valorCent;
        return { ...l, saldoAcumCent };
      });
      const finalSaldo = comSaldo.length > 0
        ? comSaldo[comSaldo.length - 1].saldoAcumCent
        : (cliente.saldoInicialCent || 0);

      const aberturaVal = cliente.saldoInicialCent || 0;
      const aberturaRow = `
        <tr style="background:#f8fafc">
          <td style="padding:6px 10px;color:#64748b;font-size:12px">${fmtDate(cliente.dataAbertura)}</td>
          <td style="padding:6px 10px;color:#64748b;font-size:12px;font-style:italic">Saldo de abertura</td>
          <td style="padding:6px 10px;font-size:12px;text-align:center">
            <span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:9999px;font-size:11px">Abertura</span>
          </td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#64748b">${fmtSigned(aberturaVal)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:${aberturaVal >= 0 ? "#059669" : "#dc2626"}">${fmtSigned(aberturaVal)}</td>
        </tr>`;

      const rows = comSaldo.map((l, i) => {
        const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
        const natLabel = l.natureza === "CREDITO" ? "Crédito" : "Débito";
        const natColor = l.natureza === "CREDITO" ? "#059669" : "#dc2626";
        const valStr = l.natureza === "DEBITO" ? `-${fmtBRL(l.valorCent)}` : `+${fmtBRL(l.valorCent)}`;
        const saldoColor = l.saldoAcumCent >= 0 ? "#059669" : "#dc2626";
        return `
          <tr style="background:${bg}">
            <td style="padding:6px 10px;font-size:12px;color:#475569">${fmtDate(l.data)}</td>
            <td style="padding:6px 10px;font-size:12px;color:#1e293b">
              ${l.descricao || "—"}
              ${l.observacoes ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${l.observacoes}</div>` : ""}
            </td>
            <td style="padding:6px 10px;font-size:12px;text-align:center">
              <span style="background:${l.natureza === "CREDITO" ? "#d1fae5" : "#fee2e2"};color:${natColor};padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600">${natLabel}</span>
            </td>
            <td style="padding:6px 10px;font-size:12px;text-align:right;color:${natColor};font-weight:500">${valStr}</td>
            <td style="padding:6px 10px;font-size:12px;text-align:right;color:${saldoColor};font-weight:600">${fmtSigned(l.saldoAcumCent)}</td>
          </tr>`;
      }).join("");

      const saldoColor = finalSaldo >= 0 ? "#059669" : "#dc2626";
      sections.push(`
        <div style="margin-bottom:32px">
          <div style="background:#1e293b;color:#fff;padding:10px 14px;border-radius:8px 8px 0 0">
            <span style="font-weight:700;font-size:14px">${cliente.nomeRazaoSocial}</span>
            ${cliente.cpfCnpj ? `<span style="font-size:11px;color:#94a3b8;margin-left:10px">${cliente.cpfCnpj}</span>` : ""}
          </div>
          <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
            <thead>
              <tr style="background:#f1f5f9">
                <th style="padding:7px 10px;font-size:11px;font-weight:600;color:#64748b;text-align:left">Data</th>
                <th style="padding:7px 10px;font-size:11px;font-weight:600;color:#64748b;text-align:left">Descrição</th>
                <th style="padding:7px 10px;font-size:11px;font-weight:600;color:#64748b;text-align:center">Natureza</th>
                <th style="padding:7px 10px;font-size:11px;font-weight:600;color:#64748b;text-align:right">Valor</th>
                <th style="padding:7px 10px;font-size:11px;font-weight:600;color:#64748b;text-align:right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              ${aberturaRow}
              ${rows || `<tr><td colspan="5" style="padding:16px;text-align:center;color:#94a3b8;font-size:12px">Nenhum lançamento</td></tr>`}
            </tbody>
          </table>
          <div style="text-align:right;margin-top:6px;font-size:13px;font-weight:700;color:${saldoColor}">
            Saldo final: ${fmtSigned(finalSaldo)}
          </div>
        </div>`);
    }

    if (sections.length === 0)
      return res.status(404).json({ message: "Nenhum cliente encontrado." });

    const emitidoEm = new Date().toLocaleDateString("pt-BR") + " às " +
      new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const plural = sections.length > 1 ? `${sections.length} clientes` : "1 cliente";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px">
  <div style="background:#1e293b;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:16px;font-weight:700">${nomeEscritorio}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px">Conta Corrente de Clientes</div>
    </div>
    <div style="font-size:11px;color:#94a3b8;text-align:right">
      ${plural}<br>Emitido em ${emitidoEm}
    </div>
  </div>
  <div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
    ${sections.join("")}
  </div>
  <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px">
    Enviado pelo sistema Addere Control
  </div>
</div>
</body></html>`;

    await sendEmail({
      to: destinatarios,
      subject: `${nomeEscritorio} — Conta Corrente de Clientes (${plural})`,
      html,
    });

    res.json({ ok: true, enviados: sections.length, destinatarios: destinatarios.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// POST /api/conta-corrente-clientes/:clienteId/honorarios
// Operação atômica: DÉBITO CC + LC SAÍDA Conta Clientes
//                 + AV (ContratoPagamento AV-xxx) com parcela RECEBIDA
// (LC ENTRADA na conta destino não é gerada aqui — o AV já registra o recebimento)
// ============================================================
router.post("/api/conta-corrente-clientes/:clienteId/honorarios", authenticate, async (req, res) => {
  try {
    const clienteId = Number(req.params.clienteId);
    const { valorCent, contaId, historico, dataRecebimento, meioRecebimento,
            isentoTributacao, repasseAdvogadoPrincipalId, repasseIndicacaoAdvogadoId, usaSplitSocio,
            splits } = req.body;

    if (!valorCent || !contaId || !historico || !dataRecebimento) {
      return res.status(400).json({ message: "Campos obrigatórios: valorCent, contaId, historico, dataRecebimento." });
    }
    const valor = Number(valorCent);
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ message: "valorCent inválido." });
    }

    const dataObj = new Date(dataRecebimento + "T12:00:00");
    if (isNaN(dataObj.getTime())) {
      return res.status(400).json({ message: "dataRecebimento inválida (AAAA-MM-DD)." });
    }

    const valorDec    = valor / 100;
    const historicoStr = String(historico).trim();
    const competenciaAno = dataObj.getFullYear();
    const competenciaMes = dataObj.getMonth() + 1;

    const [cliente, contaClientes] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true, nomeRazaoSocial: true } }),
      prisma.livroCaixaConta.findFirst({ where: { nome: "Clientes" } }),
    ]);
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado." });

    // Processa splits: percentual "20,00" → bp 2000
    const splitsArr = Array.isArray(splits) ? splits : [];
    const splitsToCreate = splitsArr
      .filter(s => s && s.advogadoId)
      .map(s => {
        const raw = String(s.percentual || "").replace(/[^0-9,]/g, "").replace(",", ".");
        const n = Number(raw);
        const bp = Number.isFinite(n) ? Math.round(n * 100) : 0;
        return { advogadoId: Number(s.advogadoId), percentualBp: bp };
      });

    const numeroAV = await gerarNumeroContratoComPrefixo(dataObj, "AV-");

    const result = await prisma.$transaction(async (tx) => {
      // 1. CC DÉBITO — retira da conta corrente do cliente
      await tx.contaCorrenteCliente.create({
        data: {
          clienteId,
          data: dataObj,
          descricao: historicoStr,
          documento: null,
          valorCent: valor,
          natureza: "DEBITO",
        },
      });

      // 2. LC ENTRADA na conta destino (Banco Inter etc.) — registro do recebimento
      await tx.livroCaixaLancamento.create({
        data: {
          competenciaAno, competenciaMes,
          data: dataObj, documento: null,
          es: "E",
          clienteFornecedor: cliente.nomeRazaoSocial,
          historico: `${historicoStr} — ${numeroAV}`,
          valorCentavos: valor,
          contaId: Number(contaId),
          clienteContaId: clienteId,
          ordemDia: 0,
          origem: "MANUAL",
          status: "OK",
          statusFluxo: "EFETIVADO",
        },
      });

      // 3. ContratoPagamento + 1 parcela RECEBIDA (AV)
      const contrato = await tx.contratoPagamento.create({
        data: {
          clienteId,
          observacoes: historicoStr,
          formaPagamento: "AVISTA",
          valorTotal: valorDec,
          numeroContrato: numeroAV,
          isentoTributacao: isentoTributacao === true || isentoTributacao === "true",
          usaSplitSocio: usaSplitSocio === true || usaSplitSocio === "true",
          repasseAdvogadoPrincipalId: repasseAdvogadoPrincipalId ? Number(repasseAdvogadoPrincipalId) : null,
          repasseIndicacaoAdvogadoId: repasseIndicacaoAdvogadoId ? Number(repasseIndicacaoAdvogadoId) : null,
          ...(splitsToCreate.length ? { splits: { createMany: { data: splitsToCreate } } } : {}),
          parcelas: {
            create: {
              numero: 1,
              vencimento: dataObj,
              status: "RECEBIDA",
              valorPrevisto: valorDec,
              valorRecebido: valorDec,
              dataRecebimento: dataObj,
              meioRecebimento: String(meioRecebimento || "TRANSFERENCIA"),
            },
          },
        },
        include: { parcelas: true },
      });

      const parcela = contrato.parcelas[0];

      return {
        contratoId: contrato.id,
        parcelaId: parcela.id,
        numeroAV,
      };
    });

    return res.status(201).json({ ok: true, ...result });

  } catch (err) {
    console.error("[honorarios] Erro:", err.message, err.meta);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
