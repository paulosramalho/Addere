import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { logAuditoria } from "../lib/audit.js";
import { sendEmail } from "../lib/email.js";

const router = Router();

// ============================================================
// CLIENTES
// ============================================================

router.get("/api/pessoas", authenticate, async (req, res) => {
  try {
    const { tipos: tiposParam, tipo: tipoParam, search, limit, includeInativo } = req.query;
    const tiposRaw = tiposParam || tipoParam || "";
    const tipos = String(tiposRaw)
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t) => ["C", "F", "A"].includes(t));

    const where = includeInativo === "true" ? {} : { ativo: true };
    if (tipos.length > 0) where.tipo = { in: tipos };

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { nomeRazaoSocial: { contains: q, mode: "insensitive" } },
        { cpfCnpj: { contains: q.replace(/\D/g, ""), mode: "insensitive" } },
      ];
    }

    const pessoas = await prisma.cliente.findMany({
      where,
      orderBy: { nomeRazaoSocial: "asc" },
      take: limit ? Math.min(Number(limit), 2000) : 2000,
      select: {
        id: true,
        nomeRazaoSocial: true,
        cpfCnpj: true,
        email: true,
        telefone: true,
        tipo: true,
        ativo: true,
      },
    });

    res.json(pessoas.map((p) => ({ ...p, nome: p.nomeRazaoSocial })));
  } catch (error) {
    console.error("Erro ao buscar pessoas:", error);
    res.status(500).json({ message: "Erro ao buscar pessoas." });
  }
});

router.get("/api/clients", authenticate, async (req, res) => {
  try {
    const { tipo: tipoParam, search, limit, includeInativo } = req.query;
    const where = includeInativo === "true" ? {} : { ativo: true };

    if (tipoParam) {
      const tipos = String(tipoParam).split(",").map(t => t.trim().toUpperCase()).filter(t => ["C", "F", "A"].includes(t));
      if (tipos.length > 0) where.tipo = { in: tipos };
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { nomeRazaoSocial: { contains: q, mode: "insensitive" } },
        { cpfCnpj: { contains: q.replace(/\D/g, ""), mode: "insensitive" } },
      ];
    }

    const clientes = await prisma.cliente.findMany({
      where,
      orderBy: { nomeRazaoSocial: "asc" },
      take: limit ? Math.min(Number(limit), 2000) : 2000,
    });
    res.json(clientes);
  } catch (error) {
    console.error("Erro ao buscar clientes:", error);
    res.status(500).json({ message: "Erro ao buscar clientes." });
  }
});

router.post("/api/clients", authenticate, async (req, res) => {
  try {
    const { cpfCnpj, nomeRazaoSocial, email, telefone, observacoes, tipo, naoEnviarEmails,
            cep, endereco, numero, complemento, bairro, cidade, uf } = req.body;

    const cliente = await prisma.cliente.create({
      data: {
        cpfCnpj,
        nomeRazaoSocial,
        email,
        telefone,
        observacoes,
        cep: cep || null,
        endereco: endereco || null,
        numero: numero || null,
        complemento: complemento || null,
        bairro: bairro || null,
        cidade: cidade || null,
        uf: uf || null,
        ...(tipo ? { tipo } : {}),
        naoEnviarEmails: Boolean(naoEnviarEmails),
      },
    });

    res.status(201).json(cliente);
  } catch (error) {
    console.error("Erro ao criar cliente:", error);
    res.status(500).json({ message: "Erro ao criar cliente." });
  }
});

