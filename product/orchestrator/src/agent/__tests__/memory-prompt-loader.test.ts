/**
 * Tests for memory-prompt-loader.ts.
 *
 * Confirms the memory-feature prompts load from the real `cms/prompts/memory/`
 * files (the relocation off inline TS constants — content-as-data). Closes the
 * gap that the relocation otherwise shipped untested: a loader bug (wrong file,
 * bad key, empty content) would silently feed the agent wrong/missing prompts.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadMemoryPrompts, MEMORY_PROMPT_TOOL_NAMES } from '../memory-prompt-loader.js';

// src/agent/__tests__ -> orchestrator -> product -> product/cms/prompts/memory
const MEMORY_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../cms/prompts/memory',
);

describe('loadMemoryPrompts', () => {
  it('loads every memory-feature prompt from CMS, each non-empty', () => {
    const p = loadMemoryPrompts(MEMORY_DIR);

    // Mode wrapper — the Opus memory agent's instruction (sm-1/sm-3).
    expect(p.modeWrapper).toContain('Memory management mode');
    expect(p.modeWrapper).toContain('Save this? (yes/no)'); // confirm-before-save
    expect(p.modeWrapper).toContain('finish_memory'); // handback cue

    // Loaded-block header — the authoritative signal (sm-6).
    expect(p.loadedHeader).toContain('AUTHORITATIVE');
    expect(p.loadedHeader).toContain('state as fact');

    // Seed preamble — must keep the substitution placeholder (sm-9).
    expect(p.seedContext).toContain('{{transcript}}');

    // All six tool descriptions present + non-empty.
    for (const name of MEMORY_PROMPT_TOOL_NAMES) {
      const desc = p.toolDescriptions[name];
      expect(desc).toBeTruthy();
      expect((desc ?? '').length).toBeGreaterThan(0);
    }
  });

  it('fails fast when the directory is missing', () => {
    expect(() => loadMemoryPrompts('/no/such/memory/dir')).toThrow();
  });
});
