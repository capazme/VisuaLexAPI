import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const env = vi.hoisted(() => ({
  desktop: true,
  lines: [] as unknown[],
  /** The stream's lines for a request, or 'fail' for a refused one; else `lines`. */
  stream: null as null | ((params: Record<string, unknown>) => unknown[] | 'fail'),
  /** Every request's params, in order. */
  requests: [] as Array<Record<string, unknown>>,
  /** `/fetch_tree`'s answer (the annex auto-switch reads it); null answers 500. */
  tree: null as unknown,
  /** The article a reader's citation link names. */
  jumpTo: '',
  annex: { MAX_MAIN_ARTICLES: 50, MIN_ANNEX_ARTICLES: 10, TOAST_DURATION: 3000, ENABLED: false, AUTO_CONFIRM: true },
}));

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => env.desktop, isDesktopViewport: () => env.desktop }));
vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => <div data-testid="old-workspace" /> }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => <div data-testid="old-dock" /> }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./NormaCard', () => ({ NormaCard: () => null }));
vi.mock('../../../config/annexConfig', () => ({ ANNEX_AUTO_SWITCH_CONFIG: env.annex }));
vi.mock('./ArticleTabContent', () => ({
  ArticleTabContent: ({ data, onCrossReferenceNavigate }: {
    data: { norma_data: { numero_articolo: string; allegato?: string; data_versione?: string } };
    onCrossReferenceNavigate?: (article: string, normaData: unknown) => void;
  }) => {
    const n = data.norma_data;
    const name = `art. ${n.allegato ? `All. ${n.allegato} ` : ''}${n.numero_articolo}${n.data_versione ? ` al ${n.data_versione}` : ''}`;
    return (
      <>
        <div data-testid="reader">{name}</div>
        <button type="button" onClick={() => onCrossReferenceNavigate?.(env.jumpTo, n)}>Citazione in {name}</button>
      </>
    );
  },
}));
vi.mock('./TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: ({ reference }: { reference: { numero: number } }) => <div data-testid="decision-reader">n. {reference.numero}</div>,
}));
// A topic search's list: one decision, opened as `DecisionLink` opens it (beside the list's window).
vi.mock('../decisions/DecisionSearchTabView', async () => {
  const { appStore: store } = await import('../../../store/useAppStore');
  return {
    DecisionSearchTabView: ({ tabId }: { tabId: string }) => (
      <button type="button" data-testid="topic-list" onClick={() => store.getState().openDecisionTab({ corte: 'cassazione', archivio: 'civile', numero: 12345, anno: 2020 }, { besideTabId: tabId })}>
        Cass. civ., n. 12345/2020
      </button>
    ),
  };
});
vi.mock('../../../services/historyService', () => ({ addToHistory: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../services/legalFetch', () => ({
  legalFetch: async (path: string, init?: RequestInit) => {
    if (path === '/fetch_tree') return env.tree ? new Response(JSON.stringify(env.tree)) : new Response('', { status: 500 });
    const params = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    env.requests.push(params);
    const lines = env.stream ? env.stream(params) : env.lines;
    if (lines === 'fail') return new Response('', { status: 500 });
    return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  },
}));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';
import { actKeyOf } from '../dossier/dossierLayout';
import { searchesIntoOnePractice } from '../dossier/openInPractice';
import { computeNormaGroups } from '../dossier/dossierUtils';
import { WORKSPACE_AREA_ID } from '../../../utils/workspaceOrigin';
import { besideRefFor, practiceArticleKey } from '../../../utils/practice';
import type { Dossier } from '../../../types';

const s = () => appStore.getState();
const CC = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', url: 'urn:nir:stato:regio.decreto:1942-03-16;262' };
const ccArticle = (n: string) => ({ article_text: `Art. ${n}\nTesto ${n}.`, norma_data: { ...CC, numero_articolo: n }, brocardi_info: null });
const params = (article: string) => ({ act_type: 'codice civile', act_number: '', date: '', article, version: 'vigente' as const, show_brocardi_info: false });
const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };

const panel = () => render(<MemoryRouter><SearchPanel /></MemoryRouter>);
const readers = () => screen.queryAllByTestId('reader').map((el) => el.textContent);

beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  env.desktop = true;
  env.lines = [];
  env.stream = null;
  env.requests = [];
  env.tree = null;
  env.jumpTo = '';
  env.annex.ENABLED = false;
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, workspaceTabs: [], searchTrigger: null, searchQueue: [], pendingDecision: null,
    readingBackStack: [], commandPaletteOpen: false, structureWindow: { blockId: null, position: { x: 0, y: 0 } },
    mobileActiveTabId: null,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ['the desktop', true],
  ['a phone (390 px)', false],
])('SearchPanel with the practices, on %s', (_name, desktop) => {
  beforeEach(() => { env.desktop = desktop; });

  it('a one-article search lands in the active practice and opens its row', async () => {
    const p = s().createPractice('Responsabilità');
    env.lines = [ccArticle('2043')];
    panel();
    act(() => { s().triggerSearch(params('2043')); });
    await waitFor(() => expect(readers()).toEqual(['art. 2043']));
    expect(s().practices.map((x) => x.id)).toEqual([p]);
    expect(s().practices[0].acts[0].articles).toHaveLength(1);
    expect(screen.queryByTestId('old-workspace')).toBeNull();
    expect(screen.queryByTestId('old-dock')).toBeNull();
    expect(s().workspaceTabs).toEqual([]);
  });

  it(`a decision from the palette, a massima or the address enters «Giurisprudenza» once and opens ${desktop ? 'beside, once' : 'full screen, once'}`, async () => {
    const p = s().createPractice('Responsabilità');
    panel();
    act(() => { s().openDecisionTab(REF); });                         // the palette
    act(() => { s().openDecisionTab(REF, { besideTabId: p }); });     // a massima in a row of the table
    act(() => { s().requestOpenDecision(REF); });                     // the address
    await waitFor(() => expect(s().pendingDecision).toBeNull());
    expect(await screen.findAllByTestId('decision-reader')).toHaveLength(1);
    expect(s().practices[0].decisions).toHaveLength(1);
    // On the desktop a window shows it and its row folds; on a phone the full-screen reader does, in
    // the column's place, and «‹ Pratica» gives the column back (T19).
    expect(s().practices[0].beside).toHaveLength(desktop ? 1 : 0);
    expect(screen.queryAllByTestId('reading-window')).toHaveLength(desktop ? 1 : 0);
    expect(screen.queryAllByTestId('reading-full-screen')).toHaveLength(desktop ? 0 : 1);
    if (desktop) {
      expect(screen.getByText(/Giurisprudenza \(1\)/)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/Giurisprudenza \(1\)/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Pratica' }));
      expect(screen.getByText(/Giurisprudenza \(1\)/)).toBeInTheDocument();
      expect(screen.queryByTestId('decision-reader')).toBeNull();
    }
  });

  it(desktop
    ? 'a topic search from the palette opens a window; a decision opened from it enters «Giurisprudenza» beside it'
    : 'a topic search from the palette opens full screen; a decision opened from its list replaces it there and enters «Giurisprudenza»', async () => {
    s().createPractice('Responsabilità');
    panel();
    act(() => { s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno'); });
    const place = await screen.findByRole('region', { name: desktop ? 'Tema: danno' : 'Ricerca per tema' });
    fireEvent.click(within(place).getByRole('button', { name: 'Cass. civ., n. 12345/2020' }));
    expect(await screen.findByTestId('decision-reader')).toHaveTextContent('n. 12345');
    expect(s().practices[0].decisions.map((d) => d.reference.numero)).toEqual([12345]);
    // The search is not a source: it stays a search. On the desktop the decision is a window beside
    // it (the search asked, so it is not the one replaced); on a phone it replaces the search in the
    // reader, and the desktop's windows are never touched (T19).
    expect(s().practices[0].beside.map((b) => b.kind)).toEqual(desktop ? ['decision-search', 'decision'] : []);
    if (!desktop) {
      expect(s().phoneReader?.ref.kind).toBe('decision');
      expect(screen.queryByTestId('topic-list')).toBeNull();
    }
  });
});

describe('SearchPanel with the practices: where a search lands (spec §5.1)', () => {
  it('a search with no practice creates one named after the act (`shortAct`)', async () => {
    env.lines = [ccArticle('2043')];
    panel();
    act(() => { s().triggerSearch(params('2043')); });
    await waitFor(() => expect(s().practices).toHaveLength(1));
    expect(s().practices[0].label).toBe('c.c.');
    expect(s().activePracticeId).toBe(s().practices[0].id);
  });

  it('a range opens the first row of a new act and leaves the others closed', async () => {
    s().createPractice('P');
    env.lines = [ccArticle('1'), ccArticle('2'), ccArticle('3')];
    panel();
    act(() => { s().triggerSearch(params('1-3')); });
    await waitFor(() => expect(s().practices[0].acts[0]?.articles).toHaveLength(3));
    await waitFor(() => expect(readers()).toEqual(['art. 1']));
  });

  it('a dossier\'s search (targetTabId) lands in that practice and opens no row', async () => {
    const target = s().createPractice('Dossier', { custom: true });
    s().createPractice('Altra');
    env.lines = [ccArticle('2043')];
    panel();
    act(() => { s().triggerSearch({ ...params('2043'), targetTabId: target, tabLabel: 'Dossier' }); });
    await waitFor(() => expect(s().practices.find((p) => p.id === target)?.acts).toHaveLength(1));
    expect(s().practiceRows).toEqual({});
  });

  it('«Apri l\'indice e sfoglia» drops the act on the active practice (no tab)', async () => {
    const p = s().createPractice('P');
    act(() => { s().addNormaIndexToTab(p, { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' }); });
    expect(s().practices[0].acts.map((a) => a.key)).toEqual([actKeyOf({ tipo_atto: 'codice civile' })]);
    expect(s().workspaceTabs).toEqual([]);
  });

  it('a citation jump from a row, then the back control, reveals the row left', async () => {
    env.lines = [ccArticle('2043')];
    panel();
    act(() => { s().triggerSearch(params('2043')); });
    await waitFor(() => expect(readers()).toEqual(['art. 2043']));
    const { id: practiceId, acts } = s().practices[0];
    act(() => {
      s().pushReadingBack({ tabId: practiceId, blockId: acts[0].id, articleId: '2043', label: 'art. 2043 c.c.' });
      s().setRowOpen(Object.keys(s().practiceRows)[0], false);
    });
    expect(readers()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 2043 c.c.' }));
    await waitFor(() => expect(readers()).toEqual(['art. 2043']));
  });
});

// A decree asked for as the palette asks (the year only), answered with its full date.
const DLGS = { tipo_atto: 'decreto legislativo', data: '2008-04-09', numero_atto: '81', url: 'urn:nir:stato:decreto.legislativo:2008-04-09;81' };
const dlgsArticle = (n: string, allegato?: string) => ({
  article_text: `Art. ${n}\nTesto ${n}.`, norma_data: { ...DLGS, numero_articolo: n, ...(allegato ? { allegato } : {}) }, brocardi_info: null,
});
const dlgsParams = (article: string) => ({ act_type: 'decreto legislativo', act_number: '81', date: '2008', article, version: 'vigente' as const, show_brocardi_info: false });
const rowNames = () => s().practices[0].acts.flatMap((a) => a.articles.map((x) =>
  `${x.norma_data.allegato ? `All. ${x.norma_data.allegato} ` : ''}${x.norma_data.numero_articolo}${x.norma_data.data_versione ? ` al ${x.norma_data.data_versione}` : ''}`));

describe('SearchPanel with the practices: the annex auto-switch (spec §5.2)', () => {
  beforeEach(() => {
    env.annex.ENABLED = true;
    // the body holds three articles; Allegato 2 holds the one asked for
    env.tree = { metadata: { annexes: [
      { number: null, label: 'Testo', article_count: 3, article_numbers: ['1', '2', '3'] },
      { number: '2', label: 'Allegato 2', article_count: 20, article_numbers: ['5', '6'] },
    ] } };
  });

  it('removes the stray row the first search created, once the annex\'s article has landed; a row it did not create stays', async () => {
    const p = s().createPractice('P');
    s().addArticlesToPractice(p, DLGS, [dlgsArticle('1')]);
    env.stream = (params) => (params.annex === '2' ? [dlgsArticle('5', '2')] : [dlgsArticle('5')]);
    panel();
    act(() => { s().triggerSearch(dlgsParams('5')); });
    await waitFor(() => expect(env.requests.some((r) => r.annex === '2')).toBe(true));
    await waitFor(() => expect(rowNames()).toEqual(['1', 'All. 2 5']));
    expect(s().practices).toHaveLength(1);
  });

  it('a failed annex search leaves the act as it was before, not empty', async () => {
    s().createPractice('P');
    env.stream = (params) => (params.annex === '2' ? 'fail' : [dlgsArticle('5')]);
    panel();
    act(() => { s().triggerSearch(dlgsParams('5')); });
    await waitFor(() => expect(env.requests.some((r) => r.annex === '2')).toBe(true));
    expect(await screen.findByText('Errore nella richiesta')).toBeInTheDocument();
    expect(rowNames()).toEqual(['5']);
  });
});

describe('SearchPanel with the practices: a citation jump (spec §3.2, T2)', () => {
  const pastArticle = (n: string) => ({ ...ccArticle(n), norma_data: { ...CC, numero_articolo: n, versione: 'vigente', data_versione: '2007-12-29' } });

  it('to an article of the act already on the table: its row is revealed in place, nothing is searched', async () => {
    const p = s().createPractice('P');
    const { actId } = s().addArticlesToPractice(p, CC, [ccArticle('2043'), ccArticle('1218')], { reveal: 'first' });
    expect(actId).toBeTruthy();
    env.jumpTo = '1218';
    panel();
    await waitFor(() => expect(readers()).toEqual(['art. 2043']));
    fireEvent.click(screen.getByRole('button', { name: 'Citazione in art. 2043' }));
    // the column draws rows in article order
    await waitFor(() => expect(readers()).toEqual(['art. 1218', 'art. 2043']));
    expect(env.requests).toEqual([]);
  });

  it('from a text in force to an article the act holds only as a past text: the text in force is loaded as a new row', async () => {
    const p = s().createPractice('P');
    s().addArticlesToPractice(p, CC, [ccArticle('2043'), pastArticle('1218')], { reveal: 'first' });
    env.jumpTo = '1218';
    env.lines = [ccArticle('1218')];
    panel();
    await waitFor(() => expect(readers()).toEqual(['art. 2043']));
    fireEvent.click(screen.getByRole('button', { name: 'Citazione in art. 2043' }));
    // the column draws rows in article order
    await waitFor(() => expect(readers()).toEqual(['art. 1218', 'art. 2043']));
    expect(env.requests).toEqual([expect.objectContaining({ article: '1218', version: 'vigente' })]);
    expect(rowNames().sort()).toEqual(['1218', '1218 al 2007-12-29', '2043']);
  });
});

describe('SearchPanel with the practices: «Apri tutto» streamed through (spec §5.1, D15)', () => {
  it('the texts in force and a past text of one act land as rows of that act in the dossier\'s practice, none opened', async () => {
    const dossier: Dossier = {
      id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [],
      items: [
        { id: 'a', type: 'norma', addedAt: '', data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' } },
        { id: 'b', type: 'norma', addedAt: '', data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', versione: 'vigente', data_versione: '2007-12-29' } },
      ],
    };
    s().createPractice('Altra');
    env.stream = (params) => (params.version_date
      ? [{ ...ccArticle(String(params.article)), norma_data: { ...CC, numero_articolo: String(params.article), versione: 'vigente', data_versione: params.version_date } }]
      : [ccArticle(String(params.article))]);
    panel();
    act(() => { s().triggerMultiSearch(searchesIntoOnePractice(dossier, computeNormaGroups(dossier.items), true)); });
    const practiceId = s().activePracticeId as string;
    await waitFor(() => expect(env.requests).toHaveLength(2));
    await waitFor(() => expect(s().practices.find((p) => p.id === practiceId)?.acts[0]?.articles).toHaveLength(2));
    const held = s().practices.find((p) => p.id === practiceId)!;
    expect(held.acts).toHaveLength(1);
    expect(held.acts[0].articles.map((a) => `${a.norma_data.numero_articolo}|${a.norma_data.data_versione ?? ''}`).sort())
      .toEqual(['1284|2007-12-29', '2043|']);
    expect(s().practiceRows).toEqual({});
    expect(s().practices.find((p) => p.label === 'Altra')?.acts).toEqual([]);
  });
});

describe('SearchPanel with the practices: the rest of the review (round 1)', () => {
  it('a closed target is warned once per search, not once per article', async () => {
    const gone = s().createPractice('Chiusa');
    s().createPractice('Attiva');
    s().closePractice(gone);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    env.lines = [ccArticle('1'), ccArticle('2'), ccArticle('3')];
    panel();
    act(() => { s().triggerSearch({ ...params('1-3'), targetTabId: gone }); });
    await waitFor(() => expect(s().practices[0].acts[0]?.articles).toHaveLength(3));
    expect(warn.mock.calls.filter(([message]) => String(message).includes('is not open'))).toHaveLength(1);
  });

  it('a topic search opens the phone\'s full-screen reader, beside nothing; «Pratica» gives the column back', async () => {
    env.desktop = false;
    const p = s().createPractice('P');
    s().addArticlesToPractice(p, CC, [ccArticle('2043')]);
    panel();
    await screen.findByTestId('practice-column');
    act(() => { s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno'); });
    const reader = await screen.findByTestId('reading-full-screen');
    expect(within(reader).getByTestId('topic-list')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-column')).toBeNull();
    expect(s().practices[0].beside).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Pratica' }));
    expect(await screen.findByTestId('practice-column')).toBeInTheDocument();
    expect(s().phoneReader).toBeNull();
  });

  it('a decision opened from practice B\'s topic window enters B, while A holds the same topic', async () => {
    const a = s().createPractice('A');
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    const b = s().createPractice('B');
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    panel();
    const window_ = await screen.findByRole('region', { name: 'Tema: danno' });
    fireEvent.click(within(window_).getByRole('button', { name: 'Cass. civ., n. 12345/2020' }));
    expect(s().practices.find((p) => p.id === b)?.decisions).toHaveLength(1);
    expect(s().practices.find((p) => p.id === a)?.decisions).toEqual([]);
    expect(s().activePracticeId).toBe(b);
  });

  it('the column\'s bottom padding follows the bar\'s measured height (§3.4)', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.id === 'tour-workspace-dock' ? 138 : 0;
    });
    const p = s().createPractice('P');
    s().addArticlesToPractice(p, CC, [ccArticle('2043')]);
    panel();
    const column = await screen.findByTestId('practice-column');
    await waitFor(() => expect(document.getElementById(WORKSPACE_AREA_ID)?.style.getPropertyValue('--practice-bar-height')).toBe('138px'));
    expect(document.getElementById(WORKSPACE_AREA_ID)?.contains(column)).toBe(true);
    expect(column.className).toContain('var(--practice-bar-height');
  });

  it('the migration\'s notice survives a change of breakpoint until it is closed', async () => {
    s().createPractice('P');
    appStore.setState({ practiceNotice: 'Una ricerca per tema non è stata riaperta: «Tema: danno». Puoi rifarla dalla barra di ricerca.' });
    const { rerender } = panel();
    expect(await screen.findByText(/Una ricerca per tema non è stata riaperta/)).toBeInTheDocument();
    env.desktop = false;
    rerender(<MemoryRouter><SearchPanel /></MemoryRouter>);
    await screen.findByTestId('practice-phone-view');
    expect(screen.getByText(/Una ricerca per tema non è stata riaperta/)).toBeInTheDocument();
    expect(s().practiceNotice).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi notifica' }));
    await waitFor(() => expect(screen.queryByText(/Una ricerca per tema non è stata riaperta/)).toBeNull());
  });

  it('going back with the practices writes nothing of the old tabs\' state', async () => {
    env.lines = [ccArticle('2043')];
    panel();
    act(() => { s().triggerSearch(params('2043')); });
    await waitFor(() => expect(readers()).toEqual(['art. 2043']));
    const { id: practiceId, acts } = s().practices[0];
    // a seeded practice keeps its tab's id: a stored tab of that id is still there
    appStore.setState({ workspaceTabs: [{
      id: practiceId, label: 'c.c.', position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, zIndex: 1,
      isMinimized: false, isHidden: false, content: [], labelIsCustom: false,
    }] });
    act(() => { s().pushReadingBack({ tabId: practiceId, blockId: acts[0].id, articleId: '2043', label: 'art. 2043 c.c.' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 2043 c.c.' }));
    await waitFor(() => expect(s().readingBackStack).toEqual([]));
    expect(s().mobileActiveTabId).toBeNull();
  });
});

describe('SearchPanel with the practices: the phone\'s full-screen reader (spec §4.5, §6.3, §8)', () => {
  beforeEach(() => { env.desktop = false; });
  const refOf = (actId: string, n: string) => besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(ccArticle(n)) });

  it('a norm cited in the reader\'s text that the act already holds replaces the subject in the reader', async () => {
    const p = s().createPractice('P');
    const { actId } = s().addArticlesToPractice(p, CC, [ccArticle('2043'), ccArticle('1218')]);
    env.jumpTo = '1218';
    panel();
    await screen.findByTestId('practice-phone-view');
    act(() => { s().openPhoneReader(p, refOf(actId, '2043')); });
    const reader = await screen.findByTestId('reading-full-screen');
    fireEvent.click(within(reader).getByRole('button', { name: 'Citazione in art. 2043' }));
    await waitFor(() => expect(readers()).toEqual(['art. 1218']));
    expect(s().phoneReader).toEqual({ practiceId: p, ref: refOf(actId, '1218') });
    expect(s().practices[0].beside).toEqual([]);
    expect(env.requests).toEqual([]);
  });

  it('a norm cited in the reader that the act does not hold is searched, lands in the practice and opens in the reader', async () => {
    const p = s().createPractice('P');
    const { actId } = s().addArticlesToPractice(p, CC, [ccArticle('2043')]);
    env.jumpTo = '1218';
    env.lines = [ccArticle('1218')];
    panel();
    await screen.findByTestId('practice-phone-view');
    act(() => { s().openPhoneReader(p, refOf(actId, '2043')); });
    const reader = await screen.findByTestId('reading-full-screen');
    fireEvent.click(within(reader).getByRole('button', { name: 'Citazione in art. 2043' }));
    await waitFor(() => expect(s().practices[0].acts[0].articles).toHaveLength(2));
    await waitFor(() => expect(readers()).toEqual(['art. 1218']));
    expect(s().phoneReader).toEqual({ practiceId: p, ref: refOf(actId, '1218') });
    expect(s().practices[0].beside).toEqual([]);
  });

  it('a search result that reveals a row shows the table, not the reader', async () => {
    const p = s().createPractice('P');
    const { actId } = s().addArticlesToPractice(p, CC, [ccArticle('2043')]);
    env.lines = [ccArticle('1218')];
    panel();
    await screen.findByTestId('practice-phone-view');
    act(() => { s().openPhoneReader(p, refOf(actId, '2043')); });
    await screen.findByTestId('reading-full-screen');
    act(() => { s().triggerSearch(params('1218')); });
    await waitFor(() => expect(screen.queryByTestId('reading-full-screen')).toBeNull());
    expect(await screen.findByTestId('practice-column')).toBeInTheDocument();
    await waitFor(() => expect(readers()).toEqual(['art. 1218']));
    expect(s().phoneReader).toBeNull();
  });

  it('the dossier\'s «Apri tutto» (a new practice made active) shows that practice\'s table, not the old reader', async () => {
    const p = s().createPractice('Vecchia');
    const { actId } = s().addArticlesToPractice(p, CC, [ccArticle('2043')]);
    const dossier: Dossier = {
      id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [],
      items: [{ id: 'a', type: 'norma', addedAt: '', data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284' } }],
    };
    env.stream = (request) => [ccArticle(String(request.article))];
    panel();
    await screen.findByTestId('practice-phone-view');
    act(() => { s().openPhoneReader(p, refOf(actId, '2043')); });
    await screen.findByTestId('reading-full-screen');
    act(() => { s().triggerMultiSearch(searchesIntoOnePractice(dossier, computeNormaGroups(dossier.items), true)); });
    await waitFor(() => expect(screen.queryByTestId('reading-full-screen')).toBeNull());
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Ricorso Rossi');
    await waitFor(() => expect(s().practices.find((x) => x.label === 'Ricorso Rossi')?.acts[0]?.articles).toHaveLength(1));
    expect(s().phoneReader).toBeNull();
  });

  it('the back control returns to the reader\'s subject, or to a row of the table with the reader closed', async () => {
    const p = s().createPractice('P');
    const { actId } = s().addArticlesToPractice(p, CC, [ccArticle('2043'), ccArticle('1218')]);
    panel();
    await screen.findByTestId('practice-phone-view');
    act(() => { s().openPhoneReader(p, refOf(actId, '2043')); });
    await screen.findByTestId('reading-full-screen');
    // a jump out of the reader's article: the reader moves on, the entry names where it was read
    act(() => {
      s().pushReadingBack({ tabId: refOf(actId, '2043').id, blockId: actId, articleId: '2043', label: 'art. 2043 c.c.' });
      s().openPhoneReader(p, refOf(actId, '1218'));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Torna a art. 2043 c.c.' }));
    await waitFor(() => expect(readers()).toEqual(['art. 2043']));
    expect(s().phoneReader).toEqual({ practiceId: p, ref: refOf(actId, '2043') });

    // a jump out of a row of the table: back to the row, the reader closed
    act(() => {
      s().pushReadingBack({ tabId: p, blockId: actId, articleId: '1218', label: 'art. 1218 c.c.' });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Torna a art. 1218 c.c.' }));
    expect(s().phoneReader).toBeNull();
    expect(await screen.findByTestId('practice-column')).toBeInTheDocument();
    expect(s().practiceRows[`${p}/${actId}/${practiceArticleKey(ccArticle('1218'))}`]).toBe(true);
  });
});
