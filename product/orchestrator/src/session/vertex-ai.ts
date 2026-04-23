/**
 * Vertex AI Session Service `SessionStore` stub — B.t2.
 *
 * Deliberately interface-shaped but body-less. Production selection
 * between this and `firestore.ts` is a post-M4 decision (top-level
 * decision B.2). Every method throws a clear "not implemented" error so a
 * misconfigured env selector fails loudly at first use, not silently.
 *
 * Startup path is clean: constructing the store does NOT throw — it's the
 * method calls that do. This is per the B.t2 Verification step 4: startup
 * with `SESSION_BACKEND=vertex-ai` succeeds, actual use triggers the stub.
 *
 * When this class lights up for real, it will wrap Google's Vertex AI
 * Session Service (`@google-cloud/vertexai` or the ADK adapter, whichever
 * exists at the time) and map `SessionState` onto its record shape — same
 * pattern as `adk-native.ts`.
 */

import type { SessionState } from '@swoop/common';
import type { SessionStore } from './interface.js';

function notImplemented(method: string): never {
  throw new Error(
    `VertexAiSessionStore.${method} is not implemented — ` +
      `production Vertex AI Session Service wiring is a post-M4 decision (top-level B.2). ` +
      `Switch SESSION_BACKEND to "in-memory" or "adk-native" for now.`,
  );
}

export class VertexAiSessionStore implements SessionStore {
  async create(_initial?: Partial<SessionState>): Promise<SessionState> {
    notImplemented('create');
  }

  async get(_id: string): Promise<SessionState | null> {
    notImplemented('get');
  }

  async update(
    _id: string,
    _mutate: (s: SessionState) => SessionState,
  ): Promise<SessionState> {
    notImplemented('update');
  }

  async delete(_id: string): Promise<void> {
    notImplemented('delete');
  }

  async archive(_id: string): Promise<void> {
    notImplemented('archive');
  }
}
