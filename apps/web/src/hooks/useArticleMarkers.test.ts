import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useArticleMarkers } from './useArticleMarkers';
import type { Highlight } from '../types';

const h = (
  id: string,
  text: string,
  color: Highlight['color'],
  startOffset: number,
): Highlight => ({
  id,
  normaKey: 'test',
  articleId: '1',
  rangeSerialized: '',
  text,
  color,
  startOffset,
});

function run(rawText: string, highlights: Highlight[]) {
  const { result } = renderHook(() =>
    useArticleMarkers({ rawText, highlights, annotations: [] }),
  );
  return result.current;
}

describe('useArticleMarkers', () => {
  it('leaves text untouched when there are no highlights', () => {
    expect(run('Hello world', [])).toBe('Hello world');
  });

  it('wraps a single highlight in a <mark> tag', () => {
    const html = run('Hello world', [h('a', 'Hello', 'yellow', 0)]);
    expect(html).toContain('<mark');
    expect(html).toContain('data-highlight="a"');
    expect(html).toContain('>Hello</mark>');
  });

  it('renders adjacent highlights with a shared boundary as two siblings (no nesting)', () => {
    // Regression: before the fix, close-tag and open-tag at the same position
    // were inserted in the wrong order, producing
    //   <mark y>ABCDE<mark g></mark>FGHIJ</mark>
    // which made the second highlight invisible and forced its text to inherit
    // the first highlight's color.
    const html = run('ABCDEFGHIJ', [
      h('a', 'ABCDE', 'yellow', 0),
      h('b', 'FGHIJ', 'green', 5),
    ]);
    // Expected shape: <mark a>ABCDE</mark><mark b>FGHIJ</mark>
    const markAIdx = html.indexOf('data-highlight="a"');
    const closeAIdx = html.indexOf('</mark>', markAIdx);
    const markBIdx = html.indexOf('data-highlight="b"');
    expect(markAIdx).toBeGreaterThanOrEqual(0);
    expect(markBIdx).toBeGreaterThan(closeAIdx);
    // And neither mark should contain the other's data-highlight id.
    const aSegment = html.slice(markAIdx, closeAIdx);
    expect(aSegment).not.toContain('data-highlight="b"');
  });

  it('keeps rendering order stable when adjacent highlights are added in reverse order', () => {
    const html = run('ABCDEFGHIJ', [
      h('b', 'FGHIJ', 'green', 5),
      h('a', 'ABCDE', 'yellow', 0),
    ]);
    const markAIdx = html.indexOf('data-highlight="a"');
    const closeAIdx = html.indexOf('</mark>', markAIdx);
    const markBIdx = html.indexOf('data-highlight="b"');
    expect(markAIdx).toBeGreaterThanOrEqual(0);
    expect(markBIdx).toBeGreaterThan(closeAIdx);
  });

  it('renders three chained highlights without cross-nesting', () => {
    const html = run('ABCDEFGHIJKL', [
      h('a', 'ABCD', 'yellow', 0),
      h('b', 'EFGH', 'green', 4),
      h('c', 'IJKL', 'red', 8),
    ]);
    // Each highlight must open and close before the next begins.
    const a = html.indexOf('data-highlight="a"');
    const closeA = html.indexOf('</mark>', a);
    const b = html.indexOf('data-highlight="b"');
    const closeB = html.indexOf('</mark>', b);
    const c = html.indexOf('data-highlight="c"');
    expect(a).toBeLessThan(closeA);
    expect(closeA).toBeLessThan(b);
    expect(b).toBeLessThan(closeB);
    expect(closeB).toBeLessThan(c);
  });

  it('still nests an inner highlight fully contained within an outer one', () => {
    const html = run('ABCDEFGHIJ', [
      h('outer', 'ABCDEFGHIJ', 'yellow', 0),
      h('inner', 'DEFG', 'green', 3),
    ]);
    // The inner highlight sits inside the outer one.
    const outer = html.indexOf('data-highlight="outer"');
    const inner = html.indexOf('data-highlight="inner"');
    expect(outer).toBeLessThan(inner);
    // Two opens and two closes total.
    expect(html.match(/<mark /g)?.length).toBe(2);
    expect(html.match(/<\/mark>/g)?.length).toBe(2);
  });

  it('pins highlights to distinct occurrences of the same text via startOffset', () => {
    // Regression guard for the Study Mode global-regex renderer: if someone
    // re-introduces a `text.replace(regex, ...)`-style highlighter, two
    // occurrences of the same word will both get wrapped as a single colour
    // and this test will fail.
    const raw = 'legge della legge';
    // offsets: "legge" at 0-5, second "legge" at 12-17
    const html = run(raw, [
      h('first', 'legge', 'yellow', 0),
      h('second', 'legge', 'green', 12),
    ]);

    // Each id appears exactly once.
    expect(html.match(/data-highlight="first"/g)?.length).toBe(1);
    expect(html.match(/data-highlight="second"/g)?.length).toBe(1);

    // Exactly two <mark> wrappers — not four (which is what global match would
    // have produced, wrapping both occurrences for each highlight).
    expect(html.match(/<mark /g)?.length).toBe(2);

    // And the middle "della" is NOT wrapped.
    const firstClose = html.indexOf('</mark>');
    const afterFirst = html.slice(firstClose, html.indexOf('<mark ', firstClose));
    expect(afterFirst).toContain('della');
    expect(afterFirst).not.toContain('<mark');
  });
});
