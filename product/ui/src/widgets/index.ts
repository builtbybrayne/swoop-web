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
// schemas they consumed. The five intent-named conversational tools
// (find_inspiring / find_someone_who / find_proof / lookup / find_options)
// are not yet rendered as widgets — Sonnet weaves their structured outputs
// directly into prose for now. D.t9 picks up the per-tool widget rewrite
// from `*PublicSchema` shapes; until that lands, only `illustrate` and
// `handoff` carry visible widget renderers.

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { InspirationWidget } from "./inspiration";
import { LeadCaptureWidget } from "./lead-capture";

/**
 * Tool name → widget component map. Cast to `ToolCallMessagePartComponent`
 * once at the registration boundary since each widget narrows its
 * `structuredContent` via Zod at render time.
 */
export const toolWidgetComponents: Record<string, ToolCallMessagePartComponent> = {
  illustrate: InspirationWidget as unknown as ToolCallMessagePartComponent,
  handoff: LeadCaptureWidget as unknown as ToolCallMessagePartComponent,
};

export { InspirationWidget } from "./inspiration";
export { LeadCaptureWidget } from "./lead-capture";
