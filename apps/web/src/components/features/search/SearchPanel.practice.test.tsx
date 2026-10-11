import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const env = vi.hoisted(() => ({
  desktop: true,
  lines: [] as unknown[],
}));

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => env.desktop }));
vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => <div data-testid="old-workspace" /> }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => <div data-testid="old-dock" /> }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./NormaCard', () => ({ NormaCard: () => null }));
vi.mock('./ArticleTabContent', () => ({
  ArticleTabContent: ({ data }: { data: { norma_data: { numero_articolo: string } } }) =>
    <div data-testid="reader">art. {data.norma_data.numero_articolo}</div>,
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
      <button type="button" onClick={() => store.getState().openDecisionTab({ corte: 'cassazione', archivio: 'civile', numero: 12345, anno: 2020 }, { besideTabId: tabId })}>
        Cass. civ., n. 12345/2020
      </button>
    ),
  };
});
vi.mock('../../../services/historyService', () => ({ addToHistory: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../services/legalFetch', () => ({
  legalFetch: async () => new Response(env.lines.map((l) => JSON.stringify(l)).join('\n') + '\n'),
}));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';
import { actKeyOf } from '../dossier/dossierLayout';

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
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, workspaceTabs: [], searchTrigger: null, searchQueue: [], pendingDecision: null,
    readingBackStack: [], commandPaletteOpen: false, structureWindow: { blockId: null, position: { x: 0, y: 0 } },
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

  it('a decision from the palette, a massima or the address enters «Giurisprudenza» once and opens in place', async () => {
    const p = s().createPractice('Responsabilità');
    panel();
    act(() => { s().openDecisionTab(REF); });                         // the palette
    act(() => { s().openDecisionTab(REF, { besideTabId: p }); });     // a massima in a row of the table
    act(() => { s().requestOpenDecision(REF); });                     // the address
    await waitFor(() => expect(s().pendingDecision).toBeNull());
    expect(await screen.findAllByTestId('decision-reader')).toHaveLength(1);
    expect(s().practices[0].decisions).toHaveLength(1);
    expect(screen.getByText(/Giurisprudenza \(1\)/)).toBeInTheDocument();
  });

  it('a topic search from the palette shows in the band; a decision opened from it enters «Giurisprudenza»', async () => {
    s().createPractice('Responsabilità');
    panel();
    act(() => { s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno'); });
    const band = await screen.findByRole('region', { name: 'Ricerca per tema: danno' });
    fireEvent.click(within(band).getByRole('button', { name: 'Cass. civ., n. 12345/2020' }));
    expect(await screen.findByTestId('decision-reader')).toHaveTextContent('n. 12345');
    expect(s().practices[0].decisions.map((d) => d.reference.numero)).toEqual([12345]);
    expect(s().practices[0].beside).toHaveLength(1); // the search is not a source: it stays a search
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
