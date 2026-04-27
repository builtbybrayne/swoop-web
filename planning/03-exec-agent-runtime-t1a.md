# 03 — Execution: B.t1a — Multi-file system-prompt loader

**Status**: Tier 3 execution plan. Draft, 2026-04-27.
**Chunk**: B (agent runtime).
**Task**: t1a — extends B.t1's single-file prompt loader into a directory-driven concatenation loader.
**Implements**: `planning/02-impl-agent-runtime.md` §2.2 (revised) + decision G.11 in `planning/decisions.md`.
**Depends on**: B.t1 already shipped. The current loader, config schema, and tests are the substrate this task evolves.
**Produces**: A loader that reads every numerically-prefixed `.md` file in `cms/prompts/system/` and concatenates them as the agent's `instruction`. New env var `SYSTEM_PROMPT_DIR` replacing `SYSTEM_PROMPT_PATH`. Updated `SKILLS_DIR` default to align with the G.11 layout.
**Unblocks**: G.10 actually working — `style-avoid.md` is loaded and applied. Future static companion files (tone primer, refusal block) plug in by being dropped into `cms/prompts/system/`.
**Estimate**: 2–3 hours including tests + smoke verification.

---

## Purpose

G.10 (2026-04-24) decided the system prompt should be authored in two layers — `why.md` for positive voice and `style-avoid.md` for the avoidance list — but left the wiring undefined. Live testing on 2026-04-27 confirmed the gap: `style-avoid.md` was on disk but no code loaded it. The agent never saw the rules.

G.11 (2026-04-27) closed that gap with a deterministic file-system contract: any `.md` file in `cms/prompts/system/` matching `^\d{2}_[a-z0-9-]+\.md$` is concatenated into the system prompt, in lexicographic order, separated by `\n\n---\n\n`. B.t1a is the small loader change that makes the contract real.

This is **not** a generic CMS framework. It's the simplest possible composition mechanism for always-on companion content — the file system is the schema, the filename is the order, no metadata, no manifests, no interpolation. Swap-out cost stays low; future authoring tooling can sit on top of this without breaking it.

---

## Deliverables

### Code changes

| File | Change |
|---|---|
| `product/orchestrator/src/agent/prompt-loader.ts` | Replace single-file behaviour with directory concatenation. Signature changes: `createPromptLoader(absoluteDirPath, isProduction)`. Reads directory entries; filters by `^\d{2}_[a-z0-9-]+\.md$`; sorts lexicographically; reads each; joins with `\n\n---\n\n`. Empty-directory and missing-directory cases throw a clear startup error. Hot-reload semantics preserved (re-read on each `load()` in non-prod; cache once in prod). |
| `product/orchestrator/src/config/schema.ts` | Rename `SYSTEM_PROMPT_PATH` → `SYSTEM_PROMPT_DIR`. Default: `../cms/prompts/system`. Update `SKILLS_DIR` default to `../cms/prompts/skills`. Update derived field name `systemPromptAbsolutePath` → `systemPromptDirAbsolutePath` and the type docblock. |
| `product/orchestrator/src/config/load.ts` | Update derived-path resolution: `data.SYSTEM_PROMPT_DIR` → `systemPromptDirAbsolutePath`. |
| `product/orchestrator/src/index.ts` | Update the call site: `createPromptLoader(config.systemPromptDirAbsolutePath, config.isProduction)`. |
| `product/orchestrator/.env.example` | Rename the commented example var `SYSTEM_PROMPT_PATH` → `SYSTEM_PROMPT_DIR`, update the default value, and update the inline comment. Update `SKILLS_DIR` default in the comment. |

### Test changes

| File | Change |
|---|---|
| `product/orchestrator/src/__tests__/integration/hello-world.test.ts` | Replace fixture `SYSTEM_PROMPT_PATH: '../cms/prompts/why.md'` with `SYSTEM_PROMPT_DIR: '../cms/prompts/system'`. Replace `systemPromptAbsolutePath: '/tmp/test/cms/prompts/why.md'` with `systemPromptDirAbsolutePath: '/tmp/test/cms/prompts/system'`. Same in any test fixture that constructs a `Config` directly. |
| `product/orchestrator/src/functional-agents/__tests__/triage-classifier.test.ts` | Same renames as above. |
| `product/orchestrator/src/agent/__tests__/prompt-loader.test.ts` | New file. Vitest unit tests covering: (a) concatenation across two files in lexicographic order with `\n\n---\n\n` separator; (b) filtering — files matching the pattern are loaded, files not matching (`README.md`, `_draft.md`, `notes.txt`) are ignored; (c) prod cache vs dev re-read behaviour; (d) missing directory → throws clear error at construction; (e) empty directory (no files match) → throws clear error at construction; (f) single file → returns its content with no leading/trailing separator. Use `os.tmpdir()` + `fs.mkdtempSync` for isolated fixture dirs per test. |

### File migration

| From | To |
|---|---|
| `product/cms/prompts/why.md` | `product/cms/prompts/system/00_why.md` |
| `product/cms/prompts/style-avoid.md` | `product/cms/prompts/system/10_style-avoid.md` |

