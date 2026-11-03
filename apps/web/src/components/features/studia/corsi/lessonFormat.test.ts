import { describe, expect, it } from 'vitest';
import { blockMinutes, citedMarkers, paintSpans, parseInline, parseLesson, plainText, splitLeaf } from './lessonFormat';

describe('the lesson format (courses spec §10.3)', () => {
  it('reads paragraphs, `###` headings, lists and quotes, a paragraph\'s lines joined by a space', () => {
    const nodes = parseLesson(
      ['### Il marchio', '', 'Il marchio è un segno', 'distintivo.', '', '- primo', '- secondo', '', '3. terzo', '4. quarto', '', '> una frase', '>', '> un\'altra'].join('\n'),
    );
    expect(nodes.map((n) => n.kind)).toEqual(['h3', 'p', 'ul', 'ol', 'quote']);
    expect(nodes[1]).toEqual({ kind: 'p', inline: [{ kind: 'text', text: 'Il marchio è un segno distintivo.' }] });
    expect(nodes[3]).toMatchObject({ kind: 'ol', start: 3 });
    expect(nodes[4]).toMatchObject({ kind: 'quote', paragraphs: [[{ text: 'una frase' }], [{ text: 'un\'altra' }]] });
  });

  it('reads bold, italic and citations, a citation\'s text emphasised too', () => {
    expect(parseInline('Il **marchio** è *un segno*: [art. 7 c.p.i.](#c1) e [**l\'art. 2569**](#c12).')).toEqual([
      { kind: 'text', text: 'Il ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'marchio' }] },
      { kind: 'text', text: ' è ' },
      { kind: 'em', children: [{ kind: 'text', text: 'un segno' }] },
      { kind: 'text', text: ': ' },
      { kind: 'cite', marker: 'c1', children: [{ kind: 'text', text: 'art. 7 c.p.i.' }] },
      { kind: 'text', text: ' e ' },
      { kind: 'cite', marker: 'c12', children: [{ kind: 'strong', children: [{ kind: 'text', text: 'l\'art. 2569' }] }] },
      { kind: 'text', text: '.' },
    ]);
  });

  it('reads emphasis around a citation, the citation kept whole inside it', () => {
    expect(parseInline('**Si veda [l’art. 7](#c1).** E *poi [qui](#c2)*')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'Si veda ' }, { kind: 'cite', marker: 'c1', children: [{ kind: 'text', text: 'l’art. 7' }] }, { kind: 'text', text: '.' }] },
      { kind: 'text', text: ' E ' },
      { kind: 'em', children: [{ kind: 'text', text: 'poi ' }, { kind: 'cite', marker: 'c2', children: [{ kind: 'text', text: 'qui' }] }] },
    ]);
  });

  it('keeps as text whatever is not the subset: HTML, other links, unclosed marks', () => {
    const text = '<img src=x onerror=alert(1)> [qui](https://esempio.it) e 2 * 3 = 6, **aperto';
    expect(parseInline(text)).toEqual([{ kind: 'text', text }]);
    expect(parseLesson('#### Titolo')).toEqual([{ kind: 'p', inline: [{ kind: 'text', text: '#### Titolo' }] }]);
  });

  it('counts highlights in the plain text: the leaves with nothing between them', () => {
    const nodes = parseLesson('### Uno\n\nDue **tre** [quattro](#c2).\n\n- cinque');
    expect(plainText(nodes)).toBe('UnoDue tre quattro.cinque');
    expect(citedMarkers(nodes)).toEqual(['c2']);
  });
});

describe('highlights for the session (§5, step 3), with the highlighter\'s rules (A4)', () => {
  it('merges a highlight with those of its colour it touches or overlaps; a saved one with no colour is yellow', () => {
    let spans = paintSpans([], [10, 20], 'yellow');
    spans = paintSpans(spans, [30, 40], 'yellow');
    spans = paintSpans(spans, [18, 30], 'yellow');
    expect(spans).toEqual([[10, 40, 'yellow']]);
    spans = paintSpans(spans, [0, 3], 'yellow');
    expect(spans).toEqual([[0, 3, 'yellow'], [10, 40, 'yellow']]);
    expect(paintSpans(spans, [5, 5], 'green')).toEqual(spans);
    expect(paintSpans([[10, 20]], [20, 30], 'yellow')).toEqual([[10, 30, 'yellow']]);
  });

  it('the same colour over words inside one highlight takes the piece away, the parts outside staying', () => {
    expect(paintSpans([[10, 40, 'yellow']], [10, 40], 'yellow')).toEqual([]);
    expect(paintSpans([[10, 40, 'yellow']], [10, 20], 'yellow')).toEqual([[20, 40, 'yellow']]);
    expect(paintSpans([[10, 40, 'yellow']], [20, 30], 'yellow')).toEqual([[10, 20, 'yellow'], [30, 40, 'yellow']]);
  });

  it('another colour paints over what it covers: a piece recoloured, words reaching out painted whole', () => {
    expect(paintSpans([[10, 40, 'yellow']], [20, 30], 'blue')).toEqual([[10, 20, 'yellow'], [20, 30, 'blue'], [30, 40, 'yellow']]);
    expect(paintSpans([[10, 40, 'yellow']], [30, 50], 'yellow')).toEqual([[10, 50, 'yellow']]);
    expect(paintSpans([[10, 20, 'yellow'], [20, 30, 'green']], [15, 25], 'red')).toEqual([[10, 15, 'yellow'], [15, 25, 'red'], [25, 30, 'green']]);
  });

  it('«Nessun colore» takes the words out of every highlight they touch', () => {
    expect(paintSpans([[10, 20, 'yellow'], [25, 40, 'green']], [15, 30], 'none')).toEqual([[10, 15, 'yellow'], [30, 40, 'green']]);
    expect(paintSpans([[10, 20, 'yellow']], [30, 40], 'none')).toEqual([[10, 20, 'yellow']]);
  });

  it('cuts a leaf at the highlights\' edges, each piece naming its highlight and its colour', () => {
    expect(splitLeaf('abcdefgh', 100, [[102, 104], [106, 120, 'green']])).toEqual([
      { text: 'ab', at: 100, highlight: null, color: null },
      { text: 'cd', at: 102, highlight: 102, color: 'yellow' },
      { text: 'ef', at: 104, highlight: null, color: null },
      { text: 'gh', at: 106, highlight: 106, color: 'green' },
    ]);
  });
});

describe('a block\'s indicative minutes (§5, step 2)', () => {
  it('shares the module\'s estimate by words, else reads at a study pace, never under a minute', () => {
    expect(blockMinutes(1200, 2400, 30)).toBe(15);
    expect(blockMinutes(1200, 2400, null)).toBe(12);
    expect(blockMinutes(10, 2400, 30)).toBe(1);
    expect(blockMinutes(0, 0, null)).toBe(1);
  });
});
