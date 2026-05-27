-- Sprint 18: Multi-org foundation + permission flags.
-- Adds an Organization table (backfilled from every distinct orgId currently
-- in use by User / Department / ContextGroup, so the FK we add at the end
-- never sees a missing parent), and two new User columns: `isSuperAdmin`
-- (the root flag) and `canManageUsers` (the grantable L8 permission for the
-- hierarchy guardrail). Existing admins+managers are backfilled to
-- canManageUsers=true so behavior is unchanged for current users.

-- 1. Organization table.
CREATE TABLE "Organization" (
    "id"        TEXT          NOT NULL,
    "name"      TEXT          NOT NULL,
    "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- 2. Backfill an Organization row for every orgId currently in use, BEFORE
--    we add the FK. Using DISTINCT across the three tables that carry orgId
--    so even an orphan orgId in Department or ContextGroup is covered.
INSERT INTO "Organization" ("id", "name")
SELECT DISTINCT t."orgId", t."orgId" FROM (
    SELECT "orgId" FROM "User"
    UNION
    SELECT "orgId" FROM "Department"
    UNION
    SELECT "orgId" FROM "ContextGroup"
) AS t
WHERE t."orgId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- 3. Pretty up the names of the known seed orgs so the UI doesn't show "kims-hospital".
UPDATE "Organization" SET "name" = 'KIMS Hospital'      WHERE "id" = 'kims-hospital';
UPDATE "Organization" SET "name" = 'Demo Organization'  WHERE "id" = 'demo-org';

-- 4. New User columns.
ALTER TABLE "User" ADD COLUMN "isSuperAdmin"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canManageUsers" BOOLEAN NOT NULL DEFAULT false;

-- 5. Backfill canManageUsers from role so existing managers/admins keep their
--    ability to create users (staff default to false — explicit opt-in via L8).
UPDATE "User" SET "canManageUsers" = true WHERE "role" IN ('admin', 'manager');

-- 6. Add FKs: every orgId column references Organization.id from now on.
ALTER TABLE "User"
    ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Department"
    ADD CONSTRAINT "Department_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContextGroup"
    ADD CONSTRAINT "ContextGroup_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
