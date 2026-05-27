/**
 * Sprint 18 demo seed. Clean three-tier hierarchy + a second blank org + a
 * root super-admin. Replaces the older flat-ish KIMS seed.
 *
 *   KIMS Hospital
 *   └─ Dr. Iyer (Director / admin, level 800)
 *       ├─ Dr. Sharma — Medicine HOD
 *       │   ├─ Sneha — Ward 12 Lead
 *       │   │   ├─ Amit
 *       │   │   └─ Suresh
 *       │   └─ Anita — ICU-A Lead
 *       │       └─ Kavita
 *       ├─ Dr. Mehta — Surgery HOD
 *       │   └─ Vikram — OT-2 Lead
 *       │       └─ Manoj
 *       └─ Rahul — Nursing HOD
 *           └─ Deepika — Night Shift Lead
 *               ├─ Priya
 *               └─ Pooja
 *
 *   Demo Clinic (blank — bootstrapped via root for prospect tests)
 *
 *   + one cross-org root (`root@platform.demo`, isSuperAdmin=true)
 *
 * Backdated history covers the last 7 days AND fills today so the dashboard's
 * "today" KPIs aren't zero. Performers/laggards are intentional:
 *   - top performers: Anita, Manoj (8/8 perfect, high task throughput)
 *   - laggards: Suresh (missed plans), Pooja (missed closures)
 *
 * Login credentials: every KIMS user's password is "kims2026". Root is "root2026".
 *
 * Run:  npx tsx prisma/seed-hierarchy.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/tasklist";
const KIMS_ORG_ID = "kims-hospital";
const DEMO_CLINIC_ORG_ID = "demo-clinic";
const SEED_SOURCE_PREFIX = "sprint18-seed";
const KIMS_PASSWORD = "kims2026";
const ROOT_PASSWORD = "root2026";
const MEMBERSHIP_VALID_FROM = new Date("2026-05-15T00:00:00.000Z");

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type SeedRole = "staff" | "manager" | "admin";

interface SeedUser {
  email: string;
  name: string;
  role: SeedRole;
  level: number;
  canManageUsers: boolean;
  isSuperAdmin?: boolean;
  orgId: string;
  password: string;
}

const USERS: SeedUser[] = [
  // Root (cross-org)
  {
    email: "root@platform.demo",
    name: "Platform Root",
    role: "admin",
    level: 900,
    canManageUsers: true,
    isSuperAdmin: true,
    orgId: KIMS_ORG_ID,
    password: ROOT_PASSWORD,
  },
  // KIMS — Director
  {
    email: "iyer@kims.demo",
    name: "Dr. Iyer (Medical Director)",
    role: "admin",
    level: 800,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  // KIMS — Department Heads
  {
    email: "sharma@kims.demo",
    name: "Dr. Sharma (Medicine HOD)",
    role: "manager",
    level: 400,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "mehta@kims.demo",
    name: "Dr. Mehta (Surgery HOD)",
    role: "manager",
    level: 400,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "rahul@kims.demo",
    name: "Rahul (Nursing HOD)",
    role: "manager",
    level: 400,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  // KIMS — Group Leads
  {
    email: "sneha@kims.demo",
    name: "Sister Sneha (Ward 12 Lead)",
    role: "manager",
    level: 300,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "anita@kims.demo",
    name: "Sister Anita (ICU-A Lead)",
    role: "manager",
    level: 300,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "vikram@kims.demo",
    name: "Vikram (OT-2 Lead)",
    role: "manager",
    level: 300,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "deepika@kims.demo",
    name: "Sister Deepika (Night Shift Lead)",
    role: "manager",
    level: 300,
    canManageUsers: true,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  // KIMS — Staff
  {
    email: "amit@kims.demo",
    name: "Ward Boy Amit",
    role: "staff",
    level: 100,
    canManageUsers: false,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "suresh@kims.demo",
    name: "Compounder Suresh",
    role: "staff",
    level: 100,
    canManageUsers: false,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "kavita@kims.demo",
    name: "Sister Kavita",
    role: "staff",
    level: 100,
    canManageUsers: false,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "manoj@kims.demo",
    name: "Ward Boy Manoj",
    role: "staff",
    level: 100,
    canManageUsers: false,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "priya@kims.demo",
    name: "Sister Priya",
    role: "staff",
    level: 100,
    canManageUsers: false,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
  {
    email: "pooja@kims.demo",
    name: "Pooja (IPD Coordinator)",
    role: "staff",
    level: 100,
    canManageUsers: false,
    orgId: KIMS_ORG_ID,
    password: KIMS_PASSWORD,
  },
];

// Reporting chain: report -> [its direct manager]. Single-line so the Manage
// tree reads as a clean hierarchy (director -> dept head -> group lead -> staff,
// recursive). Dept-head access to staff tasks does NOT depend on a direct edge:
// `canAccessTask` grants a dept head access to anyone in their department's
// groups (see src/utils/auth.ts), so the scoped drill-down still works.
const HIERARCHY: Record<string, string[]> = {
  "sharma@kims.demo": ["iyer@kims.demo"],
  "mehta@kims.demo": ["iyer@kims.demo"],
  "rahul@kims.demo": ["iyer@kims.demo"],
  "sneha@kims.demo": ["sharma@kims.demo"],
  "anita@kims.demo": ["sharma@kims.demo"],
  "vikram@kims.demo": ["mehta@kims.demo"],
  "deepika@kims.demo": ["rahul@kims.demo"],
  "amit@kims.demo": ["sneha@kims.demo"],
  "suresh@kims.demo": ["sneha@kims.demo"],
  "kavita@kims.demo": ["anita@kims.demo"],
  "manoj@kims.demo": ["vikram@kims.demo"],
  "priya@kims.demo": ["deepika@kims.demo"],
  "pooja@kims.demo": ["deepika@kims.demo"],
};

interface DepartmentSeed {
  name: string;
  headEmail: string;
}
const DEPARTMENTS: DepartmentSeed[] = [
  { name: "Medicine", headEmail: "sharma@kims.demo" },
  { name: "Surgery", headEmail: "mehta@kims.demo" },
  { name: "Nursing", headEmail: "rahul@kims.demo" },
];

interface GroupSeed {
  key: string;
  name: string;
  kind: string;
  departmentName: string;
  leadEmail: string;
  memberEmails: string[];
}
const GROUPS: GroupSeed[] = [
  {
    key: "ward-12",
    name: "Ward 12 - General Medicine",
    kind: "ward",
    departmentName: "Medicine",
    leadEmail: "sneha@kims.demo",
    memberEmails: ["amit@kims.demo", "suresh@kims.demo"],
  },
  {
    key: "icu-a",
    name: "ICU-A - Critical Care",
    kind: "ward",
    departmentName: "Medicine",
    leadEmail: "anita@kims.demo",
    memberEmails: ["kavita@kims.demo"],
  },
  {
    key: "ot-2",
    name: "OT-2 - Orthopedic Theatre",
    kind: "ot",
    departmentName: "Surgery",
    leadEmail: "vikram@kims.demo",
    memberEmails: ["manoj@kims.demo"],
  },
  {
    key: "night-shift",
    name: "Night Shift - Ward 12",
    kind: "shift",
    departmentName: "Nursing",
    leadEmail: "deepika@kims.demo",
    memberEmails: ["priya@kims.demo", "pooja@kims.demo"],
  },
];

const TASK_TITLES = [
  "Morning patient round",
  "Update vitals chart",
  "Coordinate discharge",
  "Lab report follow-up",
  "Medication round",
  "Shift handover notes",
  "Family counselling",
  "Equipment readiness check",
];

/**
 * Per-user completion archetype over the 7-day history window. Drives both
 * task completion rates and submission-gap patterns so Top/Worst panels and
 * People-to-Watch have non-trivial differentiation.
 */
