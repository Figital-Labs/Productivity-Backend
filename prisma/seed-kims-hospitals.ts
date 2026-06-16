/**
 * KIMS Hospitals (real org) onboarding seed.
 *
 * Source: Org_Data_Collection updated.xlsx (30-person People Directory) +
 * a created org admin + the 3 vertical heads (who were referenced as managers
 * in the sheet but had no rows of their own). Total 34 users.
 *
 * Model: Approach A — pure reporting tree. No departments, no groups.
 *   admin@kimshospitals.com (L800 admin) — sees the whole org
 *   ├── Gunjan U V (L400)            — Operations & Support  (13 reports)
 *   │     ├── Indrasen Reddy Bonthu (L300) → Kakara Vighneswara Rao
 *   │     └── Shaik Abdul Fayaz (L300)     → Srinadh Thulluru
 *   ├── Dr Ankita Roy Chawla (L400)  — Medical Administration (11 reports)
 *   └── Kishore SV (L400)            — Corporate / MIS·Audit·HR (4 reports)
 *
 * Identity cleanups baked in:
 *   - medopsmgr.gbl@ belongs to Dr Ankita (the vertical head); Dr D V Shanthi
 *     gets dymedsupt.gbl@ (from her "Dy. Medical Superintendent" title).
 *   - 2 blanks invented in the house style: anilkumar.c@, srinivasulu.p@.
 *   - Ashwani's domain typo fixed: hragm.gbl@kimshospitals.com.
 *
 * Safe to re-run — uses upsert, does NOT clear existing data.
 *
 * Run:  npx tsx prisma/seed-kims-hospitals.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/tasklist";

const ORG_ID = "kims-hospitals";
const ORG_NAME = "KIMS Hospitals";
// Shared default password for every seeded account (incl. admin). Users reset later.
const DEFAULT_PASSWORD = "kims1234";

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type SeedRole = "staff" | "manager" | "admin";

interface SeedUser {
  email: string;
  name: string;
  role: SeedRole;
  level: number;
  canManageUsers: boolean;
}

const USERS: SeedUser[] = [
  // ── Created org admin ────────────────────────────────────────────────
  {
    email: "admin@kimshospitals.com",
    name: "KIMS Hospitals Admin",
    role: "admin",
    level: 800,
    canManageUsers: true,
  },

  // ── Three vertical heads (created; referenced as managers in the sheet) ─
  {
    email: "gunjanuv.gbl@kimshospitals.com",
    name: "Gunjan U V (Operations & Support)",
    role: "manager",
    level: 400,
    canManageUsers: true,
  },
  {
    email: "medopsmgr.gbl@kimshospitals.com",
    name: "Dr Ankita Roy Chawla (Medical Administration)",
    role: "manager",
    level: 400,
    canManageUsers: true,
  },
  {
    email: "kishorereddysv@kimshospitals.com",
    name: "Kishore SV (Corporate / MIS·Audit·HR)",
    role: "manager",
    level: 400,
    canManageUsers: true,
  },

  // ── Operations & Support (under Gunjan U V) ──────────────────────────
  {
    email: "operationsgm.gbl@kimshospitals.com",
    name: "Indrasen Reddy Bonthu (General Manager)",
    role: "manager",
    level: 300,
    canManageUsers: true,
  },
  {
    email: "headops.gbl@kimshospitals.com",
    name: "Shaik Abdul Fayaz (Head Ops)",
    role: "manager",
    level: 300,
    canManageUsers: true,
  },
  {
    email: "gopikrishna.p@kimshospitals.com",
    name: "Peteti Gopi Krishna (Deputy General Manager)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "billingdgm.gbl@kimshospitals.com",
    name: "Magam Sharath (Deputy General Manager — Billing)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "sbjisrmgr.gbl@kimshospitals.com",
    name: "Mallika M (Senior Manager)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "sudhakardaddala@yahoo.com",
    name: "Sudhakar Daddala (Senior Manager)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "securityhead.gbl@kimshospitals.com",
    name: "Sudhir Kumar Simhadri (Senior Manager — Security)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "maintenance.gbl@kimshospitals.com",
    name: "Rajesh Geddada (Manager — Maintenance)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "fnb.gbl@kimshospitals.com",
    name: "Maddela Srujan Kanth (Manager — F&B)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "hk.gbl@kimshospitals.com",
    name: "Anand Gajapathi Raju Samanthapudi (Dy. Manager — Housekeeping)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "generalpurchase.gbl@kimshospitals.com",
    name: "Balakrishna Srigada (Sr. Executive — Purchase)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "generalstores.gbl@kimshospitals.com",
    name: "David Barwa (Senior Executive — Stores)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    // invented (house style: given.surnameinitial@) — Puram = surname
    email: "srinivasulu.p@kimshospitals.com",
    name: "Puram Srinivasulu (Assistant Manager)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  // 3rd level under Shaik Abdul Fayaz
  {
    email: "opd.gbl@kimshospitals.com",
    name: "Srinadh Thulluru (Manager — OPD)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  // 3rd level under Indrasen Reddy Bonthu
  {
    email: "liaison.gbl@kimshospitals.com",
    name: "Kakara Vighneswara Rao (Assistant Manager — Liaison)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },

  // ── Medical Administration (under Dr Ankita Roy Chawla) ───────────────
  {
    // resolved collision: Dr D V Shanthi gets her own mailbox from her title
    email: "dymedsupt.gbl@kimshospitals.com",
    name: "Dr. D V Shanthi (Dy. Medical Superintendent)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "ns.gbl@kimshospitals.com",
    name: "Koukuntla Bhagya Lakshmi (Nursing Superintendent)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "accountssrmgr.gbl@kimshospitals.com",
    name: "Darisi Srinivas Rao (Senior Manager — Accounts)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "biomedical.gbl@kimshospitals.com",
    name: "Avula Kumar (Manager — Biomedical)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "scm.gbl@kimshospitals.com",
    name: "Ellandula Anusha (Manager — SCM)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "clinicalpharmacist.gbl@kimshospitals.com",
    name: "Gade Sarika (Dy. Manager — Clinical Pharmacy)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "mrd.gbl@kimshospitals.com",
    name: "Nandala Krupakar (Dy. Manager — MRD)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "lab.gbl@kimshospitals.com",
    name: "Ganapa Venkatesh (Incharge — Lab)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "dietician.gbl@kimshospitals.com",
    name: "Zeenath Fatima (Chief Dietician)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "drsreelatharamapuram@gmail.com",
    name: "Ramapuram Sreelatha (Senior Duty Medical Officer)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    // invented (house style) — Chilukala = surname
    email: "anilkumar.c@kimshospitals.com",
    name: "Anilkumar Chilukala (Assistant Manager)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },

  // ── Corporate / MIS·Audit·HR (under Kishore SV) ──────────────────────
  {
    // domain typo fixed: was hragm.gbl@kimshsopitals.com
    email: "hragm.gbl@kimshospitals.com",
    name: "Ashwani Kumar.k (Assistant General Manager — HR)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "mis.gbl@kimshospitals.com",
    name: "Bolgam Karunakar (Manager — MIS)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "audit.gbl@kimshospitals.com",
    name: "Shanthi Narayana G (Manager — Audit)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "mehar.m@kimshospitals.com",
    name: "Anantha Surya Mehar Sai Munnangi (Assistant Manager)",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
];

// report email → [direct manager email(s)]. Single-manager throughout (no matrix).
const HIERARCHY: Record<string, string[]> = {
  // verticals report to the created admin
  "gunjanuv.gbl@kimshospitals.com": ["admin@kimshospitals.com"],
  "medopsmgr.gbl@kimshospitals.com": ["admin@kimshospitals.com"],
  "kishorereddysv@kimshospitals.com": ["admin@kimshospitals.com"],

  // Operations & Support → Gunjan
  "operationsgm.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "headops.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "gopikrishna.p@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "billingdgm.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "sbjisrmgr.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "sudhakardaddala@yahoo.com": ["gunjanuv.gbl@kimshospitals.com"],
  "securityhead.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "maintenance.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "fnb.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "hk.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "generalpurchase.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "generalstores.gbl@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  "srinivasulu.p@kimshospitals.com": ["gunjanuv.gbl@kimshospitals.com"],
  // 3rd level
  "opd.gbl@kimshospitals.com": ["headops.gbl@kimshospitals.com"],
  "liaison.gbl@kimshospitals.com": ["operationsgm.gbl@kimshospitals.com"],

  // Medical Administration → Dr Ankita
  "dymedsupt.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "ns.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "accountssrmgr.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "biomedical.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "scm.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "clinicalpharmacist.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "mrd.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "lab.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "dietician.gbl@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],
  "drsreelatharamapuram@gmail.com": ["medopsmgr.gbl@kimshospitals.com"],
  "anilkumar.c@kimshospitals.com": ["medopsmgr.gbl@kimshospitals.com"],

  // Corporate / MIS·Audit·HR → Kishore
  "hragm.gbl@kimshospitals.com": ["kishorereddysv@kimshospitals.com"],
  "mis.gbl@kimshospitals.com": ["kishorereddysv@kimshospitals.com"],
  "audit.gbl@kimshospitals.com": ["kishorereddysv@kimshospitals.com"],
  "mehar.m@kimshospitals.com": ["kishorereddysv@kimshospitals.com"],
};

async function main(): Promise<void> {
  // Ensure org exists
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    create: { id: ORG_ID, name: ORG_NAME },
    update: { name: ORG_NAME },
  });
  console.log(`Org "${ORG_ID}" ready.`);

  // Upsert all users (single shared password hashed once)
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const byEmail = new Map<string, string>();

  for (const user of USERS) {
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
  console.log(`\nKIMS Hospitals seed complete — ${userCount.toString()} users in org.`);
  console.log(`  Every account password: ${DEFAULT_PASSWORD}`);
  console.log("  Admin:    admin@kimshospitals.com");
  console.log("  Verticals: gunjanuv.gbl@ · medopsmgr.gbl@ (Dr Ankita) · kishorereddysv@");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
