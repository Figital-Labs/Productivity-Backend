import { Router } from "express";

import * as imageController from "../controllers/image.controller.js";
import { imageUpload } from "../middleware/upload.js";

export const imagesRouter = Router();

imagesRouter.post("/process", imageUpload.single("image"), imageController.process);
