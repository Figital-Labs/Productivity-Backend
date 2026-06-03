import { AppError, ConflictError, NotFoundError } from "../lib/errors.js";
import { buildMeetingIntentPrompt } from "../lib/prompts/meeting-intent.js";
import type { MeetingAttendee } from "../lib/prompts/meeting-intent.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { InlineMedia } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import type { Meeting } from "../repositories/meeting.repository.js";
import * as meetingRepo from "../repositories/meeting.repository.js";
import * as userRepo from "../repositories/user.repository.js";
import type {
  CreateMeetingInput,
  MeetingRecommendation,
  PatchRecommendationStatusInput,
  UpdateMeetingInput,
} from "../schemas/meeting.schema.js";
import { meetingIntentResponseSchema } from "../schemas/meeting.schema.js";
import { promptDateAnchors, todayInUserTz } from "../utils/date.js";

import type { PersistedMeetingAction } from "./meeting-action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface HydratedAttendee {
  id: string;
  email: string;
  name: string;
  role: "staff" | "manager" | "admin";
}

export interface HydratedMeeting extends Omit<Meeting, "actions" | "recommendations"> {
  attendees: HydratedAttendee[];
  actions: PersistedMeetingAction[];
  recommendations: MeetingRecommendation[];
}

export interface ProcessMeetingResult {
  meeting: HydratedMeeting;
  actions: PersistedMeetingAction[];
  recommendations: MeetingRecommendation[];
}

export interface ProcessMeetingInputs {
  audioClips: InlineMedia[];
  images: InlineMedia[];
  customPrompt: string | undefined;
  notes: string | undefined;
}

/**
 * Sprint 15: validates that all attendee ids exist and belong to the caller's
 * org. Returns the hydrated rows so the caller can use them for projection.
 * Throws ATTENDEE_NOT_IN_ORG (400) if any id is missing or cross-org. Anti-
 * enumeration: a single bad id fails the request without revealing which.
 */
async function validateAttendees(
  caller: AuthenticatedUser,
  attendeeIds: string[],
): Promise<HydratedAttendee[]> {
  const rows = await userRepo.findByIds(attendeeIds);
  if (rows.length !== attendeeIds.length) {
    throw new AppError("ATTENDEE_NOT_IN_ORG", 400, "One or more attendee ids are not valid users.");
  }
  for (const row of rows) {
    if (row.orgId !== caller.orgId) {
      throw new AppError(
        "ATTENDEE_NOT_IN_ORG",
        400,
        "One or more attendees are not in your organization.",
      );
    }
  }
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as HydratedAttendee["role"],
  }));
}

/**
 * Persisted Meeting + hydrated attendees + typed actions/recommendations.
 */
async function hydrate(meeting: Meeting): Promise<HydratedMeeting> {
  const rows = await userRepo.findByIds(meeting.attendeeIds);
  const attendees: HydratedAttendee[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as HydratedAttendee["role"],
  }));
  return {
    ...meeting,
    attendees,
    actions: (meeting.actions ?? []) as PersistedMeetingAction[],
    recommendations: (meeting.recommendations ?? []) as MeetingRecommendation[],
  };
}

function requireOwnership(meeting: Meeting | null, callerId: string): asserts meeting is Meeting {
  if (meeting?.userId !== callerId || meeting.deletedAt !== null) {
    throw new NotFoundError("Meeting");
  }
}

export async function listMeetings(caller: AuthenticatedUser): Promise<HydratedMeeting[]> {
  const rows = await meetingRepo.listByUser(caller.id);
  return Promise.all(rows.map(hydrate));
}

export async function getMeeting(caller: AuthenticatedUser, id: string): Promise<HydratedMeeting> {
  const row = await meetingRepo.findById(id);
  requireOwnership(row, caller.id);
  return hydrate(row);
}

export async function createMeeting(
  caller: AuthenticatedUser,
  input: CreateMeetingInput,
): Promise<HydratedMeeting> {
  // Validate attendees BEFORE creating the meeting (so we don't persist
  // a half-valid row if the FE typo'd an id).
  await validateAttendees(caller, input.attendeeIds);

  const created = await meetingRepo.create({
    userId: caller.id,
    title: input.title,
    scheduledAt: new Date(input.scheduledAt),
    type: input.type,
    attendeeIds: input.attendeeIds,
    ...(input.agenda !== undefined && { agenda: input.agenda }),
  });
  return hydrate(created);
}

export async function updateMeeting(
  caller: AuthenticatedUser,
  id: string,
  input: UpdateMeetingInput,
): Promise<HydratedMeeting> {
  const existing = await meetingRepo.findById(id);
  requireOwnership(existing, caller.id);

  // After processing, lock attendees/scheduledAt/type — only notes/agenda/title
  // can change. Processed meetings are read-mostly artifacts.
  if (existing.processedAt !== null) {
    const lockedFieldChanged =
      input.attendeeIds !== undefined ||
      input.scheduledAt !== undefined ||
      input.type !== undefined;
    if (lockedFieldChanged) {
      throw new ConflictError(
        "MEETING_ALREADY_PROCESSED",
        "Meeting has already been processed — attendees / scheduled time / type cannot be changed.",
      );
    }
  }

  if (input.attendeeIds !== undefined) {
    await validateAttendees(caller, input.attendeeIds);
  }

  const patched = await meetingRepo.update(id, {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.scheduledAt !== undefined && { scheduledAt: new Date(input.scheduledAt) }),
    ...(input.type !== undefined && { type: input.type }),
    ...(input.attendeeIds !== undefined && { attendeeIds: input.attendeeIds }),
    ...(input.agenda !== undefined && { agenda: input.agenda }),
    ...(input.notes !== undefined && { notes: input.notes }),
  });
  return hydrate(patched);
}

