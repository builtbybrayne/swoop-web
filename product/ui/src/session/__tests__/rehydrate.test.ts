// product/ui/src/session/__tests__/rehydrate.test.ts
//
// Unit tests on the pure `fetchSessionHistoryAt` helper — D.t9-mount-rehydrate.
//
// Six cases from the plan §"Unit tests":
//   1. 200 with non-empty parts → {parts}
//   2. 200 with empty parts     → {parts: []}
//   3. 404                      → {error: "session_not_found"}
//   4. 500                      → {error: "fetch_failed"}
//   5. fetch throw              → {error: "network_error"}
//   6. 200 with invalid JSON    → {error: "fetch_failed"}
//
// Mirrors the `preflight.test.ts` shape — same `mockFetch` + `jsonResponse`
// helpers, same beforeEach/afterEach hygiene.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSessionHistoryAt, isFetchHistorySuccess } from "../rehydrate";

const BASE_URL = "http://localhost:8080";
const SESSION_ID = "sess-rehydrate-test-001";

function mockFetch(handler: typeof fetch): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = handler;
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchSessionHistoryAt", () => {
  it("returns {parts} on a 200 with non-empty parts", async () => {
    const parts = [
      { type: "text", text: "Hello " },
      { type: "text", text: "Patagonia." },
    ];
    mockFetch(async () => jsonResponse({ parts }));
    const result = await fetchSessionHistoryAt(BASE_URL, SESSION_ID);
    expect(isFetchHistorySuccess(result)).toBe(true);
    if (isFetchHistorySuccess(result)) {
      expect(result.parts).toEqual(parts);
    }
  });

  it("returns {parts: []} on a 200 with empty parts (consented zero-turn session)", async () => {
    mockFetch(async () => jsonResponse({ parts: [] }));
    const result = await fetchSessionHistoryAt(BASE_URL, SESSION_ID);
    expect(isFetchHistorySuccess(result)).toBe(true);
    if (isFetchHistorySuccess(result)) {
      expect(result.parts).toEqual([]);
    }
  });

  it("returns {error: 'session_not_found'} on 404", async () => {
    mockFetch(async () =>
      jsonResponse(
        { error: { code: "session_not_found", message: "no such session" } },
        { status: 404 },
      ),
    );
    const result = await fetchSessionHistoryAt(BASE_URL, SESSION_ID);
    expect(result).toEqual({ error: "session_not_found" });
  });

  it("returns {error: 'fetch_failed'} on 500", async () => {
    mockFetch(async () =>
      jsonResponse(
        { error: { code: "internal_error", message: "kaboom" } },
        { status: 500 },
      ),
    );
    const result = await fetchSessionHistoryAt(BASE_URL, SESSION_ID);
    expect(result).toEqual({ error: "fetch_failed" });
  });

  it("returns {error: 'network_error'} on fetch reject", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await fetchSessionHistoryAt(BASE_URL, SESSION_ID);
    expect(result).toEqual({ error: "network_error" });
  });

  it("returns {error: 'fetch_failed'} on 200 with invalid JSON", async () => {
    mockFetch(
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await fetchSessionHistoryAt(BASE_URL, SESSION_ID);
    expect(result).toEqual({ error: "fetch_failed" });
  });

  it("returns {error: 'fetch_failed'} when body shape misses `parts` array", async () => {
    mockFetch(async () => jsonResponse({ unexpected: true }));
    const result = await fetchSessionHistoryAt(BASE_URL, SESSION_ID);
    expect(result).toEqual({ error: "fetch_failed" });
  });

  it("URL-encodes the session id in the history path", async () => {
    let seenUrl: string | null = null;
    mockFetch(async (input) => {
      seenUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse({ parts: [] });
    });
    await fetchSessionHistoryAt(BASE_URL, "a b/c", undefined);
    expect(seenUrl).toBe(`${BASE_URL}/session/a%20b%2Fc/history`);
  });

  it("re-throws AbortError so callers can observe cancellation", async () => {
    mockFetch(async (_input, init) => {
      const sig = (init as RequestInit | undefined)?.signal;
      if (sig?.aborted) {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      }
      return jsonResponse({ parts: [] });
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchSessionHistoryAt(BASE_URL, SESSION_ID, controller.signal),
    ).rejects.toThrow(/aborted/);
  });
});
