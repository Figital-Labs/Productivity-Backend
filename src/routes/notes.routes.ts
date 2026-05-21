import { Router } from "express";

import * as noteController from "../controllers/note.controller.js";

export const notesRouter = Router();

notesRouter.get("/", noteController.list);
notesRouter.post("/", noteController.create);
notesRouter.patch("/:id", noteController.update);
notesRouter.post("/:id/archive", noteController.archive);
notesRouter.delete("/:id", noteController.remove);
