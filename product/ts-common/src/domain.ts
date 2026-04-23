// -----------------------------------------------------------------------------
// Domain entities — core content types Puma's discovery conversation references.
//
// These shapes are PLACEHOLDER-PLAUSIBLE. The Friday 24 Apr data-ontology session
// settles the real Patagonia ontology (Trip / Tour / Region / Accommodation).
// This stub reserves the locations and gives downstream chunks validated
// fixtures to mock against during parallel fan-out.
//
// At minimum every entity has { id, slug, title, summary }. A couple of
// representative fields per type are added so fixtures feel real.
//
// See planning/02-impl-foundations.md §2.2 and planning/03-exec-foundations-t2.md.
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// Image
//
// `annotations` is an open-ended record of tag strings keyed by category
// (e.g. { wildlife: ["puma"], mood: ["dramatic"] }). Structure refined during
// chunk C §2.6a — for now it's loose but schema-valid.
// -----------------------------------------------------------------------------

export const ImageSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  url: z.string().url(),
  altText: z.string(),
  photographerCredit: z.string().optional(),
  annotations: z.record(z.string(), z.array(z.string())).optional(),
});
export type Image = z.infer<typeof ImageSchema>;

// -----------------------------------------------------------------------------
// Region
// -----------------------------------------------------------------------------

export const RegionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  country: z.string(),
  heroImageUrl: z.string().url().optional(),
  signatureExperiences: z.array(z.string()).default([]),
});
export type Region = z.infer<typeof RegionSchema>;

// -----------------------------------------------------------------------------
// Trip
// -----------------------------------------------------------------------------

export const TripSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  heroImageUrl: z.string().url().optional(),
  durationDays: z.number().int().positive(),
  regionSlugs: z.array(z.string()).default([]),
  startingPriceGbp: z.number().int().nonnegative().optional(),
  highlights: z.array(z.string()).default([]),
});
export type Trip = z.infer<typeof TripSchema>;

// -----------------------------------------------------------------------------
// Tour — first-class per Luke's 20 Apr strategic priority; NOT a trip variant.
// -----------------------------------------------------------------------------

export const TourSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  heroImageUrl: z.string().url().optional(),
  durationDays: z.number().int().positive(),
  regionSlugs: z.array(z.string()).default([]),
  startingPriceGbp: z.number().int().nonnegative().optional(),
  groupSizeMax: z.number().int().positive().optional(),
  departureMonths: z.array(z.string()).default([]),
});
export type Tour = z.infer<typeof TourSchema>;

// -----------------------------------------------------------------------------
// Story — editorial/narrative content; used for inspiration surfaces.
// -----------------------------------------------------------------------------

export const StorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  heroImageUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  publishedAt: z.string().datetime().optional(),
});
export type Story = z.infer<typeof StorySchema>;
