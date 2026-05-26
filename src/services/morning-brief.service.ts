import { AppError, ForbiddenError } from "../lib/errors.js";
import prisma from "../lib/prisma.js";
import { buildMorningBriefPrompt } from "../lib/prompts/morning-brief.js";
import { resolveScope } from "../lib/resolve-scope.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as briefRepo from "../repositories/morning-brief.repository.js";
import {
  morningBriefResponseSchema,
  type MorningBriefPayload,
} from "../schemas/dashboard.schema.js";
import { formatDateYmd, todayInUserTz } from "../utils/date.js";

import {
  consistencyForUsers,
  kpisForUsers,
  trendForUsers,
  userIdsInScope,
} from "./dashboard-rollup.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const REFRESH_COOLDOWN_MS = 60_000;
const DEVANAGARI_RE = /[\u0900-\u097F]/g;

export interface MorningBrief extends MorningBriefPayload {
  generatedAt: string;
  fromCache: boolean;
}

function payloadFromCache(raw: unknown): MorningBriefPayload | null {
  const parsed = morningBriefResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function fallbackBrief(
  payload: MorningBriefPayload,
  userIds: string[],
  generatedAt: string,
  fromCache: boolean,
): MorningBrief {
  return {
    ...payload,
    topPerformers: payload.topPerformers.filter((person) => userIds.includes(person.userId)),
    needsAttention: payload.needsAttention.filter((person) => userIds.includes(person.userId)),
    generatedAt,
    fromCache,
  };
}

export async function getMorningBrief(
  user: AuthenticatedUser,
  force = false,
): Promise<MorningBrief> {
  const today = todayInUserTz(DEFAULT_TIMEZONE);

  if (!force) {
    const cached = await briefRepo.findCache(user.id, today);
    const payload = cached ? payloadFromCache(cached.payload) : null;
    if (cached && payload) {
      return { ...payload, generatedAt: cached.generatedAt.toISOString(), fromCache: true };
    }
  }

  if (force) {
    const latest = await briefRepo.lastGeneratedAt(user.id);
    if (latest && Date.now() - latest.generatedAt.getTime() < REFRESH_COOLDOWN_MS) {
      const seconds = Math.ceil(
        (REFRESH_COOLDOWN_MS - (Date.now() - latest.generatedAt.getTime())) / 1000,
      );
      throw new AppError(
        "RATE_LIMITED",
        429,
        `Refresh available in ${seconds.toString()} seconds.`,
      );
    }
  }

  const scope = await resolveScope(user);
  if (scope.type === "none") throw new ForbiddenError();
  const userIds = await userIdsInScope(scope);
  const [kpis, trend, consistency, managerRow] = await Promise.all([
    kpisForUsers(userIds),
    trendForUsers(userIds, "tasks", 7),
    consistencyForUsers(userIds, 7),
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
  ]);

  const topPerformers = consistency
    .filter((row) => row.planMissedDays === 0 && row.closureMissedDays === 0)
    .slice(0, 3)
    .map((row) => ({ userId: row.user.id, name: row.user.name }));
  const peopleToWatch = consistency
    .filter((row) => row.planMissedDays + row.closureMissedDays > 0)
    .slice(0, 3);

  const prompt = buildMorningBriefPrompt({
    today: formatDateYmd(today),
    managerName: managerRow?.name ?? "Manager",
    scopeLabel: scope.type,
    kpis,
    trend,
    peopleToWatch,
    topPerformers,
    activityHighlights: [],
  });

  let payload = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt,
    schema: morningBriefResponseSchema,
  });

  if (DEVANAGARI_RE.test(payload.summaryHinglish)) {
    payload = {
      ...payload,
      summaryHinglish: payload.summaryHinglish.replace(DEVANAGARI_RE, ""),
    };
  }

  const saved = await briefRepo.upsertCache(user.id, today, payload);
  return fallbackBrief(payload, userIds, saved.generatedAt.toISOString(), false);
}
