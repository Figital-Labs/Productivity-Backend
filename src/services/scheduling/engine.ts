/**
 * Sprint 19 — pure time-slot scheduling engine.
 *
 * No Prisma, no Date, no I/O. Everything is integer minutes from local midnight
 * (0–1439), so the logic is timezone-/DST-immune and trivially unit-testable.
 * The DB orchestration (loading siblings, persisting, transactions) lives in
 * scheduling.service.ts; this module is the deterministic core.
 */

export const SNAP_MINUTES = 15;
export const DEFAULT_DURATION_MINUTES = 30;
export const MIN_DURATION_MINUTES = 15;

export interface Slot {
  id: string;
  start: number; // minutes from local midnight
  duration: number; // minutes (end is exclusive: start + duration)
}

export interface WorkingHours {
  workStart: number;
  workEnd: number;
}

/**
 * Whether concurrent tasks are allowed.
 *  - `prevent` (default): a drop that collides cascades the siblings later so only
 *    one task runs at a time.
 *  - `allow`: the task is placed at its requested (snapped + clamped) slot and may
 *    overlap; no displacement. The UI lays overlapping blocks out side-by-side.
 * Flipping this is the only change needed to switch the product between the two.
 */
export type OverlapPolicy = "prevent" | "allow";

export interface PlacementResult {
  /** The dropped/created task at its final (snapped + clamped) position. */
  placed: { id: string; start: number; duration: number };
  /** Siblings shifted later by the cascade. Only those whose start changed. */
  moved: { id: string; start: number }[];
  /** Siblings pushed past workEnd — caller nulls their start (→ Unscheduled). */
  overflow: string[];
}

/** Round a minute to the nearest grid step (default 15-min). */
export function snap(minute: number, step: number = SNAP_MINUTES): number {
  return Math.round(minute / step) * step;
}

/** Half-open interval overlap: [a.start, a.end) ∩ [b.start, b.end) ≠ ∅. */
export function overlaps(a: Slot, b: Slot): boolean {
  return a.start < b.start + b.duration && b.start < a.start + a.duration;
}

/**
 * Clamp a start so the block sits inside working hours. If the block is longer
 * than the whole working day, it can't fit — we pin it to workStart and let the
 * caller decide (placeWithCascade keeps it placed; everything else overflows).
 */
export function clampToHours(start: number, duration: number, hours: WorkingHours): number {
  const minStart = hours.workStart;
  const maxStart = hours.workEnd - duration;
  if (maxStart <= minStart) return minStart;
  return Math.min(Math.max(start, minStart), maxStart);
}

/**
 * Earliest free start (left-packed) that fits `duration` within working hours,
 * given the already-occupied `existing` slots. Returns null when the day has no
 * gap large enough → caller leaves the task Unscheduled.
 */
export function findEarliestFreeSlot(
  existing: Slot[],
  hours: WorkingHours,
  duration: number,
): number | null {
  if (hours.workEnd - hours.workStart < duration) return null;

  const sorted = [...existing].sort((a, b) => a.start - b.start);
  let cursor = hours.workStart;

  for (const slot of sorted) {
    const slotEnd = slot.start + slot.duration;
    if (slotEnd <= cursor) continue; // entirely behind the cursor — ignore
    // Gap between cursor and this slot?
    if (slot.start - cursor >= duration) return cursor;
    cursor = Math.max(cursor, slotEnd);
  }

  return cursor + duration <= hours.workEnd ? cursor : null;
}

/**
 * Place `candidate` at its requested start and cascade (bump & ripple) any
 * tasks it collides with, pushing each to start at the previous block's end.
 *
 * Rules:
 *  - candidate.start is snapped to the grid and clamped into working hours.
 *  - Tasks entirely before the placed block are untouched.
 *  - A task that overlaps the moving cursor is pushed to the cursor.
 *  - The first task that already starts at/after the cursor stops the cascade
 *    (no compaction — gaps are preserved, per the product decision).
 *  - Any pushed task that would extend past workEnd overflows → Unscheduled.
 *
 * `candidate.id` is excluded from `existing` automatically, so this is safe to
 * call when moving a task that's already part of the day.
 *
 * Under `policy === "allow"` the candidate is simply snapped + clamped and placed
 * as-is (no cascade, no overflow) — overlaps are permitted and rendered
 * side-by-side by the client.
 */
export function placeWithCascade(
  existing: Slot[],
  candidate: Slot,
  hours: WorkingHours,
  policy: OverlapPolicy = "prevent",
): PlacementResult {
  const start = clampToHours(snap(candidate.start), candidate.duration, hours);
  const placed = { id: candidate.id, start, duration: candidate.duration };

  // Allow overlaps: place at the requested slot, displace nothing.
  if (policy === "allow") {
    return { placed, moved: [], overflow: [] };
  }

  const others = existing.filter((s) => s.id !== candidate.id).sort((a, b) => a.start - b.start);

  const moved: { id: string; start: number }[] = [];
  const overflow: string[] = [];
  let cursor = start + candidate.duration;

  for (const slot of others) {
    if (slot.start + slot.duration <= start) continue; // before the placed block
    if (slot.start >= cursor) break; // clean gap ahead — stop cascading

    if (cursor + slot.duration <= hours.workEnd) {
      if (cursor !== slot.start) moved.push({ id: slot.id, start: cursor });
      cursor += slot.duration;
    } else {
      overflow.push(slot.id);
    }
  }

  return { placed, moved, overflow };
}