`product/cms/prompts/system/` is created by the moves; `product/cms/prompts/skills/` and `product/cms/prompts/tools/` are created as empty directories (or with a `.gitkeep` if needed) so the layout exists from day one.

---

## Key implementation notes

### 1. Filename pattern

Use the exact regex `^\d{2}_[a-z0-9-]+\.md$`. The two-digit prefix is a hard requirement (sparse numbering — 00, 10, 20… — leaves room for inserts past 9 without renumbering existing files). Lowercase + hyphens after the prefix matches conventional content-file naming. Anything else is silently skipped — `README.md`, `_draft.md`, `notes.txt`, `00_why.markdown` (wrong extension), `0_why.md` (single-digit prefix) are all ignored.

### 2. Sort order

`Array.prototype.sort()` on the filenames; string comparison is enough because the prefix pads to two digits. Don't lift to a numeric sort — it would treat `10_x.md` as before `2_x.md` if someone forgot to two-digit-prefix.

### 3. Separator

`\n\n---\n\n`. The horizontal rule survives any markdown renderer (useful when the joined prompt is logged for debugging) and gives the model a clear segmentation hint without requiring a structured-output convention. Don't include filenames in the joined output — the model doesn't need to know the file structure, only the content. (If filename becomes useful for debugging later, add it as a markdown comment `<!-- 00_why.md -->` above each file's body — minor, additive.)

### 4. Error surfaces

Three startup failure modes, all should produce a readable error and `process.exit(1)`:
- Directory doesn't exist (operator typo in `SYSTEM_PROMPT_DIR`).
- Directory exists but contains zero files matching the pattern (operator deleted everything by accident).
- A matching file fails to read (permissions, broken symlink).

The current loader already throws on read failure; extend the error message to name the file when the directory has multiple. Keep the message format consistent with B.t1's `[orchestrator] Failed to read system prompt at <path>: <reason>`.

### 5. Hot-reload semantics

Preserved as B.t1: in dev (`NODE_ENV !== 'production'`) re-read every file on every `load()` call so an editor save is visible on the next request without restart. In prod, read once at construction time and cache the joined string.

### 6. Trailing newline handling

Each file's content may or may not end in a newline. Trim trailing whitespace before joining, then append the separator, so the joined output has predictable spacing regardless of authorial habit. Do **not** strip leading whitespace — markdown front-matter rules (none here, but future-proof) and intentional indentation should survive.

### 7. Migration order to avoid breaking the dev environment

If the dev orchestrator is running while this lands:
1. Add the new code path (loader change + config rename) in a single commit on a clean working tree.
2. Move the files (`why.md` → `system/00_why.md`, `style-avoid.md` → `system/10_style-avoid.md`).
3. Restart the orchestrator. Sessions cached in `sessionStorage` are now stale — clear them per the gotchas (`sessionStorage.clear(); location.reload()`).
4. Verify the agent loads cleanly + responds to a smoke message.

### 8. What not to do

- Don't add a manifest file. The filename pattern is the manifest.
- Don't add `frontmatter` parsing in `system/` files. Skills do that; system-prompt fragments don't need it.
- Don't add interpolation / variable substitution. The system prompt is static once loaded.
- Don't read or write `cms/prompts/skills/` or `cms/prompts/tools/` from this loader. Those have their own loaders (B.t9 for skills; tool code for tools-fragments).

---

## Verification

The task is done when:

1. `npm run typecheck` and `npm test` are clean across all workspaces (242+ → 248+ green).
2. The new `prompt-loader.test.ts` covers the six cases in the test deliverables. Each test runs against a fresh `os.tmpdir()` directory.
3. `product/cms/prompts/system/00_why.md` and `product/cms/prompts/system/10_style-avoid.md` exist; `product/cms/prompts/why.md` and `product/cms/prompts/style-avoid.md` no longer exist; `product/cms/prompts/skills/` and `product/cms/prompts/tools/` exist (empty `.gitkeep` is fine).
4. `product/orchestrator/.env.example` reflects the renamed env var with the new default.
5. Local smoke: orchestrator restarts cleanly, the UI loads, a turn responds with output that demonstrably honours both files (e.g. asking the agent something likely to elicit AI-slop and confirming the response avoids em-dashes / "delve" / empty affirmations).
6. The decision entry G.11 is in `planning/decisions.md` (already landed during the cascade).

---

## References

- `planning/decisions.md` — entry **G.11** for the structural rationale + swap-cost analysis.
- `planning/02-impl-content.md` §2.4 — the canonical layout diagram and load contracts.
- `planning/02-impl-agent-runtime.md` §2.2 — the prompt-loader behaviour spec (revised for B.t1a).
- `product/cms/README.md` — the day-to-day authoring rules (rewritten as part of this cascade).
- `product/CLAUDE.md` — pointer to `cms/README.md` so any agent working in `product/` finds the rules.
- `product/orchestrator/src/agent/prompt-loader.ts` — the current single-file loader (the thing this task evolves).
