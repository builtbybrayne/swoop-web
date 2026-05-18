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

(empty until execution starts)
