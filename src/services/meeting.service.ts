import { enqueueMeeting } from "../jobs/queue.js";
import {
  AI_THINKING_BUDGET,
  AI_TIMEOUT_MS,
  modelFor,
  RETRY_PROFILE_FOR,
  temperatureFor,
} from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { AppError, ConflictError, NotFoundError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import prisma from "../lib/prisma.js";
import { buildMeetingIntentPrompt } from "../lib/prompts/meeting-intent.js";
import type { MeetingAttendee } from "../lib/prompts/meeting-intent.js";
import { resolveScope } from "../lib/resolve-scope.js";
import { storage } from "../lib/storage/index.js";
import type { PresignedUpload } from "../lib/storage/index.js";
import {
  buildMediaKey,
  filenameFromKey,
  isSupportedMediaMime,
  mediaKeyPrefix,
} from "../lib/storage/keys.js";
import { generateStructured } from "../lib/vertex.js";
import type { InlineMedia } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as jobRepo from "../repositories/job.repository.js";
import type { Meeting } from "../repositories/meeting.repository.js";
import * as meetingRepo from "../repositories/meeting.repository.js";
import * as userRepo from "../repositories/user.repository.js";
import type {
  ExternalAttendeeInput,
  CreateMeetingInput,
  MeetingRecommendation,
  PatchRecommendationStatusInput,
  UpdateMeetingInput,
} from "../schemas/meeting.schema.js";
import { meetingIntentResponseSchema } from "../schemas/meeting.schema.js";
import { promptDateAnchors, todayInUserTz } from "../utils/date.js";

import { userIdsInScope } from "./dashboard-rollup.service.js";
import type { PersistedMeetingAction } from "./meeting-action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface HydratedAttendee {
  id: string;
  email: string;
  name: string;
  role: "staff" | "manager" | "admin";
}

/**
 * An attendee with no account. Display-only; never sent to the AI (BE-23).
 *
 * `id?: never` is a deliberate COMPILE-TIME guard, not decoration. The prompt builder takes
 * `MeetingAttendee[]`, which requires `id: string` — so this type can never be assigned or spread
 * into the attendee directory without a type error. That is the mechanical stop preventing a
 * future "just include everyone who attended" refactor from feeding Vertex a fabricated id.
 * (There is no test runner in this project, so the type system is the guard.)
 */
export interface ExternalAttendee {
  name: string;
  email?: string;
  id?: never;
}

/**
 * JSONB holds whatever was written, so validate on the way OUT rather than casting. A row written
 * by an older build (or hand-edited in psql) must not be able to crash a meeting fetch — anything
 * malformed is dropped rather than surfaced.
 */
function toExternalAttendees(value: unknown): ExternalAttendee[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ExternalAttendee[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { name, email } = entry as { name?: unknown; email?: unknown };
    if (typeof name !== "string" || name.trim().length === 0) return [];
    return [{ name, ...(typeof email === "string" && email.length > 0 ? { email } : {}) }];
  });
}

export interface HydratedMeeting extends Omit<
  Meeting,
  "actions" | "recommendations" | "externalAttendees"
> {
  attendees: HydratedAttendee[];
  /** People outside the org, kept in their OWN array so no caller can mistake them for users. */
  externalAttendees: ExternalAttendee[];
  actions: PersistedMeetingAction[];
  recommendations: MeetingRecommendation[];
}

export interface EnqueueMeetingResult {
  jobId: string;
  meetingId: string;
  status: string;
}

export interface ProcessMeetingInputs {
  /** S3 keys of clips already uploaded directly from the browser (presigned POST). */
  audioKeys: string[];
  /** Fallback byte clips — clips whose background upload to S3 didn't finish (CORS off etc.). */
  audioClips: InlineMedia[];
  images: InlineMedia[];
  customPrompt: string | undefined;
  notes: string | undefined;
}

export interface MeetingMediaItem {
  key: string;
  /** Short-lived inline play URL (null if storage can't sign — e.g. the disk dev driver). */
  url: string | null;
  /** Short-lived download URL (forces attachment). */
  downloadUrl: string | null;
}

