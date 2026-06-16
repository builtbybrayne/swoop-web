// -----------------------------------------------------------------------------
// SessionState staff/mode fields — staff-auth task.
//
// Verifies the additive schema changes are backward-compatible:
//   - Sessions without staff/mode fields still parse (existing sessions).
//   - staff defaults to false when absent.
//   - mode defaults to 'conversation' when absent.
//   - Invalid mode values are rejected.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { SessionStateSchema } from "../session.js";

/** Minimal valid session state (all required fields, no staff fields). */
const BASE_SESSION = {
  sessionId: "sess-1",
  createdAt: "2026-06-16T10:00:00.000Z",
  updatedAt: "2026-06-16T10:00:00.000Z",
  conversationHistory: [],
  triage: { verdict: "none" },
  wishlist: { items: [] },
  consent: {
    conversation: { granted: false, timestamp: "2026-06-16T10:00:00.000Z" },
    handoff: { granted: false, timestamp: "2026-06-16T10:00:00.000Z" },
  },
  metadata: {},
  seenItems: { trips: [], tours: [] },
};

describe("SessionStateSchema — staff/mode fields (staff-auth task)", () => {
  it("parses a session without staff/mode (backward-compat: old sessions)", () => {
    const result = SessionStateSchema.safeParse(BASE_SESSION);
    expect(result.success).toBe(true);
    if (result.success) {
      // Defaults kick in.
      expect(result.data.staff).toBe(false);
      expect(result.data.mode).toBe("conversation");
    }
  });

  it("parses staff:true, mode:'conversation'", () => {
    const result = SessionStateSchema.safeParse({
      ...BASE_SESSION,
      staff: true,
      mode: "conversation",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.staff).toBe(true);
      expect(result.data.mode).toBe("conversation");
    }
  });

  it("parses staff:true, mode:'memory'", () => {
    const result = SessionStateSchema.safeParse({
      ...BASE_SESSION,
      staff: true,
      mode: "memory",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.staff).toBe(true);
      expect(result.data.mode).toBe("memory");
    }
  });

  it("rejects an invalid mode value", () => {
    const result = SessionStateSchema.safeParse({
      ...BASE_SESSION,
      mode: "invalid-mode",
    });
    expect(result.success).toBe(false);
  });

  it("staff defaults to false when absent", () => {
    const { staff: _s, ...noStaff } = { ...BASE_SESSION, staff: false };
    const result = SessionStateSchema.safeParse(noStaff);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.staff).toBe(false);
    }
  });

  it("mode defaults to 'conversation' when absent", () => {
    const result = SessionStateSchema.safeParse(BASE_SESSION);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("conversation");
    }
  });
});
