import type { Request, Response } from "express";

import { idParamSchema } from "../schemas/common.js";
import { createNoteInputSchema, updateNoteInputSchema } from "../schemas/note.schema.js";
import * as noteService from "../services/note.service.js";

export async function list(req: Request, res: Response): Promise<void> {
  const notes = await noteService.listNotes(req.user);
  res.json(notes);
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = createNoteInputSchema.parse(req.body);
  const note = await noteService.createNote(req.user, input);
  res.status(201).json(note);
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const patch = updateNoteInputSchema.parse(req.body);
  const note = await noteService.updateNote(req.user, id, patch);
  res.json(note);
}

export async function archive(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const note = await noteService.archiveNote(req.user, id);
  res.json(note);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const note = await noteService.deleteNote(req.user, id);
  res.json(note);
}
