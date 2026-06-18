# Migration management — Postgres schema operations

Operator-facing runbook for running, rolling forward, and recovering from Postgres migrations. Open this when a schema change is pending, when boot complains about migrations, or when you need to know what to do after a migration fails.

---

## Why this exists

Puma's connector owns the Postgres schema. Migrations are versioned SQL files under `product/connector/migrations/`, applied via `node-pg-migrate`. Any schema change — a new column, a new index, a new derived table — lands as a new migration file; previous files never change.

Migrations are **forward-only** (decision **C.31**). The derived store is throwaway — recovery from a bad migration is rebuild, not rollback.

---

## What you'll do every time

For day-to-day ops:

1. Apply pending migrations after `git pull`.
2. Check status if boot complains.

For schema changes:

1. Author a new migration file with the next zero-padded prefix.
2. Apply it locally, verify, commit.

Time-box: seconds-to-minutes for routine application; longer if a migration fails and a rebuild is needed.

---

## Cadence + ownership

- **When**: every time a schema change lands on `main`; every time a fresh `puma_dev` is provisioned; before any ETL re-run.
- **Who**: the **ETL operator** for routine application; whoever's authoring the schema change for new migrations.
- **How long**: a few seconds for routine application; minutes-to-hours for a full rebuild if recovery is needed.

---

## Step 1 — Apply pending migrations

```bash
npm run migrate:up --workspace @swoop/connector
```

The runner walks the `product/connector/migrations/` directory in lexicographic order, applies any not yet recorded in the `pgmigrations` table, and exits.

You'll know it worked when:
- The output ends with applied migration names or *"no migrations to run"*.
- No exception trace.

---

## "Can't determine timestamp for NNN" warnings

The runner prints lines like:

```
Can't determine timestamp for 002
Can't determine timestamp for 003
...
```

once per migration file. **These are benign.** Per decision **C.31**, our migrations use a zero-padded sequence prefix (`002_domain_tables.sql`) rather than the timestamp prefix `node-pg-migrate` expects (`1709123456789_create_users.sql`). Without a parseable timestamp, the runner can't suggest the *"skip already-newer migrations"* optimisation — hence the message.

Migrations apply correctly. The warning is informational only. Don't roll back, don't restart, don't worry.

This is documented at `gotchas.md` "node-pg-migrate emits 'Can't determine timestamp'" so it's the kind of thing future-you can grep for.

---

## Forward-only — recovery is rebuild, not rollback

Per decision **C.31**, migrations are forward-only. There is no `migrate:down` script wired up. If a migration partially applies and leaves the schema inconsistent, the recovery path is:

1. Drop the database.
2. Recreate it.
3. Re-run all migrations forward.
4. Re-run ETL.
5. Re-run enrichment.

The derived store is rebuildable from the source dump in roughly 30 minutes (ETL ~10s + enrichment ~24h via Batches API; the embedding pass dominates wall-clock but most of that is async wait, not active operator time).

---

## Recovery — full rebuild from scratch

When you need it (a migration partly applied; a corrupt local DB; you've lost track of what's in `puma_dev`):

```bash
# 1. Drop the database. The connector + ETL must be stopped first.
PG=/Applications/Postgres.app/Contents/Versions/latest/bin
$PG/dropdb puma_dev

# 2. Recreate it.
$PG/createdb -O al puma_dev
$PG/psql -d puma_dev -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 3. Apply every migration forward.
npm run migrate:up --workspace @swoop/connector

# 4. Re-run ETL.
npm run etl:sql --workspace @swoop/ingestion

# 5. Re-run enrichment.
npm run enrich --workspace @swoop/ingestion -- --mode=all
```

You'll know it worked when:
- Domain table row counts match the baseline (see `etl-rerun.md` step 4).
- Derived table embedding columns are populated (see `embedding-rerun.md` step 3).

If `dropdb` fails with *"database is being accessed by other users"*, an old connector or ETL process is still holding connections. Look for stray `tsx` processes (`ps aux | grep tsx`) and kill them — `npm` doesn't propagate SIGTERM cleanly to its tsx child (see `troubleshooting.md` "npm dev SIGTERM doesn't kill tsx").

---

## Adding a new migration

1. Pick the next zero-padded sequence prefix. Current latest is `008_image_tag_columns.sql`; the next is `009_*`.

2. Author the file at `product/connector/migrations/009_<short-snake-name>.sql`. Use `IF NOT EXISTS` guards on every DDL statement so re-runs are idempotent:

   ```sql
   ALTER TABLE foo
     ADD COLUMN IF NOT EXISTS bar TEXT;

   CREATE INDEX IF NOT EXISTS idx_foo_bar ON foo (bar);
   ```

3. Apply locally:

   ```bash
   npm run migrate:up --workspace @swoop/connector
   ```

4. Verify the schema change with `psql`:

   ```bash
   psql "$DATABASE_URL" -c "\d foo"
   ```

5. Commit the file alongside any code that depends on the new schema.

The `node-pg-migrate` runner records the applied migration in the `pgmigrations` table; subsequent `migrate:up` calls skip it.

---

## When things go wrong

### Symptom: `"Can't determine timestamp for NNN"`

Benign. See above.

### Symptom: `error: relation "foo" does not exist` from a downstream tool

A migration that adds the table didn't apply. Run `npm run migrate:up --workspace @swoop/connector`; check the `pgmigrations` table to confirm it landed.

### Symptom: `error: extension "vector" is not available`

`pgvector` isn't installed in the Postgres instance. For local dev:

```bash
PG=/Applications/Postgres.app/Contents/Versions/latest/bin
$PG/psql -d puma_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

For Cloud SQL prod, enable the extension via the console or `gcloud sql instances patch`. The connector's startup will tell you the extension is missing if it isn't there.

### Symptom: migration partly applied, schema looks broken

Don't try to hand-repair. Rebuild — see "Recovery" above. The forward-only posture means every migration must be idempotent, but if one isn't (a bug), rebuild from scratch.

### Symptom: `password authentication failed for user "al"`

The role / password in `DATABASE_URL` is wrong. The local convention is `al` / `pick-a-password`. See `gotchas.md` "Local Postgres is Postgres.app v18".

### Symptom: connection to `localhost:5432` refused

Postgres.app isn't running. Open the Postgres.app menubar icon and start the cluster.

### Symptom: `dropdb` fails with database in use

Stray connector or ETL process. Find and kill: `ps aux | grep -E 'tsx|node' | grep -v grep`, then `kill <pid>`.

---

## Open items for Al

1. **Cloud SQL extension provisioning at deploy**. Enabling `vector` + `pg_trgm` on Cloud SQL is a one-time deploy step; document it as a runbook section once IAM lands and the prod instance is bootstrapped.
2. **Migration test in CI**. Today migrations apply locally + in test setup; production migration application is manual at deploy time. Post-M4, wire a CI step that runs `migrate:up` against an ephemeral DB to catch breaking changes pre-merge.
3. **Backup posture for prod**. Forward-only + rebuild-from-source is the dev posture. For prod, decide whether to add periodic pg_dump snapshots — open question for post-M4.

---

## Where the rules came from

- Decision **C.31** — Postgres migrations are forward-only, zero-padded numeric prefix, plain SQL.
- `gotchas.md` "node-pg-migrate emits 'Can't determine timestamp' warnings" — explanation of the benign warning.
- `gotchas.md` "Local Postgres is Postgres.app v18" — local-dev DB conventions.
- `03-exec-c-t1.md` — the Tier 3 plan that produced the connector + migration runner.
