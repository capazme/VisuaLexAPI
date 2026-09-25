import { describe, it, expect } from 'vitest';
import { useMemo, useRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useArticleTextInteractions } from './useArticleTextInteractions';

// Markup as utils/articleRender.ts emits it (chip outermost, a note anchor inside).
const BODY =
  '<div class="vlx-b vlx-comma">testo; ' +
  '<span class="vlx-ref" role="button" tabindex="0" data-note="119">(119)</span> ' +
  '<span class="vlx-ref" role="button" tabindex="0" data-note="154"><span class="note-anchor" data-note-id="n1">(154)</span></span>' +
  '</div>' +
  '<div class="vlx-updates" data-open="false"><span class="vlx-updates-toggle" role="button" tabindex="0"></span>' +
  '<div class="vlx-updates-body"><div class="vlx-b vlx-update-head">AGGIORNAMENTO (119)</div></div></div>';

function Harness({ resetKey, contentKey = 'v1' }: { resetKey: string; contentKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { updatesOpen, openNote, closeNote } = useArticleTextInteractions(ref, resetKey, { contentKey });
  // Stable, like SafeHTML (memoised): a new object would make React re-set innerHTML.
  const html = useMemo(() => ({ __html: BODY }), []);
  return (
    <div>
      <div ref={ref} data-testid="body" dangerouslySetInnerHTML={html} />
      <output data-testid="state">{JSON.stringify({ updatesOpen, note: openNote?.id ?? null })}</output>
      <button type="button" onClick={closeNote}>chiudi</button>
    </div>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}');
const chip = (id: string) => screen.getByTestId('body').querySelector<HTMLElement>(`.vlx-ref[data-note="${id}"]`)!;
const toggle = () => screen.getByTestId('body').querySelector<HTMLElement>('.vlx-updates-toggle')!;

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

  it('ignores other keys and other elements', () => {
    render(<Harness resetKey="a" />);
    fireEvent.keyDown(chip('119'), { key: 'a' });
    fireEvent.click(screen.getByTestId('body').querySelector('.vlx-comma')!);
    expect(state()).toEqual({ updatesOpen: false, note: null });
  });
});
