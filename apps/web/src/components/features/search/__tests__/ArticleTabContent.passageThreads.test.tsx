import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleDiscussionPassageSummary, ArticleDiscussionThread } from '../../../../types';

const { listPassages, listDiscussions } = vi.hoisted(() => ({
  listPassages: vi.fn(),
  listDiscussions: vi.fn(),
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
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';
import { buildPassage, plainText } from '../../../../utils/threadPassages';

const ARTICLE_TEXT = 'Art. 1\n\nIl debitore paga il debito. Il creditore attende.';
const URN = 'urn:nir:stato:legge:1990-08-07;241~art1';
const QUOTE = 'paga il debito';
const START = plainText(ARTICLE_TEXT).indexOf(QUOTE);
const PASSAGE = buildPassage(plainText(ARTICLE_TEXT), START, QUOTE)!;

const articleData: ArticleData = {
  article_text: ARTICLE_TEXT,
  norma_data: {
    tipo_atto: 'legge',
    data: '1990-08-07',
    numero_atto: '241',
    numero_articolo: '1',
    urn: URN,
  },
  brocardi_info: null,
};

const passageSummary: ArticleDiscussionPassageSummary = {
  id: 'thread-passage-1',
  title: 'Chiarimento sul pagamento',
  passage: PASSAGE,
  articleUrn: URN,
  textHash: null,
  commentCount: 0,
  createdAt: '2026-09-28T11:00:00Z',
  user: { id: 'u2', username: 'luca' },
};

const passageThread: ArticleDiscussionThread = {
  ...passageSummary,
  normaKey: 'legge--241--1990-08-07--1',
  articleId: '1',
  version: 'vigente',
  body: 'Discussione sulla portata del pagamento.',
  updatedAt: '2026-09-28T11:00:00Z',
  voteCount: 0,
  userVoted: false,
  isOwner: false,
  comments: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  listDiscussions.mockResolvedValue({
    data: [passageThread],
    pagination: { page: 1, limit: 20, total: 1, pages: 1 },
  });
  appStore.setState({
    loadAnnotationsForArticle: vi.fn(),
    loadHighlightsForArticle: vi.fn(),
  });
});

describe('ArticleTabContent passage discussions', () => {
  it('shows one failed-load state, retries visibly, then opens the recovered passage discussion from its sign', async () => {
    const retry = deferred<ArticleDiscussionPassageSummary[]>();
    listPassages
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockReturnValueOnce(retry.promise);

    const { container } = render(
      <MemoryRouter>
        <ArticleTabContent data={articleData} />
      </MemoryRouter>,
    );

    const readerError = await screen.findByRole('alert');
    expect(readerError).toHaveTextContent('Impossibile caricare le discussioni sui passaggi.');
    expect(readerError).toHaveTextContent('I segni potrebbero non mostrarle.');
    expect(screen.queryByText(/Nessuna discussione ancora\./)).not.toBeInTheDocument();
    expect(container.querySelector('.vlx-sign[data-threads="1"]')).toBeNull();

    fireEvent.click(screen.getAllByTitle('Discussioni sull’articolo')[0]);
    const panel = await screen.findByRole('dialog', { name: 'Discussioni sull’articolo' });
    const panelError = await within(panel).findByRole('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(panel).queryByText(/Nessuna discussione ancora\./)).not.toBeInTheDocument();

    fireEvent.click(within(panelError).getByRole('button', { name: /riprova/i }));

    expect(await within(panel).findByRole('status')).toHaveTextContent('Aggiornamento discussioni sui passaggi…');
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Nessuna discussione ancora\./)).not.toBeInTheDocument();
    expect(listPassages).toHaveBeenCalledTimes(2);

    await act(async () => {
      retry.resolve([passageSummary]);
      await retry.promise;
    });

    const sign = await screen.findByRole('button', { name: '1 discussione in questo passo' });
    expect(within(panel).queryByRole('status')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Nessuna discussione ancora\./)).not.toBeInTheDocument();
    expect(container.querySelector('.vlx-sign[data-threads="1"]')).toBeInTheDocument();
    expect(within(panel).getByText('Chiarimento sul pagamento')).toBeInTheDocument();

    fireEvent.click(sign);
    const openThread = await screen.findByRole('button', { name: /apri discussione/i });
    fireEvent.click(openThread);

    expect(await within(panel).findByText('Discussione sulla portata del pagamento.')).toBeInTheDocument();
    expect(listDiscussions).toHaveBeenCalledOnce();
  });
});
