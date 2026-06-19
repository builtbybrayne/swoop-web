import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getDevThinkingOverride,
  resetDevThinkingStore,
  setDevThinkingOverride,
  useDevThinkingOverride,
} from "../dev-thinking-store";

// Vitest runs with MODE=test (non-production), so isDevToolsEnabled() is true
// here — exactly the dev/test condition the toggle ships under.

const KEY = "swoop.dev.thinking";

beforeEach(() => {
  window.sessionStorage.clear();
  resetDevThinkingStore();
});

afterEach(() => {
  window.sessionStorage.clear();
  resetDevThinkingStore();
});

describe("dev-thinking-store", () => {
  it("starts empty (no override) when nothing is persisted", () => {
    expect(getDevThinkingOverride()).toBeUndefined();
  });

  it("set(false) → get round-trips and persists tab-scoped", () => {
    setDevThinkingOverride(false);
    expect(getDevThinkingOverride()).toBe(false);
    expect(window.sessionStorage.getItem(KEY)).toBe("false");
  });

  it("set(true) → get round-trips and persists tab-scoped", () => {
    setDevThinkingOverride(true);
    expect(getDevThinkingOverride()).toBe(true);
    expect(window.sessionStorage.getItem(KEY)).toBe("true");
  });

  it("clearing with undefined removes the persisted value", () => {
    setDevThinkingOverride(false);
    setDevThinkingOverride(undefined);
    expect(getDevThinkingOverride()).toBeUndefined();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("reads a pre-existing persisted value after reset (reload path)", () => {
    window.sessionStorage.setItem(KEY, "false");
    resetDevThinkingStore(); // simulates a fresh module load / reload
    expect(getDevThinkingOverride()).toBe(false);
  });

  it("useDevThinkingOverride re-renders on external set (the checkbox's contract)", () => {
    const { result } = renderHook(() => useDevThinkingOverride());
    expect(result.current).toBeUndefined();

    act(() => setDevThinkingOverride(false));
    expect(result.current).toBe(false);

    act(() => setDevThinkingOverride(true));
    expect(result.current).toBe(true);

    act(() => setDevThinkingOverride(undefined));
    expect(result.current).toBeUndefined();
  });
});
