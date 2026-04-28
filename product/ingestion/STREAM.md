# Stream: @swoop/ingestion

**Status**: active — blog ingest implementation landed.
**Current task**: WordPress blog ingest pipeline (Tier 3 spec at `../../planning/03-exec-blog-ingest.md`). Single-file Node TS implementation at `src/blog/fetch.ts`; Vitest suite at `src/blog/__tests__/fetch.test.ts`. CLI surface: `npm run blog:fetch` (incremental default), `blog:fetch:backfill`, `blog:fetch:dry-run`; `--since=<date>` available via direct `tsx` invocation.
**Outputs**: immutable run snapshots at `data/blog/raw/<UTC-stamp>/{manifest.json, posts.ndjson, log.txt}`. `data/` is gitignored at the repo root.
**Blockers**: —
**Interface changes proposed**: —
**Last updated**: 2026-04-28
