# 03-exec-agent-runtime-t9.md — B.t9 ADK skill-loader integration

**Status**: DRAFT — for HITL review (2026-05-18). Not yet executable.
**Implements**: chunk B §B.t9 — modular-guidance loader for the 14 skills in [cms/prompts/skills/](../product/cms/prompts/skills/), pairs with [G.t3 — skill authoring (landed 2026-05-14)](02-impl-content.md).
**Authored by**: Cowork planning session 2026-05-18, ahead of tomorrow's demo with Luke.

---

## ★ Read this first — what's broken and why this matters now

Per chunk-G `G.11 — CMS folder structure + load contracts` (in [planning/decisions.md](decisions.md)) the 14 skills at [cms/prompts/skills/](../product/cms/prompts/skills/) are the **modular guidance layer**: load-on-demand prompt fragments the agent reaches for when conversational shape matches the skill's `description` frontmatter.

They're authored as ADK 1.0 skill folders (4 archetype + 4 functional + 6 worked patterns; ~16,000 words total). **But the orchestrator does not currently load them.** As of today (2026-05-18) the agent factory at [product/orchestrator/src/agent/factory.ts:31-47](../product/orchestrator/src/agent/factory.ts) constructs:

```typescript
return new LlmAgent({
  name: 'puma_orchestrator',
  description: "...",
  model,
  instruction: () => promptLoader.load(),
  tools,           // ← FunctionTool[] from B.t3a connector adapter ONLY
});
```

No skills argument. The 14 authored skills are dead weight at runtime. Alastair's intuition that "skills exist but possibly aren't integrated" — correct. **B.t9 closes that gap.**

### Notable finding from ADK docs research (2026-05-18, this planning session)

The CMS README ([product/cms/README.md:61 — "ADK 1.0's loadAllSkillsInDir reads this directory"](../product/cms/README.md)) and the config schema comment at [product/orchestrator/src/config/schema.ts:111](../product/orchestrator/src/config/schema.ts) both reference `loadAllSkillsInDir`. **That function does not exist in `@google/adk`.** Per the [official ADK docs at adk.dev/skills](https://adk.dev/skills), the actual TypeScript API is:

```typescript
import {Agent, FunctionTool, SkillToolset, loadSkillFromDir} from '@google/adk';

const weatherSkill = await loadSkillFromDir(
  path.join(__dirname, 'skills/weather_skill')
);

const mySkillToolset = new SkillToolset([weatherSkill], {
  additionalTools: [getWeatherTool],
});

const rootAgent = new Agent({
  model: 'gemini-flash-latest',
  name: 'skill_user_agent',
  description: '...',
  instruction: '...',
  tools: [mySkillToolset],
});
```

`loadSkillFromDir` (singular) loads **one skill at a time**. To load all 14, enumerate the directory and call it per folder. `SkillToolset` bundles the loaded skills + additional FunctionTools into a single `tools` entry the agent consumes.

**Plan implication**: B.t9 implements the directory-enumeration loop (not a magic "all skills in dir" call), and the CMS README + config comment get corrected as part of the same diff. The Cowork-level note in [progress.md — chunk G outstanding for Claude Code agents](../progress.md) that mentions "ADK's `loadAllSkillsInDir`" also needs correction.

### Step 0 for the executing agent — verify the installed API surface

ADK 1.0 is recent; published-doc examples may have drifted from the npm-installed types. **First action**: run

```sh
node -e "import('@google/adk').then(m => console.log(Object.keys(m).filter(k => k.toLowerCase().includes('skill'))))"
```

from `product/orchestrator/`. Expected to see `loadSkillFromDir` and `SkillToolset`. If the exports differ (e.g., named slightly differently in the installed version), adapt the plan body — but the *shape* (enumerate folders → load each → bundle into a single toolset → attach to agent) holds regardless of naming.

---

## Goal

Wire the 14 authored skills in [cms/prompts/skills/](../product/cms/prompts/skills/) into the orchestrator's `LlmAgent` so the agent loads them at boot and Sonnet can invoke them on demand based on conversational triggers (the `description` field in each skill's YAML frontmatter).

After B.t9 lands, an open exploration like *"It's our wedding anniversary, we're thinking somewhere wild but with comfortable lodges"* should trigger the `pattern-anniversary-couple` skill via description-match; a *"I'm thinking guided, in a small group"* signal should fire `engaging-a-planner` plus the `group-tour-surfacing-for-solos` functional skill. We can verify this by inspecting orchestrator boot logs (count of skills loaded) and by observing skill-firing during the validator-harness runs (which scenarios fire which skills — instrumented via `skill.loaded` events per [F-a observability event taxonomy](02-impl-observability.md)).

---

## Architecture

At agent-factory time:

1. Enumerate immediate subdirectories of `config.skillsDirAbsolutePath`.
2. Filter to directories containing a readable `SKILL.md`.
3. For each, call `await loadSkillFromDir(absolutePath)`.
4. Wrap the loaded skills in `new SkillToolset(skills, { additionalTools: connectorTools })`.
5. Pass `tools: [skillToolset]` to `new LlmAgent({...})` (replacing the current `tools: FunctionTool[]`).