function buildEmailSecretariaEditouCliente(adminNome, secretariaNome, cliente, antes, depois) {
  const LABELS = { telefone: "Telefone", email: "E-mail" };
  const linhas = Object.keys(antes)
    .filter((k) => antes[k] !== depois[k])
    .map((k) => `
      <tr>
        <td style="padding:7px 12px;font-weight:600;color:#374151;border-bottom:1px solid #f1f5f9">${LABELS[k] || k}</td>
        <td style="padding:7px 12px;color:#dc2626;border-bottom:1px solid #f1f5f9">${antes[k] || "—"}</td>
        <td style="padding:7px 12px;color:#16a34a;font-weight:600;border-bottom:1px solid #f1f5f9">${depois[k] || "—"}</td>
      </tr>`)
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:16px">📋 Secretária Virtual — Edição de Cliente</h2>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none">
        <p style="margin:0 0 12px">Olá, <strong>${adminNome}</strong>!</p>
        <p style="margin:0 0 16px;color:#374151">A secretária <strong>${secretariaNome}</strong> editou o cliente <strong>${cliente.nomeRazaoSocial}</strong>:</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Campo</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Antes</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Depois</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <div style="background:#f9fafb;padding:12px;text-align:center;font-size:11px;color:#9ca3af;border-radius:0 0 8px 8px">
        Addere — Sistema de Gestão Financeira
      </div>
    </div>`;
}

router.put("/api/clients/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";
    const isSecretaria = req.user?.tipoUsuario === "SECRETARIA_VIRTUAL";

    if (!isAdmin && !isSecretaria) return res.status(403).json({ message: "Acesso negado." });

    const clienteAtual = await prisma.cliente.findUnique({ where: { id: parseInt(id) } });
    if (!clienteAtual) return res.status(404).json({ message: "Cliente não encontrado." });

    let data;
    if (isSecretaria) {
      // Secretária: apenas telefone e e-mail
      const { telefone, email } = req.body;
      data = {};
      if (telefone !== undefined) data.telefone = telefone || null;
      if (email !== undefined) data.email = email || null;

      const dadosAntes = { telefone: clienteAtual.telefone, email: clienteAtual.email };
      const dadosDepois = {
        telefone: data.telefone !== undefined ? data.telefone : clienteAtual.telefone,
        email: data.email !== undefined ? data.email : clienteAtual.email,
      };

      // Grava log
      await prisma.auditoriaLog.create({
        data: {
          usuarioId: req.user.id,
          acao: "SECRETARIA_EDITAR_CLIENTE",
          entidade: "Cliente",
          entidadeId: parseInt(id),
          dadosAntes,
          dadosDepois,
          ip: req.ip,
        },
      });

      // E-mail para admins
      const secretaria = await prisma.usuario.findUnique({ where: { id: req.user.id }, select: { nome: true } });
      const admins = await prisma.usuario.findMany({ where: { role: "ADMIN", ativo: true }, select: { email: true, nome: true } });
      for (const admin of admins) {
        try {
          await sendEmail({
            to: admin.email,
            subject: `📋 Edição de cliente por Secretária: ${clienteAtual.nomeRazaoSocial}`,
            html: buildEmailSecretariaEditouCliente(admin.nome, secretaria?.nome || "Secretária", clienteAtual, dadosAntes, dadosDepois),
          });
        } catch (eEmail) { console.error("❌ Email secretaria edição:", eEmail.message); }
      }
    } else {
      const { cpfCnpj, nomeRazaoSocial, email, telefone, observacoes, tipo, naoEnviarEmails,
              cep, endereco, numero, complemento, bairro, cidade, uf } = req.body;
      data = {
        cpfCnpj, nomeRazaoSocial, email, telefone, observacoes,
        cep: cep || null,
        endereco: endereco || null,
        numero: numero || null,
        complemento: complemento || null,
        bairro: bairro || null,
        cidade: cidade || null,
        uf: uf || null,
        ...(tipo ? { tipo } : {}),
        naoEnviarEmails: Boolean(naoEnviarEmails),
      };
    }

    const cliente = await prisma.cliente.update({ where: { id: parseInt(id) }, data });

    if (isAdmin) {
      logAuditoria(req, "EDITAR_CLIENTE", "Cliente", parseInt(id), { nomeRazaoSocial: clienteAtual.nomeRazaoSocial, cpfCnpj: clienteAtual.cpfCnpj, email: clienteAtual.email, telefone: clienteAtual.telefone }, data).catch(() => {});
    }

    res.json(cliente);
  } catch (error) {
    console.error("Erro ao atualizar cliente:", error);
    res.status(500).json({ message: "Erro ao atualizar cliente." });
  }
});

router.patch("/api/clients/:id/toggle", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await prisma.cliente.findUnique({ where: { id: parseInt(id) } });
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado." });
    const updated = await prisma.cliente.update({
      where: { id: parseInt(id) },
      data: { ativo: !cliente.ativo },
    });
    res.json(updated);
  } catch (error) {
    console.error("Erro ao alterar status do cliente:", error);
    res.status(500).json({ message: "Erro ao alterar status do cliente." });
  }
});

router.delete("/api/clients/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.cliente.update({
      where: { id: parseInt(id) },
      data: { ativo: false },
    });

    res.json({ message: "Cliente desativado com sucesso." });
  } catch (error) {
    console.error("Erro ao desativar cliente:", error);
    res.status(500).json({ message: "Erro ao desativar cliente." });
  }
});

// ============================================================
// CLIENTES — DEDUPLICAÇÃO
// ============================================================

// GET /api/clients/duplicados — detect potential duplicates by name similarity / CPF / email
router.get("/api/clients/duplicados", authenticate, requireAdmin, async (req, res) => {
  try {
    const clientes = await prisma.cliente.findMany({ orderBy: { nomeRazaoSocial: "asc" } });

    function normWords(s) {
      // strip accents, lowercase, remove short/stop words
      const STOP = new Set(["de", "do", "da", "dos", "das", "e", "em", "na", "no", "ao", "a", "o"]);
      return (s || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
    }

    function nameSim(a, b) {
      const wa = normWords(a), wb = normWords(b);
      if (!wa.length || !wb.length) return 0;
      const setB = new Set(wb);
      const shared = wa.filter((w) => setB.has(w)).length;
      return shared / Math.max(wa.length, wb.length);
    }

    const grupos = [];
    const usados = new Set();

    // Pré-indexar campos exatos para evitar O(n²) em comparações triviais (#16)
    const cpfMap = new Map();   // cpfCnpj → [clienteId, ...]
    const emailMap = new Map(); // email.lower → [clienteId, ...]
    const telMap = new Map();   // telefone → [clienteId, ...]
    for (const c of clientes) {
      if (c.cpfCnpj) { const l = cpfMap.get(c.cpfCnpj) || []; l.push(c.id); cpfMap.set(c.cpfCnpj, l); }
      if (c.email) { const k = c.email.toLowerCase(); const l = emailMap.get(k) || []; l.push(c.id); emailMap.set(k, l); }
      if (c.telefone) { const l = telMap.get(c.telefone) || []; l.push(c.id); telMap.set(c.telefone, l); }
    }
    // Pares exatos já detectados (evita duplicar no loop n²)
    const paresExatos = new Set();
    function _pairKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

    for (let i = 0; i < clientes.length; i++) {
      const a = clientes[i];
      if (usados.has(a.id)) continue;
      const grupo = { principal: a, similares: [] };

      for (let j = i + 1; j < clientes.length; j++) {
        const b = clientes[j];
        if (usados.has(b.id)) continue;
        const razoes = [];

        if (a.cpfCnpj && b.cpfCnpj && a.cpfCnpj === b.cpfCnpj)
          razoes.push({ tipo: "CPF/CNPJ idêntico", confianca: "ALTA" });
        if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase())
          razoes.push({ tipo: "E-mail idêntico", confianca: "ALTA" });
        if (a.telefone && b.telefone && a.telefone === b.telefone)
          razoes.push({ tipo: "Telefone idêntico", confianca: "ALTA" });

        const sim = nameSim(a.nomeRazaoSocial, b.nomeRazaoSocial);
        if (sim >= 0.55) {
          razoes.push({ tipo: `Nome similar (${Math.round(sim * 100)}%)`, confianca: sim >= 0.8 ? "ALTA" : sim >= 0.7 ? "MÉDIA" : "BAIXA" });
        } else {
          // detecta quando todas as palavras do nome mais curto estão contidas no nome mais longo
          const wa2 = normWords(a.nomeRazaoSocial), wb2 = normWords(b.nomeRazaoSocial);
          const [shorter2, longerSet2] = wa2.length <= wb2.length
            ? [wa2, new Set(wb2)]
            : [wb2, new Set(wa2)];
          if (shorter2.length >= 2 && shorter2.every((w) => longerSet2.has(w))) {
            razoes.push({ tipo: "Nome contido no outro", confianca: "MÉDIA" });
          }
        }

        if (razoes.length > 0) {
          grupo.similares.push({ cliente: b, razoes });
        }
      }

      if (grupo.similares.length > 0) {
        grupo.similares.forEach((s) => usados.add(s.cliente.id));
        usados.add(a.id);
        grupos.push(grupo);
      }
    }

    res.json({ grupos, total: grupos.length });
  } catch (error) {
    console.error("Erro ao buscar duplicados:", error);
    res.status(500).json({ message: "Erro ao buscar duplicados." });
  }
});

// GET /api/busca-global?q=... — busca clientes + contratos em paralelo
router.get("/api/busca-global", authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 3) return res.json({ clientes: [], contratos: [] });

    const digits = q.replace(/\D/g, "");
    const isAdmin = String(req.user?.role || "").toUpperCase() === "ADMIN";

    const [clientes, contratos] = await Promise.all([
      prisma.cliente.findMany({
        where: {
          OR: [
            { nomeRazaoSocial: { contains: q, mode: "insensitive" } },
            ...(digits ? [{ cpfCnpj: { contains: digits } }] : []),
          ],
        },
        select: { id: true, nomeRazaoSocial: true, cpfCnpj: true, ativo: true },
        take: 5,
        orderBy: { nomeRazaoSocial: "asc" },
      }),
      isAdmin ? prisma.contratoPagamento.findMany({
        where: {
          OR: [
            { numeroContrato: { contains: q, mode: "insensitive" } },
            { cliente: { nomeRazaoSocial: { contains: q, mode: "insensitive" } } },
          ],
          ativo: true,
        },
        select: {
          id: true, numeroContrato: true, valorTotal: true,
          cliente: { select: { nomeRazaoSocial: true } },
        },
        take: 5,
        orderBy: { createdAt: "desc" },
      }) : Promise.resolve([]),
    ]);

    res.json({ clientes, contratos });
  } catch (e) {
    console.error("Erro busca-global:", e.message);
    res.status(500).json({ message: "Erro na busca." });
  }
});

// GET /api/clients/:id/vinculos — count all linked records
router.get("/api/clients/:id/vinculos", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [contratos, lancamentos, contaCorrente, adiantamentos, comprovantes] = await Promise.all([
      prisma.contratoPagamento.count({ where: { clienteId: id } }),
      prisma.livroCaixaLancamento.count({ where: { clienteContaId: id } }),
      prisma.contaCorrenteCliente.count({ where: { clienteId: id } }),
      prisma.adiantamentoSocio.count({ where: { clienteId: id } }),
      prisma.comprovanteRespostaCliente.count({ where: { clienteId: id } }),
    ]);
    res.json({ contratos, lancamentos, contaCorrente, adiantamentos, comprovantes,
      total: contratos + lancamentos + contaCorrente + adiantamentos + comprovantes });
  } catch (error) {
    console.error("Erro ao buscar vínculos:", error);
    res.status(500).json({ message: "Erro ao buscar vínculos." });
  }
});

// GET /api/clients/:id — busca cliente por id
router.get("/api/clients/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await prisma.cliente.findUnique({ where: { id: parseInt(id) } });
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado." });
    res.json(cliente);
  } catch (error) {
    console.error("Erro ao buscar cliente:", error);
    res.status(500).json({ message: "Erro ao buscar cliente." });
  }
});

// POST /api/clients/:id/merge-into/:targetId — move all relations from :id → :targetId, then delete :id
router.post("/api/clients/:id/merge-into/:targetId", authenticate, requireAdmin, async (req, res) => {
  try {
    const fromId = parseInt(req.params.id);
    const toId = parseInt(req.params.targetId);
    if (fromId === toId) return res.status(400).json({ message: "Origem e destino são o mesmo registro." });

    const [from, to] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: fromId } }),
      prisma.cliente.findUnique({ where: { id: toId } }),
    ]);
    if (!from) return res.status(404).json({ message: "Cliente origem não encontrado." });
    if (!to) return res.status(404).json({ message: "Cliente destino não encontrado." });

    // Move all relations
    await prisma.$transaction([
      prisma.contratoPagamento.updateMany({ where: { clienteId: fromId }, data: { clienteId: toId } }),
      prisma.livroCaixaLancamento.updateMany({ where: { clienteContaId: fromId }, data: { clienteContaId: toId } }),
      prisma.contaCorrenteCliente.updateMany({ where: { clienteId: fromId }, data: { clienteId: toId } }),
      prisma.adiantamentoSocio.updateMany({ where: { clienteId: fromId }, data: { clienteId: toId } }),
      prisma.repasseManualLancamento.updateMany({ where: { clienteId: fromId }, data: { clienteId: toId } }),
      prisma.comprovanteRespostaCliente.updateMany({ where: { clienteId: fromId }, data: { clienteId: toId } }),
    ]);

    // Merge saldoInicialCent from the deleted record into target
    if (from.saldoInicialCent) {
      await prisma.cliente.update({ where: { id: toId }, data: { saldoInicialCent: { increment: from.saldoInicialCent } } });
    }

    // Delete the duplicate
    await prisma.cliente.delete({ where: { id: fromId } });

    // Audit log
    await prisma.auditoriaLog.create({
      data: {
        usuarioId: req.user.id, acao: "MERGE_CLIENTE",
        entidade: "Cliente", entidadeId: toId,
        dadosAntes: { fromId, fromNome: from.nomeRazaoSocial, fromCpfCnpj: from.cpfCnpj },
        dadosDepois: { toId, toNome: to.nomeRazaoSocial, toCpfCnpj: to.cpfCnpj },
        ip: req.ip,
      },
    });

    res.json({ message: `Registros fundidos com sucesso. "${from.nomeRazaoSocial}" → "${to.nomeRazaoSocial}".` });
  } catch (error) {
    console.error("Erro ao fundir clientes:", error);
    res.status(500).json({ message: "Erro ao fundir clientes: " + error.message });
  }
});

// ============================================================
// LOG DE OPERAÇÕES (Secretária Virtual)
// ============================================================

router.get("/api/log-operacoes", authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, acao } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { acao: { startsWith: "SECRETARIA_" } };
    if (acao) where.acao = acao;

    const [logs, total] = await Promise.all([
      prisma.auditoriaLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
        include: { usuario: { select: { id: true, nome: true, email: true, role: true, ghostAdmin: true } } },
      }),
      prisma.auditoriaLog.count({ where }),
    ]);

    // Enrich with entity name
    const clienteIds = [...new Set(logs.filter((l) => l.entidade === "Cliente" && l.entidadeId).map((l) => l.entidadeId))];
    const clientes = clienteIds.length
      ? await prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, nomeRazaoSocial: true } })
      : [];
    const clienteMap = Object.fromEntries(clientes.map((c) => [c.id, c.nomeRazaoSocial]));

    const enriched = logs.map((l) => ({
      ...l,
      entidadeNome: l.entidade === "Cliente" ? (clienteMap[l.entidadeId] || `Cliente #${l.entidadeId}`) : null,
    }));

    res.json({ logs: enriched, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error("Erro ao buscar log de operações:", error);
    res.status(500).json({ message: "Erro ao buscar log de operações." });
  }
});