type Archetype = "top" | "steady" | "middle" | "laggard-plans" | "laggard-closures";

const ARCHETYPES: Record<string, Archetype> = {
  "anita@kims.demo": "top",
  "manoj@kims.demo": "top",
  "sneha@kims.demo": "steady",
  "vikram@kims.demo": "steady",
  "deepika@kims.demo": "steady",
  "kavita@kims.demo": "steady",
  "priya@kims.demo": "steady",
  "amit@kims.demo": "middle",
  "suresh@kims.demo": "laggard-plans",
  "pooja@kims.demo": "laggard-closures",
};

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

/**
 * For a given archetype + day offset (0=today, 1=yesterday, ...), decide
 * whether the user submitted plan/closure that day, and the task-completion
 * rate for tasks targeted at that day. Deterministic so re-runs produce the
 * same demo.
 */
function dayBehavior(
  archetype: Archetype,
  offsetFromToday: number,
): { submittedPlan: boolean; submittedClosure: boolean; completionRate: number } {
  switch (archetype) {
    case "top":
      return { submittedPlan: true, submittedClosure: true, completionRate: 0.95 };
    case "steady":
      return {
        submittedPlan: offsetFromToday !== 4,
        submittedClosure: offsetFromToday !== 5,
        completionRate: 0.8,
      };
    case "middle":
      return {
        submittedPlan: offsetFromToday !== 3 && offsetFromToday !== 6,
        submittedClosure: offsetFromToday !== 2,
        completionRate: 0.65,
      };
    case "laggard-plans":
      // Missed plans on offsets 1, 3 — clear signal in 5-day Watch panel.
      return {
        submittedPlan: offsetFromToday !== 1 && offsetFromToday !== 3,
        submittedClosure: offsetFromToday !== 6,
        completionRate: 0.55,
      };
    case "laggard-closures":
      return {
        submittedPlan: offsetFromToday !== 5,
        submittedClosure: offsetFromToday !== 1 && offsetFromToday !== 2 && offsetFromToday !== 4,
        completionRate: 0.5,
      };
  }
}

