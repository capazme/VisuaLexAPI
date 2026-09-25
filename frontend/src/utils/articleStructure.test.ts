import { describe, it, expect } from 'vitest';
import {
  parseArticleStructure,
  getRubricText,
  getUpdateNoteParagraphs,
  type ArticleStructure,
  type BlockKind,
  type DecorationKind,
  type StructureBlock,
} from './articleStructure';
import { ARTICLE_FIXTURES, fixtureText } from './__fixtures__/articleTexts';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const kinds = (s: ArticleStructure) => s.blocks.map((b) => b.kind);
const ofKind = (s: ArticleStructure, kind: BlockKind) => s.blocks.filter((b) => b.kind === kind);
const text = (raw: string, b: { start: number; end: number }) => clean(raw.slice(b.start, b.end));
const marker = (raw: string, b: StructureBlock) => (b.marker ? clean(raw.slice(b.marker.start, b.marker.end)) : null);
const decorations = (raw: string, s: ArticleStructure, kind: DecorationKind) =>
  s.decorations.filter((d) => d.kind === kind).map((d) => raw.slice(d.start, d.end));

/** Items listed right after the first comma whose text starts with `prefix`, up to the next comma. */
function itemsAfter(raw: string, s: ArticleStructure, prefix: string) {
  const start = s.blocks.findIndex((b) => b.kind === 'comma' && text(raw, b).startsWith(prefix));
  expect(start, `comma "${prefix}"`).toBeGreaterThanOrEqual(0);
  const items: Array<{ marker: string | null; level: number | undefined }> = [];
  for (let i = start + 1; i < s.blocks.length && s.blocks[i].kind === 'item'; i++) {
    items.push({ marker: marker(raw, s.blocks[i]), level: s.blocks[i].level });
  }
  return items;
}

describe('parseArticleStructure — invariants on every real text', () => {
  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))('%s: the blocks partition the text', (_id, raw) => {
    const s = parseArticleStructure(raw);
    expect(s.blocks.length).toBeGreaterThan(0);
    expect(s.blocks[0].start).toBe(0);
    expect(s.blocks[s.blocks.length - 1].end).toBe(raw.length);
    s.blocks.forEach((b, i) => {
      expect(b.end).toBeGreaterThan(b.start);
      if (i > 0) expect(b.start).toBe(s.blocks[i - 1].end);
      if (b.marker) {
        expect(b.marker.start).toBeGreaterThanOrEqual(b.start);
        expect(b.marker.end).toBeLessThanOrEqual(b.end);
      }
    });
  });

  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))('%s: every decoration sits inside one block', (_id, raw) => {
    const s = parseArticleStructure(raw);
    for (const d of s.decorations) {
      const host = s.blocks.find((b) => b.start <= d.start && d.end <= b.end);
      expect(host, `${d.kind} ${JSON.stringify(raw.slice(d.start, d.end))}`).toBeDefined();
    }
  });
});

