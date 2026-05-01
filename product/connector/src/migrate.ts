/**
 * Migration runner — thin wrapper around `node-pg-migrate`'s programmatic
 * runner.
 *
 * Per planning/03-exec-c-t1.md HITL Q2: manual `npm run migrate:up` only
 * for C.t1 (operator runs between deploys). Boot-time auto-migration
 * explicitly rejected. Cloud Run Job for prod (post-M4).
 *
 * Forward-only per decision C.31. Plain SQL files at
 * product/connector/migrations/. The runner reads DATABASE_URL via the
 * same `loadConfig()` the service uses — single source of truth.
 *
 * IMPORTANT: this script will run migrations against whatever DATABASE_URL
 * is set. Verification step 5 in the plan calls out that `puma_dev` is
 * deliberately untouched (that's C.t3's job to populate). Run against a
 * fresh test DB during C.t1; C.t3 takes the wheel for the dev DB.
 */

import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import { runner } from 'node-pg-migrate';
import { loadConfig } from './config/index.js';

type Direction = 'up' | 'down';

function parseDirection(arg: string | undefined): Direction {
  if (arg === 'up' || arg === undefined) return 'up';
  if (arg === 'down') {
    // We accept the keyword for symmetry with the runner's API but explicitly
    // discourage its use. C.31 names forward-only as the convention; the
    // expected recovery from a bad migration is "drop the database, re-run
    // all migrations forward, re-run ETL" (theme 5). If you find yourself
    // typing `down`, you almost certainly want a new forward migration that
    // undoes the change instead.
    console.warn(
      '[connector] migrate down requested — forward-only is the convention (C.31). ' +
        'Prefer authoring a new forward migration that undoes the change.',
    );
    return 'down';
  }
  console.error(`[connector] unknown migration direction: ${arg}`);
  console.error('[connector] usage: npm run migrate:up   # or: tsx src/migrate.ts up');
  process.exit(1);
}

async function main(): Promise<void> {
  const direction = parseDirection(process.argv[2]);
  const config = loadConfig();

  console.log(`[connector] running migrations ${direction} against the configured DATABASE_URL`);
  console.log(`[connector] migrations dir: ${config.migrationsDirAbsolutePath}`);

  const applied = await runner({
    databaseUrl: config.DATABASE_URL,
    dir: config.migrationsDirAbsolutePath,
    direction,
    // node-pg-migrate's default migrations table. Documented call-out at
    // C.t1 HITL Q2: we're happy with the default name — `pgmigrations`
    // is the project-standard convention out of the box.
    migrationsTable: 'pgmigrations',
    // Wrap the whole batch in one transaction so a failure half-way
    // through doesn't leave the DB in a half-migrated state.
    singleTransaction: true,
    // Defensive lock so two concurrent migrate runs can't trample each
    // other (e.g. operator + CI fired together). On by default in the
    // runner; explicit here for clarity.
    noLock: false,
  });

  if (applied.length === 0) {
    console.log('[connector] no migrations to run — DB is up to date.');
  } else {
    console.log(`[connector] applied ${applied.length} migration(s):`);
    for (const m of applied) {
      console.log(`  - ${m.name}`);
    }
  }
}

main().catch((err) => {
  console.error('[connector] migration failed:', err);
  process.exit(1);
});
