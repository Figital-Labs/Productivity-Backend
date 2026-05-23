/**
 * Truncates a task's `notes` field for inclusion in the AI's pending-tasks
 * context. Notes can be up to 2000 chars in the DB; sending all of them for
 * 50 tasks would 5-10× the prompt size with diminishing return — the
 * disambiguation signal (ward, room, doctor name) almost always sits in the
 * first phrase. The cap is 200 chars (~30-35 words), which catches the common
 * "Ward A morning" / "Dr Sharma re: cardiac case" disambiguation cases while
 * keeping token cost bounded.
 *
 * Word-aware: cuts on whitespace boundary so we don't slice "Dr Shar..." mid-word.
 * Appends an ellipsis when truncated so the AI knows there's more it can't see.
 * Returns `undefined` for null / empty / whitespace-only input so the field
 * drops out of the JSON entirely (less noise than `null`).
 */

const NOTES_CONTEXT_CHAR_LIMIT = 200;

export function truncateNotesForContext(notes: string | null | undefined): string | undefined {
  if (!notes) return undefined;
  const trimmed = notes.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= NOTES_CONTEXT_CHAR_LIMIT) return trimmed;

  const words = trimmed.split(/\s+/);
  let result = "";
  for (const word of words) {
    const next = result.length === 0 ? word : `${result} ${word}`;
    if (next.length > NOTES_CONTEXT_CHAR_LIMIT) break;
    result = next;
  }
  return `${result}…`;
}
