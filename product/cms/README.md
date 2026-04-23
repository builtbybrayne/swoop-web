# product/cms/ — content as data

All Puma content that isn't code lives here: prompts, skills, legal copy, email templates, placeholder fixture content. Markdown and JSON only.

## Why this exists

Content is data, not code. Authored by non-engineers (ultimately Swoop's sales staff), loaded at runtime by `orchestrator/`, `connector/`, and `ui/`. Never inlined inside TypeScript.

If you find yourself pasting paragraphs of prose into a `.ts` file, stop and put it here instead.

## Layout

Internal structure is not locked in by this scaffold — chunk G's Tier 3 execution plan settles the shape. The expected layout (subject to change when G lands):

```
cms/
├── prompts/      # system / agent / skill prompts, markdown
├── skills/       # skill definitions — criteria + referenced prompts
├── templates/    # email + handoff templates
├── legal/        # AI Act Art. 50 disclosures, GDPR notices, T&Cs excerpts
└── fixtures/     # placeholder sales copy + library entries for dev/validation
```

## Runtime contract

- Every runtime package treats `cms/` as a read-only data source.
- Loaders live in `ts-common/` (or the relevant package) and validate against Zod schemas before handing content to runtime code.
- No TypeScript in here. No build step reads from here at compile time.
- This directory is a placeholder for the real CMS that Swoop's sales staff will maintain post-Puma. Treat the authoring ergonomics accordingly: Markdown + JSON, flat where possible, no magic.

## Not in scope for A.t4

Chunk A's scaffolding creates this directory and this README only. The actual content — prompts, skills, fixtures — lands via chunk G.
