import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ desktop: true }));

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => env.desktop, isDesktopViewport: () => env.desktop }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn() }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../search/ArticleTabContent', () => ({
  ArticleTabContent: ({ data, variant = 'row', onCrossReferenceNavigate }: {
    data: { norma_data: { numero_articolo: string } };
    variant?: string;
    onCrossReferenceNavigate?: (article: string, normaData: unknown) => void;
  }) => (
    <div data-testid="reader" data-variant={variant}>
      art. {data.norma_data.numero_articolo}
      <button type="button" onClick={() => onCrossReferenceNavigate?.('7', data.norma_data)}>Citazione</button>
    </div>
  ),
}));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: ({ reference, hostId }: { reference: { numero: number }; hostId: string }) => (
    <div data-testid="decision-reader" data-host={hostId}>n. {reference.numero}</div>
  ),
}));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => <div data-testid="topic-list" /> }));

import { appStore } from '../../../store/useAppStore';
import { L24, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { besideRefFor, practiceArticleKey } from '../../../utils/practice';
import { PracticeTable } from './PracticeTable';
import { ReadingRow } from './ReadingRow';

const s = () => appStore.getState();
const REF_A = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 11111, anno: 2020 };
const REF_B = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 22222, anno: 2021 };

const row = () => <ReadingRow onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;
const table = () => <PracticeTable onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;
const windows = () => screen.queryAllByTestId('reading-window');

/** One practice: art. 5 and 7 of l. 24/2017, both rows closed. */
function setup() {
  const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5'), article(L24, '7')]);
  for (const key of Object.keys(s().practiceRows)) s().setRowOpen(key, false);
  return { practiceId, actId };
}

beforeEach(() => {
  env.desktop = true;
  // jsdom measures nothing: the row starts from the viewport's width, wide enough for three columns.
  window.innerWidth = 1500;
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    readingBackStack: [], workspaceTabs: [], windowFocusRequest: null, phoneReader: null,
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** The row of an article, found by its accessible name. */
const articleRow = (n: string) => screen.getByRole('button', { name: new RegExp(`(Espandi|Comprimi|Vai alla finestra su) .*art\\. ${n}`) }).closest('[data-practice-row]') as HTMLElement;

describe('«Apri accanto» on an article row (spec §4.2, T5)', () => {
  it('opens the window and folds the row, which says so; closing the window gives the row back as it was', () => {
    setup();
    // Open art. 5's row.
    render(row());
    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /Espandi/ }));
    expect(screen.getAllByTestId('reader').map((r) => r.getAttribute('data-variant'))).toEqual(['row']);

    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /^Apri accanto/ }));
    expect(windows()).toHaveLength(1);
    // One subject, one mounted reading surface: the window's, not the row's.
    expect(screen.getAllByTestId('reader').map((r) => r.getAttribute('data-variant'))).toEqual(['beside']);
    expect(within(articleRow('5')).getByText(/Aperto accanto/)).toBeInTheDocument();
    // The folded header does not claim to expand: it goes to the window.
    const header = within(articleRow('5')).getByRole('button', { name: /^Vai alla finestra su/ });
    expect(header).not.toHaveAttribute('aria-expanded');
    expect(within(articleRow('5')).queryByRole('button', { name: /^(Espandi|Comprimi)/ })).not.toBeInTheDocument();
    expect(within(articleRow('5')).queryByRole('button', { name: /^Apri accanto/ })).not.toBeInTheDocument();
    // The other row still offers it.
    expect(within(articleRow('7')).getByRole('button', { name: /^Apri accanto/ })).toBeInTheDocument();

    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /^Chiudi la finestra su/ }));
    expect(windows()).toHaveLength(0);
    expect(screen.getAllByTestId('reader').map((r) => r.getAttribute('data-variant'))).toEqual(['row']);
  });

  it('the header of a folded row asks the window to take focus', () => {
    setup();
    render(row());
    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /^Apri accanto/ }));
    const window_ = windows()[0];
    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /^Vai alla finestra su/ }));
    expect(window_).toHaveFocus();
    expect(s().windowFocusRequest).toBeNull();
  });

  it('a third window replaces the oldest; its subject stays in the table, its row unfolded', () => {
    setup();
    s().openDecision(REF_A, { open: false });
    render(row());
    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /^Apri accanto/ }));
    fireEvent.click(within(articleRow('7')).getByRole('button', { name: /^Apri accanto/ }));
    expect(windows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^Apri accanto Cass/ }));
    expect(windows()).toHaveLength(2);
    expect(within(articleRow('5')).getByRole('button', { name: /^Apri accanto/ })).toBeInTheDocument();
    expect(s().practices[0].acts[0].articles).toHaveLength(2);
  });
});

describe('«Apri accanto» on a decision row', () => {
  it('opens the decision window and folds the row', () => {
    setup();
    s().openDecision(REF_B, { open: false });
    render(row());
    fireEvent.click(screen.getByRole('button', { name: /^Apri accanto Cass/ }));
    expect(windows()).toHaveLength(1);
    expect(screen.getByTestId('decision-reader')).toHaveAttribute('data-host', s().practices[0].beside[0].id);
    expect(screen.getByText(/Aperto accanto/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Chiudi la finestra su Cass/ }));
    expect(windows()).toHaveLength(0);
    expect(s().practices[0].decisions).toHaveLength(1);
  });
});

describe('a norm cited in a window', () => {
  it('the window asks the search panel\'s handler with its own id, to open the cited article beside it', () => {
    const { practiceId } = setup();
    const onCross = vi.fn();
    render(<ReadingRow onViewPdf={vi.fn()} onCrossReference={onCross} streaming={null} />);
    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /^Apri accanto/ }));
    const asker = s().practices.find((p) => p.id === practiceId)!.beside[0].id;
    fireEvent.click(within(windows()[0]).getByRole('button', { name: 'Citazione' }));
    // The window asks the search panel's handler with its own id.
    // (the citing article's norma, and the window that asks)
    expect(onCross).toHaveBeenCalledWith('7', expect.objectContaining({ numero_articolo: '5' }), asker);
  });
});

describe('on a phone', () => {
  it('draws «Apri accanto» for the full-screen reader and folds no row, whatever windows were saved', () => {
    env.desktop = false;
    const { practiceId, actId } = setup();
    const a = s().practices[0].acts[0].articles[0];
    const ref = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(a) });
    // A real window, on a subject the practice holds: on a desktop its row would fold.
    s().openBeside(practiceId, ref);
    expect(s().practices[0].beside).toHaveLength(1);
    render(table());
    expect(screen.queryByText(/Aperto accanto/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Espandi/ })).toHaveLength(2);
    // It opens the phone's reader on the subject and leaves the desktop's windows as they were (T19).
    fireEvent.click(within(articleRow('5')).getByRole('button', { name: /^Apri accanto/ }));
    expect(s().phoneReader).toEqual({ practiceId, ref });
    expect(s().practices[0].beside).toEqual([ref]);
  });
});
