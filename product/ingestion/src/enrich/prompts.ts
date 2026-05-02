/**
 * Classifier prompt loader.
 *
 * Reads `cms/prompts/etl/<classifier>/prompt.md` (with YAML frontmatter) +
 * `cms/prompts/etl/<classifier>/output-schema.ts` (Zod schema). Returns the
 * pair so the classifier driver can submit Anthropic Batches API requests.
 *
 * Plan: planning/03-exec-c-t3a.md §"Outputs — prompts.ts" + §"Classifier
 * prompts (CMS)" + §"Open question #C.36" (frontmatter version field).
 *
 * Frontmatter schema:
 *   ---
 *   version: 1
 *   model: claude-haiku-4-5-20251001
 *   temperature: 0.0
 *   ---
 *
 * Frontmatter parsed by a tiny inline parser (no gray-matter dep — the
 * format is small enough we can handle it cleanly).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ZodTypeAny } from 'zod';

export interface PromptFrontmatter {
  version: number;
  model: string;
  temperature: number;
}

export interface LoadedPrompt {
  /** Classifier folder name, e.g. 'blog-post-job'. */
  name: string;
  /** Full filesystem path to the prompt.md. */
  promptPath: string;
  /** System prompt body (markdown), with frontmatter stripped. */
  systemPrompt: string;
  /** Frontmatter values. */
  frontmatter: PromptFrontmatter;
  /** Output schema. */
  schema: ZodTypeAny;
}

export const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_TEMPERATURE = 0.0;

/**
 * Resolve `cms/prompts/etl/`. Walks up from `startDir` to find the repo
 * root marker, mirroring `resolveDataRoot` in blog/fetch.ts. Override via
 * `cmsRoot` for tests.
 */
export function resolveEtlPromptsRoot(startDir: string, cmsRoot?: string): string {
  if (cmsRoot) return cmsRoot;
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'product', 'cms', 'prompts', 'etl');
    if (existsSync(candidate)) return candidate;
    const altCandidate = path.join(dir, 'cms', 'prompts', 'etl');
    if (existsSync(altCandidate)) return altCandidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `[enrich/prompts] cannot resolve cms/prompts/etl from ${startDir}; pass cmsRoot explicitly`,
  );
}

/**
 * Parse YAML-ish frontmatter. Handles the three keys we care about:
 * `version`, `model`, `temperature`. Robust to comments + leading whitespace.
 *
 * We don't pull `gray-matter` — the format here is small and our needs are
 * narrow. Three keys, three types. If the prompt format grows we can swap
 * in a real YAML parser without changing callers.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Partial<PromptFrontmatter>;
  body: string;
} {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }
  const endIdx = raw.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: raw };
  }
  const fmRaw = raw.slice(3, endIdx);
  // Strip the closing fence + any leading whitespace lines so the body
  // starts at the first real content character.
  const body = raw.slice(endIdx + 4).replace(/^\s*\n/, '');
  const frontmatter: Partial<PromptFrontmatter> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(trimmed);
    if (!m) continue;
    const key = m[1]!;
    let value: string = m[2]!.trim();
    // Strip optional quotes.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key === 'version') frontmatter.version = Number(value);
    else if (key === 'model') frontmatter.model = value;
    else if (key === 'temperature') frontmatter.temperature = Number(value);
  }
  return { frontmatter, body };
}

/**
 * Load a single classifier's prompt + schema.
 *
 * `schemaImport` is a function the caller provides to import the schema
 * file — TS dynamic-imports differ between bundler / dev / build configs,
 * so we keep import strategy at the call site. Passing the schema object
 * directly is also valid (and what tests do).
 */
export async function loadClassifierPrompt(
  name: string,
  options: {
    rootDir: string;
    /** Schema must be supplied by the caller — see schemas/index.ts. */
    schema: ZodTypeAny;
  },
): Promise<LoadedPrompt> {
  const promptPath = path.join(options.rootDir, name, 'prompt.md');
  if (!existsSync(promptPath)) {
    throw new Error(
      `[enrich/prompts] prompt not found: ${promptPath} — every classifier needs cms/prompts/etl/<name>/prompt.md`,
    );
  }
  const raw = readFileSync(promptPath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    name,
    promptPath,
    systemPrompt: body.trim(),
    frontmatter: {
      version: frontmatter.version ?? 1,
      model: frontmatter.model ?? DEFAULT_HAIKU_MODEL,
      temperature: frontmatter.temperature ?? DEFAULT_TEMPERATURE,
    },
    schema: options.schema,
  };
}
