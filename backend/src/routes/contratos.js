import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { logAuditoria } from "../lib/audit.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppTemplate } from "../lib/whatsapp.js";
import {
  splitCents,
  moneyToCents,
  convertValueToDecimal,
  gerarNumeroContrato,
  parseDateDDMMYYYY,
  addMonthsKeepDay,
  onlyDigits,
} from "../lib/contratoHelpers.js";
import {
  syncParcelaComLivroCaixa,
  syncMultiplasParcelasComLivroCaixa,
} from "../lib/livroCaixaSync.js";
import {
  _dispararAvisoImediatoParcelas,
} from "../schedulers/vencimentos.js";

const router = Router();

// ✅ NOVO: Endpoint para pegar próximo número (com data opcional p/ retroativo)
router.get("/api/contratos/next-numero", authenticate, async (req, res) => {
  try {
    const q = String(req.query.data || req.query.dataBase || "").trim();

    let dataBase = new Date();

    // aceita "DD/MM/AAAA"
    const mBR = q.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (mBR) {
      const dd = Number(mBR[1]);
      const mm = Number(mBR[2]);
      const yyyy = Number(mBR[3]);
      dataBase = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
    }

    // aceita "YYYY-MM-DD" (ou prefixo)
    const mISO = q.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) {
      const yyyy = Number(mISO[1]);
      const mm = Number(mISO[2]);
      const dd = Number(mISO[3]);
      dataBase = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
    }

    const proximoNumero = await gerarNumeroContrato(dataBase);

    res.json({
      numeroContrato: proximoNumero,
      numero: proximoNumero, // compat
      padrao: "AAAAMMDDSSS",
      dataBase: q || null,
    });
  } catch (error) {
    console.error("❌ Erro ao gerar próximo número:", error);
    res.status(500).json({
      message: "Erro ao gerar próximo número",
      error: error.message,
    });
  }
});

