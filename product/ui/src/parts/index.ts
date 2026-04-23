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
//   - `tools.by_name.{search,get_detail,illustrate,handoff}`: widget
//     renderers (D.t3). Imported from ../widgets so each tool has a single
//     registration site.
//
// Importing this module is sufficient to wire the renderers. App.tsx imports
// it for the side-effect-free named export and passes it to Parts.

import { MessagePrimitive } from "@assistant-ui/react";
import type { ComponentProps, ComponentType } from "react";
import type { DataFyiPart } from "@swoop/common";
import { FyiRenderer } from "./fyi-renderer";
import { FyiSignalingText } from "./fyi-signaling-text";
import { ReasoningGuard } from "./reasoning-guard";
import { toolWidgetComponents } from "../widgets";

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
    by_name: toolWidgetComponents,
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
