import { describe, it, expect, beforeEach } from 'vitest';
import { appStore, type WorkspaceTab } from '../useAppStore';
import type { ArticleData, Norma } from '../../types';
import type { ReadingBackEntry } from '../../utils/readingBackStack';

function makeTab(id: string, content: WorkspaceTab['content'] = []): WorkspaceTab {
    return {
        id,
        label: `Tab ${id}`,
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
        zIndex: 1,
        isMinimized: false,
        isHidden: false,
        content,
        labelIsCustom: false,
    };
}

function makeNorma(overrides: Partial<Norma> = {}): Norma {
    return {
        tipo_atto: 'codice civile',
        data: '1942-03-16',
        numero_atto: '262',
        urn: 'urn:nir:stato:regio.decreto:1942-03-16;262',
        ...overrides,
    };
}

function normaBlock(id: string, norma: Norma): WorkspaceTab['content'][number] {
    return { type: 'norma', id, norma, articles: [], isCollapsed: false };
}

function backEntry(overrides: Partial<ReadingBackEntry> = {}): ReadingBackEntry {
    return {
        tabId: 'tab-a',
        blockId: 'block-a',
        articleId: '2043',
        label: 'Art. 2043 — codice civile',
        ...overrides,
    };
}

describe('structure window ownership', () => {
    beforeEach(() => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a')],
            structureWindow: { blockId: null, position: { x: 100, y: 100 } },
        });
    });

    it('opens on the given block', () => {
        appStore.getState().openStructureWindow('block-1');
        expect(appStore.getState().structureWindow.blockId).toBe('block-1');
    });

    it('hands ownership over instead of stacking a second window', () => {
        appStore.getState().openStructureWindow('block-1');
        appStore.getState().openStructureWindow('block-2');

        // Single `blockId`, so "only one window" is structural, not enforced.
        expect(appStore.getState().structureWindow.blockId).toBe('block-2');
    });

    it('closing clears the owner but keeps the parked position', () => {
        appStore.getState().setStructureWindowPosition({ x: 42, y: 24 });
        appStore.getState().openStructureWindow('block-1');
        appStore.getState().closeStructureWindow();

        expect(appStore.getState().structureWindow.blockId).toBeNull();
        expect(appStore.getState().structureWindow.position).toEqual({ x: 42, y: 24 });
    });
});

describe('addNormaIndexToTab', () => {
    beforeEach(() => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a')],
            structureWindow: { blockId: null, position: { x: 100, y: 100 } },
            highestZIndex: 100,
        });
    });

    it('creates an article-less block and points the window at it', () => {
        const blockId = appStore.getState().addNormaIndexToTab('tab-a', makeNorma());

        expect(blockId).toBeTruthy();
        const tab = appStore.getState().workspaceTabs[0];
        expect(tab.content).toHaveLength(1);
        const block = tab.content[0];
        expect(block.type).toBe('norma');
        if (block.type === 'norma') {
            expect(block.articles).toEqual([]);
            expect(block.norma.urn).toBe(makeNorma().urn);
        }
        expect(appStore.getState().structureWindow.blockId).toBe(blockId);
    });

    it('reuses a block already holding the same act rather than duplicating it', () => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a', [normaBlock('existing', makeNorma())])],
        });

        const blockId = appStore.getState().addNormaIndexToTab('tab-a', makeNorma());

        expect(blockId).toBe('existing');
        expect(appStore.getState().workspaceTabs[0].content).toHaveLength(1);
        expect(appStore.getState().structureWindow.blockId).toBe('existing');
    });

    it('backfills the URN on a reused block that arrived without one', () => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a', [normaBlock('existing', makeNorma({ urn: undefined }))])],
        });

        appStore.getState().addNormaIndexToTab('tab-a', makeNorma());

        const block = appStore.getState().workspaceTabs[0].content[0];
        if (block.type === 'norma') {
            expect(block.norma.urn).toBe(makeNorma().urn);
        }
    });

    it('adds a separate block for a different act', () => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a', [normaBlock('existing', makeNorma())])],
        });

        appStore.getState().addNormaIndexToTab(
            'tab-a',
            makeNorma({ tipo_atto: 'codice penale', numero_atto: '1398', data: '1930-10-19' }),
        );

        expect(appStore.getState().workspaceTabs[0].content).toHaveLength(2);
    });

    it('returns null and touches nothing when the tab is gone', () => {
        const blockId = appStore.getState().addNormaIndexToTab('tab-missing', makeNorma());

        expect(blockId).toBeNull();
        expect(appStore.getState().structureWindow.blockId).toBeNull();
        expect(appStore.getState().workspaceTabs[0].content).toHaveLength(0);
    });
});

