import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { appStore } from '../../../store/useAppStore';
import type { ArticleDiscussionPassageSummary, ArticleDiscussionThread } from '../../../types';
import type { DecisionIdentity, DecisionText, FoundDecision } from '../../../types/decisions';
import { decisionProjection } from '../../../utils/decisionRender';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import { DecisionReadingSurface } from './DecisionReadingSurface';
import { DecisionReadingToolbar } from './DecisionReadingToolbar';
import { DecisionTabView } from './DecisionTabView';
import { forgetDecision } from '../../../utils/decisionFetchCache';

vi.mock('../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: vi.fn(),
    listPassages: vi.fn(),
    create: vi.fn(),
    comment: vi.fn(),
  },
}));
const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));
vi.mock('../dossier/AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../services/authService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/authService')>()),
  isAuthenticated: () => true,
}));

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };
const KEY = 'cassazione:civile:99999:2024';
const TESTO: DecisionText = { motivazione: 'Il ricorso è fondato.\n\nLe spese seguono la soccombenza.' };
const PLAIN = decisionProjection(TESTO);
const found = (testo: DecisionText): FoundDecision => ({
  esito: 'trovata', identita: IDENTITY, attributi: {}, testo, avvisi: [], fonte: { nome: 'Italgiure' },
});
const fullThread = (over: Partial<ArticleDiscussionThread> = {}): ArticleDiscussionThread => ({
  id: 'new', normaKey: KEY, articleId: '', title: 'Dubbio', body: 'x', passage: null, articleUrn: null, textHash: null,
  target: { kind: 'decision', key: KEY }, passageReleased: false, comments: [], user: { id: 'u1', username: 'marta' },
  createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z', voteCount: 0, userVoted: false, isOwner: true,
  ...over,
});
const HASH = createHash('sha256').update(PLAIN, 'utf8').digest('hex');

const textOf = (root: Element) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out += n.nodeValue;
  return out;
};

const thread = (over: Partial<ArticleDiscussionPassageSummary> = {}): ArticleDiscussionPassageSummary => ({
  id: 't1',
  title: 'Sulle spese',
  passage: { quote: 'spese', start: PLAIN.indexOf('spese'), prefix: 'Le ', suffix: ' seguono' },
  articleUrn: null,
  textHash: HASH,
  commentCount: 0,
  createdAt: '2026-10-08T10:00:00Z',
  user: { id: 'u1', username: 'marta' },
  ...over,
});

