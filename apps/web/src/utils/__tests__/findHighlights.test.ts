import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setFindRanges, clearFindRanges } from '../findHighlights';

class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

function range(text: string): Range {
  const n = document.createTextNode(text);
  document.body.appendChild(n);
  const r = document.createRange();
  r.selectNodeContents(n);
  return r;
}

describe('findHighlights registry', () => {
  let registry: Map<string, FakeHighlight>;
  const g = globalThis as unknown as Record<string, unknown>;
  let savedCss: unknown;
  let savedHighlight: unknown;

  beforeEach(() => {
    savedCss = g.CSS;
    savedHighlight = g.Highlight;
    registry = new Map();
    g.CSS = { highlights: registry };
    g.Highlight = FakeHighlight;
    clearFindRanges('a');
    clearFindRanges('b');
  });

  afterEach(() => {
    clearFindRanges('a');
    clearFindRanges('b');
    g.CSS = savedCss;
    g.Highlight = savedHighlight;
  });

  it('registers the union of two owners and keeps the current range out of vlx-find', () => {
    const a1 = range('a1');
    const a2 = range('a2');
    const b1 = range('b1');
    setFindRanges('a', [a1, a2], a2);
    setFindRanges('b', [b1], null);
    expect(registry.get('vlx-find')?.ranges).toEqual([a1, b1]);
    expect(registry.get('vlx-find-current')?.ranges).toEqual([a2]);
  });

  it('clearing one owner leaves the other', () => {
    const a1 = range('a1');
    const b1 = range('b1');
    setFindRanges('a', [a1], a1);
    setFindRanges('b', [b1], b1);
    clearFindRanges('a');
    expect(registry.get('vlx-find')?.ranges ?? []).toEqual([]);
    expect(registry.get('vlx-find-current')?.ranges).toEqual([b1]);
    clearFindRanges('b');
    expect(registry.has('vlx-find')).toBe(false);
    expect(registry.has('vlx-find-current')).toBe(false);
  });

  it('replaces an owner\'s previous ranges', () => {
    const a1 = range('a1');
    const a2 = range('a2');
    setFindRanges('a', [a1], null);
    setFindRanges('a', [a2], null);
    expect(registry.get('vlx-find')?.ranges).toEqual([a2]);
  });

  it('is a no-op where the API is missing', () => {
    g.CSS = {};
    g.Highlight = undefined;
    expect(() => setFindRanges('a', [range('x')], null)).not.toThrow();
    expect(() => clearFindRanges('a')).not.toThrow();
    delete g.CSS;
    expect(() => setFindRanges('a', [range('x')], null)).not.toThrow();
    expect(() => clearFindRanges('a')).not.toThrow();
  });
});
