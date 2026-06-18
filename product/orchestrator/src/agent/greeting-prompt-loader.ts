/**
 * Consent-triggered greeting prompt loader (consent-greeting-prewarm, PW-3).
 *
 * Content-as-data: the warm-hello instruction lives in CMS at
 * `cms/prompts/greeting/00_greeting.md`, never inline in TS. It is loaded ONCE
 * at boot and threaded into `createChatHandler` as `greetingPrompt`, exactly as
 * `loadMemoryPrompts` loads `loaded-header.md` and threads `memoryLoadedHeader`.
 *
 * Fail-fast: a missing or empty file throws at startup rather than yielding a
 * silent no-greeting deploy (mirrors `loadMemoryPrompts` + the
 * prompts-relocated-to-cms pattern, 5ec30a9). The greeting is loaded explicitly
 * — the `00_` prefix is cosmetic alignment with the numbered system-prompt
 * convention, NOT a participant in the system-prompt concatenation.
 *
 * Path resolution mirrors `buildThinkingFallbackInjection` in factory.ts: the
 * greeting dir is a sibling of `cms/prompts/system/`
 * (`config.systemPromptDirAbsolutePath`), so we resolve against its parent.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '../config/index.js';

/** Filename of the greeting instruction within `cms/prompts/greeting/`. */
const GREETING_PROMPT_FILENAME = '00_greeting.md';

/**
 * Absolute path to the greeting prompt, resolved as a sibling of the
 * system-prompt directory (`cms/prompts/system/` → `cms/prompts/greeting/`).
 * Exposed so the boot log + tests can name the exact file.
 */
export function resolveGreetingPromptPath(
  config: Pick<Config, 'systemPromptDirAbsolutePath'>,
): string {
  return path.resolve(
    config.systemPromptDirAbsolutePath,
    '..',
    'greeting',
    GREETING_PROMPT_FILENAME,
  );
}

/**
 * Load the greeting prompt at boot. Fail-fast on a missing/unreadable or
 * empty-after-trim file so a misconfigured deploy surfaces at startup, not on
 * the first consent grant.
 */
export function loadGreetingPrompt(
  config: Pick<Config, 'systemPromptDirAbsolutePath'>,
): string {
  const absPath = resolveGreetingPromptPath(config);
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new Error(
      `[greeting-prompt] failed to read ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(`[greeting-prompt] ${absPath} is empty after trim().`);
  }
  return trimmed;
}
