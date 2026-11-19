import { describe, expect, it } from 'vitest';
import { opensUnder, revealBy } from './selectionSpace';

// A phone's view at 390: 812 px tall, its top bar 64 px (`scroll-padding-top`).
const view = { top: 64, bottom: 812 };

describe('where a selection\'s actions open (LC142, option A)', () => {
  it('under the paragraph when its end is within one view of the words', () => {
    expect(opensUnder(900, 400, view)).toBe(true);
    expect(opensUnder(400 + 748, 400, view)).toBe(true);
  });

  it('as an island from the words when the paragraph goes on further (a 55,572 px paragraph)', () => {
    expect(opensUnder(400 + 749, 400, view)).toBe(false);
    expect(opensUnder(30_000, 400, view)).toBe(false);
  });
});

describe('bringing the space into view, the words kept in it', () => {
  it('does not move when the space is in view', () => {
    expect(revealBy(800, 300, view)).toBe(0);
  });

  it('moves by what the space lacks when the words keep room above', () => {
    expect(revealBy(900, 400, view)).toBe(88);
  });

  it('moves at most until the words reach the top bar, never past it', () => {
    expect(revealBy(1500, 300, view)).toBe(236);
    expect(revealBy(1500, 50, view)).toBe(0);
  });
});
