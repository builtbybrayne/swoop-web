// product/ui/src/session/__tests__/preflight.test.ts
//
// Unit coverage for D.t6 preflight machinery — both the pure `probeSession`
// helper and the `usePreflight` hook's trigger/debounce/emitter contract.
//
// Plan reference: planning/03-exec-chat-surface-t6.md §Verification (unit).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";

import {
  NETWORK_ERROR,
  PROBE_DEBOUNCE_MS,
  probeSession,
} from "../preflight";
import { usePreflight } from "../use-preflight";
import { subscribeAdapterErrors } from "../../runtime/orchestrator-adapter";

const BASE_URL = "http://localhost:8080";
const SESSION_ID = "sess-test-123";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Minimal React host component for hook-under-test. Using `render` + a
 * component wrapper (rather than `renderHook`) keeps parity with
 * opening-screen.test.tsx and lets us exercise unmount via `unmount()`.
 */
function PreflightHarness(props: {
  enabled: boolean;
  sessionId: string | null;
  idleMs?: number;
}): null {
  usePreflight({
    enabled: props.enabled,
    sessionId: props.sessionId,
    idleMs: props.idleMs,
  });
  return null;
}

/** Collect `emitAdapterError` calls into an array for assertions. */
function captureAdapterErrors(): {
  errors: unknown[];
  unsubscribe: () => void;
} {
  const errors: unknown[] = [];
  const unsubscribe = subscribeAdapterErrors((err) => {
    errors.push(err);
  });
  return { errors, unsubscribe };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// probeSession — pure helper
// ---------------------------------------------------------------------------

describe("probeSession", () => {
  it("returns the parsed body on a 200 OK", async () => {
    mockFetch(async () =>
      jsonResponse({ ok: true, expired: false, serverTime: "2026-04-24T00:00:00.000Z" }),
    );
    const result = await probeSession(BASE_URL, SESSION_ID);
    expect(result).toEqual({
      ok: true,
      expired: false,
      serverTime: "2026-04-24T00:00:00.000Z",
    });
  });

  it("returns NETWORK_ERROR on fetch reject", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await probeSession(BASE_URL, SESSION_ID);
    expect(result).toBe(NETWORK_ERROR);
  });

  it("returns NETWORK_ERROR on a non-2xx response", async () => {
    // Endpoint contract says always-200 on good paths — a 500 here is a
    // server fault, not authoritative expiry evidence.
    mockFetch(async () => new Response("oops", { status: 500 }));
    const result = await probeSession(BASE_URL, SESSION_ID);
    expect(result).toBe(NETWORK_ERROR);
  });

  it("returns NETWORK_ERROR when JSON is malformed", async () => {
    mockFetch(
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await probeSession(BASE_URL, SESSION_ID);
    expect(result).toBe(NETWORK_ERROR);
  });

  it("returns NETWORK_ERROR when body shape doesn't match", async () => {
    mockFetch(async () => jsonResponse({ unexpected: true }));
    const result = await probeSession(BASE_URL, SESSION_ID);
    expect(result).toBe(NETWORK_ERROR);
  });

  it("re-throws AbortError so callers can observe cancellation", async () => {
    mockFetch(async (_input, init) => {
      // Emulate fetch raising AbortError when the signal is already aborted.
      const sig = (init as RequestInit | undefined)?.signal;
      if (sig?.aborted) {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      }
      return jsonResponse({ ok: true, expired: false, serverTime: "" });
    });
    const controller = new AbortController();
    controller.abort();
    await expect(probeSession(BASE_URL, SESSION_ID, controller.signal)).rejects.toThrow(
      /aborted/,
    );
  });

  it("URL-encodes the session id in the probe path", async () => {
    let seenUrl: string | null = null;
    mockFetch(async (input) => {
      seenUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse({ ok: true, expired: false, serverTime: "t" });
    });
    await probeSession(BASE_URL, "a b/c", undefined);
    expect(seenUrl).toBe(`${BASE_URL}/session/a%20b%2Fc/ping`);
  });
});

// ---------------------------------------------------------------------------
// usePreflight — emitter wiring + trigger behaviour
// ---------------------------------------------------------------------------

describe("usePreflight (mount trigger + emitter routing)", () => {
  it("emits a [session_not_found] error when probe returns {expired:true}", async () => {
    mockFetch(async () =>
      jsonResponse({ ok: false, expired: true, serverTime: "t" }),
    );
    const { errors, unsubscribe } = captureAdapterErrors();
    try {
      await act(async () => {
        render(
          React.createElement(PreflightHarness, {
            enabled: true,
            sessionId: SESSION_ID,
          }),
        );
      });
      // Let the microtask queue drain so the async probe settles.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const first = errors[0];
      expect(first).toBeInstanceOf(Error);
      expect((first as Error).message).toContain("[session_not_found]");
    } finally {
      unsubscribe();
    }
  });

  it("does NOT emit when the probe returns {expired:false}", async () => {
    mockFetch(async () =>
      jsonResponse({ ok: true, expired: false, serverTime: "t" }),
    );
    const { errors, unsubscribe } = captureAdapterErrors();
    try {
      await act(async () => {
        render(
          React.createElement(PreflightHarness, {
            enabled: true,
            sessionId: SESSION_ID,
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(errors).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });

  it("does NOT emit on NETWORK_ERROR (probe flake is silent)", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { errors, unsubscribe } = captureAdapterErrors();
    try {
      await act(async () => {
        render(
          React.createElement(PreflightHarness, {
            enabled: true,
            sessionId: SESSION_ID,
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(errors).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });

  it("emits [session_not_found] synchronously when sessionId is null", async () => {
    // No id client-side → server can't know the session; treat as expired.
    let fetchCalled = false;
    mockFetch(async () => {
      fetchCalled = true;
      return jsonResponse({ ok: true, expired: false, serverTime: "t" });
    });
    const { errors, unsubscribe } = captureAdapterErrors();
    try {
      await act(async () => {
        render(
          React.createElement(PreflightHarness, {
            enabled: true,
            sessionId: null,
          }),
        );
      });
      expect(fetchCalled).toBe(false);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect((errors[0] as Error).message).toContain("[session_not_found]");
    } finally {
      unsubscribe();
    }
  });

  it("is a no-op while disabled", async () => {
    let fetchCalled = false;
    mockFetch(async () => {
      fetchCalled = true;
      return jsonResponse({ ok: true, expired: false, serverTime: "t" });
    });
    const { errors, unsubscribe } = captureAdapterErrors();
    try {
      await act(async () => {
        render(
          React.createElement(PreflightHarness, {
            enabled: false,
            sessionId: SESSION_ID,
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchCalled).toBe(false);
      expect(errors).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });
});

// ---------------------------------------------------------------------------
// usePreflight — debounce + in-flight guard
// ---------------------------------------------------------------------------

describe("usePreflight (debounce + in-flight guard)", () => {
  it("coalesces a burst of visibilitychange events within 2s into one probe", async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount += 1;
      return jsonResponse({ ok: true, expired: false, serverTime: "t" });
    });
    try {
      await act(async () => {
        render(
          React.createElement(PreflightHarness, {
            enabled: true,
            sessionId: SESSION_ID,
          }),
        );
      });
      // Let the mount probe settle first.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const mountCount = callCount;
      expect(mountCount).toBe(1);

      // Fire two visibility events back-to-back (well within PROBE_DEBOUNCE_MS).
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
        await Promise.resolve();
      });

      // Neither should have issued a new probe: the mount probe's timestamp
      // is still within the debounce window AND the in-flight guard would
      // also no-op if the first event landed while the probe was pending.
      expect(callCount - mountCount).toBe(0);
      expect(PROBE_DEBOUNCE_MS).toBeGreaterThan(1000);
    } finally {
      // nothing
    }
  });

  it("does not start a second fetch while one is still pending", async () => {
    // Construct a fetch that hangs until we release it, so the second
    // trigger has no chance to race past the in-flight guard.
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let callCount = 0;
    mockFetch(async () => {
      callCount += 1;
      return pending;
    });
    try {
      await act(async () => {
        render(
          React.createElement(PreflightHarness, {
            enabled: true,
            sessionId: SESSION_ID,
          }),
        );
      });
      // Mount fired one probe and it's now hanging.
      expect(callCount).toBe(1);

      // Try to trigger more probes while the first is pending. Even if we
      // were past the debounce window, the in-flight guard should hold.
      // (We can't cleanly fast-forward 2s without fake timers; the guard
      // alone is enough to prove the invariant.)
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });
      expect(callCount).toBe(1);

      // Now release so React cleanup doesn't leak a hanging promise.
      release(
        jsonResponse({ ok: true, expired: false, serverTime: "t" }),
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    } finally {
      // nothing
    }
  });
});

// ---------------------------------------------------------------------------
// usePreflight — cancellation on unmount
// ---------------------------------------------------------------------------

describe("usePreflight (unmount cleanup)", () => {
  it("aborts the in-flight probe when the component unmounts", async () => {
    let observedSignal: AbortSignal | undefined;
    // Same hanging-fetch pattern: the probe never resolves on its own; we
    // inspect the signal for `aborted` after unmount.
    mockFetch(async (_input, init) => {
      observedSignal = (init as RequestInit).signal ?? undefined;
      return new Promise<Response>(() => {
        // never resolve
      });
    });

    const { unmount } = render(
      React.createElement(PreflightHarness, {
        enabled: true,
        sessionId: SESSION_ID,
      }),
    );
    // Let the mount probe start.
    await act(async () => {
      await Promise.resolve();
    });
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(false);

    unmount();
    // AbortController.abort flips the signal synchronously.
    expect(observedSignal?.aborted).toBe(true);
  });
});
