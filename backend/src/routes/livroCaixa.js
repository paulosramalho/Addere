import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { upload, _extrairTextoImagem } from "../lib/upload.js";
import { extractPdfRowsByColumns, extractPdfLines } from "../lib/pdfParser.js";
import { parseDateDDMMYYYY, formatDateBR, gerarNumeroContratoComPrefixo, convertValueToDecimal } from "../lib/contratoHelpers.js";
import { sendWhatsApp, sendWhatsAppStrict, sendWhatsAppTemplate, _waPhone } from "../lib/whatsapp.js";
import { sendEmail } from "../lib/email.js";
import { buildEmailVencidos } from "../lib/emailTemplates.js";
import crypto from "crypto";
import PDFDocument from "pdfkit";

const router = Router();

const TIPOS_CONTA_CONTABIL = ["BANCO", "APLICACAO", "CAIXA", "CLIENTES", "CARTAO_CREDITO", "CARTAO_DEBITO", "OUTROS"];

function normalizarContaContabil(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

async function encontrarContaContabilDuplicada({ nome, tipo, excetoId = null }) {
  const tipoNormalizado = String(tipo || "").trim().toUpperCase();
  const nomeNormalizado = normalizarContaContabil(nome);
  if (!tipoNormalizado || !nomeNormalizado) return null;

  const contas = await prisma.livroCaixaConta.findMany({
    where: {
      tipo: tipoNormalizado,
      ...(excetoId ? { id: { not: Number(excetoId) } } : {}),
    },
    select: { id: true, nome: true },
  });

  return contas.find((conta) => normalizarContaContabil(conta.nome) === nomeNormalizado) || null;
}

async function getOrCreateContaContabilImportada(nome, tx = prisma) {
  const nomeFinal = String(nome || "Outro (importado)").replace(/\s+/g, " ").trim();
  const nomeNormalizado = normalizarContaContabil(nomeFinal);
  const contas = await tx.livroCaixaConta.findMany({
    select: { id: true, nome: true },
  });
  const existente = contas.find((conta) => normalizarContaContabil(conta.nome) === nomeNormalizado);
  if (existente) return existente;

  return tx.livroCaixaConta.create({
    data: {
      nome: nomeFinal,
      tipo: "OUTROS",
      ordem: 999,
      ativa: true,
    },
  });
}

// ============================================================

// ============================================================
// CORREÇÃO: CÁLCULO DO SALDO ANTERIOR
// ============================================================
// Adicione essas funções ANTES das rotas do Livro Caixa no server.js

/**
 * Calcula o saldo anterior (acumulado até o mês anterior)
 * @param {number} ano - Ano da competência atual
 * @param {number} mes - Mês da competência atual (1-12)
 * @returns {Promise<number>} - Saldo em centavos
 */
async function calcularSaldoAnterior(ano, mes) {
  try {
    // 1️⃣ Calcular o mês anterior ao solicitado
    let anoAnt = mes === 1 ? ano - 1 : ano;
    let mesAnt = mes === 1 ? 12 : mes - 1;

    console.log(`🔍 Calculando saldo anterior para ${mes}/${ano} (buscando até ${mesAnt}/${anoAnt})`);

    // 2️⃣ Buscar o saldo inicial mais antigo (ponto de partida opcional)
      const saldoInicial = await prisma.livroCaixaSaldoInicial.findFirst({
        orderBy: [
          { competenciaAno: 'asc' },
            { competenciaMes: 'asc' }
        ]
      });

      let saldoAcumulado = saldoInicial?.saldoInicialCent ?? 0;
      let anoInicio = saldoInicial?.competenciaAno ?? 1900;
      let mesInicio = saldoInicial?.competenciaMes ?? 1;

      if (saldoInicial) {
        console.log(`   📌 Saldo inicial encontrado: R$ ${(saldoAcumulado / 100).toFixed(2)} em ${mesInicio}/${anoInicio}`);
    }

    // 3️⃣ Buscar TODOS os lançamentos efetivados desde o início até o MÊS ANTERIOR (não inclui o mês atual!)
    const lancamentos = await prisma.livroCaixaLancamento.findMany({
      where: {
        statusFluxo: "EFETIVADO",
        OR: [
          // Caso 1: Todos os anos anteriores ao ano anterior
          {
            competenciaAno: {
              gte: anoInicio,
              lt: anoAnt
            }
          },
          // Caso 2: O ano atual/anterior, mas apenas até o mês anterior (exclusive)
          {
            competenciaAno: anoAnt,
            competenciaMes: {
              lte: mesAnt
            }
          }
        ]
      },
      orderBy: [
        { competenciaAno: 'asc' },
        { competenciaMes: 'asc' },
        { data: 'asc' }
      ],
      select: {
        competenciaAno: true,
        competenciaMes: true,
        es: true,
        valorCentavos: true
      }
    });

    console.log(`   📋 ${lancamentos.length} lançamentos efetivados encontrados`);

    // 4️⃣ Somar/subtrair os lançamentos
    for (const lanc of lancamentos) {
      if (lanc.es === "E") {
        saldoAcumulado += lanc.valorCentavos;
      } else if (lanc.es === "S") {
        saldoAcumulado -= lanc.valorCentavos;
      }
    }

    // 5️⃣ Somar saldos iniciais de contas abertas ANTES do período solicitado
    const primeiroDiaPeriodo = new Date(Date.UTC(ano, mes - 1, 1));
    const contasAnteriores = await prisma.livroCaixaConta.findMany({
      where: {
        saldoInicialCent: { not: 0 },
        dataInicial: { not: null, lt: primeiroDiaPeriodo },
      },
      select: { saldoInicialCent: true, nome: true },
    });
    for (const conta of contasAnteriores) {
      saldoAcumulado += conta.saldoInicialCent;
      console.log(`   💰 Saldo inicial conta "${conta.nome}": R$ ${(conta.saldoInicialCent / 100).toFixed(2)}`);
    }

    console.log(`   ✅ Saldo anterior calculado: R$ ${(saldoAcumulado / 100).toFixed(2)}\n`);

    return saldoAcumulado;

  } catch (error) {
    console.error("❌ Erro ao calcular saldo anterior:", error);
    return 0;
  }
}

/**
 * Versão simplificada: calcula saldo de um mês específico
 * @param {number} ano 
 * @param {number} mes 
 * @returns {Promise<number>}
 */
async function calcularSaldoMesEspecifico(ano, mes) {
  const saldoAnterior = await calcularSaldoAnterior(ano, mes);
  
  // Buscar lançamentos do mês atual
  const lancamentos = await prisma.livroCaixaLancamento.findMany({
    where: {
      competenciaAno: ano,
      competenciaMes: mes,
      statusFluxo: "EFETIVADO"
    },
    select: {
      es: true,
      valorCentavos: true
    }
  });

  let saldo = saldoAnterior;
  for (const lanc of lancamentos) {
    if (lanc.es === "E") {
      saldo += lanc.valorCentavos;
    } else if (lanc.es === "S") {
      saldo -= lanc.valorCentavos;
    }
  }

  return saldo;
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return false;

  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "yes" || s === "sim";
}
router.get("/api/livro-caixa/debug/status", authenticate, async (req, res) => {
  try {
    const { ano, mes } = parseAnoMesFromQuery(req);

    const stats = await prisma.livroCaixaLancamento.groupBy({
      by: ['statusFluxo', 'origem'],
      where: {
        competenciaAno: ano,
        competenciaMes: mes,
      },
      _count: true,
      _sum: {
        valorCentavos: true,
      },
    });

    const previstos = await prisma.livroCaixaLancamento.findMany({
      where: {
        competenciaAno: ano,
        competenciaMes: mes,
        statusFluxo: "PREVISTO",
      },
      select: {
        id: true,
        data: true,
        historico: true,
        valorCentavos: true,
        referenciaOrigem: true,
      },
      orderBy: { data: 'asc' },
      take: 10,
    });

    res.json({
      competencia: { ano, mes },
      estatisticas: stats.map(s => ({
        statusFluxo: s.statusFluxo,
        origem: s.origem,
        quantidade: s._count,
        valorTotal: ((s._sum.valorCentavos || 0) / 100).toFixed(2),
      })),
      exemplosPrevistos: previstos.map(p => ({
        id: p.id,
        data: formatDateBR(p.data),
        historico: p.historico,
        valor: ((p.valorCentavos || 0) / 100).toFixed(2),
        referencia: p.referenciaOrigem,
      })),
    });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ============================================================
// LIVRO CAIXA - CONTAS CONTÁBEIS (VERSÃO CORRIGIDA)
// ============================================================

console.log('📋 Carregando rotas de Livro Caixa Contas...');

// ----------------------------
// LISTAR CONTAS
// ----------------------------
router.get("/api/livro-caixa/contas", authenticate, async (req, res) => {
  try {
    console.log('📊 GET /api/livro-caixa/contas - Listando contas...');
    
    const contas = await prisma.livroCaixaConta.findMany({
      orderBy: [
        { tipo: "asc" },
        { ordem: "asc" },
      ],
    });

    console.log(`✅ ${contas.length} conta(s) encontrada(s)`);
    
    // ✅ Retorna array direto (não envolto em objeto)
    res.json(contas);
    
  } catch (error) {
    console.error("❌ Erro ao listar contas:", error);
    res.status(500).json({ 
      message: "Erro ao listar contas",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ----------------------------
// SALDOS POR CONTA
// ----------------------------
router.get("/api/livro-caixa/contas/saldos", authenticate, async (req, res) => {
  try {
    const contas = await prisma.livroCaixaConta.findMany({
      where: { ativa: true },
      orderBy: [{ tipo: "asc" }, { ordem: "asc" }],
    });

    // Soma efetivada por conta (E positivo, S negativo)
    const lancamentos = await prisma.livroCaixaLancamento.groupBy({
      by: ["contaId", "es"],
      where: { statusFluxo: "EFETIVADO", contaId: { not: null } },
      _sum: { valorCentavos: true },
    });

    const saldoMap = {};
    for (const row of lancamentos) {
      const id = row.contaId;
      if (!saldoMap[id]) saldoMap[id] = 0;
      saldoMap[id] += row.es === "E"
        ? (row._sum.valorCentavos || 0)
        : -(row._sum.valorCentavos || 0);
    }

    res.json(contas.map(c => ({
      id:     c.id,
      nome:   c.nome,
      tipo:   c.tipo,
      banco:  c.banco,
      saldo:  (c.saldoInicialCent || 0) + (saldoMap[c.id] || 0),
    })));
  } catch (e) {
    console.error("GET /api/livro-caixa/contas/saldos:", e.message);
    res.status(500).json({ message: "Erro ao calcular saldos." });
  }
});

// ----------------------------
// BUSCAR UMA CONTA
// ----------------------------
router.get("/api/livro-caixa/contas/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🔍 GET /api/livro-caixa/contas/${id}`);

    const conta = await prisma.livroCaixaConta.findUnique({
      where: { id: parseInt(id) },
    });

    if (!conta) {
      return res.status(404).json({ message: "Conta não encontrada" });
    }

    res.json(conta);
    
  } catch (error) {
    console.error("❌ Erro ao buscar conta:", error);
    res.status(500).json({ 
      message: "Erro ao buscar conta",
      error: error.message 
    });
  }
});

// ----------------------------
// CRIAR CONTA
// ----------------------------
router.post("/api/livro-caixa/contas", authenticate, async (req, res) => {
  try {
    console.log('➕ POST /api/livro-caixa/contas');
    console.log('📦 Body recebido:', JSON.stringify(req.body, null, 2));
    
    const { nome, tipo, ordem, ativa, dataInicial, saldoInicialCent, chavePix1, chavePix2 } = req.body;
    const nomeNormalizado = String(nome || "").replace(/\s+/g, " ").trim();
    const tipoNormalizado = String(tipo || "").trim().toUpperCase();

    // Validações
    if (!nomeNormalizado || !tipoNormalizado) {
      console.log('⚠️ Validação falhou: nome ou tipo faltando');
      return res.status(400).json({
        message: "Nome e tipo são obrigatórios"
      });
    }

    if (!TIPOS_CONTA_CONTABIL.includes(tipoNormalizado)) {
      console.log('⚠️ Tipo inválido:', tipo);
      return res.status(400).json({
        message: "Tipo inválido. Use: BANCO, APLICACAO, CAIXA, CLIENTES, CARTAO_CREDITO, CARTAO_DEBITO ou OUTROS"
      });
    }

    const duplicada = await encontrarContaContabilDuplicada({ nome: nomeNormalizado, tipo: tipoNormalizado });
    if (duplicada) {
      return res.status(409).json({ message: `Conta contábil já cadastrada: ${duplicada.nome}` });
    }

    console.log('✅ Validações OK, criando conta...');

    // Criar conta
    const conta = await prisma.livroCaixaConta.create({
      data: {
        nome: nomeNormalizado,
        tipo: tipoNormalizado,
        ordem: parseInt(ordem) || 0,
        ativa: ativa !== undefined ? Boolean(ativa) : true,
        dataInicial: dataInicial ? new Date(`${String(dataInicial).slice(0,10)}T12:00:00.000Z`) : null,
        saldoInicialCent: parseInt(saldoInicialCent) || 0,
        chavePix1: chavePix1 ? String(chavePix1).trim() : null,
        chavePix2: chavePix2 ? String(chavePix2).trim() : null,
      },
    });

    console.log('✅ Conta criada:', conta.id);

    // Sincroniza automaticamente com Clientes quando for BANCO ou APLICACAO
    if (["BANCO", "APLICACAO"].includes(conta.tipo)) {
      await getOrCreatePessoaByNomeETipo(conta.nome, "A").catch((e) =>
        console.warn("⚠️ Sync Clientes (create):", e.message)
      );
    }

    res.status(201).json(conta);
    
  } catch (error) {
    console.error("❌ ERRO ao criar conta:", error);
    console.error("Stack:", error.stack);
    
    res.status(500).json({ 
      message: "Erro ao criar conta",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ----------------------------
// ATUALIZAR CONTA
// ----------------------------
router.put("/api/livro-caixa/contas/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, tipo, ordem, ativa, dataInicial, saldoInicialCent, chavePix1, chavePix2, agencia, conta: contaNum, interContaId } = req.body;

    console.log(`📝 PUT /api/livro-caixa/contas/${id}`);

    // Verificar se existe
    const existente = await prisma.livroCaixaConta.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existente) {
      return res.status(404).json({ message: "Conta não encontrada" });
    }

    const nomeFinalConta = nome !== undefined ? String(nome).replace(/\s+/g, " ").trim() : existente.nome;
    const tipoFinalConta = tipo !== undefined ? String(tipo).trim().toUpperCase() : existente.tipo;

    // Validar tipo se informado
    if (tipo) {
      if (!TIPOS_CONTA_CONTABIL.includes(tipoFinalConta)) {
        return res.status(400).json({
          message: "Tipo inválido. Use: BANCO, APLICACAO, CAIXA, CLIENTES, CARTAO_CREDITO, CARTAO_DEBITO ou OUTROS"
        });
      }
    }

    if (!nomeFinalConta) {
      return res.status(400).json({ message: "Nome é obrigatório" });
    }

    const duplicada = await encontrarContaContabilDuplicada({ nome: nomeFinalConta, tipo: tipoFinalConta, excetoId: id });
    if (duplicada) {
      return res.status(409).json({ message: `Conta contábil já cadastrada: ${duplicada.nome}` });
    }

    // Atualizar
    const conta = await prisma.livroCaixaConta.update({
      where: { id: parseInt(id) },
      data: {
        ...(nome !== undefined && { nome: nomeFinalConta }),
        ...(tipo !== undefined && { tipo: tipoFinalConta }),
        ...(ordem !== undefined && { ordem: parseInt(ordem) }),
        ...(ativa !== undefined && { ativa: Boolean(ativa) }),
        ...(dataInicial !== undefined && { dataInicial: dataInicial ? new Date(`${String(dataInicial).slice(0,10)}T12:00:00.000Z`) : null }),
        ...(saldoInicialCent !== undefined && { saldoInicialCent: parseInt(saldoInicialCent) || 0 }),
        ...(chavePix1 !== undefined && { chavePix1: chavePix1 ? String(chavePix1).trim() : null }),
        ...(chavePix2 !== undefined && { chavePix2: chavePix2 ? String(chavePix2).trim() : null }),
        ...(agencia !== undefined && { agencia: agencia ? String(agencia).trim() : null }),
        ...(contaNum !== undefined && { conta: contaNum ? String(contaNum).trim() : null }),
        ...(interContaId !== undefined && { interContaId: interContaId ? String(interContaId).trim() : null }),
      },
    });

    console.log('✅ Conta atualizada');

    // Sincroniza com Clientes se o tipo final for BANCO ou APLICACAO
    if (["BANCO", "APLICACAO"].includes(tipoFinalConta)) {
      await getOrCreatePessoaByNomeETipo(nomeFinalConta, "A").catch((e) =>
        console.warn("⚠️ Sync Clientes (update):", e.message)
      );
    }

    res.json(conta);
    
  } catch (error) {
    console.error("❌ Erro ao atualizar conta:", error);
    res.status(500).json({ 
      message: "Erro ao atualizar conta",
      error: error.message 
    });
  }
});

// ----------------------------
// EXCLUIR CONTA
// ----------------------------
router.delete("/api/livro-caixa/contas/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🗑️ DELETE /api/livro-caixa/contas/${id}`);

    // Verificar se existe
    const existente = await prisma.livroCaixaConta.findUnique({
      where: { id: parseInt(id) },
      include: {
        _count: {
          select: { lancamentos: true },
        },
      },
    });

    if (!existente) {
      return res.status(404).json({ message: "Conta não encontrada" });
    }

    // Verificar se tem lançamentos
    if (existente._count.lancamentos > 0) {
      console.log(`⚠️ Conta ${id} tem ${existente._count.lancamentos} lançamento(s)`);
      return res.status(400).json({ 
        message: `Não é possível excluir. Esta conta possui ${existente._count.lancamentos} lançamento(s) associado(s).`,
        hint: "Você pode desativar a conta ao invés de excluí-la."
      });
    }

    // Excluir
    await prisma.livroCaixaConta.delete({
      where: { id: parseInt(id) },
    });

    console.log('✅ Conta excluída');

    res.json({ 
      success: true,
      message: "Conta excluída com sucesso" 
    });
    
  } catch (error) {
    console.error("❌ Erro ao excluir conta:", error);
    res.status(500).json({ 
      message: "Erro ao excluir conta",
      error: error.message 
    });
  }
});

console.log('✅ Rotas de Livro Caixa Contas carregadas');

// ============================================================
// DADOS BANCÁRIOS — envio via WhatsApp
// ============================================================
router.post("/api/dados-bancarios/enviar", authenticate, async (req, res) => {
  try {
    const { contaIds, phone } = req.body;
    if (!contaIds?.length) return res.status(400).json({ message: "Nenhuma conta selecionada" });
    if (!phone) return res.status(400).json({ message: "Telefone não informado" });

    const contas = await prisma.livroCaixaConta.findMany({
      where: { id: { in: contaIds.map(Number) }, tipo: "BANCO" },
      orderBy: { ordem: "asc" },
    });

    function formatPix(chave) {
      if (!chave) return null;
      const d = chave.replace(/\D/g, "");
      if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)} (CNPJ)`;
      if (d.length === 11 && !chave.includes("@")) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)} (CPF)`;
      if (/^\d{10,11}$/.test(d)) return `(${d.slice(-11,-9)}) ${d.slice(-9,-4)}-${d.slice(-4)} (telefone)`;
      return chave;
    }

    const linhas = ["🏦 *Dados Bancários — Addere*\n"];
    for (const c of contas) {
      linhas.push("━━━━━━━━━━━━━━━━━━━━");
      linhas.push(`*${c.nome.toUpperCase()}*`);
      if (c.agencia || c.conta) {
        const ag = c.agencia ? `Ag: ${c.agencia}` : "";
        const cc = c.conta ? `Cc: ${c.conta}` : "";
        linhas.push([ag, cc].filter(Boolean).join("   |   "));
      }
      if (c.chavePix1) linhas.push(`✦ Pix: ${formatPix(c.chavePix1)}`);
      if (c.chavePix2) linhas.push(`✦ Pix: ${formatPix(c.chavePix2)}`);
      linhas.push("");
    }
    linhas.push("_Addere_");

    const mensagem = linhas.join("\n");
    await sendWhatsApp(_waPhone(phone), mensagem);
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ dados-bancarios/enviar:", e.message);
    res.status(500).json({ message: e.message });
  }
});


// Helpers (aproveita parseDateDDMMYYYY já existente)
function parseAnoMesFromQuery(req) {
  const ano = Number(req.query.ano);
  const mes = Number(req.query.mes);
  if (!ano || Number.isNaN(ano) || ano < 2000) throw new Error("Parâmetro 'ano' inválido.");
  if (!mes || Number.isNaN(mes) || mes < 1 || mes > 12) throw new Error("Parâmetro 'mes' inválido.");
  return { ano, mes };
}

function normTxt(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function brMoneyToCentavos(v) {
  // "1.234,56" -> 123456
  const n = Number(String(v || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function brToISODate(br) {
  // "DD/MM/AAAA" -> "AAAA-MM-DD"
  const [d, m, y] = String(br || "").split("/");
  if (!y || !m || !d) return "";
  return `${y}-${m}-${d}`;
}

async function getContaClientesAtivaId(tx = prisma) {
  const cc = await tx.livroCaixaConta.findFirst({
    where: { tipo: "CLIENTES", ativa: true },
    select: { id: true },
  });
  return cc?.id ?? null;
}

function ccNaturezaFromEs(es) {
  return String(es).toUpperCase() === "S" ? "DEBITO" : "CREDITO";
}

function lcCcMarker(lancamentoId) {
  return `[LC:${lancamentoId}]`;
}

function appendMarkerToObservacoes(observacoes, marker) {
  const base = String(observacoes || "").trim();
  if (!base) return marker;
  if (base.includes(marker)) return base;
  return `${base} ${marker}`.trim();
}

// Garante espelho LC -> ContaCorrenteCliente para lançamentos com clienteContaId.
// 1) Reaproveita lançamento CC já marcado com [LC:id];
// 2) Senão, marca um match exato existente;
// 3) Senão, cria lançamento CC.
async function ensureContaCorrenteEspelhoFromLc(tx, lc) {
  if (!lc?.clienteContaId) return null;

  const marker = lcCcMarker(lc.id);
  const natureza = ccNaturezaFromEs(lc.es);
  const descricao = String(lc.historico || "").trim() || (lc.es === "S" ? "Saída" : "Entrada");
  const documento = lc.documento || null;

  const byMarker = await tx.contaCorrenteCliente.findFirst({
    where: {
      clienteId: lc.clienteContaId,
      observacoes: { contains: marker, mode: "insensitive" },
    },
    select: { id: true, observacoes: true },
  });

  if (byMarker) {
    await tx.contaCorrenteCliente.update({
      where: { id: byMarker.id },
      data: {
        data: lc.data,
        descricao,
        documento,
        valorCent: lc.valorCentavos,
        natureza,
        observacoes: appendMarkerToObservacoes(byMarker.observacoes, marker),
      },
    });
    return byMarker.id;
  }

  const exact = await tx.contaCorrenteCliente.findFirst({
    where: {
      clienteId: lc.clienteContaId,
      data: lc.data,
      descricao,
      documento,
      valorCent: lc.valorCentavos,
      natureza,
    },
    select: { id: true, observacoes: true },
  });

  if (exact) {
    await tx.contaCorrenteCliente.update({
      where: { id: exact.id },
      data: { observacoes: appendMarkerToObservacoes(exact.observacoes, marker) },
    });
    return exact.id;
  }

  const created = await tx.contaCorrenteCliente.create({
    data: {
      clienteId: lc.clienteContaId,
      data: lc.data,
      descricao,
      documento,
      valorCent: lc.valorCentavos,
      natureza,
      observacoes: marker,
    },
    select: { id: true },
  });

  return created.id;
}

// ===============================
// CLIENTE / FORNECEDOR (C | F | A)
// ===============================
function normalizeName(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function mergeTipo(current, desired) {
  if (!current) return desired;
  if (current === "A" || desired === "A") return "A";
  if (current === desired) return current;
  return "A"; // C + F => A
}

function makePlaceholderCpfCnpj() {
  // 14 dígitos numéricos
  const base = String(Date.now()); // 13 dígitos
  const rand = String(crypto.randomBytes(1)[0] % 10);
  return (base + rand).slice(0, 14);
}

export async function getOrCreatePessoaByNomeETipo(nome, tipoDesejado /* "C" | "F" */) {
  const nomeClean = normalizeName(nome);
  if (!nomeClean) return null;

  // ⚠️ Se seu Prisma Client ainda não tem o campo "tipo", este findMany com select: { tipo }
  // pode dar erro. Por isso usamos try/catch e fazemos fallback sem tipo.
  let existing = null;
  try {
    existing = await prisma.cliente.findFirst({
      where: { nomeRazaoSocial: { equals: nomeClean, mode: "insensitive" } },
      select: { id: true, nomeRazaoSocial: true, tipo: true },
    });
  } catch {
    existing = await prisma.cliente.findFirst({
      where: { nomeRazaoSocial: { equals: nomeClean, mode: "insensitive" } },
      select: { id: true, nomeRazaoSocial: true },
    });
  }

  if (!existing) {
    // cria
    try {
      const created = await prisma.cliente.create({
        data: {
          nomeRazaoSocial: nomeClean,
          cpfCnpj: makePlaceholderCpfCnpj(), // estratégia B
          email: null,
          telefone: null,
          observacoes: "Criado automaticamente na importação do Livro Caixa (PDF).",
          tipo: tipoDesejado,
        },
        select: { id: true, nomeRazaoSocial: true, tipo: true },
      });
      return { pessoa: created, created: true, promoted: false };
    } catch {
      // fallback se "tipo" não existir no prisma client ainda
      const created = await prisma.cliente.create({
        data: {
          nomeRazaoSocial: nomeClean,
          cpfCnpj: makePlaceholderCpfCnpj(),
          email: null,
          telefone: null,
          observacoes: "Criado automaticamente na importação do Livro Caixa (PDF).",
        },
        select: { id: true, nomeRazaoSocial: true },
      });
      return { pessoa: created, created: true, promoted: false };
    }
  }

  // promove para A quando necessário (se tiver tipo)
  if (existing.tipo) {
    const novoTipo = mergeTipo(existing.tipo, tipoDesejado);
    if (novoTipo !== existing.tipo) {
      const updated = await prisma.cliente.update({
        where: { id: existing.id },
        data: { tipo: novoTipo },
        select: { id: true, nomeRazaoSocial: true, tipo: true },
      });
      return { pessoa: updated, created: false, promoted: true };
    }
  }

  return { pessoa: existing, created: false, promoted: false };
}

// ============================================================
// IMPORTAÇÃO PDF (LIVRO CAIXA) — PRÉVIA
// POST /api/livro-caixa/importacao/pdf/parse?ano=2026&mes=2
// form-data: file=<PDF>
// ============================================================
router.post(
  "/api/livro-caixa/importacao/pdf/parse",
  authenticate,
  upload.single("file"),
  async (req, res) => {
    try {
      const ano = Number(req.query.ano);
      const mes = Number(req.query.mes);
      if (!ano || !mes) {
        return res.status(400).json({ message: "ano e mes são obrigatórios." });
      }
      if (!req.file?.buffer) {
        return res.status(400).json({ message: "Envie o PDF no campo file." });
      }

      // Hash do arquivo para detectar reimportação
      const fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const fileNome = req.file.originalname || "importado.pdf";

      // Busca sessão existente (mesmo arquivo + mesma competência)
      let sessao = await prisma.importacaoPdfSessao.findFirst({
        where: { fileHash, competenciaAno: ano, competenciaMes: mes },
        include: { linhas: { select: { rowId: true, confirmedAt: true } } },
        orderBy: { criadaEm: "desc" },
      });

      const confirmedMap = new Map();
      if (sessao) {
        for (const l of sessao.linhas) {
          if (l.confirmedAt) confirmedMap.set(l.rowId, l.confirmedAt);
        }
      }

      const alerta = sessao
        ? { criadaEm: sessao.criadaEm, totalLinhas: sessao.totalLinhas, linhasConfirmadas: sessao.linhasConfirmadas }
        : null;

      const contas = await prisma.livroCaixaConta.findMany({
        select: { id: true, nome: true, tipo: true },
      });

      const rows = await extractPdfRowsByColumns(req.file.buffer);

      console.log("[IMPORT PDF] rows:", rows.length);
      console.log("[IMPORT PDF] sample:", rows.slice(0, 5));

      const items = [];
      let idx = 0;

      for (const r of rows) {
        idx += 1;

        const valorCentavos = brMoneyToCentavos(r.valorBR);

        // sugestão de conta pelo "local"
        const localNorm = normTxt(r.local);
        const contaSug = contas.find((c) => {
          const n = normTxt(c.nome);
          return n && (n.includes(localNorm) || localNorm.includes(n));
        });

        const rowId = `PDF_${ano}_${mes}_${idx}`;
        items.push({
          rowId,
          competenciaAno: ano,
          competenciaMes: mes,
          dataBR: r.dataBR,
          es: r.es,
          documento: r.documento,
          clienteFornecedor: r.clienteFornecedor,
          historico: r.historico,
          valorCentavos,
          valorBR: r.valorBR,
          localLabel: r.local,
          contaId: contaSug?.id || null,
          contaNome: contaSug?.nome || r.local || "",
          isentoTributacao: false,
          clienteId: null,
          jaConfirmada: confirmedMap.has(rowId),
          confirmedAt:  confirmedMap.get(rowId) ?? null,
        });
      }

      if (!sessao) {
        sessao = await prisma.importacaoPdfSessao.create({
          data: { fileHash, fileNome, competenciaAno: ano, competenciaMes: mes, totalLinhas: items.length },
        });
      } else if (sessao.totalLinhas !== items.length) {
        await prisma.importacaoPdfSessao.update({ where: { id: sessao.id }, data: { totalLinhas: items.length } });
      }

      return res.json({ items, total: items.length, sessaoId: sessao.id, alerta });
    } catch (e) {
      console.error("❌ Erro no parse PDF:", e);
      return res.status(500).json({ message: "Erro ao ler PDF." });
    }
  }
);


// ============================================================
// AUTO-CADASTRO (IMPORT PDF): regras para NÃO poluir "Clientes"
// - bloqueia padrão "Fornecedor (Pessoa)" e plataformas/marketplaces
// ============================================================
const __AUTO_CLIENTE_BLOCK_KEYWORDS__ = new Set([
  "material","materiais","utensílios","utensilios","serviço","serviços","servico","servicos",
  "tarifa","tarifas","taxa","taxas","rendimento","rendimentos","aplicação","aplicacao",
  "aplicações","aplicacoes","juros","iof","pix","ted","doc","boleto","pagamento","pagamentos",
  "transferência","transferencia","transferências","transferencias","compra","compras",
  "manutenção","manutencao","frete","energia","água","agua","internet","telefone",
  "aluguel","locação","locacao","combustível","combustivel","imposto","impostos",
  "débito","debito","crédito","credito","estorno","cancelamento","pagto",
  "receb","recebimento","transf","entre","contas",
  "saque","depósito","deposito","cobrança","cobranca","cartão","cartao","fatura",
  "liquidação","liquidacao",
  "honorários","honorarios","honorário","honorario",
  "simples","cópias","copias","copia","limpeza","sistema"
]);

const __AUTO_CLIENTE_BLOCK_PLATFORMS__ = new Set([
  "google","microsoft","apple","adobe","amazon","aws","prime",
  "meta","facebook","instagram","whatsapp",
  "tok&stok","tok stok","tokstok",
  "mercado livre","mercadolivre","shopee","shein",
  "paypal","stripe",
  "uber","99",
  "ifood","rappi",
  "spotify","netflix","youtube",
  "zoom","dropbox","slack","notion"
]);

function __normTxt__(s) {
  return String(s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function shouldAutoCreateClienteFromImportPdf(nome, historico = "") {
  const nRaw = String(nome || "").trim();
  if (!nRaw) return false;

  const n = __normTxt__(nRaw);
  const h = __normTxt__(historico);

  // 1) Qualquer coisa entre parênteses costuma ser usuário/sócio: "Google (Paulo ...)"
  if (/\([^)]*\)/.test(nRaw)) return false;

  // 2) Plataformas / marketplaces / big tech: nunca vira Cliente automático
  for (const p of __AUTO_CLIENTE_BLOCK_PLATFORMS__) {
    if (n.includes(p)) return false;
  }

  // 3) Keywords genéricas (serviços, tarifas etc.): não cria Cliente
  for (const k of __AUTO_CLIENTE_BLOCK_KEYWORDS__) {
    if (n.includes(k) || h.includes(k)) return false;
  }

  // 4) "Banco ..." e "Apl ..." são criados com tipo "A" no fluxo de Saída
  //    — no fluxo de Entrada (NFS-e), não devem gerar contrato AV
  if (/^banco\s+/.test(n)) return false;
  if (/^apl\s+/.test(n) || /^aplica/.test(n)) return false;

  return true;
}

// ============================================================
// IMPORTAÇÃO PDF — CONFIRMAR 1 LINHA
// POST /api/livro-caixa/importacao/pdf/confirmar-linha
// ============================================================
router.post("/api/livro-caixa/importacao/pdf/confirmar-linha", authenticate, async (req, res) => {
  try {
    const r = req.body || {};

    const sessaoId = r.sessaoId ? Number(r.sessaoId) : null;
    const rowId    = String(r.rowId || "");

    // Idempotência: se linha já foi confirmada, retorna ok sem duplicar
    if (sessaoId && rowId) {
      const existe = await prisma.importacaoPdfLinha.findUnique({
        where: { sessaoId_rowId: { sessaoId, rowId } },
      });
      if (existe?.confirmedAt) {
        return res.json({ ok: true, jaConfirmada: true, rowId });
      }
    }

    const competenciaAno = Number(r.competenciaAno);
    const competenciaMes = Number(r.competenciaMes);
    const dataBR = String(r.dataBR || "");
    const es = String(r.es || "").toUpperCase();
    const valorCentavos = Number(r.valorCentavos || 0);

    const documento = r.documento ? String(r.documento) : null;
    const clienteFornecedor = String(r.clienteFornecedor || "").trim();
    const historico = String(r.historico || "").trim();
    const localLabel = String(r.localLabel || "").trim();

    const isentoTributacao = !!r.isentoTributacao;
    let clienteId = r.clienteId ? Number(r.clienteId) : null;
    const contaIdRaw = r.contaId ? Number(r.contaId) : null;
    const contaNome = String(r.contaNome || localLabel || "").trim();
    let clienteCriado = null;

    if (!competenciaAno || !competenciaMes) throw new Error("competenciaAno/competenciaMes obrigatórios");
    if (!dataBR) throw new Error("dataBR obrigatória");
    if (es !== "E" && es !== "S") throw new Error("es inválido (E/S)");
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error("valorCentavos inválido");

    const dataISO = brToISODate(dataBR);
    const dataObj = new Date(`${dataISO}T12:00:00.000Z`);
    if (Number.isNaN(dataObj.getTime())) throw new Error("dataBR inválida");

    // ------------------------------------------------------------
    // C) CONTAS CONTÁBEIS: garante conta (se não existir cria OUTROS)
    // ------------------------------------------------------------
    let contaId = contaIdRaw;
    if (!contaId) {
      const contaImportada = await getOrCreateContaContabilImportada(contaNome);
      contaId = contaImportada.id;
    }

    // ------------------------------------------------------------
    // B) SAÍDA: grava direto no Livro Caixa
    // ------------------------------------------------------------
    if (es === "S") {
      
      // Garante cadastro como FORNECEDOR (F) em SAÍDA
      if (clienteFornecedor) {
        const cfNorm = String(clienteFornecedor).replace(/\s+/g, " ").trim();
        const histNorm = String(historico || "").toLowerCase();

        const isBanco = /^banco\s+/i.test(cfNorm);
        const isContaAplicacao = /^apl\s+/i.test(cfNorm) || /^aplica/i.test(cfNorm);

        const isTransfEntreContas =
          histNorm.includes("transferência entre contas") ||
          histNorm.includes("transferencia entre contas");

        if (isTransfEntreContas) {
          // b.1: transferência interna — não cadastra nada
        } else if (isBanco || isContaAplicacao) {
          // b.2: Banco e Aplicação entram como "A" (Ambos) — cobram taxas E pagam rendimentos
          await getOrCreatePessoaByNomeETipo(cfNorm, "A");
        } else {
          // caso normal: fornecedor
          await getOrCreatePessoaByNomeETipo(cfNorm, "F");
        }
      }

      const lanc = await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno,
          competenciaMes,
          data: dataObj,
          documento: documento || null,
          es: "S",
          clienteFornecedor: clienteFornecedor || null,
          historico: historico || "",
          valorCentavos,
          contaId,
          ordemDia: 0,
          origem: "IMPORT_PDF",
          status: "OK",
          statusFluxo: "EFETIVADO",
          localLabelFallback: localLabel || null,
          referenciaOrigem: String(r.rowId || ""),
        },
      });

      if (sessaoId && rowId) {
        await prisma.$transaction([
          prisma.importacaoPdfLinha.upsert({
            where:  { sessaoId_rowId: { sessaoId, rowId } },
            create: { sessaoId, rowId, confirmedAt: new Date() },
            update: { confirmedAt: new Date() },
          }),
          prisma.importacaoPdfSessao.update({
            where: { id: sessaoId },
            data:  { linhasConfirmadas: { increment: 1 } },
          }),
        ]);
      }

      return res.json({ ok: true, tipo: "SAIDA", livroCaixaLancamentoId: lanc.id });
    }

    // ------------------------------------------------------------
    // A) ENTRADA
    // Regras:
    // A.1 Se contém NFS-e => contrato AV e Livro Caixa (E)
    // A.2 Se NÃO contém NFS-e => pergunta não tributado (isentoTributacao)
    //   - se sim: repete fluxo de A.1 (mas com isentoTributacao=true)
    //   - se não: grava só Livro Caixa (E)
    // ------------------------------------------------------------

    const contemNFSe = /NFS-e/i.test(String(documento || "")) || /NFS-e/i.test(historico);

    // Se vai gerar contrato AV:
    const viraAvulso = contemNFSe || isentoTributacao === true;

    if (!viraAvulso) {
      // A.2.a.2: só livro caixa (entrada comum)
      const lanc = await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno,
          competenciaMes,
          data: dataObj,
          documento: documento || null,
          es: "E",
          clienteFornecedor: clienteFornecedor || null,
          historico: historico || "",
          valorCentavos,
          contaId,
          ordemDia: 0,
          origem: "IMPORT_PDF",
          status: "OK",
          statusFluxo: "EFETIVADO",
          localLabelFallback: localLabel || null,
          referenciaOrigem: String(r.rowId || ""),
        },
      });

      if (sessaoId && rowId) {
        await prisma.$transaction([
          prisma.importacaoPdfLinha.upsert({
            where:  { sessaoId_rowId: { sessaoId, rowId } },
            create: { sessaoId, rowId, confirmedAt: new Date() },
            update: { confirmedAt: new Date() },
          }),
          prisma.importacaoPdfSessao.update({
            where: { id: sessaoId },
            data:  { linhasConfirmadas: { increment: 1 } },
          }),
        ]);
      }

      return res.json({ ok: true, tipo: "ENTRADA_LIVRO_CAIXA", livroCaixaLancamentoId: lanc.id });
    }


    // Aqui: A.1 ou A.2.a.1 => contrato AV
    // Se não veio clienteId manual, cria/encontra pelo nome importado do PDF.
    if (!clienteId && clienteFornecedor) {
      const resolved = await getOrCreatePessoaByNomeETipo(clienteFornecedor, "C");
      if (resolved?.pessoa?.id) clienteId = resolved.pessoa.id;
      if (resolved?.created || resolved?.promoted) clienteCriado = resolved.pessoa;
    }

    if (!clienteId) {
      return res.status(400).json({ message: "Informe o cliente ou o nome do cliente/fornecedor." });
}

    const valorRecebidoMasked = (valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    // cria contrato AV- + parcela recebida
    const numeroContrato = await gerarNumeroContratoComPrefixo(dataObj, "AV-");

    const created = await prisma.contratoPagamento.create({
      data: {
        clienteId,
        observacoes: historico || "Recebimento avulso (importado)",
        formaPagamento: "AVISTA",
        valorTotal: convertValueToDecimal(valorRecebidoMasked),
        numeroContrato,

        isentoTributacao: !!isentoTributacao,

        parcelas: {
          create: {
            numero: 1,
            vencimento: dataObj,
            status: "RECEBIDA",
            valorPrevisto: convertValueToDecimal(valorRecebidoMasked),
            valorRecebido: convertValueToDecimal(valorRecebidoMasked),
            dataRecebimento: dataObj,
            meioRecebimento: "PIX",
          },
        },
      },
      include: { parcelas: true },
    });

    const parcela = created.parcelas?.[0];

    // grava Livro Caixa (E) com origem PAGAMENTO_RECEBIDO (compatível com tua rotina)
    const docLC = documento || (isentoTributacao ? null : "NFS-e");

    const lc = await prisma.livroCaixaLancamento.create({
      data: {
        competenciaAno,
        competenciaMes,
        data: dataObj,
        documento: docLC,
        es: "E",
        clienteFornecedor: clienteFornecedor || null,
        historico: `Pagamento referente contrato ${created.numeroContrato}`,
        valorCentavos,
        contaId,
        ordemDia: 0,
        origem: "PAGAMENTO_RECEBIDO",
        status: "OK",
        statusFluxo: "EFETIVADO",
        localLabelFallback: localLabel || null,
        referenciaOrigem: parcela ? `PARCELA_${parcela.id}` : String(r.rowId || ""),
      },
    });

    if (sessaoId && rowId) {
      await prisma.$transaction([
        prisma.importacaoPdfLinha.upsert({
          where:  { sessaoId_rowId: { sessaoId, rowId } },
          create: { sessaoId, rowId, confirmedAt: new Date() },
          update: { confirmedAt: new Date() },
        }),
        prisma.importacaoPdfSessao.update({
          where: { id: sessaoId },
          data:  { linhasConfirmadas: { increment: 1 } },
        }),
      ]);
    }

    return res.json({
      ok: true,
      pagamentoAvulso: created,
      contrato: created,
      parcela,

      // ✅ IMPORTANTES pro front vincular SEM depender do shape aninhado
      contratoId: created?.id || null,
      parcelaId: parcela?.id || null,

      valorRecebidoCentavos: valorCentavos,

      message: "Contrato AV registrado com sucesso!",
    });
} catch (e) {
    console.error("❌ Erro confirmar linha importação:", e);
    return res.status(500).json({ message: e.message || "Erro ao confirmar linha." });
  }
});

// ============================================================
// LIVRO CAIXA CONTAS — REPLICAR TIPO PARA NOMES IGUAIS
// POST /api/livro-caixa/contas/:id/replicar-tipo
// body: { tipo: "BANCO" | "APLICACAO" | "CAIXA" | "CLIENTES" | "OUTROS" }
// ============================================================
router.post("/api/livro-caixa/contas/:id/replicar-tipo", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tipo = String(req.body?.tipo || "").trim().toUpperCase();

    const tiposValidos = ["BANCO", "APLICACAO", "CAIXA", "CLIENTES", "CARTAO_CREDITO", "CARTAO_DEBITO", "OUTROS"];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ message: "Tipo inválido." });
    }

    const base = await prisma.livroCaixaConta.findUnique({ where: { id } });
    if (!base) return res.status(404).json({ message: "Conta não encontrada." });

    const nomeRef = base.nome;

    const result = await prisma.livroCaixaConta.updateMany({
      where: { nome: nomeRef },
      data: { tipo },
    });

    return res.json({ ok: true, nome: nomeRef, updated: result.count });
  } catch (e) {
    console.error("❌ Erro replicar tipo:", e);
    return res.status(500).json({ message: "Erro ao replicar tipo." });
  }
});

// ============================================================
// IMPORTAÇÃO PDF -> ITENS (LIVRO CAIXA)
// ============================================================
// aqui entram:
// - extrair texto do PDF (pdf-parse)
// - transformar em linhas
// - mapear para { dataBR, es, valorCentavos, historico, contaNome, documento, ... }
// - identificar:
//    * contém "NFS-e" ?
//    * entrada/saída
//    * sugestão/criação de conta contábil "OUTROS" quando não existir
// - payload de preview para o frontend

// ----------------------------
// LANÇAMENTOS — LISTAR
// ----------------------------
// ----------------------------
// ----------------------------
// ✅ CORRIGIDO: GET /api/livro-caixa/lancamentos
// ----------------------------
router.get("/api/livro-caixa/lancamentos", authenticate, async (req, res) => {
  try {
    const { ano, mes } = parseAnoMesFromQuery(req);

    // ✅ Calcular saldo anterior dinamicamente
    const saldoAnteriorBase = await calcularSaldoAnterior(ano, mes);

    // ✅ Saldos iniciais de contas abertas NO próprio período (mês/ano atual)
    const primeiroDiaMes = new Date(Date.UTC(ano, mes - 1, 1));
    const primeiroDiaMesSeguinte = new Date(Date.UTC(ano, mes, 1));
    const contasDoMes = await prisma.livroCaixaConta.findMany({
      where: {
        saldoInicialCent: { not: 0 },
        dataInicial: { not: null, gte: primeiroDiaMes, lt: primeiroDiaMesSeguinte },
      },
      select: { saldoInicialCent: true, nome: true },
    });
    const saldoInicialMesAtual = contasDoMes.reduce((sum, c) => sum + c.saldoInicialCent, 0);
    const saldoAnteriorCentavos = saldoAnteriorBase + saldoInicialMesAtual;

    const mesAnt = mes === 1 ? 12 : mes - 1;
    const anoAnt = mes === 1 ? ano - 1 : ano;

    const lancamentos = await prisma.livroCaixaLancamento.findMany({
      where: { competenciaAno: ano, competenciaMes: mes, statusFluxo: { not: "LIQUIDADO" } },
      include: { conta: true },
      orderBy: [{ data: "asc" }, { ordemDia: "asc" }, { id: "asc" }],
    });

    res.json({
      lancamentos,
      saldoAnteriorCentavos,
      saldoAnteriorAno: anoAnt,
      saldoAnteriorMes: mesAnt,
    });
  } catch (e) {
    console.error("❌ Erro ao buscar lançamentos:", e);
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// BOLETO — PARSE PDF
// ----------------------------
router.post("/api/livro-caixa/boleto/parse-pdf", authenticate, upload.single("boleto"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado." });

    const isImagem = req.file.mimetype.startsWith("image/");
    let textoCompleto = "";

    if (isImagem) {
      textoCompleto = await _extrairTextoImagem(req.file.buffer).catch(e => {
        console.log(`🖼️ OCR erro no upload: ${e.message}`);
        return "";
      });
    } else {
      const data = new Uint8Array(req.file.buffer);
      const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
      const pdf = await loadingTask.promise;
      for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(" ");
        textoCompleto += pageText + "\n";
      }
    }

    // ── Linha digitável ──────────────────────────────────────────────────────
    let linha = null;
    let fonteLinh = "nao_encontrado";

    // Padrão banco: NNNNN.NNNNN NNNNN.NNNNNN NNNNN.NNNNNN N NNNNNNNNNNNNNN
    const reBanco = /\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14}/;
    const mBanco = textoCompleto.match(reBanco);
    if (mBanco) { linha = mBanco[0].replace(/\D/g, ""); fonteLinh = "linha_digitavel_banco"; }

    if (!linha) {
      // Padrão concessionária: NNNNNNNNNN-N ...
      const reCon = /\d{10,12}[-\s]\d{1}\s+\d{10,12}[-\s]\d{1}\s+\d{10,12}[-\s]\d{1}\s+\d{10,12}[-\s]\d{1}/;
      const mCon = textoCompleto.match(reCon);
      if (mCon) { linha = mCon[0].replace(/\D/g, ""); fonteLinh = "linha_digitavel_concessionaria"; }
    }

    if (!linha) {
      const reSeq = /\d{44,48}/g;
      const seqs = textoCompleto.match(reSeq) || [];
      if (seqs.length > 0) { linha = seqs[0]; fonteLinh = "sequencia_digitos"; }
    }

    // ── Vencimento do texto (DD-MM-YYYY ou DD/MM/YYYY) ───────────────────────
    // Sempre extraímos do texto — o fator do código de barras pode não decodificar corretamente
    const reVenc = /[Vv]encimento[:\s]+(\d{2}[-\/]\d{2}[-\/]\d{4})/;
    const mVenc = textoCompleto.match(reVenc);
    let vencimento = null;
    if (mVenc) {
      const parts = mVenc[1].split(/[-\/]/);
      vencimento = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    // Fallback: "Pagável [em qualquer banco | Preferencialmente no X].  DD/MM/YYYY"
    // Cobre boletos Sicoob, Itaú e outros onde a data fica na célula ao lado de "Vencimento"
    if (!vencimento) {
      const reVencPag = /Pag[aá]vel[^.]*\.\s{0,80}(\d{2}\/\d{2}\/\d{4})/i;
      const mVencP = textoCompleto.match(reVencPag);
      if (mVencP) {
        const [dd, mm, yyyy] = mVencP[1].split("/");
        vencimento = `${yyyy}-${mm}-${dd}`;
      }
    }

    // ── Valor do texto ───────────────────────────────────────────────────────
    let valorCentavos = 0;
    const reValorLabel = /(?:VALOR|[Vv]alor\s+(?:do\s+)?(?:documento|boleto)?)\s*[:\s]\s*R?\$?\s*([\d.]+,\d{2})/;
    const mValorLabel = textoCompleto.match(reValorLabel);
    if (mValorLabel) {
      const vStr = mValorLabel[1].replace(/\./g, "").replace(",", ".");
      valorCentavos = Math.round(parseFloat(vStr) * 100);
    }
    if (!valorCentavos) {
      const reValor = /R\$\s*([\d.]+,\d{2})/;
      const mValor = textoCompleto.match(reValor);
      if (mValor) {
        const vStr = mValor[1].replace(/\./g, "").replace(",", ".");
        valorCentavos = Math.round(parseFloat(vStr) * 100);
      }
    }

    // ── Pagador ──────────────────────────────────────────────────────────────
    let pagador = null;
    let cpfCnpjPagador = null;
    // Nomes de instituições financeiras não devem ser tratados como pagador
    const reInstituicao = /\b(PAGAMENTOS|BANCO|BANK|INSTITUI[ÇC]|S\/A|S\.A\.|LTDA|FINANCEIRA|FINTECH)\b/i;
    const rePagCpf = /PAGADOR[:\s]+([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s]+?)\s*[:\s\/]\s*(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/;
    const mPag = textoCompleto.match(rePagCpf);
    if (mPag && !reInstituicao.test(mPag[1])) {
      pagador = mPag[1].trim();
      cpfCnpjPagador = mPag[2].trim();
    } else {
      const rePagNome = /PAGADOR[:\s]+([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s]{5,60})/;
      const mPagNome = textoCompleto.match(rePagNome);
      if (mPagNome && !reInstituicao.test(mPagNome[1])) pagador = mPagNome[1].trim();
    }
    // Fallback: se ainda não temos pagador, procura "NOME\nCPF xxx.xxx.xxx-xx" em qualquer lugar do texto
    if (!pagador) {
      const reCpfSolto = /([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç\s]{4,50}?)\s*\n?\s*(?:CPF\s*[:\s]*)?\s*(\d{3}\.\d{3}\.\d{3}-\d{2})/;
      const mCpf = textoCompleto.match(reCpfSolto);
      if (mCpf && !reInstituicao.test(mCpf[1])) {
        pagador = mCpf[1].trim();
        cpfCnpjPagador = mCpf[2].trim();
      }
    }

    const CNPJ_FIRMA = "48744127000141";

    // ── Beneficiário / Cedente ───────────────────────────────────────────────
    let beneficiario = null;
    let cnpjBeneficiario = null;
    // 1. Padrão com label explícito "Beneficiário" ou "Cedente" + nome + CNPJ
    // Qualificador opcional de 1 palavra (ex: "Beneficiário final:"); nome limitado a 80 chars
    const reBenefLabel = /(?:Benefici[aá]rio|Cedente)(?:\s+\w{1,20})?[:\s]+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç\s\-\.\/&]{1,80}?)\s*(?:\([^)]*\))?\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i;
    const mBenefLabel = textoCompleto.match(reBenefLabel);
    if (mBenefLabel) {
      // Remove trailing parens/spaces/dashes (ex: "SAJ ADV SISTEMAS S/A (" ou "CRED - ")
      beneficiario = mBenefLabel[1].replace(/\s*\([^)]*$/, "").replace(/[\s\-]+$/, "").trim();
      cnpjBeneficiario = mBenefLabel[2].trim();
    }
    // 2. Fallback: "NOME - CNPJ" mas somente se não aparece antes de "PAGADOR"
    if (!beneficiario) {
      const reBenef = /([A-Za-zÀ-ú0-9\s\-\.\/&]{3,80})\s*[-–]\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/;
      const mBenef = textoCompleto.match(reBenef);
      if (mBenef) {
        const idxMatch = textoCompleto.search(reBenef);
        const ctxAntes = textoCompleto.slice(Math.max(0, idxMatch - 300), idxMatch).toUpperCase();
        // Só usa se o contexto sugere seção de beneficiário, não de pagador
        if (!ctxAntes.match(/PAGADOR|SACADO/)) {
          beneficiario = mBenef[1].trim();
          cnpjBeneficiario = mBenef[2].trim();
        }
      }
    }
    // 3. Fallback inline: "EMPRESA S/A - CNPJ" sem label (ex: Itaú/ClickSign)
    // Usa matchAll para pular matches do próprio CNPJ da firma (pagador)
    if (!beneficiario) {
      const reBenefInline = /([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇa-záàâãéêíóôõúüç\s\.\/&]{4,69})\s*[-–]\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g;
      for (const msInline of textoCompleto.matchAll(reBenefInline)) {
        if (msInline[2].replace(/\D/g, "") !== CNPJ_FIRMA) {
          beneficiario = msInline[1].replace(/[\s\-]+$/, "").trim();
          cnpjBeneficiario = msInline[2];
          break;
        }
      }
    }

    // ── Nº Documento ────────────────────────────────────────────────────────
    let numeroDocumento = null;
    const reNDoc = /[Nn][\u00BA\u00B0°o]\s*(?:[Dd]o\s+)?[Dd]ocumento\s*[:\s]*(\d+)/;
    const mNDoc = textoCompleto.match(reNDoc);
    if (mNDoc) numeroDocumento = mNDoc[1].trim();

    // ── Intermediário / Banco ────────────────────────────────────────────────
    // Texto do PDF tem PRIORIDADE sobre o código — permite que CelCoin/VrdeBank
    // (código 341=Itaú) seja identificado corretamente pelo nome no texto.
    let intermediario = null;
    // 1. "INTERMEDIADO POR" no texto (ex: "INTERMEDIADO POR CELCOIN...")
    const reInter = /INTERMEDIADO\s+POR\s*[:\s]+(.+?)\s+\d{2}\.\d{3}\.\d{3}/;
    const mInter = textoCompleto.match(reInter);
    if (mInter) intermediario = mInter[1].trim();
    // 2. "Cedente" no texto
    if (!intermediario) {
      const reCed = /[Cc]edente\s+([A-Z][A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s\-\.]+(?:SA|S\.A\.?|PAGAMENTO))/;
      const mCed = textoCompleto.match(reCed);
      if (mCed) intermediario = mCed[1].trim();
    }
    // 3. Nome de banco/fintech explícito no texto
    if (!intermediario) {
      const mBancoNome = textoCompleto.match(/\b(CELCOIN|VRDE\s*BANK|VRDEBANK|SICOOB|SICREDI|BRADESCO|ITAU[Ú]?|SANTANDER|CAIXA\s+ECON[ÔO]MICA|BANCO\s+DO\s+BRASIL|NUBANK|NU\s+PAGAMENTOS|BANCO\s+INTER|INTER|C6\s+BANK|BTG)\b/i);
      if (mBancoNome) intermediario = mBancoNome[1].trim().toUpperCase();
    }
    // 4. Fallback: código dos 3 primeiros dígitos da linha digitável
    if (!intermediario && linha && linha.length >= 3) {
      const BANCO_CODIGOS = { "001":"BANCO DO BRASIL","033":"SANTANDER","077":"INTER","104":"CAIXA ECONOMICA","237":"BRADESCO","341":"ITAÚ","422":"SAFRA","748":"SICREDI","756":"SICOOB","260":"NU PAGAMENTOS","336":"C6 BANK","323":"MERCADO PAGO","735":"NEON","290":"PAGSEGURO","403":"CORA","461":"ASAAS","197":"STONE","208":"BTG PACTUAL","218":"BS2","655":"VOTORANTIM","707":"DAYCOVAL" };
      const codBanco = linha.slice(0, 3);
      if (BANCO_CODIGOS[codBanco]) intermediario = BANCO_CODIGOS[codBanco];
    }

    // ── E/S sugerido ──────────────────────────────────────────────────────────
    let esSugerido = null;

    // Para imagens: PIX/TED define E/S pelo título ("Pix enviado" = S, "recebido" = E)
    if (isImagem && !linha) {
      const mTipoPix = textoCompleto.match(/Pix\s+(enviado|recebido)|TED\s+(enviada?|recebida?|realizada?)/i);
      if (mTipoPix) {
        const tituloLow = mTipoPix[0].toLowerCase();
        esSugerido = /enviado|enviada|realizada/.test(tituloLow) ? "S" : "E";
        const mV = textoCompleto.match(/R\$\s*([\d.]+,\d{2})/);
        if (mV) valorCentavos = Math.round(parseFloat(mV[1].replace(/\./g,"").replace(",",".")) * 100);
        const mData = textoCompleto.match(/[Qq]uando\s*[\s\n]\s*(\d{2}\/\d{2}\/\d{4})/)
                   || textoCompleto.match(/[Dd]ata\s+da\s+transa[çc][ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/);
        if (mData) { const [dd,mm,yyyy] = mData[1].split("/"); vencimento = `${yyyy}-${mm}-${dd}`; }
        const mPara = textoCompleto.match(/Para\s*[\r\n]+\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\n\r]{2,60})/m)
                   || textoCompleto.match(/Quem\s+recebeu\s+Nome\s*:\s*(.+?)\s+CPF/i);
        if (mPara) beneficiario = mPara[1].trim();
        const mDesc = textoCompleto.match(/[Dd]escri[çc][ãa]o\s*[\r\n]+\s*(.+?)(?:[\r\n]|$)/m)
                   || textoCompleto.match(/[Dd]escri[çc][ãa]o\s*:\s*(.+?)(?:[\r\n]|$)/);
        if (mDesc) numeroDocumento = mDesc[1].trim();
        const mId = textoCompleto.match(/ID\s+da\s+transa[çc][ãa]o\s*:?\s*([A-Za-z0-9]+)/);
        if (mId) intermediario = `Transação PIX: ${mId[1]}`;
        cnpjBeneficiario = null;
        fonteLinh = "pix_comprovante";
      }
    }

    // Para boletos: E/S pelo CNPJ do beneficiário (só se PIX não definiu)
    if (!esSugerido && cnpjBeneficiario) {
      esSugerido = cnpjBeneficiario.replace(/\D/g, "") === CNPJ_FIRMA ? "E" : "S";
    }

    // ── Lookup / criação automática de cliente ou fornecedor ─────────────────
    // Entrada → busca o pagador (quem nos paga) como Cliente
    // Saída   → busca o beneficiário (quem recebemos pagar) como Fornecedor
    let clienteId = null;
    let clienteNome = null;
    let clienteStatus = null; // "encontrado" | "criado" | "nao_identificado"

    const parteNome    = esSugerido === "E" ? pagador      : (esSugerido === "S" ? beneficiario    : pagador);
    const parteCpfCnpj = esSugerido === "E" ? cpfCnpjPagador : (esSugerido === "S" ? cnpjBeneficiario : cpfCnpjPagador);
    const parteTipo    = esSugerido === "S" ? "F" : "C";

    if (parteNome) {
      const cpfDigitos = parteCpfCnpj ? parteCpfCnpj.replace(/\D/g, "") : null;

      let clienteEncontrado = null;

      // 1. Busca por CPF/CNPJ (mais confiável)
      if (cpfDigitos) {
        clienteEncontrado = await prisma.cliente.findUnique({ where: { cpfCnpj: cpfDigitos } });
      }

      // 2. Busca por nome (case-insensitive) se não achou por CPF
      if (!clienteEncontrado) {
        const porNome = await prisma.cliente.findMany({
          where: { nomeRazaoSocial: { contains: parteNome, mode: "insensitive" } },
        });
        if (porNome.length === 1) {
          clienteEncontrado = porNome[0];
        } else if (porNome.length > 1) {
          // Preferir match exato (ignorando caixa); senão pega o primeiro
          clienteEncontrado =
            porNome.find(c => c.nomeRazaoSocial.toLowerCase() === parteNome.toLowerCase()) ||
            porNome[0];
        }
      }

      if (clienteEncontrado) {
        clienteId   = clienteEncontrado.id;
        clienteNome = clienteEncontrado.nomeRazaoSocial;
        clienteStatus = "encontrado";
        // Corrige CPF/CNPJ se estava errado/vazio
        if (cpfDigitos && clienteEncontrado.cpfCnpj !== cpfDigitos) {
          const conflito = await prisma.cliente.findUnique({ where: { cpfCnpj: cpfDigitos } });
          if (!conflito) {
            await prisma.cliente.update({
              where: { id: clienteEncontrado.id },
              data: { cpfCnpj: cpfDigitos },
            });
          }
        }
      } else if (parteNome && cpfDigitos) {
        // Dados mínimos presentes → cria automaticamente
        const conflito = await prisma.cliente.findUnique({ where: { cpfCnpj: cpfDigitos } });
        if (conflito) {
          clienteId   = conflito.id;
          clienteNome = conflito.nomeRazaoSocial;
          clienteStatus = "encontrado";
        } else {
          const novo = await prisma.cliente.create({
            data: {
              nomeRazaoSocial: parteNome,
              cpfCnpj: cpfDigitos,
              tipo: parteTipo,
              observacoes: `Criado automaticamente via leitura de boleto PDF em ${new Date().toLocaleDateString("pt-BR")}.`,
            },
          });
          clienteId   = novo.id;
          clienteNome = novo.nomeRazaoSocial;
          clienteStatus = "criado";
        }
      } else {
        clienteStatus = "nao_identificado";
      }
    }

    // ── Detecção especial: DARF (Documento de Arrecadação de Receitas Federais) ──
    let historicoDarf = null;
    const isDARF = /Documento\s+de\s+Arrecada[çc][ãa]o\s+de\s+Receitas\s+Federais/i.test(textoCompleto);
    if (isDARF) {
      esSugerido = "S";
      beneficiario = "Receita Federal";

      // Valor: "Valor Total do Documento 178,31"
      if (!valorCentavos) {
        const mVDARF = textoCompleto.match(/Valor\s+Total\s+do\s+Documento\s+([\d.]+,\d{2})/i);
        if (mVDARF) valorCentavos = Math.round(parseFloat(mVDARF[1].replace(/\./g, "").replace(",", ".")) * 100);
      }
      // Valor na linha "Valor: 178,31" (canhoto)
      if (!valorCentavos) {
        const mVCan = textoCompleto.match(/\bValor\s*:\s*([\d.]+,\d{2})/i);
        if (mVCan) valorCentavos = Math.round(parseFloat(mVCan[1].replace(/\./g, "").replace(",", ".")) * 100);
      }

      // Número do documento
      const mNumDARF = textoCompleto.match(/N[uú]mero\s+do\s+Documento\s+([\d.\/\-]+)/i);
      if (mNumDARF) numeroDocumento = mNumDARF[1].trim();

      // Código DARF e denominação
      const DARF_CODIGOS = {
        "0190": "IRPF", "0246": "IRPF", "6015": "IRPF",
        "1708": "IRRF", "0561": "PIS",  "5993": "COFINS",
        "2089": "CSLL", "6559": "IRPJ",
        "1099": "INSS", "2640": "INSS", "0574": "INSS",
      };
      const MESES_ABREV = {
        "janeiro":"Jan","fevereiro":"Fev","março":"Mar","abril":"Abr",
        "maio":"Mai","junho":"Jun","julho":"Jul","agosto":"Ago",
        "setembro":"Set","outubro":"Out","novembro":"Nov","dezembro":"Dez",
      };
      const mCod = textoCompleto.match(/\b(\d{4})\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]/);
      const codigoDARF = mCod ? mCod[1] : null;
      const tipoLabel = codigoDARF ? (DARF_CODIGOS[codigoDARF] || `Cód. ${codigoDARF}`) : "DARF";

      // Período de apuração → abreviação do mês
      const mPer = textoCompleto.match(/Per[ií]odo\s+de\s+Apura[çc][ãa]o\s+([A-Za-zÀ-ú]+)\/(\d{4})/i);
      let periodoLabel = null;
      if (mPer) {
        const mesAbrev = MESES_ABREV[mPer[1].toLowerCase()] || mPer[1].slice(0, 3);
        periodoLabel = `${mesAbrev}/${mPer[2]}`;
      } else if (vencimento) {
        const [yyyy, mm] = vencimento.split("-");
        periodoLabel = `${mm}/${yyyy}`;
      }

      historicoDarf = `DARF ${tipoLabel}${periodoLabel ? ` — ${periodoLabel}` : ""}${codigoDARF ? ` — Cód. ${codigoDARF}` : ""}`;
      fonteLinh = "darf";
    }

    // ── Detecção especial: NF-e Energia Elétrica (DANFE3E) ──────────────────
    const isNFeEnergia = !isDARF && /DANF3E|DOCUMENTO\s+AUXILIAR\s+DA\s+NOTA\s+FISCAL\s+DE\s+ENERGIA\s+EL[ÉE]TRICA/i.test(textoCompleto);
    if (isNFeEnergia) {
      esSugerido = "S";

      // Conta Mês ou Referência → competência
      const mContaMes = textoCompleto.match(/Conta\s+M[êe]s\s+(\d{2}\/\d{4})/i)
                     || textoCompleto.match(/REFER[ÊE]NCIA\s+(\d{2}\/\d{4})/i);
      const contaMes = mContaMes ? mContaMes[1] : null;

      // Nota Fiscal número
      if (!numeroDocumento) {
        const mNF = textoCompleto.match(/NOTA\s+FISCAL\s+N[º°o\.]*\s*(\d+)/i);
        if (mNF) numeroDocumento = mNF[1];
      }

      // Beneficiário: nome da distribuidora (logo após cabeçalho DANFE3E)
      if (!beneficiario) {
        const mDistrib = textoCompleto.match(/ENERGIA\s+EL[ÉE]TRICA\s+ELETR[ÔO]NICA\s+([A-Za-zÀ-ú][A-Za-zÀ-ú\s\.\-]+?)(?:\s+CNPJ|\s+\d{2}\.\d{3})/i);
        if (mDistrib) beneficiario = mDistrib[1].trim();
      }

      historicoDarf = `Energia Elétrica${contaMes ? ` — ${contaMes}` : ""}`;
      fonteLinh = "nfe_energia";
    }

    // ── Detecção especial: DAS — Simples Nacional ────────────────────────────
    const isDAS = !isDARF && !isNFeEnergia && /Documento\s+de\s+Arrecada[çc][ãa]o\s+do\s+Simples\s+Nacional/i.test(textoCompleto);
    if (isDAS) {
      esSugerido = "S";
      beneficiario = "Receita Federal";
      cnpjBeneficiario = null;

      // Valor: "Valor Total do Documento 1.655,38"
      if (!valorCentavos) {
        const mVDAS = textoCompleto.match(/Valor\s+Total\s+do\s+Documento\s+([\d.]+,\d{2})/i);
        if (mVDAS) valorCentavos = Math.round(parseFloat(mVDAS[1].replace(/\./g, "").replace(",", ".")) * 100);
      }
      // Vencimento: "Pagar este documento até DD/MM/YYYY" ou "Data de Vencimento ... DD/MM/YYYY"
      if (!vencimento) {
        const mVencDAS = textoCompleto.match(/Pagar\s+(?:este\s+documento\s+)?at[eé]\s+(\d{2}\/\d{2}\/\d{4})/i)
                      || textoCompleto.match(/Data\s+de\s+Vencimento[\s\S]{0,100}?(\d{2}\/\d{2}\/\d{4})/i);
        if (mVencDAS) { const [dd, mm, yyyy] = mVencDAS[1].split("/"); vencimento = `${yyyy}-${mm}-${dd}`; }
      }
      // Período de apuração → ex: "Janeiro/2026" (pode aparecer ~150 chars após o label)
      const mPerDAS = textoCompleto.match(/Per[ií]odo\s+de\s+Apura[çc][ãa]o[\s\S]{0,250}?([A-Za-zÀ-ú]+)\/(\d{4})/i);
      let periodoLabelDAS = null;
      if (mPerDAS) {
        const MESES = { "janeiro":"Jan","fevereiro":"Fev","março":"Mar","abril":"Abr","maio":"Mai","junho":"Jun","julho":"Jul","agosto":"Ago","setembro":"Set","outubro":"Out","novembro":"Nov","dezembro":"Dez" };
        const mesAbrev = MESES[mPerDAS[1].toLowerCase()] || mPerDAS[1].slice(0, 3);
        periodoLabelDAS = `${mesAbrev}/${mPerDAS[2]}`;
      }
      // Número do documento DAS (ex: "07.20.26047.3798967-8")
      if (!numeroDocumento) {
        const mNumDAS = textoCompleto.match(/N[uú]mero\s+do\s+Documento\s+([\d.\/\-]+)/i)
                     || textoCompleto.match(/N[uú]mero[:\s]+([\d\.]+\.[\d\-]+)/);
        if (mNumDAS) numeroDocumento = mNumDAS[1].trim();
      }
      historicoDarf = `Simples Nacional${periodoLabelDAS ? ` — ${periodoLabelDAS}` : ""}`;
      fonteLinh = "das";
    }

    // ── Detecção especial: DAM — Documento de Arrecadação Municipal ──────────
    const isDAM = !isDARF && !isNFeEnergia && !isDAS &&
      /DOCUMENTO\s+DE\s+ARRECADA[ÇC][ÃA]O\s+MUNICIPAL/i.test(textoCompleto);
    if (isDAM) {
      esSugerido = "S";

      // Tipo de tributo: ITBI, IPTU, ISS, etc.
      const mTrib = textoCompleto.match(/\b(ITBI|IPTU|ISS(?:QN)?|IVVC|COSIP|TLP)\b/);
      const tipoTrib = mTrib ? mTrib[1].toUpperCase() : "DAM";

      // Município (ex: "PREFEITURA MUNICIPAL DE ANANINDEUA - PA - PMA")
      const mMun = textoCompleto.match(/PREFEITURA\s+MUNICIPAL\s+DE\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-Za-zÀ-ú]+(?:\s+[A-Za-zÀ-ú]+)*)/i);
      const municipio = mMun ? mMun[1].trim() : null;

      // Beneficiário — Prefeitura (sobrescreve o que o parser genérico detectou)
      beneficiario = municipio ? `Prefeitura de ${municipio}` : "Prefeitura Municipal";
      cnpjBeneficiario = null;

      // Número do processo (ex: "Processo ITBI: 202600000110714")
      if (!numeroDocumento) {
        const mProc = textoCompleto.match(/Processo\s+[A-Z]+\s*:\s*([\d]+)/i)
                   || textoCompleto.match(/N[°oº\s]*DOCUMENTO\s+([\d\.\-\/]+)/i);
        if (mProc) numeroDocumento = mProc[1].trim();
      }

      historicoDarf = `DAM — ${tipoTrib}${municipio ? ` — ${municipio}` : ""}`;
      fonteLinh = "dam";
    }

    // ── Regra geral: pagador = Addere → sempre Saída ────────────────────────────
    if (!esSugerido && cpfCnpjPagador && cpfCnpjPagador.replace(/\D/g, "") === CNPJ_FIRMA) {
      esSugerido = "S";
    }

    const fonte = isDARF ? "darf" : isNFeEnergia ? "nfe_energia" : isDAS ? "das" : isDAM ? "dam" : (linha ? fonteLinh : (vencimento || valorCentavos ? "texto_extraido" : "nao_encontrado"));
    res.json({ linha, vencimento, valorCentavos, pagador, cpfCnpjPagador, beneficiario, cnpjBeneficiario, numeroDocumento, intermediario, esSugerido, clienteId, clienteNome, clienteStatus, fonte, historico: historicoDarf });
  } catch (e) {
    console.error("❌ Erro ao parsear boleto PDF:", e);
    res.status(500).json({ message: e.message || "Erro ao processar PDF" });
  }
});

