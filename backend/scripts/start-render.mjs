import { spawn } from "node:child_process";

const databaseFallbackKeys = [
  "NEON_DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
];

if (!process.env.DATABASE_URL) {
  const fallbackKey = databaseFallbackKeys.find((key) => process.env[key]);
  if (fallbackKey) {
    process.env.DATABASE_URL = process.env[fallbackKey];
    console.log(`[startup] DATABASE_URL carregada a partir de ${fallbackKey}.`);
  }
}

const missing = ["DATABASE_URL", "JWT_SECRET"].filter((key) => !String(process.env[key] || "").trim());
if (missing.length) {
  console.error(`[startup] Variaveis obrigatorias ausentes: ${missing.join(", ")}`);
  if (missing.includes("DATABASE_URL")) {
    console.error("[startup] Configure DATABASE_URL no Render Environment com a connection string PostgreSQL do Neon.");
  }
  if (missing.includes("JWT_SECRET")) {
    console.error("[startup] Configure JWT_SECRET no Render Environment com uma string longa e secreta.");
  }
  process.exit(1);
}

function bin(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(command, args, { allowFailure = false, stdio = "inherit" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(command), args, {
      env: process.env,
      stdio,
      shell: false,
    });

    child.on("error", (error) => {
      if (allowFailure) {
        console.warn(`[startup] Ignorado: ${command} ${args.join(" ")} -> ${error.message}`);
        resolve(false);
        return;
      }
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(true);
        return;
      }
      if (allowFailure) {
        console.warn(`[startup] Ignorado: ${command} ${args.join(" ")} saiu com codigo ${code}.`);
        resolve(false);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} saiu com codigo ${code}`));
    });
  });
}

function runBackground(command, args) {
  const child = spawn(bin(command), args, {
    env: process.env,
    stdio: "ignore",
    detached: true,
    shell: false,
  });
  child.unref();
}

runBackground("npx", ["playwright", "install", "chromium"]);

await run("npx", ["prisma", "db", "push", "--skip-generate"]);
await run("npx", ["prisma", "db", "seed"]);
await import("../src/server.js");
