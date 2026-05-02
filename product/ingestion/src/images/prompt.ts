/**
 * Prompt loader for the C.t6 image annotation pipeline.
 *
 * Loads `product/cms/prompts/etl/image-annotation/prompt.md` once at
 * startup and exposes it as the system prompt for the Vision call.
 * Prompt iteration is a content task (operator edits the markdown,
 * re-runs the pipeline against a slice). Per the G.11 convention,
 * prose lives in CMS, not in TypeScript.
 *
 * The path resolution mirrors the orchestrator's prompt-loader: walk
 * up from this file to find the `product/` root, then descend to
 * `cms/prompts/etl/image-annotation/prompt.md`. Verified by the
 * snapshot test in `__tests__/prompt.test.ts`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Absolute path to the runtime annotation prompt.
 *
 * The CMS folder is a sibling of the `ingestion/` workspace inside
 * `product/`. Walk up two levels (src/images → src → ingestion package
 * root) to land at the workspace root, then up once more to `product/`,
 * then descend to `cms/prompts/etl/image-annotation/prompt.md`.
 */
export function resolvePromptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here = .../product/ingestion/src/images
  const productRoot = path.resolve(here, '..', '..', '..');
  return path.resolve(productRoot, 'cms', 'prompts', 'etl', 'image-annotation', 'prompt.md');
}

/**
 * Read the prompt from disk. Throws if the file is missing — fail-fast
 * is the right call: we'd rather discover a missing prompt at boot than
 * burn through a budget call only for the model to receive a blank
 * system prompt.
 */
export function loadPrompt(promptPath: string = resolvePromptPath()): string {
  if (!existsSync(promptPath)) {
    throw new Error(
      `[annotate] prompt file not found at ${promptPath}. ` +
        `Run from the product/ workspace root and ensure cms/prompts/etl/image-annotation/prompt.md exists.`,
    );
  }
  const text = readFileSync(promptPath, 'utf-8');
  if (text.trim().length === 0) {
    throw new Error(`[annotate] prompt file at ${promptPath} is empty.`);
  }
  return text;
}
