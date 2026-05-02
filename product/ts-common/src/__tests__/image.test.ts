// -----------------------------------------------------------------------------
// Tests for @swoop/common/image — canonical URL + imgix + page-as-hub helpers.
//
// Covers C.t5 verification matrix:
//   - imgixUrl construction (default + custom params).
//   - canonicalUrl with override_url present + non-empty.
//   - canonicalUrl with override_url absent (alias fallback).
//   - canonicalUrl with override_url empty string (alias fallback per SQL parity).
//   - canonicalUrl with both null/empty (returns null).
//   - pageUrl wrapper (composes host + path; null when canonical absent).
//   - resolveImageSet trip with image_trip set (direct-join wins).
//   - resolveImageSet trip with empty direct join + page-attached fallback.
//   - resolveImageSet hotel/page-only entity (page-attached path).
//   - resolveImageSet location with no images (empty array).
//   - resolveImageSet short-circuit: direct wins even when page also has
//     images (decision C.16, HITL Q5 contract).
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  canonicalUrl,
  DEFAULT_IMGIX_PARAMS,
  IMGIX_HOST,
  imgixUrl,
  pageUrl,
  resolveImageSet,
  SWOOP_PATAGONIA_HOST,
  type PageImageLookup,
} from "../image.js";

// ---------------------------------------------------------------------------
// canonicalUrl
// ---------------------------------------------------------------------------

