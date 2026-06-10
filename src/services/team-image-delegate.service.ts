import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { AI_TEMPERATURE, AI_THINKING_BUDGET } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { buildTeamImageDelegatePrompt } from "../lib/prompts/team-image-delegate.js";
import { buildDirectoryContext } from "../lib/team-directory.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as imageRepo from "../repositories/image.repository.js";
import {
  teamImageDelegateResponseSchema,
  type SubmitTeamImageDelegateInput,
} from "../schemas/team-image-delegate.schema.js";
import type { TeamDelegateRecommendation } from "../schemas/team-voice-delegate.schema.js";
import { parseDateString, promptDateAnchors, todayInUserTz } from "../utils/date.js";

import {
  dispatchDelegationAction,
  type PersistedDelegationAction,
} from "./team-action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface ImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface TeamImageDelegateResult {
  imageExtractionId: string;
  extractedText: string;
  actions: PersistedDelegationAction[];
  recommendations: TeamDelegateRecommendation[];
}

export async function delegateImage(
  manager: AuthenticatedUser,
  image: ImageInput,
  input: SubmitTeamImageDelegateInput = {},
): Promise<TeamImageDelegateResult> {
  const today = input.targetDate
    ? parseDateString(input.targetDate)
    : todayInUserTz(DEFAULT_TIMEZONE);

  const directory = await buildDirectoryContext(manager.id);

  const interaction = await imageRepo.create({
    userId: manager.id,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildTeamImageDelegatePrompt({
      directory,
      selfUserId: manager.id,
      ...promptDateAnchors(today),
    }),
    schema: teamImageDelegateResponseSchema,
    media: [{ mimeType: image.mimeType, buffer: image.buffer }],
    temperature: AI_TEMPERATURE.delegation,
    thinkingBudget: AI_THINKING_BUDGET.delegation,
    onRaw: logRaw("team-image", manager.id),
  });

  const persistedActions: PersistedDelegationAction[] = [];
  const extraRecommendations: TeamDelegateRecommendation[] = [];
  for (const action of aiResponse.actions) {
    const result = await dispatchDelegationAction(manager, action, {
      sourceType: "image",
      sourceId: interaction.id,
      today,
    });
    if (result.kind === "action") persistedActions.push(result.action);
    else extraRecommendations.push(result.recommendation);
  }

  const allRecommendations = [...aiResponse.recommendations, ...extraRecommendations];

  await imageRepo.update(interaction.id, {
    extractedText: aiResponse.extractedText,
    actions: persistedActions,
    recommendations: allRecommendations,
  });

  return {
    imageExtractionId: interaction.id,
    extractedText: aiResponse.extractedText,
    actions: persistedActions,
    recommendations: allRecommendations,
  };
}
