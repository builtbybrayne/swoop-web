/**
 * Regression tests for the agent factory (B.t9 + 2026-05-18 nice-goodall fix).
 *
 * The bug being guarded against:
 *   B.t9 (commit 9965d64, 2026-05-18) wrapped the connector FunctionTools in
 *   `new SkillToolset(skills, { additionalTools: tools })` and passed only
 *   `tools: [skillToolset]` to LlmAgent. That hid the eight intent-named
 *   connector tools from Sonnet because ADK's `SkillToolset.additionalTools`
 *   is a conditional pool gated by per-skill `frontmatter.metadata.adk_additional_tools`
 *   declarations — not unconditional bundling. None of the 14 authored
 *   SKILL.md files declare that metadata, so the connector tools never
 *   reached `llmRequest.toolsDict` and never reached Anthropic. Fix: pass
 *   the connector tools as top-level siblings of the SkillToolset.
 *
 * What this file asserts:
 *   1. `agent.tools.length === connectorTools.length + 1` — connector tools
 *      survive the factory as direct entries (the +1 is the SkillToolset).
 *      A single bare-Map entry (the buggy pre-fix shape) would fail here.
 *   2. The SkillToolset is constructed with the loaded skills only; no
 *      `additionalTools` are bundled inside it (where they'd be gated).
 *   3. Each connector FunctionTool passed in appears verbatim in `agent.tools`
 *      (referential identity), not a wrapper or a re-bound clone.
 *
 * The skills dir is a tmp dir with two minimal SKILL.md fixtures so the
 * real loader path runs end-to-end without coupling to the authored
 * `cms/prompts/skills/` content.
 *
 * Related plan: planning/03-exec-agent-runtime-t9.md §"## 2026-05-18 nice-goodall
 * live-smoke fix — connector tools restored as top-level siblings".
 */

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SkillToolset } from '@google/adk';
import type { FunctionTool } from '@google/adk';

import { buildOrchestratorAgent, buildThinkingFallbackInjection } from '../factory.js';
import type { Config } from '../../config/index.js';
import type { PromptLoader } from '../prompt-loader.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeSkillsDir(slugs: ReadonlyArray<string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'puma-factory-test-skills-'));
  tempDirs.push(dir);
  for (const slug of slugs) {
    const skillDir = path.join(dir, slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${slug}\ndescription: 'fixture skill ${slug}'\n---\n\n# ${slug}\n\nBody for ${slug}.\n`,
      'utf8',
    );
  }
  return dir;
}

/**
 * Minimal Config fixture sufficient for `buildOrchestratorAgent` — only the
 * model + key + skills-dir fields are read by the factory. Other fields
 * carry plausible defaults via the cast; the factory never touches them.
 */
function testConfig(skillsDirAbsolutePath: string): Config {
  return {
    ANTHROPIC_API_KEY: 'test-key-not-used',
    ORCHESTRATOR_MODEL: 'claude-sonnet-4-5-20250929',
    skillsDirAbsolutePath,
  } as Config;
}

/**
 * Stub PromptLoader — the factory only invokes `.load()` lazily inside the
 * `instruction` provider, which never fires during construction. Return a
 * synchronous string for safety in case future factory changes call it.
 */
function stubPromptLoader(): PromptLoader {
  return {
    load: () => 'TEST_INSTRUCTION',
  } as unknown as PromptLoader;
}

/**
 * Minimal FunctionTool stub. ADK's FunctionTool has more surface than this
 * (validate, run, etc.) but the factory only forwards the reference into
 * LlmAgent.tools; nothing in the factory's own codepath introspects it.
 */
function fakeTool(name: string): FunctionTool {
  return {
    name,
    description: `fake ${name}`,
    _getDeclaration: () => ({ name, description: `fake ${name}`, parameters: { type: 'object' } }),
  } as unknown as FunctionTool;
}

