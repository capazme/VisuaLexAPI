import { describe, it, expect } from 'vitest';
import {
  describeBlock,
  groupAnnotationsByBlock,
  hasAnnotations,
  highlightsWithoutSign,
  resolveAnchors,
  signAriaLabel,
  signColors,
} from './articleAnnotations';
import { parseArticleStructure } from './articleStructure';
import { fixtureText } from './__fixtures__/articleTexts';
import type { Annotation, Highlight } from '../types';
import type { LocatedThread } from './articleAnnotations';

const hl = (id: string, text: string, startOffset: number | undefined, color: Highlight['color'] = 'yellow'): Highlight => ({
  id, normaKey: 'k', articleId: '1', rangeSerialized: '', text, color, startOffset,
});
const note = (id: string, anchorText: string, startOffset: number): Annotation => ({
  id, normaKey: 'k', articleId: '1', text: `nota ${id}`, createdAt: '2026-09-25', anchorText, startOffset,
});
const thread = (id: string, start: number, end: number): LocatedThread => ({
  thread: {
    id,
    title: `thread ${id}`,
    passage: { quote: 'q', start, prefix: '', suffix: '' },
    articleUrn: null,
    textHash: null,
    commentCount: 0,
    createdAt: '2026-09-28',
    user: { id: 'u1', username: 'marta' },
  },
  start,
  end,
});

// c.c. 1453: 0 heading, 1 rubric, 2-4 the three commi.
const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const STRUCTURE = parseArticleStructure(RAW);
const at = (s: string) => {
  const i = PLAIN.indexOf(s);
  if (i < 0) throw new Error(`not in the fixture: ${s}`);
  return i;
};
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('resolveAnchors', () => {
  it('places an anchored highlight or note where its text is, ignoring case', () => {
    const r = resolveAnchors(PLAIN, [hl('h', 'PRESTAZIONI corrispettive', at('prestazioni corrispettive'))], [note('n', 'giudizio', at('giudizio'))]);
    expect(r.map(({ kind, start, end }) => ({ kind, start, end }))).toEqual([
      { kind: 'highlight', start: at('prestazioni'), end: at('prestazioni') + 25 },
      { kind: 'note', start: at('giudizio'), end: at('giudizio') + 8 },
    ]);
  });

  it('rescues an anchor stored with the newlines of a rendered selection', () => {
    const r = resolveAnchors(PLAIN, [hl('old', 'danno.\n\nLa risoluzione', at('danno.'))], []);
    expect(r).toHaveLength(1);
    expect(PLAIN.slice(r[0].start, r[0].end)).toBe('danno.  La risoluzione');
  });

  it('drops an anchor whose text is not at its offset, and a note without anchor text', () => {
    const free: Annotation = { ...note('free', '', 0), anchorText: undefined, startOffset: undefined };
    expect(resolveAnchors(PLAIN, [hl('gone', 'danno. Xa', at('danno.'))], [note('orphan', 'inesistente', 100), free])).toEqual([]);
  });

  it('keeps a highlight saved before offsets existed on every occurrence', () => {
    const r = resolveAnchors(PLAIN, [hl('legacy', 'risoluzione', undefined)], []);
    expect(r.map((x) => x.start)).toEqual(
      [...PLAIN.matchAll(/risoluzione/gi)].map((m) => m.index),
    );
  });
});

