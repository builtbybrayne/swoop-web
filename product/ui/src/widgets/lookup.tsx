// product/ui/src/widgets/lookup.tsx
//
// =============================================================================
// Conversational moment — Inform (typically Interest, but anywhere on the arc).
//
// The visitor wants a specific answer to a specific question — *"how long is
// the W trek?"*, *"is December crowded?"*, *"do I need a visa?"*. The agent's
// job here is to be useful and specific, not to weave atmosphere. Sonnet's
// synthesis carries the substance; this widget gives the path forward — the
// SINGLE most-relevant source page as one slightly-stronger link card, for
// the procedural class of questions where the visitor will want to bookmark
// or read in full.
//
// The visitor sees: beneath Sonnet's prose, exactly one quiet link card.
// When the chunk carries a source title (retrieval-provenance enrichment),
// the anchor is "Find out more about {title} →"; otherwise the legacy
// page-title hint sits above the generic "Read the full guide…" anchor.
// Secondary sources are dropped from display — the agent still receives all
// chunks and can name them in prose. Where chunks lack canonical URLs (edge
// case), no widget body — Sonnet's synthesis stands alone.
//
// What the visitor does next: mostly receives the answer and continues. A
// minority click through for procedural depth (visa rules, transport
// logistics, packing lists).
//
// Per planning/03-exec-crosscut-magical-poincare-visual-channel.md §2.2
// (Luke Loom feedback D4 — one page reference per moment) + the anchor
// pattern from planning/03-exec-crosscut-magical-poincare-retrieval-
// provenance.md §1.4. Supersedes the up-to-two stacked affordances from
// `planning/03-exec-chat-surface-t9.md` §"`lookup`".
// =============================================================================

import { z } from "zod";
import { LookupOutputSchema } from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";

// Schema-inferred chunk type — see note in find-inspiring.tsx.
type ParsedChunk = z.infer<typeof LookupOutputSchema>["chunks"][number];
import {
  renderLifecycleGate,
  safeParse,
  unwrapEnvelope,
  WidgetMalformedPlaceholder,
  WidgetSilentPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";
import { decodeHtmlEntities, truncateText } from "./text-utils";

// Loosened local read of the provenance enrichment (same pattern as
// inspiration.tsx's EnrichedImageSchema): `sourceTitle` is being added to the
// Public schemas by the retrieval-provenance work — parse it off the RAW
// result so this widget needs no compile-time dependency on that schema
// vintage, and falls back gracefully when the field is absent.
const EnrichedChunkSchema = z.object({
  sourceTitle: z.string().nullish(),
});

function readSourceTitle(raw: unknown): string | null {
  const parsed = EnrichedChunkSchema.safeParse(raw);
  if (!parsed.success) return null;
  const title = parsed.data.sourceTitle;
  return typeof title === "string" && title.trim().length > 0 ? title : null;
}

/** Anchor copy length cap — per the provenance plan §1.4 (~60 chars). */
const SOURCE_TITLE_MAX_CHARS = 60;

type SourceAffordance = {
  url: string;
  hint: string | null;
  sourceTitle: string | null;
};

const SHELL_CTX = { widgetType: "lookup", toolName: "lookup" } as const;

export function LookupWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Looking that up…",
  );
  if (gate) return gate;

  const parsed = safeParse(LookupOutputSchema, props.result, SHELL_CTX);
  if (!parsed.ok) {
    return <WidgetMalformedPlaceholder {...SHELL_CTX} debug={parsed.debug} />;
  }
  const { chunks } = parsed.data;

  if (chunks.length === 0) {
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason="empty result"
        hint={{ chunks: 0 }}
      />
    );
  }

  // Raw chunk list for the loosened enrichment read — index-aligned with the
  // parsed chunks (Zod preserves array order).
  const unwrapped = unwrapEnvelope(props.result);
  const rawChunks = Array.isArray((unwrapped as { chunks?: unknown })?.chunks)
    ? ((unwrapped as { chunks: unknown[] }).chunks)
    : [];

  const affordance = pickTopAffordance(chunks, rawChunks);
  if (!affordance) {
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason="no canonical URLs"
        hint={{ chunks: chunks.length, urls: 0 }}
      />
    );
  }

  return (
    <section
      data-testid="lookup"
      data-swoop-part="widget"
      data-swoop-widget="lookup"
      aria-label="Source page for this answer"
      className="my-3 w-full text-sm"
    >
      <SourceLink affordance={affordance} />
    </section>
  );
}

LookupWidget.displayName = "LookupWidget";

// -----------------------------------------------------------------------------
// SourceLink — the whole anchor is one quiet card: rounded border, no fill
// flourish, no favicon. Slightly stronger than the old text-weight link —
// it's the single page reference for the moment, so it can afford presence.
//
// Title present → the anchor IS the page name ("Find out more about {title}
// →"), entity-decoded and truncated; the old question-hint is folded away
// (the title does its job). Title absent → the legacy presentation: optional
// question hint above the generic anchor copy.
// -----------------------------------------------------------------------------

function SourceLink({ affordance }: { affordance: SourceAffordance }) {
  return (
    <a
      href={affordance.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="lookup-link"
      data-swoop-part="lookup-source-link"
      className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-4 py-3 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-400"
    >
      {affordance.sourceTitle ? (
        <span className="text-sm font-medium text-slate-800">
          Find out more about{" "}
          {truncateText(
            decodeHtmlEntities(affordance.sourceTitle),
            SOURCE_TITLE_MAX_CHARS,
          )}{" "}
          →
        </span>
      ) : (
        <>
          {affordance.hint ? (
            <span
              data-testid="lookup-hint"
              className="text-[11px] uppercase tracking-wide text-slate-500"
            >
              {decodeHtmlEntities(affordance.hint)}
            </span>
          ) : null}
          <span className="text-sm font-medium text-slate-700">
            Read the full guide on swoop-patagonia.com →
          </span>
        </>
      )}
    </a>
  );
}

// -----------------------------------------------------------------------------
// pickTopAffordance — the single most-relevant source page: the first chunk
// (retrieval rank order) that carries a canonical URL. The hint is the
// chunk's `question` when present (FAQ-style); `sourceTitle` is the loosened
// enrichment read off the raw chunk at the same index.
// -----------------------------------------------------------------------------

function pickTopAffordance(
  chunks: ParsedChunk[],
  rawChunks: unknown[],
): SourceAffordance | null {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.canonicalUrl) continue;
    return {
      url: chunk.canonicalUrl,
      hint: chunk.question ?? null,
      sourceTitle: readSourceTitle(rawChunks[i]),
    };
  }
  return null;
}
