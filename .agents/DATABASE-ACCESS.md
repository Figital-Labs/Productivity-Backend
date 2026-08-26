# Database access & the Neon → AWS RDS migration

How to reach every database this project uses, why the obvious approaches fail, and the runbook
that moved production off Neon on **2026-08-24**.

---

## 1. The mental model: instance ≠ database

This is the single biggest source of confusion.

```
AWS account 452952376831 (ap-south-1)
│
├── RDS INSTANCE: hospital-os-dev        ← a SERVER you rent (db.t4g.micro, 20 GB, PG 18.3)
│   ├── DATABASE: productivity_ai_dev    ← OURS (dev)
│   ├── DATABASE: june-22-prod           ← another project's PROD, on the dev box
│   ├── DATABASE: ambient-hub, demo      ← other projects
│   └── DATABASE: postgres, rdsadmin     ← maintenance / AWS internal
│
├── RDS INSTANCE: hospital-os-prod       ← a DIFFERENT server (db.t4g.small, 20 GB)
│   ├── DATABASE: productivity-ai        ← OURS (prod, since 2026-08-24)
│   ├── DATABASE: postgres               ← 411 MB of another team's real data (anti-pattern)
│   └── DATABASE: rdsadmin
│
└── other instances: ai-guru-*, fc-estimate-db, fire-safety-prod, hrms-prod
```

| | Instance | Database |
| --- | --- | --- |
| What it is | A rented server (CPU/RAM/disk) | A logical container of tables |
| Created via | `aws rds create-db-instance` | SQL: `CREATE DATABASE foo;` |
| Costs money | **Yes**, hourly | **No**, free and unlimited |
| Has endpoint + firewall | Yes | No — inherits the instance's |
| **Visible to AWS CLI** | **Yes** | **NO** |

Instance names describe *history*, not contents — `hospital-os-*` was named after the first project
on it and now hosts several. Our production data lives on an instance called `hospital-os-prod`.

---

## 2. What AWS credentials can and cannot do

**AWS credentials give you ZERO access to data inside a database.** These are two unrelated
permission systems, and conflating them wastes hours.

```bash
aws rds describe-db-instances --region ap-south-1   # lists INSTANCES ✓
                                                    # cannot list DATABASES ✗
```

`describe-db-instances` reports only `DBName` — the database created at *instance creation*. Both
`hospital-os-*` instances report `DBName: None`, meaning every database on them was created later
via SQL and is **invisible to the AWS API**. To enumerate them you must connect with psql:

```bash
psql "<server>/postgres?sslmode=require" -c '\l'
```

Why AWS creds don't help: **IAM database authentication is DISABLED** on both instances
(`IAMDatabaseAuthenticationEnabled: False`). The only way in is the Postgres master user
`postgres` plus its password.

```bash
aws rds describe-db-instances --region ap-south-1 \
  --query 'DBInstances[].{ID:DBInstanceIdentifier,IAMAuth:IAMDatabaseAuthenticationEnabled}'
```

---

## 3. Environments

| Env | Instance | Database | Credential in `.env` |
| --- | --- | --- | --- |
| Local | Docker `task-list-postgres` | `tasklist` | `DATABASE_URL_LOCAL` |
| Dev | `hospital-os-dev` | `productivity_ai_dev` | `DATABASE_URL` |
| **Prod** | **`hospital-os-prod`** | **`productivity-ai`** | `DATABASE_URL_PROD_RDS` (migration only) |
| Prod (retired) | Neon `ep-wild-dream-az80qi4x` | `neondb` | `DATABASE_URL_PROD` — **kept as rollback** |

Prod runs on **EC2 under PM2** (`day-planner-backend`, port 8000) — *not* the Docker/ECS setup
`DEPLOY.md` describes. To pick up `.env` changes: `pm2 restart day-planner-backend --update-env`.

---

## 4. Connecting — and the five ways it fails

### Dev (open to the internet)

```bash
DB_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
psql "${DB_URL%%\?*}?sslmode=require" -c '\dt'
```

### Prod (IP-allowlisted, verify-full)

