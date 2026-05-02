/**
 * Snapshot-style tests for the prompt loader. Catches accidental drift
 * in the runtime prompt's structure (the worked examples are load-
 * bearing — Al's voice-check baseline).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { loadPrompt, resolvePromptPath } from '../prompt.js';

describe('annotation prompt', () => {
  it('resolves to a real file under product/cms/prompts/etl/image-annotation/', () => {
    const promptPath = resolvePromptPath();
    expect(promptPath).toMatch(/cms[/\\]prompts[/\\]etl[/\\]image-annotation[/\\]prompt\.md$/);
    expect(existsSync(promptPath)).toBe(true);
    expect(statSync(promptPath).size).toBeGreaterThan(500);
  });

  it('loads non-empty prompt text', () => {
    const text = loadPrompt();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('contains the load-bearing structural anchors', () => {
    const text = loadPrompt();
    // Worked examples — the calibration spine.
    expect(text).toMatch(/Worked examples/i);
    expect(text).toMatch(/Torres del Paine/);
    expect(text).toMatch(/Magellanic penguin/i);

    // The two output keys + their voice cues.
    expect(text).toMatch(/`description`/);
    expect(text).toMatch(/`annotation`/);
    expect(text).toMatch(/journey-shaped/);

    // The empty-pair skip-signal contract — tested branch in run.ts.
    expect(text).toMatch(/"description"\s*:\s*""/);
    expect(text).toMatch(/"annotation"\s*:\s*""/);

    // Avoidance list — voice control. (Subset; full list in 10_style-avoid.md.)
    expect(text).toMatch(/em-dash/i);
    expect(text).toMatch(/delve/i);
  });

  it('throws on missing file', () => {
    expect(() => loadPrompt('/tmp/this-file-does-not-exist-xyzzy.md')).toThrow(/prompt file not found/);
  });
});
