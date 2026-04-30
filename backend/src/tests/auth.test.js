import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";
import supertest from "supertest";
import jwt from "jsonwebtoken";

// ── Mocks (devem vir antes do import do app) ─────────────────────────────────

import { prismaMock, resetPrismaMock } from "./helpers/prismaMock.js";

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(function () { return prismaMock; }),
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn().mockResolvedValue("$2a$10$hashedpassword"),
    genSalt: vi.fn().mockResolvedValue("salt"),
  },
  compare: vi.fn(),
  hash: vi.fn().mockResolvedValue("$2a$10$hashedpassword"),
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function () { return { emails: { send: vi.fn().mockResolvedValue({ id: "mock-email-id" }) } }; }),
}));

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
  captureException: vi.fn(),
}));

// ── Import do app após mocks ─────────────────────────────────────────────────
const { default: app } = await import("../server.js");
const request = supertest(app);

const JWT_SECRET = "test-secret-do-not-use-in-prod";

// Usuário base para testes
const mockUsuario = {
  id: 1,
  nome: "Admin Teste",
  email: "admin@amr.com",
  senhaHash: "$2a$10$hashedpassword",
  role: "ADMIN",
  tipoUsuario: "USUARIO",
  ativo: true,
  deveTrocarSenha: false,
  ghostAdmin: false,
  totpEnabled: false,
  totpSecret: null,
  avatarUrl: null,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    resetPrismaMock();
  });

  it("retorna 401 se email/senha não informados", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null);
    const res = await request.post("/api/auth/login").send({});
    expect(res.status).toBe(401);
  });

  it("retorna 401 se usuário não encontrado", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null);
    const res = await request.post("/api/auth/login").send({ email: "x@x.com", senha: "123" });
    expect(res.status).toBe(401);
  });

  it("retorna 401 se usuário inativo", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ ...mockUsuario, ativo: false });
    const res = await request.post("/api/auth/login").send({ email: "admin@amr.com", senha: "senha123" });
    expect(res.status).toBe(401);
  });

  it("retorna 401 se senha errada", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(mockUsuario);
    const bcryptMod = await import("bcryptjs");
    vi.mocked(bcryptMod.default.compare).mockResolvedValue(false);
    const res = await request.post("/api/auth/login").send({ email: "admin@amr.com", senha: "errada" });
    expect(res.status).toBe(401);
  });

  it("retorna 200 com token se credenciais corretas", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(mockUsuario);
    const bcryptMod = await import("bcryptjs");
    vi.mocked(bcryptMod.default.compare).mockResolvedValue(true);
    const res = await request.post("/api/auth/login").send({ email: "admin@amr.com", senha: "correta" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("usuario");
    expect(res.body.usuario.email).toBe("admin@amr.com");
    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload.role).toBe("ADMIN");
  });

  it("retorna requires2fa quando totpEnabled=true", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ ...mockUsuario, totpEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP" });
    const bcryptMod = await import("bcryptjs");
    vi.mocked(bcryptMod.default.compare).mockResolvedValue(true);
    const res = await request.post("/api/auth/login").send({ email: "admin@amr.com", senha: "correta" });
    expect(res.status).toBe(200);
    expect(res.body.requires2fa).toBe(true);
    expect(res.body).toHaveProperty("tempToken");
    const payload = jwt.verify(res.body.tempToken, JWT_SECRET);
    expect(payload.scope).toBe("2fa");
  });
});

describe("POST /api/auth/2fa/verify-login", () => {
  it("retorna 400 se dados insuficientes", async () => {
    const res = await request.post("/api/auth/2fa/verify-login").send({});
    expect(res.status).toBe(400);
  });

  it("retorna 401 se tempToken inválido", async () => {
    const res = await request.post("/api/auth/2fa/verify-login").send({ tempToken: "invalid", code: "123456" });
    expect(res.status).toBe(401);
  });

  it("retorna 401 se código TOTP errado", async () => {
    const tempToken = jwt.sign({ id: 1, scope: "2fa" }, JWT_SECRET, { expiresIn: "5m" });
    prismaMock.usuario.findUnique.mockResolvedValue({ ...mockUsuario, totpEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP" });
    const res = await request.post("/api/auth/2fa/verify-login").send({ tempToken, code: "000000" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/2fa/status", () => {
  it("retorna 401 sem autenticação", async () => {
    const res = await request.get("/api/auth/2fa/status");
    expect(res.status).toBe(401);
  });

  it("retorna totpEnabled=false para usuário sem 2FA", async () => {
    const token = jwt.sign({ id: 1, role: "ADMIN", email: "admin@amr.com", tipoUsuario: "USUARIO" }, JWT_SECRET);
    prismaMock.usuario.findUnique.mockResolvedValue({ ...mockUsuario, totpEnabled: false });
    const res = await request.get("/api/auth/2fa/status").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totpEnabled).toBe(false);
  });
});

describe("Rotas protegidas", () => {
  it("GET /api/contratos retorna 401 sem token", async () => {
    const res = await request.get("/api/contratos");
    expect(res.status).toBe(401);
  });

  it("GET /api/advogados retorna 401 sem token", async () => {
    const res = await request.get("/api/advogados");
    expect(res.status).toBe(401);
  });

  it("GET /api/clients retorna 401 sem token", async () => {
    const res = await request.get("/api/clients");
    expect(res.status).toBe(401);
  });
});
