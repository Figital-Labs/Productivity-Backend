import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../lib/prisma.js";

export const healthRouter: Router = Router();

healthRouter.get("/livez", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

healthRouter.get("/readyz", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", checks: { db: "ok" } });
  } catch (err) {
    console.error("Readyz DB check failed:", err);
    res.status(503).json({ status: "error", checks: { db: "down" } });
  }
});
