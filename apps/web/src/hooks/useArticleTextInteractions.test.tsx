import { describe, it, expect } from 'vitest';
import { useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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

function Harness({ resetKey, contentKey = 'v1', withPopover = false, updatesOpenByDefault }: {
  resetKey: string; contentKey?: string; withPopover?: boolean; updatesOpenByDefault?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { updatesOpen, openNote, closeNote, openUpdates, openBlock, closeBlock } = useArticleTextInteractions(ref, resetKey, {
    contentKey,
    updatesOpenByDefault,
  });
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

  it('forgets an open block or note when the reader comes back to the article', () => {
    const { rerender } = render(<Harness resetKey="a" />);
    fireEvent.click(sign(0));
    act(() => rerender(<Harness resetKey="b" />));
    act(() => rerender(<Harness resetKey="a" />));
    expect(block()).toBe('');
    fireEvent.click(chip('119'));
    act(() => rerender(<Harness resetKey="b" />));
    act(() => rerender(<Harness resetKey="a" />));
    expect(state().note).toBeNull();
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

  it('answers a press on a sign from the moment the sign is on screen', async () => {
    // Outside act, as when a fetch settles in the app: React commits the markup
    // and runs passive effects in a later task. Pressing the sign in between —
    // a busy runner reaching the click before that task — must still open it.
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    try {
      const pressed = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          const target = host.querySelector('.vlx-sign[data-block="0"]');
          if (!target) return;
          observer.disconnect();
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          resolve();
        });
        observer.observe(host, { childList: true, subtree: true });
      });
      root.render(<Harness resetKey="a" />);
      await pressed;
      await waitFor(() => expect(block()).toBe('0'));
    } finally {
      root.unmount();
      host.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });

  it('ignores other keys and other elements', () => {
    render(<Harness resetKey="a" />);
    fireEvent.keyDown(chip('119'), { key: 'a' });
    fireEvent.click(screen.getByTestId('body').querySelector('.vlx-comma')!);
    expect(state()).toEqual({ updatesOpen: false, note: null });
  });
});

describe('useArticleTextInteractions — update notes open by default (a past text)', () => {
  it('starts open, tells the toggle so, and lets it close and open them', () => {
    render(<Harness resetKey="a" updatesOpenByDefault />);
    expect(state().updatesOpen).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle());
    expect(state().updatesOpen).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    expect(state().updatesOpen).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('goes back to open, not to closed, on another article and when the reader comes back', () => {
    const { rerender } = render(<Harness resetKey="a" updatesOpenByDefault />);
    fireEvent.click(toggle());
    expect(state().updatesOpen).toBe(false);
    act(() => rerender(<Harness resetKey="b" updatesOpenByDefault />));
    expect(state().updatesOpen).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle());
    act(() => rerender(<Harness resetKey="a" updatesOpenByDefault />));
    expect(state().updatesOpen).toBe(true);
  });

  it('keeps them open when a note or a block is closed, and when a note is opened', () => {
    render(<Harness resetKey="a" updatesOpenByDefault />);
    fireEvent.click(chip('119'));
    expect(state()).toEqual({ updatesOpen: true, note: '119' });
    fireEvent.click(screen.getByText('chiudi'));
    expect(state().updatesOpen).toBe(true);
    fireEvent.click(sign(0));
    fireEvent.click(screen.getByText('chiudi blocco'));
    expect(state().updatesOpen).toBe(true);
    fireEvent.click(screen.getByText('apri note'));
    expect(state().updatesOpen).toBe(true);
  });

  it('opens them on demand after the reader closed them', () => {
    render(<Harness resetKey="a" updatesOpenByDefault />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByText('apri note'));
    expect(state().updatesOpen).toBe(true);
  });

  it('follows the default when the same article is shown as another version', () => {
    const { rerender } = render(<Harness resetKey="a" />);
    expect(state().updatesOpen).toBe(false);
    act(() => rerender(<Harness resetKey="a" updatesOpenByDefault />));
    expect(state().updatesOpen).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => rerender(<Harness resetKey="a" />));
    expect(state().updatesOpen).toBe(false);
  });

  it('is closed by default when the option is absent or false', () => {
    const { rerender } = render(<Harness resetKey="a" />);
    expect(state().updatesOpen).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    act(() => rerender(<Harness resetKey="b" updatesOpenByDefault={false} />));
    expect(state().updatesOpen).toBe(false);
  });
});
