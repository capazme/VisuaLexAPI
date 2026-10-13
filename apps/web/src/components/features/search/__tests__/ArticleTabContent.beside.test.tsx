import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleValidity, NormaVisitata } from '../../../../types';

const { listPassages, listDiscussions, devMode } = vi.hoisted(() => ({ listPassages: vi.fn(), listDiscussions: vi.fn(), devMode: vi.fn() }));

vi.mock('../../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: listDiscussions,
    listPassages,
    create: vi.fn(), comment: vi.fn(), report: vi.fn(), voteThread: vi.fn(), voteComment: vi.fn(),
  },
}));
vi.mock('../../../../services/studiaService', () => ({ studiaService: { forArticle: () => Promise.resolve([]) } }));
vi.mock('../../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../../services/notificationService', () => ({ notificationService: { checkNorma: vi.fn().mockResolvedValue({ changed: false }) } }));
// «Chiedi a MERL-T» would be offered: the window must not draw it.
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../features/devMode/useDevMode', () => ({ useDevMode: () => devMode() }));
// The slots are named, so the test sees which are drawn.
vi.mock('../../../../plugins/PluginSlot', () => ({ PluginSlot: ({ slot }: { slot: string }) => <div data-testid={`slot-${slot}`} /> }));
vi.mock('../BrocardiDisplay', () => ({ BrocardiDisplay: () => <div data-testid="brocardi">Nemo iudex sine actore</div> }));

import { ArticleTabContent } from '../ArticleTabContent';
import { FindWindow } from '../FindWindow';
import { closeFindWindow } from '../../../../utils/findWindowControl';
import { findRootsFor } from '../../../../utils/findTargets';
import { appStore } from '../../../../store/useAppStore';
import { ARTICLE_FIXTURES, fixtureText } from '../../../../utils/__fixtures__/articleTexts';
import { FakeHighlight, wordOf } from '../../../../utils/__fixtures__/openFind';

const TEXT = fixtureText('nrm-cc-1284');
const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284',
};
const BROCARDI = { position: null, link: null, Brocardi: ['Nemo iudex sine actore'], Ratio: null, Spiegazione: null, Massime: null };
let PRACTICE = '';
const WINDOW = 'article:act-1:key';

const article = (over: Partial<ArticleData> = {}): ArticleData => ({ article_text: TEXT, norma_data: NORMA, brocardi_info: BROCARDI, ...over });

function show(variant: 'row' | 'beside', data: ArticleData = article(), onOpenStudyMode?: () => void) {
  // The article is on the practice's table: that is where the find window's targets come from.
  appStore.getState().addArticlesToPractice(PRACTICE, data.norma_data, [data]);
  return render(
    <MemoryRouter>
      <ArticleTabContent
        data={data}
        variant={variant}
        onOpenStudyMode={onOpenStudyMode}
        // A window reads under its own id and is found under its practice's.
        readingOrigin={variant === 'beside' ? { tabId: WINDOW, blockId: 'act-1' } : { tabId: PRACTICE, blockId: 'act-1' }}
        findHostId={variant === 'beside' ? PRACTICE : undefined}
      />
      <FindWindow />
    </MemoryRouter>,
  );
}

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let savedMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  vi.clearAllMocks();
  devMode.mockReturnValue(false);
  listDiscussions.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
  listPassages.mockResolvedValue([]);
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  savedMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // The find window's scopes read the practices; the window's practice is the active one.
  appStore.setState({ practices: [], activePracticeId: null });
  PRACTICE = appStore.getState().createPractice('Pratica');
  appStore.setState({
    loadAnnotationsForArticle: vi.fn(), loadHighlightsForArticle: vi.fn(),
    highlights: [], annotations: [], bookmarks: [], readingBackStack: [],
  });
});

afterEach(() => {
  act(() => closeFindWindow());
  window.matchMedia = savedMatchMedia;
  vi.unstubAllEnvs();
  delete g.CSS;
  delete g.Highlight;
});

/** The desktop row of the toolbar: the one with the notes button. */
const desktopRow = (container: HTMLElement) => container.querySelector('div.hidden.md\\:flex') as HTMLElement;
const labels = (row: HTMLElement) => [...row.querySelectorAll('button, a')].map((b) => b.getAttribute('aria-label') ?? b.getAttribute('title'));

