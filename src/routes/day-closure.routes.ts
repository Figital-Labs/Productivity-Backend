import { Router } from "express";

import * as dayClosureController from "../controllers/day-closure.controller.js";

export const dayClosureRouter = Router();

// Sprint 17: two-phase closure. `/review` generates AI feedback once and
// persists a draft. `/submit` finalizes the draft. Neither endpoint accepts
// multipart audio anymore — closure voice goes through `POST /transcribe`
// and arrives here as plain text in `commentary`.
dayClosureRouter.post("/review", dayClosureController.review);
dayClosureRouter.post("/submit", dayClosureController.submit);
dayClosureRouter.post("/:id/mark-reviewed", dayClosureController.markReviewed);
dayClosureRouter.get("/", dayClosureController.get);