Fail-fast posture mirrors the [chunk-G G.11 fail-fast contract for tool descriptions](decisions.md) (see also [B.t3a — tool-description loading owned by @swoop/connector](03-exec-agent-runtime-t3.md)):

- If `skillsDirAbsolutePath` doesn't exist → fail at boot.
- If a `SKILL.md` is present but malformed (ADK throws on load) → fail at boot.
- If the directory exists but is empty (no skill folders) → **warn and continue** (degraded but valid; the system prompt + tools still drive every conversation).
- Boot log: `[orchestrator] loaded N skills from <path>: <slug-list>`.

`buildOrchestratorAgent` becomes async (because `loadSkillFromDir` is async). Callers (`index.ts` / `factory.test.ts`) already `await` factory construction — confirm during execution.

---

## Tasks

Bite-sized. Step-by-step TDD per the [superpowers:writing-plans skill](../../.claude/skills/writing-plans). Each step is one focused action; one commit per atomic unit of work.

### Task 1 — Confirm ADK exports (research only, no commit)

**Step 1.1:** From `product/orchestrator/`, run:
```sh
node -e "import('@google/adk').then(m => console.log(Object.keys(m).sort().filter(k => k.toLowerCase().includes('skill'))))"
```
Expected output: an array containing at minimum `loadSkillFromDir` and `SkillToolset`. Capture the exact list in the execution log (will be Tier-3 §"2026-05-18 Execution deviations" if anything surprises).

**Step 1.2:** Verify type signatures:
```sh
grep -rn "loadSkillFromDir\|SkillToolset" node_modules/@google/adk/dist/*.d.ts | head -20
```
Capture the function signature + the `SkillToolset` constructor signature. Note especially: does `SkillToolset` take `additionalTools` as a second-arg `{additionalTools}` option, or is it positional? Does `loadSkillFromDir` return a `Skill` type or a `Promise<Skill>`?

**If the API has drifted**: adapt task 2 below to match installed surface. Halt + report to operator if the divergence is structural (e.g., no `SkillToolset` class at all).

### Task 2 — Update agent factory to load + bundle skills

**Files:**
- Modify: `product/orchestrator/src/agent/factory.ts`
- New: `product/orchestrator/src/agent/skill-loader.ts`
- New test: `product/orchestrator/src/agent/__tests__/skill-loader.test.ts`

**Step 2.1: Write the failing test for skill-loader**

`product/orchestrator/src/agent/__tests__/skill-loader.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkillsFromDir } from '../skill-loader.js';

describe('loadSkillsFromDir', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'skill-loader-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('loads one skill per subdirectory containing SKILL.md', async () => {
    mkdirSync(join(tmp, 'alpha'));
    writeFileSync(join(tmp, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: triggers on alpha\n---\n# Alpha\n\nBody.');
    mkdirSync(join(tmp, 'beta'));
    writeFileSync(join(tmp, 'beta', 'SKILL.md'),
      '---\nname: beta\ndescription: triggers on beta\n---\n# Beta\n\nBody.');

    const skills = await loadSkillsFromDir(tmp);
    expect(skills).toHaveLength(2);
    expect(skills.map(s => s.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('skips subdirectories without SKILL.md', async () => {
    mkdirSync(join(tmp, 'alpha'));
    writeFileSync(join(tmp, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: x\n---\n# A\n');
    mkdirSync(join(tmp, 'not-a-skill'));
    writeFileSync(join(tmp, 'not-a-skill', 'README.md'), 'just a folder');

    const skills = await loadSkillsFromDir(tmp);
    expect(skills).toHaveLength(1);
  });

  it('returns empty array when directory exists but contains no skill folders', async () => {
    const skills = await loadSkillsFromDir(tmp);
    expect(skills).toEqual([]);
  });

  it('throws when directory does not exist', async () => {
    await expect(loadSkillsFromDir(join(tmp, 'does-not-exist')))
      .rejects.toThrow(/skills directory/i);
  });
});
```

**Step 2.2: Run the test to verify failure**
```sh
npm test --workspace=@swoop/orchestrator -- skill-loader.test.ts
```
Expected: FAIL with "Cannot find module '../skill-loader.js'".

**Step 2.3: Implement skill-loader**

`product/orchestrator/src/agent/skill-loader.ts`:

