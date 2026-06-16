import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getDevModelOverride,
  resetDevModelStore,
  setDevModelOverride,
  useDevModelOverride,
} from "../dev-model-store";

// Vitest runs with `import.meta.env.DEV === true`, so the store's dev gate is
// open here — exactly the dev/test condition the picker ships under.

const KEY = "swoop.dev.model";

beforeEach(() => {
  window.sessionStorage.clear();
  resetDevModelStore();
});

afterEach(() => {
  window.sessionStorage.clear();
  resetDevModelStore();
});

describe("dev-model-store", () => {
  it("starts empty when nothing is persisted", () => {
    expect(getDevModelOverride()).toBeUndefined();
  });

  it("set → get round-trips and persists tab-scoped", () => {
    setDevModelOverride("claude-opus-4-8");
    expect(getDevModelOverride()).toBe("claude-opus-4-8");
    expect(window.sessionStorage.getItem(KEY)).toBe("claude-opus-4-8");
  });

  it("clearing with undefined removes the persisted value", () => {
    setDevModelOverride("claude-opus-4-8");
    setDevModelOverride(undefined);
    expect(getDevModelOverride()).toBeUndefined();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("reads a pre-existing persisted value after reset (reload path)", () => {
    window.sessionStorage.setItem(KEY, "claude-fable-5");
    resetDevModelStore(); // simulates a fresh module load / reload
    expect(getDevModelOverride()).toBe("claude-fable-5");
  });

  it("useDevModelOverride re-renders on external set (the dropdown's contract)", () => {
    const { result } = renderHook(() => useDevModelOverride());
    expect(result.current).toBeUndefined();

    act(() => setDevModelOverride("claude-sonnet-4-6"));
    expect(result.current).toBe("claude-sonnet-4-6");

    act(() => setDevModelOverride("claude-opus-4-8"));
    expect(result.current).toBe("claude-opus-4-8");

    act(() => setDevModelOverride(undefined));
    expect(result.current).toBeUndefined();
  });
});
