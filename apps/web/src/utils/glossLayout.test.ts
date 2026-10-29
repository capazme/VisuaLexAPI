import { describe, expect, it } from 'vitest';
import { GLOSS_GAP, placeGlossCards } from './glossLayout';

describe('placeGlossCards: the glosses\' column, as a word processor places its comments (D8)', () => {
  it('puts each card at the height of its passage when it has room', () => {
    const { tops, height } = placeGlossCards([
      { id: 'a', want: 0, height: 80 },
      { id: 'b', want: 200, height: 60 },
    ]);
    expect(tops).toEqual({ a: 0, b: 200 });
    expect(height).toBe(260);
  });

  it('pushes a card that would overlap the one above under it, and the next ones after it, in the order given', () => {
    const { tops, height } = placeGlossCards([
      { id: 'a', want: 10, height: 100 },
      { id: 'b', want: 40, height: 50 },
      { id: 'c', want: 120, height: 30 },
      { id: 'd', want: 400, height: 20 },
    ]);
    expect(tops.a).toBe(10);
    expect(tops.b).toBe(10 + 100 + GLOSS_GAP);
    expect(tops.c).toBe(tops.b + 50 + GLOSS_GAP);
    // Room again: back at its passage.
    expect(tops.d).toBe(400);
    expect(height).toBe(420);
  });

  it('never above the column\'s top, rounded to the pixel; nothing to place is a column of no height', () => {
    expect(placeGlossCards([{ id: 'a', want: -12.6, height: 10 }]).tops.a).toBe(0);
    expect(placeGlossCards([{ id: 'a', want: 33.4, height: 10 }]).tops.a).toBe(33);
    expect(placeGlossCards([])).toEqual({ tops: {}, height: 0 });
  });

  it('a card not measured yet takes no room, and the next one waits only for the gap', () => {
    const { tops } = placeGlossCards([{ id: 'a', want: 0, height: 0 }, { id: 'b', want: 0, height: 0 }]);
    expect(tops).toEqual({ a: 0, b: GLOSS_GAP });
  });
});
