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

// D.t9-mount-rehydrate — mount-time history rehydrate.
export {
  fetchSessionHistory,
  fetchSessionHistoryAt,
  isFetchHistorySuccess,
} from "./rehydrate";
export type { FetchHistoryResult } from "./rehydrate";
export {
  replayPartsIntoThread,
  REHYDRATED_MESSAGE_ID,
} from "./replay-into-thread";
export { useRehydrate } from "./use-rehydrate";
export type {
  RehydrateStatus,
  UseRehydrateOptions,
  UseRehydrateResult,
} from "./use-rehydrate";
