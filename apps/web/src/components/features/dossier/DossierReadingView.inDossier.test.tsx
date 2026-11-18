import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  desktop: true,
  dragEnd: null as null | ((e: { active: { id: string }; over: { id: string } | null }) => void),
}));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => h.desktop, isDesktopViewport: () => h.desktop }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }) }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    addItem: vi.fn(), trashItems: vi.fn(), getById: vi.fn(), reorderItems: vi.fn(async () => {}), updateItem: vi.fn(),
    writesInFlight: () => 0,
  },
}));
vi.mock('../../../services/trashService', () => ({ trashService: { restore: vi.fn() } }));
// The act's index (LC86: a closed row's rubric) asks no source here: the source is mocked for the texts.
vi.mock('./useActDetails', async (importOriginal) => ({ ...(await importOriginal<typeof import('./useActDetails')>()), useActDetails: () => ({ title: null, rubricaOf: () => null }) }));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActTree: () => Promise.resolve([]), fetchActRubriche: () => Promise.resolve({}) }));
// The act's drag, taken from the column's DndContext: jsdom draws no layout for dnd-kit's sensors.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      if (props.onDragEnd) h.dragEnd = props.onDragEnd as typeof h.dragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({ DecisionEntryView: () => <div data-testid="decision-reader" /> }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => null }));

import { appStore, useAppStore } from '../../../store/useAppStore';
import { dossierService } from '../../../services/dossierService';
import { trashService } from '../../../services/trashService';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { articleRowKey, decisionRowKey, isBoundPractice, practiceArticleKey, type Practice } from '../../../utils/practice';
import type { Dossier, DossierItem } from '../../../types';
import { DossierReadingView } from './DossierReadingView';

/** LC55 c4: in the dossier's «Lettura» each row says whether it is in the dossier, and adds, leaves, reorders from there. */

const s = () => appStore.getState();
const svc = vi.mocked(dossierService);
const L24 = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
const DLGS = { tipo_atto: 'decreto legislativo', numero_atto: '196', data: '2003-06-30' };
const norma = (numero: string, act: typeof L24 = L24): DossierItem => ({
  id: `n${act.numero_atto}-${numero}`, addedAt: '', type: 'norma', data: { ...act, numero_articolo: numero },
});
const CASS = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 31310, anno: 2024 };
const sentenza: DossierItem = { id: 's1', addedAt: '', type: 'sentenza', data: { ...CASS, etichetta: 'Cass. civ., n. 31310/2024' } };
const dossierOf = (items: DossierItem[]): Dossier => ({ id: 'dos-1', title: 'Ricorso Rossi', createdAt: '', items });
const apiOf = (items: DossierItem[]) => ({
  id: 'dos-1', name: 'Ricorso Rossi', is_pinned: false, created_at: '', updated_at: '', tags: [],
  items: items.map((i) => ({
    id: i.id, item_type: i.type === 'norma' ? 'norm' as const : i.type === 'sentenza' ? 'sentenza' as const : 'note' as const,
    title: '', content: i.data, position: 0, status: 'unread' as const, created_at: '',
  })),
});
const trashChanged = vi.fn();

/** The page: the dossier it passes is the store's, as `DossierDetailView` gets it. */
function Page() {
  const dossier = useAppStore((st) => st.dossiers.find((d) => d.id === 'dos-1'));
  return dossier ? <DossierReadingView dossier={dossier} showToast={vi.fn()} onTrashChanged={trashChanged} /> : null;
}

const bound = (): Practice => s().practices.find(isBoundPractice)!;
const dossierIds = () => s().dossiers[0].items.map((i) => i.id);
const rowOf = (numero_atto: string, numero: string) => {
  const actOf = bound().acts.find((a) => a.norma.numero_atto === numero_atto)!;
  const row = actOf.articles.find((r) => r.norma_data.numero_articolo === numero)!;
  const el = document.querySelector<HTMLElement>(`[data-practice-row="${articleRowKey(bound().id, actOf.id, practiceArticleKey(row))}"]`);
  return el ? within(el) : null;
};
/** What arrives while reading: on the table, not in the dossier (as a norm cited in the text lands, LC54). */
const arrive = () => act(() => { s().addArticlesToPractice(bound().id, L241, [article(L241, '3')]); });
const menuOf = (row: ReturnType<typeof rowOf>) => fireEvent.click(row!.getByRole('button', { name: /^Azioni su/ }));

