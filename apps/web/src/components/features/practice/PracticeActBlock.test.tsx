import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import type { ArticleData, Norma } from '../../../types';

const h = vi.hoisted(() => ({
  desktop: true,
  trees: [] as Array<Record<string, unknown>>,
  navs: [] as Array<Record<string, unknown>>,
  studies: [] as Array<Record<string, unknown>>,
  legalFetch: vi.fn(),
  annexes: [{ number: null, label: 'Dispositivo', article_numbers: ['1', '5', '7', '9'] }] as Array<Record<string, unknown>>,
  onViewPdf: vi.fn(),
}));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => h.desktop }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: h.legalFetch }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve({ articles: [], metadata: { annexes: h.annexes } }),
  fetchActRubriche: () => Promise.resolve({ rubriche: {}, abrogati: [], parts: [] }),
}));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({
  TreeViewPanel: (props: Record<string, unknown>) => {
    h.trees.push(props);
    return null;
  },
}));
vi.mock('../workspace/ArticleNavigation', () => ({
  ArticleNavigation: (props: Record<string, unknown>) => {
    h.navs.push(props);
    return null;
  },
}));
vi.mock('../workspace/LazyStudyMode', () => ({
  LazyStudyMode: (props: Record<string, unknown>) => {
    h.studies.push(props);
    return null;
  },
}));

import { appStore, useAppStore } from '../../../store/useAppStore';
import { PracticeActBlock } from './PracticeActBlock';
import { articleRowKey, practiceArticleKey } from '../../../utils/practice';
import { CC_RD, L24, article } from '../../../utils/__fixtures__/savedWorkspaces';

const s = () => appStore.getState();
const L24_URN: Norma = { ...L24, urn: 'urn:nir:stato:legge:2017-03-08;24' };
const PAST = { data_versione: '2007-12-29' };
const answer = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const lastTree = () => h.trees.at(-1) as { variant: string; isOpen: boolean; onArticleSelect: (n: string, a: string | null) => void };
const lastNav = () => h.navs.at(-1) as { onNavigate: (id: string) => void; onLoadArticle: (id: string) => void };

function setUp(norma: Norma, articles: ArticleData[]) {
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [],
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
  return s().addArticlesToPractice(null, norma, articles);
}

function Block({ practiceId, actId }: { practiceId: string; actId: string }) {
  const held = useAppStore((st) => st.practices.find((p) => p.id === practiceId)?.acts.find((a) => a.id === actId));
  if (!held) return null;
  return (
    <DndContext>
      <SortableContext items={[actId]}>
        <PracticeActBlock practiceId={practiceId} act={held} onViewPdf={h.onViewPdf} onCrossReference={vi.fn()} />
      </SortableContext>
    </DndContext>
  );
}

const indexLine = () => screen.getByRole('list', { name: /Articoli sul tavolo/ });

beforeEach(() => {
  h.desktop = true;
  h.trees.length = 0;
  h.navs.length = 0;
  h.studies.length = 0;
  h.legalFetch.mockReset();
});

describe('PracticeActBlock: the heading (spec §3.2)', () => {
  it('names the act and its count, with Studio, Struttura and PDF', () => {
    const { practiceId, actId } = setUp(CC_RD, [article(CC_RD, '2043', { allegato: '2' })]);
    render(<Block practiceId={practiceId} actId={actId} />);
    expect(screen.getByRole('heading', { name: /Codice civile/ })).toBeInTheDocument();
    expect(screen.getByText('1 articolo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modalità studio' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Struttura della norma' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Esporta PDF della norma' }));
    expect(h.onViewPdf).toHaveBeenCalledWith(CC_RD.urn);
  });

  it('the heading is sticky and tells its height to the rows, so a reading toolbar pins under it', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5')]);
    const { container } = render(<Block practiceId={practiceId} actId={actId} />);
    expect(container.querySelector('header')).toHaveClass('sticky', 'top-0');
    expect(container.querySelector('section')?.style.getPropertyValue('--practice-head')).toBe('0px');
  });

  it('the chevron folds the block: no index, no rows', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    const toggle = screen.getByRole('button', { expanded: true, name: /l\. 8 marzo 2017, n\. 24/ });
    fireEvent.click(toggle);
    expect(s().practices[0].acts[0].isCollapsed).toBe(true);
    expect(screen.queryByRole('list', { name: /Articoli sul tavolo/ })).toBeNull();
    expect(screen.queryByText('art. 5')).toBeNull();
  });
});

