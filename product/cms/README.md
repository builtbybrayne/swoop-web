# product/cms/ — content as data

All Puma content that isn't code lives here: prompts, skills, tools-scoped fragments, email templates, placeholder fixtures. Markdown and JSON only.

## Why this exists

Content is data, not code. Authored by non-engineers (ultimately Swoop's sales staff), loaded at runtime by `orchestrator/`, `connector/`, and `ui/`. Never inlined inside TypeScript.

If you find yourself pasting paragraphs of prose into a `.ts` file, stop and put it here instead.

---

## Layout

```
cms/
├── prompts/
│   ├── system/                            # → concatenated into the system prompt
│   │   ├── 00_why.md                       # WHY prompt: identity, role, refusals, voice
│   │   └── 10_style-avoid.md              # explicit anti-patterns for the agent's voice
│   ├── skills/                             # → ADK loadAllSkillsInDir; one folder per skill
│   │   └── <skill-name>/
│   │       ├── SKILL.md                    # frontmatter (name + description) + body
│   │       ├── references/                 # optional — long-form supporting text
│   │       ├── assets/                     # optional — files the skill refers to
│   │       └── scripts/                    # optional — runnable helpers
│   └── tools/                              # → tool-scoped fragments, read explicitly by tool code
│       └── <tool-name>/
│           └── *.md                        # description, structured-content, post-handoff guidance
├── templates/
│   └── handoff-email.md                    # rendered against the handoff payload at send time
├── errors/
│   └── en.json                             # UI error-surface copy (D.t5)
└── fixtures/                               # placeholder library content for the M1 vertical slice
    ├── trips/
    ├── tours/
    ├── regions/
    └── stories/
```

The full rationale is in `planning/decisions.md` entry **G.11** (CMS folder structure + system-prompt assembly mechanism).

---

## Loading contracts

Each subdirectory has a single, deterministic load contract. None require a manifest, frontmatter (except where ADK requires it), or interpolation.

### `prompts/system/` — concatenated into the system prompt

Every file matching `^\d{2}_[a-z0-9-]+\.md$` is read at orchestrator startup, sorted lexicographically by filename, and concatenated with `\n\n---\n\n` between files. The joined string becomes the LLM agent's `instruction`.

- **Two-digit numeric prefix** (`00_`, `10_`, `20_`…) — required. Sparse numbering leaves room for inserts past 9 without renumbering existing files.
- **Lowercase + hyphens after the prefix.** Underscores are not allowed in the slug part.
- **Files that don't match the pattern are silently ignored.** Drafts, working notes, `README.md`, `.notes.md`, anything with the wrong extension — all safe to leave in this directory without affecting the prompt.
- **No frontmatter.** System-prompt fragments are pure prose. The model reads the joined output as one document.
- Loaded by `product/orchestrator/src/agent/prompt-loader.ts`. In dev, re-reads on every request (so an editor save is visible immediately). In prod, cached at startup.

### `prompts/skills/` — ADK skill primitive

ADK 1.0's `loadAllSkillsInDir` reads this directory. **Each skill is a folder, not a file** — that's an ADK requirement.

Per skill folder:
- `SKILL.md` (required) — YAML frontmatter with `name` (snake_case or kebab-case) and `description` (string the model uses to decide when to load this skill), followed by the skill body in markdown.
- `references/` (optional) — supporting text the skill body can cite.
- `assets/` (optional) — files the skill refers to.
- `scripts/` (optional) — runnable helpers (rare; reserved for future use).

The model loads a skill on demand based on conversational triggers — it's not auto-included in the system prompt. See ADK 1.0 docs for the trigger mechanism. Wiring lives in chunk B (B.t9); content authored here.

### `prompts/tools/` — tool-scoped fragments

Each MCP tool that needs authored copy gets its own subfolder, named after the tool:

```
tools/handoff/
├── description.md                # tool-call description shown to the model
├── structured-content.md          # template the tool uses to build its response
└── post-handoff-guidance.md       # what the agent should do after a successful handoff
```

The tool's TypeScript code reads its own folder explicitly. No magic. Adding a new tool means adding a folder; adding a new fragment to an existing tool means adding a file and a `readFileSync` call in the tool code.

### `templates/`, `errors/`, `fixtures/`

Read by the package that owns each surface — orchestrator for `templates/handoff-email.md`, UI for `errors/en.json`, connector for `fixtures/`. No shared loader, no central registry.

---

## Authoring rules

### Adding a new system-prompt fragment

1. Pick a two-digit prefix that fits its place in the prompt's logical flow (00 = identity / WHY, 10 = style, 20+ = future).
2. Name the file `<prefix>_<slug>.md` — lowercase, hyphens.
3. Write the body. No frontmatter. No filename references inside the body — the file is not aware of its siblings.
4. Save. In dev, the next request picks it up automatically.

If the new fragment overlaps with an existing one in scope, prefer to extend the existing file rather than add a new one. Files in `system/` should each have a clear single concern.

### Adding a new skill

1. Create a folder under `prompts/skills/` named in snake_case or kebab-case.
2. Add a `SKILL.md` with the ADK frontmatter (`name`, `description`) and a body that gives the model the guidance.
3. Optionally add `references/`, `assets/`, `scripts/` subdirs as needed.
4. The orchestrator picks it up at startup — no other wiring required.

### Adding tool-scoped content

1. Create a folder under `prompts/tools/` named after the tool.
2. Add the markdown fragments the tool needs.
3. Update the tool's TypeScript to read those files explicitly. There's no auto-discovery.

### What goes where — quick decision tree

| Question | Answer |
|---|---|
| Is this prose the model should always see, on every turn? | `prompts/system/` |
| Is this prose the model should only see when a specific situation arises? | `prompts/skills/<skill>/SKILL.md` |
| Is this copy used inside a single MCP tool's response or description? | `prompts/tools/<tool>/<file>.md` |
| Is this an email template? | `templates/` |
| Is this UI-displayed copy (errors, labels)? | `errors/` (or its sibling locales) |
| Is this domain content (trip data, region data)? | `fixtures/` until chunk C lands real data |

---

## Runtime contract

- Every runtime package treats `cms/` as a read-only data source.
- Loaders live in the consuming package (orchestrator, UI, connector) and validate against Zod schemas before handing content to runtime code.
- No TypeScript in here. No build step reads from here at compile time.
- This directory is a placeholder for the real CMS that Swoop's sales staff will maintain post-Puma. Treat the authoring ergonomics accordingly: Markdown + JSON, flat where possible, no magic.

## Future evolution

This is a working CMS shape, not a final one. When a real authoring tool replaces it post-Puma, the file-system layout maps cleanly onto a CMS taxonomy:

- Each `system/` file becomes a "system prompt section" record with an order field.
- Each `skills/<name>/` becomes a "skill" record with name + description + body.
- Each `tools/<name>/` becomes a "tool prompts" group keyed by tool name.

Nothing in the load contract requires migration to be lossy.

## Where the rules came from

- **G.11** (planning/decisions.md, 2026-04-27) — the structural decision.
- **B.t1a** (planning/03-exec-agent-runtime-t1a.md) — the loader implementation that makes the system contract real.
- **02-impl-content.md §2.4** — the canonical Tier 2 layout and load contracts.
