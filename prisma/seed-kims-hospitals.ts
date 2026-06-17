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
 * `name` is the clean person name; `designation` is the real job title shown in
 * the UI (role/level stay internal). The 3 created vertical heads have no sheet
 * title → designation null (UI falls back to "Manager"); Dr Ankita keeps her
 * web-confirmed "Associate Medical Director".
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

// Per-user passwords (unique). Source of truth — re-running the seed restores
// these exact credentials.
const PASSWORDS: Record<string, string> = {
  "admin@kimshospitals.com": "Admin8850",
  "gunjanuv.gbl@kimshospitals.com": "Gunjan1730",
  "medopsmgr.gbl@kimshospitals.com": "Ankita2783",
  "kishorereddysv@kimshospitals.com": "Kishore5887",
  "operationsgm.gbl@kimshospitals.com": "Indrasen1141",
  "headops.gbl@kimshospitals.com": "Shaik9323",
  "gopikrishna.p@kimshospitals.com": "Gopi3970",
  "billingdgm.gbl@kimshospitals.com": "Sharath8545",
  "sbjisrmgr.gbl@kimshospitals.com": "Mallika9375",
  "sudhakardaddala@yahoo.com": "Sudhakar3290",
  "securityhead.gbl@kimshospitals.com": "Sudhir1153",
  "maintenance.gbl@kimshospitals.com": "Rajesh8351",
  "fnb.gbl@kimshospitals.com": "Srujan6914",
  "hk.gbl@kimshospitals.com": "Anand6453",
  "generalpurchase.gbl@kimshospitals.com": "Balakrishna8851",
  "generalstores.gbl@kimshospitals.com": "David1219",
  "srinivasulu.p@kimshospitals.com": "Srini9537",
  "opd.gbl@kimshospitals.com": "Srinadh8885",
  "liaison.gbl@kimshospitals.com": "Kakara4386",
  "dymedsupt.gbl@kimshospitals.com": "Shanthi8374",
  "ns.gbl@kimshospitals.com": "Bhagya5767",
  "accountssrmgr.gbl@kimshospitals.com": "Srinivas3969",
  "biomedical.gbl@kimshospitals.com": "Avula7318",
  "scm.gbl@kimshospitals.com": "Anusha4710",
  "clinicalpharmacist.gbl@kimshospitals.com": "Sarika2051",
  "mrd.gbl@kimshospitals.com": "Krupakar2405",
  "lab.gbl@kimshospitals.com": "Venkatesh8497",
  "dietician.gbl@kimshospitals.com": "Zeenath1217",
  "drsreelatharamapuram@gmail.com": "Sreelatha3919",
  "anilkumar.c@kimshospitals.com": "Anilkumar1884",
  "hragm.gbl@kimshospitals.com": "Ashwani1019",
  "mis.gbl@kimshospitals.com": "Karunakar1428",
  "audit.gbl@kimshospitals.com": "Narayana6316",
  "mehar.m@kimshospitals.com": "Mehar6929",
};

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type SeedRole = "staff" | "manager" | "admin";

interface SeedUser {
  email: string;
  name: string;
  // Real job title shown in the UI. null → UI falls back to the role label.
  designation: string | null;
  role: SeedRole;
  level: number;
  canManageUsers: boolean;
}

