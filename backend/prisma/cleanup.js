// prisma/cleanup.js — apaga todos os dados exceto tabelas de configuração
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function cleanup() {
  console.log("🧹 Iniciando limpeza do banco de dados...\n");

  const steps = [
    // Chat / presença
    ["MensagemLeitura",              () => prisma.mensagemLeitura.deleteMany()],
    ["PresencaUsuario",              () => prisma.presencaUsuario.deleteMany()],
    ["MensagemChat",                 () => prisma.mensagemChat.deleteMany()],

    // Repasse — detalhes antes dos agrupadores
    ["RepasseLinhaAdvogado",         () => prisma.repasseLinhaAdvogado.deleteMany()],
    ["ParcelaSplitAdvogado",         () => prisma.parcelaSplitAdvogado.deleteMany()],
    ["ContratoRepasseSplitAdvogado", () => prisma.contratoRepasseSplitAdvogado.deleteMany()],
    ["RepasseLancamento",            () => prisma.repasseLancamento.deleteMany()],
    ["RepasseManualLancamento",      () => prisma.repasseManualLancamento.deleteMany()],
    ["SaldoDestinatario",            () => prisma.saldoDestinatario.deleteMany()],
    ["RepasseSaldo",                 () => prisma.repasseSaldo.deleteMany()],
    ["EmprestimoSocio",              () => prisma.emprestimoSocio.deleteMany()],
    ["RepasseLinha",                 () => prisma.repasseLinha.deleteMany()],
    ["RepassePagamento",             () => prisma.repassePagamento.deleteMany()],
    ["RepasseRealizado",             () => prisma.repasseRealizado.deleteMany()],
    ["RepasseCompetencia",           () => prisma.repasseCompetencia.deleteMany()],

    // Contratos / parcelas
    ["ParcelaContrato",              () => prisma.parcelaContrato.deleteMany()],
    ["ContratoPagamento",            () => prisma.contratoPagamento.deleteMany()],

    // Conta corrente de clientes
    ["ContaCorrenteCliente",         () => prisma.contaCorrenteCliente.deleteMany()],

    // Livro Caixa (lançamentos e saldo global — contas contábeis são mantidas)
    ["LivroCaixaLancamento",         () => prisma.livroCaixaLancamento.deleteMany()],
    ["LivroCaixaSaldoInicial",       () => prisma.livroCaixaSaldoInicial.deleteMany()],
  ];

  for (const [label, fn] of steps) {
    try {
      const result = await fn();
      console.log(`  ✅ ${label}: ${result.count} registro(s) removido(s)`);
    } catch (err) {
      console.error(`  ❌ ${label}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log("\n✅ Limpeza concluída!");
  console.log("📌 Mantidos: Usuários · Advogados · Clientes · Modelos de Distribuição · Itens · Alíquotas · Contas Contábeis\n");
}

cleanup()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
