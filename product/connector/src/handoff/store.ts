/**
 * Durable handoff store — interface + file-backed reference implementation.
 *
 * STATUS: ad-hoc / interim. The whole `FsHandoffStore` is throwaway code we
 * keep until chunk E.t2 proper lands the durable backend — Cloud SQL Postgres
 * per decisions E.10 + C.18 + C.23 (the original Firestore target was dropped
 * project-wide in C.23). See planning/02-impl-handoff-and-compliance.md §2.4.
 *
 * Why we still build a real interface for the throwaway impl:
 *   - The orchestrator (and future MCP `handoff_submit` tool) only needs
 *     to know about `HandoffStore`. Swapping the implementation later is
 *     one constructor injection, no caller changes.
 *   - The tests in this module exercise the interface contract; the
 *     `PostgresHandoffStore` will inherit those tests when it lands.
 *
 * File layout (one record per handoff):
 *   <dir>/<handoffId>.json
 *
 * Atomic write: write to `<handoffId>.json.tmp` then rename. Crash-safe on
 * POSIX — the rename is atomic on the same filesystem, so a partial write
 * never leaves a corrupted record visible to readers.
 *
 * Filename safety: the handoffId is checked against
 * `^[a-zA-Z0-9_-]+$` before any filesystem operation. Anything else
 * (slashes, dots, traversal sequences) is rejected with
 * `handoff_id_invalid`. This protects against a malformed payload trying
 * to escape the store directory.
 */

import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  HandoffPayloadSchema,
  messageOf,
  type HandoffPayload,
  type HandoffVerdict,
} from '@swoop/common';

// ---------------------------------------------------------------------------
// File-mode discipline (Sec-1, 2026-04-30 code review).
//
// Visitor PII (name, email, phone, motivationAnchor, full conversation
// summary) lands here in cleartext JSON. Default umask + recursive-mkdir
// would leave records world-readable on a shared host. GDPR Art. 32 wants
// "appropriate technical measures"; least-privilege file modes are the
// cheapest such measure.
//
// Directory: 0o700 — owner only.
// File:      0o600 — owner only.
// ---------------------------------------------------------------------------

const HANDOFF_DIR_MODE = 0o700;
const HANDOFF_FILE_MODE = 0o600;

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export type SaveResult =
  | { readonly ok: true; readonly handoffId: string; readonly absolutePath: string }
  | { readonly ok: false; readonly reason: 'handoff_id_invalid' | 'write_failed'; readonly detail?: string };

/**
 * Result of a single-record `delete()` call.
 *
 * `deleted: true` — file was present and is now gone.
 * `deleted: false` — file was absent; nothing changed. Idempotent.
 * `ok: false` — the call itself failed (invalid id or fs op error).
 */
export type DeleteResult =
  | { readonly ok: true; readonly deleted: boolean }
  | {
      readonly ok: false;
      readonly reason: 'handoff_id_invalid' | 'delete_failed';
      readonly detail?: string;
    };

/**
 * Reason a single record was skipped during a sweep. The sweep continues
 * across remaining records; the skip is recorded in the returned tally for
 * operator inspection.
 */
export type SkipReason =
  /** Record on disk is corrupt or fails Zod parse — left in place per HITL Q5
   *  ratification so an operator can investigate. */
  | 'parse_failed'
  /** Defensive — Zod parse on the verdict succeeded so this shouldn't happen,
   *  but a record whose verdict doesn't map to a policy entry lands here. */
  | 'unknown_verdict'
  /** Age below retention threshold; record stays. */
  | 'not_expired'
  /** Fs op failed for this individual record; other records continue. */
  | 'delete_failed';

/**
 * `RetentionPolicy` — per-verdict map of ms-since-`session.handoffSubmittedAt`.
 *
 * Authoritative values live in `product/cms/legal/compliance-bundle/
 * 05-retention-policy.md` (decisions E.6 + E.7); the `DEFAULT_RETENTION_POLICY`
 * constant in sweeper.ts encodes them.
 */
export type RetentionPolicy = Readonly<Record<HandoffVerdict, number /* ms */>>;

/**
 * Result of a single sweep pass.
 *
 * `ok: true` happy path carries:
 *   - `scanned`   — total records iterated.
 *   - `deleted`   — total records hard-deleted.
 *   - `perVerdict`— per-verdict deletion tally; sums to `deleted`.
 *   - `skipped`   — array of `{ handoffId, reason }` for any record the sweep
 *                   could not act on (corrupt JSON, fs failure, etc.).
 *
 * `ok: false` failure path indicates the sweep itself could not complete
 * (e.g. `list()` threw). `partial` carries whatever progress was made before
 * the abort.
 */
export type SweepResult =
  | {
      readonly ok: true;
      readonly scanned: number;
      readonly deleted: number;
      readonly perVerdict: Readonly<Record<HandoffVerdict, number>>;
      readonly skipped: ReadonlyArray<{ readonly handoffId: string; readonly reason: SkipReason }>;
    }
  | {
      readonly ok: false;
      readonly reason: 'sweep_failed';
      readonly detail: string;
      readonly partial?: { scanned: number; deleted: number };
    };