describe('Normattiva — codici (allegato format)', () => {
  it('c.c. 1453: heading, rubric, three commi', () => {
    const raw = fixtureText('nrm-cc-1453');
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual(['heading', 'rubrica', 'comma', 'comma', 'comma']);
    expect(text(raw, s.blocks[0])).toBe('Art. 1453.');
    expect(getRubricText(raw, s)).toBe('Risolubilità del contratto per inadempimento');
    expect(decorations(raw, s, 'rubric-paren')).toEqual(['(', ')']);
    expect(s.updates).toBeNull();
  });

  it('c.p. 640: items under the second comma, references, the update tail', () => {
    const raw = fixtureText('nrm-cp-640');
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual([
      'heading', 'rubrica', 'comma', 'comma', 'item', 'item', 'item', 'item', 'comma', 'comma',
      'update-sep', 'update-head', 'update-para', 'update-para', 'update-sep', 'update-head', 'update-para',
    ]);
    expect(itemsAfter(raw, s, 'La pena è della reclusione')).toEqual([
      { marker: '1°', level: 1 },
      { marker: '2°', level: 1 },
      { marker: '2-bis)', level: 1 },
      { marker: '2-ter)', level: 1 },
    ]);
    expect(decorations(raw, s, 'ref')).toEqual(['(119)', '(154)']);
    expect(s.decorations.filter((d) => d.kind === 'ref').map((d) => d.noteId)).toEqual(['119', '154']);
    expect(decorations(raw, s, 'notice')).toEqual(['((NUMERO ABROGATO DAL D.L. 11 APRILE 2025, N. 48))']);
    const mods = decorations(raw, s, 'mod');
    expect(mods).toHaveLength(2);
    expect(mods[0].startsWith('((Quando ricorre la circostanza')).toBe(true);
    expect(mods[1]).toBe('((, e dal terzo comma))');
    expect(decorations(raw, s, 'mod-paren')).toEqual(['((', '))', '((', '))']);
    expect(Object.keys(s.notes)).toEqual(['119', '154']);
    expect(getUpdateNoteParagraphs(raw, s.notes['119'])).toHaveLength(2);
    expect(getUpdateNoteParagraphs(raw, s.notes['154'])[0].startsWith('Successivamente la Corte Costituzionale')).toBe(true);
    expect(s.updates).toEqual({ start: raw.indexOf('-------------'), end: raw.length });
    expect(ofKind(s, 'update-head').map((b) => b.noteId)).toEqual(['119', '154']);
  });

  it('c.c. 2359: numbered items, then a comma that is not an item', () => {
    const raw = fixtureText('nrm-cc-2359');
    const s = parseArticleStructure(raw);
    expect(itemsAfter(raw, s, 'Sono considerate società controllate')).toEqual([
      { marker: '1)', level: 1 },
      { marker: '2)', level: 1 },
      { marker: '3)', level: 1 },
    ]);
    expect(text(raw, s.blocks[s.blocks.findIndex((b) => b.kind === 'item') + 3]).startsWith('Ai fini')).toBe(true);
  });

  it('c.c. 1284: references with a letter suffix point at their notes', () => {
    const raw = fixtureText('nrm-cc-1284');
    const s = parseArticleStructure(raw);
    expect(Object.keys(s.notes)).toHaveLength(22);
    const refs = s.decorations.filter((d) => d.kind === 'ref');
    expect(refs.map((d) => d.noteId)).toContain('129a');
    expect(refs.map((d) => d.noteId)).toContain('242');
    expect(decorations(raw, s, 'ref-missing')).toEqual([]);
  });

  it('Costituzione art. 3: no rubric', () => {
    const raw = fixtureText('nrm-cost-3');
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual(['heading', 'comma', 'comma']);
    expect(getRubricText(raw, s)).toBeNull();
  });

  it('a repealed article is a heading and a notice', () => {
    const raw = fixtureText('nrm-fx-abrogato');
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual(['heading', 'comma']);
    expect(decorations(raw, s, 'notice')).toEqual(['((ARTICOLO ABROGATO DAL D.LGS. 10 AGOSTO 2018, N. 101))']);
  });

  it('reads the malformed header Normattiva serves for c.p. 524', () => {
    const raw = fixtureText('nrm-fx-cp524');
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual(['heading', 'comma']);
    expect(text(raw, s.blocks[0])).toBe('Codice Penale-art. 524');
  });
});

