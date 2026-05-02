// Read-only: conta registros nos models jurídicos remanescentes para
// orientar a Fase 3 (limpeza do schema). NÃO altera nada.
//
// Uso:
//   cd backend && node scripts/inspect-legal-models.js
// Ou via Render Shell:
//   node backend/scripts/inspect-legal-models.js

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MODELS = [
  // Família advogados / repasses (~13 models)
  "advogado",
  "modeloDistribuicao",
  "modeloDistribuicaoItem",
  "contratoRepasseSplitAdvogado",
  "parcelaSplitAdvogado",
  "parcelaRepasseOverride",
  "repasseCompetencia",
  "repasseLinha",
  "repasseLinhaAdvogado",
  "repassePagamento",
  "saldoDestinatario",
  "repasseSaldo",
  "repasseRealizado",
  "repasseLancamento",
  "repasseManualLancamento",
  // Família tributária
  "aliquota",
  // Família processual
  "processoJudicial",
  "processoAndamento",
  "intimacao",
];

async function main() {
  console.log("=== Inspeção de models jurídicos (Fase 3) ===\n");
  const results = [];
  let zeros = 0;
  let withData = 0;
  let missing = 0;

  for (const m of MODELS) {
    if (!prisma[m]) {
      console.log(`  • ${m.padEnd(40)} MODEL NÃO EXISTE NO CLIENT`);
      missing++;
      continue;
    }
    try {
      const n = await prisma[m].count();
      const tag = n === 0 ? "vazio" : `${n} registro(s)`;
      console.log(`  • ${m.padEnd(40)} ${tag}`);
      results.push({ model: m, count: n });
      if (n === 0) zeros++;
      else withData++;
    } catch (e) {
      console.log(`  • ${m.padEnd(40)} ERRO: ${e.message.slice(0, 80)}`);
      missing++;
    }
  }

  console.log("\n=== RESUMO ===");
  console.log(`  Vazios:            ${zeros}`);
  console.log(`  Com dados:         ${withData}`);
  console.log(`  Não existem/erro:  ${missing}`);
  console.log(`  Total:             ${MODELS.length}`);

  if (withData === 0) {
    console.log("\n✓ Seguro para Fase 3: nenhum model jurídico tem dados em produção.");
  } else {
    console.log("\n⚠ Atenção: há models com dados. Revisar antes de migration de remoção:");
    results.filter((r) => r.count > 0).forEach((r) => {
      console.log(`    - ${r.model}: ${r.count}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Falha na inspeção:", e);
  await prisma.$disconnect();
  process.exit(1);
});
