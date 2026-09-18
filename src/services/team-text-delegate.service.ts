import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { AI_THINKING_BUDGET, modelFor, temperatureFor } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { buildTeamTextDelegatePrompt } from "../lib/prompts/team-text-delegate.js";
import { buildDirectoryContext } from "../lib/team-directory.js";
import { generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as textInteractionRepo from "../repositories/text-interaction.repository.js";
import {
  teamTextDelegateResponseSchema,
  type SubmitTeamTextDelegateInput,
} from "../schemas/team-text-delegate.schema.js";
import type { TeamDelegateRecommendation } from "../schemas/team-voice-delegate.schema.js";
import { parseDateString, promptDateAnchors, todayInUserTz } from "../utils/date.js";

import {
  dispatchDelegationAction,
  type PersistedDelegationAction,
} from "./team-action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface TeamTextDelegateResult {
  textInteractionId: string;
  actions: PersistedDelegationAction[];
  recommendations: TeamDelegateRecommendation[];
}

export async function delegateText(
  manager: AuthenticatedUser,
  input: SubmitTeamTextDelegateInput,
): Promise<TeamTextDelegateResult> {
  const today = input.targetDate
    ? parseDateString(input.targetDate)
    : todayInUserTz(DEFAULT_TIMEZONE);

  const directory = await buildDirectoryContext(manager.id);

  const interaction = await textInteractionRepo.create({
    userId: manager.id,
    inputText: input.text,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: modelFor("delegation"),
    prompt: buildTeamTextDelegatePrompt({
      directory,
      selfUserId: manager.id,
      userText: input.text,
      ...promptDateAnchors(today),
    }),
    schema: teamTextDelegateResponseSchema,
    temperature: temperatureFor("delegation"),
    thinkingBudget: AI_THINKING_BUDGET.delegation,
    onRaw: logRaw("team-text", manager.id),
  });

  const persistedActions: PersistedDelegationAction[] = [];
  const extraRecommendations: TeamDelegateRecommendation[] = [];
  for (const action of aiResponse.actions) {
    const result = await dispatchDelegationAction(manager, action, {
      sourceType: "text",
      sourceId: interaction.id,
      today,
    });
    if (result.kind === "action") persistedActions.push(result.action);
    else extraRecommendations.push(result.recommendation);
  }

  const allRecommendations = [...aiResponse.recommendations, ...extraRecommendations];

  await textInteractionRepo.update(interaction.id, {
    actions: persistedActions,
    recommendations: allRecommendations,
  });

  return {
    textInteractionId: interaction.id,
    actions: persistedActions,
    recommendations: allRecommendations,
  };
}