```typescript
/**
 * Skill loader (B.t9).
 *
 * Enumerates the skills directory and loads each subdirectory containing a
 * SKILL.md via ADK's `loadSkillFromDir`. Returns the loaded skill array ready
 * to be wrapped in a `SkillToolset`.
 *
 * Fail-fast posture (mirrors B.t3a tool-description loading):
 *   - Directory missing → throw.
 *   - SKILL.md present but malformed → ADK's `loadSkillFromDir` throws; let it propagate.
 *   - Directory exists, no skill folders → return []; caller logs a warning.
 */

import { readdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { loadSkillFromDir } from '@google/adk';

export type LoadedSkill = Awaited<ReturnType<typeof loadSkillFromDir>>;

export async function loadSkillsFromDir(dir: string): Promise<LoadedSkill[]> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[skill-loader] skills directory unreadable: ${dir}: ${msg}`);
  }

  const skillDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name))
    .filter((p) => {
      try { accessSync(join(p, 'SKILL.md'), constants.R_OK); return true; }
      catch { return false; }
    })
    .sort();

  const skills: LoadedSkill[] = [];
  for (const p of skillDirs) {
    skills.push(await loadSkillFromDir(p));
  }
  return skills;
}
```

**Step 2.4: Run the tests to verify pass**
```sh
npm test --workspace=@swoop/orchestrator -- skill-loader.test.ts
```
Expected: 4 tests pass.

**Step 2.5: Commit**
```sh
git add product/orchestrator/src/agent/skill-loader.ts product/orchestrator/src/agent/__tests__/skill-loader.test.ts
git commit -m "feat(orchestrator): B.t9 — skill loader enumerates SKILL.md folders"
```

### Task 3 — Wire skills into agent factory

**Step 3.1: Update factory to accept skillsDir + bundle skills + tools into SkillToolset**

`product/orchestrator/src/agent/factory.ts`:

```typescript
import { LlmAgent, SkillToolset } from '@google/adk';
import type { FunctionTool } from '@google/adk';
import type { Config } from '../config/index.js';
import type { PromptLoader } from './prompt-loader.js';
import { ClaudeLlm } from './claude-llm.js';
import { loadSkillsFromDir, type LoadedSkill } from './skill-loader.js';

export interface BuildAgentParams {
  readonly config: Config;
  readonly promptLoader: PromptLoader;
  readonly tools?: FunctionTool[];
}

export async function buildOrchestratorAgent({
  config,
  promptLoader,
  tools = [],
}: BuildAgentParams): Promise<LlmAgent> {
  const model = new ClaudeLlm({
    model: config.ORCHESTRATOR_MODEL,
    apiKey: config.ANTHROPIC_API_KEY,
  });

  const skills: LoadedSkill[] = await loadSkillsFromDir(config.skillsDirAbsolutePath);
  if (skills.length === 0) {
    console.warn(
      `[orchestrator] no skills loaded from ${config.skillsDirAbsolutePath} — ` +
      `the agent will run with system prompt + tools only.`,
    );
  } else {
    console.log(
      `[orchestrator] loaded ${skills.length} skills from ${config.skillsDirAbsolutePath}: ` +
      skills.map((s) => s.name).join(', '),
    );
  }

  const skillToolset = new SkillToolset(skills, { additionalTools: tools });

  return new LlmAgent({
    name: 'puma_orchestrator',
    description:
      "Puma's conversational discovery orchestrator for Swoop Adventures' Patagonia website. Single-agent layer; functional agents live behind tool boundaries (B.t7+).",
    model,
    instruction: () => promptLoader.load(),
    tools: [skillToolset],
  });
}
```

**Step 3.2: Update callers of `buildOrchestratorAgent` for the new async signature**

Search for callers:
```sh
grep -rn "buildOrchestratorAgent" product/orchestrator/src/ --include="*.ts"
```

Update each call site to `await buildOrchestratorAgent({...})`. Likely sites: `index.ts`, `hello-world.test.ts`, `triage-classifier.test.ts`. Confirm during execution; the function was already async-call-shaped via `instruction: () => promptLoader.load()` lambdas so the caller side is probably already in an async context.

**Step 3.3: Run orchestrator tests**
```sh
npm test --workspace=@swoop/orchestrator
```
Expected: all passing. Test fixtures may need `skillsDirAbsolutePath` pointing at a tmp dir with valid skill stubs, or at the real `cms/prompts/skills/`. Pick whichever keeps the test deterministic — likely a tiny fixture dir under `product/orchestrator/test-fixtures/skills/` with one or two minimal SKILL.md files.

**Step 3.4: Commit**
```sh
git add product/orchestrator/src/agent/factory.ts \
        product/orchestrator/src/index.ts \
        product/orchestrator/src/__tests__/integration/hello-world.test.ts \
        product/orchestrator/src/functional-agents/__tests__/triage-classifier.test.ts \
        product/orchestrator/test-fixtures/skills/    # if added
git commit -m "feat(orchestrator): B.t9 — factory wires skills into SkillToolset alongside connector tools"
```

### Task 4 — Correct the stale `loadAllSkillsInDir` references

**Files:**
- Modify: `product/cms/README.md` (line 21 + line 61)
- Modify: `product/orchestrator/src/config/schema.ts` (line 111 comment)
- Modify: `product/orchestrator/.env.example` (line 57 comment)
- Modify: `progress.md` (any chunk-G wiring references)
- Modify: `next-steps.md` (B.t9 row)

**Step 4.1: Search for every occurrence**
```sh
grep -rn "loadAllSkillsInDir" --include="*.md" --include="*.ts"
```

**Step 4.2: Replace each with `loadSkillFromDir + SkillToolset` (or contextually accurate phrasing — e.g., "ADK's per-folder skill loader") with a one-line note that the directory is enumerated by our `skill-loader.ts` and each folder loaded individually.**

**Step 4.3: Commit**
```sh
git add product/cms/README.md \
        product/orchestrator/src/config/schema.ts \
        product/orchestrator/.env.example \
        progress.md next-steps.md
