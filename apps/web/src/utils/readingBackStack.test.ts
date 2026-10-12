import { describe, it, expect } from 'vitest';
import {
  appendBackEntry,
  findLiveBackIndex,
  peekReadingBack,
  READING_BACK_STACK_CAP,
  type BackStackEntry,
  type PracticeBackEntry,
} from './readingBackStack';
import { practiceArticleKey, type Practice } from './practice';

function entry(id: string, practiceId = 'p-1'): PracticeBackEntry {
  return { practiceId, subject: { kind: 'decision', decisionId: id }, place: 'table', label: `Art. ${id}` };
}

describe('appendBackEntry', () => {
  it('appends in order', () => {
    const stack = appendBackEntry(appendBackEntry([], entry('1')), entry('2'));
    expect(stack.map((e) => e.label)).toEqual(['Art. 1', 'Art. 2']);
  });

  it('does not mutate the stack it was given', () => {
    const original: PracticeBackEntry[] = [entry('1')];
    appendBackEntry(original, entry('2'));
    expect(original).toHaveLength(1);
  });

  it('drops the oldest once the cap is reached', () => {
    let stack: PracticeBackEntry[] = [];
    for (let i = 0; i < READING_BACK_STACK_CAP + 5; i++) {
      stack = appendBackEntry(stack, entry(String(i)));
    }
    expect(stack).toHaveLength(READING_BACK_STACK_CAP);
    expect(stack[0].label).toBe('Art. 5');
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
    expect(findLiveBackIndex([onArticle('table')], [practice])).toBe(0);
    expect(findLiveBackIndex([onArticle('beside')], [practice])).toBe(0);
    expect(findLiveBackIndex([onDecision], [practice])).toBe(0);
  });

  it('is dead once its practice is closed or its subject removed', () => {
    expect(findLiveBackIndex([onArticle('table')], [])).toBe(-1);
    expect(findLiveBackIndex([onArticle('table', 'p-gone')], [practice])).toBe(-1);
    expect(findLiveBackIndex([onArticle('table', 'p-1', 'gone|vigente')], [practice])).toBe(-1);
    expect(findLiveBackIndex([onDecision], [{ ...practice, decisions: [] }])).toBe(-1);
  });

  it('walks past the dead entries to the newest live one', () => {
    const stack: BackStackEntry[] = [entry('1'), onArticle('table'), onArticle('table', 'p-gone')];
    expect(findLiveBackIndex(stack, [practice])).toBe(1);
    expect(findLiveBackIndex(stack, [])).toBe(-1);
    expect(peekReadingBack(stack, [practice])?.label).toBe('art. 5');
    expect(peekReadingBack([onArticle('table', 'p-gone')], [practice])).toBeNull();
    expect(findLiveBackIndex([], [practice])).toBe(-1);
  });
});
