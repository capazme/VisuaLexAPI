import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Expand } from './Expand';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../lib/motion';

interface Call { el: Element; frames: Keyframe[]; timing: KeyframeAnimationOptions; anim: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null } }
let calls: Call[] = [];
const originalMatchMedia = window.matchMedia;

function stubAnimate() {
  calls = [];
  Element.prototype.animate = function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    const anim = { cancel: vi.fn(), onfinish: null as (() => void) | null };
    calls.push({ el: this, frames, timing, anim });
    return anim as unknown as Animation;
  } as unknown as typeof Element.prototype.animate;
}
const heights = () => calls.filter((c) => 'height' in c.frames[0]);
const fades = () => calls.filter((c) => 'opacity' in c.frames[0]);
const finishAll = () => act(() => calls.forEach((c) => c.anim.onfinish?.()));

function Harness({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls="space" onClick={() => setOpen((o) => !o)}>Apri</button>
      <Expand id="space" open={open} onClose={() => setOpen(false)}>
        <button type="button">Prima</button>
        <input aria-label="Campo" />
      </Expand>
      <p>Il resto della pagina</p>
    </>
  );
}

describe('Expand', () => {
  beforeEach(() => {
    stubAnimate();
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 120 });
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
    window.matchMedia = originalMatchMedia;
  });

  it('opens in the page, before what follows, growing from no height to its own on the island’s opening', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    const field = screen.getByRole('textbox', { name: 'Campo' });
    // In the flow: between its command and the rest of the page, not portalled.
    expect(screen.getByRole('button', { name: 'Apri' }).compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.compareDocumentPosition(screen.getByText('Il resto della pagina')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heights()).toHaveLength(1);
    expect(heights()[0].frames).toEqual([{ height: '0px' }, { height: '120px' }]);
    expect(heights()[0].timing).toEqual(expect.objectContaining(ISLAND_OPEN));
    // The natural height is not held: content arriving later still grows it.
    expect(heights()[0].timing.fill).toBe('none');
    expect(fades()[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it('closes to no height on the island’s closing, and leaves the page once it has', () => {
    render(<Harness initial />);
    // Already open: nothing moves on mounting.
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    expect(heights()[0].frames).toEqual([{ height: '120px' }, { height: '0px' }]);
    expect(heights()[0].timing).toEqual(expect.objectContaining({ ...ISLAND_CLOSE, fill: 'forwards' }));
    expect(fades()[0].frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    // Going: still drawn, no longer reached.
    expect(screen.getByRole('textbox', { name: 'Campo', hidden: true }).closest('[inert]')).not.toBeNull();
    finishAll();
    expect(screen.queryByRole('textbox', { name: 'Campo', hidden: true })).toBeNull();
  });

  it('turned back halfway, starts from where it is', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 47 } as DOMRect);
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Apri' });
    fireEvent.click(button);
    const opening = [...calls];
    fireEvent.click(button);
    opening.forEach((c) => expect(c.anim.cancel).toHaveBeenCalled());
    expect(heights()[1].frames).toEqual([{ height: '47px' }, { height: '0px' }]);
    // The opening's late finish does not unmount the closing one.
    act(() => opening.forEach((c) => c.anim.onfinish?.()));
    expect(screen.getByRole('textbox', { name: 'Campo', hidden: true })).toBeInTheDocument();
    rect.mockRestore();
  });

  it('under reduced motion only fades', () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia;
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    expect(heights()).toHaveLength(0);
    expect(fades()).toHaveLength(1);
    // Closing, the app's brief fade, not the island's time: no space left standing empty.
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    expect(fades()).toHaveLength(2);
    expect(fades()[1].timing).toMatchObject({ duration: 150, easing: 'linear' });
  });

  it('gives the focus to the space itself on opening, never to a field, and back to its command on closing (LC105)', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Apri' });
    button.focus();
    fireEvent.click(button);
    expect(document.getElementById('space')).toHaveFocus();
    expect(document.getElementById('space')).toHaveAttribute('tabindex', '-1');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Campo' }), { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('drawn already open, takes no focus: the focus follows an opening (LC86)', () => {
    render(<Harness initial />);
    expect(screen.getByRole('textbox', { name: 'Campo' })).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves an Esc already taken inside it alone', () => {
    render(<Harness initial />);
    const field = screen.getByRole('textbox', { name: 'Campo' });
    field.addEventListener('keydown', (e) => e.preventDefault());
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Apri' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('open, follows its content growing (a tree arriving late) from where it is instead of jumping', () => {
    let notify: () => void = () => {};
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 60 } as DOMRect);
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
      const opening = heights()[0];
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 400 });
      act(() => notify());
      expect(opening.anim.cancel).toHaveBeenCalled();
      expect(heights()[1].frames).toEqual([{ height: '60px' }, { height: '400px' }]);
      expect(heights()[1].timing).toEqual(expect.objectContaining(ISLAND_OPEN));
    } finally {
      rect.mockRestore();
      globalThis.ResizeObserver = original;
    }
  });

  it('open and at rest, follows content arriving later from the height it had, not from the new one (LC86)', () => {
    let notify: () => void = () => {};
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
    // The observer runs after the layout: the space already measures the new height when it is told.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect);
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
      finishAll();
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 400 });
      act(() => notify());
      expect(heights().at(-1)!.frames).toEqual([{ height: '120px' }, { height: '400px' }]);
      expect(heights().at(-1)!.timing).toEqual(expect.objectContaining(ISLAND_OPEN));
      // Held at the height it had until the animation applies (the next frame), then let go.
      const space = document.getElementById('space')!;
      expect(space.style.height).toBe('120px');
      finishAll();
      expect(space.style.height).toBe('');
    } finally {
      rect.mockRestore();
      globalThis.ResizeObserver = original;
    }
  });

  it('on opening comes into view from its start, smoothly, and at once under reduced motion', () => {
    let heightsAtScroll = -1;
    const scroll = vi.fn(() => { heightsAtScroll = heights().length; });
    Element.prototype.scrollIntoView = scroll;
    try {
      render(<Harness />);
      const button = screen.getByRole('button', { name: 'Apri' });
      fireEvent.click(button);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(screen.getByRole('textbox', { name: 'Campo' }).closest('#space'));
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
      // Brought into view while it has its natural height, before the opening starts from none.
      expect(heightsAtScroll).toBe(0);
      fireEvent.click(button);
      expect(scroll).toHaveBeenCalledTimes(1);
      window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia;
      fireEvent.click(button);
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' });
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('without Web Animations opens and closes at once', () => {
    delete (Element.prototype as Partial<Element>).animate;
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Apri' });
    fireEvent.click(button);
    expect(screen.getByRole('textbox', { name: 'Campo' })).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole('textbox', { name: 'Campo', hidden: true })).toBeNull();
  });

  // LC105: the study settings, read once before the first opening.
  it('kept mounted, is drawn hidden while closed and opens again from no height', () => {
    function Kept() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>Apri</button>
          <Expand id="kept" open={open} keepMounted><input aria-label="Campo" /></Expand>
        </>
      );
    }
    render(<Kept />);
    const space = document.getElementById('kept')!;
    expect(space).toHaveAttribute('hidden');
    expect(screen.getByRole('textbox', { name: 'Campo', hidden: true })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Apri' });
    fireEvent.click(button);
    expect(space).not.toHaveAttribute('hidden');
    finishAll();
    fireEvent.click(button);
    finishAll();
    expect(space).toHaveAttribute('hidden');
    const closing = heights()[1].anim;
    // The closing's fill is cancelled by the next opening, which starts where it held the space.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 0 } as DOMRect);
    fireEvent.click(button);
    rect.mockRestore();
    expect(closing.cancel).toHaveBeenCalled();
    expect(heights()[2].frames).toEqual([{ height: '0px' }, { height: '120px' }]);
  });

  // LC105: at rest nothing is cut (a focus ring at its edges), while the height moves it is clipped on the height alone.
  it('clips its height only while it moves, with clip, and nothing at rest', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Apri' });
    fireEvent.click(button);
    const space = document.getElementById('space')!;
    expect(space.style.overflowY).toBe('clip');
    expect(space).not.toHaveClass('overflow-hidden');
    finishAll();
    expect(space.style.overflowY).toBe('');
    fireEvent.click(button);
    expect(space.style.overflowY).toBe('clip');
  });

  // LC105, Papiniano on #637: StrictMode runs the effect twice on mounting; a space kept mounted closed played a closing.
  it('kept mounted and closed, plays no closing when its effect runs again', () => {
    render(
      <StrictMode>
        <Expand id="kept" open={false} keepMounted><p>x</p></Expand>
      </StrictMode>,
    );
    expect(calls).toHaveLength(0);
  });
});
