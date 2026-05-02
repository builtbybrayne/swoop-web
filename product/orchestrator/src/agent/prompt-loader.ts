/**
 * System prompt loader.
 *
 * Content-as-data (theme 2, planning/01-top-level.md §3): the system prompt is
 * authored as one or more markdown files on disk under
 * `cms/prompts/system/`, not a string constant. Prompt changes don't rebuild
 * the service.
 *
 * Behaviour (planning/03-exec-agent-runtime-t1a.md, decision G.11 in
 * planning/decisions.md):
 *   - Read the directory at construction time. Files matching
 *     `^\d{2}_[a-z0-9-]+\.md$` are the system-prompt fragments. Anything else
 *     (drafts, README.md, .notes.md) is silently ignored.
 *   - Sort the matching files lexicographically by filename. Two-digit numeric
 *     prefixes guarantee deterministic order past 9.
 *   - Concatenate file contents with `\n\n---\n\n` between them and use the
 *     joined string as the agent's `instruction`.
 *   - Trim trailing whitespace from each fragment before joining so authorial
 *     newline habits don't bleed into the joined output.
 *   - In NODE_ENV !== 'production', re-read the directory + every matching
 *     file on each `load()` call (so an editor save is visible on the next
 *     request). Otherwise cache the joined string in memory for the process
 *     lifetime.
 *
 * Failure modes (all caught at construction so a misconfigured deploy fails
 * fast at startup, not on the first user turn):
 *   - Directory doesn't exist (operator typo in `SYSTEM_PROMPT_DIR`).
 *   - Directory exists but contains zero files matching the load pattern.
 *   - A matching file is unreadable (permissions, broken symlink).
 *
 * Not in scope here:
 *   - Frontmatter parsing. System fragments are pure prose; frontmatter is for
 *     skills (handled by ADK in B.t9).
 *   - Variable interpolation / templating. The system prompt is static once
 *     loaded.
 *   - File-watching. Re-read on each request is sufficient for dev; the warm
 *     session pool (B.t10) invalidates on content change separately.
 *   - Reading from `cms/prompts/skills/` or `cms/prompts/tools/`. Those
 *     subdirectories have their own loaders.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { messageOf } from '@swoop/common';

/** Files matching this pattern under `cms/prompts/system/` are concatenated
 *  into the system prompt; everything else is ignored. Two-digit numeric
 *  prefix is required to keep lexicographic sort stable past 9. */
export const SYSTEM_PROMPT_FILE_PATTERN = /^\d{2}_[a-z0-9-]+\.md$/;

/** Separator between concatenated fragments. Markdown horizontal rule + a
 *  blank line either side. Survives any markdown renderer if the joined
 *  prompt is ever logged for debugging, and gives the model a clear visual
 *  segmentation hint. */
const FRAGMENT_SEPARATOR = '\n\n---\n\n';

export interface PromptLoader {
  /** Return the current system prompt contents as a string. */
  load(): string;
  /** Absolute path to the directory the loader reads from. For startup logs. */
  readonly path: string;
}

/**
 * Build a prompt loader.
 *
 * @param absoluteDirPath  Fully-resolved path to the system-prompt directory.
 * @param isProduction     If true, cache the joined string after the first
 *                         successful read. Otherwise re-read on every
 *                         `load()` call.
 */
export function createPromptLoader(absoluteDirPath: string, isProduction: boolean): PromptLoader {
  // Read once at construction time so a missing / empty / unreadable
  // directory is a startup error, not a first-request error. This matches
  // B.t1's "fail fast at startup" posture for the broader config surface.
  const initialContents = loadAndJoin(absoluteDirPath);

  if (isProduction) {
    return {
      load: () => initialContents,
      path: absoluteDirPath,
    };
  }

  // Dev mode: re-read on every call so an editor save is reflected on the
  // next request without a service restart.
  return {
    load: () => loadAndJoin(absoluteDirPath),
    path: absoluteDirPath,
  };
}

function loadAndJoin(absoluteDirPath: string): string {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absoluteDirPath, { withFileTypes: true });
  } catch (err) {
    const message = messageOf(err);
    throw new Error(
      `[orchestrator] Failed to read system-prompt directory at ${absoluteDirPath}: ${message}`,
    );
  }

  // Files only — sub-directories whose name happens to match the pattern
  // (e.g. someone made `20_legacy.md/` by mistake) are silently skipped.
  const matching = entries
    .filter((entry) => entry.isFile() && SYSTEM_PROMPT_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (matching.length === 0) {
    throw new Error(
      `[orchestrator] No system-prompt fragments found in ${absoluteDirPath}. ` +
        `Files must match ${SYSTEM_PROMPT_FILE_PATTERN.source} ` +
        `(two-digit numeric prefix, lowercase + hyphens, '.md' extension).`,
    );
  }

  const fragments = matching.map((name) => {
    const filePath = path.join(absoluteDirPath, name);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      const message = messageOf(err);
      throw new Error(
        `[orchestrator] Failed to read system-prompt fragment ${filePath}: ${message}`,
      );
    }
    // Strip trailing whitespace so each fragment ends predictably regardless
    // of authorial newline habit. Leading whitespace is preserved (markdown
    // structure may rely on it).
    return raw.replace(/\s+$/u, '');
  });

  return fragments.join(FRAGMENT_SEPARATOR);
}
