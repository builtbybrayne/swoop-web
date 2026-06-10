// product/ui/src/widgets/__tests__/text-utils.test.ts
//
// Pure-helper coverage for the render-layer text utilities: entity decode
// passthrough cases and the anchor-copy truncation added for the
// "Find out more about {sourceTitle} →" pattern (retrieval-provenance plan
// §1.4 / visual-channel plan §2.2).

import { describe, it, expect } from "vitest";
import { decodeHtmlEntities, truncateText } from "../text-utils";

describe("decodeHtmlEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("Glaciers &amp; fjords&#8217;s light")).toBe(
      "Glaciers & fjords’s light",
    );
  });

  it("returns empty string for null/undefined", () => {
    expect(decodeHtmlEntities(null)).toBe("");
    expect(decodeHtmlEntities(undefined)).toBe("");
  });
});

describe("truncateText", () => {
  it("returns short strings unchanged", () => {
    expect(truncateText("Torres del Paine", 60)).toBe("Torres del Paine");
  });

  it("returns strings exactly at the cap unchanged", () => {
    const exact = "x".repeat(60);
    expect(truncateText(exact, 60)).toBe(exact);
  });

  it("truncates at a word boundary and appends an ellipsis", () => {
    const long =
      "The Complete Guide to Trekking Torres del Paine National Park in Chile";
    const out = truncateText(long, 60);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(61); // 60 + ellipsis
    // Cut lands on a word boundary, not mid-word.
    expect(out).toBe(
      "The Complete Guide to Trekking Torres del Paine National…",
    );
  });

  it("hard-cuts a single unbroken word rather than truncating to nothing", () => {
    const word = "a".repeat(80);
    const out = truncateText(word, 60);
    expect(out).toBe(`${"a".repeat(60)}…`);
  });

  it("trims surrounding whitespace before measuring", () => {
    expect(truncateText("  Torres del Paine  ", 60)).toBe("Torres del Paine");
  });

  it("defaults to a 60-char cap", () => {
    const long = `${"word ".repeat(20)}end`; // > 60 chars
    expect(truncateText(long).endsWith("…")).toBe(true);
  });
});
