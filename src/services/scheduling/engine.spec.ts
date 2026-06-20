/**
 * Sprint 19 — pure unit spec for the scheduling engine. No DB, no framework.
 * Run with: npm run test:engine   (tsx src/services/scheduling/engine.spec.ts)
 */
import assert from "node:assert/strict";

import {
  clampToHours,
  findEarliestFreeSlot,
  overlaps,
  placeWithCascade,
  snap,
  type Slot,
  type WorkingHours,
} from "./engine.js";

const HOURS: WorkingHours = { workStart: 540, workEnd: 1080 }; // 09:00–18:00

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const slot = (id: string, start: number, duration: number): Slot => ({ id, start, duration });

// ── snap / overlaps / clamp ──────────────────────────────────────────────
test("snap rounds to nearest 15", () => {
  assert.equal(snap(547), 540);
  assert.equal(snap(548), 555);
  assert.equal(snap(600), 600);
});

test("overlaps is half-open", () => {
  assert.equal(overlaps(slot("a", 540, 30), slot("b", 570, 30)), false); // touching, no overlap
  assert.equal(overlaps(slot("a", 540, 30), slot("b", 555, 30)), true);
});

test("clampToHours keeps block inside the day", () => {
  assert.equal(clampToHours(500, 30, HOURS), 540); // before start
  assert.equal(clampToHours(1080, 30, HOURS), 1050); // past end → last fitting start
  assert.equal(clampToHours(600, 30, HOURS), 600); // already valid
});

test("clampToHours pins longer-than-day block to workStart", () => {
  assert.equal(clampToHours(700, 9999, HOURS), 540);
});

// ── findEarliestFreeSlot ─────────────────────────────────────────────────
test("earliest slot on an empty day is workStart", () => {
  assert.equal(findEarliestFreeSlot([], HOURS, 30), 540);
});

test("earliest slot stacks after existing tasks", () => {
  assert.equal(findEarliestFreeSlot([slot("a", 540, 30), slot("b", 570, 30)], HOURS, 30), 600);
});

test("earliest slot fills the first gap big enough", () => {
  // 540–570 busy, 600–630 busy → 570–600 gap (30) fits
  assert.equal(findEarliestFreeSlot([slot("a", 540, 30), slot("c", 600, 30)], HOURS, 30), 570);
});

test("earliest slot skips a gap that is too small", () => {
  // 540–570 busy, 585–615 busy → 570–585 gap (15) too small → 615
  assert.equal(findEarliestFreeSlot([slot("a", 540, 30), slot("b", 585, 30)], HOURS, 30), 615);
});

test("no room returns null (Unscheduled)", () => {
  const tiny: WorkingHours = { workStart: 540, workEnd: 600 };
  assert.equal(findEarliestFreeSlot([slot("a", 540, 30), slot("b", 570, 30)], tiny, 30), null);
});

test("day shorter than duration returns null", () => {
  assert.equal(findEarliestFreeSlot([], { workStart: 540, workEnd: 560 }, 30), null);
});

// ── placeWithCascade ─────────────────────────────────────────────────────
test("single bump pushes the displaced task", () => {
  const r = placeWithCascade([slot("a", 540, 30)], slot("x", 540, 30), HOURS);
  assert.deepEqual(r.placed, { id: "x", start: 540, duration: 30 });
  assert.deepEqual(r.moved, [{ id: "a", start: 570 }]);
  assert.deepEqual(r.overflow, []);
});

test("cascade ripples through a contiguous stack", () => {
  const r = placeWithCascade(
    [slot("a", 540, 30), slot("b", 570, 30), slot("c", 600, 30)],
    slot("x", 540, 30),
    HOURS,
  );
  assert.deepEqual(r.moved, [
    { id: "a", start: 570 },
    { id: "b", start: 600 },
    { id: "c", start: 630 },
  ]);
});

test("cascade stops at the first gap (no compaction)", () => {
  // a touches placed and bumps; c starts at 660 (gap ahead) → untouched
  const r = placeWithCascade([slot("a", 540, 30), slot("c", 660, 30)], slot("x", 540, 30), HOURS);
  assert.deepEqual(r.moved, [{ id: "a", start: 570 }]);
  assert.deepEqual(r.overflow, []);
});

test("tasks entirely before the placed block are untouched", () => {
  const r = placeWithCascade([slot("a", 540, 30)], slot("x", 600, 30), HOURS);
  assert.deepEqual(r.moved, []);
});

test("bumped task past end of day overflows to Unscheduled", () => {
  const tiny: WorkingHours = { workStart: 540, workEnd: 600 };
  const r = placeWithCascade([slot("a", 540, 30)], slot("x", 540, 60), tiny);
  assert.deepEqual(r.placed, { id: "x", start: 540, duration: 60 });
  assert.deepEqual(r.overflow, ["a"]);
  assert.deepEqual(r.moved, []);
});

test("longer-than-day task pins to workStart and overflows the rest", () => {
  const tiny: WorkingHours = { workStart: 540, workEnd: 600 };
  const r = placeWithCascade([slot("a", 540, 30)], slot("x", 540, 120), tiny);
  assert.equal(r.placed.start, 540);
  assert.deepEqual(r.overflow, ["a"]);
});

test("moving an existing task excludes its own old slot", () => {
  const r = placeWithCascade([slot("x", 540, 30), slot("a", 570, 30)], slot("x", 570, 30), HOURS);
  assert.deepEqual(r.placed, { id: "x", start: 570, duration: 30 });
  assert.deepEqual(r.moved, [{ id: "a", start: 600 }]);
});

// ── placeWithCascade — overlap policy "allow" ────────────────────────────
test("allow policy places the candidate without cascading", () => {
  const r = placeWithCascade([slot("a", 540, 30)], slot("x", 540, 30), HOURS, "allow");
  assert.deepEqual(r.placed, { id: "x", start: 540, duration: 30 });
  assert.deepEqual(r.moved, []); // a is left overlapping, untouched
  assert.deepEqual(r.overflow, []);
});

test("allow policy permits a true overlap (sibling not displaced)", () => {
  // x (540–600) overlaps a (570–600); under "allow" a stays put.
  const r = placeWithCascade([slot("a", 570, 30)], slot("x", 540, 60), HOURS, "allow");
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.overflow, []);
});

test("allow policy still snaps and clamps the candidate", () => {
  const r = placeWithCascade([], slot("x", 547, 30), HOURS, "allow");
  assert.equal(r.placed.start, 540); // 547 → snap 540
  const past = placeWithCascade([], slot("y", 1080, 30), HOURS, "allow");
  assert.equal(past.placed.start, 1050); // clamped to last fitting start
});

test("policy defaults to prevent (cascades) when omitted", () => {
  const r = placeWithCascade([slot("a", 540, 30)], slot("x", 540, 30), HOURS);
  assert.deepEqual(r.moved, [{ id: "a", start: 570 }]);
});

console.log(`\n${passed.toString()} engine checks passed.`);
