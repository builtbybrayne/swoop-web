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
  const hasImage = typeof src === "string" && src.length > 0 && !failed;

  return (
    <div
      className={[
        "relative w-full overflow-hidden bg-slate-100",
        className,
      ].join(" ")}
      style={{ aspectRatio }}
      data-testid="image-block"
    >
      {hasImage ? (
        <img
          src={src}
          alt={alt}
          loading={loading}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="flex h-full w-full items-center justify-center text-xs text-slate-400"
          data-testid="image-fallback"
        >
          <span aria-hidden="true">image unavailable</span>
        </div>
      )}
    </div>
  );
}

ImageBlock.displayName = "ImageBlock";
