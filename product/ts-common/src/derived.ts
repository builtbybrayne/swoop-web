// -----------------------------------------------------------------------------
// Derived entity Zod schemas — the five job-shaped tables.
//
// Per planning/03-exec-c-t2.md §"Schema design — `ts-common` Zod" + decision
// C.30 (customer_story persona shape) + decision C.25 (five conversational
// jobs). Mirror the Postgres column lists in product/connector/migrations/
// 003_derived_tables.sql.
//
// Each derived entity has TWO schemas:
//
//   `<Entity>Schema` — the FULL row shape, including server-internal fields
//   (source_provenance, content_hash, embeddings, tsv). Useful for ETL +
//   tests; not what the agent ever sees.
//
//   `<Entity>PublicSchema` — the TOOL-FACING projection. Strips internals;
//   keeps the fields a tool's caller (orchestrator → Sonnet → widget) needs.
//   Tool output schemas in `tools.ts` compose around the public projection.
//
// `vector(1024)` columns (Voyage-3 dimensionality, per decision C.18) are
// server-side only — never part of any tool's I/O. They appear here so ETL
// writes can validate against the same shape; tool outputs strip them.
//
// Pattern mirrors the page-as-hub philosophy (decision C.16): the public
// projection is "what the visitor's journey needs"; the full schema is "what
// the data layer carries to support that journey".
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

/**
 * Embedding column shape. Used for ETL-side validation only. Stripped from
 * every public projection. Locked to Voyage-3 (1024-dimensional) per
 * decision C.18; rejects NaN / Infinity via `.finite()`.
 */
const EmbeddingSchema = z.array(z.number().finite()).length(1024);

/**
 * tsvector column. Postgres serialises this to TEXT on the wire. We store the
 * server's serialised form as opaque TEXT for ETL round-tripping; tools never
 * see it.
 */
const TsvectorSchema = z.string();

/**
 * Image companion record returned alongside any derived row that surfaces
 * imagery (per decision C.16, page-as-hub). Lean version of the full
 * `image` row — what a widget needs to render the visual without extra
 * round-trips.
 */
export const DerivedImageSchema = z
  .object({
    id: z.number().int().positive(),
    canonicalUrl: z.string().url(),
    altText: z.string().nullable(),
    description: z.string().nullable().optional(),
    subjectTags: z.array(z.string()).default([]),
    moodTags: z.array(z.string()).default([]),
    regionTags: z.array(z.string()).default([]),
  })
  .strict();
export type DerivedImage = z.infer<typeof DerivedImageSchema>;

// -----------------------------------------------------------------------------
// InspirePassage — Inspire job
// -----------------------------------------------------------------------------

export const InspirePassageProvenanceSchema = z.enum([
  "page_intro",
  "page_summary",
  "page_contentblock",
  "blog_chunk",
  "chunk",
]);
export type InspirePassageProvenance = z.infer<typeof InspirePassageProvenanceSchema>;

export const InspirePassageSchema = z
  .object({
    id: z.string().uuid(),
    sourceProvenance: InspirePassageProvenanceSchema,
    sourceId: z.string(),
    text: z.string().min(1),
    canonicalUrl: z.string().url(),
    ntagIds: z.array(z.number().int().positive()).default([]),
    region: z.string().nullable().optional(),
    mood: z.string().nullable().optional(),
    imageId: z.number().int().positive().nullable().optional(),
    embedding: EmbeddingSchema.nullable().optional(),
    tsv: TsvectorSchema.nullable().optional(),
    contentHash: z.string().min(1),
  })
  .strict();
export type InspirePassage = z.infer<typeof InspirePassageSchema>;

export const InspirePassagePublicSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1),
    canonicalUrl: z.string().url(),
    region: z.string().nullable().optional(),
    mood: z.string().nullable().optional(),
    image: DerivedImageSchema.nullable().optional(),
  })
  .strict();
export type InspirePassagePublic = z.infer<typeof InspirePassagePublicSchema>;

// -----------------------------------------------------------------------------
// CustomerStory — Mirror job (conditional on C.26)
//
// Per decision C.30: persona-shaped retrieval is the only matching mechanism.
// `personaSummary` is what the embedding is built from; `text` is what the
// agent SHOWS the visitor.
// -----------------------------------------------------------------------------

export const CustomerStoryProvenanceSchema = z.enum([
  "customerreview",
  "customertip",
  "blog_first_person",
]);
export type CustomerStoryProvenance = z.infer<typeof CustomerStoryProvenanceSchema>;

export const CustomerStorySchema = z
  .object({
    id: z.string().uuid(),
    sourceProvenance: CustomerStoryProvenanceSchema,
    sourceId: z.string(),
    text: z.string().min(1),
    canonicalUrl: z.string().url().nullable().optional(),
    region: z.string().nullable().optional(),
    personaSummary: z.string().min(1),
    personaEmbedding: EmbeddingSchema.nullable().optional(),
    imageId: z.number().int().positive().nullable().optional(),
    tsv: TsvectorSchema.nullable().optional(),
    contentHash: z.string().min(1),
  })
  .strict();
