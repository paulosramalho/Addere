import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";
import supertest from "supertest";
import jwt from "jsonwebtoken";

import { prismaMock, resetPrismaMock } from "./helpers/prismaMock.js";

vi.mock("@prisma/client", () => ({ PrismaClient: vi.fn(function () { return prismaMock; }) }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(), hash: vi.fn() }, compare: vi.fn(), hash: vi.fn() }));
vi.mock("resend", () => ({ Resend: vi.fn(function () { return { emails: { send: vi.fn() } }; }) }));
vi.mock("@sentry/node", () => ({ init: vi.fn(), setupExpressErrorHandler: vi.fn(), captureException: vi.fn() }));

const { default: app } = await import("../server.js");
const request = supertest(app);

const JWT_SECRET = "test-secret-do-not-use-in-prod";
const adminToken = jwt.sign({ id: 1, role: "ADMIN", email: "admin@amr.com", tipoUsuario: "USUARIO" }, JWT_SECRET);
const userToken  = jwt.sign({ id: 2, role: "USER",  email: "user@amr.com",  tipoUsuario: "USUARIO" }, JWT_SECRET);

describe("GET /api/relatorios/inadimplencia", () => {
  beforeEach(() => {
    resetPrismaMock();
    // Mock para buscar advogados (precisa de advogadoId quando role=USER)
    prismaMock.advogado.findFirst.mockResolvedValue(null);
  });

  it("retorna 401 sem autenticação", async () => {
    const res = await request.get("/api/relatorios/inadimplencia");
    expect(res.status).toBe(401);
  });

  it("retorna 200 com estrutura correta (sem inadimplentes)", async () => {
    prismaMock.parcelaContrato.findMany.mockResolvedValue([]);
    const res = await request.get("/api/relatorios/inadimplencia").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("clientes");
    expect(res.body).toHaveProperty("totais");
    expect(Array.isArray(res.body.clientes)).toBe(true);
    expect(res.body.clientes).toHaveLength(0);
    expect(res.body.totais.valorTotalCentavos).toBe(0);
  });

  it("retorna clientes agrupados por devedor", async () => {
    const hoje = new Date();
    const vencimento40dias = new Date(hoje);
    vencimento40dias.setDate(hoje.getDate() - 40);

    prismaMock.parcelaContrato.findMany.mockResolvedValue([
      {
        id: 1,
        numero: 1,
        vencimento: vencimento40dias,
        valorPrevisto: 150000, // 1500.00 em decimal — Prisma retorna Decimal
        status: "PREVISTA",
        contrato: {
          numeroContrato: "2026001",
          cliente: {
            id: 10,
            nomeRazaoSocial: "João Silva",
            cpfCnpj: "123.456.789-00",
            telefone: "(91) 9 9999-9999",
          },
        },
      },
    ]);

    const res = await request.get("/api/relatorios/inadimplencia").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.clientes).toHaveLength(1);
    const c = res.body.clientes[0];
    expect(c.cliente.nomeRazaoSocial).toBe("João Silva");
    expect(c.parcelas).toHaveLength(1);
    expect(c.parcelas[0].diasEmAtraso).toBeGreaterThanOrEqual(39);
    // risco de 40 dias = ATENCAO (31-60)
    expect(c.parcelas[0].risco).toBe("ATENCAO");
    expect(res.body.totais.clientesCount).toBe(1);
    expect(res.body.totais.parcelasCount).toBe(1);
  });

  it("filtra por diasMinimos", async () => {
    prismaMock.parcelaContrato.findMany.mockResolvedValue([]);
    const res = await request
      .get("/api/relatorios/inadimplencia?diasMinimos=30")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // A query deve ter sido chamada com filtro de vencimento
    expect(prismaMock.parcelaContrato.findMany).toHaveBeenCalledTimes(1);
    const callArgs = prismaMock.parcelaContrato.findMany.mock.calls[0][0];
    // Verifica que filtro de vencimento está presente
    expect(callArgs.where).toHaveProperty("vencimento");
  });
});
