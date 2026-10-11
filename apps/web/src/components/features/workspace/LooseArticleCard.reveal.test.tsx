import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ArticleData, Norma } from '../../../types';
import type { LooseArticle } from '../../../store/useAppStore';

vi.mock('../search/ArticleTabContent', () => ({
  ArticleTabContent: () => <div data-testid="article">testo</div>,
}));
vi.mock('./LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../dossier/AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));

import { LooseArticleCard } from './LooseArticleCard';

const NORMA: Norma = { tipo_atto: 'codice civile', data: '' };
const ARTICLE: ArticleData = { article_text: 'testo', norma_data: { ...NORMA, numero_articolo: '2043' } };
const loose = (revealSignal?: number): LooseArticle => ({ type: 'loose-article', id: 'l1', article: ARTICLE, sourceNorma: NORMA, revealSignal });
const card = (revealSignal?: number) => (
  <LooseArticleCard tabId="t" looseArticle={loose(revealSignal)} onViewPdf={() => {}} onCrossReference={() => {}} />
);

describe('LooseArticleCard — «show this article»', () => {
  it('opens a collapsed card when the store signals it, and only then', () => {
    const { rerender } = render(card());
    expect(screen.getByTestId('article')).toBeInTheDocument();
    // The reader collapses it: the header's chevron.
    fireEvent.click(document.querySelector('svg.lucide-chevron-down')!);
    expect(screen.queryByTestId('article')).not.toBeInTheDocument();

    rerender(card()); // an unrelated render keeps it closed
    expect(screen.queryByTestId('article')).not.toBeInTheDocument();

    rerender(card(1));
    expect(screen.getByTestId('article')).toBeInTheDocument();
  });
});
