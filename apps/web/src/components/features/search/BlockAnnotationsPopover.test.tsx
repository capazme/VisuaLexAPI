import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { BlockAnnotationsPopover, type BlockAnnotationsPopoverProps } from './BlockAnnotationsPopover';
import { renderArticleHtml } from '../../../utils/articleRender';
import { parseArticleStructure } from '../../../utils/articleStructure';
import { describeBlock, groupAnnotationsByBlock, type LocatedThread } from '../../../utils/articleAnnotations';
import { sanitizeHTML } from '../../../utils/sanitizeHtml';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import { buildPassage } from '../../../utils/threadPassages';
import type { Annotation, Highlight, ArticleDiscussionPassageSummary } from '../../../types';
// The scroll: its own tests (`scrollParent.test.ts`); here, which anchor it is asked for.
vi.mock('../../../utils/scrollParent', () => ({ scrollToMiddle: vi.fn() }));
import { scrollToMiddle } from '../../../utils/scrollParent';

const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const STRUCTURE = parseArticleStructure(RAW);
const n1: Annotation = {
  id: 'n1', normaKey: 'k', articleId: '1', text: 'Vedi Cass. 2020', createdAt: '2026-09-25',
  anchorText: 'prestazioni corrispettive', startOffset: PLAIN.indexOf('prestazioni corrispettive'),
};
const h1: Highlight = {
  id: 'h1', normaKey: 'k', articleId: '1', rangeSerialized: '', text: 'risarcimento del danno', color: 'green',
  startOffset: PLAIN.indexOf('risarcimento del danno'),
};
const TITLE = 'Annotazioni · Nei contratti con prestazioni corrispettive…';

function createDummyThread(over: Partial<ArticleDiscussionPassageSummary> = {}): ArticleDiscussionPassageSummary {
  const quote = 'prestazioni corrispettive';
  const start = PLAIN.indexOf(quote);
  return {
    id: 't1',
    title: 'Disputa sulla risoluzione',
    passage: buildPassage(PLAIN, start, quote)!,
    articleUrn: 'urn:nir:stato:legge:1942;262~art1453',
    textHash: 'hash-orig',
    commentCount: 1,
    createdAt: '2026-09-28',
    user: { id: 'u1', username: 'marta' },
    ...over,
  };
}

function setup(
  highlights: Highlight[] = [h1],
  annotations: Annotation[] = [n1],
  over: Partial<BlockAnnotationsPopoverProps> = {},
  threads: ArticleDiscussionPassageSummary[] = [],
) {
  const container = document.createElement('div');
  const locatedThreads: LocatedThread[] = threads.map((t) => ({
    thread: t,
    start: t.passage.start,
    end: t.passage.start + t.passage.quote.length,
  }));
  const draw = () => {
    container.innerHTML = sanitizeHTML(
      renderArticleHtml({
        raw: RAW,
        structure: STRUCTURE,
        highlights,
        annotations,
        threads: locatedThreads,
        signs: true,
      }),
    );
  };
  draw();
  document.body.appendChild(container);
  const props: BlockAnnotationsPopoverProps = {
    containerRef: { current: container },
    blockIndex: 2,
    blockLabel: describeBlock(RAW, STRUCTURE.blocks[2]),
    group: groupAnnotationsByBlock(RAW, STRUCTURE, highlights, annotations, locatedThreads)[2],
    contentKey: 'v1',
    onClose: vi.fn(), onUpdateNote: vi.fn(), onRemoveNote: vi.fn(), onRemoveHighlight: vi.fn(),
    ...over,
  };
  const utils = render(<BlockAnnotationsPopover {...props} />);
  const sign = () => container.querySelector<HTMLElement>('.vlx-sign[data-block="2"]')!;
  // RTL's own `container` must not shadow the article container.
  return { ...utils, container, props, sign, draw };
}

