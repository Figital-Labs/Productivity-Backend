/**
 * Figital Labs production seed.
 *
 * Hierarchy:
 *   tech@figitallabs.com  (Director / admin, level 800)
 *   ├── daksh@figitallabs.com   (CEO, level 400)
 *   └── revyant@figitallabs.com (CEO, level 400)
 *       ├── ashok@figitallabs.com  (Lead, level 300) ← reports to BOTH CEOs
 *       └── subha@figitallabs.com  (Lead, level 300) ← reports to BOTH CEOs
 *           └── all 6 team members report to BOTH leads
 *
 * Safe to re-run — uses upsert, does NOT clear existing data.
 *
 * Run:  npx tsx prisma/seed-figital.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/tasklist";

const ORG_ID = "figital-labs";

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type SeedRole = "staff" | "manager" | "admin";

interface SeedUser {
  email: string;
  name: string;
  role: SeedRole;
  level: number;
  canManageUsers: boolean;
  password: string;
}

const USERS: SeedUser[] = [
  // Director
  {
    email: "tech@figitallabs.com",
    name: "Tech Admin",
    role: "admin",
    level: 800,
    canManageUsers: true,
    password: "tech1234",
  },
  // CEOs
  {
    email: "daksh@figitallabs.com",
    name: "Daksh",
    role: "manager",
    level: 400,
    canManageUsers: true,
    password: "daksh1234",
  },
  {
    email: "revyant@figitallabs.com",
    name: "Revyant",
    role: "manager",
    level: 400,
    canManageUsers: true,
    password: "revyant1234",
  },
  // Leads
  {
    email: "ashok@figitallabs.com",
    name: "Ashok",
    role: "manager",
    level: 300,
    canManageUsers: true,
    password: "ashok-1234",
  },
  {
    email: "subha@figitallabs.com",
    name: "Subha",
    role: "manager",
    level: 300,
    canManageUsers: true,
    password: "subha-1234",
  },
  // Team members
  {
    email: "abhishek@figitallabs.com",
    name: "Abhishek",
    role: "staff",
    level: 100,
    canManageUsers: false,
    password: "abhishek-1234",
  },
  {
    email: "aditya@figitallabs.com",
    name: "Aditya",
    role: "staff",
    level: 100,
    canManageUsers: false,
    password: "aditya-1234",
  },
  {
    email: "gautam@figitallabs.com",
    name: "Gautam",
    role: "staff",
    level: 100,
    canManageUsers: false,
    password: "gautam-1234",
  },
  {
    email: "imtiaz@figitallabs.com",
    name: "Imtiaz",
    role: "staff",
    level: 100,
    canManageUsers: false,
    password: "imtiaz-1234",
  },
  {
    email: "mihir@figitallabs.com",
    name: "Mihir",
    role: "staff",
    level: 100,
    canManageUsers: false,
    password: "mihir-1234",
  },
  {
    email: "prafful@figitallabs.com",
    name: "Prafful",
    role: "staff",
    level: 100,
    canManageUsers: false,
    password: "prafful-1234",
  },
  {
    email: "omkar@figitallabs.com",
    name: "Omkar",
    role: "staff",
    level: 100,
    canManageUsers: false,
    password: "omkar-1234",
  },
];

// report → [its direct managers]
const HIERARCHY: Record<string, string[]> = {
  "daksh@figitallabs.com": ["tech@figitallabs.com"],
  "revyant@figitallabs.com": ["tech@figitallabs.com"],
  "ashok@figitallabs.com": ["daksh@figitallabs.com", "revyant@figitallabs.com"],
  "subha@figitallabs.com": ["daksh@figitallabs.com", "revyant@figitallabs.com"],
  "abhishek@figitallabs.com": [
    "ashok@figitallabs.com",
    "subha@figitallabs.com",
    "daksh@figitallabs.com",
    "revyant@figitallabs.com",
  ],
  "aditya@figitallabs.com": [
    "ashok@figitallabs.com",
    "subha@figitallabs.com",
    "daksh@figitallabs.com",
    "revyant@figitallabs.com",
  ],
  "gautam@figitallabs.com": [
    "ashok@figitallabs.com",
    "subha@figitallabs.com",
    "daksh@figitallabs.com",
    "revyant@figitallabs.com",
  ],
  "imtiaz@figitallabs.com": [
    "ashok@figitallabs.com",
    "subha@figitallabs.com",
    "daksh@figitallabs.com",
    "revyant@figitallabs.com",
  ],
  "mihir@figitallabs.com": [
    "ashok@figitallabs.com",
    "subha@figitallabs.com",
    "daksh@figitallabs.com",
    "revyant@figitallabs.com",
  ],
  "prafful@figitallabs.com": [
    "ashok@figitallabs.com",
    "subha@figitallabs.com",
    "daksh@figitallabs.com",
    "revyant@figitallabs.com",
  ],
  "omkar@figitallabs.com": [
    "ashok@figitallabs.com",
    "subha@figitallabs.com",
    "daksh@figitallabs.com",
    "revyant@figitallabs.com",
  ],
};

async function main(): Promise<void> {
  // Ensure org exists
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    create: { id: ORG_ID, name: "Figital Labs" },
    update: { name: "Figital Labs" },
  });
  console.log(`Org "${ORG_ID}" ready.`);

  // Upsert all users
  const hashCache = new Map<string, string>();
  const byEmail = new Map<string, string>();

  for (const user of USERS) {
    let passwordHash = hashCache.get(user.password);
    if (!passwordHash) {
      passwordHash = await hashPassword(user.password);
      hashCache.set(user.password, passwordHash);
    }
    const data = {
      email: user.email,
      name: user.name,
      passwordHash,
      role: user.role,
      level: user.level,
      canManageUsers: user.canManageUsers,
      isSuperAdmin: false,
      orgId: ORG_ID,
    };
    const row = await prisma.user.upsert({
      where: { email: user.email },
      create: data,
      update: data,
    });
    byEmail.set(user.email, row.id);
    console.log(`  Upserted: ${user.email}`);
  }

  // Wire hierarchy edges (idempotent — connect is a no-op if edge already exists)
  for (const [reportEmail, managerEmails] of Object.entries(HIERARCHY)) {
    const reportId = byEmail.get(reportEmail);
    if (!reportId) throw new Error(`Missing user ${reportEmail}`);
    for (const managerEmail of managerEmails) {
      const managerId = byEmail.get(managerEmail);
      if (!managerId) throw new Error(`Missing manager ${managerEmail}`);
      await prisma.user.update({
        where: { id: managerId },
        data: { reports: { connect: { id: reportId } } },
      });
    }
  }

  const userCount = await prisma.user.count({ where: { orgId: ORG_ID } });
  console.log(`\nFigital Labs seed complete — ${userCount.toString()} users in org.`);
  console.log("  Director:    tech@figitallabs.com   / tech1234");
  console.log("  CEO:         daksh@figitallabs.com  / daksh1234");
  console.log("  CEO:         revyant@figitallabs.com / revyant1234");
  console.log("  Lead:        ashok@figitallabs.com  / ashok-1234");
  console.log("  Lead:        subha@figitallabs.com  / subha-1234");
  console.log("  Team:        <name>@figitallabs.com / <name>-1234");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
