import { describe, expect, it } from 'vitest';
import { addSpan, blockMinutes, citedMarkers, parseInline, parseLesson, plainText, removeSpan, splitLeaf } from './lessonFormat';

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

describe('highlights for the session (§5, step 3)', () => {
  it('merges a highlight with those it touches or overlaps, and removes one by its start', () => {
    let spans = addSpan([], [10, 20]);
    spans = addSpan(spans, [30, 40]);
    spans = addSpan(spans, [18, 30]);
    expect(spans).toEqual([[10, 40]]);
    spans = addSpan(spans, [0, 3]);
    expect(spans).toEqual([[0, 3], [10, 40]]);
    expect(removeSpan(spans, 10)).toEqual([[0, 3]]);
    expect(addSpan(spans, [5, 5])).toEqual(spans);
  });

  it('cuts a leaf at the highlights\' edges, each piece naming its highlight', () => {
    expect(splitLeaf('abcdefgh', 100, [[102, 104], [106, 120]])).toEqual([
      { text: 'ab', at: 100, highlight: null },
      { text: 'cd', at: 102, highlight: 102 },
      { text: 'ef', at: 104, highlight: null },
      { text: 'gh', at: 106, highlight: 106 },
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
