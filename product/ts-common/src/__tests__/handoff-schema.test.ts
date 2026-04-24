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
  HandoffPayloadDisqualifiedSchema,
  HandoffPayloadQualifiedSchema,
  HandoffPayloadReferredOutSchema,
  HandoffPayloadSchema,
  HandoffVerdictSchema,
  QualifiedReasonCodeSchema,
  ReferredOutReasonCodeSchema,
  type HandoffSubmitConsentGate,
} from "../handoff.js";
import {
  SampleHandoffDisqualified,
  SampleHandoffQualified,
  SampleHandoffReferredOut,
} from "../fixtures/index.js";

describe("HandoffVerdictSchema", () => {
  it("accepts the three canonical verdicts", () => {
    for (const v of ["qualified", "referred_out", "disqualified"] as const) {
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

  it("codes are distinct across verdicts (no shared code)", () => {
    const qualified = new Set(QualifiedReasonCodeSchema.options);
    const referred = new Set(ReferredOutReasonCodeSchema.options);
    const disq = new Set(DisqualifiedReasonCodeSchema.options);

    for (const c of qualified) {
      expect(referred.has(c as never)).toBe(false);
      expect(disq.has(c as never)).toBe(false);
    }
    for (const c of referred) {
      expect(disq.has(c as never)).toBe(false);
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
