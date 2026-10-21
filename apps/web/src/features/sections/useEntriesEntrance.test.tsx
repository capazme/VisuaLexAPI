import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { SectionId } from './sections';
import { CASCADE_STEP_MS, ENTRY_FADE_MS, useEntriesEntrance } from './useEntriesEntrance';

function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

/** The sidebar's section group as `Sidebar` draws it: Gymnasium's two named subgroups, the others' flat entries. */
function Group({ section }: { section: SectionId }) {
  const ref = useEntriesEntrance(section);
  return (
    <div ref={ref} role="group" aria-label={section}>
      {section === 'gymnasium' ? (
        <>
          <div role="group" aria-label="Studia">
            <p>Studia</p>
            <a href="/studia/ripasso">Oggi</a>
            <a href="/studia/progressi">Progressi</a>
            <a href="/dossier">Dossier</a>
          </div>
          <div aria-hidden />
          <div role="group" aria-label="Contribuisci">
            <p>Contribuisci</p>
            <a href="/studia/schede">Le mie schede</a>
            <a href="/studia/valida">Da validare</a>
          </div>
        </>
      ) : (
        <>
          <p>Forum</p>
          <a href="/forum">Dossier pubblici</a>
          <a href="/forum/community">Community</a>
        </>
      )}
    </div>
  );
}

let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  animate = vi.fn();
  // jsdom has no Web Animations.
  Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).animate;
});

describe('useEntriesEntrance (T1)', () => {
  it('fades nothing in when the sidebar first draws', () => {
    reducedMotion(false);
    render(<Group section="forum" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('fades the new section\'s entries in, in their order, the first six 20 ms apart, under 250 ms', () => {
    reducedMotion(false);
    const { rerender } = render(<Group section="forum" />);
    rerender(<Group section="gymnasium" />);

    const entries = animate.mock.contexts.map((el) => (el as HTMLElement).textContent || '—');
    expect(entries).toEqual(['Studia', 'Oggi', 'Progressi', 'Dossier', '—', 'Contribuisci', 'Le mie schede', 'Da validare']);
    const delays = animate.mock.calls.map(([, options]) => options.delay);
    expect(delays).toEqual([0, 1, 2, 3, 4, 5, 5, 5].map((step) => step * CASCADE_STEP_MS));
    for (const [keyframes, options] of animate.mock.calls) {
      // Opacity only: nothing moves.
      expect(keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      expect(options).toMatchObject({ duration: ENTRY_FADE_MS, fill: 'backwards' });
      expect(options.delay + options.duration).toBeLessThan(250);
    }
  });

  it('fades nothing in under reduced motion', () => {
    reducedMotion(true);
    const { rerender } = render(<Group section="forum" />);
    rerender(<Group section="gymnasium" />);
    expect(animate).not.toHaveBeenCalled();
  });
});
