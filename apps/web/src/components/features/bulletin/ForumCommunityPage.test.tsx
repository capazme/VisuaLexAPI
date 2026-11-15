import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { CommunityFeedItem, CommunityThread, CommunityReply } from '../../../types/community';

// The Forum's count belongs to «Dossier pubblici»: only that page clears it and starts the Forum's tour.
const forum = vi.hoisted(() => ({ markRead: vi.fn(), tryStartTour: vi.fn() }));
vi.mock('../../../services/notificationService', () => ({ notificationService: { markRead: forum.markRead } }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: forum.tryStartTour }) }));

const service = vi.hoisted(() => ({
  feed: vi.fn(),
  get: vi.fn(),
  accept: vi.fn(),
  comment: vi.fn(),
  voteThread: vi.fn(),
  voteComment: vi.fn(),
  report: vi.fn(),
  reportComment: vi.fn(),
}));
vi.mock('../../../services/articleDiscussionService', () => ({ articleDiscussionService: service }));

import { ForumCommunityPage } from './ForumCommunityPage';
import { SECTION_PHRASES, sectionKicker } from '../../../features/sections/sections';

function item(over: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
  return {
    id: 't1',
    title: 'Risoluzione e inadempimento di scarsa importanza',
    excerpt: 'Quando l’inadempimento…',
    normaKey: 'regio-decreto--262--1942-03-16--1453',
    articleId: '1453',
    articleLabel: null,
    version: null,
    articleUrn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453',
    target: { kind: 'article' },
    decisionLabel: null,
    passage: null,
    user: { id: 'u1', username: 'marta' },
    materia: 'DIRITTO_CIVILE',
    voteCount: 4,
    userVoted: false,
    replyCount: 2,
    acceptedCommentId: null,
    createdAt: '2026-11-10T10:00:00Z',
    lastActivityAt: '2026-11-11T10:00:00Z',
    editedAt: null,
    deleted: false,
    locked: false,
    isOwner: false,
    ...over,
  };
}

function reply(over: Partial<CommunityReply> = {}): CommunityReply {
  return {
    id: 'r1',
    parentId: null,
    body: 'Serve un inadempimento grave.',
    user: { id: 'u2', username: 'luigi' },
    createdAt: '2026-11-10T11:00:00Z',
    editedAt: null,
    deleted: false,
    removed: false,
    hidden: null,
    voteCount: 1,
    userVoted: false,
    isOwner: false,
    accepted: false,
    comments: [],
    ...over,
  };
}

function thread(over: Partial<CommunityThread> = {}): CommunityThread {
  const base = item();
  return {
    id: base.id,
    normaKey: base.normaKey,
    articleId: base.articleId,
    articleLabel: null,
    version: null,
    target: base.target,
    decisionLabel: null,
    title: base.title,
    body: 'Il testo intero della discussione.',
    passage: null,
    passageWithheld: false,
    passageReleased: false,
    articleUrn: base.articleUrn,
    textHash: null,
    user: base.user,
    materia: base.materia,
    createdAt: base.createdAt,
    lastActivityAt: base.lastActivityAt,
    editedAt: null,
    deleted: false,
    locked: false,
    hidden: null,
    acceptedCommentId: null,
    voteCount: 4,
    userVoted: false,
    replyCount: 2,
    isOwner: false,
    replies: [],
    ...over,
  };
}

