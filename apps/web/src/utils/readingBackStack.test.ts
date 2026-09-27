import { describe, it, expect } from 'vitest';
import {
  appendBackEntry,
  findLiveBackIndex,
  peekReadingBack,
  READING_BACK_STACK_CAP,
  type ReadingBackEntry,
} from './readingBackStack';

function entry(id: string, tabId = 'tab-1', blockId = 'block-1'): ReadingBackEntry {
  return { tabId, blockId, articleId: id, label: `Art. ${id}` };
}

/** A workspace tab holding the given norma block ids. */
function tab(id: string, blockIds: string[]) {
  return { id, content: blockIds.map(b => ({ type: 'norma', id: b })) };
}

describe('appendBackEntry', () => {
  it('appends to the end', () => {
    const stack = appendBackEntry(appendBackEntry([], entry('1')), entry('2'));
    expect(stack.map(e => e.articleId)).toEqual(['1', '2']);
  });

  it('does not mutate the input', () => {
    const original: ReadingBackEntry[] = [entry('1')];
    appendBackEntry(original, entry('2'));
    expect(original).toHaveLength(1);
  });

  it('discards the oldest entry once the cap is reached', () => {
    let stack: ReadingBackEntry[] = [];
    for (let i = 0; i < READING_BACK_STACK_CAP + 5; i++) {
      stack = appendBackEntry(stack, entry(String(i)));
    }
    expect(stack).toHaveLength(READING_BACK_STACK_CAP);
    // The five oldest are gone, the newest survived.
    expect(stack[0].articleId).toBe('5');
    expect(stack[stack.length - 1].articleId).toBe(String(READING_BACK_STACK_CAP + 4));
  });
});

describe('findLiveBackIndex', () => {
  it('returns the newest entry when it is still live', () => {
    const stack = [entry('1'), entry('2')];
    expect(findLiveBackIndex(stack, [tab('tab-1', ['block-1'])])).toBe(1);
  });

  it('walks past entries whose tab has been closed', () => {
    const stack = [entry('1', 'tab-1'), entry('2', 'tab-gone')];
    expect(findLiveBackIndex(stack, [tab('tab-1', ['block-1'])])).toBe(0);
  });

  it('walks past entries whose block has been removed from a live tab', () => {
    const stack = [entry('1', 'tab-1', 'block-1'), entry('2', 'tab-1', 'block-gone')];
    expect(findLiveBackIndex(stack, [tab('tab-1', ['block-1'])])).toBe(0);
  });

  it('returns -1 when nothing in the stack is reachable', () => {
    const stack = [entry('1', 'tab-gone'), entry('2', 'tab-gone')];
    expect(findLiveBackIndex(stack, [tab('tab-1', ['block-1'])])).toBe(-1);
  });

  it('returns -1 for an empty stack', () => {
    expect(findLiveBackIndex([], [tab('tab-1', ['block-1'])])).toBe(-1);
  });

  it('ignores same-id content that is not a norma block', () => {
    const stack = [entry('1', 'tab-1', 'block-1')];
    const tabWithLooseArticle = {
      id: 'tab-1',
      content: [{ type: 'loose-article', id: 'block-1' }],
    };
    expect(findLiveBackIndex(stack, [tabWithLooseArticle])).toBe(-1);
  });
});

describe('peekReadingBack', () => {
  it('returns the entry the control would take you to', () => {
    const stack = [entry('1'), entry('2')];
    expect(peekReadingBack(stack, [tab('tab-1', ['block-1'])])?.articleId).toBe('2');
  });

  it('returns null when there is nowhere live to go back to', () => {
    expect(peekReadingBack([entry('1', 'tab-gone')], [tab('tab-1', ['block-1'])])).toBeNull();
  });
});
