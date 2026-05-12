// product/ui/src/widgets/index.ts
//
// Single registration point for all tool-call widget renderers. Exposes a
// `toolWidgetComponents` map keyed by tool name — parts/index.ts mounts
// this on `MessagePrimitive.Parts`'s `tools.by_name` slot so assistant-ui
// picks the right component per tool.
//
// Pattern mirrors the existing `messagePartComponents.data.by_name` wiring
// from D.t2: every new tool gets a named entry here rather than being
// registered imperatively inside a component tree.
//
// Post-B.t3a (2026-05-02): the deprecated `search` and `get_detail` widget
// entries (SearchResultsWidget / ItemDetailWidget) retired alongside the
// schemas they consumed.
//
// Post-D.t9 (2026-05-12): the five intent-named conversational tools each
// ship a widget renderer. Per the per-tool decisions logged in
// `planning/03-exec-chat-surface-t9.md` §"Per-tool sections" + decisions
// D.26–D.30:
//
//   find_inspiring   → FindInspiringWidget   (Inspire panel — image+prose)
//   find_someone_who → FindSomeoneWhoWidget  (Mirror vignette + persona)
//   find_proof       → FindProofWidget       (quiet pulled-quote)
//   lookup           → LookupWidget          (quiet source-page link)
//   find_options     → FindOptionsWidget     (polymorphic ProposalCards)
//   illustrate       → InspirationWidget     (image strip, unchanged)
//   handoff          → LeadCaptureWidget     (lead-capture form, unchanged)

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FindInspiringWidget } from "./find-inspiring";
import { FindOptionsWidget } from "./find-options";
import { FindProofWidget } from "./find-proof";
import { FindSomeoneWhoWidget } from "./find-someone-who";
import { InspirationWidget } from "./inspiration";
import { LeadCaptureWidget } from "./lead-capture";
import { LookupWidget } from "./lookup";

/**
 * Tool name → widget component map. Cast to `ToolCallMessagePartComponent`
 * once at the registration boundary since each widget narrows its
 * `structuredContent` via Zod at render time.
 */
export const toolWidgetComponents: Record<string, ToolCallMessagePartComponent> = {
  find_inspiring: FindInspiringWidget as unknown as ToolCallMessagePartComponent,
  find_someone_who: FindSomeoneWhoWidget as unknown as ToolCallMessagePartComponent,
  find_proof: FindProofWidget as unknown as ToolCallMessagePartComponent,
  lookup: LookupWidget as unknown as ToolCallMessagePartComponent,
  find_options: FindOptionsWidget as unknown as ToolCallMessagePartComponent,
  illustrate: InspirationWidget as unknown as ToolCallMessagePartComponent,
  handoff: LeadCaptureWidget as unknown as ToolCallMessagePartComponent,
};

export { FindInspiringWidget } from "./find-inspiring";
export { FindOptionsWidget } from "./find-options";
export { FindProofWidget } from "./find-proof";
export { FindSomeoneWhoWidget } from "./find-someone-who";
export { InspirationWidget } from "./inspiration";
export { LeadCaptureWidget } from "./lead-capture";
export { LookupWidget } from "./lookup";
