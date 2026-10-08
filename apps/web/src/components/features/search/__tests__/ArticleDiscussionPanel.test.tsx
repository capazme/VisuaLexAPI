import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ArticleDiscussionPanel } from '../ArticleDiscussionPanel';
import { articleDiscussionService } from '../../../../services/articleDiscussionService';
import type { ArticleDiscussionThread, ThreadPassage } from '../../../../types';

const authState = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('../../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: authState.isAdmin }) }));

vi.mock('../../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: vi.fn(),
    create: vi.fn(),
    comment: vi.fn(),
    report: vi.fn(),
    voteThread: vi.fn(),
    voteComment: vi.fn(),
    setPassageReleased: vi.fn(),
  },
}));

describe('ArticleDiscussionPanel', () => {
  const dummyAnchor = { normaKey: 'k1', articleId: '1453', articleLabel: '1453' };

  const dummyThread: ArticleDiscussionThread = {
    id: 'thread-1',
    normaKey: 'k1',
    articleId: '1453',
    version: 'v1',
    title: 'Titolo discussione',
    body: 'Testo della discussione generale',
    passage: null,
    articleUrn: 'urn:nir:stato:legge:1942;262~art1453',
    textHash: 'hash-1',
    target: { kind: 'article' },
    passageReleased: false,
    voteCount: 3,
    userVoted: false,
    isOwner: false,
    createdAt: '2026-09-28T10:00:00Z',
    updatedAt: '2026-09-28T10:00:00Z',
    user: { id: 'u1', username: 'marta' },
    comments: [],
  };

  const passageSample: ThreadPassage = {
    quote: 'risarcimento del danno',
    start: 50,
    prefix: 'in ogni caso il ',
    suffix: '.',
  };

  const dummyPassageThread: ArticleDiscussionThread = {
    id: 'thread-p',
    normaKey: 'k1',
    articleId: '1453',
    version: 'v1',
    title: 'Discussione sul risarcimento',
    body: 'Commento sul passo',
    passage: passageSample,
    articleUrn: 'urn:nir:stato:legge:1942;262~art1453',
    textHash: 'hash-orig',
    target: { kind: 'article' },
    passageReleased: false,
    voteCount: 1,
    userVoted: false,
    isOwner: false,
    createdAt: '2026-09-28T11:00:00Z',
    updatedAt: '2026-09-28T11:00:00Z',
    user: { id: 'u2', username: 'luca' },
    comments: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAdmin = false;
    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [dummyThread],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('without a draft, a missing title blocks submit, and a valid submit sends { articleUrn, textHash }', async () => {
    const onThreadCreated = vi.fn();
    render(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        articleUrn="urn:nir:stato:legge:1942;262~art1453"
        textHash="hash-current"
        onThreadCreated={onThreadCreated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Titolo discussione')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /nuova discussione/i }));
    const titleInput = screen.getByPlaceholderText('Titolo della discussione');
    const bodyInput = screen.getByPlaceholderText(/condividi una domanda/i);

    expect(titleInput).toBeRequired();

    // Fill valid title and body
    fireEvent.change(titleInput, { target: { value: 'Nuovo titolo' } });
    fireEvent.change(bodyInput, { target: { value: 'Nuovo corpo del messaggio' } });

    const newCreatedThread: ArticleDiscussionThread = {
      ...dummyThread,
      id: 'thread-new',
      title: 'Nuovo titolo',
      body: 'Nuovo corpo del messaggio',
    };
    vi.mocked(articleDiscussionService.create).mockResolvedValue(newCreatedThread);

    fireEvent.click(screen.getByRole('button', { name: /pubblica/i }));

    await waitFor(() => {
      expect(articleDiscussionService.create).toHaveBeenCalledWith(
        dummyAnchor,
        'Nuovo titolo',
        'Nuovo corpo del messaggio',
        {
          passage: undefined,
          articleUrn: 'urn:nir:stato:legge:1942;262~art1453',
          textHash: 'hash-current',
        }
      );
    });

    expect(onThreadCreated).toHaveBeenCalledWith(newCreatedThread);
  });

  it('with a draft, the composer shows "Discussione sul passo" and the quotation, title is optional, and submitting calls create with { passage, articleUrn, textHash }', async () => {
    const onDraftConsumed = vi.fn();
    const onThreadCreated = vi.fn();
    const onFocusThread = vi.fn();

    const createdPassageThread: ArticleDiscussionThread = {
      ...dummyPassageThread,
      id: 'thread-created-draft',
      title: '',
      body: 'Osservazione su questo specifico passo',
    };
    vi.mocked(articleDiscussionService.create).mockResolvedValue(createdPassageThread);

    render(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        articleUrn="urn:nir:stato:legge:1942;262~art1453"
        textHash="hash-current"
        draft={{ passage: passageSample }}
        onDraftConsumed={onDraftConsumed}
        onThreadCreated={onThreadCreated}
        onFocusThread={onFocusThread}
      />
    );

    // Composer opens automatically when draft is present
    expect(screen.getByText('Discussione sul passo')).toBeInTheDocument();
    expect(screen.getByText(/«risarcimento del danno»/)).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText('Titolo (facoltativo)');
    expect(titleInput).not.toBeRequired();

    const bodyInput = screen.getByPlaceholderText(/condividi una domanda/i);
    fireEvent.change(bodyInput, { target: { value: 'Osservazione su questo specifico passo' } });

    fireEvent.click(screen.getByRole('button', { name: /pubblica/i }));

    await waitFor(() => {
      expect(articleDiscussionService.create).toHaveBeenCalledWith(
        dummyAnchor,
        '',
        'Osservazione su questo specifico passo',
        {
          passage: passageSample,
          articleUrn: 'urn:nir:stato:legge:1942;262~art1453',
          textHash: 'hash-current',
        }
      );
    });

    expect(onDraftConsumed).toHaveBeenCalled();
    expect(onThreadCreated).toHaveBeenCalledWith(createdPassageThread);
    expect(onFocusThread).toHaveBeenCalledWith('thread-created-draft');
  });

  it('shows passage-load failure separately from an empty discussion result and allows retry', async () => {
    const onRetryPassageLoad = vi.fn();
    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 0 },
    });

    const { rerender } = render(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        passageLoadError={true}
        onRetryPassageLoad={onRetryPassageLoad}
      />
    );

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Impossibile caricare le discussioni sui passaggi.'));
    expect(screen.queryByText(/Nessuna discussione ancora\./)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    expect(onRetryPassageLoad).toHaveBeenCalledOnce();

    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 0 },
    });
    rerender(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        passageLoadError={false}
      />
    );
    await waitFor(() => expect(screen.getByText(/Nessuna discussione ancora\./)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Le discussioni non sono disponibili/)).not.toBeInTheDocument();
  });

  it('a "detached" state shows "Il passo discusso non si trova nel testo che stai leggendo." and the quotation, and the discussion stays listed', async () => {
    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [dummyPassageThread],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 },
    });

    render(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        passageStates={{ 'thread-p': 'detached' }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Discussione sul risarcimento')).toBeInTheDocument();
    });

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Il passo discusso non si trova nel testo che stai leggendo.');
    expect(note).toHaveTextContent('risarcimento del danno');
  });

  it('differing hashes show the changed-text note', async () => {
    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [dummyPassageThread], // has textHash: 'hash-orig'
      pagination: { page: 1, limit: 20, total: 1, pages: 1 },
    });

    render(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        textHash="hash-different"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Discussione sul risarcimento')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Il testo dell’articolo è cambiato da quando è stata aperta questa discussione.')
    ).toBeInTheDocument();
  });

  it('focusThreadId expands that discussion; expanding a passage discussion by click calls onFocusThread(id), collapsing calls onFocusThread(null)', async () => {
    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [dummyPassageThread],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 },
    });
    const onFocusThread = vi.fn();

    render(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        onFocusThread={onFocusThread}
        focusThreadId="thread-p"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Commento sul passo')).toBeInTheDocument();
    });

    const articleEl = screen.getByRole('article');
    expect(articleEl).toHaveAttribute('id', 'article-thread-thread-p');

    // Click to collapse
    const collapseBtn = within(articleEl).getByRole('button', { name: /Discussione sul risarcimento/i });
    fireEvent.click(collapseBtn);
    expect(onFocusThread).toHaveBeenCalledWith(null);

    // Click to expand again
    fireEvent.click(collapseBtn);
    expect(onFocusThread).toHaveBeenCalledWith('thread-p');
  });

  it('"Vai al passo" appears for a located passage and calls onGoToPassage(id), and does not appear for a detached one', async () => {
    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [dummyPassageThread],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 },
    });
    const onGoToPassage = vi.fn();

    const { rerender } = render(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        passageStates={{ 'thread-p': 'exact' }}
        focusThreadId="thread-p"
        onGoToPassage={onGoToPassage}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /vai al passo/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /vai al passo/i }));
    expect(onGoToPassage).toHaveBeenCalledWith('thread-p');

    // If detached, "Vai al passo" is not shown
    rerender(
      <ArticleDiscussionPanel
        anchor={dummyAnchor}
        isOpen={true}
        onClose={vi.fn()}
        passageStates={{ 'thread-p': 'detached' }}
        focusThreadId="thread-p"
        onGoToPassage={onGoToPassage}
      />
    );

    expect(screen.queryByRole('button', { name: /vai al passo/i })).not.toBeInTheDocument();
  });

  describe('anchored on a decision', () => {
    const PROJECTION_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const decisionAnchor = { normaKey: 'cassazione:civile:99999:2024', articleId: '' };

    it('lists, creates and replies with the caller\'s anchor, label and projection hash', async () => {
      const decisionThread: ArticleDiscussionThread = {
        ...dummyThread,
        normaKey: decisionAnchor.normaKey,
        articleId: '',
        version: null,
        articleUrn: null,
        textHash: PROJECTION_HASH,
        target: { kind: 'decision', key: decisionAnchor.normaKey },
        passageReleased: false,
      };
      vi.mocked(articleDiscussionService.list).mockResolvedValue({
        data: [decisionThread],
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
      });
      vi.mocked(articleDiscussionService.create).mockResolvedValue({ ...decisionThread, id: 'thread-d-new', title: 'T', body: 'B' });
      vi.mocked(articleDiscussionService.comment).mockResolvedValue({
        id: 'c1', threadId: 'thread-d-new', body: 'Risposta', isHidden: false, user: { id: 'u3', username: 'anna' },
        createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z', voteCount: 0, userVoted: false, isOwner: true,
      });

      render(
        <ArticleDiscussionPanel
          anchor={decisionAnchor}
          label="Cass. civ. n. 99999/2024"
          heading="Discussioni sulla sentenza"
          textChangedNotice="Il testo della sentenza è cambiato da quando è stata aperta questa discussione."
          isOpen={true}
          onClose={vi.fn()}
          textHash={PROJECTION_HASH}
        />
      );

      await waitFor(() => expect(screen.getByText('Titolo discussione')).toBeInTheDocument());
      expect(articleDiscussionService.list).toHaveBeenCalledWith(decisionAnchor, 'recent');
      expect(screen.getByText('Discussioni sulla sentenza')).toBeInTheDocument();
      expect(screen.getByText('Cass. civ. n. 99999/2024')).toBeInTheDocument();
      expect(screen.queryByText(/^Art\./)).not.toBeInTheDocument();
      expect(screen.queryByText(/dell’articolo/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /nuova discussione/i }));
      fireEvent.change(screen.getByPlaceholderText('Titolo della discussione'), { target: { value: 'T' } });
      fireEvent.change(screen.getByPlaceholderText(/condividi una domanda/i), { target: { value: 'B' } });
      fireEvent.click(screen.getByRole('button', { name: /pubblica/i }));

      await waitFor(() => {
        expect(articleDiscussionService.create).toHaveBeenCalledWith(
          decisionAnchor, 'T', 'B',
          { passage: undefined, articleUrn: undefined, textHash: PROJECTION_HASH },
        );
      });

      // The new discussion is listed first and shown expanded.
      fireEvent.click((await screen.findAllByRole('button', { name: /rispondi/i }))[0]);
      fireEvent.change(screen.getByPlaceholderText(/rispondi|scrivi/i), { target: { value: 'Risposta' } });
      fireEvent.submit(screen.getByPlaceholderText(/rispondi|scrivi/i).closest('form')!);
      await waitFor(() => expect(articleDiscussionService.comment).toHaveBeenCalledWith('thread-d-new', 'Risposta'));
    });

    it('shows the caller\'s notice when the text changed, and loads once for an equal new anchor object', async () => {
      const changed: ArticleDiscussionThread = {
        ...dummyThread,
        normaKey: decisionAnchor.normaKey,
        articleId: '',
        textHash: PROJECTION_HASH,
        target: { kind: 'decision', key: decisionAnchor.normaKey },
      };
      vi.mocked(articleDiscussionService.list).mockClear();
      vi.mocked(articleDiscussionService.list).mockResolvedValue({
        data: [changed],
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
      });
      const otherHash = '1111111111111111111111111111111111111111111111111111111111111111';
      const notice = 'Il testo della sentenza è cambiato da quando è stata aperta questa discussione.';
      const ui = (anchor: { normaKey: string; articleId: string }) => (
        <ArticleDiscussionPanel anchor={anchor} isOpen={true} onClose={vi.fn()} textHash={otherHash} textChangedNotice={notice} />
      );

      const { rerender } = render(ui({ ...decisionAnchor }));
      await screen.findByText('Titolo discussione');
      expect(screen.getByText(notice)).toBeInTheDocument();

      rerender(ui({ ...decisionAnchor }));
      rerender(ui({ ...decisionAnchor }));
      expect(articleDiscussionService.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('a withdrawn passage (withholdDetachedPassage)', () => {
    const decisionAnchor = { normaKey: 'cassazione:civile:99999:2024', articleId: '' };
    const detachedStates = { 'thread-p': 'detached' as const };
    const decisionThread = (over: Partial<ArticleDiscussionThread> = {}): ArticleDiscussionThread => ({
      ...dummyPassageThread,
      normaKey: decisionAnchor.normaKey,
      articleId: '',
      target: { kind: 'decision', key: decisionAnchor.normaKey },
      ...over,
    });
    const WITHHELD = 'Il passo citato non è più nel testo della decisione';

    const renderPanel = async (thread: ArticleDiscussionThread, withhold = true) => {
      vi.mocked(articleDiscussionService.list).mockResolvedValue({
        data: [thread],
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
      });
      render(
        <ArticleDiscussionPanel
          anchor={decisionAnchor}
          isOpen={true}
          onClose={vi.fn()}
          passageStates={detachedStates}
          withholdDetachedPassage={withhold}
        />,
      );
      await screen.findByText('Discussione sul risarcimento');
    };

    it('shows another reader the sentence, not the quotation', async () => {
      await renderPanel(decisionThread());
      expect(screen.getByText(WITHHELD)).toBeInTheDocument();
      expect(screen.queryAllByText(/risarcimento del danno/)).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Mostra a tutti' })).not.toBeInTheDocument();
    });

    it('shows the author the quotation with a notice', async () => {
      await renderPanel(decisionThread({ isOwner: true }));
      expect(screen.getAllByText(/risarcimento del danno/).length).toBeGreaterThan(0);
      expect(screen.getByText(/visibili solo all’autore e agli amministratori/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mostra a tutti' })).not.toBeInTheDocument();
    });

    it('shows an admin the quotation with a notice and the release button', async () => {
      authState.isAdmin = true;
      await renderPanel(decisionThread());
      expect(screen.getAllByText(/risarcimento del danno/).length).toBeGreaterThan(0);
      expect(screen.getByText(/visibili solo all’autore e agli amministratori/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mostra a tutti' })).toHaveClass('min-h-[44px]');
    });

    it('shows everyone the quotation once released', async () => {
      await renderPanel(decisionThread({ passageReleased: true }));
      expect(screen.getAllByText(/risarcimento del danno/).length).toBeGreaterThan(0);
      expect(screen.getByText(/visibili a tutti/)).toBeInTheDocument();
    });

    it('lets an admin release and hide again, optimistically', async () => {
      authState.isAdmin = true;
      vi.mocked(articleDiscussionService.setPassageReleased).mockResolvedValue({ passageReleased: true });
      await renderPanel(decisionThread());
      fireEvent.click(screen.getByRole('button', { name: 'Mostra a tutti' }));
      expect(await screen.findByRole('button', { name: 'Nascondi di nuovo' })).toBeInTheDocument();
      expect(articleDiscussionService.setPassageReleased).toHaveBeenCalledWith('thread-p', true);
      fireEvent.click(screen.getByRole('button', { name: 'Nascondi di nuovo' }));
      expect(await screen.findByRole('button', { name: 'Mostra a tutti' })).toBeInTheDocument();
      expect(articleDiscussionService.setPassageReleased).toHaveBeenLastCalledWith('thread-p', false);
    });

    it('reverts and says so when the server refuses', async () => {
      authState.isAdmin = true;
      vi.mocked(articleDiscussionService.setPassageReleased).mockRejectedValue(new Error('boom'));
      await renderPanel(decisionThread());
      fireEvent.click(screen.getByRole('button', { name: 'Mostra a tutti' }));
      expect(await screen.findByText(/Impossibile aggiornare la visibilità del passo/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mostra a tutti' })).toBeInTheDocument();
    });

    it('leaves an article\'s detached passage unchanged', async () => {
      await renderPanel({ ...dummyPassageThread }, false);
      expect(screen.getByText('Il passo discusso non si trova nel testo che stai leggendo.')).toBeInTheDocument();
      expect(screen.getAllByText(/risarcimento del danno/).length).toBeGreaterThan(0);
      expect(screen.queryByText(WITHHELD)).not.toBeInTheDocument();
    });
  });
});
