import { z } from "zod";

import { priorityEnum } from "./common.js";

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD");
const isoDateTimeSchema = z.iso.datetime({ message: "scheduledAt must be ISO 8601 date-time" });

export const meetingTypeEnum = z.enum(["hurdle", "1-on-1"]);
export type MeetingType = z.infer<typeof meetingTypeEnum>;

/**
 * Sprint 15: body for `POST /meetings`. Attendees are User.id strings; service
 * validates same-org membership before persisting. Max 50 attendees keeps
 * the prompt context manageable.
 */
export const createMeetingInputSchema = z.object({
  title: z.string().min(1).max(200),
  scheduledAt: isoDateTimeSchema,
  type: meetingTypeEnum,
  attendeeIds: z.array(z.string().min(1)).min(1).max(50),
  agenda: z.string().max(2000).optional(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingInputSchema>;

/**
 * Body for `PATCH /meetings/:id`. All fields optional; at least one required.
 * Notes auto-saves on blur from the FE active session.
 */
export const updateMeetingInputSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    scheduledAt: isoDateTimeSchema.optional(),
    type: meetingTypeEnum.optional(),
    attendeeIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    agenda: z.string().max(2000).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "At least one field must be provided");
export type UpdateMeetingInput = z.infer<typeof updateMeetingInputSchema>;

/**
 * Body for `POST /meetings/:id/process`. Audio + images come via multipart
 * (handled in controller); this schema covers form fields. `customPrompt`
 * is threaded into the AI prompt as a "FOCUS INSTRUCTION" block. `notes`
 * lets the FE auto-save notes one last time in the same call.
 */
export const processMeetingInputSchema = z.object({
  customPrompt: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
});
export type ProcessMeetingInput = z.infer<typeof processMeetingInputSchema>;

/**
 * The output shape Gemini must produce for `POST /meetings/:id/process`.
 * Same pattern as team-voice-delegate: `created` actions carry assigneeId
 * picked from the meeting's attendees; recommendations cover ambiguous /
 * unassigned items. Plus a `summary` field unique to meetings.
 */
export const meetingActionSchema = z.object({
  type: z.literal("created"),
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  priority: priorityEnum.optional(),
  targetDate: ymdDateSchema.optional(),
  assigneeId: z.string().min(1),
  reasoning: z.string(),
});
export type MeetingAction = z.infer<typeof meetingActionSchema>;

export const meetingRecommendationSchema = z.object({
  title: z.string().min(1),
  priority: priorityEnum.optional(),
  targetDate: ymdDateSchema.optional(),
  reasoning: z.string(),
});
export type MeetingRecommendation = z.infer<typeof meetingRecommendationSchema>;

export const meetingIntentResponseSchema = z.object({
  summary: z.string(),
  actions: z.array(meetingActionSchema),
  recommendations: z.array(meetingRecommendationSchema),
});
export type MeetingIntentResponse = z.infer<typeof meetingIntentResponseSchema>;
