// These functions receive a Prisma transaction client (tx) as parameter.
// They do NOT import the prisma singleton directly.

export function toCentsFromDecimal(v) {
  if (v === null || v === undefined) return 0;

  // Se já for número
  if (typeof v === "number") {
    return Math.round(v * 100);
  }

  // Se for string (Prisma Decimal vem como string em JSON)
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return 0;

  return Math.round(n * 100);
}

export async function loadContratoChainJSON(tx, contratoId) {
  const visited = new Set();
  const chain = [];

  async function walk(id) {
    const nid = Number(id);
    if (!nid || visited.has(nid)) return;
    visited.add(nid);

    const contrato = await tx.contratoPagamento.findUnique({
      where: { id: nid },
      include: {
        cliente: {
          select: {
            id: true,
            nomeRazaoSocial: true,
            cpfCnpj: true
          }
        },
        parcelas: {
          orderBy: { numero: "asc" },
          select: {
            id: true,
            numero: true,
            vencimento: true,
            dataRecebimento: true,
            valorPrevisto: true,
            valorRecebido: true,
            status: true,
            meioRecebimento: true,
            canceladaEm: true,
            canceladaPorId: true,
            cancelamentoMotivo: true,
          },
        },
        contratosFilhos: {
          select: {
            id: true,
            numeroContrato: true,
            createdAt: true
          },
          orderBy: { createdAt: "asc" },
        },
        contratoOrigem: {
          select: {
            id: true,
            numeroContrato: true
          },
        },
      },
    });

    // --- NÃO ALTERAR: contrato.observacoes será usado para extrair retificações ---

    if (!contrato) return;

    // Calcula resumo financeiro
    const resumo = calcResumoContratoJSON(contrato);

    // Monta objeto do contrato
    // Extrair retificações do campo observacoes
    const retificacoes = [];
    const obsStr = String(contrato.observacoes || "");
    const reLines = obsStr.split("\n").filter((l) => l.includes("[RETIFICAÇÃO"));
    for (const line of reLines) {
      const m = line.match(/\[RETIFICAÇÃO\s+(.+?)\]\s*(.*)/);
      if (m) retificacoes.push({ data: m[1].trim(), motivo: m[2].trim() });
    }

    const contratoObj = {
      id: contrato.id,
      numero: contrato.numeroContrato,
      valorTotal: toCentsFromDecimal(contrato.valorTotal),
      dataAssinatura: contrato.dataAssinatura,
      isRenegociacao: !!contrato.contratoOrigemId,
      contratoOrigemId: contrato.contratoOrigemId,
      contratoOrigemNumero: contrato.contratoOrigem?.numeroContrato || null,
      createdAt: contrato.createdAt,
      resumo,
      retificacoes,
      parcelas: contrato.parcelas.map((p) => ({
        id: p.id,
        numero: p.numero,
        dataVencimento: p.vencimento,
        dataRecebimento: p.dataRecebimento,
        valorPrevisto: toCentsFromDecimal(p.valorPrevisto),
        valorRecebido: toCentsFromDecimal(p.valorRecebido),
        status: p.status,
        meioRecebimento: p.meioRecebimento,
        canceladaEm: p.canceladaEm,
        canceladaPorId: p.canceladaPorId,
        cancelamentoMotivo: p.cancelamentoMotivo,
      })),
      quantidadeFilhos: contrato.contratosFilhos?.length || 0,
    };

    chain.push(contratoObj);

    // Recursão nos filhos (renegociações)
    for (const filho of contrato.contratosFilhos || []) {
      await walk(filho.id);
    }
  }

  await walk(contratoId);
  return chain;
}

export function calcResumoContratoJSON(contrato) {
  const parcelas = contrato?.parcelas || [];

  // Helpers
  const isPago = (st) => st === "RECEBIDA" || st === "REPASSE_EFETUADO";
  const isCancelado = (p) => p.status === "CANCELADA" || !!p.canceladaEm;

  // Filtra parcelas por status
  const pagos = parcelas.filter((p) => isPago(p.status));
  const cancelados = parcelas.filter((p) => isCancelado(p));
  const emAberto = parcelas.filter((p) => !isPago(p.status) && !isCancelado(p));

  // Soma valores
  const sum = (arr, field) =>
    arr.reduce((acc, p) => acc + toCentsFromDecimal(p?.[field]), 0);

  // Totais
  const totalContrato = toCentsFromDecimal(contrato?.valorTotal);

  // Pagos: preferir valorRecebido; se não tiver, usar valorPrevisto
  const totalPagoRecebido = sum(pagos, "valorRecebido");
  const totalPagoPrevisto = sum(pagos, "valorPrevisto");
  const totalPago = totalPagoRecebido || totalPagoPrevisto;

  const totalEmAberto = sum(emAberto, "valorPrevisto");
  const totalCancelado = sum(cancelados, "valorPrevisto");

  // Percentuais
  const percPago = totalContrato > 0
    ? Math.round((totalPago / totalContrato) * 100)
    : 0;

  const percEmAberto = totalContrato > 0
    ? Math.round((totalEmAberto / totalContrato) * 100)
    : 0;

  return {
    totalContrato,
    totalPago,
    totalEmAberto,
    totalCancelado,
    percPago,
    percEmAberto,
    qtdParcelas: parcelas.length,
    qtdParcelasPagas: pagos.length,
    qtdParcelasEmAberto: emAberto.length,
    qtdParcelasCanceladas: cancelados.length,
  };
}

