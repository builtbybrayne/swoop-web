/**
 * Unit tests for the tiny `{{path}}` template renderer (E.t3).
 */

import { describe, expect, it } from 'vitest';

import { renderTemplate } from '../template-renderer.js';

describe('renderTemplate', () => {
  it('substitutes a single top-level placeholder', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'Alex' })).toBe('Hello Alex!');
  });

  it('walks dotted paths through nested objects', () => {
    const out = renderTemplate('Email: {{contact.email}}', {
      contact: { email: 'al@buddyapps.co' },
    });
    expect(out).toBe('Email: al@buddyapps.co');
  });

  it('renders missing values as empty strings', () => {
    expect(renderTemplate('hello {{missing}} world', {})).toBe('hello  world');
  });

  it('renders deeply missing paths as empty strings (no throw on null traversal)', () => {
    expect(renderTemplate('{{a.b.c.d}}', { a: { b: null } })).toBe('');
    expect(renderTemplate('{{a.b.c.d}}', { a: 'string-not-object' })).toBe('');
  });

  it('tolerates whitespace inside braces', () => {
    expect(renderTemplate('{{  spaced  }}', { spaced: 'ok' })).toBe('ok');
  });

  it('preserves placeholders containing disallowed characters', () => {
    // The pattern only matches alphanumerics + underscore + dot. A space
    // inside the path stops the match — the literal stays.
    expect(renderTemplate('{{a b}}', { 'a b': 'never' })).toBe('{{a b}}');
  });

  it('coerces non-string primitive values via String()', () => {
    expect(renderTemplate('{{n}}', { n: 42 })).toBe('42');
    expect(renderTemplate('{{b}}', { b: true })).toBe('true');
  });

  it('substitutes multiple placeholders independently', () => {
    const out = renderTemplate('{{a}} {{b}} {{a}}', { a: 'x', b: 'y' });
    expect(out).toBe('x y x');
  });

  it('handles arrays/objects by stringifying — caller should pre-format them', () => {
    // Documenting the contract: arrays render as their default String()
    // representation. Authors are expected to pre-format arrays into
    // human-readable strings exposed at named keys.
    const out = renderTemplate('{{list}}', { list: ['a', 'b'] });
    expect(out).toBe('a,b');
  });
});
