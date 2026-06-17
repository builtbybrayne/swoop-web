// product/ui/src/runtime/model-picker.tsx
//
// Dev/test-only navbar dropdown to flip the conversational orchestrator's
// model at runtime (M-PICK). Mounts only under `import.meta.env.DEV`; fetches
// the allow-list from the orchestrator's dev `GET /models` and renders nothing
// when the picker is disabled (empty allow-list / production / route missing).
//
// Changing the model re-mints the session via `onModelChange` (the parent's
// fresh-chat handler) so a model is fixed for a session's life — no
// mid-conversation swap (M-PICK-6). The chosen id is persisted by the store
// (`dev-model-store.ts`) and attached to the next `/chat` body by the transport.
//
// See planning/03-exec-crosscut-test-mode-model-picker.md.

import { useEffect, useState } from "react";
import { getOrchestratorUrl } from "./orchestrator-adapter";
import {
  setDevModelOverride,
  useDevModelOverride,
} from "./dev-model-store";

/** One labelled model the orchestrator's dev `GET /models` offers. */
export interface DevModelOption {
  readonly id: string;
  readonly label: string;
}

/** Shape of the orchestrator's dev `GET /models` response (M-PICK-5). */
export interface DevModelsResponse {
  readonly default: DevModelOption;
  readonly models: readonly DevModelOption[];
}

/**
 * Fetch the dev model allow-list from the orchestrator. Resolves to `null`
 * when the picker is disabled (the route 404s in production / when the
 * allow-list is empty) or on any error — callers treat `null` as "no picker,
 * render nothing". Never throws.
 */
export async function fetchDevModels(
  signal?: AbortSignal,
): Promise<DevModelsResponse | null> {
  if (!import.meta.env.DEV) return null;
  try {
    const res = await fetch(`${getOrchestratorUrl()}/models`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as DevModelsResponse;
    if (
      typeof json?.default?.id !== "string" ||
      typeof json?.default?.label !== "string" ||
      !Array.isArray(json?.models)
    ) {
      return null;
    }
    return json;
  } catch {
    // Network error / aborted / non-JSON — treat as "no picker".
    return null;
  }
}

export interface DevModelPickerProps {
  /** Called after a model change so the parent can start a fresh session. */
  readonly onModelChange: () => void;
}

export function DevModelPicker({ onModelChange }: DevModelPickerProps) {
  const [catalog, setCatalog] = useState<DevModelsResponse | null>(null);
  const override = useDevModelOverride();

  // Fetch the allow-list once on mount. Aborts on unmount; `null` (disabled /
  // error) leaves `catalog` null → the component renders nothing.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const ac = new AbortController();
    void fetchDevModels(ac.signal).then((res) => {
      if (!ac.signal.aborted) setCatalog(res);
    });
    return () => ac.abort();
  }, []);

  // Drop a persisted override that's no longer allow-listed (allow-list
  // changed between sessions) — fall back to the default rather than ship an
  // id the orchestrator would silently ignore.
  useEffect(() => {
    if (catalog === null || override === undefined) return;
    const known =
      override === catalog.default.id ||
      catalog.models.some((m) => m.id === override);
    if (!known) setDevModelOverride(undefined);
  }, [catalog, override]);

  if (!import.meta.env.DEV || catalog === null) return null;

  const selected = override ?? catalog.default.id;
  // Default first, then the allow-listed alternatives (excluding the default
  // id if it also appears in the allow-list, to avoid a duplicate option).
  const alternatives = catalog.models.filter((m) => m.id !== catalog.default.id);

  return (
    <label
      data-testid="dev-model-picker"
      data-swoop-part="dev-model-picker"
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white pl-2 pr-1 text-xs font-medium text-slate-700"
    >
      <span className="text-slate-400">Model</span>
      <select
        aria-label="Conversational model (dev/test only)"
        value={selected}
        onChange={(e) => {
          const next = e.target.value;
          setDevModelOverride(next === catalog.default.id ? undefined : next);
          // Switching model forces a fresh session (M-PICK-6).
          onModelChange();
        }}
        className="h-full cursor-pointer rounded-r-md bg-transparent pr-1 text-xs font-medium text-slate-700 focus:outline-none"
      >
        <option value={catalog.default.id}>{catalog.default.label} (default)</option>
        {alternatives.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}

DevModelPicker.displayName = "DevModelPicker";
