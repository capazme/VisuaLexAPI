import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true, isDesktopViewport: () => true }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }) }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../../services/assistantService', () => ({ assistantService: { features: vi.fn(async () => ({ assistantPassages: false })) } }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getSnapshots: vi.fn(async () => []), addItem: vi.fn(), getById: vi.fn(() => new Promise(() => {})),
    trashItems: vi.fn(async (_d: string, ids: string[]) => ({ trashId: 't1', moved: ids, notFound: [] })),
    reorderItems: vi.fn(async () => {}), updateItem: vi.fn(async () => ({})), writesInFlight: () => 0,
  },
}));
vi.mock('../../../services/trashService', () => ({ trashService: { restore: vi.fn(async () => ({ dossierId: 'dos-1' })) } }));
vi.mock('./useActDetails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useActDetails')>()),
  useActDetails: () => ({ title: null, rubricaOf: (n: { numero_articolo: string }) => (n.numero_articolo === '5' ? 'Responsabilità' : null) }),
}));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActTree: () => Promise.resolve([]), fetchActRubriche: () => Promise.resolve({}) }));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../decisions/DecisionEntryView', () => ({ DecisionEntryView: () => <div data-testid="decision-reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => null }));
// The other views read from the server: not what is tested here.
vi.mock('../atti/DossierAttiPanel', () => ({ DossierAttiPanel: () => null }));
vi.mock('../planner/DossierTasksPanel', () => ({ DossierTasksPanel: () => null }));
vi.mock('../../../features/deadlines/DeadlineCard', () => ({ DeadlineCard: () => null }));

import { appStore, useAppStore } from '../../../store/useAppStore';
import { dossierService } from '../../../services/dossierService';
import { trashService } from '../../../services/trashService';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { articleRowKey, isBoundPractice, practiceArticleKey } from '../../../utils/practice';
import type { Dossier, DossierItem } from '../../../types';
import { DossierDetailView } from './DossierDetailView';

/** LC88: the filter and the selection at the top of the one «Fonti», on the real reading. */

const s = () => appStore.getState();
const L24 = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
const L49 = { tipo_atto: 'legge', numero_atto: '49', data: '2023-04-21' };
const norma = (act: typeof L24, numero: string): DossierItem => ({ id: `n${act.numero_atto}-${numero}`, addedAt: '', type: 'norma', data: { ...act, numero_articolo: numero } } as DossierItem);
const items: DossierItem[] = [
  norma(L24, '5'), norma(L24, '7'), norma(L49, '1'),
  { id: 'note-5', addedAt: '', type: 'note', data: 'Vedi la decorrenza', aboutItemId: 'n24-5' } as DossierItem,
  { id: 'note-free', addedAt: '2026-11-01T09:00:00Z', type: 'note', data: 'Verificare il termine' } as DossierItem,
  { id: 's1', addedAt: '', type: 'sentenza', data: { corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024, etichetta: 'Cass. civ., n. 31310/2024' } } as DossierItem,
];
const dossierOf = (id: string, title: string, held: DossierItem[]): Dossier => ({ id, title, createdAt: '', tags: [], items: held });

function Page() {
  const dossier = useAppStore((st) => st.dossiers.find((d) => d.id === 'dos-1'));
  return dossier ? <DossierDetailView dossier={dossier} onBack={() => {}} showToast={() => {}} /> : null;
}
const renderPage = () => render(<MemoryRouter><Page /></MemoryRouter>);

const rowOf = (act: typeof L24, numero: string) => {
  const table = s().practices.find(isBoundPractice)!;
  const held = table.acts.find((a) => a.articles.some((r) => r.norma_data.numero_atto === act.numero_atto))!;
  const article = held.articles.find((r) => r.norma_data.numero_articolo === numero)!;
  return document.querySelector<HTMLElement>(`[data-practice-row="${articleRowKey(table.id, held.id, practiceArticleKey(article))}"]`);
};
const field = () => screen.getByRole('textbox', { name: 'Filtra le fonti della pratica' });
const filter = (value: string) => fireEvent.change(field(), { target: { value } });
const actToggle = (numero: string) => screen.getByRole('region', { name: new RegExp(`n\\. ${numero}$`) })
  .querySelector<HTMLElement>('h3 [role="button"]')!;
const decisions = () => screen.queryByTestId('practice-decisions');
const freeNote = () => screen.queryByText('Verificare il termine');
const status = () => screen.getAllByRole('status').find((el) => / di /.test(el.textContent ?? ''));

let toast: UndoToast | null = null;
let unregister: () => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  localStorage.removeItem('visualex-dossier-last-read');
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, searchTrigger: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null },
    dossiers: [dossierOf('dos-1', 'Ricorso Rossi', structuredClone(items)), dossierOf('dos-2', 'Ricorso Bianchi', [])],
    pendingDossierItemIds: {}, pendingDossierOrders: {}, lastSyncError: null,
  });
  toast = null;
  unregister = registerUndoToastListener((t) => { toast = t; });
});
afterEach(() => {
  toast?.onDismiss();
  unregister();
  vi.restoreAllMocks();
});