export type CustomerStory = z.infer<typeof CustomerStorySchema>;

export const CustomerStoryPublicSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1),
    personaSummary: z.string().min(1),
    canonicalUrl: z.string().url().nullable().optional(),
    region: z.string().nullable().optional(),
    image: DerivedImageSchema.nullable().optional(),
  })
  .strict();
export type CustomerStoryPublic = z.infer<typeof CustomerStoryPublicSchema>;

// -----------------------------------------------------------------------------
// TrustProof — Reassure job
// -----------------------------------------------------------------------------

export const TrustProofProvenanceSchema = z.enum([
  "swoop_page",
  "partner_page",
  "blog_b_corp",
  "pressreview",
  "external_certification",
]);
export type TrustProofProvenance = z.infer<typeof TrustProofProvenanceSchema>;

export const TrustProofTopicSchema = z.enum([
  "sustainability",
  "b-corp",
  "expertise",
  "conservation",
  "safety",
  "guides",
  "satisfaction",
  "other",
]);
export type TrustProofTopic = z.infer<typeof TrustProofTopicSchema>;

export const TrustProofSchema = z
  .object({
    id: z.string().uuid(),
    sourceProvenance: TrustProofProvenanceSchema,
    sourceId: z.string(),
    topic: TrustProofTopicSchema,
    claim: z.string().min(1),
    evidence: z.string().min(1),
    canonicalUrl: z.string().url().nullable().optional(),
    embedding: EmbeddingSchema.nullable().optional(),
    tsv: TsvectorSchema.nullable().optional(),
    contentHash: z.string().min(1),
  })
  .strict();
export type TrustProof = z.infer<typeof TrustProofSchema>;

export const TrustProofPublicSchema = z
  .object({
    id: z.string().uuid(),
    topic: TrustProofTopicSchema,
    claim: z.string().min(1),
    evidence: z.string().min(1),
    canonicalUrl: z.string().url().nullable().optional(),
  })
  .strict();
export type TrustProofPublic = z.infer<typeof TrustProofPublicSchema>;

// -----------------------------------------------------------------------------
// InformChunk — Inform job
// -----------------------------------------------------------------------------

export const InformChunkProvenanceSchema = z.enum([
  "faq",
  "swoop_practical",
  "guidebook_practical",
  "month_page",
  "blog_practical",
  "trip_prose",
]);
export type InformChunkProvenance = z.infer<typeof InformChunkProvenanceSchema>;

export const InformChunkSchema = z
  .object({
    id: z.string().uuid(),
    sourceProvenance: InformChunkProvenanceSchema,
    sourceId: z.string(),
    question: z.string().nullable().optional(),
    text: z.string().min(1),
    canonicalUrl: z.string().url().nullable().optional(),
    topicTags: z.array(z.string()).default([]),
    embedding: EmbeddingSchema.nullable().optional(),
    tsv: TsvectorSchema.nullable().optional(),
    contentHash: z.string().min(1),
  })
  .strict();
export type InformChunk = z.infer<typeof InformChunkSchema>;

export const InformChunkPublicSchema = z
  .object({
    id: z.string().uuid(),
    question: z.string().nullable().optional(),
    text: z.string().min(1),
    canonicalUrl: z.string().url().nullable().optional(),
    topicTags: z.array(z.string()).default([]),
  })
  .strict();
export type InformChunkPublic = z.infer<typeof InformChunkPublicSchema>;

// -----------------------------------------------------------------------------
// TripCard — Propose options job (full ETL row only).
//
// Public projection lives in `tools.ts` as a `ProposalCardPublicSchema` variant
// (discriminated union over `trip | tour | hotel | region_base`). Per crosscut
// plan `03-exec-crosscut-find-options-polymorphism.md` v1 tranche
// (decisions C.48–C.51): the Propose-options conversational moment ranges
// across proposal types; the public schema discriminates so each card type
// renders in its own visual register.
//
// The ETL shape is trip-table-shaped (headline / vibeLine / region / duration
// / price / image / canonicalUrl) — what `composeTripCard` writes to the
// `trip_card` Postgres table. Tour / hotel / region_base ETL shapes belong to
// future tranches (v2 / v3) and will land as their own derived-table rows
// when the corresponding source tables get populated.
// -----------------------------------------------------------------------------

export const TripCardSchema = z
  .object({
    id: z.number().int().positive(),
    slug: z.string().min(1).nullable().optional(),
    headline: z.string().min(1),
    vibeLine: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    durationDays: z.number().int().positive().nullable().optional(),
    fromPrice: z.number().nonnegative().nullable().optional(),
    currencyCode: z.string().length(3).nullable().optional(),
    imageId: z.number().int().positive().nullable().optional(),
    accommodationStyle: z.string().nullable().optional(),
    activityTags: z.array(z.string()).default([]),
    canonicalUrl: z.string().url(),
    embedding: EmbeddingSchema.nullable().optional(),
    tsv: TsvectorSchema.nullable().optional(),
    contentHash: z.string().min(1),
  })
  .strict();
export type TripCard = z.infer<typeof TripCardSchema>;
