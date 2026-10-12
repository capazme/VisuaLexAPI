import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => null }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => null }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./ReadingBackControl', () => ({ ReadingBackControl: () => null }));
vi.mock('./NormaCard', () => ({
  NormaCard: ({ tabId, autoFocusArticleId }: { tabId: string; autoFocusArticleId?: string }) => (
    <div data-testid="norma-card" data-tab={tabId} data-autofocus={autoFocusArticleId ?? ''} />
  ),
}));
// The practices' surfaces (flag on): the phone's table and its full-screen reader draw these.
vi.mock('./ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('./TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../practice/ReadingRow', () => ({ ReadingRow: () => <div data-testid="desktop-row" /> }));
vi.mock('../practice/PracticeBar', () => ({ PracticeBar: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: ({ reference }: { reference: { numero: number } }) => <div data-testid="decision-reader">n. {reference.numero}</div>,
}));
vi.mock('../decisions/DecisionTabView', () => ({
  DecisionTabView: ({ reference }: { reference: { numero: number } }) => <div data-testid="decision">n. {reference.numero}</div>,
}));

import { appStore } from '../../../store/useAppStore';
import { besideRefFor, practiceArticleKey } from '../../../utils/practice';
import { SearchPanel } from './SearchPanel';

const PREVIOUS = 'Tab precedente';
const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };

beforeEach(() => appStore.setState({ workspaceTabs: [], pendingDecision: null, mobileActiveTabId: null }));

describe('SearchPanel on a phone', () => {
  // the tab area animates one tab out before the next in: the new one is awaited
  it('shows a decision that has just been opened, and leaves the reader\'s own swipe alone', async () => {
    appStore.getState().addWorkspaceTab('Codice civile');
    appStore.getState().addWorkspaceTab('Codice penale');
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(screen.queryByTestId('decision')).toBeNull();

    act(() => { appStore.getState().openDecisionTab(REF); });
    expect(await screen.findByTestId('decision')).toHaveTextContent('n. 99999');
    expect(screen.getByText('Cass. civ., n. 99999/2024')).toBeInTheDocument(); // the header names it

    // the reader goes back to the first tab (the previous-tab chevron is the first button)
    fireEvent.click(screen.getByRole('button', { name: PREVIOUS }));
    fireEvent.click(screen.getByRole('button', { name: PREVIOUS }));
    await waitFor(() => expect(screen.queryByTestId('decision')).toBeNull());
    expect(screen.getByText('Codice civile')).toBeInTheDocument();

    // a later change to the store does not pull the reader back to the decision
    act(() => { appStore.getState().addWorkspaceTab('Codice di procedura'); });
    // nothing moves: the header still names the tab the reader chose (let the animation settle)
    await waitFor(() => expect(screen.getByText('Codice civile')).toBeInTheDocument());
    expect(screen.queryByTestId('decision')).toBeNull();
  });

  it('shows the decision again when it is opened again while it is still the frontmost tab', async () => {
    appStore.getState().addWorkspaceTab('Codice civile');
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    act(() => { appStore.getState().openDecisionTab(REF); });
    expect(await screen.findByTestId('decision')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: PREVIOUS }));
    await waitFor(() => expect(screen.queryByTestId('decision')).toBeNull());

    act(() => { appStore.getState().openDecisionTab(REF); }); // same tab, still in front, raised
    expect(await screen.findByTestId('decision')).toBeInTheDocument();
  });

  it('shows the surviving tab when a chosen candidate was already open in another tab', async () => {
    const penal = appStore.getState().openDecisionTab({ ...REF, archivio: 'penale' });
    const civil = appStore.getState().openDecisionTab(REF);
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    act(() => { appStore.getState().addWorkspaceTab('Codice civile'); });
    // the reader starts on the penal decision (first tab) and moves on to the civil one
    expect(screen.getByText('Cass. pen., n. 99999/2024')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tab successiva' }));
    await waitFor(() => expect(screen.getByText('Cass. civ., n. 99999/2024')).toBeInTheDocument());
    act(() => { appStore.getState().setDecisionTabIdentity(civil, { ...REF, archivio: 'penale' }, 'Cass. pen., n. 99999/2024'); });
    expect(await screen.findByTestId('decision')).toHaveTextContent('n. 99999');
    // the header names the survivor, not the closed civil tab
    expect(screen.getByText('Cass. pen., n. 99999/2024')).toBeInTheDocument();
    expect(screen.queryByText('Cass. civ., n. 99999/2024')).toBeNull();
    expect(appStore.getState().workspaceTabs.map((t) => t.id)).not.toContain(civil);
    expect(appStore.getState().workspaceTabs.map((t) => t.id)).toContain(penal);
  });
});

