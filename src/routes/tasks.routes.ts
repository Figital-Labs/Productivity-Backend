import { Router } from "express";

import * as taskController from "../controllers/task.controller.js";

export const tasksRouter = Router();

tasksRouter.get("/", taskController.list);
tasksRouter.post("/", taskController.create);
tasksRouter.patch("/:id", taskController.update);
tasksRouter.patch("/:id/schedule", taskController.schedule);
tasksRouter.delete("/:id", taskController.remove);
tasksRouter.post("/:id/restore", taskController.restore);
