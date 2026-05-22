import prisma from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

async function main(): Promise<void> {
  const passwordHash = await hashPassword("demopass123");
  const user = await prisma.user.upsert({
    where: { id: "demo-user-1" },
    update: {
      email: "demo@kims.local",
      name: "Demo User",
      orgId: "demo-org",
      passwordHash,
    },
    create: {
      id: "demo-user-1",
      email: "demo@kims.local",
      name: "Demo User",
      orgId: "demo-org",
      passwordHash,
    },
  });

  console.log(`Seeded user ${user.id} (${user.email}) in org ${user.orgId}.`);
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
