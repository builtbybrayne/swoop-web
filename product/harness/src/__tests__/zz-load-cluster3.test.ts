import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadScenarios } from '../scenario.js';

describe('cluster 3 scenarios', () => {
  it('loads agent-3XX files', () => {
    const loaded = loadScenarios(path.resolve(__dirname, '..', '..', 'scenarios'));
    const mine = loaded.filter(l => /agent-3\d\d-/.test(path.basename(l.file)));
    expect(mine.length).toBe(8);
    for (const m of mine) {
      const s = m.scenario;
      expect('userAgent' in s).toBe(true);
      const a = s.assertions ?? [];
      expect(a.length).toBeGreaterThanOrEqual(2);
      console.log(' -', path.basename(m.file), '| assertions:', a.length, '| kinds:', a.map(x => x.kind).join(','));
    }
  });
});
