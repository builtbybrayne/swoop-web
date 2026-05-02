import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToToolInputSchema } from '../zod-to-json-schema.js';

describe('zodToToolInputSchema', () => {
  it('handles a flat object with string + number', () => {
    const schema = z.object({
      title: z.string(),
      score: z.number(),
    });
    const j = zodToToolInputSchema(schema) as Record<string, unknown>;
    expect(j.type).toBe('object');
    const props = j.properties as Record<string, { type: string }>;
    expect(props.title!.type).toBe('string');
    expect(props.score!.type).toBe('number');
    expect(j.required).toContain('title');
    expect(j.required).toContain('score');
  });

  it('marks optional fields as not required', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string().optional(),
    });
    const j = zodToToolInputSchema(schema) as Record<string, unknown>;
    expect(j.required).toContain('a');
    expect(j.required).not.toContain('b');
  });

  it('handles enum', () => {
    const schema = z.object({ side: z.enum(['left', 'right']) });
    const j = zodToToolInputSchema(schema) as Record<string, unknown>;
    const props = j.properties as Record<string, { type: string; enum: string[] }>;
    expect(props.side!.type).toBe('string');
    expect(props.side!.enum).toEqual(['left', 'right']);
  });

  it('handles array of strings', () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const j = zodToToolInputSchema(schema) as Record<string, unknown>;
    const props = j.properties as Record<string, { type: string; items: { type: string } }>;
    expect(props.tags!.type).toBe('array');
    expect(props.tags!.items.type).toBe('string');
  });

  it('handles default values as not required', () => {
    const schema = z.object({ list: z.array(z.string()).default([]) });
    const j = zodToToolInputSchema(schema) as Record<string, unknown>;
    // When all fields are optional, `required` is dropped entirely.
    const required = (j.required ?? []) as string[];
    expect(required).not.toContain('list');
  });

  it('disables additionalProperties on objects', () => {
    const schema = z.object({ a: z.string() });
    const j = zodToToolInputSchema(schema) as Record<string, unknown>;
    expect(j.additionalProperties).toBe(false);
  });
});
