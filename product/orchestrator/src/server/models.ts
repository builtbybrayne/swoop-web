/**
 * `GET /models` — dev/test model-picker catalogue (M-PICK-5).
 *
 * Returns the orchestrator's default model plus the allow-listed ids the
 * dev/test dropdown may switch to. Registered ONLY when the picker is enabled
 * (`config.modelPickerEnabled`: allow-list non-empty AND not production), so in
 * production the route does not exist (404). The list is exactly the set the
 * `/chat` override honours — no model is offered that the orchestrator would
 * silently reject.
 *
 * v1 returns the configured allow-list. A future enhancement can back this with
 * the Anthropic Models API (`client.models.list()`) for live discovery, filtered
 * to this same allow-list. See planning/03-exec-crosscut-test-mode-model-picker.md.
 */

import type { Request, Response } from 'express';

/**
 * Best-effort friendly label from a bare model alias.
 *   claude-opus-4-8            -> "Claude Opus 4.8"
 *   claude-sonnet-4-6          -> "Claude Sonnet 4.6"
 *   claude-fable-5             -> "Claude Fable 5"
 *   claude-sonnet-4-5-20250929 -> "Claude Sonnet 4.5"  (8-digit date snapshot dropped)
 * Anything that doesn't match the `claude-<family>-...` shape is returned as-is.
 */
export function friendlyModelName(id: string): string {
  const parts = id.split('-');
  if (parts[0] !== 'claude' || parts.length < 2 || parts[1] === undefined) return id;
  const family = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
  const version = parts
    .slice(2)
    .filter((p) => !/^\d{8}$/.test(p)) // drop a trailing YYYYMMDD snapshot segment
    .join('.');
  return version ? `Claude ${family} ${version}` : `Claude ${family}`;
}

export interface ModelsHandlerDeps {
  /** `config.ORCHESTRATOR_MODEL` — the default the UI marks/selects. */
  readonly defaultModelId: string;
  /** Allow-listed model ids (`config.MODEL_PICKER_ALLOWLIST`). */
  readonly modelIds: readonly string[];
}

export interface ModelOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Response shape: `default` is a fully-labelled option (so the dropdown can
 * render a friendly "back to default" entry without re-deriving the label
 * client-side), and `models` is the allow-listed set it may switch to.
 */
export interface ModelsResponse {
  readonly default: ModelOption;
  readonly models: readonly ModelOption[];
}

export function createModelsHandler(
  deps: ModelsHandlerDeps,
): (req: Request, res: Response) => void {
  const models: ModelOption[] = deps.modelIds.map((id) => ({
    id,
    label: friendlyModelName(id),
  }));
  const body: ModelsResponse = {
    default: { id: deps.defaultModelId, label: friendlyModelName(deps.defaultModelId) },
    models,
  };
  return function handleModels(_req, res) {
    res.json(body);
  };
}
