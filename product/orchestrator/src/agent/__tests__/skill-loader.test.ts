/**
 * Unit tests for the ADK skill loader (B.t9).
 *
 * Covers planning/03-exec-agent-runtime-t9.md §"Task 2 — Update agent factory
 * to load + bundle skills". The loader is a thin wrapper around ADK's
 * `loadAllSkillsInDir` that adds:
 *   - fail-fast on missing/unreadable directory (mirrors B.t1a prompt loader);
 *   - empty-directory tolerance (returns []; caller logs a warning);
 *   - a stable, lexicographically-sorted return order for deterministic
 *     boot logs and tests.
 *
 * Each test runs in an isolated `os.tmpdir()` directory created via
 * `fs.mkdtempSync`, so tests are independent and don't pollute the repo.
 *
 * NB on the plan's API premise: the plan's "★ Read this first" section
 * claimed `loadAllSkillsInDir` does not exist in @google/adk. Step 0 of the
 * plan verified the installed API and found that `loadAllSkillsInDir` DOES
 * exist (returns `Promise<Record<string, Skill>>`). The loader therefore
 * delegates to it directly rather than enumerating folders manually. See
 * the 2026-05-18 execution log addendum at the bottom of that plan for
 * the verbatim API surface.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadSkillsFromDir } from '../skill-loader.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'puma-skill-loader-'));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(baseDir: string, slug: string, description = 'triggers on ' + slug): void {
  const skillDir = path.join(baseDir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n\nBody for ${slug}.\n`,
    'utf8',
  );
}

describe('loadSkillsFromDir', () => {
  it('loads one skill per subdirectory containing SKILL.md', async () => {
    const dir = makeTempDir();
    writeSkill(dir, 'alpha-skill');
    writeSkill(dir, 'beta-skill');

    const skills = await loadSkillsFromDir(dir);
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.frontmatter.name).sort();
    expect(names).toEqual(['alpha-skill', 'beta-skill']);
  });

  it('returns results in lexicographic order of skill name for deterministic boot logs', async () => {
    const dir = makeTempDir();
    writeSkill(dir, 'charlie');
    writeSkill(dir, 'alpha');
    writeSkill(dir, 'bravo');

    const skills = await loadSkillsFromDir(dir);
    expect(skills.map((s) => s.frontmatter.name)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('returns empty array when directory exists but contains no skill folders', async () => {
    const dir = makeTempDir();
    const skills = await loadSkillsFromDir(dir);
    expect(skills).toEqual([]);
  });

  it('throws a clear error when the directory does not exist', async () => {
    const dir = makeTempDir();
    const missing = path.join(dir, 'does-not-exist');

    await expect(loadSkillsFromDir(missing)).rejects.toThrow(/skills directory/i);
  });
});
