import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { appStore, type WorkspaceTab } from '../../../store/useAppStore';
import { ReadingBackControl } from './ReadingBackControl';

const articleTab = {
  id: 'article-tab', label: 'Codice civile', zIndex: 1, isHidden: false, isMinimized: false,
  content: [{ type: 'norma', id: 'block-1', norma: {}, articles: [] }],
} as unknown as WorkspaceTab;

beforeEach(() => {
  const decisionTab = appStore.getState().openDecisionTab({ corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 });
  void decisionTab;
});

// The jump from an article to a decision records its way back like a citation jump, and the one
// control of the app (desktop and phone alike) names the article and takes the reader there.
describe('ReadingBackControl after a jump to a decision', () => {
  it('names the article and walks back to its tab, on the phone through onNavigated', () => {
    appStore.setState((s) => ({ workspaceTabs: [articleTab, ...s.workspaceTabs], readingBackStack: [] }));
    appStore.getState().pushReadingBack({ tabId: 'article-tab', blockId: 'block-1', articleId: 'x', label: 'art. 2043 c.c.' });
    const onNavigated = vi.fn();
    render(<ReadingBackControl onNavigated={onNavigated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 2043 c.c.' }));
    expect(onNavigated).toHaveBeenCalledWith('article-tab');
    expect(appStore.getState().readingBackStack).toEqual([]);
  });
});
