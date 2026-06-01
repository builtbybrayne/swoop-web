// product/ui/src/parts/sidebar-split.tsx
//
// Resizable two-pane desktop layout: the chat transcript (`main`) on the left,
// the visual sidebar (`aside`) on the right, with a draggable divider between
// them. Defaults to a 50/50 split.
//
// Responsive contract (single source of truth, shared with `sidebar-publish`'s
// inline-hide and the sidebar's own visibility):
//   - Below `lg` (< 1024px): the divider and the sidebar pane are
//     `display:none`; `main` fills the width. Mobile is unchanged — inline
//     widgets stay in the transcript.
//   - At `lg`+: both panes show. `main` is `flex-1`; the sidebar pane's width
//     is driven by `flex-basis: <ratio>%`, so the two share the row at the
//     current ratio.
//
// The divider is a WAI-ARIA window splitter: `role="separator"`,
// `aria-orientation="vertical"`, `tabIndex=0`, and `aria-valuenow/min/max` in
// percent. It is operable by pointer (drag), keyboard (arrows + Home), and
// double-click — all of which reset/clamp through the same `clampSplitRatio`.

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/** Sidebar share of the row, in percent, at the default 50/50 split. */
export const DEFAULT_SPLIT_RATIO = 50;
/** Narrowest the sidebar may be dragged (percent of the row). */
export const MIN_SPLIT_RATIO = 20;
/** Widest the sidebar may be dragged (percent of the row). */
export const MAX_SPLIT_RATIO = 80;
/** Keyboard nudge step, in percent. */
const KEY_STEP = 4;

/** Clamp a sidebar ratio (percent) into the allowed window. */
export function clampSplitRatio(pct: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, pct));
}

export function SidebarSplitLayout({
  main,
  aside,
  className,
}: {
  main: ReactNode;
  aside: ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // `ratio` = the sidebar's share of the row, in percent.
  const [ratio, setRatio] = useState(DEFAULT_SPLIT_RATIO);
  const draggingRef = useRef(false);

  const applyFromPointer = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    // The sidebar sits on the right, so its share grows as the pointer moves
    // left: measure from the container's right edge.
    const fromRight = rect.right - clientX;
    setRatio(clampSplitRatio((fromRight / rect.width) * 100));
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      applyFromPointer(e.clientX);
    },
    [applyFromPointer],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case "ArrowLeft": // divider left → sidebar grows
          e.preventDefault();
          setRatio((r) => clampSplitRatio(r + KEY_STEP));
          break;
        case "ArrowRight": // divider right → sidebar shrinks
          e.preventDefault();
          setRatio((r) => clampSplitRatio(r - KEY_STEP));
          break;
        case "Home":
        case "Enter":
          e.preventDefault();
          setRatio(DEFAULT_SPLIT_RATIO);
          break;
        default:
          break;
      }
    },
    [],
  );

  const reset = useCallback(() => setRatio(DEFAULT_SPLIT_RATIO), []);

  return (
    <div
      ref={containerRef}
      data-swoop-part="thread-layout"
      className={`flex h-full w-full ${className ?? ""}`}
    >
      {main}

      {/* Divider — desktop only. Mobile keeps the single-column transcript. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize visual sidebar"
        aria-valuemin={MIN_SPLIT_RATIO}
        aria-valuemax={MAX_SPLIT_RATIO}
        aria-valuenow={Math.round(ratio)}
        tabIndex={0}
        data-swoop-part="sidebar-resizer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={reset}
        title="Drag to resize · double-click to reset"
        className="hidden w-1.5 shrink-0 cursor-col-resize touch-none items-stretch bg-slate-200 transition-colors hover:bg-sky-400 focus-visible:bg-sky-500 focus-visible:outline-none lg:flex"
      />

      {/* Sidebar pane — width driven by the split ratio at lg+. */}
      <div
        data-swoop-part="sidebar-pane"
        className="hidden min-w-0 shrink-0 grow-0 lg:flex"
        style={{ flexBasis: `${ratio}%` }}
      >
        {aside}
      </div>
    </div>
  );
}

SidebarSplitLayout.displayName = "SidebarSplitLayout";
