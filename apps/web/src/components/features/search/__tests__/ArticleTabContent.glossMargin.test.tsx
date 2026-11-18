import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleDiscussionPassageSummary, ArticleDiscussionThread } from '../../../../types';

const { listPassages, listDiscussions } = vi.hoisted(() => ({
  listPassages: vi.fn(),
  listDiscussions: vi.fn(),
}));

// The cards row reads the study cards of the article; they are not under test.
vi.mock('../../../../services/studiaService', () => ({ studiaService: { forArticle: () => Promise.resolve([]) } }));
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
import { ArticleDiscussionPanel } from '../ArticleDiscussionPanel';
import { articleDiscussionService } from '../../../../services/articleDiscussionService';
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
  target: { kind: 'article' },
  passageReleased: false,
  body: 'Discussione sulla portata del pagamento.',
  updatedAt: '2026-09-28T11:00:00Z',
  voteCount: 0,
  userVoted: false,
  isOwner: false,
  comments: [],
};

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

const wholeThread: ArticleDiscussionThread = {
  ...passageThread,
  id: 'thread-whole-1',
  title: 'Sul primo comma',
  passage: null,
  body: 'Una domanda su tutto l’articolo.',
};

function show() {
  return render(
    <MemoryRouter>
      <ArticleTabContent data={articleData} />
    </MemoryRouter>,
  );
}
const glossesButton = () => screen.getAllByRole('button', { name: /^Glosse(, \d+)?$/ })[0];

