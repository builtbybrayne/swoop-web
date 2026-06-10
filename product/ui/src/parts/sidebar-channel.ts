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
// Static cards (planning/03-exec-crosscut-magical-poincare-terminology-card.md,
// decision D.poincare-4): alongside the tool-part entries the store holds a
// second entry kind, `static-card` — client-side keyword-triggered explainer
// cards (today: the "About Swoop Planning Specialists" terminology card).
//
//   - Keyed by a stable card id (e.g. `terminology:specialists`), so the
//     once-per-conversation guard falls out of id-keying for free: however many
//     times the trigger fires (multi-mention conversations, rehydrate replay,
//     StrictMode double-effects), the Map holds one entry.
//   - Static cards sort ABOVE tool-part entries in the snapshot — they're
//     explainers, not part of the flow's chronology.
//   - Dismissable: `dismissStaticCard(id)` removes the entry AND records the id
//     so later trigger fires in the same conversation don't resurrect it. The
//     dismissed set is in-memory only — on a page reload the replayed history
//     re-triggers and the card legitimately reappears (same posture as the
//     tool-part entries: the store is a projection, not a persistence; see the
//     plan's §1.3 rehydrate outcome).
//   - `resetSidebar()` clears cards and the dismissed set together with the
//     tool-parts, so a fresh conversation can re-earn the card.
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

/**
 * Content payload for a static sidebar card. Authored in `cms/` (content as
 * data — e.g. cms/content/terminology/swoop-planning-specialists.json) and
 * loaded by the trigger module; the store never hardcodes copy.
 */
export interface StaticCardPayload {
  readonly title: string;
  readonly lines: readonly string[];
}

/** A tool-part entry as held in the store (the publish payload + kind tag). */
export interface SidebarToolPartEntry extends SidebarWidgetEntry {
  readonly kind: "tool-part";
}

/** A static explainer card, keyed by a stable card id. */
export interface SidebarStaticCardEntry {
  readonly kind: "static-card";
  readonly id: string;
  readonly payload: StaticCardPayload;
}

/** What the sidebar renders: static cards first, then tool-parts in arrival order. */
export type SidebarEntry = SidebarToolPartEntry | SidebarStaticCardEntry;

// Insertion-ordered, id-keyed stores. `Map` keeps first-insert position even
// when an existing key is re-`set`, giving us append-then-update-in-place.
// Two maps rather than one so "static cards sort above tool-parts" is a
// concatenation, not a sort, and the two id namespaces can't collide.
const toolParts = new Map<string, SidebarToolPartEntry>();
const staticCards = new Map<string, SidebarStaticCardEntry>();

// Card ids dismissed this conversation. Checked by `publishStaticCard` so a
// later trigger fire can't resurrect a card the visitor closed. In-memory
// only; cleared by `resetSidebar()`.
const dismissedStaticCards = new Set<string>();

// Cached snapshot array. `useSyncExternalStore` requires `getSnapshot` to
// return a referentially-stable value between mutations, so we rebuild this
// only when the store actually changes and hand back the same reference
// otherwise.
let snapshot: readonly SidebarEntry[] = [];

const listeners = new Set<() => void>();

function rebuildSnapshot(): void {
  snapshot = [...staticCards.values(), ...toolParts.values()];
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
  const prev = toolParts.get(entry.toolCallId);
  if (prev && sameEntry(prev, entry)) return;
  toolParts.set(entry.toolCallId, { kind: "tool-part", ...entry });
  rebuildSnapshot();
  emit();
}

/**
 * Publish a static card. Once-per-conversation by construction: a card id
 * already present keeps its first payload and position (no-op), and a
 * dismissed id stays gone until the next `resetSidebar()`. Safe to call from
 * every trigger fire — multi-mention conversations, rehydrate replays and
 * StrictMode double-effects all collapse to a single entry.
 */
export function publishStaticCard(
  id: string,
  payload: StaticCardPayload,
): void {
  if (dismissedStaticCards.has(id) || staticCards.has(id)) return;
  staticCards.set(id, { kind: "static-card", id, payload });
  rebuildSnapshot();
  emit();
}

/**
 * Dismiss a static card for the rest of the conversation. Removes the entry
 * and blocks re-publication of the same id until `resetSidebar()`.
 */
export function dismissStaticCard(id: string): void {
  dismissedStaticCards.add(id);
  if (!staticCards.delete(id)) return;
  rebuildSnapshot();
  emit();
}

/**
 * Clear the projection. Called by the thread-reset paths (fresh-chat, expired
 * rehydrate) so the sidebar empties alongside the transcript. Also clears the
 * static-card dismissals — a fresh conversation can re-earn the card. No
 * subscriber notification when nothing was visible, so we don't wake them
 * for nothing.
 */
export function resetSidebar(): void {
  const hadVisibleEntries = toolParts.size > 0 || staticCards.size > 0;
  toolParts.clear();
  staticCards.clear();
  dismissedStaticCards.clear();
  if (!hadVisibleEntries) return;
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
 * Current ordered snapshot (static cards first, then tool-parts in arrival
 * order). Referentially stable between mutations.
 */
export function getSidebarSnapshot(): readonly SidebarEntry[] {
  return snapshot;
}
