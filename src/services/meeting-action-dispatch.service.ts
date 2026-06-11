/**
 * The persisted shape for a meeting-derived task. Declared as a `type` (not an
 * `interface`) so it satisfies Prisma's `InputJsonValue` when serialized into
 * `Meeting.actions`.
 *
 * NOTE (2026-06-11): the former `dispatchMeetingAction` flow was removed — meetings
 * route ALL AI actions through recommendations (`meeting.service.ts`), and the manager
 * confirms each one before any task is created. So no task is auto-created at process
 * time and this dispatcher was dead code. The type stays because `meeting.service.ts`
 * imports + re-exports it as the persisted-action shape.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type PersistedMeetingAction = {
  type: "created";
  taskId: string;
  title: string;
  assigneeId: string;
  notes?: string;
  priority?: "low" | "medium" | "high";
  targetDate?: string;
  reasoning: string;
};