```bash
psql "postgresql://postgres:<pass>@hospital-os-prod.cv02w0mscr9b.ap-south-1.rds.amazonaws.com/productivity-ai?sslmode=verify-full&sslrootcert=$PWD/global-bundle.pem" -c '\dt'
```

### The gotchas, in the order they bite

**1. `uselibpqcompat=true` breaks psql.** It is a **node-postgres-only** parameter; libpq rejects it
as an invalid URI parameter. Always strip the query string for psql: `"${DB_URL%%\?*}?sslmode=require"`.

**2. …but the app REQUIRES it.** node-postgres 8.21+ reads a bare `sslmode=require` as
*verify-full*, which fails against RDS's private CA with `SELF_SIGNED_CERT_IN_CHAIN`.
`uselibpqcompat=true` restores libpq's "encrypt, don't verify" behaviour. Hence the asymmetry:
psql strips it, the app needs it.

**3. `sslrootcert` is resolved against the process's CWD.** A relative `./global-bundle.pem` fails
with *"root certificate file does not exist"* whenever you are not in the backend directory. **Use
an absolute path.** Fetch the bundle with:
`curl -o global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`

**4. A hanging connection is a firewall; an error is not.** `Operation timed out` = packets dropped
= your IP is not allowlisted. `password authentication failed` = you *reached* the server, which is
progress. Never debug a timeout as a credentials problem.

**5. `productivity-ai` contains hyphens.** Fine in a URL, but every SQL reference needs double
quotes: `DROP DATABASE "productivity-ai";`. Note `push-local-to-dev.sh`'s guard requires "dev" in
the target name, so it will correctly refuse to touch prod.

---

## 5. Network access

| Instance | Security group | Rule |
| --- | --- | --- |
| `hospital-os-dev` | `sg-0047f85783b3af57c` | **`0.0.0.0/0`** on 5432 — open to the whole internet |
| `hospital-os-prod` | `sg-05d8349e0a834198f` | Per-developer `/32` allowlist + SG references |

**The app does NOT reach prod by IP.** The EC2 box's public IP is not allowlisted. Instead, rule
**`sgr-008cd38986be004b7`** permits port 5432 from **`sg-0c846d46dae70017e`** (the EC2 instance's
security group). EC2 and RDS share `vpc-00b5450d8ceeb04e5`, so traffic stays private inside the VPC
and survives public-IP changes.

> ⚠️ **Never revoke `sgr-008cd38986be004b7`.** It is what the running application depends on.
> Revoking it takes production down. It is easy to sweep up when pruning stale developer IPs.

**Adding a developer IP** (prefer asking DevOps — the list is long and full of stale entries):

```bash
curl -s https://checkip.amazonaws.com                      # your current IP
aws ec2 authorize-security-group-ingress --region ap-south-1 \
  --group-id sg-05d8349e0a834198f \
  --ip-permissions 'IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=<IP>/32,Description="<who> <why> <date>"}]'
# revoke when done:
aws ec2 revoke-security-group-ingress --region ap-south-1 \
  --group-id sg-05d8349e0a834198f --security-group-rule-ids <sgr-...>
```

**Testing connectivity from the EC2 box** — `nc` is **not installed** on Amazon Linux 2023. Use the
bash builtin:

```bash
timeout 5 bash -c '</dev/tcp/hospital-os-prod.cv02w0mscr9b.ap-south-1.rds.amazonaws.com/5432' \
  && echo "PORT OPEN" || echo "BLOCKED"
```

---

## 6. The migration

`scripts/migrate-neon-to-rds.sh` — Neon → RDS. Reads `DATABASE_URL_PROD` (source) and
`DATABASE_URL_PROD_RDS` (target); both accept environment overrides so you can rehearse against a
throwaway database without editing `.env`.

Five guards, each aborting before anything is touched: source ≠ target · same PG major · **collation
matches** · **zero in-flight jobs** · **target empty**. It then dumps, restores with
`--exit-on-error`, and verifies **exact row counts table-by-table on both sides**. It never edits
`.env`, never restarts the app, and only ever *reads* from Neon.

### Two decisions worth understanding