describe('PracticeActBlock: the index on top (D3)', () => {
  it('a chip says which row is open to a screen reader', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5'), article(L24, '7')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    act(() => s().setRowOpen(articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '7'))), true));
    const chips = within(indexLine()).getAllByRole('button');
    expect(chips.map((c) => c.getAttribute('aria-current'))).toEqual([null, 'true']);
  });

  it('lists every row once, with the annex and the past text marked', () => {
    const { practiceId, actId } = setUp(L24, [
      article(L24, '1'), article(L24, '1', { allegato: 'A' }), article(L24, '5'), article(L24, '5', PAST),
    ]);
    render(<Block practiceId={practiceId} actId={actId} />);
    const chips = within(indexLine()).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['1', '5', '5 · testo al 29/12/2007', 'All. A 1']);
  });

  it("a code's rows carry no annex", () => {
    const { practiceId, actId } = setUp(CC_RD, [article(CC_RD, '2043', { allegato: '2' }), article(CC_RD, '1218', { allegato: '2' })]);
    render(<Block practiceId={practiceId} actId={actId} />);
    expect(within(indexLine()).getAllByRole('button').map((b) => b.textContent)).toEqual(['1218', '2043']);
  });

  it('a chip opens its row and asks for it to be revealed, the past text by its own key', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5'), article(L24, '5', PAST)]);
    render(<Block practiceId={practiceId} actId={actId} />);
    fireEvent.click(within(indexLine()).getByRole('button', { name: /5 · testo al 29\/12\/2007/ }));
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5', PAST)));
    expect(s().practiceRows).toEqual({ [rowKey]: true });
    expect(s().pendingReveal).toEqual({ practiceId, rowKey });
  });
});

describe('PracticeActBlock: rows and Studio', () => {
  it('draws one row per article, closed', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5'), article(L24, '7')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    expect(screen.getByText('art. 5')).toBeInTheDocument();
    expect(screen.getByText('art. 7')).toBeInTheDocument();
    expect(screen.queryByTestId('reader')).toBeNull();
  });

  it('Studio is disabled when the last row opened is a past text, and opens Study Mode on the act otherwise', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5'), article(L24, '5', PAST)]);
    const past = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5', PAST)));
    const now = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5')));
    render(<Block practiceId={practiceId} actId={actId} />);
    act(() => s().setRowOpen(past, true));
    expect(screen.getByRole('button', { name: 'Modalità studio' })).toBeDisabled();
    act(() => s().setRowOpen(now, true));
    const studio = screen.getByRole('button', { name: 'Modalità studio' });
    expect(studio).toBeEnabled();
    fireEvent.click(studio);
    const study = h.studies.at(-1) as { isOpen: boolean; article: ArticleData; articles: ArticleData[] };
    expect(study.isOpen).toBe(true);
    expect(study.article).toEqual(article(L24, '5'));
    // Never a past text: Study Mode writes notes keyed by the article, not the version (gotcha 32).
    expect(study.articles).toEqual([article(L24, '5')]);
  });

  it('Study Mode steps over the texts in force only: a past text neither blocks the arrow nor is reached', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5'), article(L24, '5', PAST), article(L24, '7'), article(L24, '9', PAST)]);
    const now = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5')));
    render(<Block practiceId={practiceId} actId={actId} />);
    act(() => s().setRowOpen(now, true));
    fireEvent.click(screen.getByRole('button', { name: 'Modalità studio' }));
    const study = () => h.studies.at(-1) as { article: ArticleData; articles: ArticleData[]; onNavigate: (id: string) => void };
    expect(study().articles.map((a) => a.norma_data.numero_articolo)).toEqual(['5', '7']);
    act(() => study().onNavigate('7'));
    expect(study().article).toEqual(article(L24, '7'));
    act(() => study().onNavigate('9'));
    expect(study().article).toEqual(article(L24, '7'));
    act(() => study().onNavigate('5'));
    expect(study().article).toEqual(article(L24, '5'));
  });

  it('Study Mode is not mounted for an act with no article', () => {
    const { practiceId } = setUp(L24, [article(L24, '5')]);
    const actId = s().addActIndexToPractice(practiceId, L241());
    render(<Block practiceId={practiceId} actId={actId} />);
    expect(h.studies).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Modalità studio' })).toBeDisabled();
  });
});