describe('SearchPanel on a phone — the layout\'s menu button', () => {
  it('leaves room for the fixed menu button (top-left, 56px wide) at the left of the tab header', () => {
    appStore.getState().addWorkspaceTab('Codice civile');
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    const header = screen.getByTestId('phone-tab-header');
    expect(header).toContainElement(screen.getByRole('button', { name: PREVIOUS }));
    // 4.5rem = 72px: the button's 16px offset and 40px of width, and a gap
    expect(header).toHaveClass('pl-[4.5rem]');
  });
});

describe('SearchPanel on a phone — the tab on screen lives in the store', () => {
  const NORMA = { tipo_atto: 'codice civile', data: '', numero_articolo: '1' };
  const ARTICLES = [{ article_text: 'uno', norma_data: NORMA }, { article_text: 'due', norma_data: { ...NORMA, numero_articolo: '2' } }];

  it('a swipe, a chevron or a dot writes it, and the column follows it when the store changes it', async () => {
    const first = appStore.getState().addWorkspaceTab('Codice civile');
    const second = appStore.getState().addWorkspaceTab('Codice penale');
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(screen.getByText('Codice civile')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tab successiva' }));
    expect(appStore.getState().mobileActiveTabId).toBe(second);
    await waitFor(() => expect(screen.getByText('Codice penale')).toBeInTheDocument());

    act(() => { appStore.getState().setMobileActiveTabId(first); });
    await waitFor(() => expect(screen.getByText('Codice civile')).toBeInTheDocument());
  });

  it('revealTab (the find window\'s «go to») shows that tab, and the block on screen gets the article to show', async () => {
    const first = appStore.getState().addWorkspaceTab('Codice civile');
    const second = appStore.getState().addWorkspaceTab('Codice penale', NORMA, ARTICLES);
    void first;
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(screen.queryByTestId('norma-card')).toBeNull();

    act(() => {
      appStore.getState().revealTab(second);
      appStore.getState().focusArticleInTab(second, '2');
    });

    const card = await screen.findByTestId('norma-card');
    expect(card).toHaveAttribute('data-tab', second);
    expect(card).toHaveAttribute('data-autofocus', '2');
  });

  it('closing the tab on screen shows the one that took its place', async () => {
    appStore.getState().addWorkspaceTab('Codice civile');
    const second = appStore.getState().addWorkspaceTab('Codice penale');
    appStore.getState().addWorkspaceTab('Codice di procedura');
    appStore.getState().setMobileActiveTabId(second);
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(screen.getByText('Codice penale')).toBeInTheDocument();

    act(() => { appStore.getState().removeTab(second); });
    await waitFor(() => expect(screen.getByText('Codice di procedura')).toBeInTheDocument());
  });
});


describe('SearchPanel on a phone — with the practices (flag on, spec §8, P5)', () => {
  // A controllable viewport: `useIsDesktop` listens to the media query's change.
  let desktop = false;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  let savedMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    savedMatchMedia = window.matchMedia;
    desktop = false;
    listeners.clear();
    window.matchMedia = ((query: string) => ({
      get matches() { return desktop; },
      media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: (_type: string, fn: (e: { matches: boolean }) => void) => { listeners.add(fn); },
      removeEventListener: (_type: string, fn: (e: { matches: boolean }) => void) => { listeners.delete(fn); },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    appStore.setState({
      practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
      practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null, workspaceTabs: [],
      structureWindow: { blockId: null, position: { x: 0, y: 0 } },
    });
  });
  afterEach(() => {
    window.matchMedia = savedMatchMedia;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const NORMA = { tipo_atto: 'legge', data: '2017-03-08', numero_atto: '24' };
  const art = (n: string) => ({ article_text: `Art. ${n}\nTesto ${n}.`, norma_data: { ...NORMA, numero_articolo: n, versione: 'vigente' as const } });
  const withTwoWindows = () => {
    const { practiceId, actId } = appStore.getState().addArticlesToPractice(null, NORMA, [art('5'), art('7')]);
    const refs = ['5', '7'].map((n) => besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(art(n)) }));
    appStore.setState((st) => ({ practices: st.practices.map((p) => ({ ...p, beside: refs })) }));
    return { practiceId, refs };
  };

  it('lands on the table whatever windows were saved: no reader, no row folded, the desktop\'s row not drawn', async () => {
    withTwoWindows();
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(await screen.findByTestId('practice-phone-view')).toBeInTheDocument();
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(screen.queryByTestId('desktop-row')).toBeNull();
    expect(screen.queryByText(/Aperto accanto/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Apri accanto/ })).toHaveLength(2);
  });

  it('a decision opened from a link reads full screen, leaves the windows alone, and «Pratica» returns to the table', async () => {
    const { practiceId, refs } = withTwoWindows();
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    await screen.findByTestId('practice-phone-view');
    act(() => { appStore.getState().openDecisionTab(REF); });
    const reader = await screen.findByTestId('reading-full-screen');
    expect(reader).toHaveTextContent('n. 99999');
    expect(screen.queryByTestId('practice-phone-view')).toBeNull();
    expect(appStore.getState().practices.find((p) => p.id === practiceId)?.beside).toEqual(refs);

    fireEvent.click(screen.getByRole('button', { name: 'Pratica' }));
    expect(await screen.findByTestId('practice-phone-view')).toBeInTheDocument();
    expect(appStore.getState().phoneReader).toBeNull();
  });

  it('two windows beside on the desktop, then a phone width: the table, no row folded, «Apri accanto» on the rows', async () => {
    desktop = true;
    const { practiceId, refs } = withTwoWindows();
    appStore.getState().setRowOpen(`${practiceId}/${refs[0].kind === 'article' ? refs[0].actId : ''}/${refs[0].kind === 'article' ? refs[0].articleKey : ''}`, true);
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(await screen.findByTestId('desktop-row')).toBeInTheDocument();

    act(() => { desktop = false; listeners.forEach((fn) => fn({ matches: false })); });
    expect(await screen.findByTestId('practice-phone-view')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-row')).toBeNull();
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(screen.queryByText(/Aperto accanto/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Apri accanto/ })).toHaveLength(2);
    // the row the user had open is open in place, the windows are still saved
    expect(screen.getAllByTestId('reader')).toHaveLength(1);
    expect(appStore.getState().practices[0].beside).toEqual(refs);
  });

  it('a screen that widens closes the reader, and the desktop draws its windows', async () => {
    const { practiceId, refs } = withTwoWindows();
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    await screen.findByTestId('practice-phone-view');
    act(() => { appStore.getState().openPhoneReader(practiceId, refs[0]); });
    await screen.findByTestId('reading-full-screen');

    act(() => { desktop = true; listeners.forEach((fn) => fn({ matches: true })); });
    expect(await screen.findByTestId('desktop-row')).toBeInTheDocument();
    expect(appStore.getState().phoneReader).toBeNull();
    expect(screen.queryByTestId('reading-full-screen')).toBeNull();
    expect(appStore.getState().practices[0].beside).toEqual(refs);
  });
});