**Collation.** RDS defaults to `en_US.UTF-8`; Neon used `C.UTF-8`. `C` sorts by raw bytes (every
capital before any lowercase — `Bharat | Zoya | aarav`), `en_US` by dictionary rules
(`aarav | Bharat | Zoya`). With ~442 `orderBy` clauses in the app, many on `name`, that would have
silently reordered every user-facing list. The empty target was therefore recreated to match:

```sql
CREATE DATABASE "productivity-ai"
  WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8';
```

(RDS spells the locale `C.utf8`; Neon spells it `C.UTF-8`. Same locale — the script normalises
before comparing.) `TEMPLATE template0` is required, since `template1` carries `en_US.UTF-8`.

**Excluding the `pgboss` schema.** Jobs live in *two* places: `ProcessingJob` (in `public`, the
status row the frontend polls) and `pgboss.job` (the actual queue). Dumping with
`--exclude-schema=pgboss` takes one and leaves the other, and pg-boss recreates its schema empty at
boot. The danger: the startup reconciler (`failStaleProcessing`) only rescues rows with
`status='processing'`. A **`queued`** row has a NULL `startedAt`, so it is never reconciled — it
would poll forever with no queue entry to run it.

**Therefore: only exclude `pgboss` when the queue is drained.** Verify first:

```bash
psql "$URL" -c 'SELECT status, count(*) FROM "ProcessingJob" GROUP BY status;'
psql "$URL" -c 'SELECT name, state, count(*) FROM pgboss.job GROUP BY 1,2;'
```

### Runbook (as executed, 2026-08-24 — 24 seconds of data movement)

```bash
# 0. Rehearse against a throwaway DB — no downtime, pg_dump only READS from Neon.
psql "<dev>/postgres?sslmode=require" -c "CREATE DATABASE dryrun WITH TEMPLATE template0 \
  ENCODING 'UTF8' LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8';"
DATABASE_URL_PROD_RDS='<dryrun url>' bash scripts/migrate-neon-to-rds.sh
# Then DROP it — a rehearsal copies real password hashes onto the wide-open dev instance.

# 1. On EC2 — stage the new config and a rollback copy BEFORE any downtime.
cp .env .env.neon_backup
cp .env.production .env_pre        # DATABASE_URL + DIRECT_DATABASE_URL pointed at RDS

# 2. Stop the app  ← downtime starts (halts the API and the in-process worker together)
pm2 stop day-planner-backend

# 3. Migrate (from a workstation)
bash scripts/migrate-neon-to-rds.sh

# 4. Swap config and restart
cp .env_pre .env
pm2 restart day-planner-backend --update-env

# 5. Verify  ← downtime ends
curl -i http://localhost:8000/readyz     # expect 200 {"status":"ok","checks":{"db":"ok"}}
```

**Order matters:** never deploy the new `.env` before the data lands, or the app connects to an
empty database.

**Result:** 23 tables, 10,210 rows, all matching. Confirmed afterwards via `pg_stat_activity` —
10 Prisma pool connections plus one `pgboss` connection from `172.31.6.87` (the EC2 **private** IP),
and a freshly created `pgboss` schema proving the app completed startup.

### Rollback

```bash
cp .env.neon_backup .env && pm2 restart day-planner-backend --update-env
```

The migration never writes to Neon, so it remains a complete copy. **Do not decommission the Neon
project until RDS has proven itself.**

---

## 7. Known issues

| Issue | Notes |
| --- | --- |
| `JWT_SECRET` is a placeholder in prod | Anyone who knows it can forge tokens for any user. Rotating invalidates all sessions — needs its own window. |
| `LOG_LEVEL=debug` in prod | The full firehose. `info` is the intended production default. |
| App's S3 key belongs to IAM user `subha` | Production media storage depends on a colleague's *personal* credentials. Needs a dedicated service user scoped to the one bucket. |
| Prod DB uses the master `postgres` user | A scoped app role was explicitly declined; revisit if the risk appetite changes. |
| `hospital-os-dev` is open to `0.0.0.0/0` | Postgres **and** SSH. Never place real production data there. |
| Prod shares an instance with another team | 20 GB `db.t4g.small`; its `postgres` database holds 411 MB of their data. Shared blast radius. |
| The prod allowlist accumulates stale IPs | Per-developer `/32` entries are never pruned. A bastion or VPN would replace the whole list. |
