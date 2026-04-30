import prisma from "./prisma.js";

export async function _schedulerShouldRun(key, hoje) {
  try {
    const rows = await prisma.$queryRaw`SELECT "lastRun" FROM "SchedulerLock" WHERE key = ${key}`;
    if (rows.length && rows[0].lastRun?.toISOString?.().slice(0, 10) === hoje) return false;
  } catch (_) {}
  return true;
}

export async function _schedulerMarkRun(key, hoje) {
  try {
    await prisma.$executeRaw`
      INSERT INTO "SchedulerLock" (key, "lastRun") VALUES (${key}, ${hoje}::date)
      ON CONFLICT (key) DO UPDATE SET "lastRun" = ${hoje}::date, "updatedAt" = NOW()
    `;
  } catch (_) {}
}
