import { vi } from "vitest";

/**
 * Cria um mock de model Prisma que retorna valores sensatos por padrão.
 * Cada método é um vi.fn() configurável por teste.
 */
function makeModel() {
  return {
    findUnique:  vi.fn().mockResolvedValue(null),
    findFirst:   vi.fn().mockResolvedValue(null),
    findMany:    vi.fn().mockResolvedValue([]),
    create:      vi.fn().mockResolvedValue({}),
    update:      vi.fn().mockResolvedValue({}),
    upsert:      vi.fn().mockResolvedValue({}),
    delete:      vi.fn().mockResolvedValue({}),
    deleteMany:  vi.fn().mockResolvedValue({ count: 0 }),
    updateMany:  vi.fn().mockResolvedValue({ count: 0 }),
    count:       vi.fn().mockResolvedValue(0),
    aggregate:   vi.fn().mockResolvedValue({ _sum: {}, _count: {}, _avg: {} }),
    groupBy:     vi.fn().mockResolvedValue([]),
  };
}

// Instância singleton reutilizada em todos os testes do mesmo arquivo
export const prismaMock = {
  usuario:                          makeModel(),
  advogado:                         makeModel(),
  cliente:                          makeModel(),
  contratoPagamento:                makeModel(),
  parcelaContrato:                  makeModel(),
  repasseCompetencia:               makeModel(),
  repasseLinha:                     makeModel(),
  repasseLinhaAdvogado:             makeModel(),
  repassePagamento:                 makeModel(),
  repasseRealizado:                 makeModel(),
  repasseLancamento:                makeModel(),
  repasseManualLancamento:          makeModel(),
  repasseSaldo:                     makeModel(),
  saldoDestinatario:                makeModel(),
  livroCaixaLancamento:             makeModel(),
  livroCaixaConta:                  makeModel(),
  livroCaixaSaldoInicial:           makeModel(),
  mensagemChat:                     makeModel(),
  mensagemLeitura:                  makeModel(),
  presencaUsuario:                  makeModel(),
  auditoriaLog:                     makeModel(),
  aliquota:                         makeModel(),
  contaCorrenteCliente:             makeModel(),
  configEscritorio:                 makeModel(),
  whatsAppConversa:                 makeModel(),
  whatsAppMensagem:                 makeModel(),
  importacaoPdfSessao:              makeModel(),
  importacaoPdfLinha:               makeModel(),
  gmailPalavraChave:                makeModel(),
  comprovanteRespostaCliente:       makeModel(),
  comprovanteAnexo:                 makeModel(),
  agendaEvento:                     makeModel(),
  agendaParticipante:               makeModel(),
  agendaLembrete:                   makeModel(),
  emprestimoSocio:                  makeModel(),
  adiantamentoSocio:                makeModel(),
  whatsAppBotState:                 makeModel(),
  schedulerLock:                    makeModel(),
  contratoRepasseSplitAdvogado:     makeModel(),
  parcelaSplitAdvogado:             makeModel(),
  parcelaRepasseOverride:           makeModel(),

  $queryRaw:    vi.fn().mockResolvedValue([]),
  $executeRaw:  vi.fn().mockResolvedValue(0),
  $transaction: vi.fn().mockImplementation((arg) =>
    typeof arg === "function" ? arg(prismaMock) : Promise.all(arg)
  ),
  $disconnect:  vi.fn().mockResolvedValue(undefined),
};

/** Reseta todos os mocks entre testes */
export function resetPrismaMock() {
  for (const model of Object.values(prismaMock)) {
    if (model && typeof model === "object" && !["$queryRaw","$executeRaw","$transaction","$disconnect"].includes(model)) {
      Object.values(model).forEach(fn => { if (typeof fn?.mockReset === "function") fn.mockReset(); });
    }
  }
  [prismaMock.$queryRaw, prismaMock.$executeRaw, prismaMock.$transaction, prismaMock.$disconnect]
    .forEach(fn => { if (typeof fn?.mockReset === "function") fn.mockReset(); });

  // Re-aplica defaults após reset
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$executeRaw.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation((arg) =>
    typeof arg === "function" ? arg(prismaMock) : Promise.all(arg)
  );
  prismaMock.$disconnect.mockResolvedValue(undefined);
}