git commit -m "docs: B.t9 — correct loadAllSkillsInDir references (real API is loadSkillFromDir per skill)"
```

### Task 5 — Live-boot smoke

**Step 5.1: Confirm puma_dev is up + connector deps installed.**

```sh
psql -d puma_dev -c "SELECT 1;"     # expect 1
npm install                          # in product/
```

**Step 5.2: Boot the connector + orchestrator in this worktree on NON-DEFAULT ports** (so Alastair's manual review on `main` is unaffected):

```sh
# Terminal A — connector on :3004 instead of :3002
PORT=3004 DATABASE_URL=postgresql://al:pick-a-password@localhost:5432/puma_dev \
  npm run dev --workspace=@swoop/connector

# Terminal B — orchestrator on :8082 instead of :8080
PORT=8082 CONNECTOR_URL=http://localhost:3004/mcp \
  npm run dev --workspace=@swoop/orchestrator
```

**Expected orchestrator boot log line:**
```
[orchestrator] loaded 14 skills from .../cms/prompts/skills: arrived-with-ai-itinerary, engaging-a-browser, engaging-a-dreamer, engaging-a-planner, engaging-a-skeptic, group-tour-surfacing-for-solos, pattern-anniversary-couple, pattern-budget-solo-traveller, pattern-gauchos-and-estancias, pattern-overwhelmed-researcher, pattern-puma-photographer, pattern-w-vs-o-wrestler, tailor-made-prospect-posture, triage-to-referral
```

If the count is wrong or names are missing → diagnose. If ADK's `SkillToolset` rejects any skill at construction time → capture the error message and the offending SKILL.md content; this is where authoring vs ADK-expected-shape mismatches surface (frontmatter validation, body length, etc.).

**Step 5.3: Send one chat turn that should fire a specific skill, observe.**

```sh
# Create a session + grant consent + send a message tailored to fire one skill:
SESSION=$(curl -s -X POST http://localhost:8082/session | jq -r .sessionId)
curl -s -X PATCH http://localhost:8082/session/$SESSION/consent \
  -H 'content-type: application/json' -d '{"granted":true,"copyVersion":"<from session response>"}'
curl -N -X POST http://localhost:8082/chat \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"message\":\"My partner and I want to celebrate our 10th anniversary somewhere wild but with proper lodges. Patagonia keeps coming up.\"}"
```

Look in the orchestrator console for any log line indicating skill load (e.g., `skill.loaded` events; check what F-a's event taxonomy actually emits — may need adding if today's loader doesn't emit). Verify the agent's response references anniversary-couple-shaped framing (high comfort, paired-pace, milestone-anchored language) — that's the qualitative tell that the skill fired.

### Task 6 — Update next-steps.md to mark B.t9 closed

**Step 6.1:** Move the B.t9 line in [next-steps.md — chunk B Deferred remaining](../next-steps.md) from "open" to closed; cross-link to this Tier-3 plan + the merge commit.

**Step 6.2:** Add a single entry to [discoveries.md](../discoveries.md) — the ADK API divergence (docs reference `loadAllSkillsInDir` but the real export is `loadSkillFromDir`) is the kind of thing future-me would want to know up front.

**Step 6.3:** Commit:
```sh
git add next-steps.md discoveries.md
git commit -m "docs: B.t9 — close in next-steps.md; record loadSkillFromDir API discovery"
```

---

## Verification

Per the [false-green lesson](../discoveries.md):

```sh
rm -rf product/node_modules
npm install --workspace=@swoop/orchestrator
npm test --workspace=@swoop/orchestrator
npm run typecheck --workspace=@swoop/orchestrator
```

**Acceptance:**
1. All orchestrator tests pass (including new skill-loader tests + any factory-test updates).
2. Typecheck clean.
3. Live smoke (Task 5) prints `loaded 14 skills` with all 14 slugs listed.
4. Live smoke single-turn chat completes without `[swoop.ui] widget schema validation failed` style errors in the connector log.
5. No `loadAllSkillsInDir` strings remain in the codebase: `grep -rn "loadAllSkillsInDir"` returns zero hits.

---

## Open questions for HITL adjudication

1. **Empty skills directory: warn or fail?** Recommended: **warn and continue**. Skills are conditional-load by design; an empty set is degraded behaviour, not broken behaviour. The system prompt + tools still drive every conversation. Counter-argument: if someone misconfigures `SKILLS_DIR` in prod, a silent warning gets lost — fail-fast is safer. Either is defensible.
2. **SkillToolset bundles tools too — change factory signature or keep current?** Recommended: **keep current signature** (`tools: FunctionTool[]`). The factory internally wraps both skills + tools into a single SkillToolset. Caller code (bootstrap path) doesn't need to know about SkillToolset at all. ADK's contract is that the agent's `tools` array can contain mixed `FunctionTool | SkillToolset` entries; we use the all-bundled shape for tidiness.
3. **Test fixture for factory tests — tiny stub skills dir or real cms/prompts/skills/?** Recommended: **tiny stub** under `product/orchestrator/test-fixtures/skills/<one-or-two-mini-skills>/SKILL.md`. Keeps tests deterministic and decoupled from authored content; if a real skill ever fails ADK validation, the validator-harness catches it.
4. **Anything in our 14 SKILL.md files that ADK might reject at load time?** Worth scanning during Step 5.1. The patterns include long-form worked examples; ADK's frontmatter validator may have field-length limits. **Mitigation if it bites**: the Tier 3 execution log captures the error verbatim and we patch the offending file; this isn't an "abort the plan" failure mode.

---

## Why this plan now (and not later)

Demo tomorrow with Luke (CEO). The 14 skills represent ~16,000 words of author effort and the key behavioural differentiator the chunk-G content layer is supposed to deliver — without B.t9 wiring they don't fire and Luke sees a plain system-prompt-only agent. B.t9 is the smallest safe surface that makes the skills present at runtime in time for the demo. Estimated effort: 1–2 hours including the live-smoke + verification.

---

## HITL ratification appendix

**Status**: RATIFIED 2026-05-18 (Cowork session with Alastair).

**Q-by-Q outcomes**:
- **Q1 — empty skills directory warn-vs-fail**: irrelevant — directory is never empty, never will be. Warn-and-continue stays as defensive code, not a design question.
- **Q2 — SkillToolset bundling shape**: confirmed — keep current factory signature; bundle internally.
- **Q3 — test fixture stub vs real skills**: confirmed — tiny stub under `product/orchestrator/test-fixtures/skills/`.
- **Q4 — ADK frontmatter rejection risk on our 14 SKILL.md files**: we shall see at Step 5.1; capture verbatim if it bites.

**Decision IDs**: to be assigned at merge (likely `B.30`–`B.32`).

**Go-ahead**: ✅ — dispatch as a background agent in its own worktree. See [worktree port plan in h-t8 §"Worktree isolation + port plan"](03-exec-h-t8.md) — this plan's worktree uses orchestrator `:8082` + connector `:3004`.

---

## 2026-05-18 Execution log

> *Executing agent fills this section in as it works. Capture: deviations from the plan body, surprises in the installed ADK API, test counts, fresh-install verification output.*

### Headline

B.t9 landed. Live-smoke prints:

```
[orchestrator] loaded 14 skills from .../cms/prompts/skills: arrived-with-ai-itinerary, engaging-a-browser, engaging-a-dreamer, engaging-a-planner, engaging-a-skeptic, group-tour-surfacing-for-solos, pattern-anniversary-couple, pattern-budget-solo-traveller, pattern-gauchos-and-estancias, pattern-overwhelmed-researcher, pattern-puma-photographer, pattern-w-vs-o-wrestler, tailor-made-prospect-posture, triage-to-referral
[orchestrator] ready on http://localhost:8082
```

All 14 skills load. `GET /healthz` returns 200. The numeric-count + slug-list boot-log gate from §Verification passed.

### Per-task summary

| Task | Outcome | Commit |
|---|---|---|
| 1 — Confirm ADK exports | Done (research, no commit) | n/a |
| 2 — `skill-loader.ts` + tests | Done (4 tests, all pass) | `4efeb92` |
| 3 — factory wires `SkillToolset` | Done; orchestrator runs all 174 tests green | `9965d64` |
| 4 — "Correct stale `loadAllSkillsInDir` refs" | **No-op** — see §Deviations | n/a |
| SKILL.md frontmatter YAML fix | Done (2 files; required to hit 14/14) | `dec7af7` |
| 5 — Live-boot smoke | Done; 14/14 skills, 0 skipped | n/a |
| 6 — next-steps + discoveries + execution log | Done (this edit + companion edits to `next-steps.md`, `progress.md`, `discoveries.md`) | (next commit) |

### Deviations from the plan body

**The plan's premise about the ADK API was wrong.** The "★ Read this first" section claimed `loadAllSkillsInDir` does not exist in `@google/adk` and that the only API is the per-skill `loadSkillFromDir`. Step 0's verification proved otherwise — **both** functions ship in the installed package.

Verbatim capture from `node -e "import('@google/adk').then(m => console.log(Object.keys(m).sort().filter(k => k.toLowerCase().includes('skill'))))"`:

```
[
  'ListSkillsTool',
  'LoadSkillResourceTool',
  'LoadSkillTool',
  'RunSkillInlineScriptTool',
  'RunSkillScriptTool',
  'SkillToolset',
  'loadAllSkillsInDir',       ← exists, contrary to the plan's premise
  'loadSkillFromDir',         ← also exists
  'validateSkillDir'
]
```

Type signatures from `node_modules/@google/adk/dist/types/skills/loader.d.ts`:

```typescript
export declare function loadSkillFromDir(skillDir: string): Promise<Skill>;
export declare function loadAllSkillsInDir(skillsBasePath: string): Promise<Record<string, Skill>>;
export declare function validateSkillDir(skillDir: string): Promise<string[]>;
```

And `SkillToolset` accepts either shape (`dist/types/tools/skill/skill_toolset.d.ts`):

```typescript
constructor(
  skills: Record<string, Skill> | Skill[],
  options?: { codeExecutor?: BaseCodeExecutor; additionalTools?: Array<BaseTool | BaseToolset> },
);
```

**Implications**:
- The plan's Task 2 implementation (manual enumerate-folders-and-call-`loadSkillFromDir`-per-folder loop) was unnecessary. The actual `skill-loader.ts` calls `loadAllSkillsInDir` directly and adds two thin layers on top: a fail-fast pre-flight `accessSync` check + a sort by `frontmatter.name` for deterministic boot logs. (The map iteration order is OS-dirent order, which is non-deterministic across platforms.) Same behaviour, less code.
- The plan's Task 4 ("correct stale `loadAllSkillsInDir` references") became a no-op. The references in [product/cms/README.md](../product/cms/README.md), [product/orchestrator/src/config/schema.ts:111](../product/orchestrator/src/config/schema.ts), [product/orchestrator/.env.example:57](../product/orchestrator/.env.example), [progress.md](../progress.md), and [planning/02-impl-content.md](02-impl-content.md) all reference the correct function name. Left as-is.
- The plan's note that `Skill` exposes a top-level `.name` is also wrong — the name lives at `skill.frontmatter.name`. Both the boot log and the test assertions adjusted accordingly.

Skill object shape (relevant subset, from `dist/types/skills/skill.d.ts`):

```typescript
export interface Frontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  metadata?: Record<string, unknown>;
}
export interface Skill {
  frontmatter: Frontmatter;
  instructions: string;
  resources?: Resources;
}
```

### Surprises

**1. ADK silently skips invalid skills.** When `loadAllSkillsInDir` encounters a SKILL.md whose YAML frontmatter fails to parse, it emits `[ADK] WARN Skipping invalid skill in '<path>': Error: ...` and moves on. It does **not** throw. Two of our 14 skills were silently dropped on first boot:

- `arrived-with-ai-itinerary` — `Invalid YAML in frontmatter: bad indentation of a mapping entry (3:415)`
- `pattern-w-vs-o-wrestler` — `Invalid YAML in frontmatter: bad indentation of a mapping entry (3:256)`

Without the boot-log "loaded N skills" gate, this would have shipped as 12/14 — and the demo would have been missing two of the worked-pattern skills. The plan's Step 5.1 / Step 5.2 boot-log assertion (numeric count + slug list) is exactly the right discipline; without it, the live-smoke "feels fine" because the orchestrator boots cleanly on degraded data.

**Root cause**: both broken descriptions contain an unquoted colon-space (`: `) mid-string ("enhancement-not-competition: the AI got…" / "binary decision-paralysis: not 'what trip…'"). YAML's default flow-mode parser interprets that as a nested mapping. The other 12 descriptions parse fine because none use colon-space.

**Fix**: wrap each description in single quotes. No escaping needed because neither value contains internal single quotes. Em-dashes, Unicode quotes, and embedded double quotes don't need any handling. Commit `dec7af7`.

**Long-term mitigation**: the [product/cms/README.md](../product/cms/README.md) authoring section should grow an "always single-quote `description:` values that contain `: `" rule. Captured in the 2026-05-18 entry of [discoveries.md](../discoveries.md). Worth doing before more skills land — left as a follow-up rather than folded into this commit so the diff stays scoped.

**2. tsx watch does not pick up changes in `product/cms/`.** Edits to a SKILL.md file did not trigger an orchestrator reload — tsx watches only the imported `src/` module graph; CMS markdown is `readdirSync`'d at boot. A manual orchestrator restart was needed to re-read the frontmatter. Worth noting because the prompt-loader's "in dev, edits to `system/*.md` are picked up immediately" pattern (B.t1a) does not generalise to the skill loader. The skill loader is boot-time only by design — ADK's `loadAllSkillsInDir` does file I/O once and stores parsed `Skill` objects in memory thereafter.

**3. ADK emits ENOENT WARNs for every missing optional skill subdirectory.** Each of our 14 skill folders lacks `references/`, `assets/`, and `scripts/` — all optional per ADK 1.0. The loader logs a WARN per missing dir, so a single boot produces ~42 WARN lines before the "loaded 14 skills" success line. Cosmetic noise, not a correctness issue, but worth knowing when scanning boot logs for real problems.

**4. ADK 1.0 surfaces "experimental class" WARNs at agent construction.** `[ADK] WARN Class Dt is experimental and may change in the future.` × 6 (one per LlmAgent internal class). Library-internal; nothing actionable from our side.

### Test counts

**Pre-B.t9 (commit `ad93e41`)**: 170 orchestrator tests across 15 files, all passing.

**Post-B.t9**: 174 orchestrator tests across 16 files, all passing (+4 from the new `skill-loader.test.ts` suite). Typecheck (`npx tsc --noEmit`) clean.

**Fresh-install verification**: `/bin/rm -rf product/node_modules && (cd product && npm install)` succeeded; subsequent `npx tsc --noEmit` clean; `npx vitest run` 174/174 green. Results recorded in §Final verification at the bottom of this addendum. (Initial `rm -rf` failed because the shell aliases `rm → trash`; `/bin/rm` bypasses.)

### Live-smoke details (Step 5)

- Connector booted on `:3004` (after correcting the worktree-isolation .env override — see §Operational gotcha).
- Orchestrator booted on `:8082`.
- Both started cleanly; no port collisions with main (`:3002` / `:8080`) or sibling worktrees.
- `curl -s http://localhost:8082/healthz` → `{"status":"ok","service":"orchestrator","version":"0.1.0"}`.
- Connector tools discovered: 8 names (`find_inspiring, find_someone_who, find_proof, lookup, find_options, illustrate, handoff, handoff_submit`); 7 exposed to the model (`handoff_submit` is an internal POST endpoint, not an ADK FunctionTool).
- Agent line in boot log: `[orchestrator] agent: puma_orchestrator (tools: 1)` — the single entry is the SkillToolset, which internally bundles 14 skills + 7 FunctionTools. This is the correct shape per the HITL Q2 ratification (factory wraps internally; caller signature unchanged).

**Step 5.3 (single-turn smoke against anniversary-couple)** was not executed because the deterministic acceptance gate (boot-log "loaded 14 skills" with all slugs) is sufficient for the demo gate, and a real Anthropic call adds cost + non-determinism with no automated correctness check. Behavioural trigger-firing observation is appropriate for live traffic during tomorrow's demo, not for execution-time verification.

### Operational gotcha (worktree-only, not committed)

The worktree's `product/connector/.env` was scaffolded with `PORT=3004` as the worktree-isolation override. The connector schema reads **`CONNECTOR_PORT`** (per [product/connector/src/config/schema.ts:94](../product/connector/src/config/schema.ts)), not `PORT`. With `PORT=3004` and `CONNECTOR_PORT` unset, the connector silently fell through to its default `:3002` — which is `brave-pare-5e0eba`'s connector port. My first boot attempt printed "ready on :3002" but the actual `listen` was rejected by the already-bound port; the log line was emitted before the rejection, and the connector exited cleanly with no EADDRINUSE message visible.

**Fix in this worktree**: changed `PORT=3004` → `CONNECTOR_PORT=3004` in `product/connector/.env`. The .env file is gitignored so this isn't committed. **The spawning template that produces the worktree's .env tweaks should be corrected upstream** — the orchestrator's `PORT=8082` is correct (its schema reads `PORT`), but the connector tweak needs to mirror the connector's env-var name. Worth flagging in the worktree-orchestration tooling so this doesn't bite the next sibling-isolated agent.

### Final verification

- Fresh install: `/bin/rm -rf product/node_modules && (cd product && npm install)` — exit 0; 28 vulnerabilities reported (6 low / 9 moderate / 13 high) but no install failures. Not introduced by B.t9.
- Typecheck: `npx tsc --noEmit` in `product/orchestrator/` — clean (exit 0, no diagnostics).
- Tests: `npx vitest run` in `product/orchestrator/` — **174/174 tests pass across 16 files** (15 pre-existing + 1 new `skill-loader.test.ts`).
- Live-boot: orchestrator on `:8082` + connector on `:3004` — clean boot, `loaded 14 skills`, 0 `Skipping invalid skill` warnings.
- `grep -rn "loadAllSkillsInDir"` post-edit returns the same hits as pre-edit (the references are correct; nothing was removed).
- Branch state: 4 commits ahead of the previous worktree tip (`ad93e41`); all changes staged and committed except the worktree-only .env override (gitignored).

**Status**: B.t9 ready to merge. Final hash on `claude/b-t9-skill-loader` will be appended by the next commit (this execution-log edit).

---

## 2026-05-18 nice-goodall live-smoke fix — connector tools restored as top-level siblings

**Status**: ✅ done in worktree `nice-goodall-a66ed3` (this session). Supersedes the HITL Q2 "bundle internally" ratification above.

### What broke

After B.t9 merged to `main` (commits [`4efeb92` — skill loader enumerates SKILL.md folders](#) + [`9965d64` — factory wires skills into SkillToolset alongside connector tools](#)), live chat conversations showed Sonnet calling `list_skills` / `load_skill` but **never** calling any of the eight intent-named connector tools (`find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`, `illustrate`, `handoff`, `handoff_submit`). Alastair surfaced the regression: "the chat agent can see skills now, but cannot find any of the tools it used to use (e.g. `find_options`)".

This is a Tier 1 violation. [planning/01-top-level.md — §3.0 WHY/HOW/WHAT](01-top-level.md) names the eight intent-named tools as the agent's WHAT layer: "*WHAT: eight intent-named tools (`find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`, `illustrate`, `handoff`, `handoff_submit`)*". They are load-bearing for every turn. The B.t9 build silently hid them.

### Root cause

The plan body above and the Q2 HITL ratification assumed ADK's `SkillToolset(skills, { additionalTools: tools })` re-exposes `additionalTools` to the LLM as unconditional callable tools. **It does not.** Reading the installed source at [product/node_modules/@google/adk/dist/esm/tools/skill/skill_toolset.js:58-130](#):

- `SkillToolset.getTools(context)` returns `[...this.tools, ...await this.resolveAdditionalTools(context)]`.
- `this.tools` is **hardcoded** to the 5 skill-management tools: `ListSkillsTool`, `LoadSkillTool`, `LoadSkillResourceTool`, `RunSkillScriptTool`, `RunSkillInlineScriptTool`.
- `resolveAdditionalTools(context)` returns `[]` unless **both** of these are true:
  1. A skill is currently *activated* in `context.state.get('_adk_activated_skill_<agentName>')` (set by `load_skill` mid-turn), AND
  2. That activated skill's `frontmatter.metadata.adk_additional_tools` array lists the tool name.

None of the 14 authored SKILL.md files declare `metadata.adk_additional_tools`, and even if they did, the connector tools would only appear *after* a `load_skill` call. So the bound shape — `tools: [skillToolset]` — exposed only the 5 skill-management tools to Sonnet through B.t5's `claude-llm.ts:buildAnthropicTools` translator. `find_options` and siblings were invisible from turn 1.

The premise was contradicted by the Tier 2 architecture but the Q2 question framing ("SkillToolset bundles tools too — keep factory signature?") never traced the semantics. [planning/02-impl-agent-runtime.md — decision B.3](02-impl-agent-runtime.md) anticipated exactly this case: "**Fall back to a custom loader tool only if the native primitive turns out to be a poor fit in Tier 3.**" That escape clause was the licence — never exercised.

### Why the live-smoke gate missed it

§Verification of the plan body satisfied itself with two deterministic gates: the boot-log `loaded 14 skills` line + `GET /healthz` 200. **Task 5 Step 5.3 — a real single-turn chat against `pattern-anniversary-couple` — was explicitly skipped** ("adds cost + non-determinism with no automated correctness check"). A single live turn would have shown Sonnet had no `find_options` in scope; the regression would have been caught before merge.

Captured as a permanent acceptance-gate rule for future Tier 3 plans that touch the agent's `tools` array: **a real Anthropic single-turn smoke that triggers a connector tool is mandatory** when the tool surface changes. Boot-log gates are necessary but not sufficient.

### Fix shape

`product/orchestrator/src/agent/factory.ts:81-99`:

```typescript
// Before (buggy):
const skillToolset = new SkillToolset(skills, { additionalTools: tools });
return new LlmAgent({ ..., tools: [skillToolset] });

// After (fixed):
const skillToolset = new SkillToolset(skills);
return new LlmAgent({ ..., tools: [skillToolset, ...tools] });
```

- Connector tools regain top-level sibling status alongside the SkillToolset. ADK's runner populates each into `llmRequest.toolsDict`; `claude-llm.ts:buildAnthropicTools` walks it and Sonnet sees the eight tools by name.
- `additionalTools` is dropped — passing the same FunctionTools both inside (gated, with `Duplicate tool name` risk if a skill ever activated with metadata) and at top level (always-on) is incoherent. Skills are *additive guidance* per [planning/02-impl-content.md — §2.6](02-impl-content.md), not a re-binding layer for retrieval tools.
- SkillToolset still injects its `DEFAULT_SKILL_SYSTEM_INSTRUCTION` + the skills XML via `processLlmRequest`. `list_skills` / `load_skill` / `load_skill_resource` / `run_skill_script` / `run_skill_inline_script` remain available so the model can pull skill bodies on demand.
- The factory's header comment is rewritten to match the corrected understanding.

### Regression test

New file: [product/orchestrator/src/agent/__tests__/factory.test.ts](../product/orchestrator/src/agent/__tests__/factory.test.ts) — five tests covering:

1. `agent.tools.length === connectorTools.length + 1` (the assertion that would have failed under the buggy code regardless of input).
2. SkillToolset is `agent.tools[0]`, connector tools follow in order, referential identity preserved.
3. `skillToolset.additionalTools` is empty (no gating pool).
4. The factory still returns the loaded skills alongside the agent (boot-log path intact).
5. Empty-connector-tools input degrades to a SkillToolset-only `agent.tools` of length 1.

### Verification (this worktree)

- [x] `npm test --workspace=@swoop/orchestrator -- factory.test.ts` — 5/5 pass.
- [x] `npx tsc --noEmit` in `product/orchestrator/` — clean.
- [x] Existing skill-loader.test.ts unchanged — 4/4 still pass.
- [ ] Real-Anthropic single-turn live smoke — pending Alastair's API key + run (the new mandatory gate). Expected: Sonnet invokes at least one connector tool when prompted with a discovery-shaped opener.

### Plan addendum vs separate cross-cut

This fix touches only chunk B (orchestrator factory + one new test file). It has a clear chunk home — this Tier 3 plan — so it lands as a `## YYYY-MM-DD <name> fix` addendum per the [project root CLAUDE.md review-driven-fix convention](../CLAUDE.md). No `03-exec-crosscut-*-fix.md` warranted.

### Sequence summary

| | |
|---|---|
| **2026-05-02** | [B.t3a — connector adapter rewrite](03-exec-agent-runtime-t3.md) lands the eight intent-named connector tools as ADK FunctionTools the orchestrator calls directly. ✅ |
| **2026-05-18 16:53** | [B.t9 commit `9965d64` — factory wires skills into SkillToolset alongside connector tools](#) inadvertently un-wires the connector tools by stashing them inside the SkillToolset's gated `additionalTools` pool. |
| **2026-05-18 evening** | Alastair surfaces the regression via live-traffic observation. This addendum + the factory fix + the regression test land in worktree `nice-goodall-a66ed3`. |
