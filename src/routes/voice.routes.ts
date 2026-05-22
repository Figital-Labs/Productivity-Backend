import { Router } from "express";

import * as voiceController from "../controllers/voice.controller.js";
import { voiceUpload } from "../middleware/upload.js";

export const voiceRouter = Router();

voiceRouter.post("/process", voiceUpload.single("audio"), voiceController.process);