const page = (data: CommunityFeedItem[], pages = 1) => ({ data, pagination: { page: 1, limit: 20, total: data.length, pages } });

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderAt(path = '/forum/community') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forum/community" element={<ForumCommunityPage />} />
        <Route path="/forum/community/:threadId" element={<ForumCommunityPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForumCommunityPage: the feed', () => {
  it('is titled by its name, the Forum\'s phrase small over it (L-37)', async () => {
    service.feed.mockResolvedValue(page([]));
    renderAt();
    expect(SECTION_PHRASES.forum).toBe('il luogo del dibattito giuridico');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Community$/);
    expect(screen.getByText(sectionKicker('forum'))).toHaveTextContent('Forum · il luogo del dibattito giuridico');
    await screen.findByText('Nessuna discussione ancora.');
  });

  it('lists the feed: title, subject, what it is about, author, replies, votes and the accepted reply\'s mark', async () => {
    service.feed.mockResolvedValue(page([
      item({ acceptedCommentId: 'r1' }),
      item({
        id: 't2', title: 'Giudicato e motivazione', materia: null, target: { kind: 'decision', key: 'cassazione:civile:1234:2024' },
        decisionLabel: 'Cass. civ., n. 1234/2024', articleId: '', articleUrn: null, user: { id: 'u3', username: 'anna' }, voteCount: 1, replyCount: 0,
      }),
    ]));
    renderAt();
    const list = await screen.findByRole('list', { name: 'Discussioni' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(service.feed).toHaveBeenCalledWith({ page: 1 });

    const first = rows[0];
    expect(within(first).getByRole('link', { name: /Risoluzione e inadempimento/ })).toHaveAttribute('href', '/forum/community/t1');
    expect(within(first).getByText('Diritto civile')).toBeInTheDocument();
    expect(within(first).getByText(/Scritta da marta · 2 risposte · 4 voti/)).toBeInTheDocument();
    expect(within(first).getByText('Risposta accettata')).toBeInTheDocument();
    const norm = within(first).getByRole('button', { name: 'Apri art. 1453 c.c.' });
    expect(norm).toHaveClass('underline', 'min-h-11');

    const second = rows[1];
    expect(within(second).getByText(/Scritta da anna · 0 risposte · 1 voto$/)).toBeInTheDocument();
    expect(within(second).queryByText('Risposta accettata')).toBeNull();
    const decision = within(second).getByRole('link', { name: 'Apri Cass. civ., n. 1234/2024' });
    expect(decision).toHaveAttribute('href', '/sentenze/cassazione-civile/1234/2024');
    // Norms and decisions look the same: a command, not text.
    expect(decision.className).toBe(norm.className);
    expect(document.body.textContent).not.toMatch(/validat/i);
  });

  it('says when there is nothing, and while it loads', async () => {
    let answer!: (value: unknown) => void;
    service.feed.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderAt();
    expect(screen.getByRole('status')).toHaveTextContent('Caricamento delle discussioni…');
    answer(page([]));
    expect(await screen.findByText('Nessuna discussione ancora.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Discussioni' })).toBeNull();
  });

  it('says when the feed cannot be read, and «Riprova» reads it again', async () => {
    service.feed.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(page([item()]));
    renderAt();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Impossibile caricare le discussioni.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /Risoluzione e inadempimento/ })).toBeInTheDocument();
    expect(service.feed).toHaveBeenCalledTimes(2);
  });

  it('filters by subject on the server', async () => {
    service.feed.mockResolvedValue(page([item()]));
    renderAt();
    await screen.findByRole('list', { name: 'Discussioni' });
    service.feed.mockResolvedValue(page([]));
    fireEvent.change(screen.getByRole('combobox', { name: 'Materia' }), { target: { value: 'DIRITTO_PENALE' } });
    await waitFor(() => expect(service.feed).toHaveBeenLastCalledWith({ page: 1, materia: 'DIRITTO_PENALE' }));
    expect(await screen.findByText('Nessuna discussione in questa materia.')).toBeInTheDocument();
  });

  it('loads the next page under the list', async () => {
    service.feed.mockResolvedValueOnce(page([item()], 2)).mockResolvedValueOnce({ data: [item({ id: 't9', title: 'Seconda pagina' })], pagination: { page: 2, limit: 20, total: 2, pages: 2 } });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Altre discussioni' }));
    expect(await screen.findByRole('link', { name: /Seconda pagina/ })).toBeInTheDocument();
    expect(service.feed).toHaveBeenLastCalledWith({ page: 2 });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Altre discussioni' })).toBeNull();
  });

  it('neither clears the Forum\'s count nor starts its tour', async () => {
    service.feed.mockResolvedValue(page([]));
    renderAt();
    await screen.findByText('Nessuna discussione ancora.');
    expect(forum.markRead).not.toHaveBeenCalled();
    expect(forum.tryStartTour).not.toHaveBeenCalled();
  });
});

