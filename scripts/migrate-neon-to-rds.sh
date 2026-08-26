#!/usr/bin/env bash
#
# Migrate PRODUCTION from Neon to AWS RDS (`productivity-ai` on hospital-os-prod).
#
# Reads two URLs from .env:
#   DATABASE_URL_PROD       — SOURCE (Neon).       Already present.
#   DATABASE_URL_PROD_RDS   — TARGET (AWS RDS).    You must add this.
#
# What it does:
#   0. Preflight: both URLs present, RDS CA bundle available, tool versions.
#   1. GUARD — refuses to run if the SOURCE has in-flight jobs (queued/processing),
#      which would be orphaned by the pgboss exclusion below.
#   2. GUARD — refuses to run if the TARGET already holds tables. It NEVER overwrites data.
#   3. pg_dump the source: schema + data, EXCLUDING the `pgboss` job-queue schema.
#      pg-boss recreates that schema empty on first boot. Safe because of guard (1).
#   4. pg_restore into the target.
#   5. VERIFY — exact row counts for every table on BOTH sides, and diff them.
#
# What it deliberately does NOT do (cutover stays manual and reversible):
#   * Never edits .env, never changes DATABASE_URL, never restarts the app.
#   * Never touches the Neon source (read-only there) — rollback is just "don't switch".
#
# Run:  bash scripts/migrate-neon-to-rds.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

CA_FILE="$BACKEND_DIR/global-bundle.pem"      # absolute: psql resolves relative paths off its cwd
DUMP_DIR="${TMPDIR:-/tmp}"                    # NOT the repo — this file holds production data
DUMP_FILE="$DUMP_DIR/neon-prod-$(date +%Y%m%d-%H%M%S).dump"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }

# Exact row counts for every table in `public` (n_live_tup is only an estimate — this is exact).
COUNT_SQL="
SELECT table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text::bigint AS rows
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
 ORDER BY table_name;"

# --- 0. Preflight ----------------------------------------------------------
log "Preflight"
[ -f .env ] || die ".env not found in $BACKEND_DIR"

# Environment overrides win over .env — lets you rehearse against a throwaway target
# (e.g. DATABASE_URL_PROD=... bash scripts/migrate-neon-to-rds.sh) without editing .env.
# NOTE: the keys were renamed after the 2026-08-24 cutover. The Neon source now lives under
# DATABASE_URL_NEON_LEGACY, and DATABASE_URL_PROD means the RDS production database.
SRC_URL="${DATABASE_URL_NEON_LEGACY:-$(grep '^DATABASE_URL_NEON_LEGACY=' .env | cut -d= -f2- | tr -d '"')}"
RDS_RAW="${DATABASE_URL_PROD:-$(grep '^DATABASE_URL_PROD=' .env | cut -d= -f2- | tr -d '"')}"
[ -n "$SRC_URL" ] || die "DATABASE_URL_NEON_LEGACY (Neon source) not found in .env"
[ -n "$RDS_RAW" ] || die "DATABASE_URL_PROD (RDS target) not found in .env"

if [ ! -f "$CA_FILE" ]; then
  echo "Downloading AWS RDS CA bundle -> $CA_FILE"
  curl -sS -o "$CA_FILE" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
fi

# Rebuild the target URL with OUR ssl params so a relative sslrootcert can't bite us.
DST_URL="${RDS_RAW%%\?*}?sslmode=verify-full&sslrootcert=$CA_FILE"

SRC_HOST="$(printf '%s' "$SRC_URL" | sed -E 's#.*@([^/?]+).*#\1#')"
DST_HOST="$(printf '%s' "$DST_URL" | sed -E 's#.*@([^/?]+).*#\1#')"
DST_DB="$(printf '%s' "${DST_URL%%\?*}" | sed -E 's#.*/([^/]+)$#\1#')"
echo "  source : $SRC_HOST"
echo "  target : $DST_HOST  (database: $DST_DB)"
[ "$SRC_HOST" != "$DST_HOST" ] || die "Source and target are the same host — refusing."

command -v pg_dump    >/dev/null || die "pg_dump not found on PATH"
command -v pg_restore >/dev/null || die "pg_restore not found on PATH"
echo "  $(pg_dump --version)"

psql "$SRC_URL" -tAc 'SELECT 1' >/dev/null 2>&1 || die "Cannot connect to SOURCE (Neon)."
psql "$DST_URL" -tAc 'SELECT 1' >/dev/null 2>&1 || die "Cannot connect to TARGET (RDS). IP allowlisted?"
ok "both endpoints reachable"

# Same-major-version check: a cross-major restore is a different, riskier exercise.
SRC_MAJ="$(psql "$SRC_URL" -tAc 'SHOW server_version_num' | tr -d '[:space:]')"; SRC_MAJ=$(( SRC_MAJ / 10000 ))
DST_MAJ="$(psql "$DST_URL" -tAc 'SHOW server_version_num' | tr -d '[:space:]')"; DST_MAJ=$(( DST_MAJ / 10000 ))
[ "$SRC_MAJ" = "$DST_MAJ" ] || die "Major version mismatch: source PG $SRC_MAJ vs target PG $DST_MAJ."
ok "both on PostgreSQL $SRC_MAJ"