// ----------------------------
// LANÇAMENTO — CRIAR (MANUAL)
// ----------------------------
router.post("/api/livro-caixa/lancamentos", authenticate, async (req, res) => {
  try {
    const b = req.body || {};

    const competenciaAno = Number(b.competenciaAno);
    const competenciaMes = Number(b.competenciaMes);

    if (!competenciaAno || competenciaAno < 2000) return res.status(400).json({ message: "competenciaAno inválido." });
    if (!competenciaMes || competenciaMes < 1 || competenciaMes > 12) return res.status(400).json({ message: "competenciaMes inválido." });

    const data = parseDateDDMMYYYY(b.dataBR);
    if (!data) return res.status(400).json({ message: "dataBR inválida (DD/MM/AAAA)." });

    const es = String(b.es || "").toUpperCase();
    if (es !== "E" && es !== "S") return res.status(400).json({ message: "es deve ser 'E' ou 'S'." });

    const valorCentavos = Number(b.valorCentavos);
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return res.status(400).json({ message: "valorCentavos inválido." });

    let contaId = b.contaId ? Number(b.contaId) : null;
    const clienteContaId = b.clienteContaId ? Number(b.clienteContaId) : null;
    // Regra: lançamento de conta de cliente sempre usa a conta contábil "Clientes" no LC.
    if (clienteContaId) {
      contaId = await getContaClientesAtivaId(prisma);
    }
    const hasAccount = !!(contaId || clienteContaId);
    const status = hasAccount ? "OK" : "PENDENTE_CONTA";
    const localLabelFallback = contaId ? null : (clienteContaId ? "Clientes" : "⚠ Informar conta");

    const lancamentoData = {
      competenciaAno,
      competenciaMes,
      data,
      documento: b.documento || null,
      es,
      clienteFornecedor: b.clienteFornecedor || null,
      historico: String(b.historico || "").trim(),
      valorCentavos,
      contaId,
      clienteContaId,
      ordemDia: Number(b.ordemDia) || 0,
      origem: "MANUAL",
      status,
      statusFluxo: b.confirmarAgora ? "EFETIVADO" : "PREVISTO",
      localLabelFallback,
    };

    let lancamento;
    if (clienteContaId) {
      // Atomic: lançamento + ContaCorrenteCliente entry
      const natureza = es === "S" ? "DEBITO" : "CREDITO";
      const [newLanc] = await prisma.$transaction([
        prisma.livroCaixaLancamento.create({ data: lancamentoData, include: { conta: true } }),
        prisma.contaCorrenteCliente.create({
          data: {
            clienteId: clienteContaId,
            data,
            descricao: String(b.historico || "").trim() || (es === "S" ? "Saída" : "Entrada"),
            documento: b.documento || null,
            valorCent: valorCentavos,
            natureza,
          },
        }),
      ]);
      lancamento = newLanc;
    } else {
      lancamento = await prisma.livroCaixaLancamento.create({
        data: lancamentoData,
        include: { conta: true },
      });
    }

    res.status(201).json({ lancamento });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// TRANSFERÊNCIA ENTRE CONTAS
// Cria dois lançamentos atomicamente: Saída da origem + Entrada no destino
// ----------------------------
router.post("/api/livro-caixa/transferencia", authenticate, async (req, res) => {
  try {
    const b = req.body || {};

    const competenciaAno = Number(b.competenciaAno);
    const competenciaMes = Number(b.competenciaMes);
    if (!competenciaAno || competenciaAno < 2000) return res.status(400).json({ message: "competenciaAno inválido." });
    if (!competenciaMes || competenciaMes < 1 || competenciaMes > 12) return res.status(400).json({ message: "competenciaMes inválido." });

    const data = parseDateDDMMYYYY(b.dataBR);
    if (!data) return res.status(400).json({ message: "dataBR inválida (DD/MM/AAAA)." });

    const valorCentavos = Number(b.valorCentavos);
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return res.status(400).json({ message: "valorCentavos inválido." });

    const contaOrigemId    = Number(b.contaOrigemId)    || 0;
    const clienteOrigemId  = Number(b.clienteOrigemId)  || 0;
    const contaDestinoId   = Number(b.contaDestinoId)   || 0;
    const clienteDestinoId = Number(b.clienteDestinoId) || 0;

    if (!contaOrigemId && !clienteOrigemId)   return res.status(400).json({ message: "Informe contaOrigemId ou clienteOrigemId." });
    if (!contaDestinoId && !clienteDestinoId) return res.status(400).json({ message: "Informe contaDestinoId ou clienteDestinoId." });
    if (contaOrigemId   && contaOrigemId   === contaDestinoId)   return res.status(400).json({ message: "Conta Origem e Destino devem ser diferentes." });
    if (clienteOrigemId && clienteOrigemId === clienteDestinoId) return res.status(400).json({ message: "Conta Origem e Destino devem ser diferentes." });

    // Resolver id da conta Clientes para lançamentos envolvendo CC de clientes
    let clientesContaId = 0;
    if (clienteOrigemId || clienteDestinoId) {
      const cc = await prisma.livroCaixaConta.findFirst({ where: { tipo: "CLIENTES", ativa: true } });
      clientesContaId = cc?.id || 0;
    }

    const historico = String(b.historico || "Transferência entre contas").trim();
    const documento = b.documento || null;
    const ref = `TRANSF_${Date.now()}`;
    const cfSaida   = b.clienteFornecedorSaida   || null;
    const cfEntrada = b.clienteFornecedorEntrada  || null;

    const ops = [
      prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno, competenciaMes, data,
          documento, es: "S",
          clienteFornecedor: cfSaida,
          historico,
          valorCentavos,
          contaId:             contaOrigemId   || (clienteOrigemId ? clientesContaId : null) || null,
          clienteContaId:      clienteOrigemId || null,
          localLabelFallback:  null,
          ordemDia: 0,
          origem: "MANUAL",
          status: "OK",
          statusFluxo: "EFETIVADO",
          referenciaOrigem: ref,
        },
        include: { conta: true },
      }),
      prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno, competenciaMes, data,
          documento, es: "E",
          clienteFornecedor: cfEntrada,
          historico,
          valorCentavos,
          contaId:             contaDestinoId   || (clienteDestinoId ? clientesContaId : null) || null,
          clienteContaId:      clienteDestinoId || null,
          localLabelFallback:  null,
          ordemDia: 0,
          origem: "MANUAL",
          status: "OK",
          statusFluxo: "EFETIVADO",
          referenciaOrigem: ref,
        },
        include: { conta: true },
      }),
    ];

    // Conta corrente do cliente origem: dinheiro saindo
    if (clienteOrigemId) {
      ops.push(prisma.contaCorrenteCliente.create({
        data: { clienteId: clienteOrigemId, data, descricao: historico, documento, valorCent: valorCentavos, natureza: "DEBITO" },
      }));
    }
    // Conta corrente do cliente destino: dinheiro entrando
    if (clienteDestinoId) {
      ops.push(prisma.contaCorrenteCliente.create({
        data: { clienteId: clienteDestinoId, data, descricao: historico, documento, valorCent: valorCentavos, natureza: "CREDITO" },
      }));
    }

    const [saida, entrada] = await prisma.$transaction(ops);
    res.status(201).json({ saida, entrada });
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// CONFIRMAR LANÇAMENTO (PREVISTO -> EFETIVADO)
// ----------------------------
router.patch("/api/livro-caixa/lancamentos/:id/confirmar", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido." });

    const existing = await prisma.livroCaixaLancamento.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Lançamento não encontrado." });

    const cf = String(existing.clienteFornecedor || "").trim();
    if (!cf) {
      return res.status(400).json({ message: "Informe Cliente/Fornecedor antes de confirmar." });
    }

    // Data de recebimento: vem do body ou usa hoje
    const { dataRecebimento, contaId: contaIdBody } = req.body || {};
    const dt = dataRecebimento ? new Date(dataRecebimento) : new Date();
    if (!Number.isFinite(dt.getTime())) {
      return res.status(400).json({ message: "Data de recebimento inválida." });
    }

    let novaContaId = contaIdBody ? Number(contaIdBody) : existing.contaId;
    if (existing.clienteContaId) {
      novaContaId = await getContaClientesAtivaId(prisma);
    }
    const hasAccount = !!(novaContaId || existing.clienteContaId);
    const localLabelFallback = novaContaId ? null : (existing.clienteContaId ? "Clientes" : "⚠ Informar conta");

    const lancamento = await prisma.$transaction(async (tx) => {
      const updated = await tx.livroCaixaLancamento.update({
        where: { id },
        data: {
          statusFluxo: "EFETIVADO",
          data: dt,
          competenciaAno: dt.getFullYear(),
          competenciaMes: dt.getMonth() + 1,
          contaId: novaContaId || null,
          status: hasAccount ? "OK" : "PENDENTE_CONTA",
          localLabelFallback,
        },
        include: { conta: true },
      });

      if (updated.clienteContaId) {
        await ensureContaCorrenteEspelhoFromLc(tx, updated);
      }

      return updated;
    });

    // Se o lançamento é de uma parcela prevista, atualizar a parcela e disparar e-mail
    if (existing.origem === "PARCELA_PREVISTA" && existing.referenciaOrigem) {
      const parcelaId = parseInt(existing.referenciaOrigem);
      if (parcelaId) {
        const parcela = await prisma.parcelaContrato.findUnique({
          where: { id: parcelaId },
          include: { contrato: { include: { cliente: { select: { nomeRazaoSocial: true } } } } },
        });
        if (parcela && parcela.status !== "RECEBIDA") {
          await prisma.parcelaContrato.update({
            where: { id: parcelaId },
            data: {
              status: "RECEBIDA",
              dataRecebimento: dt,
              valorRecebido: existing.valorCentavos / 100,
            },
          });
        }
      }
    }

    res.json({ lancamento });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// EDITAR LANÇAMENTO MANUAL
// ----------------------------
router.put("/api/livro-caixa/lancamentos/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido." });

    const existing = await prisma.livroCaixaLancamento.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Lançamento não encontrado." });
    const b = req.body;
    const updateData = {};

    // Parse date if provided
    if (b.dataBR) {
      const match = String(b.dataBR).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (match) {
        const [, dd, mm, yyyy] = match;
        updateData.data = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
        // Competência sempre acompanha a data
        updateData.competenciaAno = Number(yyyy);
        updateData.competenciaMes = Number(mm);
      }
    }

    if (b.es !== undefined) {
      const es = String(b.es).toUpperCase();
      if (es === "E" || es === "S") updateData.es = es;
    }

    if (b.valorCentavos !== undefined) {
      const v = Number(b.valorCentavos);
      if (Number.isInteger(v) && v > 0) updateData.valorCentavos = v;
    }

    if (b.documento !== undefined) updateData.documento = b.documento || null;
    if (b.clienteFornecedor !== undefined) updateData.clienteFornecedor = b.clienteFornecedor || null;
    if (b.historico !== undefined) updateData.historico = String(b.historico || "").trim();

    if (b.contaId !== undefined || b.clienteContaId !== undefined) {
      let contaId = b.contaId !== undefined ? (b.contaId ? Number(b.contaId) : null) : existing.contaId;
      const clienteContaId = b.clienteContaId !== undefined ? (b.clienteContaId ? Number(b.clienteContaId) : null) : existing.clienteContaId;

      // Regra: lançamento de conta de cliente sempre usa a conta contábil "Clientes" no LC.
      if (clienteContaId) {
        contaId = await getContaClientesAtivaId(prisma);
      }

      const hasAccount = !!(contaId || clienteContaId);
      updateData.contaId = contaId;
      updateData.clienteContaId = clienteContaId;
      updateData.status = hasAccount ? "OK" : "PENDENTE_CONTA";
      updateData.localLabelFallback = contaId ? null : (clienteContaId ? "Clientes" : "⚠ Informar conta");
    }

    const lancamento = await prisma.$transaction(async (tx) => {
      const updated = await tx.livroCaixaLancamento.update({
        where: { id },
        data: updateData,
        include: { conta: true },
      });

      if (updated.clienteContaId) {
        await ensureContaCorrenteEspelhoFromLc(tx, updated);
      }

      return updated;
    });

    res.json({ lancamento });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// EXCLUIR LANÇAMENTO MANUAL
