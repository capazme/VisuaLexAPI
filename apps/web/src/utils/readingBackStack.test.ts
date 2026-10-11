import { describe, it, expect } from 'vitest';
import {
  appendBackEntry,
  findLiveBackIndex,
  peekReadingBack,
  READING_BACK_STACK_CAP,
  type BackStackEntry,
  type PracticeBackEntry,
  type ReadingBackEntry,
} from './readingBackStack';
import { practiceArticleKey, type Practice } from './practice';

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

describe('findLiveBackIndex with a decision tab', () => {
  const decisionEntry: ReadingBackEntry = { tabId: 'dec-1', blockId: 'dec-1', articleId: '', label: 'Cass. civ., n. 1/2024' };

  it('is live while the decision tab is open, its block being the tab itself', () => {
    const decisionTab = { id: 'dec-1', content: [], view: { kind: 'decision' } };
    expect(findLiveBackIndex([decisionEntry], [decisionTab])).toBe(0);
  });

  it('is dead once the tab is closed, or when it is not a decision', () => {
    expect(findLiveBackIndex([decisionEntry], [])).toBe(-1);
    expect(findLiveBackIndex([decisionEntry], [{ id: 'dec-1', content: [], view: { kind: 'decision-search' } }])).toBe(-1);
    expect(findLiveBackIndex([decisionEntry], [{ id: 'dec-1', content: [] }])).toBe(-1);
  });
});

describe('peekReadingBack', () => {
  it('returns the entry the control would take you to', () => {
    const stack = [entry('1'), entry('2')];
    expect(peekReadingBack(stack, [tab('tab-1', ['block-1'])])).toEqual(entry('2'));
  });

  it('returns null when there is nowhere live to go back to', () => {
    expect(peekReadingBack([entry('1', 'tab-gone')], [tab('tab-1', ['block-1'])])).toBeNull();
  });
});

describe('findLiveBackIndex over practices (spec §6.3)', () => {
  const art5 = {
    article_text: 'Art. 5',
    norma_data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: '5', versione: 'vigente' },
  };
  const key5 = practiceArticleKey(art5);
  const practice: Practice = {
    id: 'p-1', label: 'Pratica', labelIsCustom: false, beside: [],
    acts: [{ id: 'act-1', key: 'legge|24|2017-03-08', norma: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' }, articles: [art5], isCollapsed: false }],
    decisions: [{ id: 'dec-1', reference: { corte: 'cassazione', numero: 1, anno: 2024 }, label: 'Cass. civ., n. 1/2024', identified: false }],
  };
  const onArticle = (place: 'table' | 'beside', practiceId = 'p-1', articleKey = key5): PracticeBackEntry => ({
    practiceId, subject: { kind: 'article', actId: 'act-1', articleKey }, place, label: 'art. 5',
  });
  const onDecision: PracticeBackEntry = {
    practiceId: 'p-1', subject: { kind: 'decision', decisionId: 'dec-1' }, place: 'beside', label: 'Cass.',
  };

  it('is live while its practice holds its subject, at the table or beside', () => {
    expect(findLiveBackIndex([onArticle('table')], [], [practice])).toBe(0);
    expect(findLiveBackIndex([onArticle('beside')], [], [practice])).toBe(0);
    expect(findLiveBackIndex([onDecision], [], [practice])).toBe(0);
  });

  it('is dead once its practice is closed or its subject removed', () => {
    expect(findLiveBackIndex([onArticle('table')], [], [])).toBe(-1);
    expect(findLiveBackIndex([onArticle('table', 'p-gone')], [], [practice])).toBe(-1);
    expect(findLiveBackIndex([onArticle('table', 'p-1', 'gone|vigente')], [], [practice])).toBe(-1);
    expect(findLiveBackIndex([onDecision], [], [{ ...practice, decisions: [] }])).toBe(-1);
  });

  it('walks a stack holding both shapes', () => {
    const stack: BackStackEntry[] = [entry('1'), onArticle('table'), onArticle('table', 'p-gone')];
    expect(findLiveBackIndex(stack, [tab('tab-1', ['block-1'])], [practice])).toBe(1);
    expect(findLiveBackIndex(stack, [tab('tab-1', ['block-1'])], [])).toBe(0);
    expect(peekReadingBack(stack, [], [practice])?.label).toBe('art. 5');
  });

  it('a tab entry never reads a practice of the same id as its tab', () => {
    const named: ReadingBackEntry = { tabId: 'p-1', blockId: 'act-1', articleId: '5', label: 'art. 5' };
    expect(findLiveBackIndex([named], [], [practice])).toBe(-1);
  });
});
