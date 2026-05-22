import { Router } from "express";

import { holidaysRouter } from "./holidays.routes.js";
import { notesRouter } from "./notes.routes.js";
import { tasksRouter } from "./tasks.routes.js";
import { voiceRouter } from "./voice.routes.js";

export const v1Router = Router();

v1Router.use("/tasks", tasksRouter);
v1Router.use("/notes", notesRouter);
v1Router.use("/holidays", holidaysRouter);
v1Router.use("/voice", voiceRouter);