// ----------------------------
router.delete("/api/livro-caixa/lancamentos/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido." });

    const existing = await prisma.livroCaixaLancamento.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Lançamento não encontrado." });
    await prisma.livroCaixaLancamento.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// SINCRONIZAR PAGAMENTOS RECEBIDOS NO LIVRO CAIXA
// ----------------------------
router.post("/api/livro-caixa/sincronizar-pagamentos", authenticate, async (req, res) => {
  try {
    const { ano, mes } = parseAnoMesFromQuery(req);

    // ✅ saldo do mês anterior (considera apenas EFETIVADO)
    let prevAno = ano;
    let prevMes = mes - 1;
    if (prevMes === 0) {
      prevMes = 12;
      prevAno = ano - 1;
    }

    const prevLancs = await prisma.livroCaixaLancamento.findMany({
      where: {
        competenciaAno: prevAno,
        competenciaMes: prevMes,
        statusFluxo: "EFETIVADO",
      },
      select: { es: true, valorCentavos: true },
    });

    const saldoAnteriorCentavos = prevLancs.reduce((acc, l) => {
      if (l.es === "E") return acc + l.valorCentavos;
      if (l.es === "S") return acc - l.valorCentavos;
      return acc;
    }, 0);

    console.log('\n========================================');
    console.log('📄 SINCRONIZANDO PAGAMENTOS NO LIVRO CAIXA');
    console.log('========================================');
    console.log('Competência:', { ano, mes });

    const primeiroDia = new Date(Date.UTC(ano, mes - 1, 1, 0, 0, 0));
    const ultimoDia = new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));

    console.log('Período:', {
      de: primeiroDia.toISOString(),
      ate: ultimoDia.toISOString(),
    });

    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: {
          in: ["RECEBIDA", "REPASSE_EFETUADO"],
        },
        dataRecebimento: {
          gte: primeiroDia,
          lte: ultimoDia,
        },
      },
      include: {
        contrato: {
          include: {
            cliente: {
              select: {
                nomeRazaoSocial: true,
              },
            },
          },
        },
      },
      orderBy: {
        dataRecebimento: 'asc',
      },
    });

    console.log(`✅ ${parcelas.length} parcelas recebidas encontradas`);

    const lancamentosCriados = [];
    const lancamentosJaExistentes = [];

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;

      // Verificar se já existe lançamento para esta parcela
      const jaExiste = await prisma.livroCaixaLancamento.findFirst({
        where: {
          origem: "PAGAMENTO_RECEBIDO",
          referenciaOrigem: `PARCELA_${parcela.id}`,
        },
      });

      if (jaExiste) {
        lancamentosJaExistentes.push(parcela.id);
        console.log(`⭐ Parcela ${parcela.id} já sincronizada`);
        continue;
      }

      // Criar lançamento EFETIVADO
      const valorCentavos = Math.round(parseFloat(parcela.valorRecebido || parcela.valorPrevisto) * 100);
      
      const historico = `Pagamento referente contrato ${contrato.numeroContrato}${parcela.numero > 1 ? " - Parcela " + parcela.numero : ""}`;
      
      const documento = contrato.isentoTributacao ? null : "NFS-e";

      const lancamento = await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno: ano,
          competenciaMes: mes,
          data: parcela.dataRecebimento,
          documento,
          es: "E", // Entrada
          clienteFornecedor: clienteEfetivoNome || clienteFornecedor || null,
          historico,
          valorCentavos,
          contaId: null, // Começa pendente
          ordemDia: 0,
          origem: "PAGAMENTO_RECEBIDO",
          status: "PENDENTE_CONTA",
          statusFluxo: "EFETIVADO", // ✅ NOVO: Marca como efetivado
          localLabelFallback: "⚠ Informar conta",
          referenciaOrigem: `PARCELA_${parcela.id}`,
        },
        include: { conta: true },
      });

      lancamentosCriados.push(lancamento);

      console.log(`✅ Parcela ${parcela.id} sincronizada - R$ ${(valorCentavos / 100).toFixed(2)}`);
    }

    console.log('\n========================================');
    console.log(`✅ SINCRONIZAÇÃO CONCLUÍDA`);
    console.log(`Criados: ${lancamentosCriados.length}`);
    console.log(`Já existentes: ${lancamentosJaExistentes.length}`);
    console.log('========================================\n');

    res.json({
      message: "Sincronização concluída com sucesso",
      criados: lancamentosCriados.length,
      jaExistentes: lancamentosJaExistentes.length,
      total: parcelas.length,
      lancamentos: lancamentosCriados,
    });

  } catch (e) {
    console.error("❌ Erro ao sincronizar pagamentos:", e);
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// 2. SINCRONIZAR PARCELAS PREVISTAS (PREVISTO)
// ----------------------------
router.post("/api/livro-caixa/sincronizar-previstas", authenticate, async (req, res) => {
  try {
    const { ano, mes } = parseAnoMesFromQuery(req);

    let prevAno = ano;
    let prevMes = mes - 1;
    if (prevMes === 0) {
      prevMes = 12;
      prevAno = ano - 1;
    }

    console.log('\n========================================');
    console.log('📅 SINCRONIZANDO PARCELAS PREVISTAS');
    console.log('========================================');
    console.log('Competência:', { ano, mes });

    // Buscar parcelas PREVISTAS que vencem neste mês
    const primeiroDia = new Date(Date.UTC(ano, mes - 1, 1, 0, 0, 0));
    const ultimoDia = new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));

    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "PREVISTA",
        vencimento: {
          gte: primeiroDia,
          lte: ultimoDia,
        },
      },
      include: {
        contrato: {
          include: {
            cliente: {
              select: {
                nomeRazaoSocial: true,
              },
            },
            parcelas: {
              select: { id: true },
            },
          },
        },
      },
      orderBy: {
        vencimento: 'asc',
      },
    });

    console.log(`📦 ${parcelas.length} parcelas previstas encontradas`);

    const lancamentosCriados = [];
    const lancamentosJaExistentes = [];

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;

      // Verificar se já existe lançamento previsto para esta parcela
      // Nota: syncParcelaComLivroCaixa usa referenciaOrigem: String(parcela.id)
      // Verifica ambos os formatos para compatibilidade
      const jaExiste = await prisma.livroCaixaLancamento.findFirst({
        where: {
          origem: "PARCELA_PREVISTA",
          OR: [
            { referenciaOrigem: String(parcela.id) },
            { referenciaOrigem: `PARCELA_${parcela.id}` },
          ],
        },
      });

      if (jaExiste) {
        lancamentosJaExistentes.push(parcela.id);
        continue;
      }

      // Criar lançamento PREVISTO
      // Usa o mesmo formato de referenciaOrigem que syncParcelaComLivroCaixa
      const valorCentavos = Math.round(parseFloat(parcela.valorPrevisto) * 100);
      const totalParcelas = contrato.parcelas?.length || 1;

      const historico = `Parcela ${parcela.numero}/${totalParcelas} - ${contrato.numeroContrato} (previsão)`;

      const lancamento = await prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno: ano,
          competenciaMes: mes,
          data: parcela.vencimento,
          documento: contrato.numeroContrato,
          es: "E",
          clienteFornecedor: contrato.cliente?.nomeRazaoSocial || "N/A",
          historico,
          valorCentavos,
          contaId: null,
          ordemDia: 0,
          origem: "PARCELA_PREVISTA",
          status: "PENDENTE_CONTA",
          statusFluxo: "PREVISTO",
          localLabelFallback: "⚠ Informar conta",
          referenciaOrigem: String(parcela.id), // Mesmo formato que syncParcelaComLivroCaixa
        },
      });

      lancamentosCriados.push(lancamento);

      console.log(`✅ Parcela ${parcela.id} incluída como PREVISTA - R$ ${(valorCentavos / 100).toFixed(2)}`);
    }

    console.log('\n========================================');
    console.log(`✅ SINCRONIZAÇÃO DE PREVISTAS CONCLUÍDA`);
    console.log(`Criados: ${lancamentosCriados.length}`);
    console.log(`Já existentes: ${lancamentosJaExistentes.length}`);
    console.log('========================================\n');

    res.json({
      message: "Sincronização de previstas concluída",
      criados: lancamentosCriados.length,
      jaExistentes: lancamentosJaExistentes.length,
      total: parcelas.length,
      lancamentos: lancamentosCriados,
    });

  } catch (e) {
    console.error("❌ Erro ao sincronizar previstas:", e);
    res.status(400).json({ message: e.message });
  }
});


