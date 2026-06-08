import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { getEnv } from "../config/env";

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const env = getEnv();
    const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL as ":memory:" | (string & {}) });
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}
