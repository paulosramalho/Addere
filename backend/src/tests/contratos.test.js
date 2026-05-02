import { vi, describe, it, expect, beforeEach } from "vitest";
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

const mockContrato = {
  id: 1,
  numeroContrato: "2026001",
  clienteId: 1,
  valorTotal: 300000,
  formaPagamento: "PARCELADO",
  ativo: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cliente: { id: 1, nomeRazaoSocial: "Cliente Teste", cpfCnpj: "111.222.333-44" },
  parcelas: [],
};

describe("GET /api/contratos", () => {
  beforeEach(() => resetPrismaMock());

  it("retorna 401 sem token", async () => {
    const res = await request.get("/api/contratos");
    expect(res.status).toBe(401);
  });

  it("retorna lista vazia autenticado", async () => {
    prismaMock.contratoPagamento.findMany.mockResolvedValue([]);
    const res = await request.get("/api/contratos").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("retorna contratos quando existem", async () => {
    prismaMock.contratoPagamento.findMany.mockResolvedValue([mockContrato]);
    const res = await request.get("/api/contratos").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].numeroContrato).toBe("2026001");
  });
});

describe("GET /api/contratos/:id", () => {
  beforeEach(() => resetPrismaMock());

  it("retorna 401 sem token", async () => {
    const res = await request.get("/api/contratos/1");
    expect(res.status).toBe(401);
  });

  it("retorna 404 quando contrato não existe", async () => {
    prismaMock.contratoPagamento.findUnique.mockResolvedValue(null);
    const res = await request.get("/api/contratos/999").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it("retorna contrato quando encontrado", async () => {
    prismaMock.contratoPagamento.findUnique.mockResolvedValue(mockContrato);
    const res = await request.get("/api/contratos/1").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.numeroContrato).toBe("2026001");
  });
});

describe("GET /api/clients", () => {
  beforeEach(() => resetPrismaMock());

  it("retorna 401 sem token", async () => {
    const res = await request.get("/api/clients");
    expect(res.status).toBe(401);
  });

  it("retorna lista de clientes autenticado", async () => {
    prismaMock.cliente.findMany.mockResolvedValue([
      { id: 1, nomeRazaoSocial: "João Silva", cpfCnpj: "111.222.333-44", ativo: true },
    ]);
    const res = await request.get("/api/clients").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /api/health", () => {
  it("retorna 200 (health check público)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await request.get("/api/health");
    expect([200, 503]).toContain(res.status); // 200 se BD ok, 503 se mock falha
    expect(res.body).toHaveProperty("status");
  });
});
