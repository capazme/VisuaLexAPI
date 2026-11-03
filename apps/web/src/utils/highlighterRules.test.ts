import { describe, expect, it } from 'vitest';
import { partsOf, planInk, type InkMark } from './highlighterRules';

const mark = (id: string, start: number, end: number, color: InkMark['color'], whole = false): InkMark => ({ id, start, end, color, whole });

describe('planInk — the highlighter\'s rules (A4 §3)', () => {
  it('words that touch no highlight: a new one in the ink, nothing with «Nessun colore»', () => {
    expect(planInk({ start: 10, end: 20, ink: 'green', marks: [mark('a', 30, 40, 'green')] })).toEqual({ kind: 'create', color: 'green' });
    expect(planInk({ start: 10, end: 20, ink: 'none', marks: [mark('a', 30, 40, 'green')] })).toEqual({ kind: 'nothing' });
    // Meeting an edge is not touching.
    expect(planInk({ start: 20, end: 30, ink: 'none', marks: [mark('a', 30, 40, 'green')] })).toEqual({ kind: 'nothing' });
    expect(planInk({ start: 5, end: 5, ink: 'yellow', marks: [] })).toEqual({ kind: 'nothing' });
  });

  it('the same words in the same colour: the highlight goes', () => {
    expect(planInk({ start: 10, end: 20, ink: 'yellow', marks: [mark('a', 10, 20, 'yellow')] })).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a'], recolor: [], add: [],
    });
  });

  it('a piece of a highlight in its colour: only the piece goes, the parts outside stay (one at an edge, two in the middle)', () => {
    expect(planInk({ start: 10, end: 15, ink: 'yellow', marks: [mark('a', 10, 30, 'yellow')] })).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a'], recolor: [], add: [{ start: 15, end: 30, color: 'yellow', from: 'a' }],
    });
    expect(planInk({ start: 15, end: 20, ink: 'yellow', marks: [mark('a', 10, 30, 'yellow')] })).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a'], recolor: [],
      add: [{ start: 10, end: 15, color: 'yellow', from: 'a' }, { start: 20, end: 30, color: 'yellow', from: 'a' }],
    });
  });

  it('the whole highlight in another colour: recoloured in place, its id kept', () => {
    expect(planInk({ start: 10, end: 20, ink: 'blue', marks: [mark('a', 10, 20, 'yellow')] })).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'blue', remove: [], recolor: [{ id: 'a', color: 'blue' }], add: [],
    });
  });

  it('a piece in another colour: cut out, the parts keep theirs, the piece takes the ink', () => {
    expect(planInk({ start: 15, end: 20, ink: 'blue', marks: [mark('a', 10, 30, 'yellow')] })).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'blue', remove: ['a'], recolor: [],
      add: [
        { start: 10, end: 15, color: 'yellow', from: 'a' },
        { start: 20, end: 30, color: 'yellow', from: 'a' },
        { start: 15, end: 20, color: 'blue' },
      ],
    });
  });

  it('words reaching out of a highlight: a new one over them, as before', () => {
    expect(planInk({ start: 5, end: 15, ink: 'yellow', marks: [mark('a', 10, 30, 'yellow')] })).toEqual({ kind: 'create', color: 'yellow' });
    expect(planInk({ start: 5, end: 40, ink: 'red', marks: [mark('a', 10, 30, 'yellow')] })).toEqual({ kind: 'create', color: 'red' });
  });

  it('«Nessun colore» takes the selection out of every highlight it touches, inside or across', () => {
    const plan = planInk({
      start: 15, end: 35, ink: 'none',
      marks: [mark('a', 10, 20, 'yellow'), mark('b', 25, 30, 'green'), mark('c', 30, 50, 'red'), mark('d', 60, 70, 'blue')],
    });
    expect(plan).toEqual({
      kind: 'edit', effect: 'removed', remove: ['a', 'b', 'c'], recolor: [],
      add: [{ start: 10, end: 15, color: 'yellow', from: 'a' }, { start: 35, end: 50, color: 'red', from: 'c' }],
    });
  });

  it('nested highlights: the colour seen is the innermost\'s', () => {
    const marks = [mark('outer', 0, 100, 'yellow'), mark('inner', 20, 50, 'green')];
    // Green seen, green ink: the piece goes from the green one; the yellow around it stays as it is.
    expect(planInk({ start: 30, end: 40, ink: 'green', marks })).toMatchObject({ effect: 'removed', remove: ['inner'] });
    // Green seen, yellow ink: the green piece is cut and the yellow around it shows; no second yellow over it.
    expect(planInk({ start: 30, end: 40, ink: 'yellow', marks })).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'yellow', remove: ['inner'], recolor: [],
      add: [{ start: 20, end: 30, color: 'green', from: 'inner' }, { start: 40, end: 50, color: 'green', from: 'inner' }],
    });
    // Two of the same colour, one in the other: the piece goes from both, so the words are no longer that colour.
    const twice = [mark('outer', 0, 100, 'yellow'), mark('inner', 20, 50, 'yellow')];
    expect(planInk({ start: 30, end: 40, ink: 'yellow', marks: twice })).toMatchObject({ effect: 'removed', remove: ['outer', 'inner'] });
  });

  it('a highlight that cannot be cut (from the Forum) is acted on whole: removed, or recoloured in place', () => {
    const forum = [mark('f', 10, 30, 'yellow', true)];
    expect(planInk({ start: 15, end: 20, ink: 'yellow', marks: forum })).toEqual({ kind: 'edit', effect: 'removed', remove: ['f'], recolor: [], add: [] });
    expect(planInk({ start: 15, end: 20, ink: 'none', marks: forum })).toEqual({ kind: 'edit', effect: 'removed', remove: ['f'], recolor: [], add: [] });
    expect(planInk({ start: 15, end: 20, ink: 'red', marks: forum })).toEqual({
      kind: 'edit', effect: 'recoloured', color: 'red', remove: [], recolor: [{ id: 'f', color: 'red' }], add: [],
    });
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
