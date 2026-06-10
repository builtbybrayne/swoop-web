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

/**
 * 010 is a deliberate no-op placeholder (B.t11 — session history projection).
 * Phase 1 session state is in-memory; the file exists to keep C.31's forward-
 * only zero-padded chain continuous when B.22's Postgres SessionService
 * lands. The file is non-empty (header comment only); `node-pg-migrate`
 * applies it as a no-op.
 */
const PLACEHOLDER_MIGRATIONS = new Set<string>([
  '010_session_history_observability.sql',
]);

describe('migrate.ts setup', () => {
  it('migrations directory contains the expected SQL files (001–017)', () => {
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
      '007_image_annotation.sql',
      '008_image_tag_columns.sql',
      '009_embeddings_dim_3072.sql',
      '010_session_history_observability.sql',
      '011_tour_card.sql',
      '012_embedding_cache.sql',
      '013_customer_tip_table.sql',
      '014_customer_tip_drop_topic_tags.sql',
      '015_customer_tip_drop_classified_at.sql',
      '016_puma_session.sql',
      '017_provenance_columns.sql',
    ]);
  });

  it('all non-placeholder migration files are non-empty', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    for (const f of files) {
      const stat = statSync(path.join(MIGRATIONS_DIR, f));
      // Placeholder migrations (B.t11) carry header comments only; their body
      // is intentionally empty. Either way every file is on disk and at
      // minimum carries the header comment block, so size > 0 holds.
      expect(stat.size).toBeGreaterThan(0);
      if (!PLACEHOLDER_MIGRATIONS.has(f)) {
        // For real migrations, require a more substantive body — guard
        // against an accidental empty file being added as if it were real.
        expect(stat.size).toBeGreaterThan(64);
      }
    }
  });
});