describe('Normattiva — Akoma Ntoso detailed format', () => {
  it('cod. privacy 2-ter: numbered commi, an inserted comma, notices and a reference without its note', () => {
    const raw = fixtureText('nrm-privacy-2ter');
    const s = parseArticleStructure(raw);
    expect(ofKind(s, 'comma').map((b) => marker(raw, b))).toEqual(['1.', '((1-bis.', '2.', '3.', '4.']);
    expect(ofKind(s, 'item').map((b) => marker(raw, b))).toEqual(['a)', 'b)']);
    expect(getRubricText(raw, s)?.startsWith('Base giuridica per il trattamento')).toBe(true);
    expect(decorations(raw, s, 'ref-missing')).toEqual(['((49))']);
    expect(decorations(raw, s, 'notice')).toEqual([
      '((...))',
      '((...))',
      '((PERIODO SOPPRESSO DAL D.L. 8 OTTOBRE 2021, N. 139, CONVERTITO CON MODIFICAZIONI DALLA L. 3 DICEMBRE 2021, N. 205))',
    ]);
    expect(decorations(raw, s, 'mod')).toContain('((o da atti amministrativi generali))');
  });

  it('d.lgs. 36/2023 art. 1: a rubric without parentheses', () => {
    const raw = fixtureText('nrm-dlgs36-1');
    const s = parseArticleStructure(raw);
    expect(kinds(s).slice(0, 2)).toEqual(['heading', 'rubrica']);
    expect(getRubricText(raw, s)).toBe('Principio del risultato');
    expect(ofKind(s, 'comma').map((b) => marker(raw, b))).toEqual(['1.', '2.', '3.', '4.']);
    expect(itemsAfter(raw, s, '4.')).toEqual([
      { marker: 'a)', level: 1 },
      { marker: 'b)', level: 1 },
    ]);
  });

  it('d.lgs. 231/2001 art. 25-ter: suffixed letters, an upper-case repeal, "i)" after "h)" is a letter', () => {
    const raw = fixtureText('nrm-dlgs231-25ter');
    const s = parseArticleStructure(raw);
    const items = itemsAfter(raw, s, '1. In relazione');
    expect(items.slice(0, 4)).toEqual([
      { marker: 'a)', level: 1 },
      { marker: 'a-bis)', level: 1 },
      { marker: 'b)', level: 1 },
      { marker: 'c)', level: 1 },
    ]);
    expect(items.find((i) => i.marker === 'i)')).toEqual({ marker: 'i)', level: 1 });
    expect(items.map((i) => i.marker)).toContain('((s-ter)');
    expect(items.every((i) => i.level === 1)).toBe(true);
    expect(decorations(raw, s, 'notice')).toContain('LETTERA ABROGATA DALLA L. 27 MAGGIO 2015, N. 69;');
    // Normattiva's "(9)" has no note in this format: plain text, as the spec says.
    expect(s.decorations.filter((d) => d.kind === 'ref' || d.kind === 'ref-missing')).toEqual([]);
  });

  it('l. 241/1990 art. 3: a rubric inserted by a later act', () => {
    const raw = fixtureText('nrm-fx-akn-comma-div');
    const s = parseArticleStructure(raw);
    expect(kinds(s).slice(0, 3)).toEqual(['heading', 'rubrica', 'comma']);
    expect(getRubricText(raw, s)).toBe('Motivazione del provvedimento');
    expect(decorations(raw, s, 'mod')[0]).toBe('(( (Motivazione del provvedimento) ))');
    expect(decorations(raw, s, 'rubric-paren')).toEqual(['(', ')']);
  });

  it('l. 241/1990 art. 6-bis: rubric and first comma both inside ((…))', () => {
    const raw = fixtureText('nrm-fx-fallback');
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual(['heading', 'rubrica', 'comma']);
    expect(getRubricText(raw, s)).toBe('Conflitto di interessi');
    expect(marker(raw, ofKind(s, 'comma')[0])).toBe('((1.');
  });
});

