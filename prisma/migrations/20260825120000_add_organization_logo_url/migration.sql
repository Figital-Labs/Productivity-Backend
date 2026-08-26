-- Per-org branding (multi-tenant): the KIMS logo was hardcoded in the frontend, so every
-- tenant saw it. NULLABLE and with no default, so this is a metadata-only change:
-- Postgres does not rewrite the table, no existing row is touched, and older app builds
-- that never SELECT this column keep working. Safe to apply while the app is running.
ALTER TABLE "Organization" ADD COLUMN "logoUrl" TEXT;

-- Backfill so the existing tenant does not visibly lose its branding the moment this ships.
-- KIMS was the only customer while the logo was hardcoded in the frontend, so this preserves
-- exactly what they see today. `/kims-logo.svg` already ships in the frontend bundle, so a
-- root-relative path needs no upload and no new infrastructure — new tenants (Apollo and on)
-- get an absolute https:// URL pointing at S3/CDN instead.
-- Matches on name because the org id differs between the seed ("kims-hospital") and prod.
-- A no-op if nothing matches; verify afterwards with:
--   SELECT id, name, "logoUrl" FROM "Organization";
UPDATE "Organization" SET "logoUrl" = '/kims-logo.svg' WHERE "name" ILIKE '%kims%';
