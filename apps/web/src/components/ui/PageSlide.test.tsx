import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageSlide } from './PageSlide';
import { ISLAND_OPEN } from '../../lib/motion';

describe('PageSlide', () => {
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
  });

  it('slides the new page in, the old one gone at once: never two pages (LC127)', () => {
    const calls: { el: Element; frames: Keyframe[]; timing: KeyframeAnimationOptions }[] = [];
    Element.prototype.animate = function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      calls.push({ el: this, frames, timing });
      return { cancel: vi.fn(), onfinish: null } as unknown as Animation;
    } as unknown as typeof Element.prototype.animate;

    const { rerender } = render(<PageSlide pageKey="/a"><p>Pagina A</p></PageSlide>);
    expect(calls).toHaveLength(0);
    rerender(<PageSlide pageKey="/b"><p>Pagina B</p></PageSlide>);

    // While the movement runs, the coming page alone.
    expect(screen.queryByText('Pagina A')).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toContainElement(screen.getByText('Pagina B'));
    expect(calls[0].frames[0]).toEqual({ opacity: 0, transform: 'translateX(24px)' });
    expect(calls[0].timing).toEqual(ISLAND_OPEN);
  });

  it('going back, makes the same movement the other way (LC84)', () => {
    const calls: { frames: Keyframe[] }[] = [];
    Element.prototype.animate = function (this: Element, frames: Keyframe[]) {
      calls.push({ frames });
      return { cancel: vi.fn(), onfinish: null } as unknown as Animation;
    } as unknown as typeof Element.prototype.animate;

    const { rerender } = render(<PageSlide pageKey="/impostazioni"><p>Impostazioni</p></PageSlide>);
    rerender(<PageSlide pageKey="/a" back><p>Pagina A</p></PageSlide>);

    expect(screen.queryByText('Impostazioni')).toBeNull();
    expect(calls.map((c) => c.frames[0])).toEqual([{ opacity: 0, transform: 'translateX(-24px)' }]);
  });

  it('a new child under the same key plays nothing', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    const { rerender } = render(<PageSlide pageKey="/a"><p>Pagina A</p></PageSlide>);
    rerender(<PageSlide pageKey="/a"><p>Pagina A, aggiornata</p></PageSlide>);
    expect(animate).not.toHaveBeenCalled();
  });

  it('without Web Animations changes the page at once', () => {
    const { rerender } = render(<PageSlide pageKey="/a"><p>Pagina A</p></PageSlide>);
    rerender(<PageSlide pageKey="/b"><p>Pagina B</p></PageSlide>);
    expect(screen.queryByText('Pagina A')).toBeNull();
    expect(screen.getByText('Pagina B')).toBeInTheDocument();
  });
});
