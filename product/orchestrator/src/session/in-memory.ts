/**
 * In-memory `SessionStore` — B.t2, Phase 1 default.
 *
 * Why a custom in-memory adapter (not ADK's `InMemorySessionService`):
 *   - ADK's session model is keyed on `(appName, userId, sessionId)` and
 *     carries an opaque `state: Record<string, unknown>` blob plus an event
 *     log. Puma's `SessionState` is a typed, strongly-shaped record with
 *     triage verdict, consent, wishlist, and first-class conversation
 *     history entries. Mapping ours into ADK's `state` blob on every
 *     round-trip adds friction without buying anything Phase 1 needs.
 *   - Phase 1 runs one orchestrator process with in-process sessions — a
 *     single `Map<string, Entry>` is the right data structure; anything
 *     more is over-built for the slice.
 *   - The idle sweeper (archive after 24h of silence, delete after 7d in
 *     archive) is a Puma concern per chunk B §2.6 + chunk E §2.3. ADK's
 *     in-memory service has no such lifecycle.
 *
 * The ADK-native adapter (`adk-native.ts`) is a separate, coexisting path
 * for when a future slice wants ADK's event log / multi-user tenancy.
 *
 * Time is injected via `now()` so the sweeper is deterministically testable
 * with a mocked clock (see `__tests__/in-memory.test.ts`).
 */

import { randomUUID } from 'node:crypto';
import type { SessionState } from '@swoop/common';
import type { SessionStore } from './interface.js';

/**
 * One stored record. `archivedAt` drives the two-stage sweep:
 *   - `null` → active. Idle past TTL → archive.
 *   - non-null → archived. Elapsed past retention → delete.
 */
interface Entry {
  state: SessionState;
  archivedAt: string | null;
}

export interface InMemorySessionStoreOptions {
  /**
   * How long a session can sit idle (no `update` / `get`) before the
   * sweeper archives it. Default 24h per chunk B §2.6a.
   */
  idleTtlMs?: number;
  /**
   * How long an archived session is retained before deletion. Default 7d
   * per chunk B §2.6a and chunk E §2.3 (consent-adjacent retention).
   */
  archiveTtlMs?: number;
  /**
   * Clock injection for tests. Returns milliseconds since epoch.
   */
  now?: () => number;
}

const DEFAULT_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build a default `SessionState` shell. Merges supplied `initial` fields
 * over the defaults so callers can supply only what they have (typically
 * `metadata` and sometimes `consent`); the rest is filled in.
 *
 * Consent defaults to `granted: false` everywhere — that's deliberate. The
 * whole point of `canAcceptTurn` is that a freshly-minted session fails
 * the tier-1 gate until the visitor opts in.
 */
function buildDefaultState(
  initial: Partial<SessionState> | undefined,
  nowIso: string,
  generatedId: string,
): SessionState {
  const ungranted = { granted: false, timestamp: nowIso };
  return {
    sessionId: initial?.sessionId ?? generatedId,
    createdAt: initial?.createdAt ?? nowIso,
    updatedAt: initial?.updatedAt ?? nowIso,
    conversationHistory: initial?.conversationHistory ?? [],
    triage: initial?.triage ?? { verdict: 'none' },
    wishlist: initial?.wishlist ?? { items: [] },
    consent: initial?.consent ?? {
      conversation: ungranted,
      handoff: ungranted,
    },
    metadata: initial?.metadata ?? {},
  };
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Entry>();
  private readonly idleTtlMs: number;
  private readonly archiveTtlMs: number;
  private readonly nowMs: () => number;

  constructor(opts: InMemorySessionStoreOptions = {}) {
    this.idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.archiveTtlMs = opts.archiveTtlMs ?? DEFAULT_ARCHIVE_TTL_MS;
    this.nowMs = opts.now ?? (() => Date.now());
  }

  async create(initial?: Partial<SessionState>): Promise<SessionState> {
    const nowIso = new Date(this.nowMs()).toISOString();
    const state = buildDefaultState(initial, nowIso, randomUUID());
    if (this.sessions.has(state.sessionId)) {
      throw new Error(`session already exists: ${state.sessionId}`);
    }
    this.sessions.set(state.sessionId, { state, archivedAt: null });
    return state;
  }

  async get(id: string): Promise<SessionState | null> {
    const entry = this.sessions.get(id);
    return entry ? entry.state : null;
  }

  async update(
    id: string,
    mutate: (s: SessionState) => SessionState,
  ): Promise<SessionState> {
    const entry = this.sessions.get(id);
    if (!entry) {
      throw new Error(`session not found: ${id}`);
    }
    const next = mutate(entry.state);
    const nowIso = new Date(this.nowMs()).toISOString();
    entry.state = { ...next, updatedAt: nowIso };
    return entry.state;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async archive(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) return;
    if (entry.archivedAt === null) {
      entry.archivedAt = new Date(this.nowMs()).toISOString();
    }
  }

  // -------------------------------------------------------------------------
  // Sweeper — not part of the `SessionStore` interface. In-memory specific.
  //
  // Callers wire a `setInterval` (B.t5 or wherever the server boots)
  // invoking `sweep()` periodically. Split into two steps so tests can
  // assert each stage independently.
  // -------------------------------------------------------------------------

  /** Visible for tests. */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Run one sweep pass: archive idle-past-TTL sessions; delete
   * archived-past-retention sessions. Returns counts for observability.
   */
  sweep(): { archived: number; deleted: number } {
    const now = this.nowMs();
    let archived = 0;
    let deleted = 0;
    for (const [id, entry] of this.sessions.entries()) {
      if (entry.archivedAt === null) {
        const updatedMs = Date.parse(entry.state.updatedAt);
        if (now - updatedMs >= this.idleTtlMs) {
          entry.archivedAt = new Date(now).toISOString();
          archived += 1;
        }
      } else {
        const archivedMs = Date.parse(entry.archivedAt);
        if (now - archivedMs >= this.archiveTtlMs) {
          this.sessions.delete(id);
          deleted += 1;
        }
      }
    }
    return { archived, deleted };
  }
}
