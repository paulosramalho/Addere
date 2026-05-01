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

function normalizarContaKey(conta) {
  const nome = String(conta.nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const tipo = String(conta.tipo || "").trim().toUpperCase();
  return `${tipo}|${nome}`;
}

async function deduplicarContasContabeis() {
  const contas = await prisma.livroCaixaConta.findMany({
    orderBy: [{ tipo: "asc" }, { nome: "asc" }, { id: "asc" }],
  });
  const porChave = new Map();

  for (const conta of contas) {
    const key = normalizarContaKey(conta);
    if (!porChave.has(key)) {
      porChave.set(key, conta);
      continue;
    }

    const principal = porChave.get(key);
    await prisma.$transaction([
      prisma.livroCaixaLancamento.updateMany({ where: { contaId: conta.id }, data: { contaId: principal.id } }),
      prisma.pixPagamento.updateMany({ where: { contaId: conta.id }, data: { contaId: principal.id } }),
      prisma.pagamentoBoleto.updateMany({ where: { contaId: conta.id }, data: { contaId: principal.id } }),
      prisma.pagamentoDarf.updateMany({ where: { contaId: conta.id }, data: { contaId: principal.id } }),
      prisma.livroCaixaConta.delete({ where: { id: conta.id } }),
    ]);
    console.log(`  Conta duplicada removida: ${conta.nome} (${conta.tipo}) -> #${principal.id}`);
  }
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

  await deduplicarContasContabeis();

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