export interface HandoffStore {
  /** Persist a handoff payload. Idempotent on the same handoffId — re-saving
   *  with the same id overwrites the prior record (last-write-wins). */
  save(payload: HandoffPayload): Promise<SaveResult>;

  /** Read a previously-saved handoff by id. Returns `null` if not found or
   *  if the file is unreadable / fails Zod validation. */
  get(handoffId: string): Promise<HandoffPayload | null>;

  /** List all handoff ids currently in the store. Useful for tests + ad-hoc
   *  inspection during development; not relied on in production paths. */
  list(): Promise<readonly string[]>;

  /**
   * Hard-delete a single record by id. Idempotent — deleting a missing record
   * resolves to `{ ok: true, deleted: false }` rather than an error. The
   * filename-safety regex (`HANDOFF_ID_PATTERN`) is checked before any fs op;
   * a malformed id returns `{ ok: false, reason: 'handoff_id_invalid' }`.
   *
   * Consumers: the retention sweeper (`sweepHandoffs` in sweeper.ts) plus
   * the forthcoming E.t7 right-to-erasure runbook.
   *
   * The future `PostgresHandoffStore.delete` is a one-line SQL
   * `DELETE FROM handoff WHERE handoff_id = $1 RETURNING handoff_id` —
   * caller code is invariant.
   */
  delete(handoffId: string): Promise<DeleteResult>;

  /**
   * Sweep the store: iterate every record, compute the per-record deletion
   * predicate against `now` + `policy`, hard-delete the matches, return a
   * `SweepResult` tallying scanned / deleted / perVerdict / skipped.
   *
   * Today's `FsHandoffStore` iterates via `list()` → `get()` → `delete()`.
   * Tomorrow's `PostgresHandoffStore.sweep` is one SQL statement against the
   * `scheduled_deletion_at` index. Same signature; same return shape; caller
   * code (the sweeper module's wrapper, the CLI, the in-process timer) does
   * not change at swap time.
   *
   * Per E.t6 §"★ Read this first" — this method lives on the interface, not
   * inside `FsHandoffStore`, so the retention story survives the Postgres
   * swap unchanged.
   */
  sweep(now: Date, policy: RetentionPolicy): Promise<SweepResult>;
}

// ---------------------------------------------------------------------------
// Filename / id safety.
// ---------------------------------------------------------------------------

/** Whitelist for handoff ids. Matches the fixtures' shape (`handoff_puma_…`)
 *  and rejects anything that could escape the store directory. */
export const HANDOFF_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ---------------------------------------------------------------------------
// File-backed reference implementation.
// ---------------------------------------------------------------------------

export class FsHandoffStore implements HandoffStore {
  constructor(private readonly dirAbsolutePath: string) {}

  async save(payload: HandoffPayload): Promise<SaveResult> {
    if (!HANDOFF_ID_PATTERN.test(payload.handoffId)) {
      return {
        ok: false,
        reason: 'handoff_id_invalid',
        detail: `handoffId must match ${HANDOFF_ID_PATTERN.source}`,
      };
    }

    const finalPath = path.join(this.dirAbsolutePath, `${payload.handoffId}.json`);
    const tmpPath = `${finalPath}.tmp`;

    try {
      await mkdir(this.dirAbsolutePath, { mode: HANDOFF_DIR_MODE, recursive: true });
      await writeFile(tmpPath, JSON.stringify(payload, null, 2), {
        encoding: 'utf8',
        mode: HANDOFF_FILE_MODE,
      });
      // Belt-and-braces: writeFile honours `mode` only when creating; an
      // existing tmp file would inherit prior bits. Force the mode before
      // the rename so the final inode lands at 0o600 either way.
      await chmod(tmpPath, HANDOFF_FILE_MODE);
      await rename(tmpPath, finalPath);
      return { ok: true, handoffId: payload.handoffId, absolutePath: finalPath };
    } catch (err) {
      const detail = messageOf(err);
      return { ok: false, reason: 'write_failed', detail };
    }
  }

  async get(handoffId: string): Promise<HandoffPayload | null> {
    if (!HANDOFF_ID_PATTERN.test(handoffId)) return null;

    const filePath = path.join(this.dirAbsolutePath, `${handoffId}.json`);

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      return null;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return null;
    }

