import { z } from "zod";

import { priorityEnum } from "./common.js";

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/**
 * Sprint 11: body for `POST /team/tasks` — manual delegation form. Assignee
 * must be one of the manager's reports (enforced in service via
 * `req.user.reportIds.has(assigneeId)`).
 */
export const createDelegatedTaskInputSchema = z.object({
  title: z.string().min(1, "title is required").max(200),
  assigneeId: z.string().min(1, "assigneeId is required"),
  notes: z.string().max(2000).optional(),
  priority: priorityEnum.optional(),
  targetDate: ymdDateSchema.optional(),
});
export type CreateDelegatedTaskInput = z.infer<typeof createDelegatedTaskInputSchema>;

/**
 * Body for `POST /team/users` — manager creates a staff user or sub-manager
 * under them. The creator is auto-wired as a manager of the new user via the
 * m2m hierarchy.
 */
export const createTeamUserInputSchema = z.object({
  name: z.string().min(1, "name is required").max(120),
  email: z.email("email must be a valid email").max(200),
  password: z.string().min(6, "password must be at least 6 characters").max(200),
  role: z.enum(["staff", "manager"]),
});
export type CreateTeamUserInput = z.infer<typeof createTeamUserInputSchema>;

/**
 * Body for `POST /team/users/:id/reset-password` — manager resets a report's
 * password. Manager must be a manager of the target user.
 */
export const resetTeamUserPasswordInputSchema = z.object({
  password: z.string().min(6, "password must be at least 6 characters").max(200),
});
export type ResetTeamUserPasswordInput = z.infer<typeof resetTeamUserPasswordInputSchema>;

/**
 * Sprint 14: body for `POST /team/users/attach` — manager attaches an existing
 * same-org user to their reports. No user creation; only the m2m hierarchy
 * edge is added. Used when staff already exist under another manager and a
 * new manager also needs to supervise them (matrix authority).
 */
export const attachExistingUserInputSchema = z.object({
  email: z.email("email must be a valid email").max(200),
});
export type AttachExistingUserInput = z.infer<typeof attachExistingUserInputSchema>;

/**
 * Query for `GET /team/reports/:id/tasks?date=YYYY-MM-DD`. Date is required
 * — drilling into a report's day always asks for a specific date.
 */
export const getReportTasksQuerySchema = z.object({
  date: ymdDateSchema,
});
export type GetReportTasksQuery = z.infer<typeof getReportTasksQuerySchema>;

/**
 * Query for `GET /team/reports/:id/submissions?date=YYYY-MM-DD`. Same shape;
 * returns the report's day-plan + day-closure for that date.
 */
export const getReportSubmissionsQuerySchema = z.object({
  date: ymdDateSchema,
});
export type GetReportSubmissionsQuery = z.infer<typeof getReportSubmissionsQuerySchema>;