describe('EUR-Lex', () => {
  it('GDPR art. 6: points glued to their paragraph are split, "; ob)" included', () => {
    const raw = fixtureText('eu-gdpr-6');
    const s = parseArticleStructure(raw);
    expect(text(raw, s.blocks[0])).toBe('Articolo 6');
    expect(getRubricText(raw, s)).toBe('Liceità del trattamento');
    expect(itemsAfter(raw, s, '1.').map((i) => i.marker)).toEqual(['a)', 'b)', 'c)', 'd)', 'e)', 'f)']);
    const third = itemsAfter(raw, s, '3.');
    expect(third.slice(0, 2)).toEqual([
      { marker: 'a)', level: 1 },
      { marker: 'b)', level: 1 },
    ]);
    const bBlock = s.blocks.find((b) => b.kind === 'item' && text(raw, b).startsWith('b)dal diritto'));
    expect(bBlock).toBeDefined();
  });

  it('AI Act art. 3: the NBSP heading, the title, definitions as items', () => {
    const raw = fixtureText('eu-aiact-3');
    const s = parseArticleStructure(raw);
    expect(raw.slice(s.blocks[0].start, s.blocks[0].end).trim()).toBe('Articolo\xa03');
    expect(getRubricText(raw, s)).toBe('Definizioni');
    const items = itemsAfter(raw, s, 'Ai fini del presente regolamento');
    expect(items.map((i) => i.marker)).toEqual(['1)', '2)', '3)', '4)', '5)', '6)', '7)', '8)', '9)']);
    expect(items.every((i) => i.level === 1)).toBe(true);
  });

  it('AI Act art. 5: glued sub-points nest under their letter', () => {
    const raw = fixtureText('eu-aiact-5');
    const s = parseArticleStructure(raw);
    expect(itemsAfter(raw, s, '1.')).toEqual([
      { marker: 'a)', level: 1 },
      { marker: 'b)', level: 1 },
      { marker: 'c)', level: 1 },
      { marker: 'i)', level: 2 },
      { marker: 'ii)', level: 2 },
      { marker: 'd)', level: 1 },
      { marker: 'e)', level: 1 },
      { marker: 'f)', level: 1 },
      { marker: 'g)', level: 1 },
      { marker: 'h)', level: 1 },
      { marker: 'i)', level: 2 },
      { marker: 'ii)', level: 2 },
      { marker: 'iii)', level: 2 },
    ]);
  });

  it('eIDAS art. 1 (consolidated): one line per point', () => {
    const raw = fixtureText('eu-fx-eidas-1-cons');
    const s = parseArticleStructure(raw);
    expect(getRubricText(raw, s)).toBe('Oggetto');
    expect(ofKind(s, 'item').slice(0, 3).map((b) => marker(raw, b))).toEqual(['a)', 'b)', 'c)']);
  });

  it('leaves an OJ footnote reference as plain text: its note is not in the text', () => {
    const raw = 'Articolo 2\nAmbito di applicazione\n4. Il presente regolamento non pregiudica il regolamento (UE) 2016/679 del Parlamento europeo e del Consiglio (1).';
    const s = parseArticleStructure(raw);
    expect(s.decorations.filter((d) => d.kind === 'ref' || d.kind === 'ref-missing')).toEqual([]);
  });
});

describe('Akoma Ntoso last-resort text', () => {
  it('hides the markdown prefix and reads the rubric on the heading line', () => {
    const raw = fixtureText('akn-dlgs231-5');
    const s = parseArticleStructure(raw);
    expect(decorations(raw, s, 'hidden')).toEqual(['### ']);
    expect(getRubricText(raw, s)).toBe("Responsabilita' dell'ente");
    expect(ofKind(s, 'comma').map((b) => marker(raw, b))).toEqual(['1.', '2.']);
    expect(ofKind(s, 'item').map((b) => marker(raw, b))).toEqual(['a)', 'b)']);
  });

  it('reads a parenthesised rubric on the heading line', () => {
    const raw = fixtureText('akn-l241-3');
    const s = parseArticleStructure(raw);
    expect(getRubricText(raw, s)).toBe('Motivazione del provvedimento');
  });
});

