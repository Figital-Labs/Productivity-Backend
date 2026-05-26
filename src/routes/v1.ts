import { Router } from "express";

import { jwtAuth } from "../middleware/auth.js";

import { activityRouter } from "./activity.routes.js";
import { authRouter } from "./auth.routes.js";
import { dayClosureRouter } from "./day-closure.routes.js";
import { dayPlanRouter } from "./day-plan.routes.js";
import { holidaysRouter } from "./holidays.routes.js";
import { imagesRouter } from "./images.routes.js";
import { notesRouter } from "./notes.routes.js";
import { tasksRouter } from "./tasks.routes.js";
import { teamRouter } from "./team.routes.js";
import { textRouter } from "./text-process.routes.js";
import { unifiedProcessRouter } from "./unified-process.routes.js";
import { usersRouter } from "./users.routes.js";
import { voiceRouter } from "./voice.routes.js";

export const v1Router = Router();

v1Router.use("/auth", authRouter);
v1Router.use(jwtAuth);
v1Router.use("/tasks", tasksRouter);
v1Router.use("/notes", notesRouter);
v1Router.use("/holidays", holidaysRouter);
v1Router.use("/voice", voiceRouter);
v1Router.use("/images", imagesRouter);
v1Router.use("/text", textRouter);
v1Router.use("/day-plan", dayPlanRouter);
v1Router.use("/day-closure", dayClosureRouter);
v1Router.use("/activity", activityRouter);
v1Router.use("/team", teamRouter);
v1Router.use("/users", usersRouter);
v1Router.use("/", unifiedProcessRouter);
