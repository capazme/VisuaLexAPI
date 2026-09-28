import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { BlockAnnotationsPopover, type BlockAnnotationsPopoverProps } from './BlockAnnotationsPopover';
import { renderArticleHtml } from '../../../utils/articleRender';
import { parseArticleStructure } from '../../../utils/articleStructure';
import { describeBlock, groupAnnotationsByBlock } from '../../../utils/articleAnnotations';
import { sanitizeHTML } from '../../../utils/sanitizeHtml';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import type { Annotation, Highlight } from '../../../types';

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

function setup(highlights: Highlight[] = [h1], annotations: Annotation[] = [n1], over: Partial<BlockAnnotationsPopoverProps> = {}) {
  const container = document.createElement('div');
  const draw = () => {
    container.innerHTML = sanitizeHTML(renderArticleHtml({ raw: RAW, structure: STRUCTURE, highlights, annotations, signs: true }));
  };
  draw();
  document.body.appendChild(container);
  const props: BlockAnnotationsPopoverProps = {
    containerRef: { current: container },
    blockIndex: 2,
    blockLabel: describeBlock(RAW, STRUCTURE.blocks[2]),
    group: groupAnnotationsByBlock(RAW, STRUCTURE, highlights, annotations)[2],
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

  it('"Vai al passo" closes, scrolls the text to the anchor and makes it flash', async () => {
    const { container, props } = setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    vi.useFakeTimers();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    fireEvent.click(within(dialog).getAllByRole('button', { name: /Vai al passo/ })[0]);
    const anchor = container.querySelector('[data-note-id="n1"]')!;
    expect(props.onClose).toHaveBeenCalled();
    expect(scroll.mock.contexts[0]).toBe(anchor);
    expect(anchor.classList.contains('vlx-flash')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(anchor.classList.contains('vlx-flash')).toBe(false);
    scroll.mockRestore();
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
});
