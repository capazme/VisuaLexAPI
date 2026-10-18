import { describe, expect, it } from 'vitest';
import type { Annotation, Highlight } from '../../../types';
import type { ResolvedAnchor } from '../../../utils/articleAnnotations';
import { EXCERPT_GAP, articleTextBetween, excerptParts } from './pdfExcerpts';

const hl = (start: number, end: number): ResolvedAnchor => ({ kind: 'highlight', highlight: { id: `h${start}` } as Highlight, start, end });
const nt = (start: number, end: number, text: string): ResolvedAnchor => ({ kind: 'note', note: { id: `n${start}`, text } as Annotation, start, end });

// 20 characters; the text of a range is the range itself, so a passage reads as its offsets.
const TEXT = 'abcdefghijklmnopqrst';
const between = (from: number, to: number) => TEXT.slice(from, to);

describe('excerptParts', () => {
  it('has no part when nothing is marked', () => {
    expect(excerptParts(20, [], between)).toEqual([]);
  });

  it('puts a gap before the first passage, between two that do not touch, and after the last', () => {
    expect(excerptParts(20, [hl(2, 4), hl(8, 10)], between)).toEqual([
      { kind: 'gap' },
      { kind: 'passage', text: 'cd', notes: [] },
      { kind: 'gap' },
      { kind: 'passage', text: 'ij', notes: [] },
      { kind: 'gap' },
    ]);
  });

  it('has no gap at an edge the passage reaches', () => {
    expect(excerptParts(20, [hl(0, 3), hl(17, 20)], between)).toEqual([
      { kind: 'passage', text: 'abc', notes: [] },
      { kind: 'gap' },
      { kind: 'passage', text: 'rst', notes: [] },
    ]);
  });

  it('merges overlapping and touching anchors into one passage, in reading order', () => {
    const parts = excerptParts(20, [hl(10, 14), hl(2, 6), hl(5, 8), hl(8, 9)], between);
    expect(parts).toEqual([
      { kind: 'gap' },
      { kind: 'passage', text: 'cdefghi', notes: [] },
      { kind: 'gap' },
      { kind: 'passage', text: 'klmn', notes: [] },
      { kind: 'gap' },
    ]);
  });

  it('attaches a note to the passage its anchor is in, once, even merged across anchors', () => {
    const parts = excerptParts(20, [hl(2, 6), nt(4, 8, 'Prima'), nt(4, 8, 'Prima'), nt(12, 14, 'Seconda'), hl(13, 16)], between);
    expect(parts.filter((p) => p.kind === 'passage')).toEqual([
      { kind: 'passage', text: 'cdefgh', notes: ['Prima'] },
      { kind: 'passage', text: 'mnop', notes: ['Seconda'] },
    ]);
  });

  it('ignores a thread, and clamps an anchor to the text', () => {
    const thread = { kind: 'thread', thread: { id: 't' }, start: 0, end: 20 } as unknown as ResolvedAnchor;
    expect(excerptParts(20, [thread], between)).toEqual([]);
    expect(excerptParts(20, [hl(18, 40), hl(5, 5)], between)).toEqual([
      { kind: 'gap' },
      { kind: 'passage', text: 'st', notes: [] },
    ]);
  });
});

describe('articleTextBetween', () => {
  it('counts the projection (no \\n) and cuts the stored text, keeping the \\n inside a passage', () => {
    const raw = 'Art. 1\n(Oggetto)\n1. Primo comma.\n2. Secondo comma.';
    const { length, textBetween } = articleTextBetween(raw);
    expect(length).toBe(raw.replace(/\n/g, '').length);
    const projection = raw.replace(/\n/g, '');
    const from = projection.indexOf('(Oggetto)');
    const to = projection.indexOf('1. Primo') + '1. Primo'.length;
    expect(textBetween(from, to)).toBe('(Oggetto)\n1. Primo');
    expect(textBetween(0, 6)).toBe('Art. 1');
    expect(textBetween(5, 5)).toBe('');
  });

  it('never changes a character: no-break spaces, accents and doubled spaces come back as stored', () => {
    const raw = 'Perché l’obbligo  è\n«tutto»';
    const { length, textBetween } = articleTextBetween(raw);
    expect(textBetween(0, length)).toBe(raw);
    expect(textBetween(0, length)).toContain(' ');
    expect(textBetween(6, 8)).toBe(' l');
  });

  it('a range that starts or ends at a line break does not carry the break', () => {
    const { textBetween } = articleTextBetween('ab\ncd');
    expect(textBetween(0, 2)).toBe('ab');
    expect(textBetween(2, 4)).toBe('cd');
  });
});

describe('EXCERPT_GAP', () => {
  it('is the marker the PDF prints', () => {
    expect(EXCERPT_GAP).toBe('[…]');
  });
});