describe('buildOrchestratorAgent — tool surface (B.t9 fix)', () => {
  it('exposes connector tools as top-level siblings of the SkillToolset', async () => {
    const skillsDir = makeSkillsDir(['alpha', 'beta']);
    const tools = [
      fakeTool('find_inspiring'),
      fakeTool('find_someone_who'),
      fakeTool('find_options'),
      fakeTool('illustrate'),
    ];

    const { agent } = await buildOrchestratorAgent({
      config: testConfig(skillsDir),
      promptLoader: stubPromptLoader(),
      tools,
    });

    // The regression: prior to the fix, `agent.tools.length` was always 1
    // (the SkillToolset). After the fix, it scales with connector tools.
    expect(agent.tools).toHaveLength(tools.length + 1);
  });

  it('places the SkillToolset first and the connector tools after it (referential identity preserved)', async () => {
    const skillsDir = makeSkillsDir(['alpha']);
    const findOptions = fakeTool('find_options');
    const illustrate = fakeTool('illustrate');

    const { agent } = await buildOrchestratorAgent({
      config: testConfig(skillsDir),
      promptLoader: stubPromptLoader(),
      tools: [findOptions, illustrate],
    });

    expect(agent.tools[0]).toBeInstanceOf(SkillToolset);
    expect(agent.tools[1]).toBe(findOptions);
    expect(agent.tools[2]).toBe(illustrate);
  });

  it('does NOT bundle connector tools inside the SkillToolset additionalTools (they would be gated by per-skill metadata)', async () => {
    const skillsDir = makeSkillsDir(['alpha']);
    const tools = [fakeTool('find_options'), fakeTool('lookup')];

    const { agent } = await buildOrchestratorAgent({
      config: testConfig(skillsDir),
      promptLoader: stubPromptLoader(),
      tools,
    });

    const toolset = agent.tools[0] as SkillToolset;
    // `additionalTools` is the conditional-binding pool — must stay empty
    // for connector tools, which need unconditional Anthropic visibility.
    expect(toolset.additionalTools).toEqual([]);
  });

  it('returns the loaded skills alongside the agent (for tests + boot-log inspection)', async () => {
    const skillsDir = makeSkillsDir(['alpha', 'bravo', 'charlie']);

    const { skills } = await buildOrchestratorAgent({
      config: testConfig(skillsDir),
      promptLoader: stubPromptLoader(),
      tools: [],
    });

    expect(skills.map((s) => s.frontmatter.name)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('still returns an agent when no connector tools are passed (degraded but valid — SkillToolset-only)', async () => {
    const skillsDir = makeSkillsDir(['alpha']);

    const { agent } = await buildOrchestratorAgent({
      config: testConfig(skillsDir),
      promptLoader: stubPromptLoader(),
      tools: [],
    });

    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0]).toBeInstanceOf(SkillToolset);
  });
});

describe('buildThinkingFallbackInjection (RL.3 — thinking-off belt)', () => {
  function makeBeltDir(beltText: string): string {
    const root = mkdtempSync(path.join(tmpdir(), 'puma-factory-belt-'));
    tempDirs.push(root);
    mkdirSync(path.join(root, 'system'), { recursive: true });
    mkdirSync(path.join(root, 'fallbacks'), { recursive: true });
    writeFileSync(path.join(root, 'fallbacks', 'silent-working.md'), beltText, 'utf8');
    return path.join(root, 'system'); // == systemPromptDirAbsolutePath
  }

  it('injects the belt (with separator) when thinking is disabled', () => {
    const systemDir = makeBeltDir('WORK SILENTLY — fixture belt');
    const out = buildThinkingFallbackInjection({
      ORCHESTRATOR_THINKING_ENABLED: false,
      systemPromptDirAbsolutePath: systemDir,
    });
    expect(out.startsWith('\n\n---\n\n')).toBe(true);
    expect(out).toContain('WORK SILENTLY — fixture belt');
  });

  it('injects nothing when thinking is enabled (no file read)', () => {
    const systemDir = makeBeltDir('SHOULD NOT APPEAR');
    expect(
      buildThinkingFallbackInjection({
        ORCHESTRATOR_THINKING_ENABLED: true,
        systemPromptDirAbsolutePath: systemDir,
      }),
    ).toBe('');
  });

  it('treats an undefined flag (cast/partial Config) as not-disabled — returns "" without a file read', () => {
    // Guards the existing factory tests, whose cast Config leaves the field unset.
    const out = buildThinkingFallbackInjection({
      systemPromptDirAbsolutePath: '/nonexistent/system',
    } as unknown as Parameters<typeof buildThinkingFallbackInjection>[0]);
    expect(out).toBe('');
  });
});
