import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from '../useAppStore';
import type { ReadingBackEntry } from '../../utils/readingBackStack';
import { practiceArticleKey } from '../../utils/practice';
import { L24, article } from '../../utils/__fixtures__/savedWorkspaces';

const s = () => appStore.getState();

describe('structure window ownership', () => {
    beforeEach(() => {
        appStore.setState({
            structureWindow: { blockId: null, position: { x: 100, y: 100 } },
        });
    });

    it('opens on the given block', () => {
        s().openStructureWindow('block-1');
        expect(s().structureWindow.blockId).toBe('block-1');
    });

    it('hands ownership over instead of stacking a second window', () => {
        s().openStructureWindow('block-1');
        s().openStructureWindow('block-2');

        // Single `blockId`, so "only one window" is structural, not enforced.
        expect(s().structureWindow.blockId).toBe('block-2');
    });

    it('closing clears the owner but keeps the parked position', () => {
        s().setStructureWindowPosition({ x: 42, y: 24 });
        s().openStructureWindow('block-1');
        s().closeStructureWindow();

        expect(s().structureWindow.blockId).toBeNull();
        expect(s().structureWindow.position).toEqual({ x: 42, y: 24 });
    });
});

describe('reading back-stack', () => {
    let practiceId: string;
    let actId: string;

    /** A jump from the row of art. `n` of the practice, as the reading surface pushes it. */
    const from = (n: string, overrides: Partial<ReadingBackEntry> = {}): ReadingBackEntry => ({
        tabId: practiceId, blockId: actId, articleId: n, label: `Art. ${n}`, ...overrides,
    });
    /** The label of the entry a pop returns to. */
    const popped = (): string | undefined => s().popReadingBack()?.label;

    beforeEach(() => {
        appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [] });
        ({ practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7'), article(L24, '9')]));
    });

    it('pops entries newest first', () => {
        s().pushReadingBack(from('5'));
        s().pushReadingBack(from('7'));

        expect(popped()).toBe('Art. 7');
        expect(popped()).toBe('Art. 5');
        expect(s().popReadingBack()).toBeNull();
    });

    it('returns null on an empty stack', () => {
        expect(s().popReadingBack()).toBeNull();
    });

    it('keeps no entry that names nothing the practices hold', () => {
        s().pushReadingBack(from('5', { tabId: 'practice-gone' }));
        s().pushReadingBack(from('5', { blockId: 'act-gone' }));
        s().pushReadingBack(from('1000'));

        expect(s().readingBackStack).toHaveLength(0);
    });

    it('skips entries whose subject was removed since, and discards them', () => {
        s().pushReadingBack(from('5'));
        s().pushReadingBack(from('7'));
        s().removePracticeArticle(practiceId, actId, practiceArticleKey(article(L24, '7')));

        expect(popped()).toBe('Art. 5');
        // Nothing is left behind to offer the same dead end again.
        expect(s().readingBackStack).toHaveLength(0);
    });

    it('clears the stack when every entry is unreachable', () => {
        s().pushReadingBack(from('5'));
        s().pushReadingBack(from('7'));
        s().closePractice(practiceId);

        expect(s().popReadingBack()).toBeNull();
        expect(s().readingBackStack).toHaveLength(0);
    });
});
