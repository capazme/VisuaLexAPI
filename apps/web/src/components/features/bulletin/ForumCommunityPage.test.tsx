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
  editThread: vi.fn(),
  deleteThread: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
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

/** The deletion's question (`WireConfirm`) answers once its buttons are in sight. */
async function confirmDelete() {
  const question = await screen.findByRole('alertdialog');
  await waitFor(() => expect(question).toHaveAttribute('data-ready'));
  fireEvent.click(within(question).getByRole('button', { name: 'Elimina' }));
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
    expect(screen.getByText(sectionKicker('forum'))).toHaveTextContent(/^Forum$/);
    await screen.findByText('Nessuna discussione ancora.');
  });

  it('lists the feed as rows: «utile» count, subject, author, source as cited, title, excerpt, replies, accepted mark', async () => {
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
    const link = within(first).getByRole('link', { name: /Risoluzione e inadempimento/ });
    expect(link).toHaveAttribute('href', '/forum/community/t1');
    // Everything is inside the one link: the row opens the discussion.
    expect(within(link).getByText('4')).toBeInTheDocument();
    expect(within(link).getByText('utili')).toBeInTheDocument();
    expect(within(link).getByText('Diritto civile')).toBeInTheDocument();
    expect(within(link).getByText('marta')).toBeInTheDocument();
    expect(within(link).getByText('m')).toHaveClass('rounded-full');
    expect(within(link).getByText('su art. 1453 c.c.')).toBeInTheDocument();
    expect(within(link).getByText('Quando l’inadempimento…')).toHaveClass('line-clamp-2');
    expect(within(link).getByText('2 risposte')).toBeInTheDocument();
    expect(within(link).getByText('· 4 voti utili')).toHaveClass('sr-only');
    expect(within(link).getByText('Risposta accettata')).toHaveClass('text-emerald-800');
    // The source is said in the row, not a command of its own: the link to it is the discussion's.
    expect(within(first).queryByRole('button', { name: /^Apri / })).toBeNull();

    const second = rows[1];
    expect(within(second).getByRole('link', { name: /Giudicato e motivazione/ })).toHaveAttribute('href', '/forum/community/t2');
    expect(within(second).getByText('su Cass. civ., n. 1234/2024')).toBeInTheDocument();
    expect(within(second).getByText('utile')).toBeInTheDocument();
    expect(within(second).getByText('0 risposte')).toBeInTheDocument();
    expect(within(second).getByText('· 1 voto utile')).toHaveClass('sr-only');
    expect(within(second).getByText('anna')).toBeInTheDocument();
    expect(within(second).queryByText('Diritto civile')).toBeNull();
    expect(within(second).queryByText('Risposta accettata')).toBeNull();
    expect(within(second).queryByRole('link', { name: /^Apri / })).toBeNull();
    expect(document.body.textContent).not.toMatch(/validat/i);
  });

  it('names the source as cited: the article\'s label without a URN, else its number', async () => {
    service.feed.mockResolvedValue(page([
      item({ id: 't3', title: 'Con etichetta', articleUrn: null, articleLabel: 'art. 2043 c.c.' }),
      item({ id: 't4', title: 'Senza etichetta', articleUrn: null, articleLabel: null, articleId: '7' }),
    ]));
    renderAt();
    const [labelled, bare] = within(await screen.findByRole('list', { name: 'Discussioni' })).getAllByRole('listitem');
    expect(within(labelled).getByText('su art. 2043 c.c.')).toBeInTheDocument();
    expect(within(bare).getByText('su art. 7')).toBeInTheDocument();
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

  it('draws the communities twice, a row below lg and a list in the aside «Comunità», as toggles', async () => {
    service.feed.mockResolvedValue(page([]));
    renderAt();
    await screen.findByText('Nessuna discussione ancora.');
    const groups = screen.getAllByRole('group', { name: 'Materia' });
    expect(groups).toHaveLength(2);
    const [row, aside] = groups;
    expect(row).toHaveClass('lg:hidden');
    expect(screen.getByRole('complementary', { name: 'Comunità' })).toContainElement(aside);
    expect(screen.getByRole('complementary', { name: 'Comunità' })).toHaveClass('hidden', 'lg:block');
    for (const group of groups) {
      const buttons = within(group).getAllByRole('button');
      expect(buttons.map(b => b.textContent)).toEqual([
        'Tutte le materie', 'Diritto civile', 'Diritto penale', 'Diritto amministrativo', 'Diritto processuale civile', 'Diritto processuale penale',
      ]);
      expect(within(group).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(group).getByRole('button', { name: 'Diritto civile' })).toHaveAttribute('aria-pressed', 'false');
    }
    // 44 px to touch in the phone's row.
    expect(within(row).getByRole('button', { name: 'Diritto civile' })).toHaveClass('min-h-[44px]');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('filters by subject on the server, the choice pressed in both renderings', async () => {
    service.feed.mockResolvedValue(page([item()]));
    renderAt();
    await screen.findByRole('list', { name: 'Discussioni' });
    service.feed.mockResolvedValue(page([]));
    const [row, aside] = screen.getAllByRole('group', { name: 'Materia' });
    fireEvent.click(within(row).getByRole('button', { name: 'Diritto penale' }));
    await waitFor(() => expect(service.feed).toHaveBeenLastCalledWith({ page: 1, materia: 'DIRITTO_PENALE' }));
    expect(await screen.findByText('Nessuna discussione in questa materia.')).toBeInTheDocument();
    for (const group of [row, aside]) {
      expect(within(group).getByRole('button', { name: 'Diritto penale' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(group).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'false');
    }
    // From the aside too, and back to every subject.
    fireEvent.click(within(aside).getByRole('button', { name: 'Tutte le materie' }));
    await waitFor(() => expect(service.feed).toHaveBeenLastCalledWith({ page: 1 }));
    expect(within(row).getByRole('button', { name: 'Tutte le materie' })).toHaveAttribute('aria-pressed', 'true');
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
  it('has its own address, read by the server, and takes the list\'s place', async () => {
    service.feed.mockResolvedValue(page([item(), item({ id: 't2', title: 'Altra' })]));
    service.get.mockResolvedValue(thread());
    renderAt('/forum/community/t1');
    const title = await screen.findByRole('heading', { level: 2, name: 'Risoluzione e inadempimento di scarsa importanza' });
    expect(service.get).toHaveBeenCalledWith('t1');
    expect(screen.getByRole('region', { name: 'Discussione aperta' })).toContainElement(title);
    expect(screen.getByText('Il testo intero della discussione.')).toBeInTheDocument();
    // The feed is not drawn while a discussion is open: the discussion has the page, the communities beside it.
    await waitFor(() => expect(service.feed).toHaveBeenCalled());
    expect(screen.queryByRole('list', { name: 'Discussioni' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Altra/ })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Comunità' })).toBeInTheDocument();
    // The way back, at every width.
    const back = screen.getByRole('link', { name: 'Torna alle discussioni' });
    expect(back).toHaveAttribute('href', '/forum/community');
    expect(back.className).not.toMatch(/(^|\s)(sm|md|lg|xl):hidden|(^|\s)hidden(\s|$)/);
  });

  it('heads the discussion with subject, author and long date, then the source to open', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread());
    renderAt('/forum/community/t1');
    const article = await screen.findByRole('article', { name: 'Risoluzione e inadempimento di scarsa importanza' });
    expect(within(article).getByText('Diritto civile')).toBeInTheDocument();
    expect(within(article).getAllByText('marta')[0]).toBeInTheDocument();
    expect(within(article).getByText('· 10 novembre 2026')).toBeInTheDocument();
    expect(within(article).getByRole('button', { name: 'Apri art. 1453 c.c.' })).toHaveClass('underline', 'min-h-11');
  });

  it('goes back to the list, narrowed, when a community is chosen with a discussion open', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread());
    renderAt('/forum/community/t1');
    await screen.findByText('Il testo intero della discussione.');
    const aside = screen.getByRole('complementary', { name: 'Comunità' });
    fireEvent.click(within(aside).getByRole('button', { name: 'Diritto amministrativo' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/forum\/community$/));
    await waitFor(() => expect(service.feed).toHaveBeenLastCalledWith({ page: 1, materia: 'DIRITTO_AMMINISTRATIVO' }));
    expect(await screen.findByText('Nessuna discussione in questa materia.')).toBeInTheDocument();
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
    expect(within(rows[0]).getByText('Risposta accettata')).toHaveClass('text-emerald-800');
    // The label alone says it (anti-slop, 15 Nov): no green edge besides it.
    expect(rows[0]).not.toHaveClass('border-emerald-600');
    expect(rows[1]).not.toHaveClass('border-l-2');
    expect(within(rows[0]).getByText('carlo')).toBeInTheDocument();
    expect(within(rows[0]).getByText('c')).toHaveClass('rounded-full');
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
    const replyRow = within(screen.getByRole('list', { name: '2 risposte' })).getByRole('article');
    expect(within(replyRow).getByText('Risposta accettata')).toBeInTheDocument();
    expect(within(replyRow).getByText('Risposta accettata')).toBeInTheDocument();
    // Back on the list, the feed's row has taken the mark too.
    fireEvent.click(screen.getByRole('link', { name: 'Torna alle discussioni' }));
    const list = await screen.findByRole('list', { name: 'Discussioni' });
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
    expect(vote).toHaveClass('min-h-11', 'md:min-h-9');
    fireEvent.click(vote);
    expect(await screen.findByRole('button', { name: 'Vota la discussione, 5 voti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vota la risposta di luigi, 1 voto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commenta la risposta di luigi' })).toHaveClass('min-h-11');
    // LC114: 36 px from md, the common control's height (it was 32).
    expect(screen.getByRole('button', { name: 'Invia risposta' })).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-9');

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

  it('shows only the count on one\'s own discussion and reply, and the server\'s words if a vote is refused as one\'s own', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({ isOwner: true, replies: [reply({ id: 'r1', isOwner: true }), reply({ id: 'r2' })] }));
    service.voteComment.mockRejectedValue({ status: 403, message: 'Non puoi votare un tuo contributo', data: { detail: 'Non puoi votare un tuo contributo', error: 'own_contribution' } });
    renderAt('/forum/community/t1');
    await screen.findAllByText('Serve un inadempimento grave.');
    expect(screen.queryByRole('button', { name: /^Vota la discussione/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Vota la risposta/ })).toHaveLength(1);
    // The count stays, said as such to a screen reader.
    const counts = screen.getAllByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.trim() === '4 voti');
    expect(counts[0].closest('button')).toBeNull();
    // A vote the server still refuses as one's own (an `isOwner` out of date): its words, not «Riprova».
    fireEvent.click(screen.getByRole('button', { name: 'Vota la risposta di luigi, 1 voto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non puoi votare un tuo contributo');
    expect(screen.queryByText(/Riprova/)).toBeNull();
  });

  // LC114: the box opened to write in takes the focus, on a phone too; the box always at the foot never does.
  it('puts the focus in the comment\'s box once «Commenta» opens it', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({ replies: [reply({ id: 'r1' })] }));
    renderAt('/forum/community/t1');
    const heading = await screen.findByRole('heading', { name: 'Risoluzione e inadempimento di scarsa importanza' });
    await waitFor(() => expect(heading).toHaveFocus());
    const commenta = screen.getByRole('button', { name: 'Commenta la risposta di luigi' });
    fireEvent.click(commenta);
    expect(commenta).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Scrivi un commento…' })).toHaveFocus();
  });

  // LC114: on what one wrote, «Modifica» and «Elimina»; never «Segnala» nor a vote.
  it('gives the author «Modifica» and «Elimina» on their own discussion, reply and comment, and nothing to report or vote', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({
      isOwner: true,
      replies: [reply({ id: 'r1', isOwner: true, comments: [reply({ id: 'c1', parentId: 'r1', isOwner: true, body: 'Mio commento' })] }), reply({ id: 'r2' })],
    }));
    renderAt('/forum/community/t1');
    await screen.findByText('Mio commento');
    for (const what of ['la discussione', 'la tua risposta', 'il tuo commento']) {
      expect(screen.getByRole('button', { name: `Modifica ${what}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Elimina ${what}` })).toBeInTheDocument();
    }
    // Another's reply: no «Modifica», its «Segnala» and vote stay.
    expect(screen.getAllByRole('button', { name: /^Modifica / })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Segnala la discussione' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Segnala / })).toEqual([screen.getByRole('button', { name: 'Segnala la risposta di luigi' })]);
    expect(screen.queryByRole('button', { name: /^Vota la discussione/ })).toBeNull();
  });

  it('edits the discussion in its place, the text focused, and reads it again; a refusal says the server\'s words', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({ isOwner: true }));
    service.editThread.mockRejectedValueOnce({ status: 400, message: 'Il testo deve avere almeno 3 caratteri' }).mockResolvedValue(undefined);
    renderAt('/forum/community/t1');
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica la discussione' }));
    const form = screen.getByRole('form', { name: 'Modifica la discussione' });
    const text = within(form).getByRole('textbox', { name: 'Testo' });
    expect(text).toHaveFocus();
    expect(within(form).getByRole('textbox', { name: 'Titolo' })).toHaveValue('Risoluzione e inadempimento di scarsa importanza');
    fireEvent.change(text, { target: { value: 'ok' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Il testo deve avere almeno 3 caratteri');
    fireEvent.change(text, { target: { value: 'Il testo corretto.' } });
    service.get.mockResolvedValue(thread({ isOwner: true, body: 'Il testo corretto.' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(service.editThread).toHaveBeenLastCalledWith('t1', { title: 'Risoluzione e inadempimento di scarsa importanza', body: 'Il testo corretto.' }));
    expect(await screen.findByText('Il testo corretto.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Modifica la discussione' })).toBeNull();
  });

  it('deletes a discussion nothing hangs on: back to the list, its row gone', async () => {
    service.feed.mockResolvedValue(page([item({ isOwner: true }), item({ id: 't2', title: 'Un\'altra discussione' })]));
    service.get.mockResolvedValue(thread({ isOwner: true, replyCount: 0 }));
    service.deleteThread.mockResolvedValue({ outcome: 'deleted' });
    renderAt('/forum/community/t1');
    fireEvent.click(await screen.findByRole('button', { name: 'Elimina la discussione' }));
    await confirmDelete();
    await waitFor(() => expect(service.deleteThread).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/forum\/community$/));
    const list = await screen.findByRole('list', { name: 'Discussioni' });
    expect(within(list).queryByText('Risoluzione e inadempimento di scarsa importanza')).toBeNull();
    expect(within(list).getByText('Un\'altra discussione')).toBeInTheDocument();
  });

  it('deletes a discussion others answered: emptied, it stays and is read again, its feed row too', async () => {
    service.feed.mockResolvedValue(page([item({ isOwner: true })]));
    service.get.mockResolvedValue(thread({ isOwner: true, replies: [reply({ id: 'r1' })] }));
    service.deleteThread.mockResolvedValue({ outcome: 'emptied' });
    renderAt('/forum/community/t1');
    fireEvent.click(await screen.findByRole('button', { name: 'Elimina la discussione' }));
    service.get.mockResolvedValue(thread({ isOwner: true, deleted: true, title: '', body: '', replies: [reply({ id: 'r1' })] }));
    await confirmDelete();
    const heading = await screen.findByRole('heading', { name: 'Discussione cancellata dall’autore' });
    // «Elimina» is gone: the focus on the discussion's title, not on the body.
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByTestId('where')).toHaveTextContent('/forum/community/t1');
    expect(screen.getByText('Serve un inadempimento grave.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Elimina la discussione' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Torna alle discussioni' }));
    const list = await screen.findByRole('list', { name: 'Discussioni' });
    expect(within(list).getByText('Discussione cancellata dall’autore')).toBeInTheDocument();
    expect(within(list).queryByText('Quando l’inadempimento…')).toBeNull();
  });

  it('brings the focus back to «Elimina» after «Annulla», and to «Modifica» once the edit closes', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({ isOwner: true }));
    renderAt('/forum/community/t1');
    const remove = await screen.findByRole('button', { name: 'Elimina la discussione' });
    fireEvent.click(remove);
    const question = await screen.findByRole('alertdialog');
    expect(question).toHaveTextContent('Eliminare la discussione?');
    fireEvent.click(within(question).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(remove).toHaveFocus());
    expect(service.deleteThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Modifica la discussione' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Testo' }), { key: 'Escape' });
    expect(screen.queryByRole('form', { name: 'Modifica la discussione' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Modifica la discussione' })).toHaveFocus());
  });

  it('deletes one\'s own reply and reads the discussion again', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockResolvedValue(thread({ replies: [reply({ id: 'r1', isOwner: true, body: 'La mia risposta' })] }));
    service.deleteComment.mockResolvedValue({ outcome: 'deleted' });
    renderAt('/forum/community/t1');
    fireEvent.click(await screen.findByRole('button', { name: 'Elimina la tua risposta' }));
    service.get.mockResolvedValue(thread({ replyCount: 0, replies: [] }));
    await confirmDelete();
    await waitFor(() => expect(service.deleteComment).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.queryByText('La mia risposta')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Risoluzione e inadempimento di scarsa importanza' })).toHaveFocus();
  });

  it('says when the discussion is not there any more', async () => {
    service.feed.mockResolvedValue(page([]));
    service.get.mockRejectedValue({ status: 404, message: 'Glossa non trovata' });
    renderAt('/forum/community/sparita');
    expect(await screen.findByText('Questa discussione non c’è più.')).toBeInTheDocument();
  });
});
