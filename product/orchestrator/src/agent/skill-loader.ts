/**
 * Skill loader (B.t9).
 *
 * Thin wrapper around ADK 1.0's `loadAllSkillsInDir` that:
 *   - fails fast on missing/unreadable directory (matches the B.t1a prompt
 *     loader contract — bad config should crash boot, not be discovered on
 *     the first user turn);
 *   - tolerates an empty directory (returns []; caller logs a degraded-mode
 *     warning per the [HITL Q1 ratification in planning/03-exec-agent-runtime-t9.md](../../../planning/03-exec-agent-runtime-t9.md));
 *   - returns a Skill[] in lexicographic name order for deterministic boot
 *     logs and tests. (ADK returns a `Record<string, Skill>`; the map
 *     iteration order is insertion-order which is dirent order from the
 *     OS, which is non-deterministic across platforms. We sort by
 *     `frontmatter.name` so the same skills always print in the same order.)
 *
 * The output array is bundled into a `SkillToolset` by `factory.ts` so the
 * single `LlmAgent.tools` array carries skills + connector FunctionTools
 * together (per [G.11 — CMS folder structure + load contracts in planning/decisions.md](../../../planning/decisions.md)
 * and [B.t3a connector adapter in planning/03-exec-agent-runtime-t3.md](../../../planning/03-exec-agent-runtime-t3.md)).
 *
 * ADK API note (verified 2026-05-18 from `node_modules/@google/adk/dist/types/skills/loader.d.ts`):
 *   - `loadAllSkillsInDir(skillsBasePath): Promise<Record<string, Skill>>`
 *   - `loadSkillFromDir(skillDir): Promise<Skill>`
 *   - Both exist. We use the bulk loader; the per-skill variant is the
 *     fallback if we ever need finer-grained control. The plan's "★ Read
 *     this first" section incorrectly claimed `loadAllSkillsInDir` was
 *     missing — the installed surface proved otherwise. See the
 *     2026-05-18 execution log addendum in the Tier-3 plan for the
 *     verbatim API capture.
 */

import { accessSync, constants } from 'node:fs';
import { loadAllSkillsInDir } from '@google/adk';
import type { Skill } from '@google/adk';

export type LoadedSkill = Skill;

export async function loadSkillsFromDir(dir: string): Promise<LoadedSkill[]> {
  // Pre-flight: fail fast with a contextual message if the directory is
  // missing. ADK's loader throws too, but its message is rooted in its own
  // internals; this wrapper turns it into an operator-actionable startup
  // error matching the B.t1a prompt loader's style.
  try {
    accessSync(dir, constants.R_OK);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[skill-loader] skills directory unreadable: ${dir}: ${msg}`);
  }

  const skillMap = await loadAllSkillsInDir(dir);

  // Sort by frontmatter.name for deterministic ordering (boot logs, tests).
  return Object.values(skillMap).sort((a, b) =>
    a.frontmatter.name.localeCompare(b.frontmatter.name),
  );
}
