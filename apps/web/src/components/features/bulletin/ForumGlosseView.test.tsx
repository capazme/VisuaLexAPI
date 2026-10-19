import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ForumGlosseView } from './ForumGlosseView';
import { glossaDestination, glossaTargetLabel } from './glossaLinks';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import { appStore } from '../../../store/useAppStore';
import type { GlossaFeedItem } from '../../../types';

vi.mock('../../../services/articleDiscussionService', () => ({
  articleDiscussionService: { feed: vi.fn() },
}));

const feedMock = vi.mocked(articleDiscussionService.feed);
const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';

function item(over: Partial<GlossaFeedItem> = {}): GlossaFeedItem {
  return {
    id: 'g1', title: 'Sul danno ingiusto', excerpt: 'Una domanda sul danno.', normaKey: 'codice-civile--2043', articleId: '2043',
    articleLabel: '2043', version: null, articleUrn: URN, target: { kind: 'article' }, decisionLabel: null,
    passage: { quote: 'danno ingiusto', withheld: false }, user: { id: 'u1', username: 'mario' }, voteCount: 3,
    userVoted: false, commentCount: 2, createdAt: '2026-10-01T08:00:00.000Z', lastActivityAt: '2026-10-02T08:00:00.000Z',
    isOwner: false, ...over,
  };
}

function answer(items: GlossaFeedItem[], page = 1, pages = 1) {
  return { data: items, pagination: { page, limit: 20, total: items.length, pages } };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/forum']}>
      <Routes>
        <Route path="/forum" element={<ForumGlosseView />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('glossa links', () => {
  it('opens an article from its URN and names it by the convention', () => {
    const destination = glossaDestination(item());
    expect(destination?.kind).toBe('article');
    expect(glossaTargetLabel(item())).toBe('art. 2043 c.c.');
  });

  it('opens a decision by its address and names it with the server’s label', () => {
    const onDecision = item({ target: { kind: 'decision', key: 'cassazione:civile:31310:2024' }, articleUrn: null, articleId: '', decisionLabel: 'Cass. civ., n. 31310/2024' });
    expect(glossaDestination(onDecision)).toEqual({ kind: 'decision', path: '/sentenze/cassazione-civile/31310/2024' });
    expect(glossaTargetLabel(onDecision)).toBe('Cass. civ., n. 31310/2024');
  });

  it('cannot open an article glossa that recorded no URN', () => {
    expect(glossaDestination(item({ articleUrn: null }))).toBeNull();
    expect(glossaTargetLabel(item({ articleUrn: null }))).toBe('art. 2043');
  });
});

describe('ForumGlosseView', () => {
  beforeEach(() => {
    feedMock.mockReset();
  });

  it('lists the glosse and asks again with the order chosen', async () => {
    feedMock.mockResolvedValue(answer([item()]));
    renderView();
    expect(await screen.findByText('Sul danno ingiusto')).toBeInTheDocument();
    expect(screen.getByText('«danno ingiusto»')).toBeInTheDocument();
    expect(screen.getByText(/3 voti · 2 risposte/)).toBeInTheDocument();
    expect(feedMock).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, kind: undefined });

    fireEvent.change(screen.getByLabelText('Ordina'), { target: { value: 'unanswered' } });
    await waitFor(() => expect(feedMock).toHaveBeenLastCalledWith({ sort: 'unanswered', page: 1, kind: undefined }));
    fireEvent.change(screen.getByLabelText('Mostra'), { target: { value: 'decision' } });
    await waitFor(() => expect(feedMock).toHaveBeenLastCalledWith({ sort: 'unanswered', page: 1, kind: 'decision' }));
  });

  it('narrows to a court’s decisions, and back to the articles without a court', async () => {
    feedMock.mockResolvedValue(answer([item()]));
    renderView();
    await screen.findByText('Sul danno ingiusto');

    fireEvent.change(screen.getByLabelText('Corte'), { target: { value: 'cassazione:civile' } });
    await waitFor(() => expect(feedMock).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, kind: 'decision', court: 'cassazione:civile' }));
    expect(screen.getByLabelText('Mostra')).toHaveValue('decision');

    // the server refuses a court with the articles: choosing them drops the court
    fireEvent.change(screen.getByLabelText('Mostra'), { target: { value: 'article' } });
    await waitFor(() => expect(feedMock).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, kind: 'article' }));
    expect(screen.getByLabelText('Corte')).toHaveValue('');
    expect(feedMock.mock.lastCall?.[0]?.court).toBeUndefined();
  });

  it('asks for the reader’s own glosse only while «Solo le mie glosse» is ticked', async () => {
    feedMock.mockResolvedValue(answer([item({ isOwner: true })], 1, 2));
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Successive' }));
    await waitFor(() => expect(feedMock).toHaveBeenLastCalledWith({ sort: 'recent', page: 2 }));

    fireEvent.click(screen.getByLabelText('Solo le mie glosse'));
    // a new filter starts again from the first page
    await waitFor(() => expect(feedMock).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, mine: true }));
    fireEvent.click(screen.getByLabelText('Solo le mie glosse'));
    await waitFor(() => expect(feedMock.mock.lastCall?.[0]?.mine).toBeUndefined());
  });

  it('says a decision’s quotation is withheld', async () => {
    feedMock.mockResolvedValue(answer([item({
      target: { kind: 'decision', key: 'cassazione:civile:31310:2024' }, articleUrn: null, decisionLabel: 'Cass. civ., n. 31310/2024',
      passage: { quote: null, withheld: true },
    })]));
    renderView();
    expect(await screen.findByText('Il passo citato si legge nel testo della decisione.')).toBeInTheDocument();
  });

  it('opens an article in the reader and a decision at its address', async () => {
    appStore.setState({ searchTrigger: null });
    feedMock.mockResolvedValue(answer([item()]));
    const { unmount } = renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Apri nel testo' }));
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '2043' });
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    unmount();

    feedMock.mockResolvedValue(answer([item({ target: { kind: 'decision', key: 'cassazione:civile:31310:2024' }, articleUrn: null })]));
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Apri nel testo' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/sentenze/cassazione-civile/31310/2024');
  });

  it('pages and retries after a failure', async () => {
    feedMock.mockRejectedValueOnce(new Error('Rete non raggiungibile'));
    renderView();
    expect(await screen.findByRole('alert')).toHaveTextContent('Rete non raggiungibile');
    feedMock.mockResolvedValue(answer([item()], 1, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Successive' }));
    await waitFor(() => expect(feedMock).toHaveBeenLastCalledWith({ sort: 'recent', page: 2, kind: undefined }));
  });
});
