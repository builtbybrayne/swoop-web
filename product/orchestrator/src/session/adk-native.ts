/**
 * ADK-native `SessionStore` adapter — B.t2.
 *
 * Wraps ADK's in-memory `BaseSessionService` (via the public
 * `getSessionServiceFromUri('memory://')` factory) and maps Puma's typed
 * `SessionState` onto ADK's opaque `state: Record<string, unknown>` field.
 *
 * Why this adapter exists alongside the custom in-memory one:
 *   - When a later slice wants ADK's event log, runner wiring, or
 *     multi-user tenancy, flip `SESSION_BACKEND=adk-native` and the rest
 *     of the code is unchanged.
 *   - The Vertex AI Session Service stub (B.t2's post-M4 production path)
 *     will likely slot in via a similar ADK-backed approach, so keeping a
 *     working ADK adapter here proves the shape.
 *
 * Puma-specific state (triage / consent / wishlist) lives inside ADK's
 * generic `state` record under a single namespace key (`puma`). We do not
 * try to round-trip ADK's `events` list into our `conversationHistory` —
 * that's a separate concern (B.t6) and doing it here would tangle two
 * responsibilities.
 *
 * Tenancy note: ADK sessions are keyed on `(appName, userId, sessionId)`.
 * Phase 1 is anonymous / pre-handoff — we use a single fixed `appName`
 * and an anonymous `userId`. Real tenancy lands with the lead-capture
 * handoff in chunk E.
 */

import { getSessionServiceFromUri } from '@google/adk';
import type { SessionState } from '@swoop/common';
import type { SessionStore } from './interface.js';

/** Namespace under which we store Puma state inside ADK's state blob. */
const PUMA_STATE_KEY = 'puma';

/** Fixed identity for Phase 1 anonymous sessions. Revisited in chunk E. */
const DEFAULT_APP_NAME = 'puma-orchestrator';
const DEFAULT_USER_ID = 'anonymous';

export interface AdkNativeSessionStoreOptions {
  /** App name passed to ADK on create/get/delete. Defaults to `puma-orchestrator`. */
  appName?: string;
  /** User id passed to ADK. Defaults to `anonymous` for pre-handoff sessions. */
  userId?: string;
  /** Override the ADK service URI. Defaults to `memory://`. */
  serviceUri?: string;
  /** Clock injection for tests. */
  now?: () => number;
}

/**
 * Retrieve the Puma `SessionState` from the ADK session's opaque state.
 * Throws if missing or malformed — that's always a bug (we put it there on
 * create, nobody else has write access).
 */
function unwrap(adkState: Record<string, unknown>): SessionState {
  const raw = adkState[PUMA_STATE_KEY];
  if (!raw || typeof raw !== 'object') {
    throw new Error(`adk session missing ${PUMA_STATE_KEY} state key`);
  }
  return raw as SessionState;
}

function wrap(state: SessionState): Record<string, unknown> {
  return { [PUMA_STATE_KEY]: state };
}

function buildDefaultState(
  initial: Partial<SessionState> | undefined,
  nowIso: string,
  fallbackId: string,
): SessionState {
  const ungranted = { granted: false, timestamp: nowIso };
  return {
    sessionId: initial?.sessionId ?? fallbackId,
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

export class AdkNativeSessionStore implements SessionStore {
  private readonly svc: ReturnType<typeof getSessionServiceFromUri>;
  private readonly appName: string;
  private readonly userId: string;
  private readonly nowMs: () => number;
  /** Local archive flags — ADK's base service has no archive concept. */
  private readonly archived = new Set<string>();

  constructor(opts: AdkNativeSessionStoreOptions = {}) {
    this.svc = getSessionServiceFromUri(opts.serviceUri ?? 'memory://');
    this.appName = opts.appName ?? DEFAULT_APP_NAME;
    this.userId = opts.userId ?? DEFAULT_USER_ID;
    this.nowMs = opts.now ?? (() => Date.now());
  }

  async create(initial?: Partial<SessionState>): Promise<SessionState> {
    const nowIso = new Date(this.nowMs()).toISOString();
    // Let ADK generate the session id; we reuse it for `sessionId` in our
    // state so `state.sessionId === adkSession.id` always holds.
    const adkSession = await this.svc.createSession({
      appName: this.appName,
      userId: this.userId,
      sessionId: initial?.sessionId,
      state: {}, // filled in below once we know the generated id
    });
    const state = buildDefaultState(initial, nowIso, adkSession.id);
    adkSession.state = wrap(state);
    return state;
  }

  async get(id: string): Promise<SessionState | null> {
    const adkSession = await this.svc.getSession({
      appName: this.appName,
      userId: this.userId,
      sessionId: id,
    });
    if (!adkSession) return null;
    return unwrap(adkSession.state);
  }

  async update(
    id: string,
    mutate: (s: SessionState) => SessionState,
  ): Promise<SessionState> {
    const adkSession = await this.svc.getSession({
      appName: this.appName,
      userId: this.userId,
      sessionId: id,
    });
    if (!adkSession) {
      throw new Error(`session not found: ${id}`);
    }
    const current = unwrap(adkSession.state);
    const next = mutate(current);
    const nowIso = new Date(this.nowMs()).toISOString();
    const finalState: SessionState = { ...next, updatedAt: nowIso };
    adkSession.state = wrap(finalState);
    return finalState;
  }

  async delete(id: string): Promise<void> {
    this.archived.delete(id);
    await this.svc.deleteSession({
      appName: this.appName,
      userId: this.userId,
      sessionId: id,
    });
  }

  async archive(id: string): Promise<void> {
    // ADK's base service has no native archival; track locally. A future
    // ADK version or Vertex AI Session Service may expose this directly,
    // at which point this set goes away.
    this.archived.add(id);
  }
}
