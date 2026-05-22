import { Router } from "express";

import * as textProcessController from "../controllers/text-process.controller.js";

export const textRouter = Router();

textRouter.post("/process", textProcessController.process);
