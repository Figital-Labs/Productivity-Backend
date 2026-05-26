/**
 * Sprint 16A demo seed. Creates/updates the KIMS Hospital demo org with:
 * - 18 users (1 admin, 6 managers, 11 staff)
 * - matrix manager/report edges from Sprint 11 plus Ops/GRE additions
 * - departments, context groups, active memberships
 * - 8 days of backdated task/submission history with deliberate gaps
 *
 * Run idempotently:
 *
 *   npx tsx prisma/seed-hierarchy.ts
 *
 * Login credentials for every seeded user: password = "kims2026"
 * Emails follow the pattern `<firstname>@kims.demo` (lowercase, no dot).
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/tasklist";
const ORG_ID = "kims-hospital";
const PASSWORD_PLAIN = "kims2026";
const SEED_SOURCE_PREFIX = "sprint16a-seed";
const MEMBERSHIP_VALID_FROM = new Date("2026-05-15T00:00:00.000Z");

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type SeedRole = "staff" | "manager" | "admin";

interface SeedUser {
  email: string;
  name: string;
  role: SeedRole;
}

interface DepartmentSeed {
  name: string;
  headEmail: string;
}

interface GroupSeed {
  key: string;
  name: string;
  kind: string;
  departmentName: string;
}

interface MembershipSeed {
  email: string;
  groupKey: string;
  isLead?: boolean;
  canManage?: boolean;
  reason?: string;
}

const USERS: SeedUser[] = [
  { email: "iyer@kims.demo", name: "Dr. Iyer (Medical Director)", role: "admin" },
  { email: "sharma@kims.demo", name: "Dr. Sharma (Consultant, Medicine)", role: "manager" },
  { email: "mehta@kims.demo", name: "Dr. Mehta (Consultant, Surgery)", role: "manager" },
  { email: "rahul@kims.demo", name: "Rahul (Head Nurse, Ward 12)", role: "manager" },
  { email: "priya@kims.demo", name: "Priya (Head Nurse, OT)", role: "manager" },
  { email: "krishnan@kims.demo", name: "Dr. Krishnan (Operations HOD)", role: "manager" },
  { email: "reddy@kims.demo", name: "Ms. Reddy (GRE Head)", role: "manager" },
  { email: "sneha@kims.demo", name: "Sister Sneha", role: "staff" },
  { email: "amit@kims.demo", name: "Ward Boy Amit", role: "staff" },
  { email: "anita@kims.demo", name: "Sister Anita", role: "staff" },
  { email: "vikram@kims.demo", name: "Ward Boy Vikram", role: "staff" },
  { email: "deepika@kims.demo", name: "Sister Deepika", role: "staff" },
  { email: "kavita@kims.demo", name: "Sister Kavita", role: "staff" },
  { email: "suresh@kims.demo", name: "Compounder Suresh", role: "staff" },
  { email: "manoj@kims.demo", name: "Ward Boy Manoj", role: "staff" },
  { email: "ravi@kims.demo", name: "Ravi (Operations Attendant)", role: "staff" },
  { email: "anjali@kims.demo", name: "Anjali (GRE Front Desk)", role: "staff" },
  { email: "pooja@kims.demo", name: "Pooja (IPD Coordinator)", role: "staff" },
];

// Matrix relationships: assignee -> list of manager emails.
// Existing Sprint 11 edges stay intact; new Ops/GRE edges are appended.
const HIERARCHY: Record<string, string[]> = {
  "sneha@kims.demo": ["sharma@kims.demo", "rahul@kims.demo"],
  "amit@kims.demo": ["sharma@kims.demo", "rahul@kims.demo"],
  "anita@kims.demo": ["mehta@kims.demo", "priya@kims.demo"],
  "vikram@kims.demo": ["mehta@kims.demo", "priya@kims.demo"],
  "deepika@kims.demo": ["rahul@kims.demo"],
  "kavita@kims.demo": ["priya@kims.demo"],
  "suresh@kims.demo": ["sharma@kims.demo"],
  "manoj@kims.demo": ["mehta@kims.demo"],
  "ravi@kims.demo": ["krishnan@kims.demo"],
  "anjali@kims.demo": ["reddy@kims.demo"],
  "pooja@kims.demo": ["reddy@kims.demo"],
};

const DEPARTMENTS: DepartmentSeed[] = [
  { name: "Medicine", headEmail: "sharma@kims.demo" },
  { name: "Surgery", headEmail: "mehta@kims.demo" },
  { name: "Nursing", headEmail: "rahul@kims.demo" },
  { name: "Operations", headEmail: "krishnan@kims.demo" },
  { name: "GRE", headEmail: "reddy@kims.demo" },
];

const GROUPS: GroupSeed[] = [
  {
    key: "ward-12",
    name: "Ward 12 - General Medicine",
    kind: "ward",
    departmentName: "Medicine",
  },
  { key: "icu-a", name: "ICU-A - Critical Care", kind: "ward", departmentName: "Medicine" },
  { key: "ot-2", name: "OT-2 - Ortho", kind: "ot", departmentName: "Surgery" },
  {
    key: "night-shift-ward-12",
    name: "Night Shift - Ward 12",
    kind: "shift",
    departmentName: "Nursing",
  },
  { key: "ot-nursing-pool", name: "OT Nursing Pool", kind: "ot", departmentName: "Nursing" },
  { key: "gre-front-desk", name: "GRE Front Desk", kind: "project", departmentName: "GRE" },
  {
    key: "ops-maintenance",
    name: "Ops Maintenance",
    kind: "project",
    departmentName: "Operations",
  },
];

const MEMBERSHIPS: MembershipSeed[] = [
  { email: "iyer@kims.demo", groupKey: "ward-12", canManage: true, reason: "executive oversight" },
  { email: "iyer@kims.demo", groupKey: "icu-a", canManage: true, reason: "executive oversight" },
  { email: "iyer@kims.demo", groupKey: "ot-2", canManage: true, reason: "executive oversight" },
  {
    email: "iyer@kims.demo",
    groupKey: "night-shift-ward-12",
    canManage: true,
    reason: "executive oversight",
  },
  {
    email: "iyer@kims.demo",
    groupKey: "ot-nursing-pool",
    canManage: true,
    reason: "executive oversight",
  },
  {
    email: "iyer@kims.demo",
    groupKey: "gre-front-desk",
    canManage: true,
    reason: "executive oversight",
  },
  {
    email: "iyer@kims.demo",
    groupKey: "ops-maintenance",
    canManage: true,
    reason: "executive oversight",
  },
  { email: "sharma@kims.demo", groupKey: "icu-a", isLead: true, canManage: true },
  { email: "sharma@kims.demo", groupKey: "ward-12" },
  { email: "mehta@kims.demo", groupKey: "ot-2", canManage: true },
  { email: "rahul@kims.demo", groupKey: "ward-12", isLead: true, canManage: true },
  { email: "rahul@kims.demo", groupKey: "night-shift-ward-12", isLead: true, canManage: true },
  { email: "priya@kims.demo", groupKey: "ot-2", isLead: true, canManage: true },
  { email: "priya@kims.demo", groupKey: "ot-nursing-pool", isLead: true, canManage: true },
  { email: "krishnan@kims.demo", groupKey: "ops-maintenance", isLead: true, canManage: true },
  { email: "reddy@kims.demo", groupKey: "gre-front-desk", isLead: true, canManage: true },
  { email: "sneha@kims.demo", groupKey: "ward-12" },
  { email: "sneha@kims.demo", groupKey: "night-shift-ward-12" },
  { email: "amit@kims.demo", groupKey: "ward-12" },
  { email: "anita@kims.demo", groupKey: "ot-2" },
  { email: "anita@kims.demo", groupKey: "ot-nursing-pool" },
  { email: "vikram@kims.demo", groupKey: "ot-2" },
  { email: "deepika@kims.demo", groupKey: "ward-12" },
  { email: "kavita@kims.demo", groupKey: "ot-nursing-pool" },
  { email: "suresh@kims.demo", groupKey: "icu-a" },
  { email: "manoj@kims.demo", groupKey: "ot-2" },
  { email: "ravi@kims.demo", groupKey: "ops-maintenance" },
  { email: "anjali@kims.demo", groupKey: "gre-front-desk" },
  { email: "pooja@kims.demo", groupKey: "gre-front-desk" },
];

const TASK_TITLES = [
  "Review morning patient chart",
  "Coordinate discharge paperwork",
  "Follow up on lab report",
  "Medication round verification",
  "Prepare shift handover notes",
  "Update family counselling status",
  "Check equipment readiness",
  "Confirm consultant callback",
];

const PLAN_GAPS: Record<string, number[]> = {
  "sneha@kims.demo": [2, 4],
  "amit@kims.demo": [3],
  "suresh@kims.demo": [5],
};

const CLOSURE_GAPS: Record<string, number[]> = {
  "amit@kims.demo": [3, 6],
  "vikram@kims.demo": [1, 3],
  "manoj@kims.demo": [4],
  "pooja@kims.demo": [2],
};

const MEETING_TITLES = ["Daily bed-flow huddle", "OT turnaround review", "GRE escalation sync"];

function roleToLevel(role: SeedRole): number {
  if (role === "admin") return 800;
  if (role === "manager") return 400;
  return 100;
}

function userId(email: string, byEmail: Map<string, string>): string {
  const id = byEmail.get(email);
  if (!id) {
    throw new Error(`Missing seeded user ${email}`);
  }
  return id;
}

function groupId(key: string, byKey: Map<string, string>): string {
  const id = byKey.get(key);
  if (!id) {
    throw new Error(`Missing seeded group ${key}`);
  }
  return id;
}

function dateOnlyUtc(source: Date): Date {
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function addUtcDays(source: Date, days: number): Date {
  const date = new Date(source);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shouldSkip(
  gaps: Record<string, number[]>,
  email: string,
  offsetFromToday: number,
): boolean {
  return gaps[email]?.includes(offsetFromToday) ?? false;
}

async function cleanSprint16ASeedData(historyDates: Date[]): Promise<void> {
  await prisma.submissionReview.deleteMany({
    where: { reviewer: { orgId: ORG_ID } },
  });
  await prisma.reminderIntent.deleteMany({
    where: { target: { orgId: ORG_ID } },
  });
  await prisma.task.deleteMany({
    where: {
      assignee: { orgId: ORG_ID },
      sourceId: { startsWith: SEED_SOURCE_PREFIX },
    },
  });
  await prisma.voiceInteraction.deleteMany({
    where: {
      user: { orgId: ORG_ID },
      transcript: { startsWith: "[Sprint16A seed]" },
    },
  });
  await prisma.textInteraction.deleteMany({
    where: {
      user: { orgId: ORG_ID },
      inputText: { startsWith: "[Sprint16A seed]" },
    },
  });
  await prisma.imageExtraction.deleteMany({
    where: {
      user: { orgId: ORG_ID },
      extractedText: { startsWith: "[Sprint16A seed]" },
    },
  });
  await prisma.meeting.deleteMany({
    where: {
      user: { orgId: ORG_ID },
      title: { in: MEETING_TITLES },
    },
  });
  await prisma.dayPlanSubmission.deleteMany({
    where: {
      user: { orgId: ORG_ID },
      date: { in: historyDates },
    },
  });
  await prisma.dayClosureSubmission.deleteMany({
    where: {
      user: { orgId: ORG_ID },
      date: { in: historyDates },
    },
  });
  await prisma.groupMembership.deleteMany({
    where: { group: { orgId: ORG_ID } },
  });
  await prisma.contextGroup.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.department.deleteMany({ where: { orgId: ORG_ID } });
}

async function upsertUsers(passwordHash: string): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>();
  for (const user of USERS) {
    const row = await prisma.user.upsert({
      where: { email: user.email },
      create: {
        email: user.email,
        name: user.name,
        passwordHash,
        role: user.role,
        level: roleToLevel(user.role),
        orgId: ORG_ID,
      },
      update: {
        name: user.name,
        passwordHash,
        role: user.role,
        level: roleToLevel(user.role),
        orgId: ORG_ID,
      },
    });
    byEmail.set(user.email, row.id);
  }
  return byEmail;
}

async function wireHierarchy(byEmail: Map<string, string>): Promise<void> {
  for (const [staffEmail, managerEmails] of Object.entries(HIERARCHY)) {
    const staffId = userId(staffEmail, byEmail);
    for (const managerEmail of managerEmails) {
      const managerId = userId(managerEmail, byEmail);
      await prisma.$executeRaw`
        INSERT INTO "_UserHierarchy" ("A", "B")
        VALUES (${managerId}, ${staffId})
        ON CONFLICT DO NOTHING
      `;
    }
  }
}

async function createDepartments(byEmail: Map<string, string>): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const department of DEPARTMENTS) {
    const row = await prisma.department.create({
      data: {
        orgId: ORG_ID,
        name: department.name,
        headId: userId(department.headEmail, byEmail),
      },
    });
    byName.set(department.name, row.id);
  }
  return byName;
}

async function createGroups(departmentByName: Map<string, string>): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const group of GROUPS) {
    const departmentId = departmentByName.get(group.departmentName);
    if (!departmentId) {
      throw new Error(`Missing department ${group.departmentName}`);
    }
    const row = await prisma.contextGroup.create({
      data: {
        orgId: ORG_ID,
        departmentId,
        name: group.name,
        kind: group.kind,
      },
    });
    byKey.set(group.key, row.id);
  }
  return byKey;
}

async function createMemberships(
  byEmail: Map<string, string>,
  groupByKey: Map<string, string>,
): Promise<void> {
  for (const membership of MEMBERSHIPS) {
    await prisma.groupMembership.create({
      data: {
        userId: userId(membership.email, byEmail),
        groupId: groupId(membership.groupKey, groupByKey),
        validFrom: MEMBERSHIP_VALID_FROM,
        validTo: null,
        isLead: membership.isLead ?? false,
        canManage: membership.canManage ?? false,
        reason: membership.reason,
      },
    });
  }
}

async function createHistoricalTasksAndSubmissions(
  byEmail: Map<string, string>,
  historyDates: Date[],
): Promise<void> {
  const activeUsers = USERS.filter((user) => user.role !== "admin");

  for (const [userIndex, user] of activeUsers.entries()) {
    const assigneeId = userId(user.email, byEmail);
    for (const [dayIndex, date] of historyDates.entries()) {
      const offsetFromToday = historyDates.length - dayIndex;
      const plannedTitles: string[] = [];
      const taskCount = 3 + ((userIndex + dayIndex) % 4);

      for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
        const stateIndex = (userIndex + dayIndex + taskIndex) % 20;
        const isPartial = stateIndex >= 14 && stateIndex <= 16;
        const completed = stateIndex < 14;
        const title = `${TASK_TITLES[(userIndex + taskIndex) % TASK_TITLES.length]} - ${user.name}`;
        plannedTitles.push(title);

        await prisma.task.create({
          data: {
            assigneeId,
            creatorId: assigneeId,
            title,
            targetDate: date,
            priority: taskIndex === 0 && dayIndex % 3 === 0 ? "high" : null,
            completed,
            isPartial,
            notes: isPartial ? "Partial progress logged during closure." : null,
            sourceType: ["manual", "voice", "text"][(userIndex + taskIndex) % 3] ?? "manual",
            sourceId: `${SEED_SOURCE_PREFIX}:${dateKey(date)}:${user.email}:${taskIndex}`,
            createdAt: addUtcDays(date, 0),
            updatedAt: addUtcDays(date, 0),
          },
        });
      }

      if (!shouldSkip(PLAN_GAPS, user.email, offsetFromToday)) {
        await prisma.dayPlanSubmission.create({
          data: {
            userId: assigneeId,
            date,
            submittedAt: addUtcDays(date, 0),
            taskSnapshot: plannedTitles.map((title) => ({ title, targetDate: dateKey(date) })),
          },
        });
      }

      if (!shouldSkip(CLOSURE_GAPS, user.email, offsetFromToday)) {
        await prisma.dayClosureSubmission.create({
          data: {
            userId: assigneeId,
            date,
            submittedAt: addUtcDays(date, 0),
            commentary: "Routine closure submitted for dashboard seed.",
            aiFeedback: {
              summary: "Aaj ka kaam mostly track par raha.",
              achievements: plannedTitles.slice(0, 2),
              missed: plannedTitles.slice(-1),
              tips: ["Kal ke liye handover thoda earlier close karo."],
            },
            mediaIds: [],
          },
        });
      }
    }
  }
}

async function createSeedInteractions(
  byEmail: Map<string, string>,
  historyDates: Date[],
): Promise<void> {
  const rows = [
    { email: "sharma@kims.demo", date: historyDates[0], kind: "voice" },
    { email: "rahul@kims.demo", date: historyDates[1], kind: "text" },
    { email: "priya@kims.demo", date: historyDates[2], kind: "image" },
    { email: "mehta@kims.demo", date: historyDates[3], kind: "voice" },
    { email: "krishnan@kims.demo", date: historyDates[4], kind: "text" },
    { email: "reddy@kims.demo", date: historyDates[5], kind: "image" },
    { email: "rahul@kims.demo", date: historyDates[6], kind: "voice" },
    { email: "sharma@kims.demo", date: historyDates[7], kind: "text" },
  ] as const;

  for (const row of rows) {
    const user = userId(row.email, byEmail);
    if (row.kind === "voice") {
      await prisma.voiceInteraction.create({
        data: {
          userId: user,
          transcript: `[Sprint16A seed] ${row.email} delegated morning follow-ups.`,
          actions: [],
          recommendations: [],
          createdAt: row.date,
        },
      });
    } else if (row.kind === "text") {
      await prisma.textInteraction.create({
        data: {
          userId: user,
          inputText: `[Sprint16A seed] Summarise pending ward priorities.`,
          actions: [],
          recommendations: [],
          createdAt: row.date,
        },
      });
    } else {
      await prisma.imageExtraction.create({
        data: {
          userId: user,
          extractedText: `[Sprint16A seed] Uploaded handwritten shift list.`,
          actions: [],
          recommendations: [],
          createdAt: row.date,
        },
      });
    }
  }
}

async function createSeedMeetings(byEmail: Map<string, string>, today: Date): Promise<void> {
  const meetings = [
    {
      title: MEETING_TITLES[0] ?? "Daily bed-flow huddle",
      owner: "iyer@kims.demo",
      offset: -1,
      attendees: ["sharma@kims.demo", "rahul@kims.demo", "krishnan@kims.demo"],
      summary: "Bed flow reviewed, Medicine and Nursing handover aligned.",
    },
    {
      title: MEETING_TITLES[1] ?? "OT turnaround review",
      owner: "mehta@kims.demo",
      offset: -2,
      attendees: ["priya@kims.demo", "anita@kims.demo", "manoj@kims.demo"],
      summary: "OT-2 turnaround blockers identified and assigned.",
    },
    {
      title: MEETING_TITLES[2] ?? "GRE escalation sync",
      owner: "reddy@kims.demo",
      offset: -3,
      attendees: ["anjali@kims.demo", "pooja@kims.demo"],
      summary: "Front desk escalations grouped by discharge and billing queues.",
    },
  ];

  for (const meeting of meetings) {
    const scheduledAt = addUtcDays(today, meeting.offset);
    await prisma.meeting.create({
      data: {
        userId: userId(meeting.owner, byEmail),
        title: meeting.title,
        scheduledAt,
        type: "huddle",
        attendeeIds: meeting.attendees.map((email) => userId(email, byEmail)),
        agenda: "Dashboard seed meeting for management rollup.",
        notes: "Seeded notes for processed meeting activity.",
        summary: meeting.summary,
        actions: [],
        recommendations: [],
        processedAt: scheduledAt,
      },
    });
  }
}

async function main(): Promise<void> {
  const today = dateOnlyUtc(new Date());
  const historyDates = Array.from({ length: 8 }, (_, index) => addUtcDays(today, -(8 - index)));
  const passwordHash = await hashPassword(PASSWORD_PLAIN);

  await cleanSprint16ASeedData(historyDates);

  const byEmail = await upsertUsers(passwordHash);
  await wireHierarchy(byEmail);
  const departmentByName = await createDepartments(byEmail);
  const groupByKey = await createGroups(departmentByName);
  await createMemberships(byEmail, groupByKey);
  await createHistoricalTasksAndSubmissions(byEmail, historyDates);
  await createSeedInteractions(byEmail, historyDates);
  await createSeedMeetings(byEmail, today);

  const [userCount, departmentCount, groupCount, membershipCount, taskCount] = await Promise.all([
    prisma.user.count({ where: { orgId: ORG_ID } }),
    prisma.department.count({ where: { orgId: ORG_ID } }),
    prisma.contextGroup.count({ where: { orgId: ORG_ID } }),
    prisma.groupMembership.count({ where: { group: { orgId: ORG_ID }, validTo: null } }),
    prisma.task.count({
      where: { assignee: { orgId: ORG_ID }, sourceId: { startsWith: SEED_SOURCE_PREFIX } },
    }),
  ]);

  console.log(`Seeded org "${ORG_ID}"`);
  console.log(`  Users: ${userCount} (password for every seeded user: ${PASSWORD_PLAIN})`);
  console.log(`  Departments: ${departmentCount}`);
  console.log(`  Context groups: ${groupCount}`);
  console.log(`  Active group memberships: ${membershipCount}`);
  console.log(`  Sprint 16A historical tasks: ${taskCount}`);
  console.log("  Matrix examples:");
  console.log("    sharma@kims.demo manages: Sneha, Amit, Suresh");
  console.log("    rahul@kims.demo manages: Sneha, Amit, Deepika");
  console.log("    reddy@kims.demo manages: Anjali, Pooja");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
