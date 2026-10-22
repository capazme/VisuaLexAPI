import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleData } from '../../../types';

const { readers } = vi.hoisted(() => ({ readers: [] as Array<Record<string, unknown>> }));
vi.mock('../search/ArticleTabContent', () => ({
  ArticleTabContent: (props: Record<string, unknown>) => {
    readers.push(props);
    return <div data-testid="reader" />;
  },
}));

import { appStore } from '../../../store/useAppStore';
import { PracticeArticleRow } from './PracticeArticleRow';
import { articleRowKey, practiceArticleKey } from '../../../utils/practice';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import { CC_RD, L24, article } from '../../../utils/__fixtures__/savedWorkspaces';

const s = () => appStore.getState();
const CC_2043: ArticleData = article(CC_RD, '2043', { allegato: '2' }, { article_text: fixtureText('nrm-fx-attachment') });
const PAST_5 = article(L24, '5', { data_versione: '2007-12-29' });

function setUp(articles: ArticleData[], norma = CC_RD) {
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [] });
  return s().addArticlesToPractice(null, norma, articles);
}

function row(practiceId: string, actId: string, data: ArticleData, extra: Partial<Parameters<typeof PracticeArticleRow>[0]> = {}) {
  return (
    <PracticeArticleRow
      practiceId={practiceId}
      actId={actId}
      article={data}
      onCrossReference={vi.fn()}
      onOpenStudyMode={vi.fn()}
      {...extra}
    />
  );
}

beforeEach(() => {
  readers.length = 0;
  appStore.setState({ quickNorms: [] });
});

