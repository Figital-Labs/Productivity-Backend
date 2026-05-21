import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

// Typed global to avoid `@ts-ignore`.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Prevent multiple instances of PrismaClient in development (hot reloads).
let prisma: PrismaClient;

if (env.nodeEnv === "production") {
  prisma = new PrismaClient({ adapter });
} else {
  globalForPrisma.prisma ??= new PrismaClient({ adapter });
  prisma = globalForPrisma.prisma;
}

export default prisma;
