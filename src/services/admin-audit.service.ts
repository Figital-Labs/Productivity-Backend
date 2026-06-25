import { NotFoundError } from "../lib/errors.js";
import prisma from "../lib/prisma.js";
import { storage } from "../lib/storage/index.js";

// The five AI interaction surfaces we audit.
export type InteractionType = "voice" | "image" | "text" | "unified" | "meeting";
const ALL_TYPES: InteractionType[] = ["voice", "image", "text", "unified", "meeting"];

const SNIPPET_LEN = 160;
function snippet(text: string | null | undefined): string {
  if (!text) return "";
  const t = text.trim();
  return t.length > SNIPPET_LEN ? `${t.slice(0, SNIPPET_LEN)}…` : t;
}
function jsonLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

async function orgUserIds(orgId: string): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } });
  return users.map((u) => u.id);
}

// ── Per-type counters (scoped to a set of users, optionally since a date) ──
function countByType(userIds: string[], since?: Date): Promise<Record<InteractionType, number>> {
  const where = (extra: object = {}) => ({
    userId: { in: userIds },
    ...(since ? { createdAt: { gte: since } } : {}),
    ...extra,
  });
  return Promise.all([
    prisma.voiceInteraction.count({ where: where() }),
    prisma.imageExtraction.count({ where: where() }),
    prisma.textInteraction.count({ where: where() }),
    prisma.unifiedInteraction.count({ where: where() }),
    prisma.meeting.count({ where: where({ deletedAt: null }) }),
  ]).then(([voice, image, text, unified, meeting]) => ({ voice, image, text, unified, meeting }));
}

// ───────────────────────────────────────────────────────────────────────────
// Orgs list — each org with headline audit stats.
// ───────────────────────────────────────────────────────────────────────────
export interface AdminOrgSummary {
  id: string;
  name: string;
  createdAt: string;
  userCount: number;
  taskCount: number;
  ai7d: number;
  ai30d: number;
  aiTaskPct: number; // % of tasks created via an AI surface (sourceType != manual)
  lastActivityAt: string | null;
}

