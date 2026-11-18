import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Arrive } from './Arrive';
import { dur, ease } from '../../lib/motion';

type Call = { el: Element; frames: Keyframe[]; timing: KeyframeAnimationOptions };

function recordAnimations(): Call[] {
  const calls: Call[] = [];
  Element.prototype.animate = function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, timing });
    return { cancel: vi.fn() } as unknown as Animation;
  } as unknown as typeof Element.prototype.animate;
  return calls;
}

const tree = (loading: boolean) => (
  <Arrive loading={loading} placeholder={<p>Segnaposto</p>}>
    <p>Contenuto</p>
  </Arrive>
);

describe('Arrive (LC98)', () => {
  const matchMedia = window.matchMedia;
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
    window.matchMedia = matchMedia;
  });

  it('holds the placeholder, then brings the content in with a fade and a small rise, in dur.pop on ease.out', () => {
    const calls = recordAnimations();
    const { rerender } = render(tree(true));
    expect(screen.getByText('Segnaposto')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    rerender(tree(false));
    expect(screen.queryByText('Segnaposto')).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].el.contains(screen.getByText('Contenuto'))).toBe(true);
    expect(calls[0].frames).toEqual([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }]);
    expect(calls[0].timing).toEqual({ duration: dur.pop * 1000, easing: `cubic-bezier(${ease.out.join(', ')})` });
  });

  it('under reduced motion only fades', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia;
    const calls = recordAnimations();
    const { rerender } = render(tree(true));
    rerender(tree(false));
    expect(calls[0].frames[0]).toEqual({ opacity: 0, transform: 'none' });
  });

  it('does not move content that was there when it mounted, nor content drawn again without a wait', () => {
    const calls = recordAnimations();
    const { rerender } = render(tree(false));
    rerender(tree(false));
    expect(calls).toHaveLength(0);
    expect(screen.getByText('Contenuto')).toBeInTheDocument();
  });
});