let toast: UndoToast | null = null;
let unregister = () => {};

beforeEach(() => {
  h.desktop = true;
  h.dragEnd = null;
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  toast = null;
  unregister = registerUndoToastListener((t) => { toast = t; });
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, searchTrigger: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null },
    dossiers: [dossierOf([norma('5'), norma('7'), norma('1', DLGS), sentenza])],
    pendingDossierItemIds: {}, pendingDossierOrders: {}, lastSyncError: null,
  });
});
afterEach(() => {
  unregister();
  vi.restoreAllMocks();
});

describe('the mark: «Non nella pratica» for what arrived while reading, nothing for what is in it', () => {
  it('rows of the dossier carry no mark; a row that came while reading says «Non nella pratica», in words', () => {
    render(<Page />);
    expect(screen.queryByText('Non nella pratica')).toBeNull();
    arrive();
    expect(screen.getAllByText('Non nella pratica')).toHaveLength(1);
    expect(rowOf('241', '3')!.getByText('Non nella pratica')).toBeInTheDocument();
    // the toggle's name replaces its content: it says it too
    expect(rowOf('241', '3')!.getByRole('button', { name: /non nella pratica/ })).toBeInTheDocument();
    expect(rowOf('24', '5')!.queryByText('Non nella pratica')).toBeNull();
  });

  it('a decision of the dossier carries no mark; one only on the table does', () => {
    render(<Page />);
    act(() => { s().addKnownDecisions(bound().id, [{ corte: 'cassazione', archivio: 'civile' as const, numero: 100, anno: 2023 }]); });
    const rows = bound().decisions.map((d) => document.querySelector<HTMLElement>(`[data-practice-row="${decisionRowKey(bound().id, d.id)}"]`)!);
    const marked = rows.filter((el) => within(el).queryByText('Non nella pratica'));
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('100');
  });

  it('the index of the reading view marks its entries too', () => {
    render(<Page />);
    arrive();
    act(() => { s().openBeside(bound().id, { id: 'x', kind: 'article', actId: bound().acts[0].id, articleKey: practiceArticleKey(bound().acts[0].articles[0]) }); });
    const index = screen.getByRole('list', { name: /Articoli sul tavolo di l\. 7 agosto 1990/ });
    expect(within(index).getByText('Non nella pratica')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /Articoli sul tavolo di l\. 8 marzo 2017/ }).textContent).not.toContain('Non nella pratica');
  });
});

describe('for a reader of fifty (LC55, the reviewer of #529)', () => {
  it('a row\'s commands are named, never a bare «×»; «Apri accanto» and the act\'s article numbers are 14 px', () => {
    render(<Page />);
    expect(screen.queryByRole('button', { name: /^Togli dal tavolo/ })).toBeNull();
    expect(rowOf('24', '5')!.getByRole('button', { name: /^Apri accanto/ })).toHaveClass('text-sm');
    const index = screen.getByRole('list', { name: /Articoli sul tavolo di l\. 8 marzo 2017/ });
    for (const chip of within(index).getAllByRole('button')) expect(chip).toHaveClass('text-sm');
  });
});

