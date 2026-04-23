# Stream: @swoop/orchestrator

**Status**: active
**Current task**: B.t4 streaming event translator (+ scoped block parser)
**Blockers**: none
**Interface changes proposed**: none (`@swoop/common/streaming.ts` untouched — current shape covers the four block types via TextPart / ReasoningPart / ToolCallPart / DataFyiPart).
**Last updated**: 2026-04-22

## Notes for successors (B.t5 / B.t7)

- Entry point is `src/index.ts`. `main()` wires config → prompt loader → agent → Express.
- `src/agent/factory.ts` returns an ADK `LlmAgent`. **B.t3** is wiring tools; **B.t5** wires the `/chat` SSE endpoint.
- `src/agent/claude-llm.ts` is a minimal `BaseLlm` shim. Its `generateContentAsync` and `connect` methods currently **throw**. **B.t5** replaces them with real Anthropic Messages API calls **and must map Anthropic thinking blocks to `Part.thought === true`** so the translator's reasoning-filter recognises them (see decision B.13 / resolved B.9).
- `src/config/index.ts` is the B.t1 config surface only. **B.t6** extends it.
- No SessionService is instantiated yet. **B.t2** adds one behind a `@swoop/common` interface.
- **Translator (this task, B.t4) now lives at `src/translator/`.**

## Translator handoff (B.t4 → B.t5)

- Public entry point: `translateAdkStream(source, { onFiltered?, now? })` from `src/translator/index.ts`. Returns an async iterator of `MessagePart`.
- Stateless per turn — safe to call once per user turn. Holds no state between turns.
- **Hard invariant**: no `MessagePart` with `type === 'reasoning'` is ever yielded. Covered by tests in `src/translator/__tests__/`.
- `onFiltered` is the hook B.t5 wires to B.t2's session-history accumulator — reasoning parts pass through there before being dropped.
- Block parser is scoped to `<fyi>` only (decision B.13). `<reasoning>` / `<utter>` / `<adjunct>` ride ADK natives (`Part.thought`, `Part.text`, `Part.functionCall` / `Part.functionResponse`).
- Fixtures are hand-authored in `src/translator/__tests__/fixtures/adk-events.ts`. **When B.t5's Anthropic wiring enables live ADK event capture, replace the hand-authored fixtures with captured JSON streams committed under `src/translator/__tests__/fixtures/` and regenerate on each `@google/adk` version bump.**
- Tests: `npm test -w @swoop/orchestrator` (vitest).
