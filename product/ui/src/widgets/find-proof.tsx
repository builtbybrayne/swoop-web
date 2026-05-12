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
// emphasised italic body type, an inline "Read more →" link to the
// canonical source (new tab). NOT a card with "CLAIM:" / "EVIDENCE:" labels;
// NOT a coloured-border alert box; NOT a shield/badge. The visual
// emphasis is *typographic*, not structural.
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
// `product/cms/prompts/tools/find_proof/description.md`.
// =============================================================================

import {
  FindProofOutputSchema,
  type TrustProofPublic,
} from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

export function FindProofWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    "Gathering supporting evidence…",
  );
  if (gate) return gate;

  const parsed = safeParse(FindProofOutputSchema, props.result);
  if (!parsed.ok) return <WidgetMalformedPlaceholder />;
  const { proofs } = parsed.data;

  // Empty case: render nothing. Reassurance with no evidence is silence — the
  // surrounding prose carries the moment, not a "we couldn't find proof"
  // disclosure.
  if (proofs.length === 0) return null;

  return (
    <section
      data-testid="find-proof"
      data-swoop-part="widget"
      data-swoop-widget="find-proof"
      aria-label="Supporting evidence"
      className="my-3 flex w-full flex-col gap-4"
    >
      {proofs.map((proof) => (
        <PulledQuote key={proof.id} proof={proof} />
      ))}
    </section>
  );
}

FindProofWidget.displayName = "FindProofWidget";

// -----------------------------------------------------------------------------
// PulledQuote — claim lead-in (small caps-tracked), evidence prose in
// emphasised italic body, "Read more →" inline link. Typography is the
// emphasis, not borders or fills.
// -----------------------------------------------------------------------------

function PulledQuote({ proof }: { proof: TrustProofPublic }) {
  return (
    <figure
      data-swoop-part="find-proof-pulled-quote"
      className="border-l-2 border-slate-200 pl-4"
    >
      {proof.claim ? (
        <figcaption
          data-testid="find-proof-claim"
          className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500"
        >
          {proof.claim}
        </figcaption>
      ) : null}
      <blockquote
        data-testid="find-proof-evidence"
        className="text-base italic leading-relaxed text-slate-700"
      >
        {proof.evidence}
      </blockquote>
      {proof.canonicalUrl ? (
        <a
          href={proof.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="find-proof-link"
          className="mt-2 inline-block text-xs font-medium text-slate-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          Read more →
        </a>
      ) : null}
    </figure>
  );
}
