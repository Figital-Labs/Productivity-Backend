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
 *
 * Sprint 18 (L3+L7+L8): added optional hierarchy fields. When `roleType` is
 * provided, `role`/`level`/`canManageUsers` are derived from it; the legacy
 * `{ name, email, password, role }` shape still works for backward compat
 * with FE flows that haven't been updated yet.
 */
export const createTeamUserInputSchema = z.object({
  name: z.string().min(1, "name is required").max(120),
  email: z.email("email must be a valid email").max(200),
  password: z.string().min(6, "password must be at least 6 characters").max(200),
  /** Human-facing job title shown in the UI (e.g. "General Manager"). */
  designation: z.string().max(120).optional(),
  /**
   * Simplified model: an admin creates a plain user, a manager, or an admin.
   * isAdmin → {role:"admin", level:800, canManageUsers:true}; else isManager →
   * {role:"manager", level:300}; otherwise a plain staff user {role:"staff",
   * level:100}. Account creation is admin-only.
   */
  isAdmin: z.boolean().optional(),
  /**
   * Manager access (level 300): the user can open the dashboard/team views for
   * their reportees and assign them tasks. Ignored when `isAdmin` is true.
   */
  isManager: z.boolean().optional(),
  /**
   * Reporting managers (m2m). The UI picks one today; the field is an array so
   * multi-manager needs no API change later. Empty/absent → top of the tree.
   */
  managerIds: z.array(z.string()).max(20).optional(),

  // --- Legacy hierarchy fields (deprecated, kept for backward compat) ---
  // Older FE flows still send these; new flows use isAdmin + designation.
  role: z.enum(["staff", "manager"]).optional(),
  roleType: z.enum(["director", "dept_head", "group_lead", "staff", "custom"]).optional(),
  level: z.number().int().min(1).max(1000).optional(),
  departmentId: z.string().optional(),
  groupId: z.string().optional(),
  isLead: z.boolean().optional(),
  canManageUsers: z.boolean().optional(),
});
export type CreateTeamUserInput = z.infer<typeof createTeamUserInputSchema>;

/**
 * Body for `PATCH /team/users/:id` — admin edits a user's account fields. All
 * fields optional; only provided keys are updated. `managerIds` uses
 * set-replacement semantics (the user's managers become exactly this set).
 * `isAdmin`/`isManager` pick the access band; an omitted flag keeps the user's
 * current band, and a user already in the chosen band keeps their exact level.
 */
export const updateTeamUserInputSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.email("email must be a valid email").max(200).optional(),
    designation: z.string().max(120).nullable().optional(),
    isAdmin: z.boolean().optional(),
    isManager: z.boolean().optional(),
    managerIds: z.array(z.string()).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateTeamUserInput = z.infer<typeof updateTeamUserInputSchema>;

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
 * Query for `GET /team/reports` — optional paging. No defaults: callers that
 * pass nothing get the full direct-report list (SendReminderModal, ManageSection,
 * and the listManagedTree rollup all rely on this).
 */
export const listReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

/**
 * Query for `GET /team/reports/tree` — paginated by direct report. Defaults to
 * the first 50 direct reports; the summary rollup is always team-wide.
 */
export const listManagedTreeQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListManagedTreeQuery = z.infer<typeof listManagedTreeQuerySchema>;

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