export async function softDeleteMeeting(caller: AuthenticatedUser, id: string): Promise<void> {
  const existing = await meetingRepo.findById(id);
  requireOwnership(existing, caller.id);
  await meetingRepo.softDelete(id);
}

/**
 * The big one: run the meeting through Vertex AI fusion (audio + images +
 * notes + customPrompt → summary + actions + recommendations). Auto-creates
 * Task rows for valid attendee-assigned actions; demotes invalid-assignee
 * actions to recommendations defensively (anti-prompt-injection).
 */
export async function processMeeting(
  caller: AuthenticatedUser,
  id: string,
  inputs: ProcessMeetingInputs,
): Promise<ProcessMeetingResult> {
  const existing = await meetingRepo.findById(id);
  requireOwnership(existing, caller.id);

  if (existing.processedAt !== null) {
    throw new ConflictError(
      "MEETING_ALREADY_PROCESSED",
      "This meeting has already been processed.",
    );
  }

  // Processability gate — must have at least one of audio / notes / images.
  const effectiveNotes = inputs.notes ?? existing.notes ?? undefined;
  const hasAudio = inputs.audioClips.length > 0;
  const hasImages = inputs.images.length > 0;
  const hasNotes = effectiveNotes !== undefined && effectiveNotes.trim().length > 0;
  if (!hasAudio && !hasImages && !hasNotes) {
    throw new AppError(
      "MEETING_NOT_PROCESSABLE",
      400,
      "Meeting must include at least one audio clip, image, or notes before processing.",
    );
  }

  // Persist notes (if provided) BEFORE the AI call, so the auto-save survives
  // even if the AI errors. Idempotent — won't change anything if `notes`
  // wasn't passed in.
  let meetingForPrompt = existing;
  if (inputs.notes !== undefined && inputs.notes !== existing.notes) {
    meetingForPrompt = await meetingRepo.update(id, { notes: inputs.notes });
  }

  const attendees = await validateAttendees(caller, meetingForPrompt.attendeeIds);
  const attendeeDirectory: MeetingAttendee[] = attendees.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
  }));

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const anchors = promptDateAnchors(today);

  const prompt = buildMeetingIntentPrompt({
    attendees: attendeeDirectory,
    selfUserId: caller.id,
    title: meetingForPrompt.title,
    agenda: meetingForPrompt.agenda,
    notes: meetingForPrompt.notes,
    customPrompt: inputs.customPrompt,
    ...anchors,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt,
    schema: meetingIntentResponseSchema,
    media: [...inputs.audioClips, ...inputs.images],
  });

  const allowedAssigneeIds = new Set(meetingForPrompt.attendeeIds);

  // All AI actions become recommendations — manager confirms before any task is created.
  // Preserve the suggested assigneeId when it's a valid attendee or the creator.
  const actionsAsRecommendations: MeetingRecommendation[] = aiResponse.actions.map((action) => ({
    title: action.title,
    reasoning: action.reasoning,
    status: "pending" as const,
    ...(allowedAssigneeIds.has(action.assigneeId) || action.assigneeId === meetingForPrompt.userId
      ? { assigneeId: action.assigneeId }
      : {}),
    ...(action.priority !== undefined ? { priority: action.priority } : {}),
    ...(action.targetDate !== undefined ? { targetDate: action.targetDate } : {}),
  }));

  const persistedActions: PersistedMeetingAction[] = [];
  const allRecommendations: MeetingRecommendation[] = [
    ...actionsAsRecommendations,
    ...aiResponse.recommendations,
  ];

  const updated = await meetingRepo.recordProcessed(meetingForPrompt.id, {
    summary: aiResponse.summary,
    customPrompt: inputs.customPrompt,
    actions: persistedActions,
    recommendations: allRecommendations,
  });

  const meeting = await hydrate(updated);
  return {
    meeting,
    actions: persistedActions,
    recommendations: allRecommendations,
  };
}

export async function patchRecommendationStatus(
  caller: AuthenticatedUser,
  meetingId: string,
  index: number,
  status: PatchRecommendationStatusInput["status"],
): Promise<HydratedMeeting> {
  const existing = await meetingRepo.findById(meetingId);
  requireOwnership(existing, caller.id);
  if (existing.processedAt === null) {
    throw new AppError("MEETING_NOT_PROCESSED", 400, "Meeting has not been processed yet.");
  }
  const updated = await meetingRepo.updateRecommendationStatus(meetingId, index, status);
  if (!updated) {
    throw new NotFoundError("Recommendation");
  }
  return hydrate(updated);
}

// Re-export so callers don't need to know about the dispatch service.
export type { PersistedMeetingAction };