describe('ArticleTabContent variant="beside" — the compact bar (T12)', () => {
  it('shows exactly notes, highlights, discussions, the magnifier and copy, and no «⋯»', () => {
    const { container } = show('beside');
    expect(labels(desktopRow(container))).toEqual(['Apri note', 'Gestisci evidenziazioni', 'Discussioni sull’articolo', 'Cerca nel testo', 'Copia']);
    expect(screen.queryByTitle('Altre azioni')).not.toBeInTheDocument();
  });

  it('the magnifier opens the find window on that text, scoped to the window\'s practice', async () => {
    const { container } = show('beside');
    const magnifier = () => within(desktopRow(container)).getByRole('button', { name: 'Cerca nel testo' });
    expect(magnifier()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(magnifier());
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(magnifier()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Questa pratica' })).toHaveAttribute('aria-pressed', 'true');
    // Registered under the practice, not under the window's own id.
    expect(findRootsFor(PRACTICE)).toHaveLength(1);
    expect(findRootsFor(WINDOW)).toHaveLength(0);
  });

  it('a past text keeps the rules of describeVersion: discussions off, no Brocardi', () => {
    const past: ArticleValidity = { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 3, act_updated: null, request_in_window: true };
    show('beside', article({ validity: past, norma_data: { ...NORMA, data_versione: '2005-06-01', versione: 'originale' } }));
    expect(screen.queryByText('Brocardi')).not.toBeInTheDocument();
    for (const button of screen.getAllByTitle(/Discussioni sull’articolo — /)) expect(button).toBeDisabled();
  });
});

describe('ArticleTabContent variant="beside" — what is folded and what is left out (§4.1)', () => {
  it('Brocardi is a closed section, opened by its heading', () => {
    show('beside');
    const toggle = screen.getByRole('button', { name: 'Brocardi' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('brocardi')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('brocardi')).toBeInTheDocument();
  });

  it('«Giurisprudenza» is closed, and comes after Brocardi', () => {
    show('beside');
    const caseLaw = screen.getByRole('button', { name: 'Giurisprudenza' });
    expect(caseLaw).toHaveAttribute('aria-expanded', 'false');
    const brocardi = screen.getByRole('button', { name: 'Brocardi' });
    expect(brocardi.compareDocumentPosition(caseLaw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no Studio, no Studia row, no «Chiedi a MERL-T», no graph rail; the viewing tracker stays', () => {
    const openStudy = vi.fn();
    show('beside', article(), openStudy);
    expect(screen.queryByTitle(/Modalità studio/)).not.toBeInTheDocument();
    expect(screen.queryByText(/scheda su questo articolo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nuova scheda/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Chiedi su questo articolo/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-article_sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('slot-article_content_after')).toBeInTheDocument();
    expect(openStudy).not.toHaveBeenCalled();
  });
});

describe('ArticleTabContent variant="row" — everything as today', () => {
  it('keeps the whole bar, Brocardi open under the text, Studio, the Studia row, the MERL-T entry and the rail, in the development mode', async () => {
    devMode.mockReturnValue(true);
    const { container } = show('row', article(), vi.fn());
    const desktop = labels(desktopRow(container));
    expect(desktop).toEqual(expect.arrayContaining(['Aggiungi a norme rapide', 'Apri note', 'Aggiungi a dossier', 'Altre azioni']));
    expect(screen.getByTestId('brocardi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brocardi' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Modalità studio')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/scheda su questo articolo/i)).toBeInTheDocument());
    expect(screen.getByText(/Chiedi su questo articolo/)).toBeInTheDocument();
    expect(screen.getByTestId('slot-article_sidebar')).toBeInTheDocument();
  });
});

// Spec D3/D4: the mode hides the graph rail and the entry that asks MERL-T; it leaves the Massimario's panel
// and the viewing tracker, which are content and collection for every reader.
describe('ArticleTabContent variant="row" — without the development mode', () => {
  it('draws no graph rail and no «Chiedi su questo articolo»', async () => {
    show('row', article(), vi.fn());
    await waitFor(() => expect(screen.getByText(/scheda su questo articolo/i)).toBeInTheDocument());
    expect(screen.queryByText(/Chiedi su questo articolo/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-article_sidebar')).not.toBeInTheDocument();
  });

  it('still draws the tracker, «Giurisprudenza» and the Massimario\'s slot', () => {
    show('row', article(), vi.fn());
    expect(screen.getByTestId('slot-article_content_after')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Giurisprudenza/ }));
    expect(screen.getByTestId('slot-article_case_law')).toBeInTheDocument();
  });
});

describe('ArticleTabContent variant="beside" — root rule 23, with the find window open on the text', () => {
  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))(
    '%s: the text root\'s text nodes spell article_text minus \\n, with matches drawn',
    async (_id, raw) => {
      const plain = raw.replace(/\n/g, '');
      const { container, unmount } = show('beside', article({ article_text: raw, brocardi_info: undefined }));
      fireEvent.click(within(desktopRow(container)).getByRole('button', { name: 'Cerca nel testo' }));
      fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nel testo' }), { target: { value: wordOf(plain) } });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 di \d+$/));
      const [root] = findRootsFor(PRACTICE);
      expect(root.element.textContent).toBe(plain);
      expect((registry.get('vlx-find-current')?.ranges.length ?? 0) + (registry.get('vlx-find')?.ranges.length ?? 0)).toBeGreaterThan(0);
      unmount();
    },
  );
});
