# 03 — Execution: B.t2 — Session interface + ADK in-memory adapter

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: B (agent runtime).
**Task**: t2 — session interface + ADK in-memory adapter.
**Implements**: `planning/02-impl-agent-runtime.md` §2.6 + decision B.2.
**Depends on**: A.t2 (`SessionState` shape already stubbed in `ts-common`), B.t1 (orchestrator exists to integrate).
**Produces**: `product/orchestrator/src/session/` — thin interface over ADK's native `SessionService`, in-memory adapter, stubbed Vertex AI Session Service + DB-backed adapters (interface-compatible, no-op bodies). Warm pool is B.t10, not here.
**Unblocks**: B.t3+ (tool adapter uses session), B.t7 (vertical slice needs session).
**Estimate**: 2–3 hours.

---

## Purpose

Wrap ADK's native `SessionService` behind a thin `@swoop/common` interface so Puma's orchestrator code is agnostic to the backend. Phase 1 uses in-memory. Production backend (Vertex AI Session Service vs DB-backed) picked post-M4 with real usage data. The interface is what matters at this stage — adapter bodies can be empty stubs except the in-memory one.

---

## Deliverables

### `ts-common` additions (if not already in A.t2)

Confirm `SessionState` + `ConsentState` are complete per `planning/02-impl-agent-runtime.md` §2.6. If A.t2 left them skeletal, extend here.

### `product/orchestrator/src/session/`

| File | Role |
|---|---|
| `session/interface.ts` | Defines `SessionStore` interface: `create(initial: Partial<SessionState>): Promise<SessionState>`, `get(id: string): Promise<SessionState \| null>`, `update(id: string, mutate: (s: SessionState) => SessionState): Promise<SessionState>`, `delete(id: string): Promise<void>`, `archive(id: string): Promise<void>`. Pure interface; no implementations. |
| `session/in-memory.ts` | Node `Map<string, SessionState>` implementation. Tracks idle time per session; exposes a periodic sweeper that marks >24h sessions archived and drops >7d archived sessions. All async to match interface. |
| `session/adk-native.ts` | Adapter over ADK's `SessionService` abstraction. ADK's API (verify at implementation time) is the primary path — this adapter forwards to ADK, and the in-memory adapter is its own thing for zero-config Phase 1 dev. **If ADK's native session service is trivially sufficient for Phase 1, the in-memory adapter can be retired and we just use ADK-native in-memory mode.** This is a Tier 3 call — check the ADK API and make the simpler choice. |
| `session/vertex-ai.ts` | Stub: exports a factory that throws `"not implemented"` from every method. Exists to reserve the module and type-check the interface match. Real body lands post-M4. |
| `session/firestore.ts` | Stub: same pattern. |
| `session/index.ts` | Factory: reads `SESSION_BACKEND` from config (`"in-memory"` \| `"adk-native"` \| `"vertex-ai"` \| `"firestore"`), returns an instance. Default `"in-memory"`. |

### Integration into `product/orchestrator/src/agent/factory.ts`

The agent factory accepts a `SessionStore` instance and uses it to persist conversation history + session state. ADK's own `SessionService` may handle conversation history natively; `SessionStore` extends that with Puma-specific state (triage, wishlist, consent).

### Consent gate

`session/interface.ts` includes a helper `canAcceptTurn(session: SessionState): boolean` — returns `true` only if `session.consent.conversation.granted === true`. The orchestrator rejects turn processing for sessions without tier-1 consent (per chunk E §2.3).

### `.env.example` additions

```
SESSION_BACKEND=in-memory
# SESSION_TTL_IDLE_HOURS=24
# SESSION_TTL_ARCHIVE_DAYS=7
```

### Tests

`product/orchestrator/src/session/__tests__/in-memory.test.ts` — Vitest coverage of the in-memory adapter: create → get → update → delete round-trip; idle sweep behaviour with mocked time; consent-gated turn rejection.

---

## Key implementation notes

### 1. ADK-native first, in-memory second

If ADK's `SessionService` in-memory mode already does everything Puma's in-memory adapter would — just use ADK-native and drop the custom in-memory adapter. Simpler is better. Verify at implementation time; if ADK's mode is missing consent-gating or triage-state fields, the thin `SessionStore` wrapper sits in front of ADK-native.

### 2. Consent state is load-bearing

`canAcceptTurn` is called by the orchestrator before every user turn. It's the mechanism enforcing "no session state accumulates before tier-1 consent" from chunk E §2.3 and chunk D §2.4.

### 3. Stubs have type-checked interfaces

Vertex AI and Firestore stubs throw from every method but their class **implements** `SessionStore`. This means when a future agent lights one up, the shape is already right.

### 4. Don't touch the warm pool

B.t10 is warm pool. B.t2 is session storage. Keep them separate.

### 5. Archival vs deletion

Sweeper marks idle sessions archived (read-only retention for 7 days), then deletes. Don't conflate the two states.

---

## References

- ADK's `SessionService` docs — verify current API at implementation time.
- `planning/02-impl-agent-runtime.md` §2.6 + §2.6a.
- `planning/02-impl-handoff-and-compliance.md` §2.3 (consent fields).

---

## Verification

1. `cd product && npm run typecheck -w @swoop/orchestrator` passes.
2. `cd product && npx vitest run -w @swoop/orchestrator` — in-memory adapter tests pass.
3. Startup with `SESSION_BACKEND=in-memory` works.
4. Startup with `SESSION_BACKEND=vertex-ai` either works (if ADK-native is wired) or throws "not implemented" at first use — not at startup. (Startup must be clean; actual use triggers the stub.)
5. A session created with `consent.conversation.granted === false` fails `canAcceptTurn`.
6. Idle sweep moves sessions to archived after a configurable TTL (use mocked time in the test; real time in dev).

---

## Handoff notes

- If ADK-native session service in-memory mode covers everything, **prefer that** — retiring the custom in-memory adapter is a win, not a loss.
- Do not add Firestore or Vertex AI Session Service wiring bodies — those are post-M4.
- Warm pool is B.t10.
- Session-id issuance policy (uuid vs client-generated) is a B.t5 concern (SSE endpoint entrypoint). Don't decide it here.
