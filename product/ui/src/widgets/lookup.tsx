// product/ui/src/widgets/lookup.tsx
//
// =============================================================================
// Conversational moment — Inform (typically Interest, but anywhere on the arc).
//
// The visitor wants a specific answer to a specific question — *"how long is
// the W trek?"*, *"is December crowded?"*, *"do I need a visa?"*. The agent's
// job here is to be useful and specific, not to weave atmosphere. Sonnet's
// synthesis carries the substance; this widget gives the path forward — a
// quiet "Read the full guide on swoop-patagonia.com →" affordance for the
// procedural class of questions where the visitor will want to bookmark or
// read in full.
//
// The visitor sees: a single quiet text-weight link beneath Sonnet's prose,
// optionally with a one-line page-title hint. Where chunks span multiple
// canonical URLs, up to two affordances stacked. Where chunks lack
// canonical URLs (edge case), no widget body — Sonnet's synthesis stands
// alone. Visually quieter than `find_proof`'s pulled-quote: no border,
// no fill, no card.
//
// What the visitor does next: mostly receives the answer and continues. A
// minority click through for procedural depth (visa rules, transport
// logistics, packing lists).
//
// Per `planning/03-exec-chat-surface-t9.md` §"`lookup`" (HITL Q2 reversal —
// quiet source-page affordance, not no-widget; not chunk-list) + the
// conversational-moment calibration in
// `product/cms/prompts/tools/lookup/description.md`.
// =============================================================================

import {
  LookupOutputSchema,
  type InformChunkPublic,
} from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

// Cap the number of source-page affordances to keep the surface quiet — even
// if many chunks return distinct canonical URLs, we surface at most this many
// (per plan §"`lookup`": "up to 2 affordances stacked").
const MAX_AFFORDANCES = 2;

type SourceAffordance = {
  url: string;
  hint: string | null;
};

export function LookupWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    "Looking that up…",
  );
  if (gate) return gate;

  const parsed = safeParse(LookupOutputSchema, props.result);
  if (!parsed.ok) return <WidgetMalformedPlaceholder />;
  const { chunks } = parsed.data;

  if (chunks.length === 0) return null;

  const affordances = pickAffordances(chunks);
  if (affordances.length === 0) return null;

  return (
    <section
      data-testid="lookup"
      data-swoop-part="widget"
      data-swoop-widget="lookup"
      aria-label="Source pages for this answer"
      className="my-3 flex w-full flex-col gap-1.5 text-sm"
    >
      {affordances.map((affordance) => (
        <SourceLink key={affordance.url} affordance={affordance} />
      ))}
    </section>
  );
}

LookupWidget.displayName = "LookupWidget";

// -----------------------------------------------------------------------------
// SourceLink — single text-weight link with an optional page-title hint above.
// No box, no border, no background.
// -----------------------------------------------------------------------------

function SourceLink({ affordance }: { affordance: SourceAffordance }) {
  return (
    <div
      data-swoop-part="lookup-source-link"
      className="flex flex-col gap-0.5"
    >
      {affordance.hint ? (
        <span
          data-testid="lookup-hint"
          className="text-[11px] uppercase tracking-wide text-slate-500"
        >
          {affordance.hint}
        </span>
      ) : null}
      <a
        href={affordance.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="lookup-link"
        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        Read the full guide on swoop-patagonia.com →
      </a>
    </div>
  );
}

// -----------------------------------------------------------------------------
// pickAffordances — collapse the chunk set to a small set of source-page
// affordances. Same-URL chunks collapse to one entry; up to MAX_AFFORDANCES
// distinct URLs surface. The hint is the chunk's `question` when present
// (FAQ-style), otherwise null.
// -----------------------------------------------------------------------------

function pickAffordances(chunks: InformChunkPublic[]): SourceAffordance[] {
  const seen = new Map<string, SourceAffordance>();
  for (const chunk of chunks) {
    if (!chunk.canonicalUrl) continue;
    if (seen.has(chunk.canonicalUrl)) continue;
    seen.set(chunk.canonicalUrl, {
      url: chunk.canonicalUrl,
      hint: chunk.question ?? null,
    });
    if (seen.size >= MAX_AFFORDANCES) break;
  }
  return Array.from(seen.values());
}
