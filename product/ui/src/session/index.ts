// product/ui/src/session/index.ts
//
// Barrel — D.t6.
//
// One import path for the proactive session-preflight machinery:
//
//   import { usePreflight, IDLE_PREFLIGHT_MS } from "./session";
//
// Mirrors the pattern used by `disclosure/`, `errors/`, `parts/`.

export {
  IDLE_PREFLIGHT_MS,
  NETWORK_ERROR,
  PROBE_DEBOUNCE_MS,
  probeCurrentSession,
  probeSession,
} from "./preflight";
export type {
  NetworkErrorSentinel,
  ProbeResult,
  SessionPingResponse,
} from "./preflight";
export { usePreflight } from "./use-preflight";
export type { UsePreflightOptions } from "./use-preflight";