describe('groupAnnotationsByBlock', () => {
  it('returns one group per block, empty where nothing is anchored', () => {
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [], []);
    expect(groups).toHaveLength(STRUCTURE.blocks.length);
    expect(groups.every((g) => !hasAnnotations(g))).toBe(true);
  });

  it('puts a located thread in the group of the block that shows its words, and under both when crossing two commi', () => {
    const single = thread('t1', at('prestazioni'), at('prestazioni') + 10);
    const acrossStart = at('danno.');
    const acrossEnd = at('La risoluzione') + 5;
    const across = thread('t2', acrossStart, acrossEnd);

    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [], [], [single, across]);
    expect(groups[2].threads.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(groups[3].threads.map((t) => t.id)).toEqual(['t2']);
    expect(hasAnnotations(groups[2])).toBe(true);
  });

  it('puts each annotation under the block that shows it, in the order it appears', () => {
    const groups = groupAnnotationsByBlock(
      RAW,
      STRUCTURE,
      [hl('h2', 'risarcimento del danno', at('risarcimento del danno'), 'green'), hl('h1', 'contraenti', at('contraenti'))],
      [note('n1', 'giudizio', at('giudizio')), note('n0', 'prestazioni corrispettive', at('prestazioni corrispettive'))],
    );
    expect(ids(groups[2].highlights)).toEqual(['h1', 'h2']);
    expect(ids(groups[2].notes)).toEqual(['n0']);
    expect(ids(groups[3].notes)).toEqual(['n1']);
    expect(groups[4]).toEqual({ notes: [], highlights: [], threads: [] });
  });

  it('lists a highlight dragged across two commi under both', () => {
    const start = at('danno.');
    const end = at('La risoluzione') + 'La risoluzione'.length;
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [hl('x', PLAIN.slice(start, end), start)], []);
    expect(groups.map((g) => ids(g.highlights))).toEqual([[], [], ['x'], ['x'], []]);
  });

  it('lists a legacy highlight once under every block with an occurrence', () => {
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [hl('legacy', 'risoluzione', undefined)], []);
    expect(groups.map((g) => ids(g.highlights))).toEqual([[], [], ['legacy'], ['legacy'], ['legacy']]);
  });

  it('gives an orphan no block', () => {
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [], [note('orphan', 'inesistente', 100)]);
    expect(groups.some(hasAnnotations)).toBe(false);
  });

  it('reaches the AGGIORNAMENTO paragraphs, never the separator line', () => {
    const raw = fixtureText('nrm-cp-640');
    const plain = raw.replace(/\n/g, '');
    const structure = parseArticleStructure(raw);
    const text = 'amnistia per il delitto previsto';
    const groups = groupAnnotationsByBlock(raw, structure, [], [note('t', text, plain.indexOf(text))]);
    const holders = groups.flatMap((g, i) => (hasAnnotations(g) ? [structure.blocks[i].kind] : []));
    expect(holders).toEqual(['update-para']);
    // A highlight across the separator counts in the blocks around it only.
    const sep = structure.blocks.findIndex((b) => b.kind === 'update-sep');
    const from = plain.indexOf('Il delitto è punibile');
    const to = plain.indexOf('AGGIORNAMENTO (119)') + 5;
    const across = groupAnnotationsByBlock(raw, structure, [hl('s', plain.slice(from, to), from)], []);
    expect(hasAnnotations(across[sep])).toBe(false);
    expect(hasAnnotations(across[sep - 1])).toBe(true);
    expect(hasAnnotations(across[sep + 1])).toBe(true);
  });
});

describe('signColors and signAriaLabel', () => {
  it('lists each colour once, in order, and reads an unknown colour as yellow', () => {
    const odd = { ...hl('o', 'x', 0), color: 'purple' } as unknown as Highlight;
    expect(signColors([hl('a', 'x', 0, 'green'), hl('b', 'x', 0), hl('c', 'x', 0, 'green'), odd])).toEqual(['green', 'yellow']);
  });

  it('names what the sign holds, in Italian', () => {
    expect(signAriaLabel(1, 0)).toBe('1 nota in questo passo');
    expect(signAriaLabel(2, 1)).toBe('2 note e 1 evidenziazione in questo passo');
    expect(signAriaLabel(0, 3)).toBe('3 evidenziazioni in questo passo');
    expect(signAriaLabel(0, 0, 1)).toBe('1 discussione in questo passo');
    expect(signAriaLabel(2, 1, 3)).toBe('2 note, 1 evidenziazione e 3 discussioni in questo passo');
  });
});

describe('describeBlock', () => {
  it('uses the enumerator the source prints, without the (( of a modification', () => {
    const raw = fixtureText('nrm-cp-640');
    const structure = parseArticleStructure(raw);
    const labels = structure.blocks.filter((b) => b.marker).map((b) => describeBlock(raw, b));
    expect(labels).toEqual(['1°', '2°', '2-bis)', '2-ter)']);
    const modified = fixtureText('nrm-fx-fallback');
    const first = parseArticleStructure(modified).blocks.find((b) => b.kind === 'comma' && b.marker)!;
    expect(describeBlock(modified, first)).toBe('1.');
  });

  it('otherwise opens with the block\'s own words, cut on a word', () => {
    expect(describeBlock(RAW, STRUCTURE.blocks[0])).toBe('Art. 1453.');
    expect(describeBlock(RAW, STRUCTURE.blocks[1])).toBe('(Risolubilità del contratto per inadempimento).');
    expect(describeBlock(RAW, STRUCTURE.blocks[2])).toBe('Nei contratti con prestazioni corrispettive…');
  });
});

describe('highlightsWithoutSign', () => {
  it('keeps the highlights no block shows: other sections of the article, and orphans', () => {
    const shown = hl('shown', 'giudizio', at('giudizio'));
    const orphan = hl('orphan', 'inesistente', 100);
    const brocardi: Highlight = { ...hl('b', 'ratio', 0), articleId: '1/brocardi/ratio' };
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [shown, orphan], []);
    expect(ids(highlightsWithoutSign([shown, orphan, brocardi], groups))).toEqual(['orphan', 'b']);
  });
});
