import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Cada arquivo de teste tem seu próprio contexto de módulo
    // (necessário para que vi.mock seja isolado entre arquivos)
    isolate: true,
    // Variáveis de ambiente para testes
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-secret-do-not-use-in-prod",
      PORT: "0",
      // Valores dummy para passar na validação de startup (Prisma é mockado)
      DATABASE_URL: "postgresql://test:test@localhost:5432/test_db",
      RESEND_API_KEY: "re_test_dummy",
      EMAIL_FROM: "test@amr.com",
    },
    // Timeout generoso para imports pesados (playwright, pdfjs)
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