describe("canonicalUrl", () => {
  it("returns override_url when present and non-empty (W-Trek shape)", () => {
    expect(
      canonicalUrl({
        override_url: "chile/torres-del-paine/hiking/w-trek/original",
        alias: "w-trek-torres-del-paine",
      }),
    ).toBe("chile/torres-del-paine/hiking/w-trek/original");
  });

  it("falls back to alias when override_url is null", () => {
    expect(
      canonicalUrl({
        override_url: null,
        alias: "about-swoop",
      }),
    ).toBe("about-swoop");
  });

  it("falls back to alias when override_url is undefined", () => {
    expect(
      canonicalUrl({
        alias: "about-swoop",
      }),
    ).toBe("about-swoop");
  });

  it("treats empty-string override_url as absent (SQL parity)", () => {
    // Source dump carries `''` rather than NULL for some rows; the SQL
    // canonical_url() function treats both as absent. Same here.
    expect(
      canonicalUrl({
        override_url: "",
        alias: "fallback-alias",
      }),
    ).toBe("fallback-alias");
  });

  it("returns null when both override_url and alias are absent", () => {
    expect(
      canonicalUrl({
        override_url: null,
        alias: null,
      }),
    ).toBeNull();
  });

  it("returns null when both override_url and alias are empty strings", () => {
    expect(
      canonicalUrl({
        override_url: "",
        alias: "",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pageUrl
// ---------------------------------------------------------------------------

describe("pageUrl", () => {
  it("composes the full URL using SWOOP_PATAGONIA_HOST", () => {
    expect(
      pageUrl({
        override_url: "chile/torres-del-paine/hiking/w-trek/original",
        alias: "w-trek-torres-del-paine",
      }),
    ).toBe(
      "https://www.swoop-patagonia.com/chile/torres-del-paine/hiking/w-trek/original",
    );
  });

  it("uses alias when override_url is absent", () => {
    expect(
      pageUrl({
        override_url: null,
        alias: "about-swoop",
      }),
    ).toBe("https://www.swoop-patagonia.com/about-swoop");
  });

  it("returns null when canonicalUrl would return null", () => {
    expect(pageUrl({ override_url: null, alias: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// imgixUrl
// ---------------------------------------------------------------------------

describe("imgixUrl", () => {
  it("composes the URL with default render params", () => {
    expect(imgixUrl("torres-del-paine-sunrise.jpg")).toBe(
      `${IMGIX_HOST}/torres-del-paine-sunrise.jpg?${DEFAULT_IMGIX_PARAMS}`,
    );
  });

  it("default params include auto, fit=crop, q=80", () => {
    const url = imgixUrl("hero.jpg");
    expect(url).toContain("auto=format,enhance,compress");
    expect(url).toContain("fit=crop");
    expect(url).toContain("q=80");
  });

  it("uses caller-supplied params when provided", () => {
    expect(imgixUrl("hero.jpg", "auto=format&w=1600&h=900")).toBe(
      `${IMGIX_HOST}/hero.jpg?auto=format&w=1600&h=900`,
    );
  });

  it("supplied params completely replace defaults (no merge)", () => {
    // Documented contract: `params` is opaque; the helper does no parsing
    // or merging. If a caller wants both defaults + overrides they compose
    // upstream.
    const url = imgixUrl("hero.jpg", "w=400");
    expect(url).toBe(`${IMGIX_HOST}/hero.jpg?w=400`);
    expect(url).not.toContain("q=80");
  });
});

// ---------------------------------------------------------------------------
// resolveImageSet
// ---------------------------------------------------------------------------

describe("resolveImageSet", () => {
  it("returns the direct-join set when present (trip with image_trip)", () => {
    const pageImages: PageImageLookup = new Map([[3, [9001, 9002]]]);
    expect(
      resolveImageSet({ directImageIds: [101, 102], pageId: 3 }, pageImages),
    ).toEqual([101, 102]);
  });

  it("falls back to page-attached when direct join is empty (hotel-style)", () => {
    // Hotels have ONLY the page path per 2026-04-29 discovery — no
    // image_hotel table. directImageIds is empty by construction.
    const pageImages: PageImageLookup = new Map([[42, [501, 502, 503]]]);
    expect(
      resolveImageSet({ directImageIds: [], pageId: 42 }, pageImages),
    ).toEqual([501, 502, 503]);
  });

  it("returns empty when neither direct nor page-attached resolves", () => {
    // Location with no images at all.
    const pageImages: PageImageLookup = new Map();
    expect(
      resolveImageSet({ directImageIds: [], pageId: null }, pageImages),
    ).toEqual([]);
  });

  it("returns empty when pageId is set but page has no images", () => {
    const pageImages: PageImageLookup = new Map([[42, []]]);
    expect(
      resolveImageSet({ directImageIds: [], pageId: 42 }, pageImages),
    ).toEqual([]);
  });

  it("returns empty when pageId is set but the lookup has no entry for it", () => {
    const pageImages: PageImageLookup = new Map([[1, [100]]]);
    expect(
      resolveImageSet({ directImageIds: [], pageId: 999 }, pageImages),
    ).toEqual([]);
  });

  it("short-circuits: direct wins even when page-attached also has images (decision C.16, HITL Q5)", () => {
    // The 2026-04-29 discovery: trips have BOTH paths. The helper returns
    // the direct-join set and stops; page-attached images never get
    // unioned in. If a future use case wants the union, it's a separate
    // helper, not an option flag here.
    const pageImages: PageImageLookup = new Map([[3, [9001, 9002, 9003]]]);
    const result = resolveImageSet(
      { directImageIds: [101], pageId: 3 },
      pageImages,
    );
    expect(result).toEqual([101]);
    expect(result).not.toContain(9001);
  });

  it("returns the same array reference when direct-join wins (no copy)", () => {
    // Pure-function contract: no defensive copying. Callers that need to
    // mutate should clone upstream.
    const pageImages: PageImageLookup = new Map();
    const direct = [1, 2, 3];
    expect(resolveImageSet({ directImageIds: direct, pageId: null }, pageImages)).toBe(
      direct,
    );
  });
});

// ---------------------------------------------------------------------------
// Constants — basic shape sanity
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("IMGIX_HOST is the swoop-patagonia tenant", () => {
    expect(IMGIX_HOST).toBe("https://swoop-patagonia.imgix.net");
  });

  it("SWOOP_PATAGONIA_HOST has trailing slash for direct concatenation", () => {
    expect(SWOOP_PATAGONIA_HOST).toMatch(/\/$/);
  });

  it("DEFAULT_IMGIX_PARAMS encodes the C.41 baseline", () => {
    expect(DEFAULT_IMGIX_PARAMS).toBe(
      "auto=format,enhance,compress&fit=crop&q=80",
    );
  });
});
