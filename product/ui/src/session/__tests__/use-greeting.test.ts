// product/ui/src/session/__tests__/use-greeting.test.ts
//
// Hook-under-test coverage for consent-greeting-prewarm's `useGreeting`.
//
// Cases:
//   1. fires ONE greeting turn on a fresh session (rehydrateStatus "empty"):
//      arms the transport flag + appends the GREETING_USER_MARKER once.
//   2. does NOT fire when history is non-empty (rehydrateStatus "applied").
//   3. does NOT fire while rehydrate is still resolving ("loading"/"idle").
//   4. fires once under React StrictMode double-invoke.
//   5. is a no-op when disabled / sessionId null / runtime null.
//
// A minimal fake runtime exposes only `thread.append`. `armGreetingTurn` is
// spied via vi.mock on the adapter module so we assert the flag is armed
// immediately before the append (and exactly once).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";

// Mock the adapter so `armGreetingTurn` is observable and we don't pull in the
// real transport. The hook only uses `armGreetingTurn` from this module.
const armGreetingTurn = vi.fn();
vi.mock("../../runtime/orchestrator-adapter", () => ({
  armGreetingTurn: () => armGreetingTurn(),
}));

import { useGreeting, isGreetingMarkerText } from "../use-greeting";
import type { RehydrateStatus } from "../use-rehydrate";
import { GREETING_USER_MARKER } from "@swoop/common";

type FakeRuntime = {
  thread: { append: ReturnType<typeof vi.fn> };
};

const fakeRuntime: FakeRuntime = {
  thread: { append: vi.fn() },
};

const SESSION_ID = "sess-greeting-hook-test-001";

interface HarnessProps {
  enabled: boolean;
  sessionId: string | null;
  rehydrateStatus: RehydrateStatus;
  runtime?: FakeRuntime | null;
}

function Harness(props: HarnessProps): null {
  useGreeting({
    enabled: props.enabled,
    sessionId: props.sessionId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runtime: (props.runtime === undefined ? fakeRuntime : props.runtime) as any,
    rehydrateStatus: props.rehydrateStatus,
  });
  return null;
}

beforeEach(() => {
  armGreetingTurn.mockReset();
  fakeRuntime.thread.append.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useGreeting (consent-triggered warm hello)", () => {
  it("fires once on a fresh session (rehydrateStatus 'empty')", async () => {
    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: SESSION_ID,
          rehydrateStatus: "empty",
        }),
      );
    });

    expect(armGreetingTurn).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.thread.append).toHaveBeenCalledTimes(1);
    // Appended a user message carrying the marker text.
    const arg = fakeRuntime.thread.append.mock.calls[0]![0] as {
      role: string;
      content: Array<{ type: string; text: string }>;
    };
    expect(arg.role).toBe("user");
    expect(arg.content[0]!.type).toBe("text");
    expect(arg.content[0]!.text).toContain("__swoop_greeting__");
  });

  it("does NOT fire when history is non-empty (rehydrateStatus 'applied')", async () => {
    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: SESSION_ID,
          rehydrateStatus: "applied",
        }),
      );
    });

    expect(armGreetingTurn).not.toHaveBeenCalled();
    expect(fakeRuntime.thread.append).not.toHaveBeenCalled();
  });

  it("does NOT fire while rehydrate is still resolving", async () => {
    const statuses: RehydrateStatus[] = ["idle", "loading", "expired", "failed"];
    for (const status of statuses) {
      armGreetingTurn.mockReset();
      fakeRuntime.thread.append.mockReset();
      await act(async () => {
        render(
          React.createElement(Harness, {
            enabled: true,
            sessionId: SESSION_ID,
            rehydrateStatus: status,
          }),
        );
      });
      expect(fakeRuntime.thread.append).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("fires once under React StrictMode double-invoke", async () => {
    await act(async () => {
      render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(Harness, {
            enabled: true,
            sessionId: SESSION_ID,
            rehydrateStatus: "empty",
          }),
        ),
      );
    });

    expect(fakeRuntime.thread.append).toHaveBeenCalledTimes(1);
    expect(armGreetingTurn).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when disabled", async () => {
    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: false,
          sessionId: SESSION_ID,
          rehydrateStatus: "empty",
        }),
      );
    });
    expect(fakeRuntime.thread.append).not.toHaveBeenCalled();
  });

  it("is a no-op when sessionId is null", async () => {
    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: null,
          rehydrateStatus: "empty",
        }),
      );
    });
    expect(fakeRuntime.thread.append).not.toHaveBeenCalled();
  });

  it("is a no-op when runtime is null", async () => {
    await act(async () => {
      render(
        React.createElement(Harness, {
          enabled: true,
          sessionId: SESSION_ID,
          rehydrateStatus: "empty",
          runtime: null,
        }),
      );
    });
    expect(armGreetingTurn).not.toHaveBeenCalled();
  });
});

// The suppression rule `MessageView` (App.tsx) uses to render nothing for the
// synthetic greeting marker — covers the live + rehydrate user-message text.
describe("isGreetingMarkerText (MessageView suppression rule, PW-4)", () => {
  it("matches the exact marker", () => {
    expect(isGreetingMarkerText(GREETING_USER_MARKER)).toBe(true);
  });

  it("matches the marker with surrounding whitespace (round-trip tolerant)", () => {
    expect(isGreetingMarkerText(`  ${GREETING_USER_MARKER}\n`)).toBe(true);
  });

  it("does not match a normal visitor message", () => {
    expect(isGreetingMarkerText("Tell me about Patagonia")).toBe(false);
    expect(isGreetingMarkerText("")).toBe(false);
    expect(isGreetingMarkerText("__swoop_greeting__ but with more text")).toBe(
      false,
    );
  });
});
