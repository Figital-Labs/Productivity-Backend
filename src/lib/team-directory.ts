import prisma from "./prisma.js";

export interface DirectoryEntry {
  id: string;
  name: string;
  role: string;
}

/**
 * Sprint 11: builds the TEAM DIRECTORY context injected into delegation
 * prompts. Returns the manager's direct reports as `{ id, name, role }`,
 * sorted by name. The AI uses this list to resolve spoken names to user ids
 * for the assigneeId field on delegated tasks.
 */
export async function buildDirectoryContext(managerId: string): Promise<DirectoryEntry[]> {
  const row = await prisma.user.findUnique({
    where: { id: managerId },
    select: {
      reports: {
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      },
    },
  });
  return row?.reports ?? [];
}