function L241(): Norma {
  return { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', urn: 'urn:nir:stato:legge:1990-08-07;241' };
}

describe('PracticeActBlock: «⋯»', () => {
  it("«Rimuovi l'atto» asks first; cancelling keeps it, confirming takes it off", () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    fireEvent.click(screen.getByRole('button', { name: /Azioni su l\. 8 marzo 2017, n\. 24/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Rimuovi l'atto" }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/non saranno toccati/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(s().practices[0].acts).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Rimuovi l'atto" }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rimuovi' }));
    expect(s().practices[0].acts).toHaveLength(0);
  });

  it("«Sposta in un'altra pratica» lists the other practices and moves the act", () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5')]);
    const other = s().createPractice('Responsabilità medica', { activate: false });
    s().createPractice('Appalti', { activate: false });
    render(<Block practiceId={practiceId} actId={actId} />);
    fireEvent.click(screen.getByRole('button', { name: /Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Sposta in un'altra pratica" }));
    const dialog = screen.getByRole('dialog', { name: "Sposta in un'altra pratica" });
    const choices = within(dialog).getAllByRole('button').map((b) => b.textContent).filter((t) => t !== '');
    expect(choices).toEqual(expect.arrayContaining(['Responsabilità medica', 'Appalti', 'Nuova pratica']));
    expect(choices).not.toContain(s().practices[0].label);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Responsabilità medica' }));
    expect(s().practices.find((p) => p.id === practiceId)?.acts).toHaveLength(0);
    expect(s().practices.find((p) => p.id === other)?.acts.map((a) => a.id)).toEqual([actId]);
    expect(s().activePracticeId).toBe(practiceId);
  });

  it('«Nuova pratica» moves the act into a new practice named after it, and stays on this table', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    fireEvent.click(screen.getByRole('button', { name: /Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Sposta in un'altra pratica" }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Nuova pratica' }));
    expect(s().practices).toHaveLength(2);
    expect(s().practices[1].label).toBe('l. 24/2017');
    expect(s().practices[1].acts.map((a) => a.id)).toEqual([actId]);
    expect(s().activePracticeId).toBe(practiceId);
  });

  it('«Nuova pratica» is one store write', () => {
    const { practiceId, actId } = setUp(L24, [article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    fireEvent.click(screen.getByRole('button', { name: /Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Sposta in un'altra pratica" }));
    const writes = vi.fn();
    const stop = appStore.subscribe(writes);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Nuova pratica' }));
    stop();
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('the annex suggestion reveals an article the act already holds and fetches nothing', async () => {
    h.annexes = [
      { number: null, label: 'Dispositivo', article_count: 1, article_numbers: ['5'] },
      { number: '2', label: 'Allegato 2', article_count: 3, article_numbers: ['5'] },
    ];
    const { practiceId, actId } = setUp(L24_URN, [article(L24, '5'), article(L24, '5', { allegato: '2' })]);
    render(<Block practiceId={practiceId} actId={actId} />);
    act(() => s().setRowOpen(articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5'))), true));
    fireEvent.click(await screen.findByRole('button', { name: /Vai/ }));
    await waitFor(() => expect(s().pendingReveal).not.toBeNull());
    expect(h.legalFetch).not.toHaveBeenCalled();
    h.annexes = [{ number: null, label: 'Dispositivo', article_numbers: ['1', '5', '7', '9'] }];
  });
});

describe('PracticeActBlock: the structure window and the arrows (§6.4)', () => {
  it('on a desktop Struttura owns the window', async () => {
    const { practiceId, actId } = setUp(L24_URN, [article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Struttura della norma' }));
    expect(s().structureWindow.blockId).toBe(actId);
    await waitFor(() => expect(lastTree()).toEqual(expect.objectContaining({ variant: 'window', isOpen: true })));
    expect(h.trees.every((t) => t.variant === 'window')).toBe(true);
  });

  it('on a phone width Struttura opens the drawer, not the window', async () => {
    h.desktop = false;
    const { practiceId, actId } = setUp(L24_URN, [article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Struttura della norma' }));
    await waitFor(() => expect(lastTree()).toEqual(expect.objectContaining({ variant: 'drawer', isOpen: true })));
    expect(h.trees.every((t) => t.variant === 'drawer')).toBe(true);
    expect(s().structureWindow.blockId).toBeNull();
  });

  it('a pick from the index of an article not on the table loads it into this act and reveals it', async () => {
    h.legalFetch.mockResolvedValue(answer([article(L24, '9')]));
    const { practiceId, actId } = setUp(L24_URN, [article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    await act(async () => { lastTree().onArticleSelect('9', null); });
    await waitFor(() => expect(s().practices[0].acts[0].articles.map((a) => a.norma_data.numero_articolo)).toEqual(['5', '9']));
    expect(h.legalFetch).toHaveBeenCalledTimes(1);
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '9')));
    expect(s().practiceRows[rowKey]).toBe(true);
    expect(s().practices).toHaveLength(1);
  });

  it('a pick of an article already on the table reveals its row and fetches nothing', async () => {
    const { practiceId, actId } = setUp(L24_URN, [article(L24, '1-bis'), article(L24, '5')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    await act(async () => { lastTree().onArticleSelect('1 bis', null); });
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '1-bis')));
    expect(s().pendingReveal).toEqual({ practiceId, rowKey });
    expect(h.legalFetch).not.toHaveBeenCalled();
  });

  it('the arrows reveal a row already there before loading anything', async () => {
    const { practiceId, actId } = setUp(L24_URN, [article(L24, '5'), article(L24, '7')]);
    render(<Block practiceId={practiceId} actId={actId} />);
    await waitFor(() => expect(h.navs.length).toBeGreaterThan(0));
    await act(async () => { lastNav().onLoadArticle('7'); });
    const rowKey = articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '7')));
    expect(s().pendingReveal).toEqual({ practiceId, rowKey });
    expect(h.legalFetch).not.toHaveBeenCalled();
    act(() => { lastNav().onNavigate('5'); });
    expect(s().pendingReveal?.rowKey).toBe(articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5'))));
  });
});
