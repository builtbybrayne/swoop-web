// -----------------------------------------------------------------------------
// Handoff schema — focused coverage for the per-verdict reason-code narrowing
// and `.strict()` guarantees introduced by E.t1.
//
// The broad fixture round-trip lives in `fixtures.test.ts`; these cases cover
// the schema-as-code drift-catching ambitions (planning/03-exec-handoff-t1.md
// §Verification items 4–5).
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  DisqualifiedReasonCodeSchema,
  HANDOFF_NARRATIVE_TEXT_MAX,
  HandoffContactSchema,
  HandoffPayloadDisqualifiedSchema,
  HandoffPayloadInconclusiveSchema,
  HandoffPayloadQualifiedSchema,
  HandoffPayloadReferredOutSchema,
  HandoffPayloadSchema,
  HandoffVerdictSchema,
  InconclusiveReasonCodeSchema,
  QualifiedReasonCodeSchema,
  HandoffSubmitRequestSchema,
  ReferredOutReasonCodeSchema,
  type HandoffSubmitConsentGate,
} from "../handoff.js";
import { HandoffInputSchema } from "../tools.js";
import {
  SampleHandoffDisqualified,
  SampleHandoffInconclusive,
  SampleHandoffQualified,
  SampleHandoffReferredOut,
} from "../fixtures/index.js";

describe("HandoffVerdictSchema", () => {
  it("accepts the four canonical verdicts", () => {
    for (const v of [
      "qualified",
      "referred_out",
      "disqualified",
      "inconclusive",
    ] as const) {
      expect(HandoffVerdictSchema.parse(v)).toBe(v);
    }
  });

  it("rejects unknown verdicts", () => {
    expect(HandoffVerdictSchema.safeParse("maybe").success).toBe(false);
  });
});

describe("per-verdict reason code enums", () => {
  it("QualifiedReasonCodeSchema covers all six codes", () => {
    const codes = [
      "ready_booking_named_trip",
      "ready_comparing_shortlist",
      "budget_and_timeline_confirmed",
      "group_tour_intent",
      "bespoke_request",
      "qualified_other",
    ];
    for (const c of codes) {
      expect(QualifiedReasonCodeSchema.parse(c)).toBe(c);
    }
    expect(QualifiedReasonCodeSchema.safeParse("below_profit_floor").success).toBe(false);
  });

  it("ReferredOutReasonCodeSchema covers all four codes", () => {
    const codes = [
      "below_profit_floor",
      "out_of_region",
      "timing_outside_window",
      "referred_other",
    ];
    for (const c of codes) {
      expect(ReferredOutReasonCodeSchema.parse(c)).toBe(c);
    }
    expect(ReferredOutReasonCodeSchema.safeParse("qualified_other").success).toBe(false);
  });

  it("DisqualifiedReasonCodeSchema covers all four codes", () => {
    const codes = [
      "backpacker_no_budget",
      "off_brand_query",
      "proxy_to_claude",
      "disqualified_other",
    ];
    for (const c of codes) {
      expect(DisqualifiedReasonCodeSchema.parse(c)).toBe(c);
    }
    expect(DisqualifiedReasonCodeSchema.safeParse("ready_booking_named_trip").success).toBe(false);
  });

  it("InconclusiveReasonCodeSchema covers all seven codes", () => {
    const codes = [
      "low_engagement",
      "mixed_signals",
      "extended_no_convergence",
      "comparison_shopping",
      "off_offer_in_region",
      "drive_by",
      "inconclusive_other",
    ];
    for (const c of codes) {
      expect(InconclusiveReasonCodeSchema.parse(c)).toBe(c);
    }
    expect(InconclusiveReasonCodeSchema.safeParse("ready_booking_named_trip").success).toBe(false);
  });

  it("codes are distinct across verdicts (no shared code)", () => {
    const qualified = new Set(QualifiedReasonCodeSchema.options);
    const referred = new Set(ReferredOutReasonCodeSchema.options);
    const disq = new Set(DisqualifiedReasonCodeSchema.options);
    const inconc = new Set(InconclusiveReasonCodeSchema.options);

    for (const c of qualified) {
      expect(referred.has(c as never)).toBe(false);
      expect(disq.has(c as never)).toBe(false);
      expect(inconc.has(c as never)).toBe(false);
    }
    for (const c of referred) {
      expect(disq.has(c as never)).toBe(false);
      expect(inconc.has(c as never)).toBe(false);
    }
    for (const c of disq) {
      expect(inconc.has(c as never)).toBe(false);
    }
  });
});