describe('focusArticleInTab id matching', () => {
    function blockWithArticle(numero: string, allegato?: string) {
        const article = {
            article_text: '',
            norma_data: {
                tipo_atto: 'codice civile',
                data: '1942-03-16',
                numero_atto: '262',
                numero_articolo: numero,
                allegato,
            },
        } as unknown as ArticleData;

        return {
            type: 'norma' as const,
            id: 'block-a',
            norma: makeNorma(),
            articles: [article],
            isCollapsed: false,
        };
    }

    beforeEach(() => {
        appStore.setState({ highestZIndex: 100 });
    });

    it('focuses an article whose suffix is spelled differently than the request', () => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a', [blockWithArticle('1 bis')])],
        });

        // The tree API hands out "1-bis" while the scraper stored "1 bis".
        appStore.getState().focusArticleInTab('tab-a', '1-bis');

        const block = appStore.getState().workspaceTabs[0].content[0];
        if (block.type === 'norma') {
            expect(block.autoFocusArticleId).toBe('1-bis');
        }
    });

    it('matches annex-prefixed ids', () => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a', [blockWithArticle('3', '2')])],
        });

        appStore.getState().focusArticleInTab('tab-a', 'all2:3');

        const block = appStore.getState().workspaceTabs[0].content[0];
        if (block.type === 'norma') {
            expect(block.autoFocusArticleId).toBe('all2:3');
        }
    });

    it('leaves the block alone when no article matches', () => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a', [blockWithArticle('1')])],
        });

        appStore.getState().focusArticleInTab('tab-a', '9999');

        const block = appStore.getState().workspaceTabs[0].content[0];
        if (block.type === 'norma') {
            expect(block.autoFocusArticleId).toBeUndefined();
        }
    });
});

describe('reading back-stack', () => {
    beforeEach(() => {
        appStore.setState({
            workspaceTabs: [makeTab('tab-a', [normaBlock('block-a', makeNorma())])],
            readingBackStack: [],
        });
    });

    it('pops entries newest first', () => {
        appStore.getState().pushReadingBack(backEntry({ articleId: '2043' }));
        appStore.getState().pushReadingBack(backEntry({ articleId: '2050' }));

        expect(appStore.getState().popReadingBack()?.articleId).toBe('2050');
        expect(appStore.getState().popReadingBack()?.articleId).toBe('2043');
        expect(appStore.getState().popReadingBack()).toBeNull();
    });

    it('returns null on an empty stack', () => {
        expect(appStore.getState().popReadingBack()).toBeNull();
    });

    it('skips entries pointing at a closed tab and discards them', () => {
        appStore.getState().pushReadingBack(backEntry({ articleId: 'live' }));
        appStore.getState().pushReadingBack(backEntry({ articleId: 'dead', tabId: 'tab-gone' }));

        expect(appStore.getState().popReadingBack()?.articleId).toBe('live');
        // The dead entry above it is dropped with the one consumed, not left
        // behind to offer the same dead end again.
        expect(appStore.getState().readingBackStack).toHaveLength(0);
    });

    it('skips entries whose block was removed from a live tab', () => {
        appStore.getState().pushReadingBack(backEntry({ articleId: 'live' }));
        appStore.getState().pushReadingBack(backEntry({ articleId: 'dead', blockId: 'block-gone' }));

        expect(appStore.getState().popReadingBack()?.articleId).toBe('live');
    });

    it('clears the stack when every entry is unreachable', () => {
        appStore.getState().pushReadingBack(backEntry({ tabId: 'tab-gone' }));
        appStore.getState().pushReadingBack(backEntry({ tabId: 'tab-gone' }));

        expect(appStore.getState().popReadingBack()).toBeNull();
        expect(appStore.getState().readingBackStack).toHaveLength(0);
    });
});
