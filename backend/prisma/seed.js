import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function seedAdminInicial() {
  const email = String(process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.SEED_ADMIN_PASSWORD || "");
  const nome = String(process.env.SEED_ADMIN_NAME || "Administrador Addere").trim();
  const shouldReset = String(process.env.SEED_ADMIN_RESET || "").toLowerCase() === "true";

  const adminCount = await prisma.usuario.count({ where: { role: "ADMIN" } });
  console.log(`  Seed admin: email=${email ? "configurado" : "nao configurado"}, senha=${password ? "configurada" : "nao configurada"}, admins=${adminCount}, reset=${shouldReset}`);

  if (!email || !password) {
    if (adminCount === 0) {
      console.warn("  Nenhum admin inicial criado. Configure SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no ambiente.");
    } else {
      console.log(`  Admin inicial nao configurado; ${adminCount} admin(s) ja existem.`);
    }
    return;
  }

  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD deve ter no minimo 8 caracteres.");
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  const senhaHash = !existente || shouldReset ? await bcrypt.hash(password, 10) : null;

  if (existente) {
    await prisma.usuario.update({
      where: { id: existente.id },
      data: {
        nome: existente.nome || nome,
        role: "ADMIN",
        tipoUsuario: existente.tipoUsuario || "USUARIO",
        ativo: true,
        ...(senhaHash ? { senhaHash, deveTrocarSenha: true } : {}),
      },
    });
    console.log(`  Admin ${email} atualizado${senhaHash ? " com nova senha" : ""}.`);
    return;
  }

  await prisma.usuario.create({
    data: {
      nome,
      email,
      senhaHash,
      role: "ADMIN",
      tipoUsuario: "USUARIO",
      ativo: true,
      deveTrocarSenha: true,
    },
  });
  console.log(`  Admin ${email} criado.`);
}

