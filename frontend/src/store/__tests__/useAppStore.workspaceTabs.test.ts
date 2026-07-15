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
