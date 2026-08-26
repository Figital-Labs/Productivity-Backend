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
/**
 * An attendee with no account — a vendor, consultant, or clinician from another hospital.
 * Name is what gets displayed; email is optional and used only to spot the "this is actually one
 * of your colleagues" mistake at create time (see EXTERNAL_ATTENDEE_IS_USER in meeting.service).
 *
 * These are stored and shown, but NEVER sent to Vertex: they have no DB row, so any id we passed
 * the model would be fiction it could emit as an `assigneeId`.
 */
export const externalAttendeeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200).trim().toLowerCase().optional(),
});
export type ExternalAttendeeInput = z.infer<typeof externalAttendeeSchema>;

// Capped to bound the row size; internal attendees keep their own separate cap of 50.
const externalAttendeesSchema = z.array(externalAttendeeSchema).max(20);

/** A meeting needs at least ONE attendee overall — internal, external, or a mix. */
function hasAnyAttendee(d: {
  attendeeIds?: string[] | undefined;
  externalAttendees?: ExternalAttendeeInput[] | undefined;
}): boolean {
  return (d.attendeeIds?.length ?? 0) + (d.externalAttendees?.length ?? 0) > 0;
}

export const createMeetingInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    scheduledAt: isoDateTimeSchema,
    type: meetingTypeEnum,
    // `.min(0)`: a 1-on-1 with an outside vendor is legitimate and has no internal attendee
    // besides the creator, who owns the meeting regardless.
    attendeeIds: z.array(z.string().min(1)).min(0).max(50),
    externalAttendees: externalAttendeesSchema.optional(),
    agenda: z.string().max(2000).optional(),
  })
  .refine(hasAnyAttendee, "A meeting needs at least one attendee (internal or external).");
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
    attendeeIds: z.array(z.string().min(1)).min(0).max(50).optional(),
    externalAttendees: externalAttendeesSchema.optional(),
    agenda: z.string().max(2000).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "At least one field must be provided")
  // Only the both-provided-and-both-empty case is decidable here. When just ONE of the two is
  // sent, the request alone can't tell whether the meeting still has attendees — the other list
  // lives on the row — so `updateMeeting` re-checks against the MERGED result.
  .refine(
    (d) =>
      !(d.attendeeIds !== undefined && d.externalAttendees !== undefined && !hasAnyAttendee(d)),
    "A meeting needs at least one attendee (internal or external).",
  );
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

/** Body for `POST /meetings/:id/media/presign` — direct-to-S3 clip upload. */
export const presignMediaInputSchema = z.object({
  contentType: z.string().min(1).max(120),
});
export type PresignMediaInput = z.infer<typeof presignMediaInputSchema>;

/** Body for `DELETE /meetings/:id/media` — remove a discarded clip's S3 object. */
export const deleteMediaInputSchema = z.object({
  key: z.string().min(1).max(512),
});
export type DeleteMediaInput = z.infer<typeof deleteMediaInputSchema>;

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
  assigneeId: z.string().min(1).optional(),
  priority: priorityEnum.optional(),
  targetDate: ymdDateSchema.optional(),
  reasoning: z.string(),
  status: z.enum(["pending", "task_created", "skipped"]).default("pending"),
});
export type MeetingRecommendation = z.infer<typeof meetingRecommendationSchema>;

export const patchRecommendationStatusSchema = z.object({
  status: z.enum(["task_created", "skipped"]),
});
export type PatchRecommendationStatusInput = z.infer<typeof patchRecommendationStatusSchema>;

export const meetingIntentResponseSchema = z.object({
  // false ONLY when the recording had no usable speech (pure silence/noise). We do NOT branch
  // on it — the meeting processes normally and the model's explanatory `summary` IS the result —
  // but keeping it in the schema makes the model reliably emit that explanation. Defaults true so
  // the model may omit it on the happy path.
  hasContent: z.boolean().default(true),
  summary: z.string(),
  actions: z.array(meetingActionSchema),
  recommendations: z.array(meetingRecommendationSchema),
});
export type MeetingIntentResponse = z.infer<typeof meetingIntentResponseSchema>;
