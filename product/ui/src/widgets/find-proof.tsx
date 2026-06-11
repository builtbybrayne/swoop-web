// product/ui/src/widgets/find-proof.tsx
//
// =============================================================================
// Conversational moment — Reassure (Interest → Strong Consideration; sometimes
// the threshold to handoff).
//
// A hesitation has surfaced — *"are you guys actually any good at this?"*,
// *"what about the environmental side?"*. The visitor isn't asking for a
// sales pitch; they're asking for evidence. Sonnet's prose carries the
// reassurance; this widget gives the source affordance — a quiet typographic
// moment that complements warmth without becoming legal chrome.
//
// The visitor sees: below Sonnet's framing prose, a "pulled-quote" treatment
// per proof — small claim lead-in (when present), the evidence text in
// emphasised italic body type, an inline link to the canonical source (new
// tab) — "Find out more about {title} →" when the proof carries the
// retrieval-provenance source title, "Read more →" otherwise. NOT a card
// with "CLAIM:" / "EVIDENCE:" labels; NOT a coloured-border alert box; NOT
// a shield/badge. The visual emphasis is *typographic*, not structural.
//
// What the visitor does next: reads, accepts, returns to the conversation.
// A small minority click through to verify or forward to a sceptical
// partner.
//
// Empty case: no widget. Trust-proofs aren't a "we tried but found nothing"
// affordance — Sonnet weaves whatever prose works.
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_proof`" (HITL Q1
// reversal — quiet pulled-quote, not card; not no-widget) + the
// conversational-moment calibration in
// `product/cms/prompts/tools/find_proof/description.md`. Anchor pattern per
// planning/03-exec-crosscut-magical-poincare-retrieval-provenance.md §1.4.
// =============================================================================

import { z } from "zod";
import {
  FindProofOutputSchema,
  type TrustProofPublic,
} from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
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
const EnrichedProofSchema = z.object({
  sourceTitle: z.string().nullish(),
});

function readSourceTitle(raw: unknown): string | null {
  const parsed = EnrichedProofSchema.safeParse(raw);
  if (!parsed.success) return null;
  const title = parsed.data.sourceTitle;
  return typeof title === "string" && title.trim().length > 0 ? title : null;
}

/** Anchor copy length cap — per the provenance plan §1.4 (~60 chars). */
const SOURCE_TITLE_MAX_CHARS = 60;

const SHELL_CTX = {
  widgetType: "find-proof",
  toolName: "find_proof",
} as const;

export function FindProofWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Gathering supporting evidence…",
  );
  if (gate) return gate;

  const parsed = safeParse(FindProofOutputSchema, props.result, SHELL_CTX);
  if (!parsed.ok) {
    return <WidgetMalformedPlaceholder {...SHELL_CTX} debug={parsed.debug} />;
  }
  const { proofs } = parsed.data;

  // Empty case: render nothing visibly. Reassurance with no evidence is
  // silence in production — the surrounding prose carries the moment, not a
  // "we couldn't find proof" disclosure. In dev, indicate so the absence is
  // explainable.
  if (proofs.length === 0) {
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason="empty result"
        hint={{ proofs: 0 }}
      />
    );
  }

  // Raw proof list for the loosened enrichment read — index-aligned with the
  // parsed proofs (Zod preserves array order).
  const unwrapped = unwrapEnvelope(props.result);
  const rawProofs = Array.isArray((unwrapped as { proofs?: unknown })?.proofs)
    ? ((unwrapped as { proofs: unknown[] }).proofs)
    : [];

  return (
    <section
      data-testid="find-proof"
      data-swoop-part="widget"
      data-swoop-widget="find-proof"
      aria-label="Supporting evidence"
      className="my-3 flex w-full flex-col gap-4"
    >
      {proofs.map((proof, i) => (
        <PulledQuote
          key={proof.id}
          proof={proof}
          sourceTitle={readSourceTitle(rawProofs[i])}
        />
      ))}
    </section>
  );
}

FindProofWidget.displayName = "FindProofWidget";

// -----------------------------------------------------------------------------
// PulledQuote — claim lead-in (small caps-tracked), evidence prose in
// emphasised italic body, inline source link (title-named when provenance
// supplies one). Typography is the emphasis, not borders or fills.
// -----------------------------------------------------------------------------

function PulledQuote({
  proof,
  sourceTitle,
}: {
  proof: TrustProofPublic;
  sourceTitle: string | null;
}) {
  return (
    <figure
      data-swoop-part="find-proof-pulled-quote"
      className="border-l-2 border-swoop-deep pl-4"
    >
      {proof.claim ? (
        <figcaption
          data-testid="find-proof-claim"
          className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-swoop-deep"
        >
          {decodeHtmlEntities(proof.claim)}
        </figcaption>
      ) : null}
      <blockquote
        data-testid="find-proof-evidence"
        className="text-base italic leading-relaxed text-slate-700"
      >
        {decodeHtmlEntities(proof.evidence)}
      </blockquote>
      {proof.canonicalUrl ? (
        <a
          href={proof.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="find-proof-link"
          className="mt-2 inline-block text-xs font-semibold text-swoop-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-swoop-accent"
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
            <>Read more →</>
          )}
        </a>
      ) : null}
    </figure>
  );
}
