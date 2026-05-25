import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { buildTeamVoiceDelegatePrompt } from "../lib/prompts/team-voice-delegate.js";
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

  const interaction = await voiceRepo.create({
    userId: manager.id,
    transcript: "",
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildTeamVoiceDelegatePrompt({
      directory,
      selfUserId: manager.id,
      ...promptDateAnchors(today),
    }),
    schema: teamVoiceDelegateResponseSchema,
    media: [{ mimeType: audio.mimeType, buffer: audio.buffer }],
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
    transcript: aiResponse.transcript,
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
