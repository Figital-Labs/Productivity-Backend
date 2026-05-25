---
id: SPRINT-12
title: Manager Voice/Text Updates on Delegated Tasks (deferred)
status: deferred
date: 2026-05-25
tags: [sprint, ai, prompts, delegation, deferred, future]
related: [STATE, SPRINT-BE-11, FE-SPRINT-11]
---

# Sprint 12 — Manager Voice/Text Updates on Delegated Tasks

> **Status: DEFERRED. Do not implement yet.**
>
> This file captures the scope for a future sprint so it's not forgotten.
> Pick it up only when a real demo flow needs it. See "When to un-defer"
> at the bottom.

## Why this exists

Sprint 11 shipped the delegation flow (`/team/voice/delegate`, `/team/text/delegate`, `/team/image/delegate`) as **create-only**: managers can create tasks for staff via voice, but cannot UPDATE existing delegated tasks via voice on the same endpoint. Updates require either:

- The assignee to act on their own task list (via their personal `/voice/process`), or
- The manager to use the drill-down UI (currently read-only — editing not yet wired)

In a real demo, a manager will plausibly want to dictate things like:

- *"Sneha ka morning rounds wala done mark kar do"* (complete a report's task)
- *"Amit ka OT prep ko Friday shift kar do"* (move date on a delegated task)
- *"Vikram ka pharmacy check ko urgent kar do"* (raise priority)

None of those work today. They'd be parsed as new `created` tasks with weird titles. Sprint 12 closes that gap.

## Scope

Expand the 3 delegation endpoints to accept update intents (priority_updated, completed, partial, target_date_updated) on existing tasks belonging to the manager's reports — in addition to the existing `created` intent.

**Effort estimate**: 3–4 hours backend + 1–2 hours frontend. POC-appropriate.

---

## Backend changes

### 12.1 — Repository: list pending tasks across multiple assignees

**File**: [src/repositories/task.repository.ts](../../src/repositories/task.repository.ts)

New helper:

```ts
export function listPendingForAssignees(
  assigneeIds: string[],
  opts: { limitPerAssignee?: number; totalCap?: number } = {},
): Promise<Task[]> {
  // Default: 20 per assignee, capped at 100 total. Returns tasks across all
  // the manager's reports for AI context. Ordered by [assigneeId, recency].
}
```

The cap prevents prompt bloat. With Sharma's 3 reports × 20 tasks = 60 tasks max; well within Gemini's context budget.

### 12.2 — Delegation action schema: expand from single-variant to discriminated union

**File**: [src/schemas/team-voice-delegate.schema.ts](../../src/schemas/team-voice-delegate.schema.ts)

Today:

```ts
export const teamDelegateActionSchema = z.object({
  type: z.literal("created"),
  title: z.string().min(1).max(200),
  assigneeId: z.string().min(1),
  // ...
});
```

Becomes a discriminated union mirroring the personal `voiceActionSchema`:

```ts
export const teamDelegateActionSchema = z.discriminatedUnion("type", [
  // Existing — unchanged for delegation creation
  z.object({
    type: z.literal("created"),
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    priority: priorityEnum.optional(),
    targetDate: ymdDateSchema.optional(),
    assigneeId: z.string().min(1),  // REQUIRED for created
    reasoning: z.string(),
  }),
  // NEW — update variants. taskId references one of the assignees' tasks.
  // No assigneeId needed: the task already has one.
  z.object({
    type: z.literal("priority_updated"),
    taskId: z.string().min(1),
    priority: priorityEnum,
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("completed"),
    taskId: z.string().min(1),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("partial"),
    taskId: z.string().min(1),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("target_date_updated"),
    taskId: z.string().min(1),
    targetDate: ymdDateSchema,
    reasoning: z.string(),
  }),
]);
```

The text and image delegation schemas mirror this.

### 12.3 — Prompt updates

**Files**: all 3 delegation prompts + shared-rules.ts.

The team prompts currently say *"This endpoint emits ONE intent type only: created."* That changes to all five. New worked examples in `DELEGATION_RELAY_EXAMPLES` (shared-rules.ts):

```
Input: "Sneha ka morning rounds wala done mark kar do"
  + assignee Sneha exists in reports, has pending task "Morning ward rounds"
  → completed { taskId: <task-id>, reasoning: "Sneha ke morning rounds done mark kiye" }

Input: "Amit ka OT prep ko Friday shift kar do"
  + assignee Amit, has pending task "OT prep"
  → target_date_updated { taskId: <task-id>, targetDate: "<upcoming Friday>", reasoning: "Amit ke OT prep ko Friday shift kiya" }

Input: "Vikram ka pharmacy check ko urgent kar do"
  + assignee Vikram, has pending task "Pharmacy inventory check"
  → priority_updated { taskId: <task-id>, priority: "high", reasoning: "Vikram ke pharmacy check ki priority urgent ki" }
```

**Pending tasks context grouping**: instead of a flat list, group by assignee so the model knows which task belongs to whom:

```json
[
  { "name": "Sister Sneha", "id": "<sneha-id>", "tasks": [
    { "id": "task-a", "title": "Morning ward rounds", "priority": null, "targetDate": "2026-05-25" },
    { "id": "task-b", "title": "Update patient charts", "priority": "medium", "targetDate": "2026-05-25" }
  ]},
  { "name": "Ward Boy Amit", "id": "<amit-id>", "tasks": [...] }
]
```

This grouping is critical — without it, the AI has to fuzzy-match titles to assignees twice (once to pick the assignee, once to find the task). Grouping makes the lookup atomic.

**New ambiguity rules** (additions to DELEGATION_RULE):

```
WHEN MULTIPLE ASSIGNEES HAVE TASKS WITH THE SAME TITLE
If two reports have tasks named "morning rounds" and the manager says
"morning rounds done karo" without specifying who → recommendation,
not action. Ask the manager which one.

WHEN MANAGER NAMES NO ONE FOR AN UPDATE
"morning rounds done karo" with no name and the manager doesn't have a
"morning rounds" task on their OWN list → recommendation. Don't guess.
```

### 12.4 — Dispatcher routing

**File**: [src/services/team-action-dispatch.service.ts](../../src/services/team-action-dispatch.service.ts) (current) + reuse of [src/services/action-dispatch.service.ts](../../src/services/action-dispatch.service.ts)

The existing `dispatchDelegationAction` only handles `created`. Two options:

**Option A (recommended)**: Keep `dispatchDelegationAction` for `created` (manager's path with reportIds validation), call `dispatchAiAction` for everything else. The personal dispatcher already:
- Validates `canAccessTask` (which permits manager-of-assignee per Sprint 11)
- Handles all 4 update action types correctly
- Returns the same `PersistedAiAction` shape

The team services just route based on action type:

```ts
for (const action of aiResponse.actions) {
  if (action.type === "created") {
    const result = await dispatchDelegationAction(manager, action, opts);
    // ...
  } else {
    const persisted = await dispatchAiAction(manager, action, {
      sourceType: "voice",
      sourceId: interaction.id,
      today,
      // no creatorId — for updates the creator is locked on the original task
    });
    // ...
  }
}
```

**Option B**: Extend `dispatchDelegationAction` to handle all action types itself. More code duplication, no clear win. Reject.

### 12.5 — Service-layer changes (all 3 delegation services)

**Files**: `team-voice-delegate.service.ts`, `team-text-delegate.service.ts`, `team-image-delegate.service.ts`

Before calling the prompt builder, fetch the grouped pending tasks for the manager's reports:

```ts
const directory = await buildDirectoryContext(manager.id);
const reportTasks = await taskRepo.listPendingForAssignees(
  Array.from(manager.reportIds),
  { limitPerAssignee: 20, totalCap: 100 },
);
const groupedTasks = groupTasksByAssignee(reportTasks, directory);

const aiResponse = await generateStructured({
  model: GEMINI_FLASH_MODEL,
  prompt: buildTeamVoiceDelegatePrompt({
    directory,
    pendingTasksByAssignee: groupedTasks,  // NEW
    selfUserId: manager.id,
    ...promptDateAnchors(today),
  }),
  schema: teamVoiceDelegateResponseSchema,
  media: [{ mimeType: audio.mimeType, buffer: audio.buffer }],
});
```

### 12.6 — Backend smoke tests (when implementing)

1. Create-only (regression): "Sneha ko ward 12 visit karna" → still creates new task. ✓
2. Complete via voice: "Sneha ka morning rounds done karo" → completed action on Sneha's existing task.
3. Target-date shift: "Amit ka reports collect ko Friday shift karo" → target_date_updated on Amit's task.
4. Priority bump: "Vikram ka OT prep ko urgent karo" → priority_updated, high.
5. Ambiguous (multiple reports have same-title task): "morning rounds done karo" with two reports having "morning rounds" → recommendation, not action.
6. Bare update with no name: "ward 12 visit done karo" with no name → recommendation.
7. Task not in reports' lists: "X done karo" where X doesn't exist on any report → recommendation.
8. Mixed batch: "Sneha ko new task chart entries, aur Amit ka morning rounds done karo" → 1 created + 1 completed in same response.
9. Permission boundary: manager tries to update task assigned to someone NOT in their reports → 403 / safety-net recommendation (dispatcher's canAccessTask already blocks).

---

## Frontend changes

The frontend changes are MINIMAL because the existing AiAction discriminated union already covers all 5 types from Sprint 10. The work is mostly toast wording + activity feed labels.

### 12.F.1 — Types: already done

[Task-List/src/api/types.ts](../../../Task-List/src/api/types.ts) already has `AiAction` as a discriminated union with all 5 types from Sprint 10. The delegation response will start carrying non-`created` types after this sprint — the types accept them already. **No type change needed.**

### 12.F.2 — Delegation toast wording

**File**: [Task-List/src/components/team/delegationSummary.ts](../../../Task-List/src/components/team/delegationSummary.ts) (or wherever the toast helper lives)

Today's helper says "Delegated N" — assumes all actions are `created`. After Sprint 12, the actions array can be mixed. Toast becomes a count-based summary mirroring the personal `summarizeActions`:

```ts
// Example toast outputs after Sprint 12:
//   "Delegated 2"                       (2 created)
//   "Marked 1 done"                     (1 completed)
//   "Moved 1, Delegated 1"              (1 target_date_updated + 1 created)
//   "Updated priority for 1"            (1 priority_updated)
```

Cleanest path: reuse [Task-List/src/lib/ai-summary.ts](../../../Task-List/src/lib/ai-summary.ts)'s `summarizeActions` directly. Replace the team-specific helper with the shared one. ~15 minutes.

### 12.F.3 — Refetch after non-created delegation actions

**File**: [Task-List/src/components/team/TeamDashboard.tsx](../../../Task-List/src/components/team/TeamDashboard.tsx)

The dashboard's `refetch()` already fires on focus + 30s interval + on modal close. So updates DO surface, just on the next refetch cycle. Optional polish: immediately refetch after the delegation modal closes (already happens for `created`; verify it also fires for the mixed case). ~5 minutes.

### 12.F.4 — Activity feed: completion-by-manager enrichment

**File**: [Backend_task_list/src/services/activity.service.ts](../../src/services/activity.service.ts) — backend file, but listed here because the data shape change affects what the FE shows.

Today's `task_completed` activity event carries `delegatedBy/delegatedTo` only when `creatorId !== assigneeId` (sourced from the task's creator/assignee fields). If Sneha created her OWN task and Sharma later completes it via voice delegation, the `creatorId === assigneeId` so no delegation enrichment fires — the FE will show it as Sneha's self-completion, even though Sharma triggered it.

**This is a known gap.** Tracking "who triggered the latest mutation" would require either:
- A new audit field on Task (e.g., `lastModifiedBy: userId`), OR
- A real `TaskAuditEvent` table (out of POC scope per ADR-0024).

For Sprint 12, **accept this limitation**. The activity feed shows correct delegation info for tasks created via delegation; misattributes the actor for tasks completed-by-manager but originally self-created. Document this in the sprint when implementing.

### 12.F.5 — DelegationVoiceModal / DelegationTextModal

**Files**: [Task-List/src/components/team/DelegationVoiceModal.tsx](../../../Task-List/src/components/team/DelegationVoiceModal.tsx), [Task-List/src/components/team/DelegationTextModal.tsx](../../../Task-List/src/components/team/DelegationTextModal.tsx)

No structural changes. The modals already render the action summary via the toast helper — once that helper handles mixed action types (12.F.2), the modal output is correct.

### 12.F.6 — Frontend smoke tests

Mostly covered by 12.6 backend tests when run end-to-end through the modal. Add browser-side checks:
1. Voice "Sneha ka morning rounds done" → toast "Marked 1 done"; switch to Sneha's view → task is completed.
2. Voice "Amit ka reports ko Friday" → toast "Moved 1"; switch to Amit's view → task has new date.
3. Mixed batch: voice "Sneha ko chart entries karna aur Amit ka reports done karo" → toast "Delegated 1, Marked 1 done".

---

## Out of scope (explicit deferrals from Sprint 12)

- **Persistent "last-modified-by" audit**: knowing who triggered a completion when creator === assignee. Would need either a Task field or a TaskAuditEvent table. Defer to a later sprint focused on activity accuracy.
- **Cross-org delegation**: managers can only manage tasks within their `orgId`. Already enforced by `canAccessTask`.
- **Manager dictating updates to their OWN tasks via the delegation endpoint**: ambiguous — manager has personal voice for their own tasks already. Sprint 12 routes self-task ambiguity to recommendations rather than supporting it.
- **Batch undo**: if Sharma marks 5 of Sneha's tasks done in one utterance and got one wrong, no batch-undo. Each action is its own row; manual revert via UI.

## When to un-defer

Pick this up when one of these is true:

- The demo script explicitly includes a manager-dictates-updates-on-delegated-tasks scene
- Manager users in real testing express that they want to manage delegated tasks via voice (not just create them)
- The drill-down UI gains edit capability and we want voice as a faster alternative
- Activity-feed accuracy on completion-by-manager becomes important enough to motivate the audit-field work

If none of these are true, leave deferred. The create-only delegation flow is the demo-critical capability; updates can flow through the assignee's own voice.

## Predecessor / context

- Built on top of Sprint 11 (delegation surface) — [11-hierarchy-and-delegation.md](./11-hierarchy-and-delegation.md)
- Conversational decision recorded 2026-05-25: user asked "are we passing pending tasks?" → confirmed no → asked feasibility of expanding → this sprint file written as the deferred scope.

## Estimated effort (when un-deferred)

| Phase | Time | Description |
|---|---|---|
| 12.1 + 12.2 | 1 hr | Repository helper + schema expansion |
| 12.3 | 1.5 hr | Prompt updates + grouped pending-tasks context + new worked examples + ambiguity rules |
| 12.4 + 12.5 | 1 hr | Dispatcher routing + service-layer changes for all 3 delegation services |
| 12.6 | 1 hr | Backend smoke tests |
| 12.F.1–6 | 1 hr | Frontend toast helper + activity feed acknowledgment + browser smoke |
| **Total** | **~5.5 hours** | One focused session |
