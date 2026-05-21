import type { Request, Response } from "express";

import { idParamSchema } from "../schemas/common.js";
import {
  createTaskInputSchema,
  listTasksQuerySchema,
  updateTaskInputSchema,
} from "../schemas/task.schema.js";
import * as taskService from "../services/task.service.js";

export async function list(req: Request, res: Response): Promise<void> {
  const query = listTasksQuerySchema.parse(req.query);
  const tasks = await taskService.listTasks(req.user, query.date);
  res.json(tasks);
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = createTaskInputSchema.parse(req.body);
  const task = await taskService.createTask(req.user, input);
  res.status(201).json(task);
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const patch = updateTaskInputSchema.parse(req.body);
  const task = await taskService.updateTask(req.user, id, patch);
  res.json(task);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const task = await taskService.deleteTask(req.user, id);
  res.json(task);
}

export async function restore(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const task = await taskService.restoreTask(req.user, id);
  res.json(task);
}
