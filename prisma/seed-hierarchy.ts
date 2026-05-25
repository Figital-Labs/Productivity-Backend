/**
 * Sprint 11 demo seed. Creates a KIMS Hospital org with 12 users (4 managers,
 * 8 staff) and a matrix hierarchy where some staff report to two managers.
 *
 * Run idempotently: deletes prior demo data first, then recreates. Safe to
 * re-run during development.
 *
 *   npx tsx prisma/seed-hierarchy.ts
 *
 * Login credentials for every seeded user: password = "kims2026"
 * Emails follow the pattern `<firstname>@kims.demo` (lowercase, no dot).
 */

import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/tasklist";
const ORG_ID = "kims-hospital";
const PASSWORD_PLAIN = "kims2026";

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface SeedUser {
  email: string;
  name: string;
  role: "staff" | "manager";
}

const MANAGERS: SeedUser[] = [
  { email: "sharma@kims.demo", name: "Dr. Sharma (Consultant, Medicine)", role: "manager" },
  { email: "mehta@kims.demo", name: "Dr. Mehta (Consultant, Surgery)", role: "manager" },
  { email: "rahul@kims.demo", name: "Rahul (Head Nurse, Ward 12)", role: "manager" },
  { email: "priya@kims.demo", name: "Priya (Head Nurse, OT)", role: "manager" },
];

const STAFF: SeedUser[] = [
  { email: "sneha@kims.demo", name: "Sister Sneha", role: "staff" },
  { email: "amit@kims.demo", name: "Ward Boy Amit", role: "staff" },
  { email: "anita@kims.demo", name: "Sister Anita", role: "staff" },
  { email: "vikram@kims.demo", name: "Ward Boy Vikram", role: "staff" },
  { email: "deepika@kims.demo", name: "Sister Deepika", role: "staff" },
  { email: "kavita@kims.demo", name: "Sister Kavita", role: "staff" },
  { email: "suresh@kims.demo", name: "Compounder Suresh", role: "staff" },
  { email: "manoj@kims.demo", name: "Ward Boy Manoj", role: "staff" },
];

// Matrix relationships: assignee → list of manager emails.
// Sneha, Amit, Anita, Vikram each have TWO managers (matrix authority).
// Deepika, Kavita, Suresh, Manoj each have ONE manager.
const HIERARCHY: Record<string, string[]> = {
  "sneha@kims.demo": ["sharma@kims.demo", "rahul@kims.demo"],
  "amit@kims.demo": ["sharma@kims.demo", "rahul@kims.demo"],
  "anita@kims.demo": ["mehta@kims.demo", "priya@kims.demo"],
  "vikram@kims.demo": ["mehta@kims.demo", "priya@kims.demo"],
  "deepika@kims.demo": ["rahul@kims.demo"],
  "kavita@kims.demo": ["priya@kims.demo"],
  "suresh@kims.demo": ["sharma@kims.demo"],
  "manoj@kims.demo": ["mehta@kims.demo"],
};

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, 12);

  // Wipe prior demo data tied to this org. Cascades clean up _UserHierarchy.
  await prisma.task.deleteMany({ where: { assignee: { orgId: ORG_ID } } });
  await prisma.note.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.alert.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.holiday.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.dayPlanSubmission.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.dayClosureSubmission.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.voiceInteraction.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.imageExtraction.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.textInteraction.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.unifiedInteraction.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.user.deleteMany({ where: { orgId: ORG_ID } });

  // Create managers first so we can reference their ids when wiring staff.
  const byEmail = new Map<string, string>();
  for (const m of [...MANAGERS, ...STAFF]) {
    const created = await prisma.user.create({
      data: {
        email: m.email,
        name: m.name,
        passwordHash,
        role: m.role,
        orgId: ORG_ID,
      },
    });
    byEmail.set(m.email, created.id);
  }

  // Wire matrix hierarchy via the _UserHierarchy join. For each staff member,
  // connect them as a `report` of each manager — Prisma writes (A=manager,
  // B=staff) rows in the join table.
  for (const [staffEmail, managerEmails] of Object.entries(HIERARCHY)) {
    const staffId = byEmail.get(staffEmail);
    if (!staffId) continue;
    for (const managerEmail of managerEmails) {
      const managerId = byEmail.get(managerEmail);
      if (!managerId) continue;
      await prisma.user.update({
        where: { id: managerId },
        data: { reports: { connect: { id: staffId } } },
      });
    }
  }

  // Seed a few sample tasks per staff member so the dashboard isn't empty
  // on demo day. Mix of completed and pending; targetDate = today (IST).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const taskSeeds: Array<{ assignee: string; title: string; completed: boolean }> = [
    { assignee: "sneha@kims.demo", title: "Morning ward rounds", completed: true },
    { assignee: "sneha@kims.demo", title: "Update patient charts", completed: false },
    { assignee: "amit@kims.demo", title: "Collect lab reports", completed: false },
    { assignee: "amit@kims.demo", title: "Restock medicine cart", completed: true },
    { assignee: "anita@kims.demo", title: "OT prep for 9am surgery", completed: true },
    { assignee: "anita@kims.demo", title: "Post-op patient monitoring", completed: false },
    { assignee: "vikram@kims.demo", title: "Sanitize OT-2", completed: false },
    { assignee: "deepika@kims.demo", title: "Ward 8 medication round", completed: true },
    { assignee: "kavita@kims.demo", title: "OT instruments sterilization", completed: false },
    { assignee: "suresh@kims.demo", title: "Pharmacy inventory check", completed: false },
    { assignee: "manoj@kims.demo", title: "Move equipment to Ward 5", completed: true },
  ];

  for (const seed of taskSeeds) {
    const assigneeId = byEmail.get(seed.assignee);
    if (!assigneeId) continue;
    await prisma.task.create({
      data: {
        assigneeId,
        creatorId: assigneeId,
        title: seed.title,
        targetDate: today,
        completed: seed.completed,
        sourceType: "manual",
      },
    });
  }

  console.log(`✔ Seeded ${MANAGERS.length} managers + ${STAFF.length} staff in org "${ORG_ID}"`);
  console.log(`  Password for every user: ${PASSWORD_PLAIN}`);
  console.log(`  Matrix examples:`);
  console.log(`    sharma@kims.demo manages: Sneha, Amit, Suresh`);
  console.log(
    `    rahul@kims.demo  manages: Sneha, Amit, Deepika  (note: Sneha+Amit have 2 managers)`,
  );
  console.log(`  Sample tasks seeded: ${taskSeeds.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
