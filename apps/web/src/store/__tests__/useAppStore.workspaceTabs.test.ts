import { describe, it, expect, beforeEach } from 'vitest';
import { appStore, type WorkspaceTab } from '../useAppStore';

function makeTab(id: string): WorkspaceTab {
    return {
        id,
        label: `Tab ${id}`,
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
        zIndex: 1,
        isMinimized: false,
        isHidden: false,
        content: [],
        labelIsCustom: false,
    };
}

describe('useAppStore reorderWorkspaceTabs', () => {
    beforeEach(() => {
        appStore.setState({
            workspaceTabs: [makeTab('a'), makeTab('b'), makeTab('c')],
        });
    });

    it('moves a tab from one index to another', () => {
        appStore.getState().reorderWorkspaceTabs(0, 2);

        const ids = appStore.getState().workspaceTabs.map((t) => t.id);
        expect(ids).toEqual(['b', 'c', 'a']);
    });

    it('moves a tab backwards', () => {
        appStore.getState().reorderWorkspaceTabs(2, 0);

        const ids = appStore.getState().workspaceTabs.map((t) => t.id);
        expect(ids).toEqual(['c', 'a', 'b']);
    });

    it('is a no-op when fromIndex equals toIndex', () => {
        appStore.getState().reorderWorkspaceTabs(1, 1);

        const ids = appStore.getState().workspaceTabs.map((t) => t.id);
        expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('is a no-op when an index is negative', () => {
        appStore.getState().reorderWorkspaceTabs(-1, 1);

        const ids = appStore.getState().workspaceTabs.map((t) => t.id);
        expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('is a no-op when an index is out of bounds', () => {
        appStore.getState().reorderWorkspaceTabs(0, 10);

        const ids = appStore.getState().workspaceTabs.map((t) => t.id);
        expect(ids).toEqual(['a', 'b', 'c']);
    });
});

describe('useAppStore bringTabToFront and revealTab', () => {
    beforeEach(() => {
        appStore.setState({
            workspaceTabs: [makeTab('a'), { ...makeTab('b'), isMinimized: true, isHidden: true }, makeTab('c')],
            highestZIndex: 10,
            mobileActiveTabId: 'a',
        });
    });

    const tab = (id: string) => appStore.getState().workspaceTabs.find((t) => t.id === id)!;

    it('bringTabToFront only raises: a minimised or hidden tab stays so, and the phone keeps its tab', () => {
        appStore.getState().bringTabToFront('b');
        expect(tab('b')).toMatchObject({ zIndex: 11, isMinimized: true, isHidden: true });
        expect(appStore.getState().mobileActiveTabId).toBe('a');
    });

    it('revealTab raises, restores and makes the tab the phone\'s tab on screen', () => {
        appStore.getState().revealTab('b');
        expect(tab('b')).toMatchObject({ zIndex: 11, isMinimized: false, isHidden: false });
        expect(appStore.getState().mobileActiveTabId).toBe('b');
    });

    it('revealTab ignores a tab that is not open', () => {
        appStore.getState().revealTab('gone');
        expect(appStore.getState().highestZIndex).toBe(10);
        expect(appStore.getState().mobileActiveTabId).toBe('a');
    });
});

describe('useAppStore mobileActiveTabId', () => {
    beforeEach(() => {
        appStore.setState({ workspaceTabs: [makeTab('a'), makeTab('b'), makeTab('c')], mobileActiveTabId: 'b' });
    });

    it('closing the tab on screen shows the one that took its place', () => {
        appStore.getState().removeTab('b');
        expect(appStore.getState().mobileActiveTabId).toBe('c');
    });

    it('closing the last tab while on screen shows the one before it', () => {
        appStore.setState({ mobileActiveTabId: 'c' });
        appStore.getState().removeTab('c');
        expect(appStore.getState().mobileActiveTabId).toBe('b');
    });

    it('closing another tab leaves it alone, and closing every tab clears it', () => {
        appStore.getState().removeTab('a');
        expect(appStore.getState().mobileActiveTabId).toBe('b');
        appStore.getState().closeAllWorkspaceTabs();
        expect(appStore.getState().mobileActiveTabId).toBeNull();
    });

    it('is not persisted with the workspace', () => {
        const options = (appStore as unknown as { persist: { getOptions: () => { partialize: (s: unknown) => Record<string, unknown> } } }).persist.getOptions();
        expect(options.partialize(appStore.getState())).not.toHaveProperty('mobileActiveTabId');
    });
});

describe('useAppStore focusArticleInTab — showing an article opens what hides it', () => {
    const norma = { tipo_atto: 'codice civile', data: '', numero_articolo: '2043' };
    const article = { article_text: 'testo', norma_data: norma };

    function tabWith(content: WorkspaceTab['content']): WorkspaceTab {
        return { ...makeTab('t'), isMinimized: true, content };
    }

    it('expands a collapsed block, raises and restores its tab, and signals the article', () => {
        appStore.setState({
            workspaceTabs: [tabWith([{ type: 'norma', id: 'blk', norma: { tipo_atto: 'codice civile', data: '' }, articles: [article], isCollapsed: true }])],
        });
        appStore.getState().focusArticleInTab('t', '2043');
        const tab = appStore.getState().workspaceTabs[0];
        const block = tab.content[0];
        expect(block.type === 'norma' && block.isCollapsed).toBe(false);
        expect(block.type === 'norma' && block.autoFocusArticleId).toBe('2043');
        expect(tab.isMinimized).toBe(false);
    });

    it('expands a collapsed collection that holds the article', () => {
        appStore.setState({
            workspaceTabs: [tabWith([{ type: 'collection', id: 'col', label: 'raccolta', isCollapsed: true, articles: [{ article, sourceNorma: norma }] }])],
        });
        appStore.getState().focusArticleInTab('t', '2043');
        const tab = appStore.getState().workspaceTabs[0];
        const collection = tab.content[0];
        expect(collection.type === 'collection' && collection.isCollapsed).toBe(false);
        expect(tab.isMinimized).toBe(false);
    });

    it('leaves an article that is not in the tab alone', () => {
        appStore.setState({
            workspaceTabs: [tabWith([{ type: 'norma', id: 'blk', norma: { tipo_atto: 'codice civile', data: '' }, articles: [article], isCollapsed: true }])],
        });
        appStore.getState().focusArticleInTab('t', '9999');
        const block = appStore.getState().workspaceTabs[0].content[0];
        expect(block.type === 'norma' && block.isCollapsed).toBe(true);
        expect(appStore.getState().workspaceTabs[0].isMinimized).toBe(true);
    });
});
