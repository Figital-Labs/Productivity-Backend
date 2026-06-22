import { Router } from "express";

import * as captureController from "../controllers/capture.controller.js";
import { captureUpload } from "../middleware/upload.js";

export const capturesRouter = Router();

// Voice/image task capture (async pipeline, ADR-0025). `jwtAuth` is applied at the v1 level.
// `/process` accepts JSON `{ surface, key }` (direct-to-S3) OR multipart `file` (byte fallback);
// `captureUpload.single` is a no-op on the JSON path and parses the file on the multipart path.
capturesRouter.post("/presign", captureController.presign);
capturesRouter.post("/process", captureUpload.single("file"), captureController.process);
capturesRouter.get("/:surface/:id", captureController.getResult);