describe('the filter of «Fonti» (LC88)', () => {
  it('finds an article by its rubric: the other rows hide, an act left with none closes, «N di M» says it', () => {
    renderPage();
    filter('responsab');
    expect(rowOf(L24, '5')).not.toBeNull();
    expect(rowOf(L24, '7')).toBeNull();
    expect(actToggle('49')).toHaveAttribute('aria-expanded', 'false');
    expect(rowOf(L49, '1')).toBeNull();
    expect(decisions()).toBeNull();
    expect(freeNote()).toBeNull();
    // three articles, one decision, one note of the dossier
    expect(status()).toHaveTextContent('1 di 5');
  });

  it('finds an article by its number', () => {
    renderPage();
    filter('art. 7');
    expect(rowOf(L24, '7')).not.toBeNull();
    expect(rowOf(L24, '5')).toBeNull();
    expect(status()).toHaveTextContent('1 di 5');
  });

  it('finds an article by the text of a note about it', () => {
    renderPage();
    filter('decorrenza');
    expect(rowOf(L24, '5')).not.toBeNull();
    expect(rowOf(L24, '7')).toBeNull();
  });

  it('finds an act by its name, with all its rows', () => {
    renderPage();
    filter('n. 49');
    expect(rowOf(L49, '1')).not.toBeNull();
    expect(actToggle('24')).toHaveAttribute('aria-expanded', 'false');
    expect(status()).toHaveTextContent('1 di 5');
  });

  it('finds a decision by its citation', () => {
    renderPage();
    filter('31310');
    expect(within(decisions()!).getByRole('button', { name: /^Espandi .*31310/ })).toBeInTheDocument();
    expect(rowOf(L24, '5')).toBeNull();
    expect(rowOf(L49, '1')).toBeNull();
    expect(status()).toHaveTextContent('1 di 5');
  });

  it('finds a note of the dossier by its text', () => {
    renderPage();
    filter('termine');
    expect(freeNote()).toBeInTheDocument();
    expect(decisions()).toBeNull();
    expect(status()).toHaveTextContent('1 di 5');
  });

  it('Esc empties the field and every row comes back; `/` reaches the field from the page', () => {
    renderPage();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(field()).toHaveFocus();
    filter('responsab');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field()).toHaveValue('');
    expect(rowOf(L24, '7')).not.toBeNull();
    expect(actToggle('49')).toHaveAttribute('aria-expanded', 'true');
    expect(freeNote()).toBeInTheDocument();
  });
});

describe('«Seleziona» on «Fonti» (LC88)', () => {
  const tick = (row: HTMLElement | null) => fireEvent.click(within(row!).getByRole('checkbox'));

  it('puts a checkbox on the rows; the Space on a focused row ticks it; the count is said', () => {
    renderPage();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona' }));
    // three articles and the decision
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    tick(rowOf(L24, '5'));
    const heading = within(rowOf(L24, '7')!).getByRole('button', { name: /^Espandi .*, non selezionato$/ });
    heading.focus();
    fireEvent.keyDown(heading, { key: ' ' });
    expect(within(rowOf(L24, '7')!).getByRole('checkbox')).toBeChecked();
    // the Space ticked, it did not open the row
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(heading).toHaveAccessibleName(/, selezionato$/);
    expect(screen.getByText('2 selezionati')).toHaveAttribute('role', 'status');
  });

  it('«Togli dalla pratica» sends the ticked entries to the trash at once, no question, and «Annulla» puts them back', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona' }));
    tick(rowOf(L24, '5'));
    tick(rowOf(L49, '1'));
    fireEvent.click(screen.getByRole('button', { name: 'Togli dalla pratica' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(toast?.message).toBe('2 elementi rimossi'));
    expect(dossierService.trashItems).toHaveBeenCalledWith('dos-1', ['n24-5', 'n49-1']);
    expect(toast?.timeRemaining).toBe(10000);
    vi.mocked(dossierService.getById).mockResolvedValueOnce({ id: 'dos-1', name: 'Ricorso Rossi', is_pinned: false, created_at: '', updated_at: '', tags: [], items: [] });
    await act(async () => { await toast?.onUndo(); });
    expect(trashService.restore).toHaveBeenCalledWith('t1');
  });

  it('«Sposta in…» lists the other dossiers under the bar, in the page, and moves the ticked entries', () => {
    const move = vi.fn();
    appStore.setState({ moveToDossier: move });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona' }));
    tick(rowOf(L24, '7'));
    tick(within(decisions()!).getByRole('checkbox').closest('[data-practice-row]') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta in…' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ricorso Rossi' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ricorso Bianchi' }));
    expect(move).toHaveBeenCalledWith('dos-1', 'dos-2', ['n24-7', 's1']);
  });

  it('Esc, or «Fine», end the selection', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona' }));
    tick(rowOf(L24, '5'));
    fireEvent.keyDown(within(rowOf(L24, '5')!).getByRole('checkbox'), { key: 'Escape' });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona' }));
    // a selection ended is forgotten
    expect(within(rowOf(L24, '5')!).getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('draws nothing over the list: no dialog, nothing fixed', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona' }));
    tick(rowOf(L24, '5'));
    fireEvent.click(screen.getByRole('button', { name: 'Sposta in…' }));
    const fonti = field().closest('[role="tabpanel"]')!;
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fonti.querySelector('.fixed')).toBeNull();
  });
});
