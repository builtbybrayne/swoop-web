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

import { chmod, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  HandoffPayloadSchema,
  messageOf,
  type HandoffPayload,
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
}
