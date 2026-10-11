import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleValidity, Highlight, NormaVisitata } from '../../../../types';

const { listPassages, listDiscussions, checkNorma } = vi.hoisted(() => ({
  listPassages: vi.fn(),
  listDiscussions: vi.fn(),
  checkNorma: vi.fn(),
}));

vi.mock('../../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: listDiscussions,
    listPassages,
    create: vi.fn(),
    comment: vi.fn(),
    report: vi.fn(),
    voteThread: vi.fn(),
    voteComment: vi.fn(),
  },
}));
vi.mock('../../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../../services/notificationService', () => ({ notificationService: { checkNorma } }));
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
// Brocardi's section shows real words: the scope test searches one.
vi.mock('../BrocardiDisplay', () => ({ BrocardiDisplay: () => <div data-testid="brocardi">Nemo iudex sine actore</div> }));

import { ArticleTabContent } from '../ArticleTabContent';
import { FindWindow } from '../FindWindow';
import { closeFindWindow } from '../../../../utils/findWindowControl';
import { appStore } from '../../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../../utils/normaKeys';
import { fixtureText, ARTICLE_FIXTURES } from '../../../../utils/__fixtures__/articleTexts';
import { FakeHighlight } from '../../../../utils/__fixtures__/openFind';
import { findRootsFor } from '../../../../utils/findTargets';
import { findTargetsInScope } from '../../../../utils/findScope';

const TEXT = fixtureText('nrm-cc-1284');
const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284',
};
const BROCARDI = { position: null, link: null, Brocardi: ['Nemo iudex sine actore'], Ratio: null, Spiegazione: null, Massime: null };


function article(over: Partial<ArticleData> = {}): ArticleData {
  return { article_text: TEXT, norma_data: NORMA, brocardi_info: BROCARDI, ...over };
}

function show(data: ArticleData) {
  return render(
    <MemoryRouter>
      <ArticleTabContent data={data} />
    </MemoryRouter>,
  );
}

const highlight: Highlight = {
  id: 'h1',
  normaKey: buildItemKey(NORMA),
  articleId: uniqueArticleIdFromNorma(NORMA),
  rangeSerialized: '',
  text: 'saggio degli interessi legali',
  color: 'yellow',
  startOffset: TEXT.replace(/\n/g, '').indexOf('saggio degli interessi legali'),
};

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;

afterEach(() => {
  delete g.CSS;
  delete g.Highlight;
});

beforeEach(() => {
  vi.clearAllMocks();
  listDiscussions.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
  listPassages.mockResolvedValue([]);
  checkNorma.mockResolvedValue({ changed: false });
  registry = new Map();
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  appStore.setState({
    loadAnnotationsForArticle: vi.fn(),
    loadHighlightsForArticle: vi.fn(),
    highlights: [highlight],
    annotations: [],
    bookmarks: [],
  });
});


// A text with a word that carries an accent, and the same word as it is typed without one.
const ACCENTED = ARTICLE_FIXTURES.find((f) => f.text.includes('può'))!;

const typeQuery = (value: string) => fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nel testo' }), { target: { value } });
const magnifier = () => screen.getAllByRole('button', { name: 'Cerca nel testo' })[0];
const drawn = (name = 'vlx-find') => registry.get(name)?.ranges.length ?? 0;

/** The article in a workspace tab, with the one find window mounted beside it. */
function showInTab(data: ArticleData) {
  const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA, [data]);
  const view = render(
    <MemoryRouter>
      <ArticleTabContent data={data} readingOrigin={{ tabId, blockId: 'b' }} />
      <FindWindow />
    </MemoryRouter>,
  );
  return { tabId, ...view };
}

