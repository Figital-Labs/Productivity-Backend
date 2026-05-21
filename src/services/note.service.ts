import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as noteRepo from "../repositories/note.repository.js";
import type { CreateNoteInput, UpdateNoteInput } from "../schemas/note.schema.js";
import { canAccess } from "../utils/auth.js";

export async function getNote(user: AuthenticatedUser, id: string): Promise<noteRepo.Note> {
  const note = await noteRepo.findById(id);
  if (!note) throw new NotFoundError("Note", id);
  if (note.deletedAt !== null) throw new NotFoundError("Note", id);
  if (!canAccess(user, note)) throw new ForbiddenError();
  return note;
}

export function listNotes(user: AuthenticatedUser): Promise<noteRepo.Note[]> {
  return noteRepo.list(user.id);
}

export function createNote(
  user: AuthenticatedUser,
  input: CreateNoteInput,
): Promise<noteRepo.Note> {
  return noteRepo.create({ userId: user.id, content: input.content });
}

export async function updateNote(
  user: AuthenticatedUser,
  id: string,
  patch: UpdateNoteInput,
): Promise<noteRepo.Note> {
  await getNote(user, id);
  return noteRepo.update(id, patch);
}

export async function archiveNote(user: AuthenticatedUser, id: string): Promise<noteRepo.Note> {
  const note = await getNote(user, id);
  if (note.archived) {
    throw new ConflictError("NOTE_ALREADY_ARCHIVED", `Note ${id} is already archived`);
  }
  return noteRepo.setArchived(id, true);
}

export async function deleteNote(user: AuthenticatedUser, id: string): Promise<noteRepo.Note> {
  await getNote(user, id);
  return noteRepo.softDelete(id);
}