// ----------------------------
// LANÇAMENTO — DEFINIR CONTA (resolver pendência)
// ----------------------------
// Atribui conta a qualquer lançamento (sem restrição de status)
router.patch("/api/livro-caixa/lancamentos/:id/atribuir-conta", authenticate, async (req, res) => {
  const id     = Number(req.params.id);
  const contaId = Number(req.body?.contaId);
  if (!id || !contaId) return res.status(400).json({ message: "id e contaId obrigatórios." });
  try {
    const updated = await prisma.livroCaixaLancamento.update({
      where: { id },
      data: {
        contaId,
        // Se estava PENDENTE_CONTA, resolve a pendência
        status: (await prisma.livroCaixaLancamento.findUnique({ where: { id }, select: { status: true } }))
          ?.status === "PENDENTE_CONTA" ? "OK" : undefined,
      },
      include: { conta: true },
    });
    res.json({ lancamento: updated });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.patch("/api/livro-caixa/lancamentos/:id/definir-conta", authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const contaId = Number(req.body?.contaId);

  if (!id) return res.status(400).json({ message: "ID inválido." });
  if (!contaId) return res.status(400).json({ message: "contaId é obrigatório." });

  const lanc = await prisma.livroCaixaLancamento.findUnique({ where: { id } });
  if (!lanc) return res.status(404).json({ message: "Lançamento não encontrado." });
  if (lanc.status !== "PENDENTE_CONTA") return res.status(400).json({ message: "Este lançamento não está pendente de conta." });

  const updated = await prisma.livroCaixaLancamento.update({
    where: { id },
    data: { contaId, status: "OK", localLabelFallback: null },
    include: { conta: true },
  });

  res.json({ lancamento: updated });
});

// ----------------------------
// PENDÊNCIAS
// ----------------------------
router.get("/api/livro-caixa/pendencias", authenticate, async (req, res) => {
  try {
    const { ano, mes } = parseAnoMesFromQuery(req);

    const pendencias = await prisma.livroCaixaLancamento.findMany({
      where: {
        competenciaAno: ano,
        competenciaMes: mes,
        OR: [
          // 1. Sem conta bancária informada (não pode ser categorizado no LC)
          { status: "PENDENTE_CONTA" },
          // 2. Ainda previsto e não é previsão automática de parcela
          //    (não aparecerá no PDF — precisa ser efetivado ou removido)
          { statusFluxo: "PREVISTO", origem: { notIn: ["PARCELA_PREVISTA"] } },
        ],
      },
      include: { conta: true },
      orderBy: [{ data: "asc" }, { id: "asc" }],
    });

    const semConta = pendencias.filter(p => p.status === "PENDENTE_CONTA").length;
    const previstos = pendencias.filter(p => p.statusFluxo === "PREVISTO" && p.status !== "PENDENTE_CONTA").length;
    res.json({ pendencias, semConta, previstos });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// PREVIEW (saldo acumulado + totais por local)
// ----------------------------
// ----------------------------
// ✅ CORRIGIDO: GET /api/livro-caixa/preview
// ----------------------------
router.get("/api/livro-caixa/preview", authenticate, async (req, res) => {
  try {
    const { ano, mes } = parseAnoMesFromQuery(req);

    // ✅ Calcular saldo anterior dinamicamente
    const saldoAnteriorBase = await calcularSaldoAnterior(ano, mes);

    // ✅ Saldos iniciais de contas abertas NO próprio período (mês/ano atual)
    const primeiroDiaMes = new Date(Date.UTC(ano, mes - 1, 1));
    const primeiroDiaMesSeguinte = new Date(Date.UTC(ano, mes, 1));
    const contasDoMes = await prisma.livroCaixaConta.findMany({
      where: {
        saldoInicialCent: { not: 0 },
        dataInicial: { not: null, gte: primeiroDiaMes, lt: primeiroDiaMesSeguinte },
      },
      select: { saldoInicialCent: true, nome: true },
    });
    const saldoInicialMesAtual = contasDoMes.reduce((sum, c) => sum + c.saldoInicialCent, 0);
    const saldoAnteriorCentavos = saldoAnteriorBase + saldoInicialMesAtual;

    // ✅ Filtrar apenas EFETIVADOS
    const lanc = await prisma.livroCaixaLancamento.findMany({
      where: { 
        competenciaAno: ano, 
        competenciaMes: mes,
        statusFluxo: "EFETIVADO",
      },
      include: { conta: true },
      orderBy: [{ data: "asc" }, { ordemDia: "asc" }, { id: "asc" }],
    });

    let saldo = saldoAnteriorCentavos;

    const linhas = lanc.map((l) => {
      const delta = l.es === "E" ? l.valorCentavos : -l.valorCentavos;
      saldo += delta;
      return {
        ...l,
        saldoAposCentavos: saldo,
        localLabel: l.conta?.nome || l.localLabelFallback || "—",
        dataBR: formatDateBR(l.data),
      };
    });

    // Totais do mês por conta (somente OK), agrupado por contaId
    const totaisMap = new Map(); // key: contaId (number) | "—"
    for (const l of lanc) {
      if (l.status !== "OK") continue;
      const key = l.contaId ?? "—";
      const cur = totaisMap.get(key) || { local: l.conta?.nome || l.localLabelFallback || "—", contaId: l.contaId, entradas: 0, saidas: 0 };
      if (l.es === "E") cur.entradas += l.valorCentavos;
      else cur.saidas += l.valorCentavos;
      totaisMap.set(key, cur);
    }

    // Buscar TODAS as contas ativas para incluir mesmo as sem lançamentos no mês
    const fimDoMes = new Date(Date.UTC(ano, mes, 1));
    const todasContas = await prisma.livroCaixaConta.findMany({
      where: { ativa: true },
      select: { id: true, nome: true, saldoInicialCent: true, dataInicial: true, ordem: true },
      orderBy: { ordem: "asc" },
    });

    // Garantir que todas as contas ativas estejam no mapa
    for (const c of todasContas) {
      if (!totaisMap.has(c.id)) {
        totaisMap.set(c.id, { local: c.nome, contaId: c.id, entradas: 0, saidas: 0 });
      }
    }

    // Saldo acumulado por conta: saldoInicial + histórico (meses anteriores) + mês atual
    const saldoAcumPorConta = new Map();
    const contaIds = todasContas.map(c => c.id);

    // saldoInicial das contas abertas até o fim deste mês
    for (const c of todasContas) {
      if (c.saldoInicialCent && c.dataInicial && new Date(c.dataInicial) < fimDoMes) {
        saldoAcumPorConta.set(c.id, (saldoAcumPorConta.get(c.id) || 0) + c.saldoInicialCent);
      }
    }

    // Transações efetivadas de TODOS os meses até o mês atual (inclusive)
    if (contaIds.length > 0) {
      const historico = await prisma.livroCaixaLancamento.findMany({
        where: {
          statusFluxo: "EFETIVADO",
          contaId: { in: contaIds },
          OR: [
            { competenciaAno: { lt: ano } },
            { competenciaAno: ano, competenciaMes: { lte: mes } },
          ],
        },
        select: { contaId: true, es: true, valorCentavos: true },
      });
      for (const t of historico) {
        const cur = saldoAcumPorConta.get(t.contaId) || 0;
        saldoAcumPorConta.set(t.contaId, cur + (t.es === "E" ? t.valorCentavos : -t.valorCentavos));
      }
    }

    const totaisPorLocal = Array.from(totaisMap.values()).map((v) => ({
      local: v.local,
      entradasCentavos: v.entradas,
      saidasCentavos: v.saidas,
      saldoCentavos: v.contaId != null ? (saldoAcumPorConta.get(v.contaId) || 0) : v.entradas - v.saidas,
    })).filter((v) => v.saldoCentavos !== 0 || v.entradasCentavos > 0 || v.saidasCentavos > 0);

    const pendenciasCount = lanc.filter((x) => x.status === "PENDENTE_CONTA").length;

    res.json({
      saldoAnteriorCentavos,
      saldoAnteriorAno: mes === 1 ? ano - 1 : ano,
      saldoAnteriorMes: mes === 1 ? 12 : mes - 1,
      pendenciasCount,
      linhas,
      totaisPorLocal,
      avisoPrevistos: "ℹ️ Esta visualização mostra apenas lançamentos EFETIVADOS",
    });
  } catch (e) {
    console.error("❌ Erro ao gerar preview:", e);
    res.status(400).json({ message: e.message });
  }
});

// ----------------------------
// EMISSÃO PDF: gera PDF do Livro Caixa
// ----------------------------
router.get("/api/livro-caixa/pdf", authenticate, async (req, res) => {
  try {
    const { ano, mes } = parseAnoMesFromQuery(req);

    // ✅ Verificar pendências apenas nos EFETIVADOS
    const pend = await prisma.livroCaixaLancamento.count({
      where: {
        competenciaAno: ano,
        competenciaMes: mes,
        statusFluxo: "EFETIVADO",
        status: "PENDENTE_CONTA",
      },
    });

    if (pend > 0) {
      return res.status(400).json({
        code: "PENDENCIAS_CONTA",
        message: "Não é possível emitir enquanto houver lançamentos efetivados com '⚠ Informar conta'.",
      });
    }

    // Buscar lançamentos efetivados do mês, ordenados
    const lancamentos = await prisma.livroCaixaLancamento.findMany({
      where: {
        competenciaAno: ano,
        competenciaMes: mes,
        statusFluxo: "EFETIVADO",
      },
      include: { conta: true },
      orderBy: [{ data: "asc" }, { ordemDia: "asc" }, { id: "asc" }],
    });

    // Calcular saldo anterior
    const saldoAnteriorCentavos = await calcularSaldoAnterior(ano, mes);

    // Nome dos meses em português
    const mesesNomes = [
      "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    const mesNome = mesesNomes[mes] || `Mês ${mes}`;
    const mesAnt = mes === 1 ? 12 : mes - 1;
    const anoAnt = mes === 1 ? ano - 1 : ano;
    const mesAntNome = mesesNomes[mesAnt] || `Mês ${mesAnt}`;

    // Formatar valor em BRL
    const formatBRL = (centavos) => {
      const val = (centavos / 100).toFixed(2).replace(".", ",");
      return val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    };

    // Formatar data DD/MM/AAAA
    const formatDate = (d) => {
      if (!d) return "";
      const dt = new Date(d);
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    // Gerar PDF
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30,
      bufferPages: true,
    });

    // Coletar buffers
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));

    // Cores
    const colorBlue = "#1a365d"; // E = dark blue
    const colorRed = "#cc0000";  // S = red
    const colorHeader = "#1a365d";

    // Dimensões (landscape A4: 842 x 595)
    const pageWidth = 842 - 60; // margens
    const pageHeight = 595;
    const startX = 30;
    const startY = 55; // Mais espaço após header compacto
    const rowHeight = 26; // Aumentado para acomodar texto longo
    const headerHeight = 22;
    const footerY = pageHeight - 40; // Posição do footer
    const maxContentY = footerY - 25; // Limite antes do footer

    // Colunas otimizadas: mais espaço para Cliente/Fornecedor, menos para valores numéricos
    const cols = [
      { key: "data", label: "Data", width: 52 },
      { key: "doc", label: "NFS-e/NF/CF/RC", width: 70 },
      { key: "es", label: "E/S", width: 22 },
      { key: "cliente", label: "Cliente/Fornecedor", width: 158 },
      { key: "historico", label: "Histórico", width: 198 },
      { key: "entrada", label: "Entrada", width: 55 },
      { key: "saida", label: "Saída", width: 55 },
      { key: "local", label: "Local", width: 78 },
      { key: "saldo", label: "Saldo", width: 67 },
    ];

    // Ajustar larguras proporcionalmente
    const totalColWidth = cols.reduce((s, c) => s + c.width, 0);
    const scale = pageWidth / totalColWidth;
    cols.forEach(c => c.width = Math.floor(c.width * scale));

    let currentY = startY;
    let pageNum = 1;
    let saldoAcumulado = saldoAnteriorCentavos;

    // Data/hora de emissão (capturada uma vez)
    const now = new Date();
    const dataEmissao = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // Desenhar cabeçalho da página (compacto, uma linha, sem logo)
    const drawPageHeader = () => {
      const headerY = 22;

      // Uma linha: Addere - Livro Caixa (esquerda) | Addere (centro) | Mês (direita)
      doc.font("Helvetica-Bold").fontSize(10).fillColor(colorHeader);
      doc.text(`Addere - Livro Caixa ${ano}`, startX, headerY, { width: 200, align: "left" });

      doc.font("Helvetica").fontSize(9).fillColor("#333");
      doc.text("Addere", startX, headerY, { width: pageWidth, align: "center" });

      // Mês - right aligned
      doc.font("Helvetica-Bold").fontSize(10).fillColor(colorHeader);
      doc.text(mesNome, startX, headerY, { width: pageWidth, align: "right" });

      // Linha separadora
      doc.moveTo(startX, 40).lineTo(startX + pageWidth, 40).strokeColor("#ccc").lineWidth(0.5).stroke();
    };

    // Desenhar footer da página (com linha separadora)
    const drawPageFooter = (pNum) => {
      // Linha separadora antes do footer
      doc.moveTo(startX, footerY - 10).lineTo(startX + pageWidth, footerY - 10).strokeColor("#ccc").lineWidth(0.5).stroke();

      doc.font("Helvetica").fontSize(8).fillColor("#666");
      doc.text(dataEmissao, startX, footerY, { align: "left", width: pageWidth / 2 });
      doc.text(`Página ${pNum}`, startX + pageWidth / 2, footerY, { align: "right", width: pageWidth / 2 });
    };

    // Desenhar cabeçalho da tabela
    const drawTableHeader = () => {
      doc.rect(startX, currentY, pageWidth, headerHeight).fill("#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#1e293b");

      let x = startX;
      cols.forEach(col => {
        doc.text(col.label, x + 3, currentY + 6, { width: col.width - 6, align: "left" });
        x += col.width;
      });

      currentY += headerHeight;
    };

    // Verificar se precisa nova página
    const checkNewPage = () => {
      if (currentY > maxContentY) {
        doc.addPage();
        pageNum++;
        currentY = startY;
        drawPageHeader();
        drawTableHeader();
      }
    };

    // Desenhar linha (fundo branco, cor E/S e Histórico)
    const drawRow = (rowData, _unused, esColor = "#333") => {
      checkNewPage();

      // Fundo sempre branco (sem alternância)
      doc.font("Helvetica").fontSize(7).fillColor("#333");

      let x = startX;
      cols.forEach(col => {
        let val = rowData[col.key] || "";
        let color = "#333";

        // Colunas E/S e Histórico têm cor especial
        if (col.key === "es" || col.key === "historico") {
          color = esColor;
        }

        if (col.key === "entrada" || col.key === "saida" || col.key === "saldo") {
          doc.font("Helvetica").fontSize(7).fillColor(color);
          doc.text(val, x + 3, currentY + 8, { width: col.width - 6, align: "right" });
        } else {
          doc.font("Helvetica").fontSize(7).fillColor(color);
          doc.text(val, x + 3, currentY + 8, { width: col.width - 6, align: "left" });
        }

        x += col.width;
      });

      // Linha horizontal sutil
      doc.moveTo(startX, currentY + rowHeight).lineTo(startX + pageWidth, currentY + rowHeight).strokeColor("#e5e5e5").lineWidth(0.3).stroke();

      currentY += rowHeight;
    };

    // Primeira página
    drawPageHeader();
    drawTableHeader();

    // Linha de saldo anterior
    drawRow({
      data: "",
      doc: "",
      es: "",
      cliente: "",
      historico: `Saldo de ${mesAntNome}/${anoAnt}`,
      entrada: "",
      saida: "",
      local: "",
      saldo: formatBRL(saldoAnteriorCentavos),
    }, false, "#333");

    // Totais por conta
    const totaisPorConta = {};

    // Lançamentos
    lancamentos.forEach((lanc, idx) => {
      const esColor = lanc.es === "E" ? colorBlue : colorRed;
      const entrada = lanc.es === "E" ? lanc.valorCentavos : 0;
      const saida = lanc.es === "S" ? lanc.valorCentavos : 0;

      saldoAcumulado += entrada - saida;

      const localLabel = lanc.conta?.nome || lanc.localLabelFallback || "";

      // Acumular totais por conta
      if (!totaisPorConta[localLabel]) {
        totaisPorConta[localLabel] = { entradas: 0, saidas: 0 };
      }
      totaisPorConta[localLabel].entradas += entrada;
      totaisPorConta[localLabel].saidas += saida;

      drawRow({
        data: formatDate(lanc.data),
        doc: lanc.documento || "",
        es: lanc.es,
        cliente: lanc.clienteFornecedor || "",
        historico: lanc.historico || "",
        entrada: entrada > 0 ? formatBRL(entrada) : "",
        saida: saida > 0 ? formatBRL(saida) : "",
        local: localLabel,
        saldo: formatBRL(saldoAcumulado),
      }, idx % 2 === 1, esColor);
    });

    // Calcular saldo acumulado por conta (saldoInicial + histórico até o mês atual)
    const todasContasAtivas = await prisma.livroCaixaConta.findMany({
      where: { ativa: true },
      select: { id: true, nome: true, saldoInicialCent: true, dataInicial: true, ordem: true },
      orderBy: { ordem: "asc" },
    });
    const fimDoMesPDF = new Date(Date.UTC(ano, mes, 1));
    const saldoAcumPDF = new Map();
    for (const c of todasContasAtivas) {
      if (c.saldoInicialCent && c.dataInicial && new Date(c.dataInicial) < fimDoMesPDF) {
        saldoAcumPDF.set(c.id, (saldoAcumPDF.get(c.id) || 0) + c.saldoInicialCent);
      }
    }
    const contaIdsPDF = todasContasAtivas.map(c => c.id);
    if (contaIdsPDF.length > 0) {
      const historicoPDF = await prisma.livroCaixaLancamento.findMany({
        where: {
          statusFluxo: "EFETIVADO",
          contaId: { in: contaIdsPDF },
          OR: [
            { competenciaAno: { lt: ano } },
            { competenciaAno: ano, competenciaMes: { lte: mes } },
          ],
        },
        select: { contaId: true, es: true, valorCentavos: true },
      });
      for (const t of historicoPDF) {
        saldoAcumPDF.set(t.contaId, (saldoAcumPDF.get(t.contaId) || 0) + (t.es === "E" ? t.valorCentavos : -t.valorCentavos));
      }
    }

    // Montar lista de contas para exibição: qualquer conta com movimento no mês
    // ou saldo acumulado diferente de zero. Contas negativas também devem aparecer.
    const contasParaExibir = todasContasAtivas
      .map(c => ({
        local: c.nome,
        entradas: totaisPorConta[c.nome]?.entradas || 0,
        saidas:   totaisPorConta[c.nome]?.saidas   || 0,
        saldo:    saldoAcumPDF.get(c.id) || 0,
      }))
      .filter(c => c.entradas !== 0 || c.saidas !== 0 || c.saldo !== 0);

    // Verificar espaço para saldo final + tabela de contas (estimativa: ~20 + 18 + 16*nContas)
    const contasCount = contasParaExibir.length;
    const espacoNecessario = 40 + (contasCount * 16) + 30;

    if (currentY + espacoNecessario > maxContentY) {
      // Nova página para o resumo final
      doc.addPage();
      pageNum++;
      currentY = startY;
      drawPageHeader();
    }

    // Saldo final do mês
    currentY += 10;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(colorHeader);
    doc.text(`Saldo de ${mesNome}: ${formatBRL(saldoAcumulado)}`, startX, currentY, { align: "right", width: pageWidth });

    currentY += 25;

    // Tabela de saldos por conta (apenas na última página)
    if (contasCount > 0) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(colorHeader);
      doc.text("Totais por Local (Conta)", startX, currentY);
      currentY += 15;

      // Cabeçalho da tabela de totais
      doc.rect(startX, currentY, 400, 18).fill("#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#1e293b");
      doc.text("Local", startX + 5, currentY + 5, { width: 150 });
      doc.text("Entradas", startX + 160, currentY + 5, { width: 75, align: "right" });
      doc.text("Saídas", startX + 240, currentY + 5, { width: 75, align: "right" });
      doc.text("Saldo", startX + 320, currentY + 5, { width: 75, align: "right" });
      currentY += 18;

      contasParaExibir.forEach(({ local, entradas, saidas, saldo }) => {
        const saldoColor = saldo >= 0 ? "#1e40af" : "#dc2626";

        doc.font("Helvetica").fontSize(7).fillColor("#333");
        doc.text(local || "(sem conta)", startX + 5, currentY + 4, { width: 150 });
        doc.fillColor(colorBlue).text(formatBRL(entradas), startX + 160, currentY + 4, { width: 75, align: "right" });
        doc.fillColor(colorRed).text(formatBRL(saidas), startX + 240, currentY + 4, { width: 75, align: "right" });
        doc.fillColor(saldoColor).font("Helvetica-Bold").text(formatBRL(saldo), startX + 320, currentY + 4, { width: 75, align: "right" });

        doc.moveTo(startX, currentY + 16).lineTo(startX + 400, currentY + 16).strokeColor("#e5e5e5").lineWidth(0.3).stroke();

        currentY += 16;
      });
    }

    // Adicionar footer em todas as páginas usando bufferPages
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      drawPageFooter(i + 1);
    }

    // Finalizar PDF
    doc.end();

    // Aguardar finalização
    await new Promise((resolve) => doc.on("end", resolve));

    // Enviar PDF como resposta
    const pdfBuffer = Buffer.concat(chunks);
    const fileName = `Livro_Caixa_${ano}_${String(mes).padStart(2, "0")}_${mesNome}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (e) {
    console.error("❌ Erro ao gerar PDF do Livro Caixa:", e);
    res.status(400).json({ message: e.message });
  }
});

// ============================================================
// ✅ OPCIONAL: Endpoint para criar/atualizar saldo inicial
// ============================================================
router.post("/api/livro-caixa/saldo-inicial", authenticate, requireAdmin, async (req, res) => {
  try {
    const { ano, mes, saldoCentavos } = req.body;

    if (!ano || !mes) {
      return res.status(400).json({ message: "ano e mes são obrigatórios" });
    }

    if (typeof saldoCentavos !== 'number') {
      return res.status(400).json({ message: "saldoCentavos deve ser um número" });
    }

    const saldo = await prisma.livroCaixaSaldoInicial.upsert({
      where: {
        competenciaAno_competenciaMes: {
          competenciaAno: ano,
          competenciaMes: mes
        }
      },
      update: {
        saldoInicialCent: saldoCentavos
      },
      create: {
        competenciaAno: ano,
        competenciaMes: mes,
        saldoInicialCent: saldoCentavos
      }
    });

    res.json({
      message: "Saldo inicial configurado com sucesso",
      saldo
    });
  } catch (e) {
    console.error("❌ Erro ao configurar saldo inicial:", e);
    res.status(400).json({ message: e.message });
  }
});

router.get("/api/livro-caixa/saldo-inicial", authenticate, async (req, res) => {
  try {
    const saldos = await prisma.livroCaixaSaldoInicial.findMany({
      orderBy: [
        { competenciaAno: 'desc' },
        { competenciaMes: 'desc' }
      ]
    });

    res.json({ saldos });
  } catch (e) {
    console.error("❌ Erro ao buscar saldos iniciais:", e);
    res.status(400).json({ message: e.message });
  }
});

// ============================================================
// 5. PUT /api/livro-caixa/lancamentos/:id/documento
// Edita campo documento (NFS-e/NF/CF/RC)
// ============================================================
router.put("/api/livro-caixa/lancamentos/:id/documento", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { documento } = req.body;

    console.log(`\n📝 Editando documento do lançamento: ${id}`);

    // Buscar lançamento
    const lancamento = await prisma.livroCaixaLancamento.findUnique({
      where: { id: parseInt(id) },
    });

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado" });
    }

    if (lancamento.statusFluxo !== "EFETIVADO") {
      return res.status(400).json({ 
        message: "Apenas lançamentos EFETIVADOS podem ter o documento editado" 
      });
    }

    // Atualizar documento
    const atualizado = await prisma.livroCaixaLancamento.update({
      where: { id: parseInt(id) },
      data: {
        documento: documento || null,
      },
    });

    console.log(`✅ Documento atualizado: "${documento || "(vazio)"}"`);

    res.json({
      message: "Documento atualizado com sucesso",
      lancamento: atualizado,
    });

  } catch (error) {
    console.error("❌ Erro ao editar documento:", error);
    res.status(500).json({ 
      message: "Erro ao editar documento",
      error: error.message,
    });
  }
});


// ============================================================
// VENCIDOS EM ABERTO
// ============================================================

// POST /api/livro-caixa/vencidos-em-aberto/enviar-email (disparo manual, admin only)
router.post("/api/livro-caixa/vencidos-em-aberto/enviar-email", authenticate, requireAdmin, async (req, res) => {
  try {
    const inicioDia = new Date();
    inicioDia.setUTCHours(3, 0, 0, 0); // T03:00Z = meia-noite BRT

    const items = await prisma.livroCaixaLancamento.findMany({
      where: { statusFluxo: "PREVISTO", data: { lt: inicioDia } },
      include: { conta: true },
      orderBy: [{ data: "asc" }],
    });

    if (items.length === 0) {
      return res.json({ ok: true, enviados: 0, message: "Nenhum vencido em aberto — e-mail não enviado." });
    }

    const agora = Date.now();
    const enriched = items.map(l => {
      const dias = Math.floor((agora - new Date(l.data).getTime()) / 86400000);
      const risco = dias <= 30 ? "NORMAL" : dias <= 60 ? "ATENCAO" : dias <= 90 ? "ALTO_RISCO" : "DUVIDOSO";
      return { ...l, diasEmAtraso: dias, risco };
    });

    let enviados = 0;

    // Admins — lista completa
    const admins = await prisma.usuario.findMany({
      where: { role: "ADMIN", ativo: true },
      select: { email: true, nome: true },
    });
    for (const admin of admins) {
      await sendEmail({
        to: admin.email,
        subject: `📋 Addere — ${items.length} lançamento(s) vencido(s) em aberto`,
        html: buildEmailVencidos(admin.nome, enriched),
      });
      enviados++;
    }

    res.json({ ok: true, enviados, vencidos: items.length });
  } catch (e) {
    console.error("❌ Erro ao enviar e-mail manual de vencidos:", e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/livro-caixa/vencidos-em-aberto/contagem (rota leve para o badge do menu)
router.get("/api/livro-caixa/vencidos-em-aberto/contagem", authenticate, async (req, res) => {
  try {
    const hoje = new Date();
    const inicioDia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 3, 0, 0)); // T03:00Z = meia-noite BRT

    let where = { statusFluxo: "PREVISTO", data: { lt: inicioDia } };

    // Exclui LCs órfãos de parcelas canceladas (ambos os formatos: "123" e "PARCELA_123")
    const canceladas = await prisma.parcelaContrato.findMany({ where: { status: "CANCELADA" }, select: { id: true } });
    if (canceladas.length > 0) {
      const refsOrfas = canceladas.flatMap(p => [String(p.id), `PARCELA_${p.id}`]);
      where = { ...where, NOT: { origem: "PARCELA_PREVISTA", referenciaOrigem: { in: refsOrfas } } };
    }

    const total = await prisma.livroCaixaLancamento.count({ where });
    res.json({ total });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/livro-caixa/vencidos-em-aberto
router.get("/api/livro-caixa/vencidos-em-aberto", authenticate, async (req, res) => {
  try {
    const hoje = new Date();
    const inicioDia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 3, 0, 0)); // T03:00Z = meia-noite BRT

    let where = { statusFluxo: "PREVISTO", data: { lt: inicioDia } };

    // Exclui LCs cujas parcelas estão CANCELADAS (ambos os formatos: "123" e "PARCELA_123")
    const parcelasCanceladas = await prisma.parcelaContrato.findMany({
      where: { status: "CANCELADA" },
      select: { id: true },
    });
    if (parcelasCanceladas.length > 0) {
      const refsOrfas = parcelasCanceladas.flatMap(p => [String(p.id), `PARCELA_${p.id}`]);
      where = {
        ...where,
        NOT: { origem: "PARCELA_PREVISTA", referenciaOrigem: { in: refsOrfas } },
      };
    }

    const items = await prisma.livroCaixaLancamento.findMany({
      where,
      include: { conta: true },
      orderBy: [{ data: "asc" }, { id: "asc" }],
    });

    const agora = Date.now();
    const enriched = items.map((l) => {
      const diasEmAtraso = Math.floor((agora - new Date(l.data).getTime()) / 86400000);
      let risco;
      if (diasEmAtraso <= 30) risco = "NORMAL";
      else if (diasEmAtraso <= 60) risco = "ATENCAO";
      else if (diasEmAtraso <= 90) risco = "ALTO_RISCO";
      else risco = "DUVIDOSO";
      return { ...l, diasEmAtraso, risco };
    });

    const totalValorCentavos = enriched.reduce((s, l) => s + l.valorCentavos, 0);
    const contagens = enriched.reduce(
      (acc, l) => {
        if (l.risco === "NORMAL") acc.normal++;
        else if (l.risco === "ATENCAO") acc.atencao++;
        else if (l.risco === "ALTO_RISCO") acc.altoRisco++;
        else acc.duvidoso++;
        return acc;
      },
      { normal: 0, atencao: 0, altoRisco: 0, duvidoso: 0 }
    );

    res.json({ items: enriched, totalValorCentavos, contagens });
  } catch (e) {
    console.error("❌ Erro ao buscar vencidos em aberto:", e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/livro-caixa/vencidos-em-aberto/:id/liquidar
router.post("/api/livro-caixa/vencidos-em-aberto/:id/liquidar", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido." });

    const original = await prisma.livroCaixaLancamento.findUnique({ where: { id } });
    if (!original) return res.status(404).json({ message: "Lançamento não encontrado." });
    if (original.statusFluxo !== "PREVISTO") {
      return res.status(400).json({ message: "Lançamento não está com status PREVISTO." });
    }

    const b = req.body || {};
    const dataReceb = parseDateDDMMYYYY(b.dataBR);
    if (!dataReceb) return res.status(400).json({ message: "dataBR inválida (DD/MM/AAAA)." });

    const valorCentavos = Number(b.valorCentavos);
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
      return res.status(400).json({ message: "valorCentavos inválido." });
    }

    // Resolve conta
    let contaId = b.contaId ? Number(b.contaId) : null;
    if (!contaId && b.contaNome) {
      const conta = await getOrCreateContaContabilImportada(b.contaNome);
      contaId = conta.id;
    }
    if (!contaId && original.contaId) contaId = original.contaId;

    const competenciaAno = dataReceb.getUTCFullYear();
    const competenciaMes = dataReceb.getUTCMonth() + 1;
    const origemNovo = original.origem === "PARCELA_PREVISTA" ? "PAGAMENTO_RECEBIDO" : "MANUAL";

    let novoLancamento;
    let parcelaId = null;

    if (original.origem === "PARCELA_PREVISTA" && original.referenciaOrigem) {
      // referenciaOrigem tem dois formatos: "PARCELA_123" (wizard/poller) ou "123" (syncParcelaComLivroCaixa)
      const ref = String(original.referenciaOrigem);
      const match = ref.match(/PARCELA_(\d+)/) || ref.match(/^(\d+)$/);
      if (match) parcelaId = Number(match[1]);
    }

    await prisma.$transaction(async (tx) => {
      novoLancamento = await tx.livroCaixaLancamento.create({
        data: {
          competenciaAno,
          competenciaMes,
          data: dataReceb,
          es: original.es,
          clienteFornecedor: original.clienteFornecedor,
          historico: original.historico,
          valorCentavos,
          contaId,
          ordemDia: 0,
          origem: origemNovo,
          referenciaOrigem: `LIQUIDADO_DE_${id}`,
          status: contaId ? "OK" : "PENDENTE_CONTA",
          statusFluxo: "EFETIVADO",
        },
      });

      await tx.livroCaixaLancamento.update({
        where: { id },
        data: {
          statusFluxo: "LIQUIDADO",
          referenciaOrigem: `LIQUIDADO_EM_${novoLancamento.id}`,
        },
      });

      if (parcelaId) {
        await tx.parcelaContrato.update({
          where: { id: parcelaId },
          data: {
            status: "RECEBIDA",
            valorRecebido: valorCentavos / 100,
            dataRecebimento: dataReceb,
            meioRecebimento: "PIX",
          },
        });
      }
    });

    res.json({ ok: true, liquidadoId: novoLancamento.id, originalId: id });
  } catch (e) {
    console.error("❌ Erro ao liquidar lançamento:", e);
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/livro-caixa/vencidos-em-aberto/:id/cancelar
router.patch("/api/livro-caixa/vencidos-em-aberto/:id/cancelar", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido." });

    const original = await prisma.livroCaixaLancamento.findUnique({ where: { id } });
    if (!original) return res.status(404).json({ message: "Lançamento não encontrado." });
    if (original.statusFluxo !== "PREVISTO") {
      return res.status(400).json({ message: "Lançamento não está com status PREVISTO." });
    }

    await prisma.livroCaixaLancamento.update({
      where: { id },
      data: { statusFluxo: "CANCELADO" },
    });

    res.json({ ok: true, id });
  } catch (e) {
    console.error("❌ Erro ao cancelar lançamento:", e);
    res.status(500).json({ message: e.message });
  }
});

export default router;