router.post("/api/log-operacoes/:id/rollback", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { campos } = req.body; // string[] — campos a reverter; se ausente, reverte todos

    const log = await prisma.auditoriaLog.findUnique({ where: { id: parseInt(id) } });
    if (!log) return res.status(404).json({ message: "Log não encontrado." });
    if (!log.dadosAntes) return res.status(400).json({ message: "Log sem dados anteriores para rollback." });
    if (log.entidade !== "Cliente") return res.status(400).json({ message: "Rollback só suportado para entidade Cliente." });

    const antes = log.dadosAntes;
    const camposAlvo = Array.isArray(campos) && campos.length > 0 ? campos : Object.keys(antes);

    // Campos permitidos
    const CAMPOS_PERMITIDOS = ["telefone", "email"];
    const camposFiltrados = camposAlvo.filter((c) => CAMPOS_PERMITIDOS.includes(c) && c in antes);
    if (!camposFiltrados.length) return res.status(400).json({ message: "Nenhum campo válido para rollback." });

    // Estado atual antes do rollback
    const clienteAtual = await prisma.cliente.findUnique({ where: { id: log.entidadeId } });
    if (!clienteAtual) return res.status(404).json({ message: "Cliente não encontrado." });

    const dadosAntes = {};
    const dadosDepois = {};
    const dataRollback = {};
    for (const campo of camposFiltrados) {
      dadosAntes[campo] = clienteAtual[campo];
      dadosDepois[campo] = antes[campo];
      dataRollback[campo] = antes[campo] !== undefined ? antes[campo] : null;
    }

    await prisma.cliente.update({ where: { id: log.entidadeId }, data: dataRollback });

    // Grava log do rollback (dadosDepois inclui referência ao log de origem)
    await prisma.auditoriaLog.create({
      data: {
        usuarioId: req.user.id,
        acao: "SECRETARIA_ROLLBACK_CLIENTE",
        entidade: "Cliente",
        entidadeId: log.entidadeId,
        dadosAntes,
        dadosDepois: { ...dadosDepois, _logOrigemId: log.id, _camposRevertidos: camposFiltrados },
        ip: req.ip,
      },
    });

    res.json({ message: "Rollback realizado com sucesso.", camposRevertidos: camposFiltrados });
  } catch (error) {
    console.error("Erro ao fazer rollback:", error);
    res.status(500).json({ message: "Erro ao fazer rollback." });
  }
});

export default router;