async function ensureOrgs(): Promise<void> {
  await prisma.organization.upsert({
    where: { id: KIMS_ORG_ID },
    create: { id: KIMS_ORG_ID, name: "KIMS Hospital" },
    update: { name: "KIMS Hospital" },
  });
  await prisma.organization.upsert({
    where: { id: DEMO_CLINIC_ORG_ID },
    create: { id: DEMO_CLINIC_ORG_ID, name: "Demo Clinic" },
    update: { name: "Demo Clinic" },
  });
}

async function clearPriorSeedState(): Promise<void> {
  // Full reset of the KIMS demo org so the seed is deterministic regardless of
  // what prior seeds (sprint16a etc.) left behind. KIMS is a demo org — a
  // clean slate is correct; we are not preserving any real user data here.
  // Order matters: child rows before parents (FK constraints).
  const orgFilter = { orgId: KIMS_ORG_ID };
  await prisma.submissionReview.deleteMany({ where: { reviewer: orgFilter } });
  await prisma.reminderIntent.deleteMany({ where: { target: orgFilter } });
  await prisma.morningBriefCache.deleteMany({ where: { manager: orgFilter } });
  await prisma.task.deleteMany({ where: { assignee: orgFilter } });
  await prisma.taskMedia.deleteMany({ where: { task: { assignee: orgFilter } } });
  await prisma.dayPlanSubmission.deleteMany({ where: { user: orgFilter } });
  await prisma.dayClosureSubmission.deleteMany({ where: { user: orgFilter } });
  await prisma.voiceInteraction.deleteMany({ where: { user: orgFilter } });
  await prisma.textInteraction.deleteMany({ where: { user: orgFilter } });
  await prisma.imageExtraction.deleteMany({ where: { user: orgFilter } });
  await prisma.unifiedInteraction.deleteMany({ where: { user: orgFilter } });
  await prisma.note.deleteMany({ where: { user: orgFilter } });
  await prisma.alert.deleteMany({ where: { user: orgFilter } });
  await prisma.holiday.deleteMany({ where: { user: orgFilter } });
  await prisma.meeting.deleteMany({ where: { user: orgFilter } });
  await prisma.groupMembership.deleteMany({ where: { group: orgFilter } });
  await prisma.contextGroup.deleteMany({ where: orgFilter });
  // Drop department head pointers before deleting departments isn't needed
  // (headId is SET NULL on user delete), but departments must go before any
  // user delete that they reference via headId.
  await prisma.department.deleteMany({ where: orgFilter });
  // Detach all hierarchy edges between KIMS users so re-runs are clean.
  await prisma.$executeRaw`
    DELETE FROM "_UserHierarchy"
    WHERE "A" IN (SELECT id FROM "User" WHERE "orgId" = ${KIMS_ORG_ID})
       OR "B" IN (SELECT id FROM "User" WHERE "orgId" = ${KIMS_ORG_ID})
  `;
  // Remove legacy/orphan KIMS users that aren't part of the new seed roster
  // (e.g. Krishnan/Reddy from the old sprint16 seed), so the directory is clean.
  const keepEmails = USERS.map((u) => u.email);
  await prisma.user.deleteMany({
    where: { orgId: KIMS_ORG_ID, email: { notIn: keepEmails } },
  });
}

