// product/ui/src/disclosure/__tests__/opening-screen.test.tsx
//
// Covers the D.t4 paired opening screen:
//   - renders disclosure copy + Continue + No thanks
//   - Continue triggers POST /session + PATCH /session/:id/consent in order
//   - Continue stores session + consent flag in sessionStorage
//   - No thanks fires no network requests and writes no state
//   - Reload with stored consent skips straight past the opening screen

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { OpeningScreen } from "../opening-screen";
import {
  CONSENT_COPY_VERSION_KEY,
  CONSENT_STORAGE_KEY,
  useConsent,
} from "../use-consent";
import { SESSION_STORAGE_KEY } from "../../runtime/orchestrator-adapter";

/**
 * Harness mirrors the production lifting in `App.tsx` — single useConsent()
 * instance feeding props to OpeningScreen. Tests render this instead of
 * OpeningScreen directly.
 */
function OpeningScreenHarness() {
  const consent = useConsent();
  return (
    <OpeningScreen
      status={consent.status}
      isGranting={consent.isGranting}
      hasDeclined={consent.hasDeclined}
      grantConsent={consent.grantConsent}
      declineConsent={consent.declineConsent}
    />
  );
}

function mockFetch(handler: typeof fetch) {
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
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<OpeningScreen />", () => {
  it("renders disclosure copy with Continue + No thanks controls", () => {
    render(<OpeningScreenHarness />);
    expect(screen.getByTestId("opening-screen")).toBeInTheDocument();
    expect(screen.getByTestId("opening-screen-continue")).toBeInTheDocument();
    expect(screen.getByTestId("opening-screen-decline")).toBeInTheDocument();
    // Disclosure body present
    expect(screen.getByText(/AI assistant/i)).toBeInTheDocument();
  });

  it("focuses Continue on render for keyboard-first visitors", async () => {
    render(<OpeningScreenHarness />);
    await waitFor(() => {
      expect(screen.getByTestId("opening-screen-continue")).toHaveFocus();
    });
  });

  it("Continue triggers POST /session then PATCH /session/:id/consent and stores state", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch(
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/session") && init?.method === "POST") {
          return jsonResponse(
            { sessionId: "sess-123", disclosureCopyVersion: "v1" },
            { status: 201 },
          );
        }
        if (
          String(url).includes("/session/sess-123/consent") &&
          init?.method === "PATCH"
        ) {
          return jsonResponse({ consent: { conversation: { granted: true } } });
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    render(<OpeningScreenHarness />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("opening-screen-continue"));
    });

    await waitFor(() => {
      expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe("sess-123");
    });
    expect(window.sessionStorage.getItem(CONSENT_STORAGE_KEY)).toBe("true");
    expect(window.sessionStorage.getItem(CONSENT_COPY_VERSION_KEY)).toBe("v1");

    // Ordered: session bootstrap first, then consent.
    expect(calls[0].url).toMatch(/\/session$/);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[1].url).toMatch(/\/session\/sess-123\/consent$/);
    expect(calls[1].init?.method).toBe("PATCH");
    // Echoes the copyVersion the orchestrator returned.
    expect(calls[1].init?.body).toContain('"copyVersion":"v1"');
    expect(calls[1].init?.body).toContain('"granted":true');
  });

  it("No thanks closes cleanly with no network requests and no persisted state", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch should not be called");
    });
    mockFetch(fetchSpy as unknown as typeof fetch);

    render(<OpeningScreenHarness />);
    fireEvent.click(screen.getByTestId("opening-screen-decline"));

    await waitFor(() => {
      expect(screen.getByTestId("opening-screen-declined")).toBeInTheDocument();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });

  it("surfaces an error banner when POST /session fails", async () => {
    mockFetch(
      vi.fn(async () =>
        new Response("boom", { status: 500, statusText: "Internal" }),
      ) as unknown as typeof fetch,
    );

    render(<OpeningScreenHarness />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("opening-screen-continue"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("opening-screen-error")).toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe("useConsent hydration", () => {
  it("rehydrates granted state from sessionStorage on mount", () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "sess-abc");
    window.sessionStorage.setItem(CONSENT_STORAGE_KEY, "true");
    window.sessionStorage.setItem(CONSENT_COPY_VERSION_KEY, "v1");

    let captured: ReturnType<typeof useConsent> | null = null;
    function Probe() {
      captured = useConsent();
      return null;
    }
    render(<Probe />);
    expect(captured).not.toBeNull();
    expect(captured!.hasConsented).toBe(true);
    expect(captured!.status.state).toBe("granted");
    if (captured!.status.state === "granted") {
      expect(captured!.status.sessionId).toBe("sess-abc");
      expect(captured!.status.copyVersion).toBe("v1");
    }
  });
});