describe('BlockAnnotationsPopover', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('lists the block\'s notes, then its highlights, under the block\'s own words', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(within(dialog).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Note', 'Evidenziazioni']);
    expect(within(dialog).getByText('Vedi Cass. 2020')).toBeInTheDocument();
    expect(within(dialog).getByText(/risarcimento del danno/)).toBeInTheDocument();
  });

  describe('the passages an application proposed (D7b)', () => {
    const p1: Highlight = {
      id: 'p1', normaKey: 'k', articleId: '1', rangeSerialized: '', text: 'contraenti', color: 'yellow',
      startOffset: PLAIN.indexOf('contraenti'),
      proposal: { clientName: 'Claude Code', note: 'La parte non inadempiente.', state: 'pending', reviewComment: null, originalNote: null },
    };
    const actions = () => ({ validate: vi.fn(), flag: vi.fn(), comment: vi.fn(), editNote: vi.fn(), remove: vi.fn() });

    it('come first, each acting on its own id', async () => {
      const proposalActions = actions();
      setup([h1, p1], [n1], { proposalActions });
      const dialog = await screen.findByRole('dialog', { name: TITLE });
      expect(within(dialog).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(["Proposte dell'IA", 'Note', 'Evidenziazioni']);
      expect(within(dialog).getByText('La parte non inadempiente.')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('checkbox', { name: "Proposto dall'IA, confermi?" }));
      expect(proposalActions.validate).toHaveBeenCalledWith('p1', true);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Da rivedere' }));
      expect(proposalActions.flag).toHaveBeenCalledWith('p1', true);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Modifica la nota del passaggio' }));
      const box = within(dialog).getByRole('textbox', { name: 'Nota del passaggio' });
      fireEvent.change(box, { target: { value: 'Il creditore.' } });
      fireEvent.blur(box);
      expect(proposalActions.editNote).toHaveBeenCalledWith('p1', 'Il creditore.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rimuovi il passaggio' }));
      expect(proposalActions.remove).toHaveBeenCalledWith('p1');
    });

    it('«Cosa non va?» goes to its own id', async () => {
      const proposalActions = actions();
      setup([{ ...p1, proposal: { ...p1.proposal!, state: 'review' } }], [], { proposalActions });
      const dialog = await screen.findByRole('dialog', { name: TITLE });
      const field = within(dialog).getByRole('textbox', { name: 'Cosa non va?' });
      fireEvent.change(field, { target: { value: 'Il passo è un altro.' } });
      fireEvent.blur(field);
      expect(proposalActions.comment).toHaveBeenCalledWith('p1', 'Il passo è un altro.');
    });

    it('the last one removed closes the popover, as any last annotation; another stays', async () => {
      const first = setup([h1, p1], [], { proposalActions: actions() });
      let dialog = await screen.findByRole('dialog', { name: TITLE });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rimuovi il passaggio' }));
      expect(first.props.onClose).not.toHaveBeenCalled();
      first.unmount();
      document.body.innerHTML = '';
      const only = setup([p1], [], { proposalActions: actions() });
      dialog = await screen.findByRole('dialog', { name: TITLE });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rimuovi il passaggio' }));
      expect(only.props.onClose).toHaveBeenCalled();
    });

    it('a validated one stays listed with them, ticked, so it can be unticked', async () => {
      const proposalActions = actions();
      setup([{ ...p1, proposal: { ...p1.proposal!, state: 'validated' } }], [], { proposalActions });
      const dialog = await screen.findByRole('dialog', { name: TITLE });
      const box = within(dialog).getByRole('checkbox', { name: 'Validato' });
      expect(box).toBeChecked();
      fireEvent.click(box);
      expect(proposalActions.validate).toHaveBeenCalledWith('p1', false);
    });

    it('a reader that cannot act on them lists none apart', async () => {
      setup([h1, p1], [n1]);
      const dialog = await screen.findByRole('dialog', { name: TITLE });
      expect(within(dialog).queryByRole('checkbox')).toBeNull();
      expect(within(dialog).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Note', 'Evidenziazioni']);
    });
  });

  it('"Vai al passo" closes, scrolls the text to the anchor and makes it flash', async () => {
    const { container, props } = setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    vi.useFakeTimers();
    fireEvent.click(within(dialog).getAllByRole('button', { name: /Vai al passo/ })[0]);
    const anchor = container.querySelector('[data-note-id="n1"]')!;
    expect(props.onClose).toHaveBeenCalled();
    expect(scrollToMiddle).toHaveBeenCalledExactlyOnceWith(anchor, 'smooth');
    expect(anchor.classList.contains('vlx-flash')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(anchor.classList.contains('vlx-flash')).toBe(false);
  });

  it('edits a note in place', async () => {
    const { props } = setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vedi Cass. 2020' }));
    const box = within(dialog).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Vedi Cass. 2021' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(props.onUpdateNote).toHaveBeenCalledWith('n1', 'Vedi Cass. 2021');
  });

  it('removes a highlight and stays open; the last annotation closes it', async () => {
    const first = setup();
    let dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rimuovi/ }));
    expect(first.props.onRemoveHighlight).toHaveBeenCalledWith('h1');
    expect(first.props.onClose).not.toHaveBeenCalled();
    first.unmount();
    document.body.innerHTML = '';
    const only = setup([h1], []);
    dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rimuovi/ }));
    expect(only.props.onClose).toHaveBeenCalled();
  });

  it('closes on Escape and gives focus back to its sign', async () => {
    const { props, sign, unmount } = setup();
    await screen.findByRole('dialog', { name: TITLE });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(sign()));
  });

  it('takes the focus when it opens, so Tab goes through its buttons', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('holds keyboard and screen-reader focus while open: the text behind is hidden from them', async () => {
    const { container } = setup();
    await screen.findByRole('dialog', { name: TITLE });
    await waitFor(() => expect(container.getAttribute('aria-hidden')).toBe('true'));
  });

  it('does not treat a press on its own sign as outside, but does elsewhere', async () => {
    const { props, sign } = setup();
    await screen.findByRole('dialog', { name: TITLE });
    fireEvent.pointerDown(sign());
    fireEvent.mouseDown(sign());
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('follows its sign when the text is redrawn under it', async () => {
    const { props, sign, draw, rerender } = setup();
    await screen.findByRole('dialog', { name: TITLE });
    const old = sign();
    draw();
    const fresh = sign();
    expect(fresh).not.toBe(old);
    const measure = vi.spyOn(fresh, 'getBoundingClientRect');
    rerender(<BlockAnnotationsPopover {...props} contentKey="v2" />);
    await waitFor(() => expect(measure).toHaveBeenCalled());
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('credits an imported highlight to its author', async () => {
    setup([{ ...h1, sourceSuggestionId: 's1', originalAuthor: { id: 'u', username: 'marta' } }], []);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(within(dialog).getByTitle('Suggerita da @marta')).toBeInTheDocument();
  });

  it('shows the Glosse section with quote, author, comment count and Apri glossa button', async () => {
    const thread = createDummyThread({ commentCount: 1 });
    const onOpenThread = vi.fn();
    const { props } = setup([], [], { onOpenThread }, [thread]);
    const dialog = await screen.findByRole('dialog', { name: TITLE });

    expect(within(dialog).getByRole('heading', { level: 4, name: 'Glosse' })).toBeInTheDocument();
    expect(within(dialog).getByText('“prestazioni corrispettive”')).toBeInTheDocument();
    expect(within(dialog).getByText('Disputa sulla risoluzione')).toBeInTheDocument();
    expect(within(dialog).getByText(/@marta · 1 risposta/)).toBeInTheDocument();

    const openBtn = within(dialog).getByRole('button', { name: /Apri glossa/ });
    fireEvent.click(openBtn);
    expect(props.onClose).toHaveBeenCalled();
    expect(onOpenThread).toHaveBeenCalledWith('t1');
  });

  it('shows changed-text notice only when thread textHash and textHash prop differ', async () => {
    const thread = createDummyThread({ textHash: 'hash-orig' });

    // Same hash -> no notice
    const same = setup([], [], { textHash: 'hash-orig' }, [thread]);
    let dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(within(dialog).queryByText(/Il testo è cambiato/)).not.toBeInTheDocument();
    same.unmount();
    document.body.innerHTML = '';

    // Different hash -> notice shown
    setup([], [], { textHash: 'hash-different' }, [thread]);
    dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(within(dialog).getByText('Il testo è cambiato da quando è stata aperta')).toBeInTheDocument();
  });

  it('removing the last highlight of a block that still has a thread does not close the popover', async () => {
    const thread = createDummyThread();
    const { props } = setup([h1], [], {}, [thread]);
    const dialog = await screen.findByRole('dialog', { name: TITLE });

    fireEvent.click(within(dialog).getByRole('button', { name: /Rimuovi/ }));
    expect(props.onRemoveHighlight).toHaveBeenCalledWith('h1');
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
