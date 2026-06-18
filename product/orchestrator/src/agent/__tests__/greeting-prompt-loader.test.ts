/**
 * consent-greeting-prewarm — greeting-prompt loader fail-fast tests.
 *
 * The loader reads `cms/prompts/greeting/00_greeting.md` resolved as a sibling
 * of the system-prompt dir, and MUST throw at boot on a missing or
 * empty-after-trim file (mirrors loadMemoryPrompts). These tests point the
 * loader at temp dirs so they never depend on the real CMS file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadGreetingPrompt,
  resolveGreetingPromptPath,
} from '../greeting-prompt-loader.js';

const tmpRoots: string[] = [];

/**
 * Build a temp `prompts/` tree and return the config slice the loader needs.
 * `systemPromptDirAbsolutePath` points at `<root>/prompts/system`; the loader
 * resolves the greeting file as its sibling `<root>/prompts/greeting/00_greeting.md`.
 */
function makeConfig(greetingBody: string | null): {
  systemPromptDirAbsolutePath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'swoop-greeting-'));
  tmpRoots.push(root);
  const promptsDir = path.join(root, 'prompts');
  mkdirSync(path.join(promptsDir, 'system'), { recursive: true });
  if (greetingBody !== null) {
    mkdirSync(path.join(promptsDir, 'greeting'), { recursive: true });
    writeFileSync(
      path.join(promptsDir, 'greeting', '00_greeting.md'),
      greetingBody,
      'utf8',
    );
  }
  return { systemPromptDirAbsolutePath: path.join(promptsDir, 'system') };
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('loadGreetingPrompt (consent-greeting-prewarm)', () => {
  it('loads and trims a present, non-empty greeting prompt', () => {
    const config = makeConfig('  Say a short warm hello.  \n');
    expect(loadGreetingPrompt(config)).toBe('Say a short warm hello.');
  });

  it('throws when the greeting file is missing (fail-fast at boot)', () => {
    const config = makeConfig(null);
    expect(() => loadGreetingPrompt(config)).toThrow(/failed to read/);
  });

  it('throws when the greeting file is empty after trim', () => {
    const config = makeConfig('   \n\t  ');
    expect(() => loadGreetingPrompt(config)).toThrow(/empty after trim/);
  });

  it('resolves the greeting path as a sibling of the system-prompt dir', () => {
    const config = makeConfig('hello');
    const resolved = resolveGreetingPromptPath(config);
    expect(resolved).toMatch(/[/\\]prompts[/\\]greeting[/\\]00_greeting\.md$/);
  });
});
