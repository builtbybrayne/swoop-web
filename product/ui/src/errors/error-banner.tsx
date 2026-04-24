// product/ui/src/errors/error-banner.tsx
//
// Presentational banner for chunk D.t5's five error surfaces. Reads copy from
// cms/errors/en.json (Vite's JSON import gives us a typed constant). Null
// error → renders nothing.
//
// Action buttons are wired from the copy: a button with `kind: "retry"`
// invokes `onRetry`, `kind: "restart"` invokes `onRestart`, `kind: "dismiss"`
// invokes `onDismiss`. Rate-limited surfaces get a brief cool-off countdown
// that disables retry until expiry — UX placeholder only (no server-side
// cool-off is wired for Puma).

import { useEffect, useState } from "react";
import type { ErrorSurface, RuntimeError } from "./classify";
// Vite natively resolves JSON imports; the cast satisfies TS without a
// runtime validation step (the file is authored-then-frozen content).
import copyJson from "../../../cms/errors/en.json";

type ActionKind = "retry" | "restart" | "dismiss";

interface Action {
  label: string;
  kind: ActionKind;
}

interface ErrorCopy {
  title: string;
  body: string;
  primary?: Action;
  secondary?: Action;
}

type ErrorCopyRecord = Record<ErrorSurface | "tool_error", ErrorCopy>;

// The $schema-notes key in the JSON lives alongside the real entries; cast it
// away so the indexer type-checks.
const COPY = copyJson as unknown as ErrorCopyRecord & Record<string, unknown>;

export interface ErrorBannerProps {
  error: RuntimeError | null;
  onRetry: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

function useCooloff(activeForError: RuntimeError | null): number {
  // Returns seconds remaining on the cool-off, 0 when done.
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!activeForError || activeForError.cooloffMs <= 0) {
      setRemaining(0);
      return;
    }
    const start = Date.now();
    const tick = (): void => {
      const elapsed = Date.now() - start;
      const left = Math.max(
        0,
        Math.ceil((activeForError.cooloffMs - elapsed) / 1000),
      );
      setRemaining(left);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activeForError]);

  return remaining;
}

function classesForSurface(surface: ErrorSurface): string {
  // rose for hard "you must start over"; amber for recoverable; slate for
  // unknown. Kept in one place so the banner stays visually consistent.
  switch (surface) {
    case "session_expired":
      return "border-rose-300 bg-rose-50 text-rose-900";
    case "rate_limited":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "unreachable":
    case "stream_drop":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "unknown":
    default:
      return "border-slate-300 bg-slate-50 text-slate-900";
  }
}

export function ErrorBanner({
  error,
  onRetry,
  onRestart,
  onDismiss,
}: ErrorBannerProps) {
  const cooloff = useCooloff(error);

  if (!error) return null;

  const surfaceKey: ErrorSurface = error.surface;
  const copy = COPY[surfaceKey];
  if (!copy) return null;

  const retryDisabled = error.surface === "rate_limited" && cooloff > 0;

  const runAction = (kind: ActionKind): void => {
    if (kind === "retry") onRetry();
    else if (kind === "restart") onRestart();
    else onDismiss();
  };

  const primaryLabel =
    copy.primary && retryDisabled && copy.primary.kind === "retry"
      ? `${copy.primary.label} (${cooloff}s)`
      : copy.primary?.label;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="error-banner"
      data-error-surface={error.surface}
      className={`mx-auto mb-2 mt-2 w-full max-w-2xl rounded-md border px-3 py-2 text-sm shadow-sm ${classesForSurface(error.surface)}`}
    >
      <div className="flex flex-col gap-1">
        <div className="font-medium">{copy.title}</div>
        <div className="text-[13px] leading-5 opacity-90">{copy.body}</div>
        {(copy.primary || copy.secondary) && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {copy.primary && (
              <button
                type="button"
                onClick={() => runAction(copy.primary!.kind)}
                disabled={retryDisabled && copy.primary.kind === "retry"}
                className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {primaryLabel}
              </button>
            )}
            {copy.secondary && (
              <button
                type="button"
                onClick={() => runAction(copy.secondary!.kind)}
                className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {copy.secondary.label}
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Exposed for widget-shell.tsx to render tool-call failure inline. */
export function getToolErrorCopy(): ErrorCopy {
  return COPY.tool_error;
}
