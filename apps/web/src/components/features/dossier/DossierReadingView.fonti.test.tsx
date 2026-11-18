import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => h.desktop, isDesktopViewport: () => h.desktop }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }) }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    addItem: vi.fn(), trashItems: vi.fn(), getById: vi.fn(() => new Promise(() => {})), reorderItems: vi.fn(async () => {}),
    updateItem: vi.fn(async () => ({})), writesInFlight: () => 0,
  },
}));
vi.mock('./useActDetails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useActDetails')>()),
  // The act's index gives the closed rows their rubric (LC86).
  useActDetails: () => ({ title: null, rubricaOf: (n: { numero_articolo: string }) => (n.numero_articolo === '5' ? 'Responsabilità' : null) }),
}));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActTree: () => Promise.resolve([]), fetchActRubriche: () => Promise.resolve({}) }));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../decisions/DecisionEntryView', () => ({ DecisionEntryView: () => <div data-testid="decision-reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => null }));

import { appStore, useAppStore } from '../../../store/useAppStore';
import { articleRowKey, isBoundPractice, practiceArticleKey, type Practice } from '../../../utils/practice';
import type { Dossier, DossierItem } from '../../../types';
import { DossierReadingView } from './DossierReadingView';

/** LC86: «Fonti» is the reading — closed rows that open in place, the last article read open again. */

const KEPT = 'visualex-dossier-last-read';
const s = () => appStore.getState();
const L24 = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
const norma = (numero: string): DossierItem => ({ id: `n24-${numero}`, addedAt: '', type: 'norma', data: { ...L24, numero_articolo: numero } } as DossierItem);
const note: DossierItem = { id: 'note-5', addedAt: '', type: 'note', data: 'Vedi la decorrenza', aboutItemId: 'n24-5' } as DossierItem;
const sentenza: DossierItem = { id: 's1', addedAt: '', type: 'sentenza', data: { corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024, etichetta: 'Cass. civ., n. 31310/2024' } } as DossierItem;
const dossierOf = (items: DossierItem[], id = 'dos-1'): Dossier => ({ id, title: id === 'dos-1' ? 'Ricorso Rossi' : 'Ricorso Bianchi', createdAt: '', items });

function Page() {
  const dossier = useAppStore((st) => st.dossiers.find((d) => d.id === 'dos-1'));
  return dossier ? <DossierReadingView dossier={dossier} showToast={vi.fn()} /> : null;
}

const bound = (): Practice => s().practices.find(isBoundPractice)!;
const keyOf = (numero: string) => {
  const actOf = bound().acts[0];
  const articleKey = practiceArticleKey(actOf.articles.find((r) => r.norma_data.numero_articolo === numero)!);
  return { act: actOf, articleKey, rowKey: articleRowKey(bound().id, actOf.id, articleKey) };
};
const rowEl = (numero: string) => document.querySelector<HTMLElement>(`[data-practice-row="${keyOf(numero).rowKey}"]`)!;
const toggleOf = (numero: string) => within(rowEl(numero)).getByRole('button', { name: /^(Espandi|Comprimi) / });

beforeEach(() => {
  h.desktop = true;
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  localStorage.removeItem(KEPT);
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, searchTrigger: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null },
    dossiers: [dossierOf([norma('5'), norma('7'), note, sentenza]), dossierOf([], 'dos-2')],
    pendingDossierItemIds: {}, pendingDossierOrders: {}, lastSyncError: null,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(KEPT);
});

