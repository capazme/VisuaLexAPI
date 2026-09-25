import { describe, it, expect } from 'vitest';
import { useMemo, useRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useArticleTextInteractions } from './useArticleTextInteractions';
import { UpdateNotePopover } from '../components/features/search/UpdateNotePopover';

// Markup as utils/articleRender.ts emits it (chip outermost, a note anchor inside).
const BODY =
  '<div class="vlx-b vlx-comma">testo; ' +
  '<span class="vlx-ref" role="button" tabindex="0" data-note="119">(119)</span> ' +
  '<span class="vlx-ref" role="button" tabindex="0" data-note="154"><span class="note-anchor" data-note-id="n1">(154)</span></span>' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="0" data-notes="1" data-highlights="0"><span class="vlx-sign-notes" data-count="1"></span></span>' +
  '</div>' +
  '<div class="vlx-updates" data-open="false"><span class="vlx-updates-toggle" role="button" tabindex="0"></span>' +
  '<div class="vlx-updates-body"><div class="vlx-b vlx-update-head">AGGIORNAMENTO (119)' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="1" data-notes="0" data-highlights="1"></span></div></div></div>';

function Harness({ resetKey, contentKey = 'v1', withPopover = false }: { resetKey: string; contentKey?: string; withPopover?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { updatesOpen, openNote, closeNote, openUpdates, openBlock, closeBlock } = useArticleTextInteractions(ref, resetKey, { contentKey });
  // Stable, like SafeHTML (memoised): a new object would make React re-set innerHTML.
  const html = useMemo(() => ({ __html: BODY }), []);
  return (
    <div>
      <div ref={ref} data-testid="body" dangerouslySetInnerHTML={html} />
      <output data-testid="state">{JSON.stringify({ updatesOpen, note: openNote?.id ?? null })}</output>
      <button type="button" onClick={closeNote}>chiudi</button>
      <button type="button" onClick={openUpdates}>apri note</button>
      <output data-testid="block">{openBlock === null ? '' : String(openBlock)}</output>
      <button type="button" onClick={closeBlock}>chiudi blocco</button>
      {withPopover && openNote && (
        <UpdateNotePopover noteId={openNote.id} paragraphs={['Testo della nota.']} anchorEl={openNote.anchorEl} onClose={closeNote} />
      )}
    </div>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}');
const chip = (id: string) => screen.getByTestId('body').querySelector<HTMLElement>(`.vlx-ref[data-note="${id}"]`)!;
const toggle = () => screen.getByTestId('body').querySelector<HTMLElement>('.vlx-updates-toggle')!;
const block = () => screen.getByTestId('block').textContent;
const sign = (i: number) => screen.getByTestId('body').querySelector<HTMLElement>(`.vlx-sign[data-block="${i}"]`)!;

describe('useArticleTextInteractions', () => {
  it('opens a note from its reference and closes it on a second click', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(chip('119'));
    expect(state()).toEqual({ updatesOpen: false, note: '119' });
    fireEvent.click(chip('119'));
    expect(state().note).toBeNull();
  });

  it('opens a note with Enter on a focused reference', () => {
    render(<Harness resetKey="a" />);
    fireEvent.keyDown(chip('119'), { key: 'Enter' });
    expect(state().note).toBe('119');
  });

  it('toggles the update notes with Space and closes an open note', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(chip('119'));
    fireEvent.keyDown(toggle(), { key: ' ' });
    expect(state()).toEqual({ updatesOpen: true, note: null });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle());
    expect(state().updatesOpen).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('lets a note the reader anchored on the reference win the click', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(screen.getByTestId('body').querySelector('.note-anchor')!);
    expect(state().note).toBeNull();
  });

  it('closes on demand, and starts closed on another article', () => {
    const { rerender } = render(<Harness resetKey="a" />);
    fireEvent.click(chip('119'));
    fireEvent.click(screen.getByText('chiudi'));
    expect(state().note).toBeNull();
    fireEvent.click(toggle());
    fireEvent.click(chip('119'));
    expect(state()).toEqual({ updatesOpen: true, note: '119' });
    act(() => rerender(<Harness resetKey="b" />));
    expect(state()).toEqual({ updatesOpen: false, note: null });
  });

  it('closes an open note when the rendered text changes under it', () => {
    const { rerender } = render(<Harness resetKey="a" contentKey="v1" />);
    fireEvent.click(chip('119'));
    expect(state().note).toBe('119');
    act(() => rerender(<Harness resetKey="a" contentKey="v2" />));
    expect(state().note).toBeNull();
  });

  it('closes the note on a second real click of its chip, with the popover mounted', () => {
    render(<Harness resetKey="a" withPopover />);
    // A real click is pointerdown, mousedown, pointerup, mouseup, click: the
    // popover's outside-press dismissal must not treat the chip as outside,
    // or it closes on pointerdown and the click reopens it.
    const realClick = (el: HTMLElement) => {
      fireEvent.pointerDown(el);
      fireEvent.mouseDown(el);
      fireEvent.pointerUp(el);
      fireEvent.mouseUp(el);
      fireEvent.click(el);
    };
    realClick(chip('119'));
    expect(state().note).toBe('119');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    realClick(chip('119'));
    expect(state().note).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('unfolds the update notes on demand (a search hit inside them)', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(screen.getByText('apri note'));
    expect(state().updatesOpen).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a block from its sign, from anywhere inside it, and closes it on a second click', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(sign(0).querySelector('.vlx-sign-notes')!);
    expect(block()).toBe('0');
    fireEvent.click(sign(0));
    expect(block()).toBe('');
  });

  it('opens a block with Enter and with Space on a focused sign', () => {
    render(<Harness resetKey="a" />);
    fireEvent.keyDown(sign(0), { key: 'Enter' });
    expect(block()).toBe('0');
    fireEvent.keyDown(sign(1), { key: ' ' });
    expect(block()).toBe('1');
  });

  it('keeps one popover at a time across update notes and blocks', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(chip('119'));
    fireEvent.click(sign(0));
    expect(block()).toBe('0');
    expect(state().note).toBeNull();
    fireEvent.click(chip('119'));
    expect(state().note).toBe('119');
    expect(block()).toBe('');
  });

  it('keeps a block open when the text is redrawn, and starts closed on another article', () => {
    const { rerender } = render(<Harness resetKey="a" contentKey="v1" />);
    fireEvent.click(sign(0));
    act(() => rerender(<Harness resetKey="a" contentKey="v2" />));
    expect(block()).toBe('0');
    act(() => rerender(<Harness resetKey="b" contentKey="v2" />));
    expect(block()).toBe('');
  });

  it('closes a block on demand and when the update notes fold', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(sign(0));
    fireEvent.click(screen.getByText('chiudi blocco'));
    expect(block()).toBe('');
    fireEvent.click(sign(1));
    fireEvent.click(toggle());
    expect(block()).toBe('');
  });

  it('ignores a sign without a block index', () => {
    render(<Harness resetKey="a" />);
    sign(0).removeAttribute('data-block');
    fireEvent.click(screen.getByTestId('body').querySelector('.vlx-sign')!);
    expect(block()).toBe('');
  });

  it('ignores other keys and other elements', () => {
    render(<Harness resetKey="a" />);
    fireEvent.keyDown(chip('119'), { key: 'a' });
    fireEvent.click(screen.getByTestId('body').querySelector('.vlx-comma')!);
    expect(state()).toEqual({ updatesOpen: false, note: null });
  });
});
