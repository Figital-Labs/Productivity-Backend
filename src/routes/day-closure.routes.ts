import { Router } from "express";

import * as dayClosureController from "../controllers/day-closure.controller.js";
import { voiceUpload } from "../middleware/upload.js";

export const dayClosureRouter = Router();

dayClosureRouter.post("/submit", voiceUpload.single("audio"), dayClosureController.submit);
dayClosureRouter.post("/:id/mark-reviewed", dayClosureController.markReviewed);
dayClosureRouter.get("/", dayClosureController.get);
