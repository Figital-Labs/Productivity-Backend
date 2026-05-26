import prisma from "../lib/prisma.js";
import type { AuthenticatedUser } from "../middleware/auth.js";

function personalGroupName(managerName: string): string {
  return `${managerName}'s Directs`;
}

export async function ensurePersonalDirects(
  manager: AuthenticatedUser,
): Promise<{ id: string } | null> {
  const explicitLead = await prisma.groupMembership.findFirst({
    where: {
      userId: manager.id,
      isLead: true,
      validTo: null,
      group: { orgId: manager.orgId, kind: { not: "personal" } },
    },
    select: { groupId: true },
  });
  if (explicitLead) return null;

  const managerRow = await prisma.user.findUnique({
    where: { id: manager.id },
    select: { name: true, orgId: true },
  });
  if (!managerRow) return null;

  const name = personalGroupName(managerRow.name);
  let group = await prisma.contextGroup.findFirst({
    where: { orgId: manager.orgId, kind: "personal", name },
    select: { id: true },
  });
  group ??= await prisma.contextGroup.create({
    data: { orgId: manager.orgId, name, kind: "personal", departmentId: null },
    select: { id: true },
  });

  const managerMembership = await prisma.groupMembership.findFirst({
    where: { groupId: group.id, userId: manager.id, validTo: null },
    select: { userId: true },
  });
  if (!managerMembership) {
    await prisma.groupMembership.create({
      data: { groupId: group.id, userId: manager.id, isLead: true, canManage: true },
    });
  }

  return group;
}

export async function addUserToPersonalDirects(
  manager: AuthenticatedUser,
  userId: string,
): Promise<void> {
  const group = await ensurePersonalDirects(manager);
  if (!group) return;
  const existing = await prisma.groupMembership.findFirst({
    where: { groupId: group.id, userId, validTo: null },
    select: { userId: true },
  });
  if (existing) return;
  await prisma.groupMembership.create({
    data: {
      groupId: group.id,
      userId,
      isLead: false,
      canManage: false,
      reason: "auto-added from team attach",
    },
  });
}