describe('the rows of «Fonti»', () => {
  it('are closed, and say number, rubric and the notes about them', () => {
    render(<Page />);
    expect(toggleOf('5')).toHaveAttribute('aria-expanded', 'false');
    expect(toggleOf('7')).toHaveAttribute('aria-expanded', 'false');
    expect(within(rowEl('5')).getByText('Responsabilità')).toBeInTheDocument();
    expect(toggleOf('5')).toHaveAccessibleName(/, 1 nota$/);
    expect(toggleOf('7')).not.toHaveAccessibleName(/nota/);
    expect(screen.queryByText('Carico il testo…')).toBeNull();
  });

  it('open in place on a click and close on another, more than one open at once; the focus stays on the row; no dialog', () => {
    render(<Page />);
    // An open row reads its text: «Carico il testo…» while it comes (the source never answers here).
    const reading = (numero: string) => within(rowEl(numero)).queryByText('Carico il testo…');
    toggleOf('5').focus();
    fireEvent.click(toggleOf('5'));
    expect(toggleOf('5')).toHaveAttribute('aria-expanded', 'true');
    expect(reading('5')).toBeInTheDocument();
    expect(document.activeElement).toBe(toggleOf('5'));
    fireEvent.click(toggleOf('7'));
    expect(reading('7')).toBeInTheDocument();
    fireEvent.click(toggleOf('5'));
    expect(toggleOf('5')).toHaveAttribute('aria-expanded', 'false');
    expect(reading('5')).toBeNull();
    expect(reading('7')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opened from elsewhere (the act\'s arrows, a chip), leaves the focus where it was', () => {
    render(<Page />);
    const away = within(rowEl('5')).getByRole('button', { name: /^Azioni su/ });
    away.focus();
    act(() => { s().revealPracticeRow(bound().id, keyOf('7').act.id, keyOf('7').articleKey); });
    expect(toggleOf('7')).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(away);
  });

  it('the decisions stand in their own group under the acts, their rows opening in place too', () => {
    render(<Page />);
    const decisions = screen.getByTestId('practice-decisions');
    expect(within(decisions).getByRole('heading', { name: /Giurisprudenza/ })).toBeInTheDocument();
    expect(rowEl('7').compareDocumentPosition(decisions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const toggle = within(decisions).getByRole('button', { name: /^Espandi / });
    fireEvent.click(toggle);
    expect(within(decisions).getByTestId('decision-reader')).toBeInTheDocument();
  });
});

describe('the last article read (L-79)', () => {
  it('is kept as rows open, and opens again alone when the dossier is opened again', () => {
    const first = render(<Page />);
    fireEvent.click(toggleOf('5'));
    fireEvent.click(toggleOf('7'));
    const seven = keyOf('7');
    expect(JSON.parse(localStorage.getItem(KEPT)!)['dos-1']).toEqual({ act: seven.act.key, article: seven.articleKey, offset: 0 });
    first.unmount();

    render(<Page />);
    expect(s().practiceRows[keyOf('5').rowKey]).toBeUndefined();
    expect(s().practiceRows[seven.rowKey]).toBe(true);
    expect(toggleOf('7')).toHaveAttribute('aria-expanded', 'true');
    expect(toggleOf('5')).toHaveAttribute('aria-expanded', 'false');
  });

  it('with nothing kept, every row is closed, those left open earlier in the session too', () => {
    const first = render(<Page />);
    act(() => { s().setRowOpen(keyOf('5').rowKey, true); });
    first.unmount();
    localStorage.removeItem(KEPT);
    render(<Page />);
    expect(Object.keys(s().practiceRows).filter((k) => k.startsWith(`${bound().id}/`))).toEqual([]);
  });

  it('kept for an article the dossier no longer holds, opens nothing', () => {
    localStorage.setItem(KEPT, JSON.stringify({ 'dos-1': { act: 'nessun atto', article: 'x', offset: 40 } }));
    render(<Page />);
    expect(Object.keys(s().practiceRows)).toEqual([]);
  });
});

describe('a row\'s «⋯»: a note and a move, under the row (L-73)', () => {
  it('«Aggiungi una nota» opens the field under the row, no dialog, and writes the note about that entry', async () => {
    const addNote = vi.fn(async () => true);
    appStore.setState({ addNoteToDossier: addNote });
    render(<Page />);
    fireEvent.click(within(rowEl('7')).getByRole('button', { name: /^Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi una nota' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const field = within(rowEl('7')).getByRole('textbox', { name: /^Nota su / });
    fireEvent.change(field, { target: { value: 'Da rileggere' } });
    await act(async () => { fireEvent.click(within(rowEl('7')).getByRole('button', { name: 'Aggiungi la nota' })); });
    expect(addNote).toHaveBeenCalledWith('dos-1', 'Da rileggere', 'n24-7');
    expect(within(rowEl('7')).queryByRole('textbox')).toBeNull();
  });

  it('a decision\'s «⋯» offers no note: the server takes notes about articles only', () => {
    render(<Page />);
    fireEvent.click(within(screen.getByTestId('practice-decisions')).getByRole('button', { name: /^Azioni su/ }));
    expect(screen.queryByRole('menuitem', { name: 'Aggiungi una nota' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: "Sposta in un'altra pratica" })).toBeInTheDocument();
  });

  it('«Sposta in un\'altra pratica» lists the other dossiers under the row and moves the entry there', () => {
    const move = vi.fn();
    appStore.setState({ moveToDossier: move });
    render(<Page />);
    fireEvent.click(within(rowEl('5')).getByRole('button', { name: /^Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Sposta in un'altra pratica" }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rowEl('5')).queryByRole('button', { name: 'Ricorso Rossi' })).toBeNull();
    fireEvent.click(within(rowEl('5')).getByRole('button', { name: 'Ricorso Bianchi' }));
    expect(move).toHaveBeenCalledWith('dos-1', 'dos-2', ['n24-5']);
  });
});