describe('PracticeArticleRow (spec §3.2)', () => {
  it('names the article and its rubrica, read from its own text', () => {
    const { practiceId, actId } = setUp([CC_2043]);
    render(row(practiceId, actId, CC_2043));
    expect(screen.getByText('art. 2043')).toBeInTheDocument();
    expect(screen.getByText('Risarcimento per fatto illecito')).toBeInTheDocument();
    // a code's annex is never shown
    expect(screen.queryByText(/All\./)).toBeNull();
  });

  it('says in its header that the article is among the quick norms, open or folded (R3b)', () => {
    const { practiceId, actId } = setUp([CC_2043]);
    appStore.setState({ quickNorms: [] });
    const { rerender } = render(row(practiceId, actId, CC_2043));
    expect(screen.queryByTitle('Tra le norme rapide')).toBeNull();
    act(() => {
      appStore.setState({
        quickNorms: [{
          id: 'q1', label: 'art. 2043 c.c.', createdAt: '2026-10-01T00:00:00.000Z', usageCount: 0,
          searchParams: { act_type: CC_2043.norma_data.tipo_atto, act_number: CC_2043.norma_data.numero_atto || '', date: CC_2043.norma_data.data || '', article: '2043', version: 'vigente' },
        }],
      });
    });
    rerender(row(practiceId, actId, CC_2043));
    // Said in the toggle's name (its children are not read), seen as a bolt; the remove button's name unchanged.
    expect(screen.getByRole('button', { name: /^Espandi art\. 2043 c\.c\., tra le norme rapide$/ })).toBeInTheDocument();
    expect(screen.getByTitle('Tra le norme rapide')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Togli dal tavolo art\. 2043 c\.c\.$/ })).toBeInTheDocument();
  });

  it('says nothing of a quick norm on a past text: the quick norm opens the text in force', () => {
    const { practiceId, actId } = setUp([PAST_5], L24);
    act(() => {
      appStore.setState({
        quickNorms: [{
          id: 'q2', label: 'art. 5', createdAt: '2026-10-01T00:00:00.000Z', usageCount: 0,
          searchParams: { act_type: PAST_5.norma_data.tipo_atto, act_number: PAST_5.norma_data.numero_atto || '', date: PAST_5.norma_data.data || '', article: '5', version: 'vigente' },
        }],
      });
    });
    render(row(practiceId, actId, PAST_5));
    expect(screen.queryByTitle('Tra le norme rapide')).toBeNull();
  });

  it('closed, it mounts no reader; its header opens it, and only the header toggles', () => {
    const { practiceId, actId } = setUp([CC_2043]);
    render(row(practiceId, actId, CC_2043));
    expect(screen.queryByTestId('reader')).toBeNull();
    const toggle = screen.getByRole('button', { name: /^Espandi art\. 2043 c\.c\./ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // the remove button is not inside the toggle (gotcha 22, the collapsible convention)
    expect(toggle).not.toContainElement(screen.getByRole('button', { name: /Togli dal tavolo/ }));
    fireEvent.click(toggle);
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(CC_2043));
    expect(s().practiceRows[rowKey]).toBe(true);
    expect(screen.getByTestId('reader')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Comprimi art\. 2043 c\.c\./ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens and closes from the keyboard; a key on a child does not toggle', () => {
    const { practiceId, actId } = setUp([CC_2043]);
    render(row(practiceId, actId, CC_2043));
    const toggle = screen.getByRole('button', { name: /^Espandi/ });
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(screen.getByTestId('reader')).toBeInTheDocument();
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(screen.queryByTestId('reader')).toBeNull();
    fireEvent.keyDown(screen.getByText('art. 2043'), { key: 'Enter' });
    expect(screen.queryByTestId('reader')).toBeNull();
  });

  it('open, it mounts the reader with the way back to this row: practice, act and row key (ruling 12)', () => {
    const { practiceId, actId } = setUp([CC_2043]);
    const onCrossReference = vi.fn();
    const onOpenStudyMode = vi.fn();
    s().setRowOpen(articleRowKey(practiceId, actId, practiceArticleKey(CC_2043)), true);
    render(row(practiceId, actId, CC_2043, { onCrossReference, onOpenStudyMode }));
    expect(readers.at(-1)).toEqual(expect.objectContaining({
      data: CC_2043,
      readingOrigin: { tabId: practiceId, blockId: actId, articleKey: practiceArticleKey(CC_2043) },
      onCrossReferenceNavigate: onCrossReference,
      onOpenStudyMode,
    }));
  });

  it('a past text says «Testo al 29/12/2007», in its name too', () => {
    const { practiceId, actId } = setUp([article(L24, '5'), PAST_5], L24);
    render(row(practiceId, actId, PAST_5));
    expect(screen.getByText('Testo al 29/12/2007')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Espandi art\. 5 l\. 24\/2017, testo al 29\/12\/2007$/ })).toBeInTheDocument();
  });

  it('«Togli dal tavolo» takes the row off at once, with no confirmation', () => {
    const { practiceId, actId } = setUp([article(L24, '5'), article(L24, '7')], L24);
    const five = s().practices[0].acts[0].articles[0];
    render(row(practiceId, actId, five));
    fireEvent.click(screen.getByRole('button', { name: 'Togli dal tavolo art. 5 l. 24/2017' }));
    expect(s().practices[0].acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['7']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the annex suggestion shows inside the open row only', () => {
    const { practiceId, actId } = setUp([CC_2043]);
    const { rerender } = render(row(practiceId, actId, CC_2043, { annexSuggestion: <p>Suggerimento</p> }));
    expect(screen.queryByText('Suggerimento')).toBeNull();
    s().setRowOpen(articleRowKey(practiceId, actId, practiceArticleKey(CC_2043)), true);
    rerender(row(practiceId, actId, CC_2043, { annexSuggestion: <p>Suggerimento</p> }));
    expect(screen.getByText('Suggerimento')).toBeInTheDocument();
  });

  it('carries its row key, for the column to scroll to it', () => {
    const { practiceId, actId } = setUp([CC_2043]);
    const { container } = render(row(practiceId, actId, CC_2043));
    const key = articleRowKey(practiceId, actId, practiceArticleKey(CC_2043));
    expect(container.querySelector('[data-practice-row]')?.getAttribute('data-practice-row')).toBe(key);
  });
});