async function upsertUsers(): Promise<Map<string, string>> {
  // Cache hashes so we don't call bcrypt 15× during a single seed run.
  const hashByPassword = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const user of USERS) {
    let passwordHash = hashByPassword.get(user.password);
    if (!passwordHash) {
      passwordHash = await hashPassword(user.password);
      hashByPassword.set(user.password, passwordHash);
    }
    const data = {
      email: user.email,
      name: user.name,
      passwordHash,
      role: user.role,
      level: user.level,
      canManageUsers: user.canManageUsers,
      isSuperAdmin: user.isSuperAdmin ?? false,
      orgId: user.orgId,
    };
    const row = await prisma.user.upsert({
      where: { email: user.email },
      create: data,
      update: data,
    });
    byEmail.set(user.email, row.id);
  }
  return byEmail;
}

async function wireHierarchy(byEmail: Map<string, string>): Promise<void> {
  // Use Prisma's `reports: { connect }` rather than a raw `_UserHierarchy`
  // INSERT so the implicit-m2m column orientation is handled by Prisma. This
  // guarantees `manager.reports` returns the manager's reports (the raw INSERT
  // approach is easy to get backwards on a self-relation).
  for (const [reportEmail, managerEmails] of Object.entries(HIERARCHY)) {
    const reportId = byEmail.get(reportEmail);
    if (!reportId) throw new Error(`Missing seeded user ${reportEmail}`);
    for (const managerEmail of managerEmails) {
      const managerId = byEmail.get(managerEmail);
      if (!managerId) throw new Error(`Missing seeded manager ${managerEmail}`);
      await prisma.user.update({
        where: { id: managerId },
        data: { reports: { connect: { id: reportId } } },
      });
    }
  }
}

async function createDepartments(byEmail: Map<string, string>): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const dept of DEPARTMENTS) {
    const headId = byEmail.get(dept.headEmail);
    if (!headId) throw new Error(`Missing head ${dept.headEmail}`);
    const row = await prisma.department.create({
      data: { orgId: KIMS_ORG_ID, name: dept.name, headId },
    });
    byName.set(dept.name, row.id);
  }
  return byName;
}

async function createGroupsAndMemberships(
  byEmail: Map<string, string>,
  departmentByName: Map<string, string>,
): Promise<void> {
  for (const group of GROUPS) {
    const departmentId = departmentByName.get(group.departmentName);
    if (!departmentId) throw new Error(`Missing department ${group.departmentName}`);
    const groupRow = await prisma.contextGroup.create({
      data: { orgId: KIMS_ORG_ID, departmentId, name: group.name, kind: group.kind },
    });
    const leadId = byEmail.get(group.leadEmail);
    if (!leadId) throw new Error(`Missing lead ${group.leadEmail}`);
    await prisma.groupMembership.create({
      data: {
        userId: leadId,
        groupId: groupRow.id,
        isLead: true,
        canManage: true,
        validFrom: MEMBERSHIP_VALID_FROM,
        validTo: null,
      },
    });
    for (const memberEmail of group.memberEmails) {
      const memberId = byEmail.get(memberEmail);
      if (!memberId) throw new Error(`Missing member ${memberEmail}`);
      await prisma.groupMembership.create({
        data: {
          userId: memberId,
          groupId: groupRow.id,
          isLead: false,
          canManage: false,
          validFrom: MEMBERSHIP_VALID_FROM,
          validTo: null,
        },
      });
    }
  }
}

