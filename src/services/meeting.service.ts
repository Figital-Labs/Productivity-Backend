import { AI_TEMPERATURE, AI_THINKING_BUDGET, AI_TIMEOUT_MS } from "../lib/ai-config.js";
import { logInput, logRaw } from "../lib/ai-log.js";
import { AppError, ConflictError, NotFoundError } from "../lib/errors.js";
import { buildMeetingIntentPrompt } from "../lib/prompts/meeting-intent.js";
import type { MeetingAttendee } from "../lib/prompts/meeting-intent.js";
import {
  buildMeetingMediaKey,
  createPresignedUpload,
  deleteMedia,
  downloadMedia,
  isStorageConfigured,
  isSupportedMediaMime,
  meetingMediaKeyPrefix,
  signedGetUrl,
  uploadMedia,
} from "../lib/storage/index.js";
import type { PresignedUpload } from "../lib/storage/index.js";
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
  /**
   * false when the recording had no usable speech (silence/noise). The meeting is
   * NOT marked processed in that case; `meeting.summary` carries a friendly
   * explanation so the FE can warn the user and let them re-record.
   */
  hasContent: boolean;
}

export interface ProcessMeetingInputs {
  /** S3 keys of clips already uploaded directly from the browser (presigned POST). */
  audioKeys: string[];
  /** Fallback byte clips — clips whose background upload to S3 didn't finish. */
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

export interface MeetingMediaItem {
  key: string;
  url: string | null;
  downloadUrl: string | null;
}

function filenameFromKey(key: string): string {
  return key.split("/").pop() ?? "recording";
}

/**
 * Wave 2 audit: presigned GET URLs (inline + download) for every stored clip of a meeting,
 * so the owner can listen to / download exactly what was recorded when a summary is disputed.
 * Owner-scoped; URLs are null if S3 isn't configured.
 */
export async function getMeetingMedia(
  caller: AuthenticatedUser,
  id: string,
): Promise<MeetingMediaItem[]> {
  const meeting = await meetingRepo.findById(id);
  requireOwnership(meeting, caller.id);
  return Promise.all(
    meeting.mediaKeys.map(async (key) => ({
      key,
      url: await signedGetUrl(key),
      downloadUrl: await signedGetUrl(key, 900, { downloadFilename: filenameFromKey(key) }),
    })),
  );
}

/**
 * Direct-to-S3: a presigned POST so the browser uploads a clip straight to S3 as it's
 * recorded. Owner-scoped; the key is server-generated under the meeting's prefix so the
 * client can't choose it, and the POST Policy caps size + content-type.
 */
export async function presignMeetingMedia(
  caller: AuthenticatedUser,
  id: string,
  contentType: string,
): Promise<PresignedUpload> {
  const meeting = await meetingRepo.findById(id);
  requireOwnership(meeting, caller.id);
  const baseType = contentType.split(";")[0]?.trim() ?? "";
  if (!isSupportedMediaMime(baseType)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", 400, `Unsupported media type "${contentType}".`);
  }
  const key = buildMeetingMediaKey(caller.orgId, id, baseType);
  const presigned = await createPresignedUpload(key, baseType);
  if (presigned === null) {
    throw new AppError("STORAGE_NOT_CONFIGURED", 503, "Audio storage is not configured.");
  }
  return presigned;
}

/**
 * Discard cleanup: delete a single clip the user removed after it uploaded. Owner-scoped
 * and prefix-validated so a caller can only delete objects under their own meeting.
 */
export async function deleteMeetingMedia(
  caller: AuthenticatedUser,
  id: string,
  key: string,
): Promise<void> {
  const meeting = await meetingRepo.findById(id);
  requireOwnership(meeting, caller.id);
  if (!key.startsWith(meetingMediaKeyPrefix(caller.orgId, id))) {
    throw new AppError("INVALID_MEDIA_KEY", 400, "Key does not belong to this meeting.");
  }
  await deleteMedia(key);
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
  const hasAudio = inputs.audioKeys.length > 0 || inputs.audioClips.length > 0;
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
  // Include the organizer (= caller) in the people directory by NAME, deduped — so the AI
  // can assign to them when they're named, exactly like any other person. No special
  // weighting: they're just another assignable person. (First-person "main kar lunga" is
  // still handled separately via SELF_USER_ID.)
  if (!attendeeDirectory.some((a) => a.id === caller.id)) {
    const [self] = await userRepo.findByIds([caller.id]);
    if (self) attendeeDirectory.push({ id: self.id, name: self.name, role: self.role });
  }

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

  // Resolve audio for Gemini: download the clips already uploaded straight to S3 (validated
  // keys), and keep any fallback byte clips (whose background upload didn't finish). Gemini
  // can't read s3://, so keyed clips must be fetched here.
  const keyPrefix = meetingMediaKeyPrefix(caller.orgId, meetingForPrompt.id);
  for (const key of inputs.audioKeys) {
    if (!key.startsWith(keyPrefix)) {
      throw new AppError("INVALID_MEDIA_KEY", 400, "A media key does not belong to this meeting.");
    }
  }

  const keyedAudio: InlineMedia[] = [];
  if (isStorageConfigured()) {
    for (const key of inputs.audioKeys) {
      const { buffer, contentType } = await downloadMedia(key);
      keyedAudio.push({ buffer, mimeType: contentType });
    }
    // Complete the audit trail: already-uploaded keys + freshly-uploaded fallback clips/images.
    // The upload half is best-effort — a storage hiccup must never block processing.
    const allKeys = [...inputs.audioKeys];
    for (const m of [...inputs.audioClips, ...inputs.images]) {
      try {
        const key = buildMeetingMediaKey(caller.orgId, meetingForPrompt.id, m.mimeType);
        await uploadMedia(key, m.buffer, m.mimeType);
        allKeys.push(key);
      } catch (err) {
        console.warn(`[meeting] S3 fallback upload failed for ${meetingForPrompt.id}`, err);
      }
    }
    if (allKeys.length > 0) {
      await meetingRepo.updateMediaKeys(meetingForPrompt.id, allKeys);
    }
  }

  const media = [...keyedAudio, ...inputs.audioClips, ...inputs.images];

  // Record exactly what's going INTO the model (clip count + bytes + mime + notes length)
  // so an empty/silent-audio result is diagnosable after the fact. Pairs with [ai-meta]
  // (token counts) and [ai-raw] (output) in the logs.
  logInput("meeting", caller.id, {
    audio: [...keyedAudio, ...inputs.audioClips].map((c) => ({
      bytes: c.buffer.length,
      mimeType: c.mimeType,
    })),
    images: inputs.images.map((c) => ({ bytes: c.buffer.length, mimeType: c.mimeType })),
    notesLen: (effectiveNotes ?? "").length,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt,
    schema: meetingIntentResponseSchema,
    media,
    temperature: AI_TEMPERATURE.meeting,
    thinkingBudget: AI_THINKING_BUDGET.meeting,
    // MVP: generous per-attempt ceiling, no async jobs. Keep the default retry — a
    // connect timeout fails fast/cheap, and retrying is what pushes a meeting through
    // the intermittent connect flakiness on a constrained host.
    timeoutMs: AI_TIMEOUT_MS.meeting,
    onRaw: logRaw("meeting", caller.id),
  });

  // Note: a no-content result (silence/noise) is processed like any other meeting — the
  // model's explanation IS the summary (see meeting-intent.ts), so the meeting resolves to
  // History with a clear note and the stored audio can be audited, instead of looping on a
  // "record again" dead-end.

  const allowedAssigneeIds = new Set(meetingForPrompt.attendeeIds);

  // All AI actions become recommendations — manager confirms before any task is created.
  // Preserve the suggested assigneeId when it's a valid attendee or the creator.
  const actionsAsRecommendations: MeetingRecommendation[] = aiResponse.actions.map((action) => {
    const validAssignee =
      allowedAssigneeIds.has(action.assigneeId) || action.assigneeId === meetingForPrompt.userId;
    return {
      title: action.title,
      // Keep the model's user-facing reasoning as-is. When the named person isn't a
      // meeting attendee we simply drop the assigneeId (unknown user) — the recommendation
      // comes back unassigned and the manager picks an owner. We do NOT append a mechanical
      // "not in attendees" note; the prompt's reasoning rule keeps the card human.
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
    hasContent: aiResponse.hasContent,
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
