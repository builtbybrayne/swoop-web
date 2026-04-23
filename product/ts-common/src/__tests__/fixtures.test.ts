// -----------------------------------------------------------------------------
// Fixture round-trip smoke test.
//
// The single test that ships with @swoop/common: parse every sample fixture
// against its Zod schema. Catches schema/fixture drift as a compile-time + run-
// time check. Any schema edit that breaks a fixture fails this test.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  EventSchema,
  HandoffPayloadSchema,
  ImageSchema,
  RegionSchema,
  SessionStateSchema,
  StorySchema,
  TourSchema,
  TripSchema,
} from "../index.js";

import {
  SampleEvent,
  SampleHandoff,
  SampleImage,
  SampleRegion,
  SampleSession,
  SampleStory,
  SampleTour,
  SampleTrip,
} from "../fixtures/index.js";

describe("fixtures round-trip through their Zod schemas", () => {
  it("SampleTrip parses against TripSchema", () => {
    expect(TripSchema.parse(SampleTrip)).toEqual(SampleTrip);
  });

  it("SampleTour parses against TourSchema", () => {
    expect(TourSchema.parse(SampleTour)).toEqual(SampleTour);
  });

  it("SampleRegion parses against RegionSchema", () => {
    expect(RegionSchema.parse(SampleRegion)).toEqual(SampleRegion);
  });

  it("SampleStory parses against StorySchema", () => {
    expect(StorySchema.parse(SampleStory)).toEqual(SampleStory);
  });

  it("SampleImage parses against ImageSchema", () => {
    expect(ImageSchema.parse(SampleImage)).toEqual(SampleImage);
  });

  it("SampleSession parses against SessionStateSchema", () => {
    expect(SessionStateSchema.parse(SampleSession)).toEqual(SampleSession);
  });

  it("SampleHandoff parses against HandoffPayloadSchema", () => {
    expect(HandoffPayloadSchema.parse(SampleHandoff)).toEqual(SampleHandoff);
  });

  it("SampleEvent parses against EventSchema", () => {
    expect(EventSchema.parse(SampleEvent)).toEqual(SampleEvent);
  });
});
