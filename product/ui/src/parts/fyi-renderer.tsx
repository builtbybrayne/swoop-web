// product/ui/src/parts/fyi-renderer.tsx
//
// Renderer for `data-fyi` custom message parts.
//
// Contract (planning/02-impl-chat-surface.md §2.3 + decision D.10):
//   - `<fyi>` is an ephemeral side-channel affordance. Not a chat bubble.
//   - It appears as a narrow status line below the currently-streaming
//     assistant message and fades out on:
//       1. any subsequent `text` part arriving in the same message, OR
//       2. a FYI_TIMEOUT_MS timer expiring (default ~3s), OR
//       3. a later `<fyi>` message replacing it (latest wins — don't stack).
//   - Accessibility: `role="status"` + `aria-live="polite"` so screen readers
//     announce it without barging the assistant reply.
//
// Wire shape (chunk B §2.5a + @swoop/common streaming.ts):
//   { type: "data-fyi", data: { message: string, timestamp: string } }
// Internally assistant-ui converts the wire `data-fyi` into a message part
// of shape `{ type: "data", name: "fyi", data: { message, timestamp } }`
// before the renderer is invoked. See node_modules copy of
// @assistant-ui/core's runtime-utils/thread-message-like.ts.

import { useEffect, useState } from "react";
import type { DataFyiPart } from "@swoop/common";
import {
  emitFyiChannel,
  subscribeFyiChannel,
  type FyiChannelEvent,
} from "./fyi-channel";

/** Default auto-fade window. Decision D.10 suggests ~3s. */
export const FYI_TIMEOUT_MS = 3000;

/** CSS transition duration. Must match `transition-opacity duration-*`. */
const FADE_TRANSITION_MS = 300;

/**
 * Props shape assistant-ui hands to a data part component. We narrow `data`
 * to the `DataFyiPart` payload since this renderer is registered only under
 * `by_name.fyi`.
 */
export type FyiRendererProps = {
  /** Registered data name (always `"fyi"` for this renderer). */
  name?: string;
  /** Validated payload from the stream. */
  data: DataFyiPart["data"];
};

/**
 * Ephemeral `<fyi>` renderer.
 *
 * Lifecycle:
 *   1. Mount — emit `fyi-appeared` so older fyis fade, start fade timer.
 *   2. Event handlers — fade on `text-arrived` or another `fyi-appeared`.
 *   3. Unmount — dispose timer + subscription.
 *
 * Once `visible=false` the DOM node stays mounted for `FADE_TRANSITION_MS`
 * so the CSS transition can run, then the component returns `null`.
 */
export function FyiRenderer({ data }: FyiRendererProps) {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    // Signal so sibling fyi instances from earlier streams fade out.
    emitFyiChannel("fyi-appeared");

    const fadeTimer = window.setTimeout(() => {
      setVisible(false);
    }, FYI_TIMEOUT_MS);

    // A newer fyi or an arriving text part means we step aside.
    const unsubscribe = subscribeFyiChannel((event: FyiChannelEvent) => {
      if (event === "text-arrived" || event === "fyi-appeared") {
        // Check if the event is from *ourselves*: the self-emit above runs
        // synchronously before any other subscription exists for this
        // instance, so we'll never receive our own "fyi-appeared". Safe.
        setVisible(false);
      }
    });

    return () => {
      window.clearTimeout(fadeTimer);
      unsubscribe();
    };
    // `data` identity changes if the stream replaces payload in place; we
    // restart the timer in that case so the latest message gets the full
    // window. Hence the dependency on `data.timestamp`.
  }, [data.timestamp]);

  // After fade completes, unmount entirely so we don't leave empty nodes in
  // the DOM for assistive tech to find.
  useEffect(() => {
    if (visible) return;
    const unmountTimer = window.setTimeout(() => {
      setMounted(false);
    }, FADE_TRANSITION_MS);
    return () => window.clearTimeout(unmountTimer);
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="fyi-status"
      data-fyi-visible={visible ? "true" : "false"}
      // Visual treatment: small muted inline status line indented under the
      // streaming assistant response. Tailwind utilities below are a
      // starting point — Al may iterate post-M1 per the Tier 3 handoff notes.
      className={[
        "ml-2 mt-1 inline-flex items-center gap-1.5",
        "text-xs text-slate-500",
        "italic",
        "transition-opacity ease-out",
        "duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400"
      />
      <span>{data.message}</span>
    </div>
  );
}

FyiRenderer.displayName = "FyiRenderer";
