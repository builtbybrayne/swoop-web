/**
 * Tests for memory-description-loader.ts.
 *
 * Confirms the five connector-facing memory tool descriptions load from the real
 * `cms/prompts/memory/tools/` files (the relocation off the inline
 * MEMORY_TOOL_DESCRIPTIONS map). Closes the otherwise-untested CMS-load path.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  loadMemoryToolDescriptions,
  MEMORY_TOOL_NAMES_FOR_CONNECTOR,
} from '../memory-description-loader.js';

// src/tools/__tests__ -> connector -> product -> product/cms/prompts/memory
const MEMORY_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../cms/prompts/memory',
);

describe('loadMemoryToolDescriptions', () => {
  it('loads all five connector-facing memory tool descriptions, each non-empty', () => {
    const d = loadMemoryToolDescriptions(MEMORY_DIR);
    for (const name of MEMORY_TOOL_NAMES_FOR_CONNECTOR) {
      expect(d[name]).toBeTruthy();
      expect((d[name] ?? '').length).toBeGreaterThan(0);
    }
    // finish_memory is orchestrator-internal — never loaded connector-side.
    expect((d as Record<string, string>).finish_memory).toBeUndefined();
  });

  it('fails fast when the directory is missing', () => {
    expect(() => loadMemoryToolDescriptions('/no/such/memory/dir')).toThrow();
  });
});
