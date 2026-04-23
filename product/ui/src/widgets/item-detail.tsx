// product/ui/src/widgets/item-detail.tsx
//
// Renders the output of the `get_detail` tool. Hero image, title, summary,
// an attribute table (duration / regions / activities / budget band) and
// a gallery strip.
//
// The tool's output schema intentionally leaves `record` as a loose
// `Record<string, unknown>` (ts-common/src/tools.ts) so chunk C can shape
// the payload per entity type without a cross-package coupling. We validate
// the outer envelope with `GetDetailOutputSchema`, then attempt to narrow
// the `record` into a per-entity union here. If narrowing fails, we still
// render what we can (title / summary / hero) rather than bail — the shape
// will firm up in chunk C Tier 2.

import { z } from "zod";
import {
  GetDetailOutputSchema,
  TripSchema,
  TourSchema,
  RegionSchema,
  StorySchema,
} from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { ImageBlock, AttributeTable, CtaButton } from "../shared";
import type { AttributeRow } from "../shared";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

/**
 * Loose extension schema that covers fields chunk C's connector is expected
 * to emit for richer detail views: gallery images, activity list, budget
 * band, public URL. Everything optional so the widget degrades gracefully
 * if the connector doesn't provide them yet.
 */
const DetailRecordSchema = z
  .object({
    id: z.string().optional(),
    slug: z.string().optional(),
    title: z.string(),
    summary: z.string(),
    heroImageUrl: z.string().url().optional(),
    durationDays: z.number().int().positive().optional(),
    regionSlugs: z.array(z.string()).optional(),
    activities: z.array(z.string()).optional(),
    budgetBand: z.string().optional(),
    startingPriceGbp: z.number().int().nonnegative().optional(),
    gallery: z.array(z.string().url()).optional(),
    publicUrl: z.string().url().optional(),
  })
  .passthrough();

type DetailRecord = z.infer<typeof DetailRecordSchema>;

function formatDuration(days?: number): string | undefined {
  if (typeof days !== "number") return undefined;
  if (days === 1) return "1 day";
  return `${days} days`;
}

function formatBudget(record: DetailRecord): string | undefined {
  if (record.budgetBand) return record.budgetBand;
  if (typeof record.startingPriceGbp === "number") {
    return `From £${record.startingPriceGbp.toLocaleString("en-GB")}`;
  }
  return undefined;
}

export function ItemDetailWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(props as ToolCallLifecycle, "Fetching detail…");
  if (gate) return gate;

  const outer = safeParse(GetDetailOutputSchema, props.result);
  if (!outer.ok) return <WidgetMalformedPlaceholder />;

  const record = safeParse(DetailRecordSchema, outer.data.record);
  if (!record.ok) return <WidgetMalformedPlaceholder />;

  // Narrow-as-best-we-can validation against the matching domain schema.
  // The outer envelope already specified entityType, so we pick the
  // schema to try — but tolerate a fail and fall back to the loose record.
  const { entityType } = outer.data;
  const narrow = (() => {
    switch (entityType) {
      case "trip":
        return TripSchema.safeParse(outer.data.record);
      case "tour":
        return TourSchema.safeParse(outer.data.record);
      case "region":
        return RegionSchema.safeParse(outer.data.record);
      case "story":
        return StorySchema.safeParse(outer.data.record);
      default:
        return { success: false as const };
    }
  })();

  // We use the narrow record when it validates (for type-safe reads) but
  // always fall back to the loose record for optional enrichment fields.
  const detail = record.data;
  const gallery = Array.isArray(detail.gallery) ? detail.gallery : [];

  const attributeRows: AttributeRow[] = [
    { label: "Duration", value: formatDuration(detail.durationDays) },
    {
      label: "Regions",
      value: detail.regionSlugs && detail.regionSlugs.length > 0
        ? detail.regionSlugs.join(", ")
        : undefined,
    },
    {
      label: "Activities",
      value: detail.activities && detail.activities.length > 0
        ? detail.activities.join(", ")
        : undefined,
    },
    { label: "Budget", value: formatBudget(detail) },
  ];

  return (
    <article
      data-testid="item-detail"
      data-entity-type={entityType}
      aria-label={detail.title}
      className="my-2 w-full overflow-hidden rounded-lg border border-slate-200 bg-white"
    >
      <ImageBlock src={detail.heroImageUrl} alt={detail.title} />
      <div className="flex flex-col gap-3 p-4">
        <header className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {entityType}
          </span>
          <h2 className="text-lg font-semibold leading-tight text-slate-900">
            {detail.title}
          </h2>
        </header>
        <p className="text-sm text-slate-700">{detail.summary}</p>
        <AttributeTable rows={attributeRows} />
        {narrow.success === false ? (
          // Dev-only breadcrumb: the outer envelope validated but the
          // record didn't match the per-entity domain schema. We still show
          // the loose fields; this note is for agent/developer eyes only.
          <p
            data-testid="item-detail-narrow-warning"
            className="text-xs italic text-slate-400"
          >
            (partial record — some fields may be missing)
          </p>
        ) : null}
        {gallery.length > 0 ? (
          <div
            data-testid="item-detail-gallery"
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {gallery.map((url, i) => (
              <div key={url} className="h-20 w-32 flex-shrink-0 sm:h-24 sm:w-40">
                <ImageBlock
                  src={url}
                  alt={`${detail.title} gallery image ${i + 1}`}
                  aspectRatio="16/10"
                />
              </div>
            ))}
          </div>
        ) : null}
        {detail.publicUrl ? (
          <div className="mt-1">
            <CtaButton
              href={detail.publicUrl}
              ariaLabel={`Open ${detail.title} on Swoop in a new tab`}
            >
              Go to this page
            </CtaButton>
          </div>
        ) : null}
      </div>
    </article>
  );
}

ItemDetailWidget.displayName = "ItemDetailWidget";