    const result = HandoffPayloadSchema.safeParse(parsedJson);
    return result.success ? result.data : null;
  }

  async list(): Promise<readonly string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(this.dirAbsolutePath, { withFileTypes: true });
    } catch {
      return [];
    }

    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^([a-zA-Z0-9_-]+)\.json$/);
      if (!match) continue;
      ids.push(match[1]!);
    }
    return ids.sort();
  }

  // -------------------------------------------------------------------------
  // delete() — hard-delete one record by id (E.t6 §2.5).
  //
  // Idempotent. Filename-safety regex enforced before any fs op. Missing
  // records resolve to `{ ok: true, deleted: false }` rather than an error so
  // the sweeper + the future right-to-erasure runbook can call this without
  // pre-existence checks.
  // -------------------------------------------------------------------------

  async delete(handoffId: string): Promise<DeleteResult> {
    if (!HANDOFF_ID_PATTERN.test(handoffId)) {
      return {
        ok: false,
        reason: 'handoff_id_invalid',
        detail: `handoffId must match ${HANDOFF_ID_PATTERN.source}`,
      };
    }

    const filePath = path.join(this.dirAbsolutePath, `${handoffId}.json`);

    try {
      await unlink(filePath);
      return { ok: true, deleted: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Idempotent: a missing record is fine. The retention sweep + the
        // E.t7 erasure runbook both call `delete` after a `list()` they
        // can't fully synchronise against (records may be removed between
        // the list and the per-id delete); the missing-record path is part
        // of the contract.
        return { ok: true, deleted: false };
      }
      return { ok: false, reason: 'delete_failed', detail: messageOf(err) };
    }
  }

  // -------------------------------------------------------------------------
  // sweep() — iterate the store, hard-delete expired records (E.t6 §2.3).
  //
  // For each id returned by `list()`:
  //   1. `get(id)` — read + Zod-parse the record. Parse failure → skip with
  //      reason `parse_failed`, record left in place per HITL Q5 ratification.
  //   2. Compute `expiresAt = parseISO(session.handoffSubmittedAt) +
  //      policy[verdict]`. Missing-policy-entry → skip `unknown_verdict`
  //      (defensive only — Zod parse guarantees the verdict is enumerated).
  //   3. If `expiresAt < now`, call `delete(id)`. Successful unlink ticks the
  //      per-verdict tally + the deleted total. Fs failure on this individual
  //      record → skip with `delete_failed`; sweep continues for the rest.
  //   4. Otherwise the record is in-window — record skip reason `not_expired`
  //      is NOT emitted (high-volume noise). `scanned - deleted - skipped`
  //      gives the in-window count.
  //
  // The whole sweep is sequential. POSIX-rename atomic writes (from `save`)
  // mean the directory is consistent at every individual file boundary, and
  // the sweep doesn't lock — a handoff submitted mid-sweep is either listed
  // by `list()` (almost certainly fresh, so not expired) or not (and survives
  // to be considered next time). No race condition that matters at our scale.
  //
  // If `list()` itself throws — the directory is missing / unreadable — the
  // sweep aborts with `{ ok: false, reason: 'sweep_failed' }`; the wrapping
  // sweeper module emits `handoff.retention.sweep.failed`.
  // -------------------------------------------------------------------------

  async sweep(now: Date, policy: RetentionPolicy): Promise<SweepResult> {
    let ids: readonly string[];
    try {
      ids = await this.list();
    } catch (err) {
      return {
        ok: false,
        reason: 'sweep_failed',
        detail: messageOf(err),
      };
    }

    const perVerdict: Record<HandoffVerdict, number> = {
      qualified: 0,
      referred_out: 0,
      disqualified: 0,
      inconclusive: 0,
    };
    const skipped: Array<{ handoffId: string; reason: SkipReason }> = [];
    let scanned = 0;
    let deleted = 0;

    for (const id of ids) {
      scanned += 1;

      const record = await this.get(id);
      if (record === null) {
        // get() returns null for fs-error / malformed JSON / schema-invalid.
        // All three are operator-investigation territory; don't auto-delete
        // a corrupt record per HITL Q5 ratification.
        skipped.push({ handoffId: id, reason: 'parse_failed' });
        continue;
      }

      const window = policy[record.verdict];
      if (typeof window !== 'number') {
        // Defensive only — Zod parse guarantees verdict is one of the four
        // enum values, and the policy types as Readonly<Record<HandoffVerdict,
        // number>>. If we ever extend the verdict enum and forget to extend
        // the policy, this catches it without aborting the sweep.
        skipped.push({ handoffId: id, reason: 'unknown_verdict' });
        continue;
      }

      const submittedAtMs = Date.parse(record.session.handoffSubmittedAt);
      if (Number.isNaN(submittedAtMs)) {
        // Zod's `.datetime()` enforces ISO-8601 at parse time; this branch is
        // defence in depth. Treat as parse-failed for operator visibility
        // (no auto-delete).
        skipped.push({ handoffId: id, reason: 'parse_failed' });
        continue;
      }

      const expiresAtMs = submittedAtMs + window;
      if (expiresAtMs >= now.getTime()) {
        // In-window — not expired. No skip entry; the count is implicit in
        // `scanned - deleted - skipped.length`.
        continue;
      }

      const deleteResult = await this.delete(id);
      if (!deleteResult.ok) {
        skipped.push({ handoffId: id, reason: 'delete_failed' });
        continue;
      }
      if (deleteResult.deleted) {
        deleted += 1;
        perVerdict[record.verdict] += 1;
      }
      // If `deleted === false` here, another concurrent sweep (or a manual
      // operator action) beat us to it. Quietly successful; don't tally as
      // either "deleted" or "skipped". The next sweep will not see the id.
    }

    return {
      ok: true,
      scanned,
      deleted,
      perVerdict: Object.freeze(perVerdict),
      skipped: Object.freeze(skipped),
    };
  }
}
