// product/ui/src/parts/sidebar-channel.ts
//
// App-owned projection of the display tool-call widgets, used to mirror them
// into the right-hand visual sidebar (planning/02-impl-visual-sidebar.md §2.2).
//
// Why this exists:
//   assistant-ui owns the transcript and mounts each registered tool widget
//   *inline* at the point its tool-call part lands. Luke's Jun-2026 feedback is
//   that the visual material crowds the conversation. Rather than re-route
//   tool-calls out of assistant-ui's message model, we *tap* the render
//   boundary: a thin wrapper around each display widget publishes its tool-part
//   here, and the sidebar subscribes. assistant-ui keeps owning the transcript;
//   this store is a passive mirror.
//
// Shape mirrors `fyi-channel.ts` (module-scoped pub/sub, trivially testable via
// `resetSidebar()` in `beforeEach`) but adds held state: an ordered, id-keyed
// list of published widgets.
//
//   - Append-by-id: the first publish for a `toolCallId` appends; later
//     publishes for the same id replace that entry's payload in place (so a
//     widget that streams args -> result updates rather than stacking). A JS
//     Map preserves insertion order across `set` on an existing key, which is
//     exactly the "update in place, keep arrival position" semantics we want.
//   - Order = arrival order. No sorting, no relevance, no dedup beyond
//     identity. Image-level "don't show twice" already happens upstream in the
//     AntiRepetition retrieval layer; the sidebar does not re-implement it.
//   - Cleared by the same paths that reset the thread (`resetSidebar`, called
//     from App.tsx's fresh-chat + rehydrate-expired flows). No persistence of
//     its own — on reload the replayed history re-publishes for free.
//
// Scope note: like `fyi-channel`, this is UI-side coordination only. It is not
// wired to the orchestrator stream; the SSE shape is still the source of truth.
// The store holds whatever assistant-ui rendered, nothing more.

import type { ToolCallMessagePartProps } from "@assistant-ui/react";

/**
 * One published display widget. The fields are the subset of
 * `ToolCallMessagePartProps` the widgets actually consume (`result` directly;
 * `status` / `isError` via the lifecycle gate) plus identity. The sidebar
 * re-feeds these to the *same* widget component the inline path uses.
 */
export interface SidebarWidgetEntry {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly status: ToolCallMessagePartProps["status"] | undefined;
  readonly isError: boolean | undefined;
}

// Insertion-ordered, id-keyed store. `Map` keeps first-insert position even
// when an existing key is re-`set`, giving us append-then-update-in-place.
const entries = new Map<string, SidebarWidgetEntry>();

// Cached snapshot array. `useSyncExternalStore` requires `getSnapshot` to
// return a referentially-stable value between mutations, so we rebuild this
// only when the store actually changes and hand back the same reference
// otherwise.
let snapshot: readonly SidebarWidgetEntry[] = [];

const listeners = new Set<() => void>();

function rebuildSnapshot(): void {
  snapshot = Array.from(entries.values());
}

function emit(): void {
  // Copy to tolerate a listener unsubscribing mid-iteration.
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // A subscriber error must not break the emitter or sibling listeners.
    }
  }
}

/**
 * True when two entries carry the same render-relevant payload. Lets us skip
 * no-op publishes (e.g. React 18 StrictMode's double-invoked effects in dev,
 * or a re-render that didn't change the tool-part) so we don't churn
 * subscribers needlessly. `args` / `result` compared by identity — assistant-ui
 * hands a new object only when the underlying value changes.
 */
function sameEntry(a: SidebarWidgetEntry, b: SidebarWidgetEntry): boolean {
  return (
    a.toolName === b.toolName &&
    a.args === b.args &&
    a.result === b.result &&
    a.isError === b.isError &&
    a.status?.type === b.status?.type
  );
}

/**
 * Publish (append-or-update) a display widget into the sidebar projection.
 * Called from the render-boundary wrapper in `parts/index.ts`. Idempotent for
 * an unchanged payload.
 */
export function publishSidebarWidget(entry: SidebarWidgetEntry): void {
  const prev = entries.get(entry.toolCallId);
  if (prev && sameEntry(prev, entry)) return;
  entries.set(entry.toolCallId, entry);
  rebuildSnapshot();
  emit();
}

/**
 * Clear the projection. Called by the thread-reset paths (fresh-chat, expired
 * rehydrate) so the sidebar empties alongside the transcript. No-op when
 * already empty so we don't wake subscribers for nothing.
 */
export function resetSidebar(): void {
  if (entries.size === 0) return;
  entries.clear();
  rebuildSnapshot();
  emit();
}

/**
 * Subscribe to store changes. Returns a dispose fn. Wired to
 * `useSyncExternalStore` in the sidebar component.
 */
export function subscribeSidebar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Current ordered snapshot. Referentially stable between mutations.
 */
export function getSidebarSnapshot(): readonly SidebarWidgetEntry[] {
  return snapshot;
}