async function createHistory(byEmail: Map<string, string>, historyDates: Date[]): Promise<void> {
  // historyDates is 8 entries: 7 backdated + today (last entry).
  const kimsActiveUsers = USERS.filter(
    (u) => u.orgId === KIMS_ORG_ID && !u.isSuperAdmin && u.email !== "iyer@kims.demo",
  );

  for (const [userIndex, user] of kimsActiveUsers.entries()) {
    const userId = byEmail.get(user.email);
    if (!userId) throw new Error(`Missing user ${user.email}`);
    const archetype = ARCHETYPES[user.email] ?? "middle";

    for (const [dayIndex, date] of historyDates.entries()) {
      const offsetFromToday = historyDates.length - 1 - dayIndex;
      const behavior = dayBehavior(archetype, offsetFromToday);
      const taskCount = 3 + ((userIndex + dayIndex) % 3); // 3-5 tasks

      const plannedTitles: string[] = [];
      for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
        const firstName = user.name.split(" ")[1] ?? user.email;
        const title = `${TASK_TITLES[(userIndex + taskIndex) % TASK_TITLES.length] ?? "Task"} - ${firstName}`;
        plannedTitles.push(title);

        // Deterministic per-task completion: hash of indices vs the
        // archetype's completion rate. For today we attenuate so some tasks
        // remain open and KPIs show meaningful "in progress" numbers.
        const completionRate =
          offsetFromToday === 0 ? behavior.completionRate * 0.65 : behavior.completionRate;
        const seed = (userIndex * 31 + dayIndex * 17 + taskIndex * 7) % 100;
        const isCompleted = seed < Math.round(completionRate * 100);
        const isPartial = !isCompleted && seed % 7 === 3;

        await prisma.task.create({
          data: {
            assigneeId: userId,
            creatorId: userId,
            title,
            targetDate: date,
            priority: taskIndex === 0 && dayIndex % 3 === 0 ? "high" : null,
            completed: isCompleted,
            isPartial,
            notes: isPartial ? "Partial progress logged." : null,
            sourceType: ["manual", "voice", "text"][(userIndex + taskIndex) % 3] ?? "manual",
            sourceId: `${SEED_SOURCE_PREFIX}:${dateKey(date)}:${user.email}:${taskIndex.toString()}`,
            createdAt: date,
            updatedAt: date,
          },
        });
      }

      // Day plan submission. For today: ~70% of users submit (drives the
      // hero "9/14 plans" reading). For past days: follow archetype.
      const submitPlan = offsetFromToday === 0 ? userIndex % 10 < 7 : behavior.submittedPlan;
      if (submitPlan) {
        await prisma.dayPlanSubmission.create({
          data: {
            userId,
            date,
            submittedAt: date,
            taskSnapshot: plannedTitles.map((title) => ({ title, targetDate: dateKey(date) })),
          },
        });
      }

      // Day closure submission. For today: ~50% submit. For past days: archetype.
      const submitClosure = offsetFromToday === 0 ? userIndex % 10 < 5 : behavior.submittedClosure;
      if (submitClosure) {
        await prisma.dayClosureSubmission.create({
          data: {
            userId,
            date,
            status: "submitted",
            submittedAt: date,
            commentary: "Routine closure submitted.",
            aiFeedback: {
              summary: "Today's work tracked well overall.",
              achievements: plannedTitles.slice(0, 2),
              missed: plannedTitles.slice(-1),
              tips: ["Tomorrow: confirm shift handover earlier."],
            },
            mediaIds: [],
          },
        });
      }
    }
  }
}