/**
 * Sincroniza uma parcela com o Livro Caixa
 *
 * @param {PrismaTransaction} tx - Transação do Prisma
 * @param {Object} parcela - Objeto da parcela com todos os dados
 * @param {String} operacao - Tipo de operação: 'CRIAR' | 'ATUALIZAR' | 'PAGAR' | 'CANCELAR'
 * @param {Object} opcoes - Opções adicionais (opcional)
 * @returns {Promise<Object>} Lançamento criado/atualizado ou null
 */
export async function syncParcelaComLivroCaixa(tx, parcela, operacao, opcoes = {}) {
  try {
    console.log(`📋 Sync Livro Caixa: Parcela ${parcela.id} - Operação: ${operacao}`);

    // ============================================================
    // VALIDAÇÕES
    // ============================================================
    if (!parcela || !parcela.id) {
      console.error('❌ Sync: Parcela inválida', parcela);
      return null;
    }

    if (!['CRIAR', 'ATUALIZAR', 'PAGAR', 'CANCELAR'].includes(operacao)) {
      console.error('❌ Sync: Operação inválida', operacao);
      return null;
    }

    // ============================================================
    // HELPERS
    // ============================================================
    const toCents = (value) => {
      if (value === null || value === undefined) return 0;
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n)) return 0;
      return Math.round(n * 100);
    };

    // ============================================================
    // 1. BUSCAR LANÇAMENTO EXISTENTE
    // ============================================================
    const lancamentoExistente = await tx.livroCaixaLancamento.findFirst({
      where: {
        origem: 'PARCELA_PREVISTA',
        referenciaOrigem: String(parcela.id),
      },
    });

    console.log(`📋 Lançamento existente: ${lancamentoExistente ? 'SIM (ID: ' + lancamentoExistente.id + ')' : 'NÃO'}`);

    // ============================================================
    // 2. BUSCAR DADOS DO CONTRATO (necessário para histórico)
    // ============================================================
    const contrato = await tx.contratoPagamento.findUnique({
      where: { id: parcela.contratoId },
      include: {
        cliente: {
          select: {
            id: true,
            nomeRazaoSocial: true,
          },
        },
        parcelas: {
          select: { id: true },
        },
      },
    });

    if (!contrato) {
      console.error('❌ Sync: Contrato não encontrado', parcela.contratoId);
      return null;
    }

    // ============================================================
    // 3. OPERAÇÃO: CANCELAR
    // ============================================================
    if (operacao === 'CANCELAR') {
      // Remove todos os lançamentos PREVISTO desta parcela.
      // Cobre ambos os formatos de referenciaOrigem ("123" e "PARCELA_123")
      // sem filtrar por origem — garante limpeza independente do caminho
      // que criou o LC (syncParcelaComLivroCaixa, wizard, poller etc.).
      const { count } = await tx.livroCaixaLancamento.deleteMany({
        where: {
          statusFluxo: "PREVISTO",
          referenciaOrigem: { in: [String(parcela.id), `PARCELA_${parcela.id}`] },
        },
      });
      if (count > 0) {
        console.log(`✅ Sync: ${count} lançamento(s) PREVISTO cancelado(s)`);
      } else {
        console.log('⚠️ Sync: Nenhum lançamento PREVISTO para cancelar');
      }
      return { operacao: 'CANCELADO', count };
    }

    // ============================================================
    // 4. OPERAÇÃO: PAGAR
    // ============================================================
    if (operacao === 'PAGAR') {
      const dataRecebimento = parcela.dataRecebimento || new Date();
      const valorRecebido = toCents(parcela.valorRecebido || parcela.valorPrevisto);
      const historicoStr = `Parcela ${parcela.numero}/${contrato.parcelas.length} - ${contrato.numeroContrato} - PAGA`;

      if (!lancamentoExistente) {
        // Parcela antiga (sem lançamento PREVISTO vinculado) — cria diretamente como EFETIVADO
        console.log('⚠️ Sync: Lançamento PREVISTO não encontrado — criando EFETIVADO diretamente');
        const novoLancamento = await tx.livroCaixaLancamento.create({
          data: {
            competenciaAno: dataRecebimento.getFullYear(),
            competenciaMes: dataRecebimento.getMonth() + 1,
            data: dataRecebimento,
            es: 'E',
            clienteFornecedor: contrato.cliente?.nomeRazaoSocial || null,
            historico: historicoStr,
            valorCentavos: valorRecebido,
            contaId: null,
            ordemDia: 0,
            origem: 'PARCELA_PREVISTA',
            referenciaOrigem: String(parcela.id),
            status: 'OK',
            statusFluxo: 'EFETIVADO',
          },
        });
        console.log('✅ Sync: Lançamento EFETIVADO criado (fallback)');
        return novoLancamento;
      }

      // Atualiza para EFETIVADO — competência segue a data de pagamento
      const lancamentoAtualizado = await tx.livroCaixaLancamento.update({
        where: { id: lancamentoExistente.id },
        data: {
          statusFluxo: 'EFETIVADO',
          data: dataRecebimento,
          competenciaAno: dataRecebimento.getFullYear(),
          competenciaMes: dataRecebimento.getMonth() + 1,
          valorCentavos: valorRecebido,
          historico: historicoStr,
        },
      });

      console.log('✅ Sync: Lançamento atualizado para EFETIVADO');
      return lancamentoAtualizado;
    }

    // ============================================================
    // 5. OPERAÇÃO: ATUALIZAR
    // ============================================================
    if (operacao === 'ATUALIZAR') {
      if (!lancamentoExistente) {
        console.warn('⚠️ Sync: Lançamento não encontrado para atualizar, criando novo');
        operacao = 'CRIAR'; // Fallback: cria se não existir
      } else {
        // Atualiza dados do lançamento previsto
        const dataVencimento = parcela.vencimento || new Date();
        const valorPrevisto = toCents(parcela.valorPrevisto);

        const lancamentoAtualizado = await tx.livroCaixaLancamento.update({
          where: { id: lancamentoExistente.id },
          data: {
            data: dataVencimento,
            valorCentavos: valorPrevisto,
            competenciaAno: dataVencimento.getFullYear(),
            competenciaMes: dataVencimento.getMonth() + 1,
            historico: `Parcela ${parcela.numero}/${contrato.parcelas.length} - ${contrato.numeroContrato}${opcoes.motivoRetificacao ? ' - RETIFICADO: ' + opcoes.motivoRetificacao : ''}`,
          },
        });

        console.log('✅ Sync: Lançamento atualizado (valores/datas)');
        return lancamentoAtualizado;
      }
    }

    // ============================================================
    // 6. OPERAÇÃO: CRIAR
    // ============================================================
    if (operacao === 'CRIAR') {
      if (lancamentoExistente) {
        console.warn('⚠️ Sync: Lançamento já existe, pulando criação');
        return lancamentoExistente;
      }

      // Prepara dados
      const dataVencimento = parcela.vencimento || new Date();
      const valorPrevisto = toCents(parcela.valorPrevisto);

      const novoLancamento = await tx.livroCaixaLancamento.create({
        data: {
          competenciaAno: dataVencimento.getFullYear(),
          competenciaMes: dataVencimento.getMonth() + 1,
          data: dataVencimento,
          documento: contrato.numeroContrato || `CONTRATO-${contrato.id}`,
          es: 'E', // Entrada (recebimento de cliente)
          clienteFornecedor: contrato.cliente?.nomeRazaoSocial || 'Cliente',
          historico: `Parcela ${parcela.numero}/${contrato.parcelas.length} - ${contrato.numeroContrato}`,
          valorCentavos: valorPrevisto,
          contaId: null, // Sem conta específica (previsão)
          ordemDia: 0,
          origem: 'PARCELA_PREVISTA',
          referenciaOrigem: String(parcela.id),
          status: 'OK',
          statusFluxo: 'PREVISTO',
        },
      });

      console.log('✅ Sync: Novo lançamento criado (PREVISTO)');
      return novoLancamento;
    }

    return null;

  } catch (error) {
    console.error('❌ Erro ao sincronizar parcela com Livro Caixa:', error);
    throw error; // Propaga erro para não commit transação
  }
}

/**
 * Sincroniza múltiplas parcelas de uma vez
 * Útil para renegociações e criação de contratos
 */
export async function syncMultiplasParcelasComLivroCaixa(tx, parcelas, operacao, opcoes = {}) {
  console.log(`📋 Sync Múltiplas: ${parcelas.length} parcelas - Operação: ${operacao}`);

  const resultados = [];

  for (const parcela of parcelas) {
    try {
      const resultado = await syncParcelaComLivroCaixa(tx, parcela, operacao, opcoes);
      resultados.push(resultado);
    } catch (error) {
      console.error(`❌ Erro ao sincronizar parcela ${parcela.id}:`, error);
      throw error; // Para a transação em caso de erro
    }
  }

  console.log(`✅ Sync Múltiplas: ${resultados.filter(r => r).length} lançamentos sincronizados`);
  return resultados;
}
