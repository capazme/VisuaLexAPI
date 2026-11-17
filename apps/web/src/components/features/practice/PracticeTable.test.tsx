import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true, isDesktopViewport: () => true }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn() }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({ DecisionEntryView: () => <div data-testid="decision-reader" /> }));
vi.mock('../decisions/DecisionSearchTabView', () => ({
  DecisionSearchTabView: ({ tabId }: { tabId: string }) => <div data-testid="topic-list" data-tab={tabId} />,
}));

vi.mock('../../../services/dossierService', () => ({
  dossierService: { create: vi.fn(), addItem: vi.fn(), reorderItems: vi.fn(), delete: vi.fn() },
}));

import { dossierService } from '../../../services/dossierService';
import { appStore } from '../../../store/useAppStore';
import { PracticeTable } from './PracticeTable';
import { PracticeNotice } from './PracticeParts';
import { subscribeSearchField } from '../../../utils/searchFieldControl';
import { Z_INDEX } from '../../../constants/zIndex';
import { FOUND, L24, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { searchTableLabel } from '../../../utils/practice';

const s = () => appStore.getState();
const table = (streaming: Parameters<typeof PracticeTable>[0]['streaming'] = null, layout: 'overview' | 'index' = 'overview') =>
  <PracticeTable onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={streaming} layout={layout} />;

beforeEach(() => {
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, commandPaletteOpen: false, readingBackStack: [],
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('PracticeTable (spec §3.1)', () => {
  it('draws the active practice: its name, its count line and its column', () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    s().openDecision(FOUND, { practiceId, open: false });
    render(table());
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(searchTableLabel(new Date()));
    expect(screen.getByText('1 atto · 2 articoli · 1 sentenza')).toBeInTheDocument();
    expect(screen.getByTestId('practice-column')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Giurisprudenza (1)' })).toBeInTheDocument();
  });

  it('one act: one head, the act\'s, the table\'s name small over its title, one «⋯» with both menus (LC68)', () => {
    s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    render(table());
    const head = screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' }).querySelector('header')!;
    expect(within(head).getAllByRole('button', { name: /^(Azioni su|Altre azioni per) / })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Altre azioni per / })).toBeNull();
    expect(within(head).getByRole('heading', { level: 2 })).toHaveTextContent(searchTableLabel(new Date()));
    fireEvent.click(within(head).getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    expect(screen.getByRole('menuitem', { name: 'Rinomina' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Chiudi il tavolo' })).toBeInTheDocument();
  });

  it('switching the active practice switches the table', () => {
    s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const other = s().createPractice('Altra');
    render(table());
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Altra');
    act(() => { s().setActivePractice(s().practices[0].id); });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(searchTableLabel(new Date()));
    void other;
  });

  it('an empty practice says so and offers the search page\'s field', () => {
    s().createPractice('Vuota');
    render(table());
    expect(screen.getByText('Pratica vuota')).toBeInTheDocument();
    const field = vi.fn();
    const unsubscribe = subscribeSearchField(field);
    fireEvent.click(screen.getByRole('button', { name: 'Cerca una norma o una sentenza' }));
    expect(field).toHaveBeenCalledTimes(1);
    expect(s().commandPaletteOpen).toBe(false);
    unsubscribe();
  });

  it('in the index (U2) the header is compact, the title in the index\'s size, and saves nothing (LC60)', () => {
    s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    render(table(null, 'index'));
    expect(screen.queryByRole('button', { name: 'Salva come dossier' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('text-[22px]');
    expect(screen.getByTestId('practice-column')).toHaveAttribute('data-layout', 'index');
  });

  it('renames from a double click and from «⋯ › Rinomina»', () => {
    const p = s().createPractice('Prima');
    render(table());
    fireEvent.doubleClick(screen.getByRole('heading', { level: 2 }));
    const field = screen.getByRole('textbox', { name: 'Nome del tavolo' });
    fireEvent.change(field, { target: { value: 'Seconda' } });
    fireEvent.blur(field);
    expect(s().practices.find((x) => x.id === p)?.label).toBe('Seconda');

    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni per Seconda' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rinomina' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome del tavolo' }), { target: { value: 'Terza' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nome del tavolo' }), { key: 'Enter' });
    expect(s().practices[0].label).toBe('Terza');
  });

  it('«Chiudi il tavolo» closes at once, with no confirmation: «Annulla» is in the notification (K1a)', () => {
    s().createPractice('Da chiudere');
    render(table());
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni per Da chiudere' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chiudi il tavolo' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(s().practices).toEqual([]);
  });

  it('a search streaming into the practice shows its bar under the header; into another, nothing', () => {
    const p = s().createPractice('P');
    const { rerender } = render(table({ practiceId: p, loaded: 1, total: 4 }));
    expect(screen.getByTestId('practice-streaming')).toBeInTheDocument();
    rerender(table({ practiceId: 'other', loaded: 1, total: 4 }));
    expect(screen.queryByTestId('practice-streaming')).toBeNull();
  });

  it('draws no band for the topic searches: on the desktop they are windows beside the table', () => {
    s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().openTopicSearch({ tema: 'perdita di chance' }, 'Tema: perdita di chance');
    render(table());
    expect(screen.queryByRole('region', { name: /Ricerca per tema/ })).toBeNull();
    expect(screen.queryByTestId('topic-list')).toBeNull();
  });

  it('the migration\'s notice: shown once, as an info toast that stays until closed, in the toast band over the bar', () => {
    s().createPractice('P');
    appStore.setState({ practiceNotice: 'Una ricerca per tema non è stata riaperta: «Tema: danno». Puoi rifarla dalla barra di ricerca.' });
    const { unmount } = render(<PracticeNotice />);
    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent(/Una ricerca per tema non è stata riaperta/);
    expect(toast).toHaveClass(Z_INDEX.toast);
    expect(toast).not.toHaveClass('z-[60]');
    expect(s().practiceNotice).toBeNull();
    unmount();
    render(<PracticeNotice />);
    expect(screen.queryByText(/Una ricerca per tema non è stata riaperta/)).toBeNull();
  });

  it('the table does not take the notice (SearchPanel shows it over both layouts)', () => {
    s().createPractice('P');
    appStore.setState({ practiceNotice: 'avviso' });
    render(table());
    expect(s().practiceNotice).toBe('avviso');
  });
});

describe('PracticeTable: «Aggiungi a una pratica…» (spec §7; LC60: no «Salva come dossier»)', () => {
  beforeEach(() => {
    vi.mocked(dossierService.create).mockClear();
    vi.mocked(dossierService.addItem).mockClear();
    vi.mocked(dossierService.create).mockResolvedValue({ id: 'srv-d', name: 'x', created_at: '2026-10-12T00:00:00Z' } as never);
    vi.mocked(dossierService.addItem).mockResolvedValue({
      id: 'srv-i', item_type: 'norm', title: 't', content: {}, position: 0, status: 'unread', created_at: '2026-10-12T00:00:00Z',
    } as never);
    vi.mocked(dossierService.reorderItems).mockResolvedValue(undefined as never);
    appStore.setState({ dossiers: [], lastSyncError: null, pendingDossierItemIds: {}, pendingDossierOrders: {} });
  });

  it('has no «Salva come dossier», in the header, in its menu or in the act\'s «⋯» of one article', () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    s().renamePractice(practiceId, 'Responsabilità medica');
    const { unmount } = render(table());
    expect(screen.queryByRole('button', { name: 'Salva come dossier' })).toBeNull();
    // One act (LC68): no head of the table; its «⋯» rides the act's.
    expect(screen.queryByRole('button', { name: /^Altre azioni per / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    expect(screen.queryByRole('menuitem', { name: 'Salva come dossier' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' })).toBeInTheDocument();
    unmount();
    s().closePractice(practiceId);
    s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    render(table());
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    expect(screen.queryByRole('menuitem', { name: 'Salva come dossier' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Nuova pratica' })).toBeNull();
  });

  it('«Aggiungi a una pratica…» lists the dossiers and adds to the picked one', async () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    s().renamePractice(practiceId, 'Pratica');
    appStore.setState({ dossiers: [{ id: 'd1', title: 'Esistente', createdAt: '2026-10-01T00:00:00Z', items: [] }] as never });
    render(table());
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Aggiungi a una pratica' })).getByRole('button', { name: /Esistente/ }));
    expect(await screen.findByText('Salvato nella pratica «Esistente»: 2 articoli')).toBeInTheDocument();
    expect(dossierService.create).not.toHaveBeenCalled();
  });

  it('one save at a time: the menu entry is disabled while it runs; the outcome sits in the toast band, outside the table', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(dossierService.addItem).mockReturnValue(new Promise((resolve) => { finish = resolve; }) as never);
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().addArticlesToPractice(practiceId, L24, [article(L24, '7')]);
    s().renamePractice(practiceId, 'Appalti');
    appStore.setState({ dossiers: [{ id: 'd1', title: 'Esistente', createdAt: '2026-10-01T00:00:00Z', items: [] }] as never });
    render(table());
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Aggiungi a una pratica' })).getByRole('button', { name: /Esistente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' }));
    expect(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' })).toBeDisabled();
    await act(async () => { finish({ id: 'srv-i', item_type: 'norm', title: 't', content: {}, position: 0, status: 'unread', created_at: '2026-10-12T00:00:00Z' }); });
    const message = await screen.findByText(/^Salvato nella pratica «Esistente»/);
    const toast = message.closest('[role="alert"]') as HTMLElement;
    expect(toast.closest('[data-testid="practice-table"]')).toBeNull();
    expect(toast.className).toContain(Z_INDEX.toast);
    expect(dossierService.create).not.toHaveBeenCalled();
  });

  it('«Aggiungi a una pratica…» is a modal dialog: the focus moves in, Tab stays in, Esc gives it back to «⋯»', async () => {
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
    s().renamePractice(practiceId, 'Pratica');
    appStore.setState({ dossiers: [{ id: 'd1', title: 'Esistente', createdAt: '2026-10-01T00:00:00Z', items: [] }] as never });
    render(table());
    const trigger = screen.getByRole('button', { name: 'Azioni su l. 8 marzo 2017, n. 24' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiungi a una pratica…' }));
    const dialog = screen.getByRole('dialog', { name: 'Aggiungi a una pratica' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const first = within(dialog).getByRole('button', { name: /Esistente/ });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Aggiungi a una pratica' })).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

