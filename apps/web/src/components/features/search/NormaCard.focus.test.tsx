import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ArticleData, Norma } from '../../../types';

// The card's own state is under test, not what it draws inside an article.
vi.mock('./ArticleTabContent', () => ({
  ArticleTabContent: ({ data }: { data: ArticleData }) => <div data-testid="article">art-{data.norma_data.numero_articolo}</div>,
}));
vi.mock('./TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('./AnnexSuggestion', () => ({ AnnexSuggestion: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/ArticleMinimap', () => ({ ArticleMinimap: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../../../hooks/useAnnexNavigation', () => ({
  useAnnexNavigation: () => ({
    treeData: null,
    treeMetadata: null,
    treeLoading: false,
    treeVisible: false,
    setTreeVisible: () => {},
    rubriche: {},
    abrogati: [],
    rubricheParts: null,
    currentAnnex: null,
    allArticleIds: [],
    loadingArticle: false,
    fetchTree: () => {},
    handleAnnexSelect: () => {},
    handleLoadArticle: () => {},
    isArticleLoaded: () => true,
    loadedArticleIds: [],
  }),
}));

import { appStore } from '../../../store/useAppStore';
import { NormaCard } from './NormaCard';

const NORMA: Norma = { tipo_atto: 'codice civile', data: '' };
const ARTICLES: ArticleData[] = ['1', '2', '3'].map((n) => ({ article_text: `testo ${n}`, norma_data: { ...NORMA, numero_articolo: n } }));
const shown = (n: string) => screen.queryAllByText(`art-${n}`).length;

let savedMatchMedia: typeof window.matchMedia;
function viewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const consume = vi.fn();
beforeEach(() => {
  savedMatchMedia = window.matchMedia;
  consume.mockClear();
  appStore.setState({ consumeAutoFocusArticle: consume });
});
afterEach(() => {
  window.matchMedia = savedMatchMedia;
});

const card = (autoFocusArticleId?: string) => (
  <NormaCard norma={NORMA} articles={ARTICLES} tabId="tab-1" normaBlockId="block-1" autoFocusArticleId={autoFocusArticleId} onCloseArticle={() => {}} onViewPdf={() => {}} />
);

describe('NormaCard — «show this article» on a phone', () => {
  it('opens the article the store asks for, and consumes the signal', () => {
    viewport(false);
    const { rerender } = render(card());
    expect(shown('3')).toBe(0);
    expect(consume).not.toHaveBeenCalled();

    rerender(card('3'));

    expect(shown('3')).toBeGreaterThan(0);
    expect(consume).toHaveBeenCalledWith('tab-1', 'block-1');
  });

  it('opens it when the card mounts with the signal already set (the carousel brought the tab on screen)', () => {
    viewport(false);
    render(card('2'));
    expect(shown('2')).toBeGreaterThan(0);
    expect(consume).toHaveBeenCalledWith('tab-1', 'block-1');
  });

  it('opens it again when it is asked for again after the reader closed it', () => {
    viewport(false);
    // The phone's list: one header per article, open ones tinted.
    const header = (n: number) => screen.getAllByText('Dispositivo Articolo')[n].closest('.cursor-pointer') as HTMLElement;
    const isOpen = (n: number) => header(n).className.includes('bg-primary-50/30');
    const { rerender } = render(card('3'));
    expect(isOpen(2)).toBe(true);
    rerender(card(undefined)); // consumed
    fireEvent.click(header(2)); // the reader closes it
    expect(isOpen(2)).toBe(false);
    rerender(card('3'));
    expect(isOpen(2)).toBe(true);
  });

  it('opens a card the reader closed, to show the article asked for', () => {
    viewport(false);
    const { rerender } = render(card());
    const toggle = screen.getAllByRole('button', { name: /comprimi/ })[0];
    fireEvent.click(toggle);
    expect(screen.queryAllByText('Dispositivo Articolo')).toHaveLength(0);
    rerender(card('2'));
    expect(shown('2')).toBeGreaterThan(0);
  });

  it('leaves the signal to the workspace block on a desktop', () => {
    viewport(true);
    render(card('3'));
    expect(shown('3')).toBe(0);
    expect(consume).not.toHaveBeenCalled();
  });
});
