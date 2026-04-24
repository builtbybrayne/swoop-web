// product/ui/src/errors/classify.ts
//
// Pure classifier: takes anything thrown into the runtime (Error instance,
// error UIMessageChunk payload, stray string) and maps it onto the five
// error surfaces documented in planning/02-impl-chat-surface.md §2.7.
//
// Detection rules — first match wins:
//   1. Message contains `[session_not_found]` OR response status 404 → session_expired
//   2. Message contains `[rate_limited]` OR response status 429 → rate_limited
//   3. Message contains `[stream]` prefix → stream_drop
//      (adapter prefixes mid-stream catch errors with this marker)
//   4. `TypeError` with 'fetch' / 'NetworkError' / 'Failed to fetch' → unreachable
//      — browser-standard shape for "couldn't reach the server".
//   5. Any other Error → unknown
//
// The orchestrator-adapter is responsible for embedding the code markers via
// `throw new Error("Orchestrator /chat failed [session_not_found]: ...")`.
// Changes to the marker format must be mirrored here and in
// cms/errors/en.json's $schema-notes.

export type ErrorSurface =
  | "unreachable"
  | "stream_drop"
  | "session_expired"
  | "rate_limited"
  | "unknown";

export type RuntimeError = {
  surface: ErrorSurface;
  retryable: boolean;
  /** Milliseconds the UI must wait before offering retry again. 0 = immediate. */
  cooloffMs: number;
  /** Raw detail for dev logs; not shown to users. */
  detail: string;
};

const RATE_LIMIT_COOLOFF_MS = 30_000;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    // JSON.stringify(undefined) returns undefined (not a string); always
    // return something .toLowerCase()-able.
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

export function classifyError(err: unknown): RuntimeError {
  const detail = messageOf(err);
  const lower = detail.toLowerCase();

  if (lower.includes("[session_not_found]") || /\b404\b/.test(detail)) {
    return { surface: "session_expired", retryable: false, cooloffMs: 0, detail };
  }
  if (lower.includes("[rate_limited]") || /\b429\b/.test(detail)) {
    return {
      surface: "rate_limited",
      retryable: true,
      cooloffMs: RATE_LIMIT_COOLOFF_MS,
      detail,
    };
  }
  if (lower.includes("[stream]")) {
    return { surface: "stream_drop", retryable: true, cooloffMs: 0, detail };
  }
  const isNetwork =
    err instanceof TypeError &&
    /fetch|networkerror|failed to fetch|load failed/i.test(detail);
  if (isNetwork) {
    return { surface: "unreachable", retryable: true, cooloffMs: 0, detail };
  }
  // Second-chance unreachable: non-TypeError errors that look like connection
  // issues (adapter sometimes wraps them into plain Error). Keep this narrow
  // so unrelated errors don't fall here.
  if (/econnrefused|connection refused|network request failed/i.test(detail)) {
    return { surface: "unreachable", retryable: true, cooloffMs: 0, detail };
  }

  return { surface: "unknown", retryable: true, cooloffMs: 0, detail };
}
