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
} from "../routes.js";

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
});
