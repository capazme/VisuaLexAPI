import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Suspense, lazy, useEffect, useRef, type JSX } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation, useOutlet } from 'react-router-dom';
import { ViewSlide } from './ViewSlide';
import { PLACE_CHANGE } from '../../lib/motion';
import { pageFade } from './pageChange';

const ORDER = ['list', 'detail', 'trash'];

type Call = { el: Element; frames: Keyframe[]; timing: KeyframeAnimationOptions; anim: { cancel: () => void; onfinish: (() => void) | null } };

function recordAnimations(): Call[] {
  const calls: Call[] = [];
  Element.prototype.animate = function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    const anim = { cancel: vi.fn(), onfinish: null };
    calls.push({ el: this, frames, timing, anim });
    return anim as unknown as Animation;
  } as unknown as typeof Element.prototype.animate;
  return calls;
}

function reduceMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: on && query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia;
}

/** A view with its own title, as Pratiche's (each view its `PageFrame`). */
function Titled({ name }: { name: string }) {
  return <h1 data-page-title="">{name}</h1>;
}

function Page({ view, children }: { view: string; children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <main>
        <ViewSlide view={view} order={ORDER} drill={['list', 'detail']}>{children}</ViewSlide>
      </main>
    </MemoryRouter>
  );
}

describe('ViewSlide (LC98)', () => {
  const matchMedia = window.matchMedia;
  beforeEach(() => reduceMotion(false));
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
    window.matchMedia = matchMedia;
  });

  it('slides the detail in from the right by 12 px in 180 ms, and the list back from the left (LC132)', () => {
    const calls = recordAnimations();
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    expect(calls).toHaveLength(0);

    rerender(<Page view="detail"><Titled name="Una pratica" /></Page>);
    const coming = calls.find((c) => c.el.contains(screen.getByText('Una pratica')))!;
    expect(coming.frames[0]).toEqual({ opacity: 0, transform: 'translateX(12px)' });
    expect(coming.timing).toEqual(PLACE_CHANGE);
    expect(coming.timing.duration).toBe(180);
    // The leaving view is gone at once (LC127): one view on screen, one movement.
    expect(screen.queryByText('Pratiche')).toBeNull();
    expect(calls).toHaveLength(1);

    calls.length = 0;
    rerender(<Page view="list"><Titled name="Pratiche" /></Page>);
    expect(calls.find((c) => c.el.contains(screen.getByText('Pratiche')))!.frames[0]).toEqual({ opacity: 0, transform: 'translateX(-12px)' });
  });

  it('every other change (the sidebar\'s entries) fades in rising by 5 px, as `PageFade` (LC132)', () => {
    const calls = recordAnimations();
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    rerender(<Page view="trash"><Titled name="Cestino" /></Page>);
    const coming = calls.find((c) => c.el.contains(screen.getByText('Cestino')))!;
    expect(coming.frames).toEqual(pageFade(false).keyframes);
    expect(coming.frames[0]).toEqual({ opacity: 0, transform: 'translateY(5px)' });
    expect(coming.timing).toEqual(pageFade(false).timing);
    expect(coming.timing.duration).toBe(180);
  });

  it('under reduced motion only fades', () => {
    reduceMotion(true);
    const calls = recordAnimations();
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    rerender(<Page view="trash"><Titled name="Cestino" /></Page>);
    const coming = calls.find((c) => c.el.contains(screen.getByText('Cestino')))!;
    expect(coming.frames[0]).toEqual({ opacity: 0, transform: 'none' });
    expect(coming.timing).toEqual(pageFade(true).timing);
    rerender(<Page view="list"><Titled name="Pratiche" /></Page>);
    rerender(<Page view="detail"><Titled name="Una pratica" /></Page>);
    expect(calls.find((c) => c.el.contains(screen.getByText('Una pratica')))!.frames[0]).toEqual({ opacity: 0, transform: 'none' });
  });

  it('puts the focus on the coming view\'s title, and not when the page first draws', () => {
    recordAnimations();
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    expect(document.activeElement).toBe(document.body);

    rerender(<Page view="detail"><Titled name="Una pratica" /></Page>);
    expect(screen.queryByText('Pratiche')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Una pratica'));
  });

  it('with the title over the views (Learn, Opus), puts the focus on it', () => {
    const tree = (view: string) => (
      <MemoryRouter>
        <main>
          <h1 data-page-title="">Scadenze</h1>
          <ViewSlide view={view} order={ORDER}><p>{view}</p></ViewSlide>
        </main>
      </MemoryRouter>
    );
    const { rerender } = render(tree('list'));
    rerender(tree('detail'));
    expect(document.activeElement).toBe(screen.getByText('Scadenze'));
  });

  it('with a view whose code is on its way (Learn), keeps the view left until it is there, then fades it in with its content', async () => {
    const calls = recordAnimations();
    let arrive: (view: { default: () => JSX.Element }) => void = () => {};
    const Later = lazy(() => new Promise<{ default: () => JSX.Element }>((resolve) => { arrive = resolve; }));
    function Section() {
      const { pathname } = useLocation();
      return <ViewSlide view={pathname.split('/')[2] ?? ''} order={['oggi', 'progressi']}>{useOutlet()}</ViewSlide>;
    }
    render(
      <MemoryRouter initialEntries={['/learn/oggi']}>
        <main>
          <Link to="/learn/progressi">Progressi</Link>
          <Suspense fallback={<p>Caricamento…</p>}>
            <Routes>
              <Route path="learn" element={<Section />}>
                <Route path="oggi" element={<p>Vista Oggi</p>} />
                <Route path="progressi" element={<Later />} />
              </Route>
            </Routes>
          </Suspense>
        </main>
      </MemoryRouter>,
    );
    await act(async () => screen.getByText('Progressi').click());
    // The navigation waits: no empty box slides in, the view left stays.
    expect(screen.getByText('Vista Oggi')).toBeInTheDocument();
    expect(screen.queryByText('Caricamento…')).toBeNull();
    expect(calls).toHaveLength(0);

    await act(async () => arrive({ default: () => <h2>I tuoi progressi</h2> }));
    const coming = calls.find((c) => c.el.contains(screen.getByText('I tuoi progressi')));
    expect(coming?.frames[0]).toEqual({ opacity: 0, transform: 'translateY(5px)' });
    expect(coming?.timing).toEqual(pageFade(false).timing);
  });

  it('leaves the focus where the coming view put it', () => {
    function Field() {
      const ref = useRef<HTMLInputElement>(null);
      useEffect(() => ref.current?.focus(), []);
      return <input ref={ref} aria-label="Cerca" />;
    }
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    rerender(<Page view="trash"><Titled name="Cestino" /><Field /></Page>);
    expect(document.activeElement).toBe(screen.getByLabelText('Cerca'));
  });
});
