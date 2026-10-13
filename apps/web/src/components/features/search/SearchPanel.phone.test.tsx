import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./ReadingBackControl', () => ({ ReadingBackControl: () => null }));
// The practices' surfaces: the phone's table and its full-screen reader draw these.
vi.mock('./ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('./TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../practice/ReadingRow', () => ({ ReadingRow: () => <div data-testid="desktop-row" /> }));
vi.mock('../practice/PracticeBar', () => ({ PracticeBar: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: ({ reference }: { reference: { numero: number } }) => <div data-testid="decision-reader">n. {reference.numero}</div>,
}));

import { appStore } from '../../../store/useAppStore';
import { besideRefFor, practiceArticleKey } from '../../../utils/practice';
import { SearchPanel } from './SearchPanel';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };

describe('SearchPanel on a phone — with the practices (spec §8, P5)', () => {
  // A controllable viewport: `useIsDesktop` listens to the media query's change.
  let desktop = false;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  let savedMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
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
      practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
      practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null, pendingDecision: null,
      structureWindow: { blockId: null, position: { x: 0, y: 0 } },
    });
  });
  afterEach(() => {
    window.matchMedia = savedMatchMedia;
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
    act(() => { appStore.getState().openDecision(REF, { fromLink: true }); });
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
