import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { AI_TEMPERATURE, AI_THINKING_BUDGET, AI_TIMEOUT_MS } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { buildTeamVoiceDelegatePrompt } from "../lib/prompts/team-voice-delegate.js";
import { storeCaptureMedia } from "../lib/store-media.js";
import { buildDirectoryContext } from "../lib/team-directory.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as voiceRepo from "../repositories/voice.repository.js";
import {
  teamVoiceDelegateResponseSchema,
  type SubmitTeamVoiceDelegateInput,
  type TeamDelegateRecommendation,
} from "../schemas/team-voice-delegate.schema.js";
import { parseDateString, promptDateAnchors, todayInUserTz } from "../utils/date.js";

import {
  dispatchDelegationAction,
  type PersistedDelegationAction,
} from "./team-action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface AudioInput {
  buffer: Buffer;
  mimeType: string;
}

export interface TeamVoiceDelegateResult {
  voiceInteractionId: string;
  transcript: string;
  actions: PersistedDelegationAction[];
  recommendations: TeamDelegateRecommendation[];
}

/**
 * Sprint 11: voice delegation. Manager records "Sneha ko ward 12 visit" and
 * the AI emits a `created` action with assigneeId. Hallucinated assignees
 * get routed to recommendations by the shared dispatch.
 */
export async function delegateVoice(
  manager: AuthenticatedUser,
  audio: AudioInput,
  input: SubmitTeamVoiceDelegateInput = {},
): Promise<TeamVoiceDelegateResult> {
  const today = input.targetDate
    ? parseDateString(input.targetDate)
    : todayInUserTz(DEFAULT_TIMEZONE);

  const directory = await buildDirectoryContext(manager.id);

  // Run AI FIRST, then create the row — so a failed/empty call leaves no orphan interaction.
  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildTeamVoiceDelegatePrompt({
      directory,
      selfUserId: manager.id,
      ...promptDateAnchors(today),
    }),
    schema: teamVoiceDelegateResponseSchema,
    media: [{ mimeType: audio.mimeType, buffer: audio.buffer }],
    temperature: AI_TEMPERATURE.delegation,
    thinkingBudget: AI_THINKING_BUDGET.delegation,
    timeoutMs: AI_TIMEOUT_MS.media,
    label: "team-voice",
    onRaw: logRaw("team-voice", manager.id),
  });

  // Audit copy to S3 (best-effort, after AI so a storage hiccup never fails the result).
  const audioUrl = await storeCaptureMedia("voice", manager.orgId, manager.id, audio);

  const interaction = await voiceRepo.create({
    userId: manager.id,
    transcript: aiResponse.transcript,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
    ...(audioUrl !== null ? { audioUrl } : {}),
  });

  const persistedActions: PersistedDelegationAction[] = [];
  const extraRecommendations: TeamDelegateRecommendation[] = [];
  for (const action of aiResponse.actions) {
    const result = await dispatchDelegationAction(manager, action, {
      sourceType: "voice",
      sourceId: interaction.id,
      today,
    });
    if (result.kind === "action") persistedActions.push(result.action);
    else extraRecommendations.push(result.recommendation);
  }

  const allRecommendations = [...aiResponse.recommendations, ...extraRecommendations];

  await voiceRepo.update(interaction.id, {
    actions: persistedActions,
    recommendations: allRecommendations,
  });

  return {
    voiceInteractionId: interaction.id,
    transcript: aiResponse.transcript,
    actions: persistedActions,
    recommendations: allRecommendations,
  };
}
