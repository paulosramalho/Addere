import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function seedAdminInicial() {
  const email = String(process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.SEED_ADMIN_PASSWORD || "");
  const nome = String(process.env.SEED_ADMIN_NAME || "Administrador Addere").trim();
  const shouldReset = String(process.env.SEED_ADMIN_RESET || "").toLowerCase() === "true";

  const adminCount = await prisma.usuario.count({ where: { role: "ADMIN" } });

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

async function main() {
  console.log("Iniciando seed do Addere Control...");

  await seedAdminInicial();

  const contasAddere = [
    { nome: "Caixa Administrativo", tipo: "CAIXA", ordem: 1 },
    { nome: "Caixa Geral", tipo: "CAIXA", ordem: 2 },
    { nome: "C6", tipo: "BANCO", ordem: 3 },
    { nome: "Aplicação Inter", tipo: "APLICACAO", ordem: 4 },
    { nome: "Aplicação C6", tipo: "APLICACAO", ordem: 5 },
    { nome: "Banco Inter", tipo: "BANCO", ordem: 6 },
    { nome: "C6 Bank", tipo: "BANCO", ordem: 7 },
    { nome: "Banco VRDE", tipo: "BANCO", ordem: 8 },
    { nome: "InfinitePay", tipo: "BANCO", ordem: 9 },
  ];

  for (const conta of contasAddere) {
    const existente = await prisma.livroCaixaConta.findFirst({
      where: { nome: conta.nome },
    });

    const data = {
      ...conta,
      ativa: true,
      dataInicial: new Date("2026-01-01T12:00:00.000Z"),
      saldoInicialCent: 0,
    };

    if (existente) {
      await prisma.livroCaixaConta.update({
        where: { id: existente.id },
        data,
      });
      console.log(`  Conta ${conta.nome} atualizada.`);
    } else {
      await prisma.livroCaixaConta.create({ data });
      console.log(`  Conta ${conta.nome} criada.`);
    }
  }

  const cfg = await prisma.configEscritorio.findFirst();
  const configData = {
    nome: "Addere On Comunicação, Treinamentos e Eventos Corporativos",
    nomeFantasia: "Addere",
    cidade: "São Paulo",
    estado: "SP",
  };

  if (cfg) {
    await prisma.configEscritorio.update({
      where: { id: cfg.id },
      data: configData,
    });
  } else {
    await prisma.configEscritorio.create({ data: configData });
  }

  // Modelos de distribuição A–G (planilha Addere)
  // Estrutura: ModeloDistribuicao (cabeçalho) + ModeloDistribuicaoItem (linhas)
  const modelos = [
    {
      codigo: "A",
      descricao: "Escritório / Incidental",
      itens: [
        { ordem: 1, origem: "ESCRITÓRIO", periodicidade: "INCIDENTAL", destinoTipo: "FUNDO",    destinatario: "FUNDO DE RESERVA", percentualBp: 30 },
        { ordem: 2, origem: "ESCRITÓRIO", periodicidade: "INCIDENTAL", destinoTipo: "SOCIO",    destinatario: "SÓCIO",            percentualBp: 30 },
        { ordem: 3, origem: "ESCRITÓRIO", periodicidade: "INCIDENTAL", destinoTipo: "ESCRITORIO", destinatario: "ESCRITÓRIO",      percentualBp: 40 },
      ],
    },
    {
      codigo: "B",
      descricao: "Escritório / Mensal-Recorrente",
      itens: [
        { ordem: 1, origem: "ESCRITÓRIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "FUNDO",     destinatario: "FUNDO DE RESERVA", percentualBp: 30 },
        { ordem: 2, origem: "ESCRITÓRIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "ESCRITORIO", destinatario: "ESCRITÓRIO",      percentualBp: 70 },
      ],
    },
    {
      codigo: "C",
      descricao: "Sócio / Incidental",
      itens: [
        { ordem: 1, origem: "SÓCIO", periodicidade: "INCIDENTAL", destinoTipo: "FUNDO",     destinatario: "FUNDO DE RESERVA", percentualBp: 30 },
        { ordem: 2, origem: "SÓCIO", periodicidade: "INCIDENTAL", destinoTipo: "SOCIO",     destinatario: "SÓCIO",            percentualBp: 50 },
        { ordem: 3, origem: "SÓCIO", periodicidade: "INCIDENTAL", destinoTipo: "ESCRITORIO", destinatario: "ESCRITÓRIO",      percentualBp: 20 },
      ],
    },
    {
      codigo: "D",
      descricao: "Sócio / Mensal-Recorrente",
      itens: [
        { ordem: 1, origem: "SÓCIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "FUNDO",     destinatario: "FUNDO DE RESERVA", percentualBp: 30 },
        { ordem: 2, origem: "SÓCIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "SOCIO",     destinatario: "SÓCIO",            percentualBp: 50 },
        { ordem: 3, origem: "SÓCIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "ESCRITORIO", destinatario: "ESCRITÓRIO",      percentualBp: 20 },
      ],
    },
    {
      codigo: "E",
      descricao: "Distribuição de Lucro / Semestral",
      itens: [
        { ordem: 1, origem: "DISTRIBUIÇÃO DE LUCRO (FUNDO DE RESERVA)", periodicidade: "SEMESTRAL", destinoTipo: "SOCIO", destinatario: "S. PATRIMONIAL", percentualBp: 70 },
        { ordem: 2, origem: "DISTRIBUIÇÃO DE LUCRO (FUNDO DE RESERVA)", periodicidade: "SEMESTRAL", destinoTipo: "SOCIO", destinatario: "S. DE SERVIÇO",  percentualBp: 15 },
        { ordem: 3, origem: "DISTRIBUIÇÃO DE LUCRO (FUNDO DE RESERVA)", periodicidade: "SEMESTRAL", destinoTipo: "SOCIO", destinatario: "S. DE SERVIÇO",  percentualBp: 15 },
      ],
    },
    {
      codigo: "F",
      descricao: "Sócio para Outro Sócio / Incidental",
      itens: [
        { ordem: 1, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "INCIDENTAL", destinoTipo: "INDICACAO",  destinatario: "INDICAÇÃO",        percentualBp: 20 },
        { ordem: 2, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "INCIDENTAL", destinoTipo: "SOCIO",      destinatario: "SÓCIO",            percentualBp: 30 },
        { ordem: 3, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "INCIDENTAL", destinoTipo: "FUNDO",      destinatario: "FUNDO DE RESERVA", percentualBp: 30 },
        { ordem: 4, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "INCIDENTAL", destinoTipo: "ESCRITORIO", destinatario: "ESCRITÓRIO",       percentualBp: 20 },
      ],
    },
    {
      codigo: "G",
      descricao: "Sócio para Outro Sócio / Mensal-Recorrente",
      itens: [
        { ordem: 1, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "INDICACAO",  destinatario: "INDICAÇÃO",        percentualBp: 20 },
        { ordem: 2, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "SOCIO",      destinatario: "SÓCIO",            percentualBp: 30 },
        { ordem: 3, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "FUNDO",      destinatario: "FUNDO DE RESERVA", percentualBp: 30 },
        { ordem: 4, origem: "SÓCIO PARA OUTRO SÓCIO", periodicidade: "MENSAL/RECORRENTE", destinoTipo: "ESCRITORIO", destinatario: "ESCRITÓRIO",       percentualBp: 20 },
      ],
    },
  ];

  for (const m of modelos) {
    const exists = await prisma.modeloDistribuicao.findUnique({ where: { codigo: m.codigo } });
    if (exists) {
      console.log(`  Modelo ${m.codigo} já existe, pulando.`);
      continue;
    }
    await prisma.modeloDistribuicao.create({
      data: {
        codigo: m.codigo,
        descricao: m.descricao,
        itens: {
          create: m.itens,
        },
      },
    });
    console.log(`  Modelo ${m.codigo} criado.`);
  }

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