describe('ForumCommunityPage: the open discussion', () => {
  it('has its own address, read by the server, marked in the list with aria-current', async () => {
    service.feed.mockResolvedValue(page([item(), item({ id: 't2', title: 'Altra' })]));
    service.get.mockResolvedValue(thread());
    renderAt('/forum/community/t1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Risoluzione e inadempimento di scarsa importanza' })).toBeInTheDocument();
    expect(service.get).toHaveBeenCalledWith('t1');
    expect(screen.getByText('Il testo intero della discussione.')).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Discussioni' });
    expect(screen.getByRole('link', { name: /Risoluzione e inadempimento/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Altra/ })).not.toHaveAttribute('aria-current');
    // On a phone the list gives way to the discussion, which leads back to it.
    expect(screen.getByRole('link', { name: 'Torna alle discussioni' })).toHaveAttribute('href', '/forum/community');
  });

  it('opens from the list', async () => {
    service.feed.mockResolvedValue(page([item()]));
    service.get.mockResolvedValue(thread());
    renderAt();
    fireEvent.click(await screen.findByRole('link', { name: /Risoluzione e inadempimento/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/forum/community/t1');
    expect(await screen.findByText('Il testo intero della discussione.')).toBeInTheDocument();
  });

  it('shows the accepted reply first, labelled, with the comments nested under each reply', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({
      acceptedCommentId: 'r2',
      replies: [
        reply({ id: 'r2', body: 'La risposta che ha chiuso la questione.', accepted: true, user: { id: 'u4', username: 'carlo' },
          comments: [{ ...reply({ id: 'c1', parentId: 'r2', body: 'Concordo, vedi anche l’art. 1455.' }), user: { id: 'u5', username: 'sara' } }] }),
        reply({ id: 'r1' }),
      ],
    }));
    renderAt('/forum/community/t1');
    const replies = await screen.findByRole('list', { name: '2 risposte' });
    const rows = within(replies).getAllByRole('article');
    expect(within(rows[0]).getByText('Risposta accettata')).toBeInTheDocument();
    expect(within(rows[0]).getByText('La risposta che ha chiuso la questione.')).toBeInTheDocument();
    const comments = within(rows[0]).getByRole('list', { name: 'Commenti a questa risposta' });
    expect(within(comments).getByText('Concordo, vedi anche l’art. 1455.')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Risposta accettata')).toBeNull();
    expect(document.body.textContent).not.toMatch(/validat/i);
  });

  it('shows «accept» to the discussion\'s author alone, never on their own reply', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({ replies: [reply({ id: 'r1' }), reply({ id: 'r3', isOwner: true, body: 'Mia' })] }));
    const first = renderAt('/forum/community/t1');
    await screen.findByText('Serve un inadempimento grave.');
    expect(screen.queryByRole('button', { name: /Accetta/ })).toBeNull();
    first.unmount();

    service.get.mockResolvedValue(thread({ isOwner: true, replies: [reply({ id: 'r1' }), reply({ id: 'r3', isOwner: true, body: 'Mia' })] }));
    renderAt('/forum/community/t1');
    await screen.findByText('Serve un inadempimento grave.');
    expect(screen.getAllByRole('button', { name: 'Accetta la risposta di luigi' })).toHaveLength(1);
  });

  it('accepts a reply and reads the discussion again, the reply now first', async () => {
    service.feed.mockResolvedValue(page([item({ isOwner: true })]));
    service.get.mockResolvedValueOnce(thread({ isOwner: true, replies: [reply({ id: 'r1' })] }));
    service.accept.mockResolvedValue({ acceptedCommentId: 'r1' });
    renderAt('/forum/community/t1');
    fireEvent.click(await screen.findByRole('button', { name: 'Accetta la risposta di luigi' }));
    service.get.mockResolvedValue(thread({ isOwner: true, acceptedCommentId: 'r1', replies: [reply({ id: 'r1', accepted: true })] }));
    await waitFor(() => expect(service.accept).toHaveBeenCalledWith('t1', 'r1'));
    expect(await screen.findByRole('button', { name: 'Ritira l’accettazione' })).toBeInTheDocument();
    // The feed's row takes the mark too.
    const list = screen.getByRole('list', { name: 'Discussioni' });
    expect(within(list).getByText('Risposta accettata')).toBeInTheDocument();
  });

  it('replies, votes and reports with the discussions\' own controls', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({ replies: [reply({ id: 'r1' })] }));
    service.voteThread.mockResolvedValue({ voted: true, voteCount: 5 });
    service.comment.mockResolvedValue({});
    service.report.mockResolvedValue(undefined);
    renderAt('/forum/community/t1');
    const vote = await screen.findByRole('button', { name: 'Vota la discussione, 4 voti' });
    // 44 px on a phone, the panel's size from md.
    expect(vote).toHaveClass('min-h-11', 'md:min-h-0');
    fireEvent.click(vote);
    expect(await screen.findByRole('button', { name: 'Vota la discussione, 5 voti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vota la risposta di luigi, 1 voto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commenta la risposta di luigi' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Invia risposta' })).toHaveClass('min-h-11', 'min-w-11');

    fireEvent.change(screen.getByRole('textbox', { name: 'Scrivi una risposta…' }), { target: { value: 'Una risposta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia risposta' }));
    await waitFor(() => expect(service.comment).toHaveBeenCalledWith('t1', 'Una risposta', undefined));
    await waitFor(() => expect(service.get).toHaveBeenCalledTimes(2));

    // A report asks first: «Annulla» sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Segnala la discussione' }));
    // The focus starts on «Annulla»: an Enter pressed at once must not report (#449, note 9).
    const cancel = within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Annulla' });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.click(cancel);
    expect(service.report).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Segnala la discussione' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Segnala' }));
    await waitFor(() => expect(service.report).toHaveBeenCalledWith('t1', 'segnalazione'));
    expect(await screen.findByText('Segnalazione inviata ai moderatori.')).toBeInTheDocument();
  });

  it('says when the discussion is not there any more', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockRejectedValue({ status: 404, message: 'Glossa non trovata' });
    renderAt('/forum/community/sparita');
    expect(await screen.findByText('Questa discussione non c’è più.')).toBeInTheDocument();
  });
});
