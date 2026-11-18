import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PageSlide } from './PageSlide';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../lib/motion';

describe('PageSlide', () => {
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
  });

  it('slides the new page in and the old one out, then keeps only the new', () => {
    const calls: { el: Element; frames: Keyframe[]; timing: KeyframeAnimationOptions; anim: { cancel: () => void; onfinish: (() => void) | null } }[] = [];
    Element.prototype.animate = function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      const anim = { cancel: vi.fn(), onfinish: null };
      calls.push({ el: this, frames, timing, anim });
      return anim as unknown as Animation;
    } as unknown as typeof Element.prototype.animate;

    const { rerender } = render(<PageSlide pageKey="/a"><p>Pagina A</p></PageSlide>);
    expect(calls).toHaveLength(0);
    rerender(<PageSlide pageKey="/b"><p>Pagina B</p></PageSlide>);

    const coming = calls.find((c) => c.el.contains(screen.getByText('Pagina B')))!;
    const going = calls.find((c) => c.el.contains(screen.getByText('Pagina A')))!;
    expect(coming.frames[0]).toEqual({ opacity: 0, transform: 'translateX(24px)' });
    expect(coming.timing).toEqual(ISLAND_OPEN);
    expect(going.frames[1]).toEqual({ opacity: 0, transform: 'translateX(-24px)' });
    expect(going.timing).toEqual({ ...ISLAND_CLOSE, fill: 'forwards' });
    // The leaving page is no longer read or reached.
    expect(screen.getByText('Pagina A').closest('[inert]')).not.toBeNull();

    act(() => going.anim.onfinish?.());
    expect(screen.queryByText('Pagina A')).toBeNull();
    expect(screen.getByText('Pagina B')).toBeInTheDocument();
  });

  it('going back, makes the same movement the other way (LC84)', () => {
    const calls: { el: Element; frames: Keyframe[] }[] = [];
    Element.prototype.animate = function (this: Element, frames: Keyframe[]) {
      calls.push({ el: this, frames });
      return { cancel: vi.fn(), onfinish: null } as unknown as Animation;
    } as unknown as typeof Element.prototype.animate;

    const { rerender } = render(<PageSlide pageKey="/impostazioni"><p>Impostazioni</p></PageSlide>);
    rerender(<PageSlide pageKey="/a" back><p>Pagina A</p></PageSlide>);

    const coming = calls.find((c) => c.el.contains(screen.getByText('Pagina A')))!;
    const going = calls.find((c) => c.el.contains(screen.getByText('Impostazioni')))!;
    expect(coming.frames[0]).toEqual({ opacity: 0, transform: 'translateX(-24px)' });
    expect(going.frames[1]).toEqual({ opacity: 0, transform: 'translateX(24px)' });
  });

  it('without Web Animations changes the page at once', () => {
    const { rerender } = render(<PageSlide pageKey="/a"><p>Pagina A</p></PageSlide>);
    rerender(<PageSlide pageKey="/b"><p>Pagina B</p></PageSlide>);
    expect(screen.queryByText('Pagina A')).toBeNull();
    expect(screen.getByText('Pagina B')).toBeInTheDocument();
  });
});
