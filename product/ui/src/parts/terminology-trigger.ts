// product/ui/src/parts/terminology-trigger.ts
//
// Client-side keyword trigger for the "About Swoop Planning Specialists"
// terminology card (planning/03-exec-crosscut-magical-poincare-terminology-card.md,
// decision D.poincare-4). Luke's ask: the first time the agent mentions the
// Specialists, a small explainer card appears in the visual sidebar — once per
// conversation.
//
// Mechanism — pure presentation concern, same philosophy as the sidebar itself
// ("tap, don't re-route"):
//   - `useSpecialistTermTrigger(text, enabled)` is called from the assistant
//     text render path (`FyiSignalingText`). No orchestrator involvement, no
//     new tool, no change to the agent's turn structure.
//   - Match on *settled* text only: the effect re-arms a short timer on every
//     text change, so while a reply is still streaming the timer keeps
//     resetting and nothing fires. Only once the text has been stable for
//     `TERM_SETTLE_MS` does the publish run — a mid-stream partial word
//     ("…Specialist" while the model is still typing the plural) can never
//     cause a premature fire.
//   - The once-per-conversation guard lives in the store, not here: every
//     settled match calls `publishStaticCard` and the id-keyed Map collapses
//     them to one entry. That's what makes rehydrate correct for free — on
//     reload the replayed history re-renders through the same text path, the
//     trigger re-fires, and the card reappears without special-casing
//     (plan §1.3).
//
// Content: loaded from cms/ (content as data, never inlined in TSX) via Vite's
// native JSON import — the same mechanism error-banner.tsx uses for
// cms/errors/en.json. The cast satisfies TS without a runtime validation step;
// the file is authored-then-frozen content. NB the copy is a DRAFT pending
// Luke/Julie sign-off (see the JSON's $schema-notes).
//
// The matched term is the canonical `SPECIALIST_TERM_RE` from
// shared/specialist-term.ts — change the term THERE, not here. We normalise
// typographic apostrophes (U+2018/U+2019 → ') before matching so a model that
// writes “Swoop’s Planning Specialists” with a curly quote still triggers.

import { useEffect } from "react";
import { SPECIALIST_TERM_RE } from "../shared/specialist-term";
import { publishStaticCard, type StaticCardPayload } from "./sidebar-channel";
// Vite natively resolves JSON imports; the cast satisfies TS without a
// runtime validation step (the file is authored-then-frozen content).
import cardJson from "../../../cms/content/terminology/swoop-planning-specialists.json";

/** Stable store id for the card — the once-guard keys on this. */
export const TERMINOLOGY_CARD_ID = "terminology:specialists";

/**
 * How long the text must hold still before a match publishes. Streaming
 * chunks arrive well inside this window, so the timer keeps re-arming until
 * the reply settles; replayed history arrives fully-formed and settles
 * immediately. Exported for the tests' fake-timer assertions.
 */
export const TERM_SETTLE_MS = 500;

// The $schema-notes key lives alongside the real fields; the cast narrows to
// what the card renders.
const CARD_CONTENT: StaticCardPayload = {
  title: (cardJson as { title: string }).title,
  lines: (cardJson as { lines: string[] }).lines,
};

/** Exported for tests asserting the payload really is the cms content. */
export function getTerminologyCardContent(): StaticCardPayload {
  return CARD_CONTENT;
}

function normalizeApostrophes(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

/**
 * Watch a text part for the Specialists term and publish the terminology card
 * once the text has settled. `enabled` gates on role — only assistant text
 * triggers; a visitor typing the term must not summon the card.
 */
export function useSpecialistTermTrigger(text: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || text.length === 0) return;
    if (!SPECIALIST_TERM_RE.test(normalizeApostrophes(text))) return;
    const timer = window.setTimeout(() => {
      publishStaticCard(TERMINOLOGY_CARD_ID, CARD_CONTENT);
    }, TERM_SETTLE_MS);
    // Any text change (next streamed chunk) or unmount (thread reset) cancels
    // the pending publish; the effect re-arms on the new text if it still
    // matches. This IS the debounce.
    return () => window.clearTimeout(timer);
  }, [text, enabled]);
}