const USERS: SeedUser[] = [
  // ── Created org admin ────────────────────────────────────────────────
  {
    email: "admin@kimshospitals.com",
    name: "KIMS Hospitals Admin",
    designation: "Administrator",
    role: "admin",
    level: 800,
    canManageUsers: true,
  },

  // ── Three vertical heads (created; referenced as managers in the sheet) ─
  {
    email: "gunjanuv.gbl@kimshospitals.com",
    name: "Gunjan U V",
    designation: "COO",
    role: "manager",
    level: 400,
    canManageUsers: true,
  },
  {
    email: "medopsmgr.gbl@kimshospitals.com",
    name: "Dr Ankita Roy Chawla",
    designation: "Associate Medical Director",
    role: "manager",
    level: 400,
    canManageUsers: true,
  },
  {
    email: "kishorereddysv@kimshospitals.com",
    name: "Kishore SV",
    designation: null,
    role: "manager",
    level: 400,
    canManageUsers: true,
  },

  // ── Operations & Support (under Gunjan U V) ──────────────────────────
  {
    email: "operationsgm.gbl@kimshospitals.com",
    name: "Indrasen Reddy Bonthu",
    designation: "General Manager",
    role: "manager",
    level: 300,
    canManageUsers: true,
  },
  {
    email: "headops.gbl@kimshospitals.com",
    name: "Shaik Abdul Fayaz",
    designation: "Head, Operations",
    role: "manager",
    level: 300,
    canManageUsers: true,
  },
  {
    email: "gopikrishna.p@kimshospitals.com",
    name: "Peteti Gopi Krishna",
    designation: "Deputy General Manager",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "billingdgm.gbl@kimshospitals.com",
    name: "Magam Sharath",
    designation: "Deputy General Manager, Billing",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "sbjisrmgr.gbl@kimshospitals.com",
    name: "Mallika M",
    designation: "Senior Manager",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "sudhakardaddala@yahoo.com",
    name: "Sudhakar Daddala",
    designation: "Senior Manager",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "securityhead.gbl@kimshospitals.com",
    name: "Sudhir Kumar Simhadri",
    designation: "Senior Manager, Security",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "maintenance.gbl@kimshospitals.com",
    name: "Rajesh Geddada",
    designation: "Manager, Maintenance",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "fnb.gbl@kimshospitals.com",
    name: "Maddela Srujan Kanth",
    designation: "Manager, F&B",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "hk.gbl@kimshospitals.com",
    name: "Anand Gajapathi Raju Samanthapudi",
    designation: "Deputy Manager, Housekeeping",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "generalpurchase.gbl@kimshospitals.com",
    name: "Balakrishna Srigada",
    designation: "Senior Executive, Purchase",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "generalstores.gbl@kimshospitals.com",
    name: "David Barwa",
    designation: "Senior Executive, Stores",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    // invented (house style: given.surnameinitial@) — Puram = surname
    email: "srinivasulu.p@kimshospitals.com",
    name: "Puram Srinivasulu",
    designation: "Assistant Manager",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  // 3rd level under Shaik Abdul Fayaz
  {
    email: "opd.gbl@kimshospitals.com",
    name: "Srinadh Thulluru",
    designation: "Manager, OPD",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  // 3rd level under Indrasen Reddy Bonthu
  {
    email: "liaison.gbl@kimshospitals.com",
    name: "Kakara Vighneswara Rao",
    designation: "Assistant Manager, Liaison",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },

  // ── Medical Administration (under Dr Ankita Roy Chawla) ───────────────
  {
    // resolved collision: Dr D V Shanthi gets her own mailbox from her title
    email: "dymedsupt.gbl@kimshospitals.com",
    name: "Dr. D V Shanthi",
    designation: "Deputy Medical Superintendent",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "ns.gbl@kimshospitals.com",
    name: "Koukuntla Bhagya Lakshmi",
    designation: "Nursing Superintendent",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "accountssrmgr.gbl@kimshospitals.com",
    name: "Darisi Srinivas Rao",
    designation: "Senior Manager, Accounts",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "biomedical.gbl@kimshospitals.com",
    name: "Avula Kumar",
    designation: "Manager, Biomedical",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "scm.gbl@kimshospitals.com",
    name: "Ellandula Anusha",
    designation: "Manager, SCM",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "clinicalpharmacist.gbl@kimshospitals.com",
    name: "Gade Sarika",
    designation: "Deputy Manager, Clinical Pharmacy",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "mrd.gbl@kimshospitals.com",
    name: "Nandala Krupakar",
    designation: "Deputy Manager, MRD",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "lab.gbl@kimshospitals.com",
    name: "Ganapa Venkatesh",
    designation: "In-charge, Lab",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "dietician.gbl@kimshospitals.com",
    name: "Zeenath Fatima",
    designation: "Chief Dietician",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "drsreelatharamapuram@gmail.com",
    name: "Ramapuram Sreelatha",
    designation: "Senior Duty Medical Officer",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    // invented (house style) — Chilukala = surname
    email: "anilkumar.c@kimshospitals.com",
    name: "Anilkumar Chilukala",
    designation: "Assistant Manager",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },

  // ── Corporate / MIS·Audit·HR (under Kishore SV) ──────────────────────
  {
    // domain typo fixed: was hragm.gbl@kimshsopitals.com
    email: "hragm.gbl@kimshospitals.com",
    name: "Ashwani Kumar.k",
    designation: "Assistant General Manager, HR",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "mis.gbl@kimshospitals.com",
    name: "Bolgam Karunakar",
    designation: "Manager, MIS",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "audit.gbl@kimshospitals.com",
    name: "Shanthi Narayana G",
    designation: "Manager, Audit",
    role: "staff",
    level: 100,
    canManageUsers: false,
  },
  {
    email: "mehar.m@kimshospitals.com",
    name: "Anantha Surya Mehar Sai Munnangi",
    designation: "Assistant Manager",
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

  // Upsert all users — each gets their own password from PASSWORDS.
  const byEmail = new Map<string, string>();

  for (const user of USERS) {
    const password = PASSWORDS[user.email];
    if (!password) throw new Error(`No password defined for ${user.email}`);
    const passwordHash = await hashPassword(password);
    const data = {
      email: user.email,
      name: user.name,
      designation: user.designation,
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
  console.log("  Passwords: unique per user (see the PASSWORDS map in this file).");
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