// Listar contratos
router.get("/api/contratos", authenticate, async (req, res) => {
  try {
    // Filtro base: ativos ou com renegociação
    const whereBase = {
      OR: [
        { ativo: true },
        { contratosFilhos: { some: {} } },
      ],
    };

    // Filtro opcional por clienteId (usado pelo wizard do modal de boleto)
    if (req.query.clienteId) {
      const cid = Number(req.query.clienteId);
      if (cid) {
        whereBase.clienteId = cid;
        // Quando filtramos por cliente, mostramos apenas os ativos
        whereBase.OR = [{ ativo: true }];
      }
    }

    const contratos = await prisma.contratoPagamento.findMany({
      where: whereBase,
      include: {
        cliente: {
          select: {
            id: true,
            cpfCnpj: true,
            nomeRazaoSocial: true,
          },
        },
        parcelas: {
          select: {
            id: true,
            numero: true,
            vencimento: true,
            valorPrevisto: true,
            status: true,
            valorRecebido: true,
            dataRecebimento: true,
            meioRecebimento: true,
            boletos: {
              where: { status: { not: "CANCELADO" } },
              select: { id: true, status: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
          orderBy: { numero: "asc" },
        },
        contratoOrigem: {
          select: {
            id: true,
            numeroContrato: true,
          },
        },
        contratosFilhos: {
          select: {
            id: true,
            numeroContrato: true,
            valorTotal: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const contratosComTotais = contratos.map((contrato) => {
      const totalPrevisto = contrato.parcelas.reduce(
        (acc, p) => acc + parseFloat(p.valorPrevisto),
        0
      );
      const totalRecebido = contrato.parcelas
        .filter((p) => p.status === "RECEBIDA" || p.status === "REPASSE_EFETUADO")
        .reduce((acc, p) => acc + parseFloat(p.valorRecebido || 0), 0);
      const parcelasRecebidas = contrato.parcelas.filter(
        (p) => p.status === "RECEBIDA" || p.status === "REPASSE_EFETUADO"
      ).length;
      const parcelasPendentes = contrato.parcelas.filter(
        (p) => p.status === "PREVISTA" || p.status === "ATRASADA"
      ).length;

      return {
        ...contrato,
        totais: {
          previsto: totalPrevisto.toFixed(2),
          recebido: totalRecebido.toFixed(2),
          parcelasRecebidas,
          parcelasPendentes,
          totalParcelas: contrato.parcelas.length,
        },
      };
    });

    res.json(contratosComTotais);
  } catch (error) {
    console.error("❌ Erro ao buscar contratos:", error);
    res.status(500).json({
      message: "Erro ao buscar contratos.",
      error: error.message
    });
  }
});

// ✅ CORRIGIDO: Buscar contrato por ID
router.get("/api/contratos/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({
        message: "ID do contrato é obrigatório"
      });
    }

    const contratoId = parseInt(id);

    if (isNaN(contratoId)) {
      return res.status(400).json({
        message: "ID do contrato inválido"
      });
    }

    const contrato = await prisma.contratoPagamento.findUnique({
      where: { id: contratoId },
      include: {
        cliente: {
          select: {
            id: true,
            cpfCnpj: true,
            nomeRazaoSocial: true,
            email: true,
            telefone: true,
          },
        },
        parcelas: {
          orderBy: { numero: "asc" },
        },
        contratoOrigem: {
          select: {
            id: true,
            numeroContrato: true,
          },
        },
        contratosFilhos: {
          select: {
            id: true,
            numeroContrato: true,
            valorTotal: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!contrato) {
      return res.status(404).json({ message: "Contrato não encontrado." });
    }

    console.log('📊 Contrato carregado:', {
      id: contrato.id,
      numero: contrato.numeroContrato,
      parcelas: contrato.parcelas?.length || 0,
    });

    res.json(contrato);

  } catch (error) {
    console.error("❌ Erro ao buscar contrato:", error);
    res.status(500).json({
      message: "Erro ao buscar contrato.",
      error: error.message
    });
  }
});

// ✅ CORRIGIDO: Criar contrato
router.post("/api/contratos", authenticate, async (req, res) => {
  try {
    const {
      numeroContrato,
      clienteId,
      valorTotal,
      formaPagamento,
      observacoes,
      isentoTributacao,
      parcelas,
      contratoOrigemId,
    } = req.body;

    console.log('📥 Dados recebidos:', {
      numeroContrato,
      clienteId,
      valorTotal: typeof valorTotal,
      valorTotalValor: valorTotal,
      formaPagamento,
      parcelasQtd: parcelas?.length,
    });

    // ✅ NORMALIZAÇÃO: frontend manda parcelas como OBJETO { quantidade, primeiroVencimento }
    // e entrada como { valor, vencimento }. Aqui convertemos para ARRAY de parcelas.
    const entradaIn = req.body?.entrada || null;
    const parcelasIn = req.body?.parcelas || null;

    let parcelasArray = Array.isArray(parcelasIn) ? parcelasIn : null;

    // Parse de datas DD/MM/AAAA vindas do front
    const entradaVencDate = entradaIn?.vencimento ? parseDateDDMMYYYY(entradaIn.vencimento) : null;

    // Se parcelas vier como objeto, gerar array de parcelas
    if (!parcelasArray && parcelasIn && typeof parcelasIn === "object") {
      const qtd = Number(parcelasIn.quantidade || 0);
      const primeiroVenc = parseDateDDMMYYYY(parcelasIn.primeiroVencimento);

      if (qtd > 0 && primeiroVenc) {
        // valorTotal já vem em centavos do front (string digits) -> convertValueToDecimal cuida,
        // mas pra gerar parcelas vamos trabalhar em centavos para fechar exato.
        const totalCents = Number(onlyDigits(String(valorTotal || "")) || "0");

        // ENTRADA + PARCELAS: entrada é parcela 1, resto divide em qtd parcelas (número 2..)
        if (String(formaPagamento).toUpperCase() === "ENTRADA_PARCELAS") {
          const entradaCents = Number(onlyDigits(String(entradaIn?.valor || "")) || "0");

          parcelasArray = [];

          // parcela 1 = entrada
          if (entradaCents > 0 && entradaVencDate) {
            parcelasArray.push({
              numero: 1,
              vencimento: entradaVencDate,
              valorPrevisto: String(entradaCents), // em centavos (string digits)
            });
          }

          const restanteCents = Math.max(0, totalCents - entradaCents);
          const parts = splitCents(restanteCents, qtd);

          for (let i = 0; i < qtd; i++) {
            parcelasArray.push({
              numero: 2 + i,
              vencimento: addMonthsKeepDay(primeiroVenc, i),
              valorPrevisto: String(parts[i]),
            });
          }
        } else {
          // PARCELADO: divide total em qtd parcelas (número 1..)
          const parts = splitCents(totalCents, qtd);

          parcelasArray = [];
          for (let i = 0; i < qtd; i++) {
            parcelasArray.push({
              numero: 1 + i,
              vencimento: addMonthsKeepDay(primeiroVenc, i),
              valorPrevisto: String(parts[i]),
            });
          }
        }
      }
    }

    // ✅ FIX: À VISTA deve gerar 1 parcela automaticamente
    const fpNorm = String(formaPagamento || "").toUpperCase();
    if (fpNorm === "AVISTA" && (!parcelasArray || !Array.isArray(parcelasArray) || parcelasArray.length === 0)) {
      const avistaIn = req.body?.avista || null;
      const avistaVencDate = avistaIn?.vencimento ? parseDateDDMMYYYY(avistaIn.vencimento) : null;

      // valorTotal vem em centavos (string digits) do front; usamos centavos para fechar exato
      const totalCents = Number(onlyDigits(String(valorTotal || "")) || "0");

      parcelasArray = [{
        numero: 1,
        vencimento: avistaVencDate || new Date(),
        valorPrevisto: String(totalCents), // em centavos (string digits)
      }];
    }

    if (!clienteId || !valorTotal || !formaPagamento) {
      return res.status(400).json({
        message: "Campos obrigatórios: clienteId, valorTotal, formaPagamento",
      });
    }

    // ✅ Gerar número automaticamente
    let numeroFinal = numeroContrato;

    // dataBase permite lançamento retroativo
    // prioridade: data informada > hoje
    const dataBaseNumero =
      parcelas?.[0]?.vencimento ||
      req.body.dataContrato ||
      new Date();

    // G2: flag para geração automática dentro da transação (evita race condition)
    const autoGerarNumero = !numeroFinal || !numeroFinal.trim();

    if (!autoGerarNumero) {
      const contratoExistente = await prisma.contratoPagamento.findUnique({
        where: { numeroContrato: numeroFinal }, select: { id: true },
      });
      if (contratoExistente) {
        return res.status(400).json({
          message: `Já existe um contrato com o número ${numeroFinal}`,
        });
      }
    }

    // ✅ Converter valor corretamente
    const valorDecimal = convertValueToDecimal(valorTotal);

    console.log('💰 Conversão de valor:', {
      valorRecebido: valorTotal,
      valorConvertido: valorDecimal,
    });

    // Validar parcelas
    const fp = String(formaPagamento || "").toUpperCase();

    if (fp === "PARCELADO" || fp === "ENTRADA_PARCELAS") {
      if (!parcelasArray || !Array.isArray(parcelasArray) || parcelasArray.length === 0) {
        return res.status(400).json({
          message: "Contratos parcelados devem ter parcelas geradas",
        });
      }

      const somaParcelas = parcelasArray.reduce((sum, p) => {
        return sum + convertValueToDecimal(p.valorPrevisto);
      }, 0);

      console.log('📊 Validação de parcelas:', {
        valorTotal: valorDecimal,
        somaParcelas,
        diferenca: Math.abs(valorDecimal - somaParcelas),
      });

      if (Math.abs(valorDecimal - somaParcelas) > 0.01) {
        return res.status(400).json({
          message: `Soma das parcelas (${somaParcelas.toFixed(2)}) não fecha com o valor total (${valorDecimal.toFixed(2)})`,
        });
      }
    }

    // Preparar data de criação
    const dataParaCriar = {
      numeroContrato: numeroFinal,
      clienteId: parseInt(clienteId),
      valorTotal: valorDecimal,
      formaPagamento,
      observacoes,
      modeloDistribuicaoId: null,
      usaSplitSocio: false,
      repasseAdvogadoPrincipalId: null,
      repasseIndicacaoAdvogadoId: null,
      isentoTributacao: isentoTributacao || false,
      contratoOrigemId: contratoOrigemId ? parseInt(contratoOrigemId) : null,
    };

    // Adicionar parcelas se tiver
    if (parcelasArray && Array.isArray(parcelasArray) && parcelasArray.length > 0) {
      dataParaCriar.parcelas = {
        create: parcelasArray.map((parcela) => ({
          numero: parseInt(parcela.numero),
          vencimento: new Date(parcela.vencimento),
          valorPrevisto: convertValueToDecimal(parcela.valorPrevisto),
          status: "PREVISTA",
          modeloDistribuicaoId: null,
        })),
      };
    }

    // Criar contrato — G2: advisory lock garante serialização da geração de número
    const _contratoInclude = {
      cliente: { select: { id: true, cpfCnpj: true, nomeRazaoSocial: true, email: true, naoEnviarEmails: true } },
      parcelas: { orderBy: { numero: "asc" } },
    };
    const contrato = await prisma.$transaction(async (tx) => {
      if (autoGerarNumero) {
        // Lock de nível de transação — somente uma requisição gera e insere por vez
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(9876543210)`;
        dataParaCriar.numeroContrato = await gerarNumeroContrato(dataBaseNumero, tx);
        console.log("📝 Número gerado automaticamente:", dataParaCriar.numeroContrato);
      }
      return tx.contratoPagamento.create({ data: dataParaCriar, include: _contratoInclude });
    });

    console.log('✅ Contrato criado com sucesso:', {
      id: contrato.id,
      numero: contrato.numeroContrato,
      valorTotal: contrato.valorTotal,
      parcelas: contrato.parcelas?.length || 0,
    });

    // ============================================================
    // SINCRONIZAR PARCELAS COM LIVRO CAIXA
    // ============================================================
    if (contrato.parcelas && contrato.parcelas.length > 0) {
      console.log('📋 Sincronizando parcelas com Livro Caixa...');

      await prisma.$transaction(async (tx) => {
        await syncMultiplasParcelasComLivroCaixa(tx, contrato.parcelas, 'CRIAR');
      });

      console.log(`✅ ${contrato.parcelas.length} parcelas sincronizadas com Livro Caixa`);
    }

    // Aviso imediato ao cliente se parcelas estiverem dentro da janela de alerta
    _dispararAvisoImediatoParcelas(contrato).catch(() => {});

    res.status(201).json({
      message: "Contrato criado com sucesso!",
      contrato,
    });

  } catch (error) {
    console.error("❌ Erro ao criar contrato:", error);
    res.status(500).json({
      message: "Erro ao criar contrato.",
      error: error.message,
    });
  }
});

// ============================================================
// RENEGOCIAR CONTRATO (cria um contrato novo pelo saldo pendente)
// Endpoint esperado pelo front: POST /api/contratos/:id/renegociar
// ============================================================
router.post("/api/contratos/:id/renegociar", authenticate, async (req, res) => {
  try {
    const contratoId = Number(req.params.id);
    if (!contratoId || Number.isNaN(contratoId)) {
      return res.status(400).json({ message: "ID do contrato inválido." });
    }

    // 1) Busca contrato pai + parcelas
    const pai = await prisma.contratoPagamento.findUnique({
      where: { id: contratoId },
      include: {
        parcelas: true,
      },
    });

    if (!pai) {
      return res.status(404).json({ message: "Contrato original não encontrado." });
    }

    // Se já foi renegociado, bloqueia
    const jaTemFilho = await prisma.contratoPagamento.count({
      where: { contratoOrigemId: pai.id },
    });

    if (jaTemFilho > 0) {
      return res.status(400).json({ message: "Este contrato já foi renegociado." });
    }

    // 2) Calcula saldo pendente = soma das parcelas PREVISTAS (não canceladas)
    const parcelasPai = Array.isArray(pai.parcelas) ? pai.parcelas : [];
    const pendenteDecimal = parcelasPai
      .filter((p) => p.status === "PREVISTA")
      .reduce((acc, p) => acc + Number(p?.valorPrevisto || 0), 0);

    if (!pendenteDecimal || pendenteDecimal <= 0) {
      return res.status(400).json({ message: "Não há saldo pendente para renegociar." });
    }

    // 3) Lê payload do front
    const {
      clienteId,
      numeroContrato,
      formaPagamento,
      observacoes,
      avista,
      entrada,
      parcelas,
      // isentoTributacao vem omitido no modo renegociar no front, então ignoramos aqui
    } = req.body || {};

    if (!clienteId) {
      return res.status(400).json({ message: "clienteId é obrigatório." });
    }
    if (!numeroContrato || !String(numeroContrato).trim()) {
      return res.status(400).json({ message: "numeroContrato é obrigatório." });
    }

    const fp = String(formaPagamento || "").toUpperCase();
    if (!fp) {
      return res.status(400).json({ message: "formaPagamento é obrigatória." });
    }

    // 4) Monta contrato filho
    // valorTotal do filho deve ser o saldo pendente do pai (em reais)

    function normalizeRenegObs(txt, numeroOriginal) {
      const s = String(txt || "").trim();

      // remove qualquer linha anterior de renegociação (as duas versões)
      const cleaned = s
        .split("\n")
        .filter((line) => !/^Renegociação:\s+Este contrato (será|foi) criado a partir do saldo pendente do contrato/i.test(line.trim()))
        .join("\n")
        .trim();

      const finalLine =
        `Renegociação: Este contrato foi criado a partir do saldo pendente do contrato ${numeroOriginal}. ` +
        `Cliente, número e valor total são calculados automaticamente.`;

      return cleaned ? `${cleaned}\n\n${finalLine}` : finalLine;
    }

    const filhoData = {
      clienteId: Number(clienteId),
      numeroContrato: String(numeroContrato).trim(),
      formaPagamento: fp,
      valorTotal: pendenteDecimal,
      observacoes: normalizeRenegObs(observacoes, pai.numeroContrato),
      modeloDistribuicaoId: null,
      usaSplitSocio: false,
      repasseAdvogadoPrincipalId: null,
      repasseIndicacaoAdvogadoId: null,
      isentoTributacao: Boolean(pai.isentoTributacao),
      ativo: true,
      // mantém rastreio: depende do seu schema; não inventar campos novos
    };

    // 5) Geração de parcelas do contrato filho (reaproveita o mesmo padrão do POST /api/contratos)
    // Aceita: avista, parcelado, entrada+parcelas no mesmo formato que o front envia.
    // Aqui vamos transformar em "parcelasArray" e criar via nested create.
    let parcelasArray = null;

    // à vista => 1 parcela
    if (fp === "AVISTA") {
      const v = avista?.vencimento;
      const dt = parseDateDDMMYYYY(String(v || "")); // usa helper existente no server
      if (!dt) return res.status(400).json({ message: "Informe vencimento válido (DD/MM/AAAA) para o à vista." });

      // pendenteDecimal -> centavos para fechar exato
      const cents = Math.round(pendenteDecimal * 100);

      parcelasArray = [{
        numero: 1,
        vencimento: dt,
        valorPrevisto: String(cents), // em centavos (string digits)
      }];
    }

    // parcelado e entrada+parcelas: aceita objeto { quantidade, primeiroVencimento } ou array
    if (fp === "PARCELADO" || fp === "ENTRADA_PARCELAS") {
      const parcelasIn = parcelas;
      const entradaIn = entrada || null;

      // se já veio array, usa direto
      if (Array.isArray(parcelasIn)) {
        parcelasArray = parcelasIn;
      } else if (parcelasIn && typeof parcelasIn === "object") {
        const qtd = Number(parcelasIn.quantidade || 0);
        const primeiroVenc = parseDateDDMMYYYY(parcelasIn.primeiroVencimento);
        if (!qtd || qtd < 1) return res.status(400).json({ message: "Quantidade de parcelas inválida." });
        if (!primeiroVenc) return res.status(400).json({ message: "Primeiro vencimento inválido (DD/MM/AAAA)." });

        const totalCents = Math.round(pendenteDecimal * 100);

        if (fp === "ENTRADA_PARCELAS") {
          const entradaCents = Number(onlyDigits(String(entradaIn?.valor || "")) || "0");
          const vencEntrada = parseDateDDMMYYYY(entradaIn?.vencimento);
          if (!entradaCents || entradaCents <= 0) return res.status(400).json({ message: "Valor de entrada inválido." });
          if (!vencEntrada) return res.status(400).json({ message: "Vencimento da entrada inválido (DD/MM/AAAA)." });

          const restanteCents = Math.max(0, totalCents - entradaCents);
          const parts = splitCents(restanteCents, qtd);

          parcelasArray = [
            { numero: 1, vencimento: vencEntrada, valorPrevisto: String(entradaCents) },
            ...parts.map((c, i) => ({
              numero: 2 + i,
              vencimento: addMonthsKeepDay(primeiroVenc, i),
              valorPrevisto: String(c),
            })),
          ];
        } else {
          const parts = splitCents(totalCents, qtd);
          parcelasArray = parts.map((c, i) => ({
            numero: 1 + i,
            vencimento: addMonthsKeepDay(primeiroVenc, i),
            valorPrevisto: String(c),
          }));
        }
      }
    }

    if (!parcelasArray || !Array.isArray(parcelasArray) || parcelasArray.length === 0) {
      return res.status(400).json({ message: "Falha ao gerar parcelas da renegociação." });
    }

    // 6) Transação: cria filho, marca pai como renegociado e cancela parcelas previstas do pai
    const result = await prisma.$transaction(async (tx) => {
      const filho = await tx.contratoPagamento.create({
        data: {
          ...filhoData,
          contratoOrigemId: pai.id,

          parcelas: {
            create: parcelasArray.map((p) => ({
              numero: Number(p.numero),
              vencimento: new Date(p.vencimento),
              valorPrevisto: convertValueToDecimal(p.valorPrevisto),
              status: "PREVISTA",
            })),
          },
        },

        include: {
          parcelas: { orderBy: { numero: "asc" } },
          cliente: { select: { id: true, cpfCnpj: true, nomeRazaoSocial: true } },
          contratoOrigem: { select: { id: true, numeroContrato: true } },
          contratosFilhos: { select: { id: true, numeroContrato: true }, orderBy: { createdAt: "desc" } },
        }
      });

      // marca contrato pai como renegociado para o filho
      await tx.contratoPagamento.update({
        where: { id: pai.id },
        data: {
          ativo: false,
        },
      });

      // ============================================================
      // CANCELAR PARCELAS PREVISTAS DO PAI
      // ============================================================
      const parcelasPrevistas = await tx.parcelaContrato.findMany({
        where: {
          contratoId: pai.id,
          status: { in: ["PREVISTA", "PENDENTE"] },
        },
      });

      console.log(`📋 Renegociação: ${parcelasPrevistas.length} parcela(s) em aberto para cancelar`);

      // Cancelar cada parcela individualmente
      const parcelasCanceladas = [];
      const motivo = `Renegociado para o contrato ${filho.numeroContrato}`;

      for (const p of parcelasPrevistas) {
        const parcelaCancelada = await tx.parcelaContrato.update({
          where: { id: p.id },
          data: {
            status: "CANCELADA",
            canceladaEm: new Date(),
            cancelamentoMotivo: motivo,
            canceladaPorId: null,
          },
        });
        parcelasCanceladas.push(parcelaCancelada);
      }

      // SINCRONIZAR CANCELAMENTO COM LIVRO CAIXA
      console.log('📋 Cancelando lançamentos das parcelas antigas no Livro Caixa...');
      for (const parcela of parcelasCanceladas) {
        await syncParcelaComLivroCaixa(tx, parcela, 'CANCELAR');
      }
      console.log(`✅ ${parcelasCanceladas.length} lançamento(s) cancelado(s) no Livro Caixa`);

      // ============================================================
      // SINCRONIZAR NOVAS PARCELAS COM LIVRO CAIXA
      // ============================================================
      console.log('📋 Criando lançamentos das novas parcelas no Livro Caixa...');

      // Buscar parcelas recém-criadas do contrato filho
      const novasParcelas = await tx.parcelaContrato.findMany({
        where: { contratoId: filho.id },
        orderBy: { numero: 'asc' },
      });

      await syncMultiplasParcelasComLivroCaixa(tx, novasParcelas, 'CRIAR');
      console.log(`✅ ${novasParcelas.length} lançamento(s) criado(s) no Livro Caixa`);

      return filho;

    });

    // Aviso imediato ao cliente sobre as novas parcelas
    prisma.contratoPagamento.findUnique({
      where: { id: result.id },
      include: {
        cliente: { select: { id: true, nomeRazaoSocial: true, email: true, naoEnviarEmails: true } },
        parcelas: { orderBy: { numero: "asc" } },
      },
    }).then(c => { if (c) _dispararAvisoImediatoParcelas(c).catch(() => {}); }).catch(() => {});

    return res.json({ message: "Renegociação realizada com sucesso.", contrato: result });
  } catch (error) {
    console.error("❌ Erro ao renegociar contrato:", error);
    const msg = error?.message ? String(error.message) : "";
    return res.status(500).json({
      message: msg ? `Erro ao renegociar: ${msg}` : "Erro ao renegociar.",
    });
  }
});

// Atualizar contrato
router.put("/api/contratos/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      numeroContrato,
      valorTotal,
      formaPagamento,
      observacoes,
      isentoTributacao,
    } = req.body;

    const antes = await prisma.contratoPagamento.findUnique({ where: { id: parseInt(id) }, select: { numeroContrato: true, valorTotal: true, formaPagamento: true, observacoes: true, isentoTributacao: true } });

    const contrato = await prisma.contratoPagamento.update({
      where: { id: parseInt(id) },
      data: {
        numeroContrato,
        valorTotal: valorTotal ? convertValueToDecimal(valorTotal) : undefined,
        formaPagamento,
        observacoes,
        modeloDistribuicaoId: null,
        usaSplitSocio: false,
        repasseAdvogadoPrincipalId: null,
        repasseIndicacaoAdvogadoId: null,
        isentoTributacao,
      },
      include: {
        cliente: true,
        parcelas: { orderBy: { numero: "asc" } },
      },
    });

    logAuditoria(req, "EDITAR_CONTRATO", "ContratoPagamento", contrato.id, antes, { numeroContrato, valorTotal, formaPagamento, observacoes, isentoTributacao }).catch(() => {});

    res.json({
      message: "Contrato atualizado com sucesso!",
      contrato,
    });

  } catch (error) {
    console.error("Erro ao atualizar contrato:", error);
    res.status(500).json({ message: "Erro ao atualizar contrato." });
  }
});

// Desativar contrato
router.delete("/api/contratos/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.contratoPagamento.update({
      where: { id: parseInt(id) },
      data: { ativo: false },
    });
    logAuditoria(req, "DESATIVAR_CONTRATO", "ContratoPagamento", parseInt(id), { ativo: true }, { ativo: false }).catch(() => {});
    res.json({ message: "Contrato desativado com sucesso." });

  } catch (error) {
    console.error("Erro ao desativar contrato:", error);
    res.status(500).json({ message: "Erro ao desativar contrato." });
  }
});

export default router;
