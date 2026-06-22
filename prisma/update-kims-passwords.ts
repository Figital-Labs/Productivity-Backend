/**
 * One-shot: update every KIMS Hospitals user to their unique password.
 * Safe to re-run (idempotent upsert on passwordHash).
 *
 * Run: npx tsx prisma/update-kims-passwords.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/tasklist";

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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

async function main(): Promise<void> {
  for (const [email, password] of Object.entries(PASSWORDS)) {
    const passwordHash = await hashPassword(password);
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    console.log(`  Updated: ${email}`);
  }
  console.log(`\nDone — ${Object.keys(PASSWORDS).length.toString()} passwords updated.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
