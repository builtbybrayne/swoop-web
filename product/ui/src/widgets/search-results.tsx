// product/ui/src/widgets/search-results.tsx
//
// Renders the output of the `search` tool. Responsive card grid; each card
// shows a title, summary, entity-type pill, and (if the tool output carried
// a per-hit `publicUrl` from chunk C's scrape path) a deep-link CTA opening
// in a new tab.
//
// Schema validation happens at the render boundary (`SearchOutputSchema`
// from @swoop/common). Schema drift → "couldn't be displayed" placeholder
// rather than a crash.
//
// No brand styling — Swoop's in-house team applies branding post-M5 per
// planning/03-exec-chat-surface-t3.md "Handoff notes".

import { z } from "zod";
import { SearchOutputSchema, SearchHitSchema } from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { Card, ImageBlock, CtaButton } from "../shared";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

/**
 * The tool's declared output schema doesn't carry hero-image or publicUrl
 * fields yet — those come from chunk C's connector. We accept them here
 * optimistically via a widened per-hit schema so the widget is ready for
 * those fields the moment the connector emits them.
 */
const EnrichedHitSchema = SearchHitSchema.extend({
  heroImageUrl: z.string().url().optional(),
  publicUrl: z.string().url().optional(),
});

const EnrichedOutputSchema = SearchOutputSchema.extend({
  hits: z.array(EnrichedHitSchema),
});

type EnrichedHit = z.infer<typeof EnrichedHitSchema>;

const ENTITY_LABELS: Record<EnrichedHit["entityType"], string> = {
  trip: "Trip",
  tour: "Tour",
  region: "Region",
  story: "Story",
};

export function SearchResultsWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(props as ToolCallLifecycle, "Searching the catalogue…");
  if (gate) return gate;

  const parsed = safeParse(EnrichedOutputSchema, props.result);
  if (!parsed.ok) return <WidgetMalformedPlaceholder />;
  const { hits } = parsed.data;

  if (hits.length === 0) {
    return (
      <div
        data-testid="search-results-empty"
        className="my-2 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600"
      >
        No matches in the catalogue for that.
      </div>
    );
  }

  return (
    <section
      data-testid="search-results"
      aria-label="Search results"
      className="my-2 w-full"
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hits.map((hit) => (
          <li key={`${hit.entityType}:${hit.id}`} className="h-full">
            <Card className="h-full">
              <ImageBlock src={hit.heroImageUrl} alt={hit.title} />
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <span
                    data-testid="search-result-type"
                    className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600"
                  >
                    {ENTITY_LABELS[hit.entityType]}
                  </span>
                </div>
                <h3 className="text-base font-semibold leading-tight text-slate-900">
                  {hit.title}
                </h3>
                <p className="line-clamp-3 text-sm text-slate-600">{hit.summary}</p>
                {hit.publicUrl ? (
                  <div className="mt-auto pt-2">
                    <CtaButton href={hit.publicUrl} ariaLabel={`Open ${hit.title} in a new tab`}>
                      Learn more
                    </CtaButton>
                  </div>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

SearchResultsWidget.displayName = "SearchResultsWidget";
