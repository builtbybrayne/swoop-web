// product/ui/src/parts/index.ts
//
// Custom message-part renderer registry for the Puma chat surface.
//
// assistant-ui exposes a `components` prop on `<MessagePrimitive.Parts>` that
// maps part types → React components. This module assembles that prop so
// App.tsx stays declarative:
//
//   <MessagePrimitive.Parts components={messagePartComponents} />
//
// What's registered:
//   - `Text`: the default text renderer we inherit from D.t1, lightly wrapped
//     by `FyiSignalingText` so the fyi channel knows when text starts to
//     arrive (it fades stale `<fyi>` status lines).
//   - `Reasoning`: the dev-mode guard. Any reasoning part hitting this is a
//     translator bug (decision D.9).
//   - `data.by_name.fyi`: the ephemeral `<fyi>` renderer.
//   - `tools.by_name.{illustrate,handoff}`: widget renderers (D.t3).
//     Imported from ../widgets so each tool has a single registration site.
//     Post-B.t3a 2026-05-02: the librarian-shaped `search` / `get_detail`
//     widget entries retired alongside the schemas they consumed.
//     Per-tool widgets for the five intent-named conversational tools
//     land in D.t9 — until then Sonnet weaves their structured outputs
//     directly into prose.
//
// Importing this module is sufficient to wire the renderers. App.tsx imports
// it for the side-effect-free named export and passes it to Parts.

import { MessagePrimitive } from "@assistant-ui/react";
import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { createElement } from "react";
import type { ComponentProps, ComponentType } from "react";
import type { DataFyiPart } from "@swoop/common";
import { FyiRenderer } from "./fyi-renderer";
import { FyiSignalingText } from "./fyi-signaling-text";
import { ReasoningGuard } from "./reasoning-guard";
import { toolWidgetComponents } from "../widgets";
import {
  UnregisteredToolFallback,
  wrapWithDevTrace,
} from "../widgets/widget-shell";

// Bridge `UnregisteredToolFallback` (a narrow `{toolName, args, result}`
// shape) to the full `ToolCallMessagePartProps` the registry's `Fallback`
// slot expects. We only read three fields; assistant-ui's other props
// (`addResult`, `resume`, `status`, etc.) are ignored — there's nothing
// for an unregistered tool to do with them. `createElement` over JSX so
// this file stays `.ts` (rest of the file has no JSX).
const RawToolFallback: ToolCallMessagePartComponent = (
  props: ToolCallMessagePartProps,
) =>
  createElement(UnregisteredToolFallback, {
    toolName: props.toolName,
    args: props.args,
    result: props.result,
  });
RawToolFallback.displayName = "RawToolFallback";

// Wrap every registered widget (and the fallback) with the universal
// dev-only `DevToolCallTrace` so each tool call shows a collapsible
// diagnostic — toolCallId, duration, args, result, isError — below the
// widget's own render. In production `wrapWithDevTrace` is a pass-through.
const wrappedToolComponents: Record<string, ToolCallMessagePartComponent> =
  Object.fromEntries(
    Object.entries(toolWidgetComponents).map(([name, Component]) => [
      name,
      wrapWithDevTrace(name, Component),
    ]),
  );
const ToolFallback: ToolCallMessagePartComponent = wrapWithDevTrace(
  "(unregistered)",
  RawToolFallback,
);

/**
 * Narrow alias: the data renderer assistant-ui expects receives at least
 * `{ data: unknown }`. We narrow `data` to `DataFyiPart["data"]` at the
 * call-site since this slot is only registered under `by_name.fyi`.
 */
type FyiDataComponent = ComponentType<{ data: DataFyiPart["data"] }>;

/**
 * The components map fed to `MessagePrimitive.Parts`. Typed against
 * assistant-ui's `StandardComponents` so adding a new kind here is a
 * compile-error if the shape changes upstream.
 *
 * Cast on `data.by_name.fyi` is narrow: assistant-ui's data renderer prop is
 * `DataMessagePartComponent<any>`, and our registered component accepts a
 * strict `DataFyiPart["data"]` payload. Safe because the SSE schema is
 * enforced at the orchestrator boundary.
 */
export const messagePartComponents = {
  Text: FyiSignalingText,
  Reasoning: ReasoningGuard,
  data: {
    by_name: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fyi: FyiRenderer as unknown as FyiDataComponent as any,
    },
  },
  tools: {
    // `wrappedToolComponents` decorates each widget with `DevToolCallTrace`
    // in dev mode (prod: pass-through to the raw widget). Every tool call
    // therefore shows a universal diagnostic surface beneath whatever the
    // widget itself rendered.
    by_name: wrappedToolComponents,
    // Tool calls not in `by_name` route to the dev-only "unregistered tool"
    // indicator (prod: returns null). Also wrapped so we still get the
    // trace card for previously-unknown tool names.
    Fallback: ToolFallback,
  },
} satisfies NonNullable<ComponentProps<typeof MessagePrimitive.Parts>["components"]>;

export { FyiRenderer } from "./fyi-renderer";
export { FyiSignalingText } from "./fyi-signaling-text";
export { ReasoningGuard, REASONING_GUARD_MESSAGE } from "./reasoning-guard";
export {
  subscribeFyiChannel,
  emitFyiChannel,
  resetFyiChannel,
} from "./fyi-channel";
