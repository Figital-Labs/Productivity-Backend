import { Router } from "express";

import * as transcriptionController from "../controllers/transcription.controller.js";
import { voiceUpload } from "../middleware/upload.js";

export const transcribeRouter = Router();

// Sprint 17 — `POST /transcribe`. Reuses the existing 10 MB audio multer
// preset (`voiceUpload`). Mounted at `/transcribe` in v1.ts behind jwtAuth.
transcribeRouter.post("/", voiceUpload.single("audio"), transcriptionController.transcribe);
