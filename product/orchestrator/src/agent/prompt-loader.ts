/**
 * System prompt loader.
 *
 * Content-as-data (theme 2, planning/01-top-level.md §3): the WHY prompt is
 * a file on disk, not a string constant. Prompt changes don't rebuild the
 * service.
 *
 * Behaviour (planning/03-exec-agent-runtime-t1.md):
 *   - Read the file synchronously at startup.
 *   - In NODE_ENV !== 'production', re-read from disk on each call
 *     (so an editor save is visible on the next request).
 *   - Otherwise cache the first read in memory for the process lifetime.
 *
 * Not in scope for B.t1:
 *   - Templating / fragment composition (the static prompt is the whole prompt).
 *   - Modular guidance / skills (B.t9 wires those via ADK's native skill
 *     primitive, see planning/02-impl-agent-runtime.md §2.2 / B.3).
 *   - File-watching. Re-read on each request is sufficient for dev; the warm
 *     session pool (B.t10, post-M1) invalidates on content change separately.
 */

import { readFileSync } from 'node:fs';

export interface PromptLoader {
  /** Return the current system prompt contents as a string. */
  load(): string;
  /** Absolute path the loader reads from. For startup logs. */
  readonly path: string;
}

/**
 * Build a prompt loader.
 *
 * @param absolutePath  Fully-resolved path to the prompt file.
 * @param isProduction  If true, cache the first read in memory. Otherwise
 *                      re-read on every load() call.
 */
export function createPromptLoader(absolutePath: string, isProduction: boolean): PromptLoader {
  // Read once at construction time so a missing / unreadable prompt file is
  // a startup error, not a first-request error. This matches B.t1's
  // "fail fast at startup" posture for the broader config surface.
  const initialContents = readFromDisk(absolutePath);

  if (isProduction) {
    return {
      load: () => initialContents,
      path: absolutePath,
    };
  }

  // Dev mode: hot reload. We hold the initial contents as a warm cache, but
  // re-read on every call so the session pool / future request handlers see
  // edits without a restart.
  return {
    load: () => readFromDisk(absolutePath),
    path: absolutePath,
  };
}

function readFromDisk(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[orchestrator] Failed to read system prompt at ${absolutePath}: ${message}`);
  }
}