// Vertex inline cap is ~100 MB per request; guard below it (only reachable past ~5 h of audio).
const MAX_INLINE_BYTES = 90 * 1024 * 1024;
// Cheap COUNT proxy used at ENQUEUE so a flood of direct-uploaded clips is rejected before the
// worker downloads them all. Each clip is a deterministic ~0.7 MB at the recorder's fixed 32 kbps,
// so ~150 clips ≈ 7.5 h — comfortably above the 90 MB byte ceiling, which stays the precise gate.
const MAX_MEETING_AUDIO_CLIPS = 150;

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
    externalAttendees: toExternalAttendees(meeting.externalAttendees),
    actions: (meeting.actions ?? []) as PersistedMeetingAction[],
    recommendations: (meeting.recommendations ?? []) as MeetingRecommendation[],
  };
}

function requireOwnership(meeting: Meeting | null, callerId: string): asserts meeting is Meeting {
  if (meeting?.userId !== callerId || meeting.deletedAt !== null) {
    throw new NotFoundError("Meeting");
  }
}

/**
 * Read access to a meeting. Widened from creator-only so a manager or admin can open a meeting
 * belonging to someone they already oversee — previously they could see a `meeting_processed`
 * event in the activity feed but had no way to drill into it.
 *
 * Scope is NOT a new rule invented here: it reuses `resolveScope` + `userIdsInScope`, the same
 * pair the dashboard and activity feed run on. So a viewer sees exactly the people they already
 * see everywhere else — an org admin gets their whole org, a department head only their
 * departments, a manager only their reports. One definition of "who reports to me", not two.
 *
 * Denials throw NotFoundError rather than a 403: a 403 would confirm that a meeting with that id
 * exists, which is itself a leak across orgs.
 *
 * WRITES ARE NOT WIDENED. Every mutation (update, delete, re-process, media upload/delete,
 * recommendation status) still calls `requireOwnership`. An overseer can read what happened;
 * only the owner can change it.
 */
async function requireViewableMeeting(
  caller: AuthenticatedUser,
  meeting: Meeting | null,
): Promise<Meeting> {
  // Returns the meeting rather than asserting: TypeScript does not permit an `asserts` predicate
  // on an async function, since a Promise cannot narrow synchronously at the call site.
  if (meeting?.deletedAt !== null) throw new NotFoundError("Meeting");
  if (meeting.userId === caller.id) return meeting;

  const scope = await resolveScope(caller);
  const visibleUserIds = await userIdsInScope(scope);
  if (!visibleUserIds.includes(meeting.userId)) throw new NotFoundError("Meeting");

  // Audit trail. Meetings hold recordings of real conversations, so a read by someone who was
  // not in the room is worth being able to reconstruct later. Deliberately server-side only —
  // surfacing it to the owner is a separate product decision.
  log.info("meeting", "viewed by overseer", {
    meetingId: meeting.id,
    ownerId: meeting.userId,
    viewerId: caller.id,
    orgId: caller.orgId,
    scope: scope.type,
  });
  return meeting;
}

export async function listMeetings(caller: AuthenticatedUser): Promise<HydratedMeeting[]> {
  const rows = await meetingRepo.listByUser(caller.id);
  return Promise.all(rows.map(hydrate));
}

export async function getMeeting(caller: AuthenticatedUser, id: string): Promise<HydratedMeeting> {
  const row = await requireViewableMeeting(caller, await meetingRepo.findById(id));
  return hydrate(row);
}

/**
 * Audit: presigned GET URLs (inline + download) for every stored clip of a meeting, so the
 * owner can listen to / download exactly what was recorded when a summary is disputed.
 * Owner-scoped; URLs are null when the driver can't sign (disk dev driver).
 */
