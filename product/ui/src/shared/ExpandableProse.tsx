// product/ui/src/shared/ExpandableProse.tsx
//
// =============================================================================
// Prose with inline "Read more" / "Show less" affordance.
//
// The principle (Al, 2026-05-13): cards never silently truncate. Where prose
// is longer than the visible clamp, render the clamp and surface an inline
// expander. Visitors who want the full text get it without leaving the card;
// visitors who don't see a tidy compact block.
//
// Implementation notes:
//   - Overflow detection: compare `scrollHeight` vs `clientHeight` after
//     layout in a `useLayoutEffect`. Re-measures when `content` changes.
//     Window-resize re-measure intentionally not wired — the card column
//     width is stable in Puma's responsive shape.
//   - Renders content either as plain text (default) or as trusted CMS HTML
//     via `dangerouslySetInnerHTML` when `html: true`. The trust boundary is
//     the *caller's* responsibility — see
//     planning/03-exec-crosscut-brave-pare-render-cms-html.md.
//   - Wrapper element is `<div>` so it can safely host nested `<p>` from
//     CMS HTML (nesting `<p>` inside `<p>` is invalid HTML).
//
// Per `planning/03-exec-crosscut-brave-pare-card-expandable-prose.md`.
// =============================================================================

import { useLayoutEffect, useRef, useState } from "react";

const LINE_CLAMP_CLASS: Record<number, string> = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

export interface ExpandableProseProps {
  content: string;
  /**
   * Whether `content` is trusted CMS-authored HTML to render via
   * `dangerouslySetInnerHTML`. Defaults to false (plain text rendering with
   * React's auto-escape). Caller owns the trust decision.
   */
  html?: boolean;
  /**
   * CSS `line-clamp-N` value when collapsed. Default 3.
   * Supported values: 2 | 3 | 4 | 5 | 6.
   */
  maxLines?: 2 | 3 | 4 | 5 | 6;
  /** Tailwind class applied to the prose body. */
  className?: string;
  /** Optional testid on the prose body (the clamped/expanded element). */
  testId?: string;
}

export function ExpandableProse({
  content,
  html = false,
  maxLines = 3,
  className,
  testId,
}: ExpandableProseProps) {
  const proseRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Measure overflow after each layout pass.
  //
  // Implementation note: Tailwind's `line-clamp-N` uses `display:-webkit-box`
  // + `-webkit-line-clamp` which clamps the rendered box BOTH visually AND
  // in `scrollHeight` — both clientHeight and scrollHeight return the
  // clamped value, so a simple `scrollHeight > clientHeight` comparison
  // misfires (both come back equal even when content is much longer).
  // Workaround: temporarily remove the clamp class to read the unclamped
  // scrollHeight, then restore. `useLayoutEffect` runs synchronously before
  // paint, so the visitor never sees the unclamped frame.
  //
  // JSDOM (vitest) returns 0 for both heights by default; tests stub
  // scrollHeight + clientHeight via `Object.defineProperty` to drive the
  // overflow branches. In JSDOM the `replace(...)` line is a no-op on
  // className strings; the stub provides the numbers directly.
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (!el) return;
    if (expanded) return;
    const originalClassName = el.className;
    const unclamped = originalClassName.replace(/\bline-clamp-\d+\b/g, '').trim();
    if (unclamped !== originalClassName) {
      el.className = unclamped;
    }
    const unclampedHeight = el.scrollHeight;
    if (unclamped !== originalClassName) {
      el.className = originalClassName;
    }
    const clampedHeight = el.clientHeight;
    setOverflowing(unclampedHeight > clampedHeight + 1);
  }, [content, expanded, maxLines]);

  const clampClass = expanded ? "" : LINE_CLAMP_CLASS[maxLines];
  const proseClassName = [className, clampClass].filter(Boolean).join(" ");

  const proseProps = {
    ref: proseRef,
    className: proseClassName,
    ...(testId ? { "data-testid": testId } : {}),
  };

  const proseElement = html ? (
    <div {...proseProps} dangerouslySetInnerHTML={{ __html: content }} />
  ) : (
    <div {...proseProps}>{content}</div>
  );

  // Only render the toggle when the (collapsed) content actually overflows.
  // When expanded, we keep the toggle visible so the visitor can collapse
  // again — but only if we ever detected overflow in the first place.
  const showToggle = overflowing || expanded;

  return (
    <div data-swoop-part="expandable-prose">
      {proseElement}
      {showToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid={testId ? `${testId}-toggle` : "expandable-prose-toggle"}
          className="mt-1 inline-flex text-xs font-semibold text-swoop-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-swoop-accent"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

ExpandableProse.displayName = "ExpandableProse";