function normalizarNomeConta(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizarContaKey(conta) {
  let nome = normalizarNomeConta(conta.nome);

  nome = nome
    .replace(/^APLICACAO\s+/, "APL ")
    .replace(/^APLIC\s+/, "APL ")
    .replace(/^AP\s+/, "APL ")
    .replace(/^BANCO\s+INTER$/, "INTER")
    .replace(/^C6$/, "C6 BANK");

  const tipo = String(conta.tipo || "").trim().toUpperCase();
  return `${tipo}|${nome}`;
}

function historicoEhRendimento(valor) {
  return normalizarNomeConta(valor).startsWith("RENDIMENTO");
}

function escolherContaPrincipal(key, contas) {
  const ordenadas = [...contas].sort((a, b) => a.id - b.id);
  const porNome = (nome) => ordenadas.find((conta) => normalizarNomeConta(conta.nome) === nome);

  if (key === "BANCO|C6 BANK") {
    return porNome("C6 BANK") || porNome("C6") || ordenadas[0];
  }

  if (key === "BANCO|INTER") {
    return porNome("BANCO INTER") || porNome("INTER") || ordenadas[0];
  }

  if (key === "APLICACAO|APL INTER") {
    return porNome("APL INTER") || porNome("APLICACAO INTER") || ordenadas[0];
  }

  if (key === "APLICACAO|APL C6") {
    return porNome("APL C6") || porNome("APLICACAO C6") || ordenadas[0];
  }

  return ordenadas[0];
}

async function atualizarNomesContasPadrao() {
  const contas = await prisma.livroCaixaConta.findMany({
    orderBy: { id: "asc" },
  });

  const padroes = [
    { key: "BANCO|C6 BANK", nome: "C6 Bank", tipo: "BANCO", ordem: 3 },
    { key: "APLICACAO|APL INTER", nome: "Apl Inter", tipo: "APLICACAO", ordem: 4 },
    { key: "APLICACAO|APL C6", nome: "Apl C6", tipo: "APLICACAO", ordem: 5 },
    { key: "BANCO|INTER", nome: "Banco Inter", tipo: "BANCO", ordem: 6 },
  ];

  for (const padrao of padroes) {
    const grupo = contas.filter((conta) => normalizarContaKey(conta) === padrao.key);

    if (grupo.length === 0) {
      await prisma.livroCaixaConta.create({
        data: {
          nome: padrao.nome,
          tipo: padrao.tipo,
          ordem: padrao.ordem,
          ativa: true,
          dataInicial: new Date("2026-01-01T12:00:00.000Z"),
          saldoInicialCent: 0,
        },
      });
      console.log(`  Conta ${padrao.nome} criada.`);
      continue;
    }

    const principal = escolherContaPrincipal(padrao.key, grupo);
    if (principal.nome !== padrao.nome || principal.tipo !== padrao.tipo || principal.ordem !== padrao.ordem) {
      await prisma.livroCaixaConta.update({
        where: { id: principal.id },
        data: { nome: padrao.nome, tipo: padrao.tipo, ordem: padrao.ordem },
      });
      console.log(`  Conta #${principal.id} ajustada para ${padrao.nome} (ordem ${padrao.ordem}).`);
    }
  }
}

async function buscarContaPorKey(key) {
  const contas = await prisma.livroCaixaConta.findMany({
    orderBy: { id: "asc" },
  });
  const grupo = contas.filter((conta) => normalizarContaKey(conta) === key);
  return grupo.length ? escolherContaPrincipal(key, grupo) : null;
}

async function corrigirLancamentosC6Bank2024() {
  const contaC6Bank = await buscarContaPorKey("BANCO|C6 BANK");

  if (!contaC6Bank) {
    console.warn("  Conta C6 Bank nao encontrada; correcao dos lancamentos de 2024 ignorada.");
    return;
  }

  const lancamentos = await prisma.livroCaixaLancamento.findMany({
    where: {
      competenciaAno: 2024,
      competenciaMes: { in: [1, 2, 3, 4, 5, 6] },
      localLabelFallback: { not: null },
    },
    select: { id: true, localLabelFallback: true, contaId: true },
  });

  const ids = lancamentos
    .filter((lancamento) => ["C6", "C6 BANK"].includes(normalizarNomeConta(lancamento.localLabelFallback)))
    .filter((lancamento) => lancamento.contaId !== contaC6Bank.id || normalizarNomeConta(lancamento.localLabelFallback) !== "C6 BANK")
    .map((lancamento) => lancamento.id);

  if (ids.length === 0) {
    console.log("  Lancamentos 2024 Local=C6 ja estao em C6 Bank.");
    return;
  }

  await prisma.livroCaixaLancamento.updateMany({
    where: { id: { in: ids } },
    data: {
      contaId: contaC6Bank.id,
      localLabelFallback: "C6 Bank",
      status: "OK",
    },
  });
  console.log(`  Lancamentos 2024 Local=C6 atualizados para C6 Bank: ${ids.length}.`);
}

async function corrigirLancamentosAplInter2024() {
  const contaBancoInter = await buscarContaPorKey("BANCO|INTER");
  const contaAplInter = await buscarContaPorKey("APLICACAO|APL INTER");

  if (!contaBancoInter || !contaAplInter) {
    console.warn("  Banco Inter ou Apl Inter nao encontrado; correcao dos lancamentos Apl Inter de 2024 ignorada.");
    return;
  }

  const lancamentos = await prisma.livroCaixaLancamento.findMany({
    where: {
      competenciaAno: 2024,
      competenciaMes: { in: [1, 2, 3, 4, 5, 6] },
      localLabelFallback: { not: null },
    },
    select: { id: true, localLabelFallback: true, historico: true, contaId: true },
  });

  const locaisAplInter = new Set(["APL INTER", "APLICACAO INTER"]);
  const alvos = lancamentos.filter((lancamento) => locaisAplInter.has(normalizarNomeConta(lancamento.localLabelFallback)));
  const idsBancoInter = alvos
    .filter((lancamento) => !historicoEhRendimento(lancamento.historico))
    .filter((lancamento) => lancamento.contaId !== contaBancoInter.id || normalizarNomeConta(lancamento.localLabelFallback) !== "BANCO INTER")
    .map((lancamento) => lancamento.id);
  const idsAplInter = alvos
    .filter((lancamento) => historicoEhRendimento(lancamento.historico))
    .filter((lancamento) => lancamento.contaId !== contaAplInter.id || normalizarNomeConta(lancamento.localLabelFallback) !== "APL INTER")
    .map((lancamento) => lancamento.id);

  if (idsBancoInter.length > 0) {
    await prisma.livroCaixaLancamento.updateMany({
      where: { id: { in: idsBancoInter } },
      data: {
        contaId: contaBancoInter.id,
        localLabelFallback: "Banco Inter",
        status: "OK",
      },
    });
  }

  if (idsAplInter.length > 0) {
    await prisma.livroCaixaLancamento.updateMany({
      where: { id: { in: idsAplInter } },
      data: {
        contaId: contaAplInter.id,
        localLabelFallback: "Apl Inter",
        status: "OK",
      },
    });
  }

  console.log(`  Lancamentos 2024 Local=Apl Inter atualizados: Banco Inter=${idsBancoInter.length}, Apl Inter=${idsAplInter.length}.`);
}

async function deduplicarContasContabeis() {
  const contas = await prisma.livroCaixaConta.findMany({
    orderBy: { id: "asc" },
  });
  const grupos = new Map();

  for (const conta of contas) {
    const key = normalizarContaKey(conta);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(conta);
  }

  for (const [key, grupo] of grupos.entries()) {
    if (grupo.length < 2) continue;

    const principal = escolherContaPrincipal(key, grupo);
    const duplicadas = grupo.filter((conta) => conta.id !== principal.id);

    for (const duplicada of duplicadas) {
      await prisma.$transaction([
        prisma.livroCaixaLancamento.updateMany({ where: { contaId: duplicada.id }, data: { contaId: principal.id } }),
        prisma.pixPagamento.updateMany({ where: { contaId: duplicada.id }, data: { contaId: principal.id } }),
        prisma.pagamentoBoleto.updateMany({ where: { contaId: duplicada.id }, data: { contaId: principal.id } }),
        prisma.pagamentoDarf.updateMany({ where: { contaId: duplicada.id }, data: { contaId: principal.id } }),
        prisma.livroCaixaConta.delete({ where: { id: duplicada.id } }),
      ]);
      console.log(`  Conta duplicada removida: ${duplicada.nome} (${duplicada.tipo}) -> #${principal.id}`);
    }
  }
}

async function main() {
  console.log("Iniciando seed do Addere Control...");

  await seedAdminInicial();

  const contasAddere = [
    { nome: "Caixa Administrativo", tipo: "CAIXA", ordem: 1 },
    { nome: "Caixa Geral", tipo: "CAIXA", ordem: 2 },
    { nome: "C6 Bank", tipo: "BANCO", ordem: 3 },
    { nome: "Apl Inter", tipo: "APLICACAO", ordem: 4 },
    { nome: "Apl C6", tipo: "APLICACAO", ordem: 5 },
    { nome: "Banco Inter", tipo: "BANCO", ordem: 6 },
    { nome: "Banco VRDE", tipo: "BANCO", ordem: 8 },
    { nome: "InfinitePay", tipo: "BANCO", ordem: 9 },
  ];

  const contasExistentes = await prisma.livroCaixaConta.count();
  if (contasExistentes === 0) {
    for (const conta of contasAddere) {
      await prisma.livroCaixaConta.create({
        data: {
          ...conta,
          ativa: true,
          dataInicial: new Date("2026-01-01T12:00:00.000Z"),
          saldoInicialCent: 0,
        },
      });
      console.log(`  Conta ${conta.nome} criada.`);
    }
  } else {
    console.log(`  ${contasExistentes} conta(s) existentes; seed de contas padrao ignorado.`);
  }

  await atualizarNomesContasPadrao();
  await deduplicarContasContabeis();
  await corrigirLancamentosC6Bank2024();
  await corrigirLancamentosAplInter2024();

  const cfg = await prisma.configEscritorio.findFirst();
  const configData = {
    nome: "Addere",
    nomeFantasia: "Addere",
    cnpj: "48.744.127/0001-41",
    oabRegistro: "",
    logradouro: "Rua Antônio Barreto",
    numero: "130",
    complemento: "Sala 1403",
    bairro: "Umarizal",
    cidade: "Belém",
    estado: "PA",
    cep: "66055-050",
  };

  if (cfg) {
    await prisma.configEscritorio.update({
      where: { id: cfg.id },
      data: configData,
    });
  } else {
    await prisma.configEscritorio.create({ data: configData });
  }

  console.log("  Modelos de distribuição não são semeados na Addere.");

  console.log("Seed concluído com sucesso.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
