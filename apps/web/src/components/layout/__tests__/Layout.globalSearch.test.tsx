import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
// The planner's host reads the tasks from the server: not under test here.
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), tryStartTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));
// The server's resolver names nothing; the alias catalog is empty.
vi.mock('../../../services/legalFetch', () => ({
  legalFetch: vi.fn(async (path: string) => new Response(
    JSON.stringify(path === '/parse_query' ? { recognized: false } : { presets: {} }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )),
}));
const resolveAct = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/actUrn', () => ({ resolveAct }));

import { appStore } from '../../../store/useAppStore';
import { Layout } from '../Layout';
import { DecisionAddress } from '../../features/decisions/DecisionAddress';
import { isWorkspaceCovered } from '../../../utils/findWindowControl';
import { isTypedSearch } from '../../../hooks/useSearchActions';

const PALETTE_BOX = 'Atto o citazione, es. art 2043 cc';

/** The layout over a few pages; each page says which it is, so a test sees where the reader is. */
function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<p>Pagina di ricerca</p>} />
          <Route path="dossier" element={<p>Pagina dossier</p>} />
          <Route path="history" element={<p>Pagina cronologia</p>} />
          <Route path="studia" element={<p>Pagina studia</p>} />
          <Route path="sentenze" element={<DecisionAddress />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const pressCmdK = () => fireEvent.keyDown(window, { key: 'k', metaKey: true });

const original = appStore.getState();
const triggerSearch = vi.fn();
const openDecision = vi.fn();
const openTopicSearch = vi.fn();
const addActIndexToPractice = vi.fn();

beforeEach(() => {
  appStore.setState({
    settings: { ...original.settings, focusMode: false },
    commandPaletteOpen: false,
    commandPaletteQuery: null,
    customAliases: [],
    quickNorms: [],
    triggerSearch,
    openDecision,
    openTopicSearch,
    addActIndexToPractice,
  });
});

afterEach(() => {
  appStore.setState({
    triggerSearch: original.triggerSearch,
    openDecision: original.openDecision,
    openTopicSearch: original.openTopicSearch,
    addActIndexToPractice: original.addActIndexToPractice,
    commandPaletteOpen: false,
    commandPaletteQuery: null,
  });
  vi.clearAllMocks();
});

describe('Layout — ⌘K opens the palette on every page', () => {
  it.each([
    ['/dossier', 'Pagina dossier'],
    ['/history', 'Pagina cronologia'],
    ['/studia', 'Pagina studia'],
  ])('on %s, at once, without leaving the page', (path, page) => {
    at(path);
    expect(screen.queryByPlaceholderText(PALETTE_BOX)).toBeNull();
    pressCmdK();
    expect(screen.getByPlaceholderText(PALETTE_BOX)).toHaveFocus();
    expect(screen.getByText(page)).toBeInTheDocument();
  });

  it('a decision opened from another page lands in the practices, on the search page', async () => {
    const user = userEvent.setup();
    at('/dossier');
    pressCmdK();
    await user.type(screen.getByPlaceholderText(PALETTE_BOX), 'Cass. civ. 10787/2024{Enter}');
    expect(openDecision).toHaveBeenCalledWith(expect.objectContaining({ corte: 'cassazione', numero: 10787, anno: 2024 }), { fromLink: true });
    expect(await screen.findByText('Pagina di ricerca')).toBeInTheDocument();
  });

  it('a norm searched from another page lands in the practices, on the search page', async () => {
    const user = userEvent.setup();
    at('/history');
    pressCmdK();
    await user.type(screen.getByPlaceholderText(PALETTE_BOX), 'art 2043 cc{Enter}');
    expect(triggerSearch).toHaveBeenCalledWith(expect.objectContaining({ article: '2043', version: 'vigente' }));
    expect(await screen.findByText('Pagina di ricerca')).toBeInTheDocument();
  });

  it('a topic searched from another page lands in the practices, on the search page', async () => {
    const user = userEvent.setup();
    at('/studia');
    pressCmdK();
    await user.type(screen.getByPlaceholderText(PALETTE_BOX), 'danno da vacanza rovinata');
    const line = await screen.findByText('Cerca "danno da vacanza rovinata" nelle sentenze della Cassazione');
    await user.click(line);
    expect(openTopicSearch).toHaveBeenCalledWith({ tema: 'danno da vacanza rovinata' }, 'Tema: danno da vacanza rovinata');
    expect(await screen.findByText('Pagina di ricerca')).toBeInTheDocument();
  });

  it('«Apri l\'indice e sfoglia» from another page opens the act on the search page', async () => {
    const norma = { tipo_atto: 'codice civile', urn: 'urn:test' };
    resolveAct.mockResolvedValue({ norma });
    const user = userEvent.setup();
    at('/dossier');
    pressCmdK();
    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    await user.click(screen.getByRole('button', { name: /Apri l'indice e sfoglia/ }));
    await waitFor(() => expect(addActIndexToPractice).toHaveBeenCalledWith(null, norma));
    expect(screen.getByText('Pagina di ricerca')).toBeInTheDocument();
  });

  it('a quick norm used from its manager on another page lands on the search page, as a trigger checked for an annex', async () => {
    const params = { act_type: 'codice civile', act_number: '', date: '', article: '2043', version: 'vigente' as const, version_date: '' };
    appStore.setState({
      quickNorms: [{ id: 'q1', label: 'Danno ingiusto', searchParams: params, createdAt: '', usageCount: 0 }],
      quickNormsManagerOpen: true,
      selectQuickNorm: vi.fn(),
    });
    const user = userEvent.setup();
    at('/dossier');
    await user.click(screen.getByText('Danno ingiusto'));
    expect(triggerSearch).toHaveBeenCalledWith(params);
    expect(isTypedSearch(triggerSearch.mock.calls[0][0])).toBe(false);
    expect(await screen.findByText('Pagina di ricerca')).toBeInTheDocument();
    appStore.setState({ quickNorms: [], quickNormsManagerOpen: false, selectQuickNorm: original.selectQuickNorm });
  });

  it('a quick norm picked in the palette runs as a typed search, and its saved params stay unmarked', async () => {
    const params = { act_type: 'codice civile', act_number: '', date: '', article: '2043', version: 'vigente' as const, version_date: '' };
    appStore.setState({
      quickNorms: [{ id: 'q1', label: 'Danno ingiusto', searchParams: params, createdAt: '', usageCount: 0 }],
      selectQuickNorm: () => appStore.getState().quickNorms[0],
    });
    const user = userEvent.setup();
    at('/history');
    pressCmdK();
    await user.click(screen.getByRole('option', { name: /Danno ingiusto/ }));
    const sent = triggerSearch.mock.calls[0][0];
    expect(sent).toEqual(params);
    expect(isTypedSearch(sent)).toBe(true);
    expect(isTypedSearch(params)).toBe(false);
    appStore.setState({ quickNorms: [], selectQuickNorm: original.selectQuickNorm });
  });

  it('is reached with the words handed over, from another page («Cerca nella barra di ricerca»)', () => {
    at('/history');
    act(() => appStore.getState().openCommandPaletteWith('Cass. civ. 999/2020'));
    expect(screen.getByPlaceholderText(PALETTE_BOX)).toHaveValue('Cass. civ. 999/2020');
  });

  it('is opened by the address /sentenze, on the search page', () => {
    at('/sentenze');
    expect(screen.getByPlaceholderText(PALETTE_BOX)).toBeInTheDocument();
    expect(screen.getByText('Pagina di ricerca')).toBeInTheDocument();
  });

  it('covers the workspace while open, so Cmd/Ctrl+F stays the browser\'s', () => {
    at('/');
    pressCmdK();
    expect(isWorkspaceCovered()).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('Layout — the search page\'s field', () => {
  it('is drawn on the search page only, above the content', () => {
    at('/');
    expect(screen.getByRole('search', { name: 'Ricerca' })).toBeInTheDocument();
    expect(screen.getByTestId('search-bar').nextElementSibling).toContainElement(screen.getByText('Pagina di ricerca'));
  });

  it('is the phone\'s bar below lg, the menu button beside the field, and ends before the Focus toggle from md', () => {
    at('/');
    const bar = screen.getByTestId('search-bar');
    expect(bar).toHaveClass('h-[var(--search-bar-height)]', 'pl-1', 'lg:pl-8', 'md:pr-[3.25rem]', 'lg:pr-[4.5rem]');
    expect(bar.firstElementChild).toHaveAccessibleName('Apri il menu');
    expect(document.querySelector('main')).toHaveClass('[--search-bar-height:calc(3.5rem+env(safe-area-inset-top))]', 'lg:[--search-bar-height:4.5rem]');
  });

  it.each(['/dossier', '/history'])('is not drawn on %s', (path) => {
    at(path);
    expect(screen.queryByRole('search', { name: 'Ricerca' })).toBeNull();
  });

  it('is hidden in Focus mode, where ⌘K still opens the palette', () => {
    appStore.setState((s) => ({ settings: { ...s.settings, focusMode: true } }));
    at('/');
    expect(screen.queryByRole('search', { name: 'Ricerca' })).toBeNull();
    pressCmdK();
    expect(screen.getByPlaceholderText(PALETTE_BOX)).toBeInTheDocument();
  });
});
