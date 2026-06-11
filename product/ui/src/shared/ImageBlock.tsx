// product/ui/src/shared/ImageBlock.tsx
//
// Renders an <img> with lazy-loading + a graceful placeholder fallback when
// the URL is missing or fails to load. Keeps the component dumb — no CDN
// abstractions, no imgix query string construction (Swoop's CDN handles that
// upstream; see planning/03-exec-chat-surface-t3.md "Image loading").

import { useState } from "react";

export type ImageBlockProps = {
  src?: string;
  alt: string;
  /** Optional explicit aspect ratio (e.g. "16/9"). */
  aspectRatio?: string;
  className?: string;
  /** Passed through to <img>. Defaults to "lazy". */
  loading?: "lazy" | "eager";
};

export function ImageBlock({
  src,
  alt,
  aspectRatio = "16/9",
  className = "",
  loading = "lazy",
}: ImageBlockProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hasImage = typeof src === "string" && src.length > 0 && !failed;

  return (
    <div
      className={[
        "relative w-full overflow-hidden bg-swoop-tint",
        className,
      ].join(" ")}
      style={{ aspectRatio }}
      data-testid="image-block"
    >
      {hasImage ? (
        // Fade in on decode; drift gently when an ancestor carrying `group`
        // is hovered (cards / hero buttons opt in by declaring `group` —
        // contexts like the lightbox simply don't, and get a static image).
        <img
          src={src}
          alt={alt}
          loading={loading}
          // Cache-hit images can be `complete` before React attaches onLoad;
          // the ref callback catches that path so they never sit at opacity-0.
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) setLoaded(true);
          }}
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          className={[
            "h-full w-full object-cover",
            "transition-[opacity,transform] duration-700 ease-out",
            "motion-safe:group-hover:scale-[1.04]",
            loaded ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-400"
          data-testid="image-fallback"
        >
          {/* Quiet peak glyph — abstract line work, not imagery. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 48 24"
            className="h-5 w-10 text-swoop-deep"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 22 14 6l8 10 6-8 16 14" />
          </svg>
          <span aria-hidden="true" className="text-[11px]">
            Image unavailable
          </span>
        </div>
      )}
    </div>
  );
}

ImageBlock.displayName = "ImageBlock";
