import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is not set in the environment.");
}

const adapter = new PrismaPg({ connectionString });

// Typed global to avoid `@ts-ignore`.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Prevent multiple instances of PrismaClient in development (hot reloads).
let prisma: PrismaClient;

if (process.env["NODE_ENV"] === "production") {
  prisma = new PrismaClient({ adapter });
} else {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  prisma = globalForPrisma.prisma;
}

export default prisma;