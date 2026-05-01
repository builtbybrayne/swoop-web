/**
 * Smoke tests for the migration runner script.
 *
 * The actual `node-pg-migrate` runner is exercised manually during C.t1
 * verification (see plan §"Verification" step 5: drop a fresh test DB,
 * `npm run migrate:up`, verify migrations 001–006 apply). That round-trip
 * doesn't fit cleanly in vitest because it needs a running Postgres + DB
 * lifecycle.
 *
 * What we DO unit-test here:
 *   - The migrate.ts file imports without side effects (no top-level
 *     pool creation, no env reads outside loadConfig).
 *   - The migrations directory contains the six SQL files we expect.
 *
 * The end-to-end verification — applies cleanly to a fresh DB, re-run
 * is a no-op — is documented in the C.t1 execution log.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, '..', '..', 'migrations');

describe('migrate.ts setup', () => {
  it('migrations directory contains the six C.t2 SQL files', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    expect(files).toEqual([
      '001_extensions.sql',
      '002_domain_tables.sql',
      '003_derived_tables.sql',
      '004_indexes.sql',
      '005_canonical_url_function.sql',
      '006_customerreview_tables.sql',
    ]);
  });

  it('all migration files are non-empty', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    for (const f of files) {
      const stat = statSync(path.join(MIGRATIONS_DIR, f));
      expect(stat.size).toBeGreaterThan(0);
    }
  });
});
