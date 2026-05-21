import type { NoteModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type Note = NoteModel;

export interface CreateNoteData {
  userId: string;
  content: string;
}

export interface UpdateNoteData {
  content?: string | undefined;
}

export interface ListNotesOptions {
  includeArchived?: boolean;
}

export function findById(id: string): Promise<Note | null> {
  return prisma.note.findUnique({ where: { id } });
}

export function list(userId: string, opts: ListNotesOptions = {}): Promise<Note[]> {
  return prisma.note.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(opts.includeArchived === true ? {} : { archived: false }),
    },
    orderBy: { createdAt: "desc" },
  });
}

export function create(data: CreateNoteData): Promise<Note> {
  return prisma.note.create({ data });
}

export function update(id: string, patch: UpdateNoteData): Promise<Note> {
  return prisma.note.update({ where: { id }, data: omitUndefined(patch) });
}

export function setArchived(id: string, archived: boolean): Promise<Note> {
  return prisma.note.update({ where: { id }, data: { archived } });
}

export function softDelete(id: string): Promise<Note> {
  return prisma.note.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}
