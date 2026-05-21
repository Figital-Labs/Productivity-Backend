import "dotenv/config";
import express, { type Request, type Response } from "express";

import prisma from "./lib/prisma.js";

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

const port = Number(process.env["PORT"] ?? 3000);

async function main(): Promise<void> {
  // Verify DB connectivity on boot (fail fast in production).
  await prisma.$connect();

  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port.toString()}`);
  });
}

main().catch(async (error: unknown) => {
  console.error("Failed to start server:", error);
  await prisma.$disconnect();
  process.exit(1);
});