describe('prose that only looks like structure', () => {
  it('does not split "lettera a); b)" in running prose', () => {
    const raw = 'Art. 1\n\nSi applica la lettera a); b) resta ferma.';
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual(['heading', 'comma']);
  });

  it('does not take a sentence that starts with "Articolo 3" for a heading', () => {
    const raw = "Articolo 3 della legge n. 1 è abrogato.\n\nAltro testo.";
    const s = parseArticleStructure(raw);
    expect(ofKind(s, 'heading')).toEqual([]);
  });

  it('never cuts inside "terzo" when reading "Art. 480 terzo comma"', () => {
    const raw = 'Art. 480 terzo comma si applica.\nTesto.';
    const s = parseArticleStructure(raw);
    expect(ofKind(s, 'heading')).toEqual([]);
  });

  it.each([
    'Art. 1\n\nLa riforma (1990) ha introdotto il comma.',
    'Art. 1\n\nSi veda il comma (1) del presente articolo.',
    'Art. 1\n\nIl comma(1) resta.',
  ])('leaves a bare number in parentheses plain when the text has no such note: %j', (raw) => {
    const s = parseArticleStructure(raw);
    expect(s.decorations.filter((d) => d.kind === 'ref' || d.kind === 'ref-missing')).toEqual([]);
  });

  it('dims "((49))" even without its note: that form is only ever a reference', () => {
    const raw = 'Art. 1\n\n1. Testo del comma. ((49))';
    expect(decorations(raw, parseArticleStructure(raw), 'ref-missing')).toEqual(['((49))']);
  });

  it('leaves a modification that spans two commi undecorated, and still reads the next one', () => {
    const raw = 'Art. 1\n\n((1. Primo comma.\n\n2. Secondo comma ((con parte)) finale.))';
    const s = parseArticleStructure(raw);
    expect(decorations(raw, s, 'mod')).toEqual(['((con parte))']);
  });
});

describe('item levels', () => {
  it('nests a list of another style one level down', () => {
    const raw = 'Art. 1\n\n1. Testo:\n\na) uno;\n\nb) due:\n\n1) sub uno;\n\n2) sub due;\n\nc) tre.';
    const s = parseArticleStructure(raw);
    expect(ofKind(s, 'item').map((b) => [marker(raw, b), b.level])).toEqual([
      ['a)', 1], ['b)', 1], ['1)', 2], ['2)', 2], ['c)', 1],
    ]);
  });
});

describe('headings and rubrics (the cases Study Mode relied on)', () => {
  it.each([
    ['art. 100.\n\n(Interesse ad agire).\n\nPer proporre una domanda.', 'Interesse ad agire'],
    ['Art. 2043.\n(Risarcimento per fatto illecito).\nQualunque fatto doloso.', 'Risarcimento per fatto illecito'],
    ['art. 100 bis.\n(Edge case).\nTesto.', 'Edge case'],
    ['art. 50-ter.\n(Con trattino).\nCorpo.', 'Con trattino'],
    ['art. 25-terdecies.\n(Rubrica lunga).\nCorpo.', 'Rubrica lunga'],
    ['Art. 25 quinquiesdecies.\n(Rubrica).\nCorpo.', 'Rubrica'],
  ])('%j → %s', (raw, rubric) => {
    const s = parseArticleStructure(raw);
    expect(kinds(s).slice(0, 2)).toEqual(['heading', 'rubrica']);
    expect(getRubricText(raw, s)).toBe(rubric);
  });

  it('keeps the body after a heading with no rubric', () => {
    const raw = 'art. 1.\nTesto senza rubrica.';
    const s = parseArticleStructure(raw);
    expect(kinds(s)).toEqual(['heading', 'comma']);
  });

  it('reads a heading-only text as a heading', () => {
    expect(kinds(parseArticleStructure('art. 42.'))).toEqual(['heading']);
  });

  it('gives no blocks for an empty text and one comma for text with no structure', () => {
    expect(parseArticleStructure('').blocks).toEqual([]);
    expect(kinds(parseArticleStructure('Testo che non inizia con art.'))).toEqual(['comma']);
    expect(kinds(parseArticleStructure('   '))).toEqual(['comma']);
  });
});
