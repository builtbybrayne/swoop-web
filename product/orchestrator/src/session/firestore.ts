/**
 * Firestore `SessionStore` stub — B.t2.
 *
 * Deliberately interface-shaped but body-less. Symmetric with
 * `vertex-ai.ts`: production selection between the two is a post-M4
 * decision (top-level B.2). Every method throws "not implemented".
 *
 * Startup constructs cleanly; first call throws. B.t2 Verification step 4
 * covers this shape.
 *
 * When this class lights up for real, it will wrap `@google-cloud/firestore`
 * and persist `SessionState` docs under a `sessions/{sessionId}` collection
 * path — exact layout nailed down at post-M4 implementation time.
 */

import type { SessionState } from '@swoop/common';
import type { SessionStore } from './interface.js';

function notImplemented(method: string): never {
  throw new Error(
    `FirestoreSessionStore.${method} is not implemented — ` +
      `production Firestore wiring is a post-M4 decision (top-level B.2). ` +
      `Switch SESSION_BACKEND to "in-memory" or "adk-native" for now.`,
  );
}

export class FirestoreSessionStore implements SessionStore {
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
