// product/ui/src/parts/fyi-channel.ts
//
// Tiny module-scoped pub/sub used by the `<fyi>` renderer and the text-signal
// wrapper to coordinate the ephemeral status-line behaviour documented in
// planning/02-impl-chat-surface.md §2.3 + decision D.10.
//
// Why not React context?
//   - Custom part renderers are registered via `MessagePrimitive.Parts`'s
//     `components.data.by_name` map; assistant-ui wraps them in its own
//     internal tree, so wrapping them in our own provider requires threading
//     a context through the Parts primitive (it doesn't surface one).
//   - Module-scoped emitters are trivially testable (`vi.resetModules()` gives
//     a clean slate) and do not leak across renders the way `window`-level
//     globals would.
//
// Signals:
//   - `text-arrived`  — emitted by the wrapped text renderer the first time
//                       a text part in a message has non-empty content.
//                       FyiRenderer listens and fades immediately.
//   - `fyi-appeared`  — emitted when a new fyi mounts. Older fyi instances
//                       listen and fade out immediately so the channel only
//                       ever shows the latest message (decision: latest wins).
//
// Scope note: this is a UI-side coordination signal only. It is NOT wired to
// the assistant-ui runtime or the SSE stream. The orchestrator's stream shape
// is still the source of truth.

/** Events the channel publishes. */
export type FyiChannelEvent = "text-arrived" | "fyi-appeared";

/** Subscriber callback signature. */
export type FyiChannelListener = (event: FyiChannelEvent) => void;

const listeners = new Set<FyiChannelListener>();

/**
 * Register a listener. Returns a dispose fn; call it on unmount.
 */
export function subscribeFyiChannel(
  listener: FyiChannelListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Broadcast an event to all subscribers. Safe to call during render-safe
 * lifecycle hooks (useEffect / event handlers).
 */
export function emitFyiChannel(event: FyiChannelEvent): void {
  // Copy to avoid mutation mid-iteration if a listener unsubscribes.
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch {
      // Listener errors must not break the emitter. Swallow.
    }
  }
}

/**
 * Test-only reset. Vitest calls this in `beforeEach` to avoid cross-test
 * leakage without hauling in `vi.resetModules()`.
 */
export function resetFyiChannel(): void {
  listeners.clear();
}