describe('«Aggiungi alla pratica»', () => {
  it('writes the row into the dossier with addToDossier, as the reader\'s popover does, and the mark goes', async () => {
    svc.addItem.mockResolvedValue({ id: 'srv-3', item_type: 'norm', title: '', content: {}, position: 4, status: 'unread', created_at: '' } as never);
    render(<Page />);
    arrive();
    fireEvent.click(rowOf('241', '3')!.getByRole('button', { name: /^Aggiungi alla pratica/ }));
    expect(svc.addItem).toHaveBeenCalledWith('dos-1', expect.objectContaining({
      content: expect.objectContaining({ tipo_atto: 'legge', numero_atto: '241', numero_articolo: '3' }),
    }));
    // «Fonti» reads the same store
    expect(s().dossiers[0].items.some((i) => i.type === 'norma' && i.data.numero_atto === '241')).toBe(true);
    expect(screen.queryByText('Non nella pratica')).toBeNull();
    await waitFor(() => expect(dossierIds()).toContain('srv-3'));
    // the re-sync that follows draws no second row
    expect(bound().acts.find((a) => a.norma.numero_atto === '241')!.articles).toHaveLength(1);
  });

  it('is in the row\'s «⋯» too, with its name (the phone\'s way)', () => {
    h.desktop = false;
    svc.addItem.mockReturnValue(new Promise(() => {}));
    render(<Page />);
    arrive();
    menuOf(rowOf('241', '3'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi alla pratica' }));
    expect(svc.addItem).toHaveBeenCalledTimes(1);
  });

  it('adds a decision that is only on the table', () => {
    svc.addItem.mockReturnValue(new Promise(() => {}));
    render(<Page />);
    act(() => { s().addKnownDecisions(bound().id, [{ corte: 'cassazione', archivio: 'civile' as const, numero: 100, anno: 2023 }]); });
    const entry = bound().decisions.find((d) => d.reference.numero === 100)!;
    const row = within(document.querySelector<HTMLElement>(`[data-practice-row="${decisionRowKey(bound().id, entry.id)}"]`)!);
    fireEvent.click(row.getByRole('button', { name: /^Aggiungi alla pratica/ }));
    expect(svc.addItem).toHaveBeenCalledWith('dos-1', expect.objectContaining({ content: expect.objectContaining({ numero: 100, anno: 2023 }) }));
  });
});

describe('«Togli dalla pratica»', () => {
  it('goes through the trash with «Annulla»; the row stays on the table with «Non nella pratica»', async () => {
    svc.trashItems.mockResolvedValue({ trashId: 't1', moved: ['n24-5'], notFound: [] });
    render(<Page />);
    menuOf(rowOf('24', '5'));
    expect(screen.queryByRole('menuitem', { name: 'Togli dal tavolo' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Togli dalla pratica' }));
    expect(svc.trashItems).toHaveBeenCalledWith('dos-1', ['n24-5']);
    expect(dossierIds()).not.toContain('n24-5');
    await waitFor(() => expect(toast?.message).toBe('Articolo tolto dalla pratica'));
    expect(trashChanged).toHaveBeenCalled();
    expect(rowOf('24', '5')!.getByText('Non nella pratica')).toBeInTheDocument();

    // «Annulla»: back in the dossier, the mark goes
    vi.mocked(trashService.restore).mockResolvedValue({ dossierId: 'dos-1' } as never);
    svc.getById.mockResolvedValue(apiOf([norma('5'), norma('7'), norma('1', DLGS), sentenza]) as never);
    await act(async () => { await toast!.onUndo(); });
    expect(trashService.restore).toHaveBeenCalledWith('t1');
    expect(dossierIds()).toContain('n24-5');
    expect(rowOf('24', '5')!.queryByText('Non nella pratica')).toBeNull();
  });

  it('a decision of the dossier leaves it the same way', async () => {
    svc.trashItems.mockResolvedValue({ trashId: 't2', moved: ['s1'], notFound: [] });
    render(<Page />);
    const entry = bound().decisions[0];
    menuOf(within(document.querySelector<HTMLElement>(`[data-practice-row="${decisionRowKey(bound().id, entry.id)}"]`)!));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Togli dalla pratica' }));
    expect(svc.trashItems).toHaveBeenCalledWith('dos-1', ['s1']);
    await waitFor(() => expect(toast?.message).toBe('Sentenza tolta dalla pratica'));
    expect(bound().decisions).toHaveLength(1);
  });

  it('«Rimuovi l\'atto» on an act of the dossier becomes «Togli dalla pratica»: its articles go to the trash, the act stays', async () => {
    svc.trashItems.mockResolvedValue({ trashId: 't3', moved: ['n24-5', 'n24-7'], notFound: [] });
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    expect(screen.queryByRole('menuitem', { name: /Rimuovi l'atto/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Togli dalla pratica' }));
    expect(svc.trashItems).toHaveBeenCalledWith('dos-1', ['n24-5', 'n24-7']);
    await waitFor(() => expect(toast?.message).toBe('2 articoli tolti dalla pratica'));
    expect(bound().acts.find((a) => a.norma.numero_atto === '24')!.articles).toHaveLength(2);
  });
});

describe('one article alone is a closed row as any other (LC86: no simple reading in «Fonti»)', () => {
  it('a lone article not in the dossier says so on its row, with «Aggiungi alla pratica»', () => {
    svc.addItem.mockReturnValue(new Promise(() => {}));
    appStore.setState({ dossiers: [dossierOf([])] });
    render(<Page />);
    arrive();
    expect(rowOf('241', '3')!.getByRole('button', { name: /^Espandi .*non nella pratica$/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Non nella pratica')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Aggiungi alla pratica/ }));
    expect(svc.addItem).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Non nella pratica')).toBeNull();
  });
});

describe('«Togli dal tavolo»', () => {
  it('on a row not in the dossier takes it off the table and writes nothing', () => {
    render(<Page />);
    arrive();
    const before = s().dossiers[0];
    menuOf(rowOf('241', '3'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Togli dal tavolo' }));
    expect(bound().acts.find((a) => a.norma.numero_atto === '241')?.articles ?? []).toHaveLength(0);
    expect(svc.trashItems).not.toHaveBeenCalled();
    expect(svc.addItem).not.toHaveBeenCalled();
    expect(s().dossiers[0]).toBe(before);
  });

  it('«Rimuovi l\'atto» on an act with nothing in the dossier stays a removal from the table', () => {
    render(<Page />);
    arrive();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 7 agosto 1990, n. 241' }));
    expect(screen.queryByRole('menuitem', { name: 'Togli dalla pratica' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Rimuovi l'atto/ })).toBeInTheDocument();
  });
});

describe('reordering the acts writes the order into the dossier', () => {
  it('as «Fonti» does, with setDossierItemOrder', () => {
    render(<Page />);
    const [first, second] = bound().acts;
    act(() => { h.dragEnd!({ active: { id: second.id }, over: { id: first.id } }); });
    expect(bound().acts.map((a) => a.norma.numero_atto)).toEqual(['196', '24']);
    expect(svc.reorderItems).toHaveBeenCalledWith('dos-1', ['n196-1', 'n24-5', 'n24-7', 's1']);
    expect(dossierIds()).toEqual(['n196-1', 'n24-5', 'n24-7', 's1']);
  });

  it('an act only on the table writes nothing', () => {
    render(<Page />);
    arrive();
    const table = bound().acts;
    const onlyHere = table.find((a) => a.norma.numero_atto === '241')!;
    act(() => { h.dragEnd!({ active: { id: onlyHere.id }, over: { id: table[0].id } }); });
    expect(bound().acts[0].id).toBe(onlyHere.id);
    expect(svc.reorderItems).not.toHaveBeenCalled();
  });

  it('writes the one move on the dossier\'s own order: a reorder made in «Fonti» meanwhile is kept', () => {
    const X = { tipo_atto: 'decreto legislativo', numero_atto: '50', data: '2016-04-18' };
    appStore.setState({ dossiers: [dossierOf([norma('5'), norma('7'), norma('1', DLGS), norma('2', X)])] });
    render(<Page />);
    // «Fonti» (or Claude) puts the 196 before the 24; the table, re-synced additively, keeps 24, 196, 50.
    act(() => { appStore.setState({ dossiers: [dossierOf([norma('1', DLGS), norma('5'), norma('7'), norma('2', X)])] }); });
    const [l24, , x] = bound().acts;
    act(() => { h.dragEnd!({ active: { id: x.id }, over: { id: l24.id } }); });
    expect(svc.reorderItems).toHaveBeenCalledWith('dos-1', ['n50-2', 'n196-1', 'n24-5', 'n24-7']);
  });
});

describe('the re-sync marks, and never takes a row off the table', () => {
  it('an item removed elsewhere (Claude via MCP, «Fonti») leaves its row with «Non nella pratica»; one added appears', () => {
    render(<Page />);
    act(() => { appStore.setState({ dossiers: [dossierOf([norma('7'), norma('1', DLGS), sentenza, norma('9')])] }); });
    expect(rowOf('24', '5')!.getByText('Non nella pratica')).toBeInTheDocument();
    expect(rowOf('24', '9')).not.toBeNull();
    expect(rowOf('24', '9')!.queryByText('Non nella pratica')).toBeNull();
    expect(screen.getAllByText('Non nella pratica')).toHaveLength(1);
  });
});
