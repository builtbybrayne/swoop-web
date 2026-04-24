import { describe, expect, it } from "vitest";
import { classifyError } from "../classify";

describe("classifyError", () => {
  it("routes session_not_found marker to session_expired", () => {
    const r = classifyError(
      new Error("Orchestrator /chat failed [session_not_found]: no session with id x"),
    );
    expect(r.surface).toBe("session_expired");
    expect(r.retryable).toBe(false);
  });

  it("routes 404 status in message to session_expired", () => {
    const r = classifyError(new Error("Session bootstrap failed: 404 Not Found"));
    expect(r.surface).toBe("session_expired");
  });

  it("routes rate_limited marker to rate_limited with cooloff", () => {
    const r = classifyError(
      new Error("Orchestrator /chat failed [rate_limited]: slow down"),
    );
    expect(r.surface).toBe("rate_limited");
    expect(r.cooloffMs).toBeGreaterThan(0);
  });

  it("routes 429 status to rate_limited", () => {
    const r = classifyError(new Error("HTTP 429 Too Many Requests"));
    expect(r.surface).toBe("rate_limited");
  });

  it("routes [stream] prefix to stream_drop", () => {
    const r = classifyError(new Error("[stream] upstream closed"));
    expect(r.surface).toBe("stream_drop");
    expect(r.retryable).toBe(true);
  });

  it("routes TypeError fetch failures to unreachable", () => {
    const r = classifyError(new TypeError("Failed to fetch"));
    expect(r.surface).toBe("unreachable");
  });

  it("routes ECONNREFUSED-shaped plain errors to unreachable", () => {
    const r = classifyError(new Error("fetch failed: ECONNREFUSED 127.0.0.1:8080"));
    expect(r.surface).toBe("unreachable");
  });

  it("falls through to unknown", () => {
    const r = classifyError(new Error("some unrelated failure"));
    expect(r.surface).toBe("unknown");
    expect(r.retryable).toBe(true);
  });

  it("handles non-Error throwables without crashing", () => {
    expect(classifyError("boom").surface).toBe("unknown");
    expect(classifyError({ message: "boom" }).surface).toBe("unknown");
    expect(classifyError(undefined).surface).toBe("unknown");
  });
});
