// product/ui/src/session/__tests__/use-rehydrate.test.ts
//
// Hook-under-test coverage for D.t9-mount-rehydrate.
//
// Five cases from the plan §"Unit tests" + a sixth for replay correctness:
//   1. applies parts and calls onApplied on 200 + non-empty
//   2. skips fetch when enabled:false
//   3. fires once under React StrictMode double-invoke
//   4. calls onExpired and sets status="expired" on 404
//   5. sets status="failed" and emits adapter error on 5xx
//   6. status="empty" on 200 + empty parts (no replay invoked)
//
// Mocks `@assistant-ui/react`'s `useAssistantRuntime` so the hook can run
// without an `AssistantRuntimeProvider` in scope — keeps the test runtime-free
// (matches `preflight.test.ts`'s posture of a pure harness component).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";

// --- Mock @assistant-ui/react ----------------------------------------------
// `useAssistantRuntime({optional:true})` is what the hook calls. The runtime
// surface we exercise is `runtime.thread.reset(messages)` — that's it. A
// minimal stub is sufficient.

type FakeRuntime = {
  thread: { reset: ReturnType<typeof vi.fn> };
};

const fakeRuntime: FakeRuntime = {
  thread: { reset: vi.fn() },
};

vi.mock("@assistant-ui/react", () => ({
  useAssistantRuntime: (_opts?: { optional?: boolean }) => fakeRuntime,
}));

// Imports below come AFTER the mock is registered.
import { useRehydrate } from "../use-rehydrate";
import { subscribeAdapterErrors } from "../../runtime/orchestrator-adapter";

// ---------------------------------------------------------------------------
// Harness + helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-rehydrate-hook-test-001";

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

interface HarnessProps {
  enabled: boolean;
  sessionId: string | null;
  onApplied?: (n: number) => void;
  onExpired?: () => void;
  onStatusChange?: (status: string) => void;
}

function Harness(props: HarnessProps): null {
  const result = useRehydrate({
    enabled: props.enabled,
    sessionId: props.sessionId,
    onApplied: props.onApplied,
    onExpired: props.onExpired,
  });
  // Tests inspect status via the callback so they don't need to render text.
  props.onStatusChange?.(result.status);
  return null;
}

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
  fakeRuntime.thread.reset.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRehydrate (mount-time history rehydrate)", () => {
  it("applies parts and calls onApplied on 200 + non-empty", async () => {
    const parts = [
      { type: "text", text: "Welcome back to " },
      { type: "text", text: "Patagonia." },
    ];
    mockFetch(async () => jsonResponse({ parts }));

    const onApplied = vi.fn();
    const statuses: string[] = [];
    const onStatusChange = (s: string) => statuses.push(s);

    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: SESSION_ID,
          onApplied,
          onStatusChange,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(statuses[statuses.length - 1]).toBe("applied");
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(parts.length);
    // Replay was called with the synthetic assistant message.
    expect(fakeRuntime.thread.reset).toHaveBeenCalledTimes(1);
    const callArgs = fakeRuntime.thread.reset.mock.calls[0]![0] as Array<{
      role: string;
      content: unknown;
    }>;
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0]!.role).toBe("assistant");
  });

  it("status='empty' on 200 + empty parts (no replay invoked)", async () => {
    mockFetch(async () => jsonResponse({ parts: [] }));

    const onApplied = vi.fn();
    const statuses: string[] = [];
    const onStatusChange = (s: string) => statuses.push(s);

    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: SESSION_ID,
          onApplied,
          onStatusChange,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(statuses[statuses.length - 1]).toBe("empty");
    // Per HITL: empty replay is a fresh chat — no replay call, no onApplied.
    expect(fakeRuntime.thread.reset).not.toHaveBeenCalled();
    // onApplied is not called for empty per the contract.
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("skips fetch when enabled:false", async () => {
    let fetchCalled = false;
    mockFetch(async () => {
      fetchCalled = true;
      return jsonResponse({ parts: [] });
    });

    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: false,
          sessionId: SESSION_ID,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchCalled).toBe(false);
  });

  it("fires once under React StrictMode double-invoke", async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount += 1;
      return jsonResponse({ parts: [{ type: "text", text: "hi" }] });
    });

    await act(async () => {
      render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(Harness, {
            enabled: true,
            sessionId: SESSION_ID,
          }),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callCount).toBe(1);
  });

  it("calls onExpired and sets status='expired' on 404", async () => {
    mockFetch(async () =>
      jsonResponse(
        { error: { code: "session_not_found", message: "no such" } },
        { status: 404 },
      ),
    );

    const onExpired = vi.fn();
    const statuses: string[] = [];
    const onStatusChange = (s: string) => statuses.push(s);

    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: SESSION_ID,
          onExpired,
          onStatusChange,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(statuses[statuses.length - 1]).toBe("expired");
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.thread.reset).not.toHaveBeenCalled();
  });

  it("sets status='failed' and emits adapter error with [rehydrate_failed:fetch_failed] on 5xx", async () => {
    mockFetch(async () =>
      jsonResponse(
        { error: { code: "internal_error", message: "kaboom" } },
        { status: 500 },
      ),
    );

    const { errors, unsubscribe } = captureAdapterErrors();
    const statuses: string[] = [];
    const onStatusChange = (s: string) => statuses.push(s);
    try {
      await act(async () => {
        render(
          React.createElement(Harness, {
            enabled: true,
            sessionId: SESSION_ID,
            onStatusChange,
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(statuses[statuses.length - 1]).toBe("failed");
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const first = errors[0];
      expect(first).toBeInstanceOf(Error);
      expect((first as Error).message).toContain(
        "[rehydrate_failed:fetch_failed]",
      );
    } finally {
      unsubscribe();
    }
  });

  it("emits [rehydrate_failed:network_error] on fetch throw", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    const { errors, unsubscribe } = captureAdapterErrors();
    const statuses: string[] = [];
    const onStatusChange = (s: string) => statuses.push(s);
    try {
      await act(async () => {
        render(
          React.createElement(Harness, {
            enabled: true,
            sessionId: SESSION_ID,
            onStatusChange,
          }),
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(statuses[statuses.length - 1]).toBe("failed");
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const first = errors[0];
      expect(first).toBeInstanceOf(Error);
      expect((first as Error).message).toContain(
        "[rehydrate_failed:network_error]",
      );
    } finally {
      unsubscribe();
    }
  });

  it("is a no-op when sessionId is null", async () => {
    let fetchCalled = false;
    mockFetch(async () => {
      fetchCalled = true;
      return jsonResponse({ parts: [] });
    });

    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: null,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchCalled).toBe(false);
  });
});
