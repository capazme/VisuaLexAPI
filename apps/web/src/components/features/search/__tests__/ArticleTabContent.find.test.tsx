import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { appStore } from '../../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../../utils/normaKeys';
import { fixtureText, ARTICLE_FIXTURES } from '../../../../utils/__fixtures__/articleTexts';
import { FakeHighlight } from '../../../../utils/__fixtures__/openFind';

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
const openFind = () => fireEvent.click(screen.getAllByRole('button', { name: 'Cerca nel testo' })[0]);
const drawn = (name = 'vlx-find') => registry.get(name)?.ranges.length ?? 0;

describe('ArticleTabContent — «Cerca nel testo»', () => {
  it('opens a box under the toolbar and finds a word typed without its accent', async () => {
    show(article({ article_text: ACCENTED.text }));
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    openFind();
    expect(screen.getByRole('search')).toBeInTheDocument();
    typeQuery('puo');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 di \d+$/));
    expect(drawn('vlx-find-current')).toBe(1);
  });

  it('finds the accented word typed with its accent too', async () => {
    show(article({ article_text: ACCENTED.text }));
    openFind();
    typeQuery('può');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 di \d+$/));
  });

  it('searches the article text only: not Brocardi, not «Giurisprudenza», not the toolbar', async () => {
    show(article({ article_text: ACCENTED.text }));
    // each of the three words is on the page, outside the text root
    expect(screen.getByTestId('brocardi')).toHaveTextContent('Nemo iudex');
    expect(screen.getByText('Giurisprudenza')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Allegato');
    openFind();
    for (const word of ['Nemo iudex', 'Giurisprudenza', 'Allegato']) {
      typeQuery(word);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
      expect(drawn()).toBe(0);
    }
  });

  it('does not find the loading placeholder', async () => {
    show(article({ article_text: '' }));
    expect(screen.getByText('Caricamento testo...')).toBeInTheDocument();
    openFind();
    typeQuery('caricamento');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nessun risultato'));
  });

  it('closes the box when the text goes away, and does not bring it back open', () => {
    const notYet: ArticleValidity = { state: 'not_yet', valid_from: null, valid_to: null, version_number: null, act_updated: null, request_in_window: true };
    const ui = (data: ArticleData) => <MemoryRouter><ArticleTabContent data={data} /></MemoryRouter>;
    const { rerender } = render(ui(article({ article_text: ACCENTED.text })));
    openFind();
    expect(screen.getByRole('search')).toBeInTheDocument();
    rerender(ui(article({ article_text: ACCENTED.text, validity: notYet })));
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    rerender(ui(article({ article_text: ACCENTED.text })));
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cerca nel testo' })[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('closing clears the highlights and returns focus to the button', async () => {
    show(article({ article_text: ACCENTED.text }));
    openFind();
    typeQuery('puo');
    await waitFor(() => expect(drawn('vlx-find-current')).toBe(1));
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(registry.has('vlx-find-current')).toBe(false);
    expect(registry.has('vlx-find')).toBe(false);
    expect(screen.getAllByRole('button', { name: 'Cerca nel testo' }).some((b) => b === document.activeElement)).toBe(true);
  });

  it('two tabs searching at once keep both sets of ranges', async () => {
    render(
      <MemoryRouter>
        <div data-testid="one"><ArticleTabContent data={article({ article_text: ACCENTED.text })} /></div>
        <div data-testid="two"><ArticleTabContent data={article({ article_text: ACCENTED.text })} /></div>
      </MemoryRouter>,
    );
    for (const id of ['one', 'two']) {
      fireEvent.click(within(screen.getByTestId(id)).getAllByRole('button', { name: 'Cerca nel testo' })[0]);
      fireEvent.change(within(screen.getByTestId(id)).getByRole('searchbox'), { target: { value: 'puo' } });
    }
    await waitFor(() => expect(drawn('vlx-find-current')).toBe(2));
    // closing one leaves the other's
    fireEvent.keyDown(within(screen.getByTestId('one')).getByRole('searchbox'), { key: 'Escape' });
    expect(drawn('vlx-find-current')).toBe(1);
  });

  it('leaves the other toolbar buttons where they were', () => {
    show(article());
    for (const title of ['Apri note', 'Gestisci evidenziazioni', 'Copia', 'Altre azioni', 'Aggiungi a norme rapide']) {
      expect(screen.getAllByTitle(title).length).toBeGreaterThan(0);
    }
  });
});
