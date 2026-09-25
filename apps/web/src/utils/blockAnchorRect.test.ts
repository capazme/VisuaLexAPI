import { describe, it, expect, vi } from 'vitest';
import { blockAnchorRect, signReference } from './blockAnchorRect';

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;

function signIn(block: DOMRect, sign: DOMRect) {
  const blockEl = document.createElement('div');
  const signEl = document.createElement('span');
  blockEl.appendChild(signEl);
  vi.spyOn(blockEl, 'getBoundingClientRect').mockReturnValue(block);
  vi.spyOn(signEl, 'getBoundingClientRect').mockReturnValue(sign);
  return signEl;
}

describe('blockAnchorRect', () => {
  it('in the margin: the sign\'s width, the block\'s height', () => {
    const sign = signIn(rect(300, 145, 1026, 215), rect(1038, 150, 1101, 169));
    expect(blockAnchorRect(sign, 900)).toMatchObject({ left: 1038, right: 1101, top: 145, bottom: 215 });
  });

  it('inline: from the sign to the end of the column, the block\'s height', () => {
    const sign = signIn(rect(100, 150, 650, 220), rect(500, 200, 540, 215));
    expect(blockAnchorRect(sign, 900)).toMatchObject({ left: 500, right: 650, top: 150, bottom: 220, width: 150, height: 70 });
  });

  it('only the part of the block that is on screen', () => {
    const sign = signIn(rect(100, -100, 650, 2000), rect(660, -95, 700, -80));
    expect(blockAnchorRect(sign, 900)).toMatchObject({ top: 0, bottom: 900 });
  });

  it('nothing for a sign without a box (hidden with the highlights, or gone)', () => {
    const sign = signIn(rect(100, 150, 650, 220), rect(0, 0, 0, 0));
    expect(blockAnchorRect(sign, 900)).toBeNull();
  });
});

describe('signReference', () => {
  it('measures the live sign, and keeps the last place while it has no box or is gone', () => {
    const sign = signIn(rect(300, 145, 1026, 215), rect(1038, 150, 1101, 169));
    let current: Element | null = sign;
    const reference = signReference(() => current);
    expect(reference.getBoundingClientRect()).toMatchObject({ left: 1038, top: 145 });
    vi.mocked(sign.getBoundingClientRect).mockReturnValue(rect(0, 0, 0, 0));
    expect(reference.getBoundingClientRect()).toMatchObject({ left: 1038, top: 145 });
    current = null;
    expect(reference.getBoundingClientRect()).toMatchObject({ left: 1038, top: 145 });
  });
});
