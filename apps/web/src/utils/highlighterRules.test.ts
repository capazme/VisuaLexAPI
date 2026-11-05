import { describe, expect, it } from 'vitest';
import { partsOf, planInk, type InkMark } from './highlighterRules';

const mark = (id: string, start: number, end: number, color: InkMark['color'], whole = false): InkMark => ({ id, start, end, color, whole });
/** A text with no spaces: offsets alone decide, and nothing meets across a gap. */
const plain = 'x'.repeat(200);
const ink = (start: number, end: number, color: Parameters<typeof planInk>[0]['ink'], marks: InkMark[], text = plain) =>
  planInk({ start, end, ink: color, marks, plain: text });

describe('planInk — the highlighter\'s rules (A4 §3, as the owner set them on 5 November)', () => {
  it('words that touch no highlight: a new one in the ink, nothing with «Nessun colore»', () => {
    expect(ink(10, 20, 'green', [mark('a', 30, 40, 'green')])).toEqual({ kind: 'create', color: 'green' });
    expect(ink(10, 20, 'none', [mark('a', 30, 40, 'green')])).toEqual({ kind: 'nothing' });
    // Meeting an edge is not touching.
    expect(ink(20, 30, 'none', [mark('a', 30, 40, 'green')])).toEqual({ kind: 'nothing' });
    expect(ink(5, 5, 'yellow', [])).toEqual({ kind: 'nothing' });
  });

  it('over its own colour alone: the highlight goes where the selection passes, the rest stays', () => {
    expect(ink(10, 20, 'yellow', [mark('a', 10, 20, 'yellow')])).toEqual({ kind: 'edit', effect: 'removed', remove: ['a'], recolor: [], add: [] });
    expect(ink(10, 15, 'yellow', [mark('a', 10, 30, 'yellow')])).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a'], recolor: [], add: [{ start: 15, end: 30, color: 'yellow', from: 'a' }],
    });
    expect(ink(15, 20, 'yellow', [mark('a', 10, 30, 'yellow')])).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a'], recolor: [],
      add: [{ start: 10, end: 15, color: 'yellow', from: 'a' }, { start: 20, end: 30, color: 'yellow', from: 'a' }],
    });
  });

  it('over its own colour alone, spaces aside: two highlights of it with a space between both go', () => {
    const text = 'Il danno ingiusto obbliga';
    const at = (w: string) => text.indexOf(w);
    const marks = [mark('a', at('danno'), at('danno') + 5, 'yellow'), mark('b', at('ingiusto'), at('ingiusto') + 8, 'yellow')];
    expect(ink(at('danno'), at('ingiusto') + 8, 'yellow', marks, text)).toEqual({ kind: 'edit', effect: 'removed', remove: ['a', 'b'], recolor: [], add: [] });
  });

  it('the same colour reaching out over plain words: the ink over the whole selection, one highlight with the one it met', () => {
    expect(ink(5, 15, 'yellow', [mark('a', 10, 30, 'yellow')])).toEqual({
      kind: 'edit', effect: 'created', color: 'yellow', remove: ['a'], recolor: [], add: [{ start: 5, end: 30, color: 'yellow', from: 'a' }],
    });
  });

  it('the whole highlight in another colour: recoloured in place, its id kept', () => {
    expect(ink(10, 20, 'blue', [mark('a', 10, 20, 'yellow')])).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'blue', remove: [], recolor: [{ id: 'a', color: 'blue' }], add: [],
    });
  });

  it('a piece in another colour: cut out, the parts keep theirs, the piece takes the ink', () => {
    expect(ink(15, 20, 'blue', [mark('a', 10, 30, 'yellow')])).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'blue', remove: ['a'], recolor: [],
      add: [
        { start: 10, end: 15, color: 'yellow', from: 'a' },
        { start: 15, end: 20, color: 'blue' },
        { start: 20, end: 30, color: 'yellow', from: 'a' },
      ],
    });
  });

  it('another colour reaching out: it gives way where the selection passes, the rest of it stays (no overlap any more)', () => {
    expect(ink(5, 40, 'red', [mark('a', 10, 30, 'yellow')])).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'red', remove: ['a'], recolor: [], add: [{ start: 5, end: 40, color: 'red' }],
    });
    expect(ink(5, 15, 'red', [mark('a', 10, 30, 'yellow')])).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'red', remove: ['a'], recolor: [],
      add: [{ start: 5, end: 15, color: 'red' }, { start: 15, end: 30, color: 'yellow', from: 'a' }],
    });
  });

  it('mixed — its colour, another, plain words: the ink over all of it, its own pieces one highlight, nothing taken away', () => {
    const marks = [mark('a', 10, 20, 'yellow'), mark('b', 25, 35, 'green')];
    expect(ink(5, 40, 'yellow', marks)).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'yellow', remove: ['b', 'a'], recolor: [], add: [{ start: 5, end: 40, color: 'yellow', from: 'a' }],
    });
  });

  it('highlighting the words beside a highlight of the colour lengthens it, across spaces only', () => {
    const text = 'Il danno ingiusto, obbliga';
    const at = (w: string) => text.indexOf(w);
    const danno = [mark('d', at('danno'), at('danno') + 5, 'yellow')];
    expect(ink(at('ingiusto'), at('ingiusto') + 8, 'yellow', danno, text)).toEqual({
      kind: 'edit', effect: 'created', color: 'yellow', remove: ['d'], recolor: [],
      add: [{ start: at('danno'), end: at('ingiusto') + 8, color: 'yellow', from: 'd' }],
    });
    // Across a comma, two highlights; in another colour, two highlights.
    const ingiusto = [mark('i', at('ingiusto'), at('ingiusto') + 8, 'yellow')];
    expect(ink(at('obbliga'), at('obbliga') + 7, 'yellow', ingiusto, text)).toEqual({ kind: 'create', color: 'yellow' });
    expect(ink(at('ingiusto'), at('ingiusto') + 8, 'green', danno, text)).toEqual({ kind: 'create', color: 'green' });
  });

  it('highlights of one colour stacked (the owner\'s test): the piece out of all of them, one part each side, no duplicate', () => {
    const stacked = [mark('a', 48, 181, 'yellow'), mark('b', 48, 121, 'yellow'), mark('c', 60, 70, 'yellow')];
    expect(ink(100, 110, 'yellow', stacked)).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a', 'b', 'c'], recolor: [],
      add: [{ start: 48, end: 100, color: 'yellow', from: 'a' }, { start: 110, end: 181, color: 'yellow', from: 'a' }],
    });
  });

  it('«Nessun colore» takes the selection out of every highlight it touches, inside or across', () => {
    const plan = ink(15, 35, 'none', [mark('a', 10, 20, 'yellow'), mark('b', 25, 30, 'green'), mark('c', 30, 50, 'red'), mark('d', 60, 70, 'blue')]);
    expect(plan).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a', 'b', 'c'], recolor: [],
      add: [{ start: 10, end: 15, color: 'yellow', from: 'a' }, { start: 35, end: 50, color: 'red', from: 'c' }],
    });
  });

  it('nested highlights: the colour passed over is the one seen, the innermost', () => {
    const marks = [mark('outer', 0, 100, 'yellow'), mark('inner', 20, 50, 'green')];
    // Green seen, green ink: the piece goes from the green one; the yellow around it stays as it is.
    expect(ink(30, 40, 'green', marks)).toEqual({
      kind: 'edit', effect: 'removed', remove: ['inner'], recolor: [],
      add: [{ start: 20, end: 30, color: 'green', from: 'inner' }, { start: 40, end: 50, color: 'green', from: 'inner' }],
    });
    // Green seen, yellow ink: the green gives way and the yellow under it shows; no second yellow over it.
    expect(ink(30, 40, 'yellow', marks)).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'yellow', remove: ['inner'], recolor: [],
      add: [{ start: 20, end: 30, color: 'green', from: 'inner' }, { start: 40, end: 50, color: 'green', from: 'inner' }],
    });
    // Yellow seen around the green, yellow ink over both: the green gives way, the yellow under it all along shows.
    expect(ink(10, 40, 'yellow', marks)).toMatchObject({ effect: 'recoloured', remove: ['inner'], add: [{ start: 40, end: 50, color: 'green', from: 'inner' }] });
  });

  it('highlights that overlap in part: the colour seen is the one the renderer draws on top (the later start)', () => {
    // «danno ingiusto» yellow, then «ingiusto obbliga colui» green: «ingiusto» shows green.
    const marks = [mark('y', 3, 17, 'yellow'), mark('g', 9, 31, 'green')];
    expect(ink(9, 17, 'green', marks)).toEqual({
      kind: 'edit', effect: 'removed', remove: ['g'], recolor: [], add: [{ start: 17, end: 31, color: 'green', from: 'g' }],
    });
    // Two with the same edges: the later one is on top.
    const twins = [mark('a', 0, 10, 'red'), mark('b', 0, 10, 'blue')];
    expect(ink(2, 5, 'blue', twins)).toMatchObject({ effect: 'removed', remove: ['b'] });
  });

  it('a highlight that cannot be cut (from the Forum) is acted on whole, and never joined: removed, or recoloured in place', () => {
    const forum = [mark('f', 10, 30, 'yellow', true)];
    expect(ink(15, 20, 'yellow', forum)).toEqual({ kind: 'edit', effect: 'removed', remove: ['f'], recolor: [], add: [] });
    expect(ink(15, 20, 'none', forum)).toEqual({ kind: 'edit', effect: 'removed', remove: ['f'], recolor: [], add: [] });
    expect(ink(15, 20, 'red', forum)).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'red', remove: [], recolor: [{ id: 'f', color: 'red' }], add: [],
    });
    // Beside a new highlight of its colour, it stays itself.
    expect(ink(30, 40, 'yellow', forum)).toEqual({ kind: 'create', color: 'yellow' });
  });
});

describe('partsOf — the highlights a cut creates', () => {
  const plain = 'Il danno ingiusto obbliga al risarcimento.';
  it('takes the projection\'s own words, trimmed at their edges, a part of whitespace alone dropped', () => {
    const danno = plain.indexOf('danno');
    expect(partsOf(plain, [
      { start: 0, end: danno, color: 'yellow', from: 'a' },
      { start: danno + 5, end: plain.indexOf('obbliga'), color: 'yellow', from: 'a' },
      { start: 2, end: 3, color: 'green' },
    ])).toEqual([
      { text: 'Il', startOffset: 0, color: 'yellow', from: 'a' },
      { text: 'ingiusto', startOffset: plain.indexOf('ingiusto'), color: 'yellow', from: 'a' },
    ]);
  });
});
