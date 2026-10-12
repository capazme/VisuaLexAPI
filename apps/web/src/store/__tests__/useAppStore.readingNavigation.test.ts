import { describe, it, expect, beforeEach } from 'vitest';
import { appStore, type WorkspaceTab } from '../useAppStore';
import type { Norma } from '../../types';
import type { BackStackEntry, ReadingBackEntry } from '../../utils/readingBackStack';

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

/** The article a pop returns to: these entries are all of a tab, the shape this file pushes. */
function poppedArticleId(): string | undefined {
    const entry: BackStackEntry | null = appStore.getState().popReadingBack();
    return entry && 'articleId' in entry ? entry.articleId : undefined;
}

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

        expect(poppedArticleId()).toBe('2050');
        expect(poppedArticleId()).toBe('2043');
        expect(appStore.getState().popReadingBack()).toBeNull();
    });

    it('returns null on an empty stack', () => {
        expect(appStore.getState().popReadingBack()).toBeNull();
    });

    it('skips entries pointing at a closed tab and discards them', () => {
        appStore.getState().pushReadingBack(backEntry({ articleId: 'live' }));
        appStore.getState().pushReadingBack(backEntry({ articleId: 'dead', tabId: 'tab-gone' }));

        expect(poppedArticleId()).toBe('live');
        // The dead entry above it is dropped with the one consumed, not left
        // behind to offer the same dead end again.
        expect(appStore.getState().readingBackStack).toHaveLength(0);
    });

    it('skips entries whose block was removed from a live tab', () => {
        appStore.getState().pushReadingBack(backEntry({ articleId: 'live' }));
        appStore.getState().pushReadingBack(backEntry({ articleId: 'dead', blockId: 'block-gone' }));

        expect(poppedArticleId()).toBe('live');
    });

    it('clears the stack when every entry is unreachable', () => {
        appStore.getState().pushReadingBack(backEntry({ tabId: 'tab-gone' }));
        appStore.getState().pushReadingBack(backEntry({ tabId: 'tab-gone' }));

        expect(appStore.getState().popReadingBack()).toBeNull();
        expect(appStore.getState().readingBackStack).toHaveLength(0);
    });
});