# Collation must match or every ORDER BY on text silently reorders after cutover.
SRC_COLL="$(psql "$SRC_URL" -tAc 'SELECT datcollate FROM pg_database WHERE datname=current_database()' | tr -d '[:space:]')"
DST_COLL="$(psql "$DST_URL" -tAc 'SELECT datcollate FROM pg_database WHERE datname=current_database()' | tr -d '[:space:]')"
# glibc spells the same locale both "C.UTF-8" and "C.utf8" — normalise before comparing.
norm() { printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -d '-'; }
if [ "$(norm "$SRC_COLL")" != "$(norm "$DST_COLL")" ]; then
  die "Collation mismatch: source '$SRC_COLL' vs target '$DST_COLL'. Text sort order WILL change."
fi
ok "collation matches ($SRC_COLL)"

# --- 1. GUARD: no in-flight jobs on the source -----------------------------
log "Guard 1/2 — checking for in-flight jobs on the source"
INFLIGHT="$(psql "$SRC_URL" -tAc "SELECT count(*) FROM \"ProcessingJob\" WHERE status IN ('queued','processing');" | tr -d '[:space:]')"
if [ "$INFLIGHT" != "0" ]; then
  psql "$SRC_URL" -c "SELECT status, count(*) FROM \"ProcessingJob\" WHERE status IN ('queued','processing') GROUP BY status;"
  die "$INFLIGHT job(s) still in flight. Stop the app, let them finish or expire, then re-run.
     (The pgboss schema is excluded from the dump, so a 'queued' row would be orphaned forever:
      the startup reconciler only rescues rows already in 'processing'.)"
fi
ok "no queued/processing jobs — safe to exclude the pgboss schema"

# --- 2. GUARD: target must be empty ----------------------------------------
log "Guard 2/2 — confirming the target is empty"
DST_TABLES="$(psql "$DST_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" | tr -d '[:space:]')"
if [ "$DST_TABLES" != "0" ]; then
  psql "$DST_URL" -c "$COUNT_SQL"
  die "Target '$DST_DB' already has $DST_TABLES table(s). Refusing to overwrite.
     If this is a deliberate re-run, drop and recreate the database first (matching collation!)."
fi
ok "target is empty"

# --- 3. Dump ---------------------------------------------------------------
log "Dumping source (schema + data, excluding pgboss)"
pg_dump "$SRC_URL" -Fc --no-owner --no-privileges --exclude-schema=pgboss -f "$DUMP_FILE"
ok "dump written: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# --- 4. Restore ------------------------------------------------------------
log "Restoring into $DST_DB"
# --no-owner/--no-privileges: the target has rds_superuser, not true superuser, so ownership
# and ACL statements from the source would emit errors. Objects end up owned by the connecting role.
if ! pg_restore --no-owner --no-privileges --exit-on-error -d "$DST_URL" "$DUMP_FILE"; then
  die "pg_restore failed. The target may be half-populated — drop and recreate the database
     (with LC_COLLATE '$DST_COLL') before retrying. Neon is untouched; do NOT cut over."
fi
ok "restore completed with no errors"

# --- 5. Verify -------------------------------------------------------------
log "Verifying — exact row counts on both sides"
SRC_COUNTS="$(psql "$SRC_URL" -tA -F'|' -c "$COUNT_SQL")"
DST_COUNTS="$(psql "$DST_URL" -tA -F'|' -c "$COUNT_SQL")"

if [ "$SRC_COUNTS" = "$DST_COUNTS" ]; then
  echo "$DST_COUNTS" | awk -F'|' '{printf "  %-28s %s\n", $1, $2}'
  TOTAL="$(echo "$DST_COUNTS" | awk -F'|' '{s+=$2} END {print s+0}')"
  ok "all tables match — $TOTAL rows across $(echo "$DST_COUNTS" | grep -c .) tables"
else
  echo "--- source ---"; echo "$SRC_COUNTS"
  echo "--- target ---"; echo "$DST_COUNTS"
  die "ROW COUNTS DIFFER. Do NOT cut over. Investigate, then drop/recreate the target and retry."
fi

# --- 6. Next steps ---------------------------------------------------------
log "Data migration complete — the app has NOT been switched"
cat <<NEXT
  Neon is untouched and still serving production. To cut over, on the EC2 box:

    1. pm2 stop day-planner-backend
    2. Re-run this script if ANY writes happened since the dump (it is safe to
       re-run only after dropping + recreating the target database).
    3. Edit .env:
         DATABASE_URL=<the RDS URL>
         DIRECT_DATABASE_URL=<the same RDS URL>   # no pooler on RDS, so both are identical
       Keep the old Neon URL commented out as a rollback path.
    4. pm2 restart day-planner-backend --update-env
    5. Verify:  curl -i http://localhost:8000/readyz     # checks DB connectivity
       Then exercise a real read and a real write in the app.

  Rollback: restore the old DATABASE_URL and 'pm2 restart --update-env'. Neon still has the data.

  Dump retained at: $DUMP_FILE
  (Production data — delete it once you are satisfied the cutover held.)
NEXT