async function createDemoMeetings(byEmail: Map<string, string>, today: Date): Promise<void> {
  const meetings = [
    {
      title: `${SEED_SOURCE_PREFIX} - Daily bed-flow huddle`,
      ownerEmail: "iyer@kims.demo",
      offset: 0,
      attendeeEmails: ["sharma@kims.demo", "rahul@kims.demo", "mehta@kims.demo"],
      summary: "Bed flow reviewed; Medicine and Surgery handover aligned for the day.",
    },
    {
      title: `${SEED_SOURCE_PREFIX} - OT turnaround review`,
      ownerEmail: "mehta@kims.demo",
      offset: -1,
      attendeeEmails: ["vikram@kims.demo", "manoj@kims.demo"],
      summary: "OT-2 turnaround blockers identified and assigned.",
    },
    {
      title: `${SEED_SOURCE_PREFIX} - Night shift handover`,
      ownerEmail: "rahul@kims.demo",
      offset: -2,
      attendeeEmails: ["deepika@kims.demo", "priya@kims.demo", "pooja@kims.demo"],
      summary: "Night-to-day handover, two patient escalations flagged.",
    },
  ];
  for (const m of meetings) {
    const ownerId = byEmail.get(m.ownerEmail);
    if (!ownerId) continue;
    const scheduledAt = addUtcDays(today, m.offset);
    const attendeeIds = m.attendeeEmails
      .map((email) => byEmail.get(email))
      .filter((id): id is string => id !== undefined);
    await prisma.meeting.create({
      data: {
        userId: ownerId,
        title: m.title,
        scheduledAt,
        type: "huddle",
        attendeeIds,
        agenda: "Sprint 18 seeded demo meeting.",
        notes: "Seeded notes.",
        summary: m.summary,
        actions: [],
        recommendations: [],
        processedAt: scheduledAt,
      },
    });
  }
}

async function main(): Promise<void> {
  const today = dateOnlyUtc(new Date());
  // 8 dates: 7 backdated + today (inclusive, today as last entry).
  const historyDates = Array.from({ length: 8 }, (_, i) => addUtcDays(today, -(7 - i)));

  await ensureOrgs();
  await clearPriorSeedState();

  const byEmail = await upsertUsers();
  await wireHierarchy(byEmail);
  const deptByName = await createDepartments(byEmail);
  await createGroupsAndMemberships(byEmail, deptByName);
  await createHistory(byEmail, historyDates);
  await createDemoMeetings(byEmail, today);

  const [userCount, deptCount, groupCount, memCount, taskCount, planToday, closureToday] =
    await Promise.all([
      prisma.user.count({ where: { orgId: KIMS_ORG_ID } }),
      prisma.department.count({ where: { orgId: KIMS_ORG_ID } }),
      prisma.contextGroup.count({ where: { orgId: KIMS_ORG_ID } }),
      prisma.groupMembership.count({ where: { group: { orgId: KIMS_ORG_ID }, validTo: null } }),
      prisma.task.count({
        where: { assignee: { orgId: KIMS_ORG_ID }, sourceId: { startsWith: SEED_SOURCE_PREFIX } },
      }),
      prisma.dayPlanSubmission.count({ where: { user: { orgId: KIMS_ORG_ID }, date: today } }),
      prisma.dayClosureSubmission.count({
        where: { user: { orgId: KIMS_ORG_ID }, date: today, status: "submitted" },
      }),
    ]);

  console.log("Sprint 18 seed complete.");
  console.log(`  KIMS users:           ${userCount.toString()}  (password: ${KIMS_PASSWORD})`);
  console.log(`  Departments:          ${deptCount.toString()}`);
  console.log(`  Context groups:       ${groupCount.toString()}`);
  console.log(`  Active memberships:   ${memCount.toString()}`);
  console.log(`  Historical tasks:     ${taskCount.toString()}  (8d incl. today)`);
  console.log(`  Plans submitted today:    ${planToday.toString()}/${(userCount - 1).toString()}`);
  console.log(
    `  Closures submitted today: ${closureToday.toString()}/${(userCount - 1).toString()}`,
  );
  console.log(`  Second org "demo-clinic" seeded blank.`);
  console.log(`  Root: root@platform.demo  (password: ${ROOT_PASSWORD})`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
