/**
 * Description-loader tests — verifies the fail-fast contract per HITL Q3.
 *
 * Per HITL Q3 ratification: every tool's description.md must load at boot,
 * for ALL tools. Missing or empty file = throw at boot, not silent
 * degradation. Test simulates a missing file by pointing at a tmpdir that
 * carries some but not all files.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadAllToolDescriptions,
  ALL_TOOL_NAMES,
  ToolDescriptionLoadError,
} from '../description-loader.js';

function makeTempToolsDir(populated: ReadonlyArray<string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'connector-tools-'));
  for (const tool of populated) {
    const dir = path.join(root, tool);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'description.md'),
      `Description for ${tool}.\n`,
      'utf8',
    );
  }
  return root;
}

describe('loadAllToolDescriptions', () => {
  it('loads every tool description when all files exist', () => {
    const root = makeTempToolsDir(ALL_TOOL_NAMES);
    try {
      const descriptions = loadAllToolDescriptions(root);
      for (const name of ALL_TOOL_NAMES) {
        expect(descriptions[name]).toMatch(/Description for/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws ToolDescriptionLoadError when any tool description is missing', () => {
    // Populate all but one — the missing one should fail-fast.
    const populated = ALL_TOOL_NAMES.filter((n) => n !== 'illustrate');
    const root = makeTempToolsDir(populated);
    try {
      expect(() => loadAllToolDescriptions(root)).toThrowError(
        ToolDescriptionLoadError,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws ToolDescriptionLoadError when a description.md is empty', () => {
    const root = makeTempToolsDir(ALL_TOOL_NAMES);
    // Wipe one file's contents.
    writeFileSync(path.join(root, 'lookup', 'description.md'), '   \n', 'utf8');
    try {
      expect(() => loadAllToolDescriptions(root)).toThrowError(
        ToolDescriptionLoadError,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('failure message names the missing tool + its expected path', () => {
    const populated = ALL_TOOL_NAMES.filter((n) => n !== 'find_proof');
    const root = makeTempToolsDir(populated);
    try {
      expect(() => loadAllToolDescriptions(root)).toThrow(/find_proof/);
      expect(() => loadAllToolDescriptions(root)).toThrow(/description\.md/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
