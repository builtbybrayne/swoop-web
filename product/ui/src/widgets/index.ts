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

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SearchResultsWidget } from "./search-results";
import { ItemDetailWidget } from "./item-detail";
import { InspirationWidget } from "./inspiration";
import { LeadCaptureWidget } from "./lead-capture";

/**
 * Tool name → widget component map. Cast to `ToolCallMessagePartComponent`
 * once at the registration boundary since each widget narrows its
 * `structuredContent` via Zod at render time.
 */
export const toolWidgetComponents: Record<string, ToolCallMessagePartComponent> = {
  search: SearchResultsWidget as unknown as ToolCallMessagePartComponent,
  get_detail: ItemDetailWidget as unknown as ToolCallMessagePartComponent,
  illustrate: InspirationWidget as unknown as ToolCallMessagePartComponent,
  handoff: LeadCaptureWidget as unknown as ToolCallMessagePartComponent,
};

export { SearchResultsWidget } from "./search-results";
export { ItemDetailWidget } from "./item-detail";
export { InspirationWidget } from "./inspiration";
export { LeadCaptureWidget } from "./lead-capture";