export async function getMeetingMedia(
  caller: AuthenticatedUser,
  id: string,
): Promise<MeetingMediaItem[]> {
  // Same widened read rule as getMeeting — the recordings ARE "what happened in the meeting",
  // so an overseer who can open the meeting can play them. Uploading or deleting media still
  // requires ownership (presignMeetingMedia / deleteMeetingMedia below).
  const meeting = await requireViewableMeeting(caller, await meetingRepo.findById(id));
  return Promise.all(
    meeting.mediaKeys.map(async (key) => ({
      key,
      url: await storage.signedGetUrl(key),
      downloadUrl: await storage.signedGetUrl(key, 900, { downloadFilename: filenameFromKey(key) }),
    })),
  );
}

/**
 * Direct-to-S3: a presigned POST so the browser uploads a clip straight to S3 as it's recorded.
 * Owner-scoped; the key is server-generated under the meeting's prefix (the client can't choose
 * it) and the POST Policy caps size + content-type. Returns 503 when the driver can't presign —
 * the client then falls back to a byte upload through `/process`.
 */
export async function presignMeetingMedia(
  caller: AuthenticatedUser,
  id: string,
  contentType: string,
): Promise<PresignedUpload> {
  const meeting = await meetingRepo.findById(id);
  requireOwnership(meeting, caller.id);
  if (meeting.processedAt !== null) {
    throw new ConflictError(
      "MEETING_ALREADY_PROCESSED",
      "This meeting has already been processed.",
    );
  }
  const baseType = contentType.split(";")[0]?.trim() ?? "";
  if (!isSupportedMediaMime(baseType)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", 400, `Unsupported media type "${contentType}".`);
  }
  const key = buildMediaKey("meetings", caller.orgId, id, baseType);
  const presigned = await storage.createPresignedUpload(key, baseType);
  if (presigned === null) {
    throw new AppError("STORAGE_NOT_CONFIGURED", 503, "Direct upload is not available.");
  }
  return presigned;
}

/**
 * Discard cleanup: delete a single clip the user removed after it uploaded. Owner-scoped and
 * prefix-validated so a caller can only delete objects under their own meeting.
 */
export async function deleteMeetingMedia(
  caller: AuthenticatedUser,
  id: string,
  key: string,
): Promise<void> {
  const meeting = await meetingRepo.findById(id);
  requireOwnership(meeting, caller.id);
  if (!key.startsWith(mediaKeyPrefix("meetings", caller.orgId, id))) {
    throw new AppError("INVALID_MEDIA_KEY", 400, "Key does not belong to this meeting.");
  }
  await storage.delete(key);
  log.info("meeting", "media deleted", { meetingId: id, userId: caller.id, key });
}

/**
 * Reject an external attendee whose email belongs to a real user IN THE CALLER'S OWN ORG.
 *
 * Adding a colleague as an "external" name is silently wrong: they'd get no meeting access (the
 * ACL is `attendeeIds`) and the AI would never see them, so work they committed to could not be
 * assigned. One explicit error beats that quiet failure.
 *
 * Scoped to the caller's org deliberately — a genuine outsider may well be a user of a DIFFERENT
 * tenant (another hospital that also buys this product). Blocking that would be wrong AND would
 * leak the existence of their account across tenants.
 */
async function assertExternalsAreNotOwnOrgUsers(
  caller: AuthenticatedUser,
  externals: ExternalAttendeeInput[] | undefined,
): Promise<void> {
  const emails = (externals ?? [])
    .map((e) => e.email)
    .filter((e): e is string => typeof e === "string" && e.length > 0);
  if (emails.length === 0) return;

  const clash = await prisma.user.findFirst({
    where: { email: { in: emails }, orgId: caller.orgId },
    select: { email: true, name: true },
  });
  if (clash) {
    throw new ConflictError(
      "EXTERNAL_ATTENDEE_IS_USER",
      `${clash.name} (${clash.email}) is already a user in your organization — add them as a regular attendee so they can see the meeting.`,
    );
  }
}

