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
let PRACTICE = '';
const WINDOW = 'article:act-1:key';

const article = (over: Partial<ArticleData> = {}): ArticleData => ({ article_text: TEXT, norma_data: NORMA, ...over });
// An answer from before D-078, as a practice saved in the browser may still hand it over (no Brocardi text here)
const BROCARDI = { position: null, link: null, Brocardi: ['Nemo iudex sine actore'], Ratio: 'La ratio.', Spiegazione: 'La spiegazione.', Massime: ['Una massima.'] };
const legacy = (over: Partial<ArticleData> = {}) => ({ ...article(over), brocardi_info: BROCARDI }) as unknown as ArticleData;
const brocardiLeft = () => screen.queryByText(/Brocardi|Nemo iudex|La ratio|La spiegazione|Una massima|Massime/);

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
  // «Giurisprudenza» remembers it was opened, per host, for the session
  window.sessionStorage.clear();
  window.matchMedia = savedMatchMedia;
  vi.unstubAllEnvs();
  delete g.CSS;
  delete g.Highlight;
});

/** The desktop row of the toolbar: the one with the notes button. */
const desktopRow = (container: HTMLElement) => container.querySelector('div.hidden.md\\:flex') as HTMLElement;
const labels = (row: HTMLElement) => [...row.querySelectorAll('button, a')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
/** Opens a row's «⋯» (R3) and returns its menu. */
function openMore(row: HTMLElement) {
  const trigger = within(row).getByRole('button', { name: 'Altre azioni sull’articolo' });
  fireEvent.click(trigger);
  return document.getElementById(trigger.getAttribute('aria-controls')!)!;
}
const entries = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((item) => item.querySelector('span > span')?.textContent ?? item.textContent);

describe('ArticleTabContent variant="beside" — the compact bar (T12)', () => {
  it('shows exactly notes, highlights and their colour in words, and behind «⋯» discussions, the find window and copy', () => {
    const { container } = show('beside');
    expect(labels(desktopRow(container))).toEqual(['Note', 'Evidenziazioni', 'Colore: giallo (nuove evidenziazioni)', 'Altre azioni sull’articolo']);
    expect(entries(openMore(desktopRow(container)))).toEqual(['Glosse sull’articolo', 'Cerca nel testo', 'Copia']);
  });

  it('«Cerca nel testo» opens the find window on that text, scoped to the window\'s practice', async () => {
    const { container } = show('beside');
    fireEvent.click(within(openMore(desktopRow(container))).getByRole('menuitem', { name: 'Cerca nel testo' }));
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(entries(openMore(desktopRow(container)))).toContain('Chiudi la ricerca nel testo');
    expect(screen.getByRole('button', { name: 'Questa pratica' })).toHaveAttribute('aria-pressed', 'true');
    // Registered under the practice, not under the window's own id.
    expect(findRootsFor(PRACTICE)).toHaveLength(1);
    expect(findRootsFor(WINDOW)).toHaveLength(0);
  });

  it('a past text keeps the rules of describeVersion: discussions off', () => {
    const past: ArticleValidity = { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 3, act_updated: null, request_in_window: true };
    const { container } = show('beside', article({ validity: past, norma_data: { ...NORMA, data_versione: '2005-06-01', versione: 'originale' } }));
    expect(within(openMore(desktopRow(container))).getByRole('menuitem', { name: /^Glosse sull’articolo/ })).toBeDisabled();
  });
});

describe('ArticleTabContent variant="beside" — what is folded and what is left out (§4.1)', () => {
  it('folds nothing of Brocardi, even from an answer that still carries it (D-078)', () => {
    show('beside', legacy());
    expect(screen.queryByRole('button', { name: 'Brocardi' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
    expect(brocardiLeft()).toBeNull();
  });

  it('«Giurisprudenza» is closed', () => {
    show('beside');
    expect(screen.getByRole('button', { name: 'Giurisprudenza' })).toHaveAttribute('aria-expanded', 'false');
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
  it('keeps the whole bar, Studio, the Studia row, the MERL-T entry and the rail, in the development mode', async () => {
    devMode.mockReturnValue(true);
    const { container } = show('row', article(), vi.fn());
    const desktop = labels(desktopRow(container));
    expect(desktop).toEqual(expect.arrayContaining(['Note', 'Al dossier', 'Altre azioni sull’articolo']));
    expect(entries(openMore(desktopRow(container)))).toEqual(expect.arrayContaining(['Aggiungi alle norme rapide', 'Esporta…', 'Testo alla data…']));
    // Study Mode: the act's «Studio» on a computer; the phone's «⋯» has it too.
    const phone = container.querySelector('div.flex.md\\:hidden') as HTMLElement;
    expect(entries(openMore(phone))).toContain('Modalità studio');
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

  it('shows nothing of Brocardi under the text, even from an answer that still carries it (D-078)', () => {
    show('row', legacy(), vi.fn());
    fireEvent.click(screen.getByRole('button', { name: /Giurisprudenza/ }));
    expect(brocardiLeft()).toBeNull();
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
      const { container, unmount } = show('beside', article({ article_text: raw }));
      fireEvent.click(within(openMore(desktopRow(container))).getByRole('menuitem', { name: 'Cerca nel testo' }));
      fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nel testo' }), { target: { value: wordOf(plain) } });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 di \d+$/));
      const [root] = findRootsFor(PRACTICE);
      expect(root.element.textContent).toBe(plain);
      expect((registry.get('vlx-find-current')?.ranges.length ?? 0) + (registry.get('vlx-find')?.ranges.length ?? 0)).toBeGreaterThan(0);
      unmount();
    },
  );
});
