// product/ui/src/widgets/inspiration.tsx
//
// Renders the output of the `illustrate` tool. A horizontally-scrolling
// strip of curated images with optional mood tags + captions. Tapping an
// image expands it into an inline lightbox overlay; the overlay is
// dismissable via button, Escape key, or click-outside.

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
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Gathering imagery…",
  );
  if (gate) return gate;

  // Validate the outer envelope against the shared schema (ensures the
  // contract in @swoop/common is the source of truth), and re-parse each
  // image with a loosened schema so connector-supplied enrichment fields
  // (moodTags) survive Zod's default strip.
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

  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedId) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

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
      {/* Mobile: horizontal scroll strip (swipe feels natural on touch).
          ≥sm: grid (2 cols), ≥md: 3 cols. Lets desktop visitors scan
          the whole set at once rather than overflow-scrolling sideways. */}
      <ul className="flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 md:grid-cols-3">
        {images.map((img) => (
          <li key={img.id} className="flex-shrink-0 sm:flex-shrink">
            <button
              type="button"
              onClick={() => setExpandedId(img.id)}
              aria-label={`Expand image: ${img.altText}`}
              className="flex w-48 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-400 sm:w-full"
            >
              <ImageBlock src={img.url} alt={img.altText} />
              <div className="flex flex-col gap-1 p-2">
                {img.caption ? (
                  <p className="line-clamp-2 text-xs text-slate-700">{img.caption}</p>
                ) : null}
                {img.moodTags && img.moodTags.length > 0 ? (
                  <div
                    data-testid="inspiration-moods"
                    className="flex flex-wrap gap-1"
                  >
                    {img.moodTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {expanded ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={expanded.altText}
          data-testid="inspiration-lightbox"
          onClick={() => setExpandedId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div
            className="relative flex max-h-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white"
            onClick={(ev) => ev.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setExpandedId(null)}
              aria-label="Close expanded image"
              className="absolute right-2 top-2 z-10 rounded-full bg-white/90 px-2 py-1 text-sm text-slate-800 shadow hover:bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              Close
            </button>
            <ImageBlock src={expanded.url} alt={expanded.altText} loading="eager" />
            {expanded.caption ? (
              <p className="px-4 py-3 text-sm text-slate-700">{expanded.caption}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

InspirationWidget.displayName = "InspirationWidget";