/** Drop duplicates: by email when present, otherwise by case-insensitive trimmed name. */
function dedupeExternals(externals: ExternalAttendeeInput[]): ExternalAttendeeInput[] {
  const seen = new Set<string>();
  return externals.filter((e) => {
    const key = e.email ?? e.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function createMeeting(
  caller: AuthenticatedUser,
  input: CreateMeetingInput,
): Promise<HydratedMeeting> {
  // Validate attendees BEFORE creating the meeting (so we don't persist
  // a half-valid row if the FE typo'd an id).
  await validateAttendees(caller, input.attendeeIds);
  await assertExternalsAreNotOwnOrgUsers(caller, input.externalAttendees);

  const created = await meetingRepo.create({
    userId: caller.id,
    title: input.title,
    scheduledAt: new Date(input.scheduledAt),
    type: input.type,
    attendeeIds: input.attendeeIds,
    ...(input.externalAttendees !== undefined && {
      externalAttendees: dedupeExternals(input.externalAttendees),
    }),
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
  // OWNER ONLY — deliberately not the widened view rule. An overseer can read a meeting they
  // did not attend; they must never be able to rewrite its title, agenda, notes or attendees.
  requireOwnership(existing, caller.id);

  // After processing, lock attendees/scheduledAt/type — only notes/agenda/title
  // can change. Processed meetings are read-mostly artifacts.
  if (existing.processedAt !== null) {
    const lockedFieldChanged =
      input.attendeeIds !== undefined ||
      input.externalAttendees !== undefined ||
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
  await assertExternalsAreNotOwnOrgUsers(caller, input.externalAttendees);

  // Attendee floor, checked against the MERGED result: a request that clears `attendeeIds` is
  // fine if the row already has externals (and vice versa), so neither list alone is decidable
  // in the schema. Falling back to the stored value is what makes a partial update safe.
  const nextInternal = input.attendeeIds ?? existing.attendeeIds;
  const nextExternal = input.externalAttendees ?? toExternalAttendees(existing.externalAttendees);
  if (nextInternal.length + nextExternal.length === 0) {
    throw new AppError(
      "MEETING_NEEDS_ATTENDEE",
      400,
      "A meeting needs at least one attendee (internal or external).",
    );
  }

  const patched = await meetingRepo.update(id, {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.scheduledAt !== undefined && { scheduledAt: new Date(input.scheduledAt) }),
    ...(input.type !== undefined && { type: input.type }),
    ...(input.attendeeIds !== undefined && { attendeeIds: input.attendeeIds }),
    ...(input.externalAttendees !== undefined && {
      externalAttendees: dedupeExternals(input.externalAttendees),
    }),
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
async function uploadMeetingMedia(
  orgId: string,
  meetingId: string,
  items: InlineMedia[],
): Promise<string[]> {
  const keys: string[] = [];
  for (const item of items) {
    const key = buildMediaKey("meetings", orgId, meetingId, item.mimeType);
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

  // Processability gate — must have at least one of audio (key or bytes) / notes / images.
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

  // Reject an oversized session at ENQUEUE — before the worker downloads ~90 MB only to fail the
  // inline-size check. The in-memory (byte-fallback) clips + images are summed precisely; direct-
  // uploaded clips aren't downloaded here, so they're bounded by COUNT (deterministic ~0.7 MB each).
  // `runProcessing`'s exact MAX_INLINE_BYTES check stays the precise final backstop.
  const knownBytes =
    inputs.audioClips.reduce((n, m) => n + m.buffer.length, 0) +
    inputs.images.reduce((n, m) => n + m.buffer.length, 0);
  const totalAudioClips = inputs.audioKeys.length + inputs.audioClips.length;
  if (knownBytes > MAX_INLINE_BYTES || totalAudioClips > MAX_MEETING_AUDIO_CLIPS) {
    log.warn("meeting", "oversized at enqueue", {
      meetingId: id,
      userId: caller.id,
      knownBytes,
      totalAudioClips,
    });
    throw new AppError(
      "MEETING_PAYLOAD_TOO_LARGE",
      413,
      "This session is too long to process at once. Please split it into shorter meetings.",
    );
  }

  // Anti-tamper: every direct-upload key must live under THIS meeting's prefix.
  const prefix = mediaKeyPrefix("meetings", caller.orgId, id);
  for (const key of inputs.audioKeys) {
    if (!key.startsWith(prefix)) {
      throw new AppError("INVALID_MEDIA_KEY", 400, "An audio key does not belong to this meeting.");
    }
  }

  // Validate attendees up-front so a bad request fails at enqueue time, not in the worker.
  await validateAttendees(caller, existing.attendeeIds);

  // Persist notes (if provided) BEFORE queueing, so the worker reads them from the row and
  // the auto-save survives even if processing later fails. Idempotent if unchanged.
  if (inputs.notes !== undefined && inputs.notes !== existing.notes) {
    await meetingRepo.update(id, { notes: inputs.notes });
  }

  // Direct-uploaded clips are used as-is; only the byte-FALLBACK clips (CORS off / upload didn't
  // finish) are uploaded server-side here. Either way the meeting ends up holding every key.
  const fallbackAudioKeys = await uploadMeetingMedia(caller.orgId, id, inputs.audioClips);
  const imageKeys = await uploadMeetingMedia(caller.orgId, id, inputs.images);
  const audioKeys = [...inputs.audioKeys, ...fallbackAudioKeys];
  const allKeys = [...audioKeys, ...imageKeys];

  // Durable audit trail on the meeting (powers the Media tab) — store-then-process.
  await meetingRepo.updateMediaKeys(id, allKeys);

  const job = await jobRepo.create({
    orgId: caller.orgId,
    userId: caller.id,
    kind: "meeting",
    targetType: "meeting",
    targetId: id,
    mediaKeys: allKeys,
  });

  log.info("meeting", "enqueued", {
    meetingId: id,
    userId: caller.id,
    jobId: job.id,
    directKeys: inputs.audioKeys.length,
    fallbackClips: inputs.audioClips.length,
    images: inputs.images.length,
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
    const message = err instanceof Error ? err.message : String(err);
    await jobRepo.markFailed(job.id, message);
    log.error("meeting", "enqueue failed", { meetingId: id, jobId: job.id, message });
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

  // BE-23 — INTERNAL ATTENDEES ONLY. `meeting.externalAttendees` must never be merged in here:
  // those people have no DB row, so any id we invented would be fiction the model could emit as
  // an `assigneeId`. `validateAttendees` returns real users only, which is what keeps this honest —
  // do not widen it to "everyone who attended" when adding external people to the API response.
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

  const allMedia = [...media.audioClips, ...media.images];
  const totalBytes = allMedia.reduce((n, m) => n + m.buffer.length, 0);
  if (totalBytes > MAX_INLINE_BYTES) {
    log.warn("meeting", "payload too large", { meetingId, userId: caller.id, bytes: totalBytes });
    throw new AppError(
      "MEETING_PAYLOAD_TOO_LARGE",
      413,
      "This session is too long to process at once. Please split it into shorter meetings.",
    );
  }

  log.info("meeting", "ai input", {
    meetingId,
    userId: caller.id,
    clips: media.audioClips.length,
    images: media.images.length,
    bytes: totalBytes,
    notesLen: meeting.notes?.length ?? 0,
  });

  const aiResponse = await generateStructured({
    model: modelFor("meeting"),
    prompt,
    schema: meetingIntentResponseSchema,
    media: allMedia,
    temperature: temperatureFor("meeting"),
    thinkingBudget: AI_THINKING_BUDGET.meeting,
    timeoutMs: AI_TIMEOUT_MS.meeting,
    // Queued work — nobody is blocked on this request, so a transient 429/503 gets a real
    // backoff (2s/10s/30s) instead of the 400ms a synchronous surface uses. jobBudgetSeconds
    // already covers this extra wall-clock.
    retryProfile: RETRY_PROFILE_FOR.meeting,
    label: "meeting",
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

  log.info("meeting", "processed", {
    meetingId: meeting.id,
    userId: caller.id,
    hasContent: aiResponse.hasContent,
    recommendations: allRecommendations.length,
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