async function selectText(container: HTMLElement, lineIndex: number, from: number, to: number) {
  const line = container.querySelectorAll('.vlx-dec-line')[lineIndex];
  const range = document.createRange();
  range.setStart(line.firstChild!, from);
  range.setEnd(line.firstChild!, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(container.querySelector('.group\\/content')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
Range.prototype.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });

beforeEach(() => {
  vi.clearAllMocks();
  forgetDecision(IDENTITY);
  forgetDecision({ corte: 'cassazione', numero: 99999, anno: 2024 });
  appStore.setState({
    searchTrigger: null, readingBackStack: [], workspaceTabs: [], highlights: [], annotations: [],
    loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(),
  });
  vi.mocked(articleDiscussionService.listPassages).mockResolvedValue([]);
  vi.mocked(articleDiscussionService.list).mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
});

describe('discussions on a decision — what shows them', () => {
  it('the toolbar draws the discussion button as a 44px target', () => {
    const onToggleDiscussion = vi.fn();
    render(<DecisionReadingToolbar
      notesCount={0} highlightsCount={0} isNotesOpen={false} isHighlightsOpen={false}
      onToggleNotes={vi.fn()} onToggleHighlights={vi.fn()} onToggleDiscussion={onToggleDiscussion}
      isFindOpen={false} onToggleFind={vi.fn()}
    />);
    const button = screen.getByRole('button', { name: 'Discussioni sulla decisione' });
    expect(button.className).toContain('min-h-[44px]');
    fireEvent.click(button);
    expect(onToggleDiscussion).toHaveBeenCalled();
  });

  it('a found decision shows the button and «Discuti»', async () => {
    fetchDecision.mockResolvedValue(found(TESTO));
    const { container } = render(<DecisionTabView tabId="tab-1" reference={IDENTITY} />);
    expect(await screen.findByRole('button', { name: 'Discussioni sulla decisione' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.vlx-dec-line')).not.toBeNull());
    await selectText(container, 0, 3, 10);
    expect(await screen.findByLabelText('Discuti con i colleghi')).toBeInTheDocument();
    expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(1);
  });

  it('while loading, ambiguous or not found: no button, no «Discuti», no passage request', async () => {
    let answer!: (value: unknown) => void;
    fetchDecision.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { unmount } = render(<DecisionTabView tabId="tab-1" reference={IDENTITY} />);
    expect(screen.getByRole('status')).toHaveTextContent('Caricamento della decisione');
    expect(screen.queryByRole('button', { name: 'Discussioni sulla decisione' })).toBeNull();
    unmount();
    await act(async () => { answer({ esito: 'errore_interno' }); });

    for (const reply of [
      { esito: 'ambigua', candidati: [{ identita: IDENTITY, attributi: {} }] },
      { esito: 'non_trovata', motivo: 'inesistente' },
    ]) {
      forgetDecision(IDENTITY);
      fetchDecision.mockResolvedValueOnce(reply);
      const view = render(<DecisionTabView tabId="tab-1" reference={IDENTITY} />);
      await waitFor(() => expect(fetchDecision).toHaveBeenCalled());
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(screen.queryByRole('button', { name: 'Discussioni sulla decisione' })).toBeNull();
      expect(screen.queryByLabelText('Discuti con i colleghi')).toBeNull();
      view.unmount();
    }
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();
  });

  it('a found decision without text still takes general discussions: the button, no «Discuti», no passages, no hash', async () => {
    fetchDecision.mockResolvedValue(found({}));
    vi.mocked(articleDiscussionService.create).mockResolvedValue(fullThread());
    render(<DecisionTabView tabId="tab-1" reference={IDENTITY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Discussioni sulla decisione' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Discuti con i colleghi')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /nuova discussione/i }));
    fireEvent.change(screen.getByPlaceholderText('Titolo della discussione'), { target: { value: 'Dubbio' } });
    fireEvent.change(screen.getByPlaceholderText(/condividi una domanda/i), { target: { value: 'Una domanda' } });
    fireEvent.click(screen.getByRole('button', { name: /pubblica/i }));
    await waitFor(() => expect(articleDiscussionService.create).toHaveBeenCalled());
    const [anchor, , , extras] = vi.mocked(articleDiscussionService.create).mock.calls[0];
    expect(anchor).toMatchObject({ normaKey: KEY, articleId: '' });
    expect(extras).toEqual({ passage: undefined, articleUrn: undefined, textHash: undefined });
  });

  it('without text, a passage discussion does not promise that its words will appear', async () => {
    fetchDecision.mockResolvedValue(found({}));
    vi.mocked(articleDiscussionService.list).mockResolvedValue({
      data: [fullThread({ id: 't-old', title: 'Vecchio dubbio', isOwner: false, passageReleased: false, passage: { quote: 'ricorso', start: 3, prefix: 'Il ', suffix: ' è fondato' } })],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 },
    });
    render(<DecisionTabView tabId="tab-1" reference={IDENTITY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Discussioni sulla decisione' }));
    expect(await screen.findByText('Il passo citato non è mostrato: il testo della decisione non è disponibile.')).toBeInTheDocument();
    expect(screen.queryByText(/in verifica/)).toBeNull();
  });
});

describe('discussions on a decision — the passage', () => {
  it('«Discuti» opens the composer on the words and creates under the key, with no article and the projection hash', async () => {
    vi.mocked(articleDiscussionService.create).mockResolvedValue(fullThread());
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    await waitFor(() => expect(articleDiscussionService.listPassages).toHaveBeenCalledWith({ normaKey: KEY, articleId: '' }));
    // let the fingerprint settle
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    await selectText(container, 0, 3, 10); // «ricorso»
    fireEvent.click(await screen.findByLabelText('Discuti con i colleghi'));
    expect(await screen.findByText('Discussioni sulla decisione')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Titolo (facoltativo)'), { target: { value: 'Dubbio' } });
    fireEvent.change(screen.getByLabelText('Testo della discussione'), { target: { value: 'Il passo non convince' } });
    fireEvent.click(screen.getByRole('button', { name: /pubblica/i }));

    await waitFor(() => expect(articleDiscussionService.create).toHaveBeenCalled());
    const [anchor, title, , extras] = vi.mocked(articleDiscussionService.create).mock.calls[0];
    expect(Object.keys(anchor).sort()).toEqual(['articleId', 'articleLabel', 'normaKey', 'version']);
    expect(anchor.version).toBeUndefined();
    expect(anchor).toMatchObject({ normaKey: KEY, articleId: '' });
    expect(title).toBe('Dubbio');
    expect(extras).toMatchObject({
      textHash: HASH,
      passage: { quote: 'ricorso', start: 3, prefix: PLAIN.slice(0, 3), suffix: PLAIN.slice(10, 42) },
    });
    expect(extras!.passage!.start).toBe(PLAIN.indexOf('ricorso'));
    expect(extras!.articleUrn).toBeUndefined();
    expect(Object.keys(extras!).sort()).toEqual(['articleUrn', 'passage', 'textHash']);
  });

  it('after a discussion is created, the hidden copy of the surface sees the new passage too', async () => {
    const created = fullThread({ id: 't-new', passage: { quote: 'ricorso', start: 3, prefix: 'Il ', suffix: ' è fondato' } });
    vi.mocked(articleDiscussionService.create).mockResolvedValue(created);
    const summaryOfCreated = thread({ id: 't-new', passage: created.passage! });
    vi.mocked(articleDiscussionService.listPassages)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([summaryOfCreated]);
    const visible = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    const hidden = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    await waitFor(() => expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    await selectText(visible.container, 0, 3, 10);
    fireEvent.click(await screen.findByLabelText('Discuti con i colleghi'));
    fireEvent.change(screen.getByLabelText('Testo della discussione'), { target: { value: 'Il passo non convince' } });
    fireEvent.click(screen.getByRole('button', { name: /pubblica/i }));

    await waitFor(() => expect(visible.container.querySelectorAll('.vlx-sign')).toHaveLength(1));
    await waitFor(() => expect(hidden.container.querySelectorAll('.vlx-sign')).toHaveLength(1));
  });
});

describe('discussions on a decision — signs and focus', () => {
  it('a paragraph\'s sign counts its discussions in data-threads', async () => {
    vi.mocked(articleDiscussionService.listPassages).mockResolvedValue([
      thread({ id: 't1' }),
      thread({ id: 't2', passage: { quote: 'soccombenza', start: PLAIN.indexOf('soccombenza'), prefix: '', suffix: '.' } }),
      thread({ id: 't3', passage: { quote: 'ricorso', start: PLAIN.indexOf('ricorso'), prefix: 'Il ', suffix: ' è' } }),
    ]);
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    await waitFor(() => expect(container.querySelectorAll('.vlx-sign')).toHaveLength(2));
    const signs = [...container.querySelectorAll<HTMLElement>('.vlx-sign')];
    expect(signs.map((s) => s.dataset.threads)).toEqual(['1', '2']);
    expect(signs[1].getAttribute('aria-label')).toMatch(/2 discussioni/);
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(PLAIN);
  });

  it('opening a discussion from the sign lights its words, and the text still spells the projection', async () => {
    vi.mocked(articleDiscussionService.listPassages).mockResolvedValue([thread()]);
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    const sign = await waitFor(() => {
      const s = container.querySelector<HTMLElement>('.vlx-sign');
      expect(s).not.toBeNull();
      return s!;
    });
    expect(container.querySelector('.vlx-thread-focus')).toBeNull();
    fireEvent.click(sign);
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Apri discussione/ }));
    await waitFor(() => expect(container.querySelector('.vlx-thread-focus')?.textContent).toBe('spese'));
    expect(container.querySelector('.vlx-thread-focus')?.getAttribute('data-thread-focus')).toBe('t1');
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(PLAIN);
  });
});
