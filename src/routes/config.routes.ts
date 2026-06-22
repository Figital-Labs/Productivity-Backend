import { Router } from "express";
import type { Request, Response } from "express";

import { jobBudgetSeconds } from "../lib/ai-config.js";

export const configRouter: Router = Router();

/**
 * Public (pre-auth) client config — non-secret timing numbers, so the frontend's poll patience is
 * derived from the SAME job budgets the queue's visibility window uses. One source of truth ⇒ FE and
 * BE timeouts can't drift apart. `capture` is the budget for the voice/image capture queue (the
 * `media` AI kind); `meeting` is the long-recording budget.
 */
configRouter.get("/", (_req: Request, res: Response) => {
  res.json({
    jobBudgetSeconds: {
      meeting: jobBudgetSeconds("meeting"),
      capture: jobBudgetSeconds("media"),
    },
    pollIntervalMs: 2000,
  });
});
