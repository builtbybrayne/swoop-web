import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import {
  parseFrontmatter,
  loadClassifierPrompt,
  resolveEtlPromptsRoot,
  DEFAULT_HAIKU_MODEL,
} from '../prompts.js';
import { CLASSIFIER_SCHEMAS, TipTopicOutputSchema } from '../schemas.js';

describe('parseFrontmatter', () => {
  it('returns empty when no frontmatter present', () => {
    const r = parseFrontmatter('Just body text\n');
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe('Just body text\n');
  });

  it('extracts version, model, temperature', () => {
    const raw = `---
version: 2
model: claude-haiku-4-5-20251001
temperature: 0.7
---

System prompt body here.`;
    const r = parseFrontmatter(raw);
    expect(r.frontmatter.version).toBe(2);
    expect(r.frontmatter.model).toBe('claude-haiku-4-5-20251001');
    expect(r.frontmatter.temperature).toBe(0.7);
    expect(r.body).toBe('System prompt body here.');
  });

  it('strips quotes', () => {
    const raw = `---
model: "claude-haiku-4-5"
---

x`;
    const r = parseFrontmatter(raw);
    expect(r.frontmatter.model).toBe('claude-haiku-4-5');
  });

  it('skips comment lines', () => {
    const raw = `---
# this is a comment
version: 1
---

body`;
    const r = parseFrontmatter(raw);
    expect(r.frontmatter.version).toBe(1);
  });

  it('handles unterminated frontmatter gracefully', () => {
    const raw = `---
not closed
keep going`;
    const r = parseFrontmatter(raw);
    // No closing fence → returns as-is.
    expect(r.frontmatter).toEqual({});
  });
});

describe('loadClassifierPrompt', () => {
  it('loads a real classifier prompt from temp dir', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'enrich-prompts-'));
    const subdir = path.join(dir, 'blog-post-job');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(
      path.join(subdir, 'prompt.md'),
      `---
version: 3
model: my-model
temperature: 0.0
---

Hello prompt body.`,
    );
    const r = await loadClassifierPrompt('blog-post-job', {
      rootDir: dir,
      schema: CLASSIFIER_SCHEMAS['blog-post-job'],
    });
    expect(r.frontmatter.version).toBe(3);
    expect(r.frontmatter.model).toBe('my-model');
    expect(r.systemPrompt).toBe('Hello prompt body.');
    expect(r.schema).toBe(CLASSIFIER_SCHEMAS['blog-post-job']);
  });

  it('throws when prompt.md missing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'enrich-prompts-'));
    await expect(
      loadClassifierPrompt('blog-post-job', {
        rootDir: dir,
        schema: z.object({}),
      }),
    ).rejects.toThrow(/prompt not found/);
  });

  it('falls back to defaults for missing frontmatter fields', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'enrich-prompts-'));
    const subdir = path.join(dir, 'partial');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(path.join(subdir, 'prompt.md'), 'Just body.');
    const r = await loadClassifierPrompt('partial', { rootDir: dir, schema: z.object({}) });
    expect(r.frontmatter.model).toBe(DEFAULT_HAIKU_MODEL);
    expect(r.frontmatter.temperature).toBe(0.0);
    expect(r.frontmatter.version).toBe(1);
  });
});

describe('resolveEtlPromptsRoot', () => {
  it('honours explicit override', () => {
    expect(resolveEtlPromptsRoot('/tmp', '/explicit/path')).toBe('/explicit/path');
  });
});

describe('tip-topic classifier (real prompt + schema)', () => {
  // Walk up from this test file to the real cms/prompts/etl root so we exercise
  // the committed prompt, not a fixture — this guards the find_tips ETL stage.
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  const etlRoot = resolveEtlPromptsRoot(startDir);

  it('loads the committed tip-topic prompt with version 1, haiku, temp 0.0', async () => {
    const r = await loadClassifierPrompt('tip-topic', {
      rootDir: etlRoot,
      schema: CLASSIFIER_SCHEMAS['tip-topic'],
    });
    expect(r.frontmatter.version).toBe(1);
    expect(r.frontmatter.model).toBe('claude-haiku-4-5-20251001');
    expect(r.frontmatter.temperature).toBe(0.0);
    // Body is the classifier instructions, frontmatter stripped.
    expect(r.systemPrompt).toMatch(/find_tips/);
    expect(r.systemPrompt).not.toMatch(/^---/);
    expect(r.schema).toBe(TipTopicOutputSchema);
  });

  it('wires the tip-topic schema into CLASSIFIER_SCHEMAS', () => {
    expect(CLASSIFIER_SCHEMAS['tip-topic']).toBe(TipTopicOutputSchema);
  });

  it('defaults topic_tags to [] and leaves region absent on an empty object', () => {
    const parsed = TipTopicOutputSchema.parse({});
    expect(parsed.topic_tags).toEqual([]);
    expect(parsed.region).toBeUndefined();
  });

  it('accepts the fixed taxonomy and an optional region', () => {
    const parsed = TipTopicOutputSchema.parse({
      topic_tags: ['packing', 'weather'],
      region: 'Torres del Paine',
    });
    expect(parsed.topic_tags).toEqual(['packing', 'weather']);
    expect(parsed.region).toBe('Torres del Paine');
  });

  it('rejects a topic label outside the fixed taxonomy', () => {
    expect(() =>
      TipTopicOutputSchema.parse({ topic_tags: ['wildlife'] }),
    ).toThrow();
  });
});
