import { Router } from "express";

import * as unifiedProcessController from "../controllers/unified-process.controller.js";
import { multiModalUpload } from "../middleware/upload.js";

export const unifiedProcessRouter = Router();

unifiedProcessRouter.post("/process", multiModalUpload, unifiedProcessController.process);
