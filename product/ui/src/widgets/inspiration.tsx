// product/ui/src/widgets/inspiration.tsx
//
// Renders the output of the `illustrate` tool as ONE large hero image —
// sidebar-width, no visible caption, no mood-tag chips. The annotation stays
// retrieval substrate + `alt` text only (decision D.poincare-2); one strong
// image carries the conversational moment (decision D.poincare-3, Luke Loom
// feedback D3 — planning/03-exec-crosscut-magical-poincare-visual-channel.md).
//
// When the agent explicitly asked for more than one image, the first renders
// as the hero and the rest as a row of small thumbnails below — multi-image
// is agent-explicit, never the default. Tapping any image expands it into an
// inline lightbox overlay (no caption line; `aria-label` carries the alt
// text); the overlay is dismissable via button, Escape key, or click-outside.

import { useEffect, useState } from "react";
import { z } from "zod";
import { IllustrateOutputSchema } from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { ImageBlock } from "../shared";
import {
  renderLifecycleGate,
  safeParse,
  unwrapEnvelope,
  WidgetMalformedPlaceholder,
  WidgetSilentPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

type IllustrateImage = {
  id: string;
  url: string;
  altText: string;
  caption?: string;
  moodTags?: string[];
};

const SHELL_CTX = {
  widgetType: "inspiration",
  toolName: "illustrate",
} as const;

export function InspirationWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  // Hooks before the conditional gates below — they must run on every render
  // path (rules of hooks). Previously sat after the gate/malformed early
  // returns, which flooded the console with React "Expected static flag was
  // missing" internal errors whenever a render crossed the gate boundary.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedId) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Gathering imagery…",
  );
  if (gate) return gate;

  // Validate the outer envelope against the shared schema (ensures the
  // contract in @swoop/common is the source of truth), and re-parse each
  // image with a loosened schema so connector-supplied enrichment fields
  // (caption, moodTags) survive Zod's default strip. They're parse-tolerated
  // but no longer rendered — annotations are retrieval substrate + alt text,
  // never visitor-visible captions (D.poincare-2).
  const outer = safeParse(IllustrateOutputSchema, props.result, SHELL_CTX);
  if (!outer.ok) {
    return <WidgetMalformedPlaceholder {...SHELL_CTX} debug={outer.debug} />;
  }

  const EnrichedImageSchema = z.object({
    id: z.string(),
    url: z.string().url(),
    altText: z.string(),
    caption: z.string().optional(),
    moodTags: z.array(z.string()).optional(),
  });
  // Source: the unwrapped envelope, not `props.result` directly. The
  // connector wraps successful results as `{ ok: true, value: { images } }`
  // (see widget-shell.unwrapEnvelope), so reading `props.result.images`
  // would always miss when the envelope is present.
  const unwrapped = unwrapEnvelope(props.result);
  const rawImages = Array.isArray(
    (unwrapped as { images?: unknown })?.images,
  )
    ? ((unwrapped as { images: unknown[] }).images)
    : [];
  const images: IllustrateImage[] = rawImages
    .map((raw) => EnrichedImageSchema.safeParse(raw))
    .filter((r): r is { success: true; data: IllustrateImage } => r.success)
    .map((r) => r.data);

  // Empty result is the agent's job to handle in prose, not a widget surface.
  // Prod: silent. Dev: indicator distinguishes "tool returned zero" vs
  // "tool returned N but they all failed the inner enriched-image parse"
  // — the hint shows both counts so the developer can tell which.
  // Per crosscut plan 03-exec-crosscut-brave-pare-widget-user-copy-fix.md.
  if (images.length === 0) {
    const reason =
      rawImages.length === 0
        ? "empty result"
        : "all images failed inner parse";
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason={reason}
        hint={{ rawImages: rawImages.length, parsed: images.length }}
      />
    );
  }

  const [hero, ...thumbs] = images;
  const expanded = expandedId
    ? images.find((img) => img.id === expandedId) ?? null
    : null;

  return (
    <section
      data-testid="inspiration"
      data-swoop-part="widget"
      data-swoop-widget="inspiration"
      aria-label="Inspiration imagery"
      className="my-2 w-full"
    >
      {/* Single hero — full width on every surface (sidebar, desktop inline,
          mobile inline all share this shape; the container sets the width).
          No caption, no mood chips: the image and the agent's prose carry
          the moment between them. */}
      <button
        type="button"
        onClick={() => setExpandedId(hero.id)}
        aria-label={`Expand image: ${hero.altText}`}
        data-testid="inspiration-hero"
        className="group block w-full overflow-hidden rounded-swoop-lg border border-swoop-border bg-swoop-surface shadow-swoop-card transition-shadow duration-300 hover:shadow-swoop-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-swoop-accent focus-visible:ring-offset-2"
      >
        <ImageBlock src={hero.url} alt={hero.altText} />
      </button>
      {/* Agent-explicit multi-image: the rest render as small square
          thumbnails below the hero (D.poincare-3 — hero + thumbs, never a
          grid of equals). */}
      {thumbs.length > 0 ? (
        <ul
          data-testid="inspiration-thumbs"
          className="mt-2 flex gap-2 overflow-x-auto pb-1"
        >
          {thumbs.map((img) => (
            <li key={img.id} className="flex-shrink-0">
              <button
                type="button"
                onClick={() => setExpandedId(img.id)}
                aria-label={`Expand image: ${img.altText}`}
                className="group block w-20 overflow-hidden rounded-lg border border-swoop-border bg-swoop-surface shadow-sm transition-all duration-200 hover:border-swoop-accent hover:shadow-swoop-card focus:outline-none focus-visible:ring-2 focus-visible:ring-swoop-accent"
              >
                <ImageBlock src={img.url} alt={img.altText} aspectRatio="1/1" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {expanded ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={expanded.altText}
          data-testid="inspiration-lightbox"
          onClick={() => setExpandedId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#05143a]/80 p-4 backdrop-blur-sm"
        >
          <div
            className="relative flex max-h-full max-w-3xl flex-col overflow-hidden rounded-swoop-lg bg-white shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setExpandedId(null)}
              aria-label="Close expanded image"
              className="absolute right-2.5 top-2.5 z-10 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-swoop-accent shadow-md transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-swoop-accent"
            >
              Close
            </button>
            {/* No caption line — the dialog's aria-label above carries the
                alt text (D.poincare-2). */}
            <ImageBlock src={expanded.url} alt={expanded.altText} loading="eager" />
          </div>
        </div>
      ) : null}
    </section>
  );
}

InspirationWidget.displayName = "InspirationWidget";
