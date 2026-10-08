import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { appStore } from '../../../store/useAppStore';
import type { ArticleDiscussionPassageSummary } from '../../../types';
import type { DecisionIdentity, DecisionText } from '../../../types/decisions';
import { decisionProjection } from '../../../utils/decisionRender';
import { articleDiscussionService } from '../../../services/articleDiscussionService';
import { DecisionReadingSurface } from './DecisionReadingSurface';
import { DecisionReadingToolbar } from './DecisionReadingToolbar';
import { DecisionView } from './DecisionView';

vi.mock('../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: vi.fn(),
    listPassages: vi.fn(),
    create: vi.fn(),
    comment: vi.fn(),
  },
}));
vi.mock('../../../services/authService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/authService')>()),
  isAuthenticated: () => true,
}));

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };
const KEY = 'cassazione:civile:99999:2024';
const TESTO: DecisionText = { motivazione: 'Il ricorso è fondato.\n\nLe spese seguono la soccombenza.' };
const PLAIN = decisionProjection(TESTO);
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
} as ArticleDiscussionPassageSummary);

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
  appStore.setState({
    searchTrigger: null, readingBackStack: [], workspaceTabs: [], highlights: [], annotations: [],
    loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(),
  });
  vi.mocked(articleDiscussionService.listPassages).mockResolvedValue([]);
  vi.mocked(articleDiscussionService.list).mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
});

describe('discussions on a decision — what shows them', () => {
  it('the toolbar draws the button only when it is given the toggle, as a 44px target', () => {
    const base = {
      notesCount: 0, highlightsCount: 0, isNotesOpen: false, isHighlightsOpen: false,
      onToggleNotes: vi.fn(), onToggleHighlights: vi.fn(),
    };
    const { rerender } = render(<DecisionReadingToolbar {...base} />);
    expect(screen.queryByRole('button', { name: 'Discussioni sulla decisione' })).toBeNull();
    const onToggleDiscussion = vi.fn();
    rerender(<DecisionReadingToolbar {...base} onToggleDiscussion={onToggleDiscussion} />);
    const button = screen.getByRole('button', { name: 'Discussioni sulla decisione' });
    expect(button.className).toContain('min-h-[44px]');
    fireEvent.click(button);
    expect(onToggleDiscussion).toHaveBeenCalled();
  });

  it('a found decision shows the button and «Discuti»; a reference with no identity shows neither and asks nothing', async () => {
    const { container, unmount } = render(
      <DecisionView
        answer={{ esito: 'trovata', identita: IDENTITY, attributi: {}, testo: TESTO, avvisi: [], fonte: { nome: 'Italgiure', url: 'https://x', licenza: 'x' } } as never}
        reference={IDENTITY}
        onRetry={() => {}} onChooseCandidate={() => {}} onOpenPalette={() => {}}
        textSlot={<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />}
      />,
    );
    expect(screen.getByRole('button', { name: 'Discussioni sulla decisione' })).toBeInTheDocument();
    await selectText(container, 0, 3, 10);
    expect(await screen.findByLabelText('Discuti con i colleghi')).toBeInTheDocument();
    unmount();

    render(
      <DecisionView
        answer={{ esito: 'ambigua', candidati: [{ identita: IDENTITY, attributi: {} }] } as never}
        reference={IDENTITY}
        onRetry={() => {}} onChooseCandidate={() => {}} onOpenPalette={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Discussioni sulla decisione' })).toBeNull();
    expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(1); // the found one only
  });
});

describe('discussions on a decision — the passage', () => {
  it('«Discuti» opens the composer on the words and creates under the key, with no article and the projection hash', async () => {
    vi.mocked(articleDiscussionService.create).mockResolvedValue({
      id: 'new', title: 'Dubbio', body: 'x', passage: null, comments: [], user: { id: 'u1', username: 'marta' },
      createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z', voteCount: 0, userVoted: false, isOwner: true,
    } as never);
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
    expect(anchor).toMatchObject({ normaKey: KEY, articleId: '' });
    expect(title).toBe('Dubbio');
    expect(extras).toMatchObject({
      textHash: HASH,
      passage: { quote: 'ricorso', start: 3, prefix: PLAIN.slice(0, 3), suffix: PLAIN.slice(10, 42) },
    });
    expect(extras!.passage!.start).toBe(PLAIN.indexOf('ricorso'));
    expect(extras!.articleUrn).toBeUndefined();
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