describe('ArticleTabContent — the glosses at the margin (LC74)', () => {
  beforeEach(() => {
    listPassages.mockResolvedValue([passageSummary]);
    listDiscussions.mockResolvedValue({ data: [wholeThread, passageThread], pagination: { page: 1, limit: 20, total: 7, pages: 1 } });
  });

  it('the button carries the server\'s count before the margin is opened, from the one request the margin makes', async () => {
    show();
    expect(await screen.findAllByRole('button', { name: 'Glosse, 7' })).not.toHaveLength(0);
    fireEvent.click(glossesButton());
    await screen.findByRole('region', { name: 'Glosse' });
    expect(listDiscussions).toHaveBeenCalledOnce();
  });

  it('opens in the article\'s flow, not over the page: no dialog, no portal to the body, the button pressed', async () => {
    const { container } = show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('[data-article-root]')!.contains(margin)).toBe(true);
    screen.getAllByRole('button', { name: /^Glosse(, \d+)?$/ }).forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'true'));
    expect(within(margin).getByText('Le glosse sono pubbliche nel Forum: per un appunto privato usa una nota.')).toBeInTheDocument();
  });

  it('with no room beside the text (a narrow window, a phone), opens under it and brings it into view', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    expect(container.querySelector('[data-glosses-beside]')).toBeNull();
    // After the text and its passages' status, in the article's column.
    const text = container.querySelector('.vlx-art')!;
    expect(text.compareDocumentPosition(margin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scroll).toHaveBeenCalled();
  });

  it('the composer is closed at the opening: one line opens it', async () => {
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    expect(within(margin).queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(within(margin).getByRole('button', { name: 'Scrivi una glossa…' }));
    expect(within(margin).getByRole('textbox', { name: 'Titolo della glossa' })).toHaveFocus();
  });

  it('the whole article\'s glosses first, then those on a passage, listed', async () => {
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    await within(margin).findByText('Sul primo comma');
    const order = [...margin.querySelectorAll('h4')].map((h) => h.textContent);
    expect(order).toEqual(['Sul primo comma', 'Sui passaggi', 'Chiarimento sul pagamento']);
  });

  it('with none, one line', async () => {
    listDiscussions.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
    listPassages.mockResolvedValue([]);
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    expect(await within(margin).findByText('Ancora nessuna glossa su quest’articolo')).toBeInTheDocument();
  });

  it('asks before reporting in the margin itself, not in a dialog (L-73)', async () => {
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    fireEvent.click(await within(margin).findByText('Sul primo comma'));
    fireEvent.click(within(margin).getByRole('button', { name: 'Segnala la glossa' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(margin).getByRole('group', { name: 'Segnalare ai moderatori?' })).toBeInTheDocument();
  });

  it('Esc in the composer closes the composer first, its words kept; Esc again closes the margin', async () => {
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    fireEvent.click(within(margin).getByRole('button', { name: 'Scrivi una glossa…' }));
    const title = within(margin).getByRole('textbox', { name: 'Titolo della glossa' });
    fireEvent.change(title, { target: { value: 'Una bozza' } });
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(within(margin).queryByRole('textbox', { name: 'Titolo della glossa' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Glosse' })).toBeInTheDocument();
    fireEvent.click(within(margin).getByRole('button', { name: 'Scrivi una glossa…' }));
    expect(within(margin).getByRole('textbox', { name: 'Titolo della glossa' })).toHaveValue('Una bozza');
    await act(async () => { fireEvent.keyDown(within(margin).getByRole('button', { name: 'Chiudi glosse' }), { key: 'Escape' }); });
    expect(screen.queryByRole('region', { name: 'Glosse' })).not.toBeInTheDocument();
  });

  it('the report\'s question has 44 px buttons, and its answer gives the focus back to «Segnala»', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    fireEvent.click(await within(margin).findByText('Sul primo comma'));
    const report = within(margin).getByRole('button', { name: 'Segnala la glossa' });
    fireEvent.click(report);
    const question = within(margin).getByRole('group', { name: 'Segnalare ai moderatori?' });
    for (const b of within(question).getAllByRole('button')) expect(b).toHaveClass('min-h-11', 'min-w-11');
    fireEvent.click(within(question).getByRole('button', { name: 'Annulla' }));
    expect(report).toHaveFocus();
    raf.mockRestore();
  });

  it('a gloss chosen lights its passage in the text; the passage chosen from the text lights its gloss (LC90)', async () => {
    const { container } = show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    const card = () => margin.querySelector('#article-thread-thread-passage-1')!;
    // From the margin: its words light up, the gloss is marked.
    fireEvent.click(await within(margin).findByText('Chiarimento sul pagamento'));
    expect(container.querySelector('.vlx-thread-focus')).toHaveTextContent(QUOTE);
    expect(card()).toHaveAttribute('data-lit');
    // Closed again: neither.
    fireEvent.click(within(margin).getByText('Chiarimento sul pagamento'));
    expect(container.querySelector('.vlx-thread-focus')).toBeNull();
    expect(card()).not.toHaveAttribute('data-lit');
    // From the text: the passage's sign, then its gloss.
    fireEvent.click(await screen.findByRole('button', { name: '1 glossa in questo passo' }));
    fireEvent.click(await screen.findByRole('button', { name: /apri glossa/i }));
    expect(card()).toHaveAttribute('data-lit');
    expect(container.querySelector('.vlx-thread-focus')).toHaveTextContent(QUOTE);
  });

  it('after «Pubblica» the focus goes to the gloss published, not to the page (LC90)', async () => {
    const published = { ...wholeThread, id: 'thread-new', title: 'Una glossa nuova', isOwner: true };
    vi.mocked(articleDiscussionService.create).mockResolvedValue(published);
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    fireEvent.click(within(margin).getByRole('button', { name: 'Scrivi una glossa…' }));
    fireEvent.change(within(margin).getByRole('textbox', { name: 'Titolo della glossa' }), { target: { value: 'Una glossa nuova' } });
    fireEvent.change(within(margin).getByRole('textbox', { name: 'Testo della glossa' }), { target: { value: 'Il testo.' } });
    await act(async () => { fireEvent.click(within(margin).getByRole('button', { name: 'Pubblica' })); });
    expect(document.activeElement?.closest('article')).toHaveAttribute('id', 'article-thread-thread-new');
  });

  it('a gloss with the focus keeps it as the glosses on a passage are drawn again aligned (under the text, then beside it)', async () => {
    const anchor = { normaKey: 'legge--241--1990-08-07--1', articleId: '1', articleLabel: '1', version: 'vigente' };
    const textRootRef = { current: document.createElement('div') };
    const panel = (aligned: boolean) => (
      <ArticleDiscussionPanel
        layout="margin"
        isOpen
        anchor={anchor}
        onClose={vi.fn()}
        align={aligned ? { textRootRef, located: [{ thread: passageSummary, start: START, end: START + QUOTE.length }], contentKey: 'v1' } : undefined}
      />
    );
    const { rerender } = render(panel(false));
    const toggle = await screen.findByRole('button', { name: /Chiarimento sul pagamento/ });
    toggle.focus();
    rerender(panel(true));
    // Another element (the aligned list), the same gloss.
    expect(document.activeElement).not.toBe(toggle);
    expect(document.activeElement?.closest('article')).toHaveAttribute('id', 'article-thread-thread-passage-1');
  });

  it('closes from its «Chiudi», the focus back on the button', async () => {
    show();
    fireEvent.click(glossesButton());
    const margin = await screen.findByRole('region', { name: 'Glosse' });
    const close = within(margin).getByRole('button', { name: 'Chiudi glosse' });
    close.focus();
    await act(async () => { fireEvent.click(close); });
    expect(screen.queryByRole('region', { name: 'Glosse' })).not.toBeInTheDocument();
    screen.getAllByRole('button', { name: /^Glosse(, \d+)?$/ }).forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'));
  });
});
