// -----------------------------------------------------------------------------
// Route request schemas — focused coverage for the wire-shape contracts that
// UI and orchestrator share via `@swoop/common`.
//
// Today's load-bearing case is R4-server (2026-04-30 review): the per-message
// length cap on `ChatRequestSchema.message`. Boundary + over-cap cases live
// here so the contract is enforced at the schema layer regardless of which
// route handler is wired against it.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  CHAT_MESSAGE_MAX,
  ChatRequestSchema,
  ClientTimeSchema,
} from "../routes.js";

describe("ClientTimeSchema", () => {
  it("accepts a valid clientTime with UTC offset", () => {
    const result = ClientTimeSchema.safeParse({
      iso: "2026-06-10T17:42:01+01:00",
      timeZone: "Europe/London",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid clientTime in UTC (Z suffix)", () => {
    const result = ClientTimeSchema.safeParse({
      iso: "2026-06-10T16:42:01Z",
      timeZone: "UTC",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bare ISO date with no offset", () => {
    const result = ClientTimeSchema.safeParse({
      iso: "2026-06-10T17:42:01",
      timeZone: "Europe/London",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty timeZone", () => {
    const result = ClientTimeSchema.safeParse({
      iso: "2026-06-10T16:42:01Z",
      timeZone: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a timeZone over 64 chars", () => {
    const result = ClientTimeSchema.safeParse({
      iso: "2026-06-10T16:42:01Z",
      timeZone: "A".repeat(65),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields on clientTime (strict)", () => {
    const result = ClientTimeSchema.safeParse({
      iso: "2026-06-10T16:42:01Z",
      timeZone: "UTC",
      extra: "no",
    });
    expect(result.success).toBe(false);
  });
});

describe("ChatRequestSchema", () => {
  it("accepts a normal message body", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "hi",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a message at exactly CHAT_MESSAGE_MAX", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "a".repeat(CHAT_MESSAGE_MAX),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a message one over CHAT_MESSAGE_MAX (R4-server)", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "a".repeat(CHAT_MESSAGE_MAX + 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "message");
      expect(issue).toBeDefined();
    }
  });

  it("rejects an empty message", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown field via .strict()", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "hi",
      sneaky: 1,
    });
    expect(result.success).toBe(false);
  });

  // B.t12 — clientTime is optional; malformed must be rejected.
  it("accepts a body with a valid clientTime", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "hi",
      clientTime: { iso: "2026-06-10T16:42:01Z", timeZone: "Europe/London" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientTime?.timeZone).toBe("Europe/London");
    }
  });

  it("accepts a body without clientTime (backward-compat)", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "hi",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientTime).toBeUndefined();
    }
  });

  it("rejects a body with a malformed clientTime.iso (no offset)", () => {
    const result = ChatRequestSchema.safeParse({
      sessionId: "abc",
      message: "hi",
      clientTime: { iso: "2026-06-10T16:42:01", timeZone: "UTC" },
    });
    expect(result.success).toBe(false);
  });
});
