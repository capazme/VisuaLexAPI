import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInkAnchor, keepExact, wholeWordsRange } from './inkSelection';

/** A text root drawn from `html`, in the document (the selection must live there). */
function root(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

/** The text nodes of `el` in order. */
const texts = (el: Node): Text[] => {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
};

/** Selects from the `from`-th character of the text node `a` to the `to`-th of `b`. */
function select(a: Text, from: number, b: Text, to: number): Selection {
  const selection = document.getSelection()!;
  selection.setBaseAndExtent(a, from, b, to);
  return selection;
}

/** A press of the mouse that makes `make()`'s selection, with Alt held or not. */
function press(alt: boolean, make: () => void) {
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, altKey: alt }));
  make();
  document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, altKey: alt }));
}

afterEach(() => {
  vi.useRealTimers();
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('the highlighter takes whole words (A4, 5 November 2026)', () => {
  it('a selection that cuts a word at either end takes it whole, across the marks inside the word', () => {
    const el = root('<div class="vlx-b">Il <mark>dan</mark>no ingiusto obbliga</div>');
    const [il, dan, rest] = texts(el);
    expect(il.data).toBe('Il ');
    // «anno ingiu»: from inside the mark to inside «ingiusto».
    const selection = select(dan, 1, rest, 'no ingiu'.length);
    expect(getInkAnchor(el, selection)).toEqual({ text: 'danno ingiusto', startOffset: 3 });
  });

  it('leaves a selection that cuts no word as it is, and a selection that starts on a space at its start', () => {
    const el = root('<div class="vlx-b">Il danno ingiusto</div>');
    const [text] = texts(el);
    expect(getInkAnchor(el, select(text, 3, text, 8))).toEqual({ text: 'danno', startOffset: 3 });
    expect(getInkAnchor(el, select(text, 2, text, 11))).toEqual({ text: 'danno ingiusto', startOffset: 3 });
  });

  it('never runs a word into the next block, nor past a line break, where the projection joins them', () => {
    const el = root('<div class="vlx-b">per fatto illecito</div><div class="vlx-b">Qualunque fatto</div><p>art. 2043<br>Risarcimento</p>');
    const [first, second, number, rubric] = texts(el);
    expect(getInkAnchor(el, select(first, 'per fatto ill'.length, first, 'per fatto illec'.length))).toEqual({ text: 'illecito', startOffset: 10 });
    expect(getInkAnchor(el, select(second, 1, second, 4))).toEqual({ text: 'Qualunque', startOffset: 18 });
    // Across the two blocks: each edge to its own word's edge, the projection's text in between.
    expect(getInkAnchor(el, select(first, 'per fatto illeci'.length, second, 3))?.text).toBe('illecitoQualunque');
    expect(getInkAnchor(el, select(rubric, 1, rubric, 5))?.text).toBe('Risarcimento');
    expect(getInkAnchor(el, select(number, 6, number, 8))?.text).toBe('2043');
  });

  it('takes a word written with accents whole, and an elided article as a word of its own', () => {
    const el = root('<div class="vlx-b">perché dell’articolo</div>');
    const [text] = texts(el);
    expect(getInkAnchor(el, select(text, 1, text, 5))?.text).toBe('perché');
    expect(getInkAnchor(el, select(text, 'perché dell’'.length, text, 'perché dell’arti'.length))?.text).toBe('articolo');
    expect(getInkAnchor(el, select(text, 'perché de'.length, text, 'perché dell’ar'.length))?.text).toBe('dell’articolo');
  });

  it('widens a boundary that sits on an element as well as one inside a text', () => {
    const el = root('<div class="vlx-b">dan<mark>no</mark> ingiusto</div>');
    const block = el.firstElementChild!;
    const range = document.createRange();
    // From between «dan» and the mark (an element boundary) to inside «ingiusto».
    range.setStart(block, 1);
    range.setEnd(texts(el)[2], 4);
    expect(wholeWordsRange(el, range).toString()).toBe('danno ingiusto');
  });
});

describe('with Alt held, the piece exactly as selected', () => {
  it('a press with Alt makes the exact piece, as long as the selection stands as made', () => {
    const el = root('<div class="vlx-b">Il danno ingiusto</div>');
    const [text] = texts(el);
    press(true, () => select(text, 4, text, 10));
    expect(getInkAnchor(el, document.getSelection())).toEqual({ text: 'anno i', startOffset: 4 });
    // A press that leaves the selection as it was (a button over it) changes nothing.
    press(false, () => {});
    expect(getInkAnchor(el, document.getSelection())?.text).toBe('anno i');
    // A new selection without Alt is widened again.
    press(false, () => select(text, 4, text, 11));
    expect(getInkAnchor(el, document.getSelection())?.text).toBe('danno ingiusto');
  });

  it('Alt pressed at any moment of the press counts, and a selection moved since is widened', () => {
    const el = root('<div class="vlx-b">Il danno ingiusto</div>');
    const [text] = texts(el);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    select(text, 4, text, 7);
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, altKey: true }));
    document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(getInkAnchor(el, document.getSelection())?.text).toBe('ann');
    // Moved from the keyboard: whole words again.
    select(text, 4, text, 8);
    expect(getInkAnchor(el, document.getSelection())?.text).toBe('danno');
  });

  it('a selection made from the keyboard, Shift and the arrows, is taken as made; a key in a field is not one', () => {
    vi.useFakeTimers();
    const el = root('<div class="vlx-b">Il danno ingiusto</div>');
    const [text] = texts(el);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    select(text, 4, text, 7);
    document.dispatchEvent(new Event('selectionchange'));
    expect(getInkAnchor(el, document.getSelection())?.text).toBe('ann');
    // The key's moment is over.
    vi.advanceTimersByTime(1000);
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    press(false, () => select(text, 4, text, 8));
    document.dispatchEvent(new Event('selectionchange'));
    expect(getInkAnchor(el, document.getSelection())?.text).toBe('danno');
  });

  it('a selection kept exact by the code (a highlight\'s words) is taken as it is', () => {
    const el = root('<div class="vlx-b">Il danno ingiusto</div>');
    const [text] = texts(el);
    keepExact(select(text, 4, text, 7));
    expect(getInkAnchor(el, document.getSelection())?.text).toBe('ann');
  });
});
