import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';

import { friendlyModelName, createModelsHandler } from '../models.js';

describe('friendlyModelName', () => {
  it.each([
    ['claude-opus-4-8', 'Claude Opus 4.8'],
    ['claude-opus-4-7', 'Claude Opus 4.7'],
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
    ['claude-fable-5', 'Claude Fable 5'],
    ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5'], // 8-digit snapshot dropped
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
    ['gpt-4', 'gpt-4'], // non-claude returned as-is
  ] as const)('%s -> %s', (id, label) => {
    expect(friendlyModelName(id)).toBe(label);
  });
});

describe('createModelsHandler', () => {
  it('returns the default model + labelled allow-list', () => {
    const handler = createModelsHandler({
      defaultModelId: 'claude-sonnet-4-5-20250929',
      modelIds: ['claude-sonnet-4-6', 'claude-opus-4-8'],
    });
    let body: unknown;
    const res = { json: (b: unknown) => { body = b; } } as unknown as Response;
    handler({} as unknown as Request, res);
    expect(body).toEqual({
      default: { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      models: [
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      ],
    });
  });
});