export async function listOrgsWithStats(): Promise<AdminOrgSummary[]> {
  const orgs = await prisma.organization.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });
  return Promise.all(
    orgs.map(async (org) => {
      const userIds = await orgUserIds(org.id);
      if (userIds.length === 0) {
        return {
          id: org.id,
          name: org.name,
          createdAt: org.createdAt.toISOString(),
          userCount: 0,
          taskCount: 0,
          ai7d: 0,
          ai30d: 0,
          aiTaskPct: 0,
          lastActivityAt: null,
        };
      }
      const [taskCount, aiTaskCount, c7, c30, lastTask, lastVoice] = await Promise.all([
        prisma.task.count({ where: { assigneeId: { in: userIds }, deletedAt: null } }),
        prisma.task.count({
          where: { assigneeId: { in: userIds }, deletedAt: null, sourceType: { not: "manual" } },
        }),
        countByType(userIds, daysAgo(7)),
        countByType(userIds, daysAgo(30)),
        prisma.task.findFirst({
          where: { assigneeId: { in: userIds } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        prisma.voiceInteraction.findFirst({
          where: { userId: { in: userIds } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      const sum = (r: Record<InteractionType, number>) => ALL_TYPES.reduce((s, t) => s + r[t], 0);
      const lastDates = [lastTask?.createdAt, lastVoice?.createdAt].filter(Boolean) as Date[];
      const lastActivityAt = lastDates.length
        ? new Date(Math.max(...lastDates.map((d) => d.getTime()))).toISOString()
        : null;
      return {
        id: org.id,
        name: org.name,
        createdAt: org.createdAt.toISOString(),
        userCount: org._count.users,
        taskCount,
        ai7d: sum(c7),
        ai30d: sum(c30),
        aiTaskPct: taskCount === 0 ? 0 : Math.round((aiTaskCount / taskCount) * 100),
        lastActivityAt,
      };
    }),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Org detail + AI usage summary.
// ───────────────────────────────────────────────────────────────────────────
export interface OrgAdmin {
  id: string;
  name: string;
  email: string;
}
export interface AiUsageSummary {
  windowDays: number;
  byType: Record<InteractionType, number>;
  total: number;
  topUsers: { userId: string; name: string; count: number }[];
  emptyOutputRate: number; // % of voice/image/text/unified interactions that produced nothing
  aiTaskPct: number;
}

export async function getOrgDetail(
  orgId: string,
): Promise<{ id: string; name: string; createdAt: string; userCount: number; admins: OrgAdmin[] }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { _count: { select: { users: true } } },
  });
  if (!org) throw new NotFoundError("Organization", orgId);
  const admins = await prisma.user.findMany({
    where: { orgId, level: { gte: 800 } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return {
    id: org.id,
    name: org.name,
    createdAt: org.createdAt.toISOString(),
    userCount: org._count.users,
    admins,
  };
}

export async function getOrgAiUsage(orgId: string, days: number): Promise<AiUsageSummary> {
  const userIds = await orgUserIds(orgId);
  const empty: AiUsageSummary = {
    windowDays: days,
    byType: { voice: 0, image: 0, text: 0, unified: 0, meeting: 0 },
    total: 0,
    topUsers: [],
    emptyOutputRate: 0,
    aiTaskPct: 0,
  };
  if (userIds.length === 0) return empty;
  const since = daysAgo(days);

  const byType = await countByType(userIds, since);
  const total = ALL_TYPES.reduce((s, t) => s + byType[t], 0);

  // Top users by interaction count (group across voice/text/image/unified by userId).
  const [v, i, tx, u, users] = await Promise.all([
    prisma.voiceInteraction.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.imageExtraction.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.textInteraction.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.unifiedInteraction.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(users.map((x) => [x.id, x.name]));
  const tally = new Map<string, number>();
  for (const g of [...v, ...i, ...tx, ...u]) {
    tally.set(g.userId, (tally.get(g.userId) ?? 0) + g._count._all);
  }
  const topUsers = [...tally.entries()]
    .map(([userId, count]) => ({ userId, name: nameOf.get(userId) ?? "Unknown", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Empty-output rate across the 4 task-creating surfaces (meeting excluded —
  // its actions become recommendations the manager confirms later).
  const [vi, ie, ti, ui] = await Promise.all([
    prisma.voiceInteraction.findMany({
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      select: { actions: true, recommendations: true },
    }),
    prisma.imageExtraction.findMany({
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      select: { actions: true, recommendations: true },
    }),
    prisma.textInteraction.findMany({
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      select: { actions: true, recommendations: true },
    }),
    prisma.unifiedInteraction.findMany({
      where: { userId: { in: userIds }, createdAt: { gte: since } },
      select: { actions: true, recommendations: true },
    }),
  ]);
  const surfaced = [...vi, ...ie, ...ti, ...ui];
  const emptyCount = surfaced.filter(
    (r) => jsonLen(r.actions) === 0 && jsonLen(r.recommendations) === 0,
  ).length;
  const emptyOutputRate =
    surfaced.length === 0 ? 0 : Math.round((emptyCount / surfaced.length) * 100);

  const [taskCount, aiTaskCount] = await Promise.all([
    prisma.task.count({ where: { assigneeId: { in: userIds }, deletedAt: null } }),
    prisma.task.count({
      where: { assigneeId: { in: userIds }, deletedAt: null, sourceType: { not: "manual" } },
    }),
  ]);

  return {
    windowDays: days,
    byType,
    total,
    topUsers,
    emptyOutputRate,
    aiTaskPct: taskCount === 0 ? 0 : Math.round((aiTaskCount / taskCount) * 100),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Interactions feed (merge-sorted across surfaces, cursor-paginated by createdAt).
// ───────────────────────────────────────────────────────────────────────────
export interface InteractionListItem {
  id: string;
  type: InteractionType;
  user: { id: string; name: string };
  createdAt: string;
  inputSnippet: string;
  actionCount: number;
  recommendationCount: number;
  hasMedia: boolean;
}
export interface InteractionPage {
  items: InteractionListItem[];
  nextCursor: string | null;
}

export async function listOrgInteractions(
  orgId: string,
  opts: { type?: InteractionType; cursor?: string; limit: number },
): Promise<InteractionPage> {
  const userIds = await orgUserIds(orgId);
  if (userIds.length === 0) return { items: [], nextCursor: null };
  const before = opts.cursor ? new Date(opts.cursor) : undefined;
  const types = opts.type ? [opts.type] : ALL_TYPES;
  const take = opts.limit;

  const baseWhere = (extra: object = {}) => ({
    userId: { in: userIds },
    ...(before ? { createdAt: { lt: before } } : {}),
    ...extra,
  });
  const order = { createdAt: "desc" as const };

  const userRows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(userRows.map((u) => [u.id, u.name]));
  const collected: InteractionListItem[] = [];

  for (const type of types) {
    if (type === "voice") {
      const rows = await prisma.voiceInteraction.findMany({
        where: baseWhere(),
        orderBy: order,
        take,
      });
      for (const r of rows)
        collected.push({
          id: r.id,
          type,
          user: { id: r.userId, name: nameOf.get(r.userId) ?? "Unknown" },
          createdAt: r.createdAt.toISOString(),
          inputSnippet: snippet(r.transcript),
          actionCount: jsonLen(r.actions),
          recommendationCount: jsonLen(r.recommendations),
          hasMedia: !!r.audioUrl,
        });
    } else if (type === "image") {
      const rows = await prisma.imageExtraction.findMany({
        where: baseWhere(),
        orderBy: order,
        take,
      });
      for (const r of rows)
        collected.push({
          id: r.id,
          type,
          user: { id: r.userId, name: nameOf.get(r.userId) ?? "Unknown" },
          createdAt: r.createdAt.toISOString(),
          inputSnippet: snippet(r.extractedText),
          actionCount: jsonLen(r.actions),
          recommendationCount: jsonLen(r.recommendations),
          hasMedia: !!r.imageUrl,
        });
    } else if (type === "text") {
      const rows = await prisma.textInteraction.findMany({
        where: baseWhere(),
        orderBy: order,
        take,
      });
      for (const r of rows)
        collected.push({
          id: r.id,
          type,
          user: { id: r.userId, name: nameOf.get(r.userId) ?? "Unknown" },
          createdAt: r.createdAt.toISOString(),
          inputSnippet: snippet(r.inputText),
          actionCount: jsonLen(r.actions),
          recommendationCount: jsonLen(r.recommendations),
          hasMedia: false,
        });
    } else if (type === "unified") {
      const rows = await prisma.unifiedInteraction.findMany({
        where: baseWhere(),
        orderBy: order,
        take,
      });
      for (const r of rows)
        collected.push({
          id: r.id,
          type,
          user: { id: r.userId, name: nameOf.get(r.userId) ?? "Unknown" },
          createdAt: r.createdAt.toISOString(),
          inputSnippet: snippet(r.inputText),
          actionCount: jsonLen(r.actions),
          recommendationCount: jsonLen(r.recommendations),
          hasMedia: r.audioUrl !== null || r.imageUrl !== null,
        });
    } else {
      const rows = await prisma.meeting.findMany({
        where: baseWhere({ deletedAt: null }),
        orderBy: order,
        take,
      });
      for (const r of rows)
        collected.push({
          id: r.id,
          type,
          user: { id: r.userId, name: nameOf.get(r.userId) ?? "Unknown" },
          createdAt: r.createdAt.toISOString(),
          inputSnippet: snippet(r.title),
          actionCount: jsonLen(r.actions),
          recommendationCount: jsonLen(r.recommendations),
          hasMedia: r.mediaKeys.length > 0,
        });
    }
  }

  collected.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const items = collected.slice(0, take);
  const nextCursor = items.length === take ? (items[items.length - 1]?.createdAt ?? null) : null;
  return { items, nextCursor };
}

// ───────────────────────────────────────────────────────────────────────────
// Single interaction — full input, AI output, and presigned media.
// ───────────────────────────────────────────────────────────────────────────
export interface InteractionDetail {
  id: string;
  type: InteractionType;
  user: { id: string; name: string } | null;
  createdAt: string;
  input: string; // transcript / extractedText / inputText / meeting summary
  actions: unknown[];
  recommendations: unknown[];
  media: { key: string; url: string | null }[];
}

async function signKeys(keys: (string | null | undefined)[]): Promise<InteractionDetail["media"]> {
  const present = keys.filter((k): k is string => !!k);
  return Promise.all(present.map(async (key) => ({ key, url: await storage.signedGetUrl(key) })));
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function getInteractionDetail(
  type: InteractionType,
  id: string,
): Promise<InteractionDetail> {
  const userName = async (userId: string) => {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    return u ? { id: u.id, name: u.name } : null;
  };

  if (type === "voice") {
    const r = await prisma.voiceInteraction.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("VoiceInteraction", id);
    return {
      id: r.id,
      type,
      user: await userName(r.userId),
      createdAt: r.createdAt.toISOString(),
      input: r.transcript,
      actions: asArray(r.actions),
      recommendations: asArray(r.recommendations),
      media: await signKeys([r.audioUrl]),
    };
  }
  if (type === "image") {
    const r = await prisma.imageExtraction.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("ImageExtraction", id);
    return {
      id: r.id,
      type,
      user: await userName(r.userId),
      createdAt: r.createdAt.toISOString(),
      input: r.extractedText ?? "",
      actions: asArray(r.actions),
      recommendations: asArray(r.recommendations),
      media: await signKeys([r.imageUrl]),
    };
  }
  if (type === "text") {
    const r = await prisma.textInteraction.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("TextInteraction", id);
    return {
      id: r.id,
      type,
      user: await userName(r.userId),
      createdAt: r.createdAt.toISOString(),
      input: r.inputText,
      actions: asArray(r.actions),
      recommendations: asArray(r.recommendations),
      media: [],
    };
  }
  if (type === "unified") {
    const r = await prisma.unifiedInteraction.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("UnifiedInteraction", id);
    return {
      id: r.id,
      type,
      user: await userName(r.userId),
      createdAt: r.createdAt.toISOString(),
      input: r.inputText ?? "",
      actions: asArray(r.actions),
      recommendations: asArray(r.recommendations),
      media: await signKeys([r.audioUrl, r.imageUrl]),
    };
  }
  const r = await prisma.meeting.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Meeting", id);
  return {
    id: r.id,
    type,
    user: await userName(r.userId),
    createdAt: r.createdAt.toISOString(),
    input: r.summary ?? r.title,
    actions: asArray(r.actions),
    recommendations: asArray(r.recommendations),
    media: await signKeys(r.mediaKeys),
  };
}
