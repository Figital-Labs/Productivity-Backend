import { enqueueMeeting } from "../jobs/queue.js";
import { AI_TEMPERATURE, AI_THINKING_BUDGET, AI_TIMEOUT_MS } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { AppError, ConflictError, NotFoundError } from "../lib/errors.js";
import { buildMeetingIntentPrompt } from "../lib/prompts/meeting-intent.js";
import type { MeetingAttendee } from "../lib/prompts/meeting-intent.js";
import { storage } from "../lib/storage/index.js";
import { buildMediaKey, extFromMime } from "../lib/storage/keys.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { InlineMedia } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as jobRepo from "../repositories/job.repository.js";
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

export interface EnqueueMeetingResult {
  jobId: string;
  meetingId: string;
  status: string;
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
  caller: { orgId: string },
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
 * Upload each in-memory media buffer to S3 under a tenant/user-namespaced key and return
 * the keys. The bytes leave the web process here; the worker re-reads them for the Vertex
 * call (Gemini can't read `s3://` directly — see ADR-0025 / Appendix A in the plan).
 */
async function uploadMedia(
  caller: { id: string; orgId: string },
  items: InlineMedia[],
): Promise<string[]> {
  const keys: string[] = [];
  for (const item of items) {
    const key = buildMediaKey(caller.orgId, caller.id, extFromMime(item.mimeType));
    await storage.upload(key, item.buffer, {
      contentType: item.mimeType,
      contentLength: item.buffer.length,
    });
    keys.push(key);
  }
  return keys;
}

/**
 * Producer side of meeting processing (ADR-0025). Runs the up-front guards (ownership,
 * already-processed, processability, attendee validation), persists notes, uploads the
 * media to S3, creates the `ProcessingJob` status row, and enqueues the pg-boss job — then
 * returns immediately so the controller can answer 202. The actual Vertex fusion runs in
 * the worker via `runProcessing`. Idempotent on double-tap: an already-active job for the
 * meeting is returned as-is.
 */
export async function enqueueProcessing(
  caller: AuthenticatedUser,
  id: string,
  inputs: ProcessMeetingInputs,
): Promise<EnqueueMeetingResult> {
  const existing = await meetingRepo.findById(id);
  requireOwnership(existing, caller.id);

  if (existing.processedAt !== null) {
    throw new ConflictError(
      "MEETING_ALREADY_PROCESSED",
      "This meeting has already been processed.",
    );
  }

  // Double-tap guard: reuse an in-flight job for this meeting rather than starting a second.
  const active = await jobRepo.findActiveByTarget("meeting", id);
  if (active) {
    return { jobId: active.id, meetingId: id, status: active.status };
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

  // Validate attendees up-front so a bad request fails at enqueue time, not in the worker.
  await validateAttendees(caller, existing.attendeeIds);

  // Persist notes (if provided) BEFORE queueing, so the worker reads them from the row and
  // the auto-save survives even if processing later fails. Idempotent if unchanged.
  if (inputs.notes !== undefined && inputs.notes !== existing.notes) {
    await meetingRepo.update(id, { notes: inputs.notes });
  }

  // Offload the bytes to S3, then create the durable status row + enqueue the work.
  const audioKeys = await uploadMedia(caller, inputs.audioClips);
  const imageKeys = await uploadMedia(caller, inputs.images);

  const job = await jobRepo.create({
    orgId: caller.orgId,
    userId: caller.id,
    kind: "meeting",
    targetType: "meeting",
    targetId: id,
    mediaKeys: [...audioKeys, ...imageKeys],
  });

  try {
    await enqueueMeeting({
      processingJobId: job.id,
      audioKeys,
      imageKeys,
      ...(inputs.customPrompt !== undefined ? { customPrompt: inputs.customPrompt } : {}),
    });
  } catch (err) {
    // Enqueue failed (queue/DB hiccup) — mark the row so the FE doesn't poll forever.
    await jobRepo.markFailed(job.id, err instanceof Error ? err.message : String(err));
    throw err;
  }

  return { jobId: job.id, meetingId: id, status: job.status };
}

/**
 * Consumer side (ADR-0025), invoked by the worker. Runs the meeting through Vertex AI
 * fusion (audio + images + notes + customPrompt → summary + actions + recommendations)
 * and persists the result. All AI actions become recommendations — a manager confirms
 * before any Task is created (no auto-dispatch). The organizer (= caller) is added to the
 * people directory by name, deduped, so the AI can assign to them when named.
 */
export async function runProcessing(
  meetingId: string,
  caller: { id: string; orgId: string },
  media: { audioClips: InlineMedia[]; images: InlineMedia[]; customPrompt: string | undefined },
): Promise<void> {
  const meeting = await meetingRepo.findById(meetingId);
  if (meeting?.deletedAt !== null) {
    throw new NotFoundError("Meeting");
  }

  const attendees = await validateAttendees(caller, meeting.attendeeIds);
  const attendeeDirectory: MeetingAttendee[] = attendees.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
  }));
  if (!attendeeDirectory.some((a) => a.id === caller.id)) {
    const [self] = await userRepo.findByIds([caller.id]);
    if (self) attendeeDirectory.push({ id: self.id, name: self.name, role: self.role });
  }

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const anchors = promptDateAnchors(today);

  const prompt = buildMeetingIntentPrompt({
    attendees: attendeeDirectory,
    selfUserId: caller.id,
    title: meeting.title,
    agenda: meeting.agenda,
    notes: meeting.notes,
    customPrompt: media.customPrompt,
    ...anchors,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt,
    schema: meetingIntentResponseSchema,
    media: [...media.audioClips, ...media.images],
    temperature: AI_TEMPERATURE.meeting,
    thinkingBudget: AI_THINKING_BUDGET.meeting,
    timeoutMs: AI_TIMEOUT_MS.meeting,
    onRaw: logRaw("meeting", caller.id),
  });

  const allowedAssigneeIds = new Set(meeting.attendeeIds);

  // All AI actions become recommendations — manager confirms before any task is created.
  // Preserve the suggested assigneeId when it's a valid attendee or the creator.
  const actionsAsRecommendations: MeetingRecommendation[] = aiResponse.actions.map((action) => {
    const validAssignee =
      allowedAssigneeIds.has(action.assigneeId) || action.assigneeId === meeting.userId;
    return {
      title: action.title,
      reasoning: action.reasoning,
      status: "pending" as const,
      ...(validAssignee ? { assigneeId: action.assigneeId } : {}),
      ...(action.priority !== undefined ? { priority: action.priority } : {}),
      ...(action.targetDate !== undefined ? { targetDate: action.targetDate } : {}),
    };
  });

  const persistedActions: PersistedMeetingAction[] = [];
  const allRecommendations: MeetingRecommendation[] = [
    ...actionsAsRecommendations,
    ...aiResponse.recommendations,
  ];

  await meetingRepo.recordProcessed(meeting.id, {
    summary: aiResponse.summary,
    customPrompt: media.customPrompt,
    actions: persistedActions,
    recommendations: allRecommendations,
  });
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