describe('ArticleTabContent — the magnifier opens the find window', () => {
  afterEach(() => {
    act(() => closeFindWindow());
    appStore.setState({ workspaceTabs: [] });
  });

  it('opens the window, not a box under the toolbar, and finds a word typed without its accent', async () => {
    showInTab(article({ article_text: ACCENTED.text }));
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    fireEvent.click(magnifier());
    const window_ = screen.getByRole('search');
    expect(window_.closest('.glass-toolbar')).toBeNull();
    expect(magnifier()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Questa scheda' })).toHaveAttribute('aria-pressed', 'true');
    typeQuery('puo');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 di \d+$/));
    expect(drawn('vlx-find-current')).toBe(1);
  });

  it('finds the accented word typed with its accent too', async () => {
    showInTab(article({ article_text: ACCENTED.text }));
    fireEvent.click(magnifier());
    typeQuery('può');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 di \d+$/));
  });

  it('searches the article text only: not Brocardi, not «Giurisprudenza», not the toolbar', async () => {
    showInTab(article({ article_text: ACCENTED.text }));
    // each of the three words is on the page, outside the text root
    expect(screen.getByTestId('brocardi')).toHaveTextContent('Nemo iudex');
    expect(screen.getByText('Giurisprudenza')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Allegato');
    fireEvent.click(magnifier());
    for (const word of ['Nemo iudex', 'Giurisprudenza', 'Allegato']) {
      typeQuery(word);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
      expect(drawn()).toBe(0);
    }
  });

  it('does not find the loading placeholder', async () => {
    showInTab(article({ article_text: '' }));
    expect(screen.getByText('Caricamento testo...')).toBeInTheDocument();
    fireEvent.click(magnifier());
    typeQuery('caricamento');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
  });

  it('draws no magnifier while the text is not shown', () => {
    const notYet: ArticleValidity = { state: 'not_yet', valid_from: null, valid_to: null, version_number: null, act_updated: null, request_in_window: true };
    showInTab(article({ article_text: ACCENTED.text, validity: notYet }));
    expect(screen.queryByRole('button', { name: 'Cerca nel testo' })).not.toBeInTheDocument();
  });

  it('the magnifier again closes it, clearing the highlights and returning focus to the button', async () => {
    showInTab(article({ article_text: ACCENTED.text }));
    fireEvent.click(magnifier());
    typeQuery('puo');
    await waitFor(() => expect(drawn('vlx-find-current')).toBe(1));
    fireEvent.click(magnifier());
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(registry.has('vlx-find-current')).toBe(false);
    expect(magnifier()).toHaveAttribute('aria-pressed', 'false');
  });

  it('Esc closes it and gives the focus back to the magnifier that opened it', async () => {
    showInTab(article({ article_text: ACCENTED.text }));
    const button = magnifier();
    fireEvent.click(button);
    typeQuery('puo');
    await waitFor(() => expect(drawn('vlx-find-current')).toBe(1));
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(registry.has('vlx-find-current')).toBe(false);
    expect(button).toHaveFocus();
  });

  it('leaves the other toolbar buttons where they were', () => {
    show(article());
    for (const title of ['Apri note', 'Gestisci evidenziazioni', 'Copia', 'Altre azioni', 'Aggiungi a norme rapide']) {
      expect(screen.getAllByTitle(title).length).toBeGreaterThan(0);
    }
  });
});

describe('ArticleTabContent — the find window\'s text root', () => {
  const notYet: ArticleValidity = { state: 'not_yet', valid_from: null, valid_to: null, version_number: null, act_updated: null, request_in_window: true };

  it('registers its text root under the key the scope computes for the article in its tab', () => {
    const data = article();
    const tabId = appStore.getState().addWorkspaceTab('Codice civile', NORMA, [data]);
    const { unmount } = render(
      <MemoryRouter>
        <ArticleTabContent data={data} readingOrigin={{ tabId, blockId: 'b' }} />
      </MemoryRouter>,
    );

    const roots = findRootsFor(tabId);
    const [target] = findTargetsInScope(appStore.getState(), 'all', null).filter((t) => t.tabId === tabId);
    expect(roots).toHaveLength(1);
    expect(roots[0].targetKey).toBe(target.targetKey);
    expect(roots[0].element.textContent?.replace(/\s+/g, '')).toBe(TEXT.replace(/\s+/g, ''));
    unmount();
    expect(findRootsFor(tabId)).toHaveLength(0);
    appStore.getState().removeTab(tabId);
  });

  it('registers nothing while its text is not shown, and registers the text once it is', () => {
    const ui = (data: ArticleData) => (
      <MemoryRouter>
        <ArticleTabContent data={data} tabId="tab-x" />
      </MemoryRouter>
    );
    const { rerender, unmount } = render(ui(article({ validity: notYet })));
    expect(findRootsFor('tab-x')).toHaveLength(0);
    rerender(ui(article()));
    expect(findRootsFor('tab-x')).toHaveLength(1);
    unmount();
  });

  it('registers nothing outside a tab', () => {
    const { unmount } = show(article());
    expect(findRootsFor()).toHaveLength(0);
    unmount();
  });
});
