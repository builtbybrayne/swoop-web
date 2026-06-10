// product/ui/src/widgets/find-inspiring.tsx
//
// =============================================================================
// Conversational moment — Inspire (Awareness → Interest hinge).
//
// The visitor's energy is open and exploratory: they've named Patagonia, or a
// region, or a feeling — "wild", "autumn light", "puma photography". This is
// the moment *before* the moment they're ready to narrow. Sonnet's job is to
// make the conversation come alive in prose; this widget gives the prose its
// visual lift — image + passage together, where neither would be enough alone.
//
// The visitor sees: below Sonnet's text, one to three "passage cards", each
// carrying real Patagonia prose, the paired image (when present), a small
// region tag, and a quiet deep-link affordance to the canonical page — named
// after the page ("Find out more about {title} →") when the passage carries
// the retrieval-provenance source title, generic copy otherwise. The card is
// clickable as a whole; the prose-plus-image *is* the lift. No horizontal
// carousel — vertical stack at default density (2-4 cards).
//
// What the visitor does next: most read and continue. A minority click
// through to the canonical page (new tab; chat persists). Reading is the
// primary path; the click affordance is secondary.
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_inspiring`" + the
// conversational-moment calibration in
// `product/cms/prompts/tools/find_inspiring/description.md`. Anchor pattern
// per planning/03-exec-crosscut-magical-poincare-retrieval-provenance.md §1.4.
// =============================================================================

import { z } from "zod";
import { FindInspiringOutputSchema } from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";

// Local passage type — derived from the schema we actually parse against,
// so optional `image.{subjectTags,moodTags,regionTags}` fields stay optional
// here even though the `InspirePassagePublic` alias declares them required.
// Public type vs schema-inferred type alignment is a `@swoop/common` concern
// being worked elsewhere; this local derivation keeps the widget agnostic.
type ParsedPassage = z.infer<
  typeof FindInspiringOutputSchema
>["passages"][number];
import { Card, ImageBlock } from "../shared";
import { decodeHtmlEntities, truncateText } from "./text-utils";
import {
  renderLifecycleGate,
  safeParse,
  unwrapEnvelope,
  WidgetMalformedPlaceholder,
  WidgetSilentPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

// Loosened local read of the provenance enrichment (same pattern as
// inspiration.tsx's EnrichedImageSchema): `sourceTitle` is being added to the
// Public schemas by the retrieval-provenance work — parse it off the RAW
// result so this widget needs no compile-time dependency on that schema
// vintage, and falls back gracefully when the field is absent.
const EnrichedPassageSchema = z.object({
  sourceTitle: z.string().nullish(),
});

function readSourceTitle(raw: unknown): string | null {
  const parsed = EnrichedPassageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const title = parsed.data.sourceTitle;
  return typeof title === "string" && title.trim().length > 0 ? title : null;
}

/** Anchor copy length cap — per the provenance plan §1.4 (~60 chars). */
const SOURCE_TITLE_MAX_CHARS = 60;

const SHELL_CTX = {
  widgetType: "find-inspiring",
  toolName: "find_inspiring",
} as const;

export function FindInspiringWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Surfacing inspiration…",
  );
  if (gate) return gate;

  const parsed = safeParse(FindInspiringOutputSchema, props.result, SHELL_CTX);
  if (!parsed.ok) {
    return <WidgetMalformedPlaceholder {...SHELL_CTX} debug={parsed.debug} />;
  }
  const { passages } = parsed.data;

  // Empty result is the agent's job to handle in prose, not a widget surface.
  // In production: silent (return null). In dev: a small "rendered silently"
  // indicator so the developer sees that the tool fired with no passages.
  // Per crosscut plan 03-exec-crosscut-brave-pare-widget-user-copy-fix.md.
  if (passages.length === 0) {
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason="empty result"
        hint={{ passages: 0 }}
      />
    );
  }

  // Raw passage list for the loosened enrichment read — index-aligned with
  // the parsed passages (Zod preserves array order).
  const unwrapped = unwrapEnvelope(props.result);
  const rawPassages = Array.isArray(
    (unwrapped as { passages?: unknown })?.passages,
  )
    ? ((unwrapped as { passages: unknown[] }).passages)
    : [];

  return (
    <section
      data-testid="find-inspiring"
      data-swoop-part="widget"
      data-swoop-widget="find-inspiring"
      aria-label="Inspiration passages"
      className="my-2 flex w-full flex-col gap-3"
    >
      {passages.map((passage, i) => (
        <PassageCard
          key={passage.id}
          passage={passage}
          sourceTitle={readSourceTitle(rawPassages[i])}
        />
      ))}
    </section>
  );
}

FindInspiringWidget.displayName = "FindInspiringWidget";

// -----------------------------------------------------------------------------
// PassageCard — image-above-text card; the whole card is the affordance.
// The deep-link anchor names the source page when the provenance title is
// available; the legacy generic copy is the fallback.
// -----------------------------------------------------------------------------

function PassageCard({
  passage,
  sourceTitle,
}: {
  passage: ParsedPassage;
  sourceTitle: string | null;
}) {
  return (
    <Card
      className="overflow-hidden"
      // Card wrapper carries the per-card brand-extension hook so the brand
      // team can target passage-card density / treatment without reaching into
      // ImageBlock or paragraph internals.
    >
      <div data-swoop-part="find-inspiring-passage" className="contents">
        {passage.image ? (
          <ImageBlock
            src={passage.image.canonicalUrl}
            alt={passage.image.altText ?? ""}
          />
        ) : null}
        <div className="flex flex-col gap-2 p-4">
          <p className="text-sm leading-relaxed text-slate-800">
            {decodeHtmlEntities(passage.text)}
          </p>
          <div className="flex items-center justify-between gap-2 pt-1">
            {passage.region ? (
              <span
                data-testid="find-inspiring-region"
                className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600"
              >
                {passage.region}
              </span>
            ) : (
              <span aria-hidden="true" />
            )}
            <a
              href={passage.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="find-inspiring-link"
              className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {sourceTitle ? (
                <>
                  Find out more about{" "}
                  {truncateText(
                    decodeHtmlEntities(sourceTitle),
                    SOURCE_TITLE_MAX_CHARS,
                  )}{" "}
                  →
                </>
              ) : (
                <>Read more on swoop-patagonia.com →</>
              )}
            </a>
          </div>
        </div>
      </div>
    </Card>
  );
}