describe("HandoffPayloadSchema round-trip per variant", () => {
  it("qualified variant parses via the per-verdict schema", () => {
    expect(HandoffPayloadQualifiedSchema.parse(SampleHandoffQualified)).toEqual(
      SampleHandoffQualified,
    );
  });

  it("referred_out variant parses via the per-verdict schema", () => {
    expect(HandoffPayloadReferredOutSchema.parse(SampleHandoffReferredOut)).toEqual(
      SampleHandoffReferredOut,
    );
  });

  it("disqualified variant parses via the per-verdict schema", () => {
    expect(HandoffPayloadDisqualifiedSchema.parse(SampleHandoffDisqualified)).toEqual(
      SampleHandoffDisqualified,
    );
  });

  it("inconclusive variant parses via the per-verdict schema", () => {
    expect(HandoffPayloadInconclusiveSchema.parse(SampleHandoffInconclusive)).toEqual(
      SampleHandoffInconclusive,
    );
  });
});

describe("HandoffPayloadSchema reject paths", () => {
  it("rejects a qualified payload carrying a referred_out code", () => {
    const bad = {
      ...SampleHandoffQualified,
      reason: { code: "below_profit_floor", text: "misrouted" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a referred_out payload carrying a disqualified code", () => {
    const bad = {
      ...SampleHandoffReferredOut,
      reason: { code: "proxy_to_claude", text: "misrouted" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a disqualified payload with a contact block (strict mode)", () => {
    const bad = {
      ...SampleHandoffDisqualified,
      contact: { name: "Sneaky", email: "sneaky@example.com" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an inconclusive payload with a contact block (strict mode)", () => {
    const bad = {
      ...SampleHandoffInconclusive,
      contact: { name: "Sneaky", email: "sneaky@example.com" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an inconclusive payload carrying a qualified code", () => {
    const bad = {
      ...SampleHandoffInconclusive,
      reason: { code: "ready_booking_named_trip", text: "misrouted" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty reason.text", () => {
    const bad = {
      ...SampleHandoffQualified,
      reason: { code: "ready_booking_named_trip", text: "" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown verdict", () => {
    const bad = {
      ...SampleHandoffQualified,
      verdict: "maybe",
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });
});

describe("HandoffSubmitConsentGate (type-level contract)", () => {
  it("accepts a gate object with both consent flags", () => {
    const gate: HandoffSubmitConsentGate = {
      conversationGranted: true,
      handoffGranted: true,
    };
    // Runtime smoke: the type exists and shape compiles. The runtime guard
    // lives in E.t2 — this test only proves the type stays alive.
    expect(gate.conversationGranted).toBe(true);
    expect(gate.handoffGranted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R3 — email-header injection vector. HandoffContactSchema string fields
// must reject CR / LF / control characters. (2026-04-30 review.)
// ---------------------------------------------------------------------------

describe("HandoffContactSchema R3 control-character rejection", () => {
  function cleanContact() {
    return {
      name: "Ada Ríos",
      email: "ada.rios@example.com",
      preferredMethod: "email" as const,
      phone: "+44 20 7946 0000",
      timeZoneHint: "Europe/London",
    };
  }

  it("accepts a clean contact (positive baseline)", () => {
    expect(HandoffContactSchema.parse(cleanContact())).toEqual(cleanContact());
  });

  it("rejects a name carrying CRLF (header-injection vector)", () => {
    const bad = { ...cleanContact(), name: "Foo\r\nBcc: attacker@example.com" };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a name carrying a bare LF", () => {
    const bad = { ...cleanContact(), name: "Foo\nBcc: attacker@example.com" };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a name carrying a bare CR", () => {
    const bad = { ...cleanContact(), name: "Foo\rextra" };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a phone carrying CRLF", () => {
    const bad = { ...cleanContact(), phone: "+44\r\nBcc: x@y.z" };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a timeZoneHint carrying CRLF", () => {
    const bad = { ...cleanContact(), timeZoneHint: "Europe/London\r\nfoo" };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an email carrying CRLF (defence-in-depth alongside .email())", () => {
    // Most CRLF strings already fail .email(); explicit regex makes the
    // intent unambiguous and survives any future loosening of .email().
    const bad = { ...cleanContact(), email: "ada@example.com\r\nBcc: x@y.z" };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R4 — length caps on visitor-supplied fields. Storage / DoS defence.
// (2026-04-30 review.)
// ---------------------------------------------------------------------------

describe("R4 length caps on contact fields, motivationAnchor, reason.text", () => {
  function cleanContact() {
    return {
      name: "Ada Ríos",
      email: "ada.rios@example.com",
      preferredMethod: "email" as const,
      phone: "+44 20 7946 0000",
      timeZoneHint: "Europe/London",
    };
  }

  it("rejects a contact name over 200 chars", () => {
    const bad = { ...cleanContact(), name: "x".repeat(201) };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a contact name at exactly 200 chars", () => {
    const ok = { ...cleanContact(), name: "x".repeat(200) };
    expect(HandoffContactSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects a contact phone over 200 chars", () => {
    const bad = { ...cleanContact(), phone: "1".repeat(201) };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a contact timeZoneHint over 200 chars", () => {
    const bad = { ...cleanContact(), timeZoneHint: "z".repeat(201) };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a contact email over 200 chars (long-local-part DoS)", () => {
    // 195 chars in local-part + "@a.io" = 200; +1 to push past.
    const overLong = `${"a".repeat(196)}@a.io`;
    const bad = { ...cleanContact(), email: overLong };
    expect(HandoffContactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a payload whose motivationAnchor is over 2_000 chars", () => {
    const bad = {
      ...SampleHandoffQualified,
      motivationAnchor: "m".repeat(2_001),
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a payload whose motivationAnchor is exactly 2_000 chars", () => {
    const ok = {
      ...SampleHandoffQualified,
      motivationAnchor: "m".repeat(2_000),
    };
    expect(HandoffPayloadSchema.safeParse(ok).success).toBe(true);
  });

  // reason.text carries the agent's rich specialistSummary verbatim, so its
  // budget is the shared narrative constant — pinned via the constant (not a
  // literal) so schema and test can't drift apart again. The original
  // 500-char literal predated the specialistSummary routing and rejected
  // organic agent summaries at the visitor's submit (observed live
  // 2026-06-11).
  it("rejects a payload whose reason.text is over the narrative budget", () => {
    const bad = {
      ...SampleHandoffQualified,
      reason: {
        code: "ready_booking_named_trip",
        text: "r".repeat(HANDOFF_NARRATIVE_TEXT_MAX + 1),
      },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a payload whose reason.text is exactly the narrative budget", () => {
    const ok = {
      ...SampleHandoffQualified,
      reason: {
        code: "ready_booking_named_trip",
        text: "r".repeat(HANDOFF_NARRATIVE_TEXT_MAX),
      },
    };
    expect(HandoffPayloadSchema.safeParse(ok).success).toBe(true);
  });

  it("narrative budget comfortably fits a rich multi-section specialistSummary (>500 chars)", () => {
    // Regression pin for the 2026-06-11 live failure: a ~700-char organic
    // summary must parse. If someone lowers the budget back under realistic
    // Sonnet output, this fails before a visitor loses a handoff.
    const organicLengthSummary = "s".repeat(700);
    const ok = {
      ...SampleHandoffQualified,
      reason: { code: "ready_booking_named_trip", text: organicLengthSummary },
    };
    expect(HandoffPayloadSchema.safeParse(ok).success).toBe(true);
  });

  it("clean canonical fixture still parses (positive baseline)", () => {
    expect(HandoffPayloadSchema.safeParse(SampleHandoffQualified).success).toBe(true);
    expect(HandoffPayloadSchema.safeParse(SampleHandoffReferredOut).success).toBe(true);
    expect(HandoffPayloadSchema.safeParse(SampleHandoffDisqualified).success).toBe(true);
    expect(HandoffPayloadSchema.safeParse(SampleHandoffInconclusive).success).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Tool-boundary length enforcement (tools.ts HandoffInputSchema).
//
// The narrative budget must reject at the AGENT'S tool call — where Sonnet
// reads the error and rewrites shorter — never first at the visitor's
// `/handoff/submit`. These pin that the tool input and the wire/payload
// schemas share the same constants, closing the 2026-06-11 drift where the
// tool input was uncapped and the wire cap was 500.
// -----------------------------------------------------------------------------

describe("HandoffInputSchema length budgets (agent tool boundary)", () => {
  const baseArgs = {
    verdict: "qualified",
    reasonCode: "ready_booking_named_trip",
  } as const;

  it("rejects specialistSummary over the narrative budget at the tool boundary", () => {
    const bad = {
      ...baseArgs,
      specialistSummary: "s".repeat(HANDOFF_NARRATIVE_TEXT_MAX + 1),
    };
    expect(HandoffInputSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts specialistSummary at exactly the narrative budget", () => {
    const ok = {
      ...baseArgs,
      specialistSummary: "s".repeat(HANDOFF_NARRATIVE_TEXT_MAX),
    };
    expect(HandoffInputSchema.safeParse(ok).success).toBe(true);
  });

  it("tool-boundary budget equals the wire budget — over-budget can never first surface at submit", () => {
    // The guarantee is shared-constant identity: a summary the tool accepts,
    // the wire accepts. Pin the submit request at the same boundary value.
    const submitOk = {
      sessionId: "sess_1",
      verdict: "qualified",
      reasonCode: "ready_booking_named_trip",
      reasonText: "s".repeat(HANDOFF_NARRATIVE_TEXT_MAX),
      contact: { name: "A", email: "a@example.com" },
      consent: {
        handoffGranted: true,
        handoffTimestamp: "2026-06-11T12:00:00.000Z",
      },
    };
    expect(HandoffSubmitRequestSchema.safeParse(submitOk).success).toBe(true);
    const submitBad = {
      ...submitOk,
      reasonText: "s".repeat(HANDOFF_NARRATIVE_TEXT_MAX + 1),
    };
    expect(HandoffSubmitRequestSchema.safeParse(submitBad).success).toBe(false);
  });
});
