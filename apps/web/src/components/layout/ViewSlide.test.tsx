import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Suspense, lazy, useEffect, useRef, type JSX } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation, useOutlet } from 'react-router-dom';
import { ViewSlide } from './ViewSlide';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../lib/motion';

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
        <ViewSlide view={view} order={ORDER}>{children}</ViewSlide>
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

  it('slides a view further along in from the right on the island\'s tokens, and one before it from the left', () => {
    const calls = recordAnimations();
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    expect(calls).toHaveLength(0);

    rerender(<Page view="detail"><Titled name="Una pratica" /></Page>);
    const coming = calls.find((c) => c.el.contains(screen.getByText('Una pratica')))!;
    expect(coming.frames[0]).toEqual({ opacity: 0, transform: 'translateX(24px)' });
    expect(coming.timing).toEqual(ISLAND_OPEN);
    const going = calls.find((c) => c.el.contains(screen.getByText('Pratiche')))!;
    expect(going.timing).toEqual({ ...ISLAND_CLOSE, fill: 'forwards' });
    act(() => going.anim.onfinish?.());

    calls.length = 0;
    rerender(<Page view="list"><Titled name="Pratiche" /></Page>);
    expect(calls.find((c) => c.el.contains(screen.getByText('Pratiche')))!.frames[0]).toEqual({ opacity: 0, transform: 'translateX(-24px)' });
  });

  it('under reduced motion only fades', () => {
    reduceMotion(true);
    const calls = recordAnimations();
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    rerender(<Page view="trash"><Titled name="Cestino" /></Page>);
    const coming = calls.find((c) => c.el.contains(screen.getByText('Cestino')))!;
    expect(coming.frames[0]).toEqual({ opacity: 0, transform: 'none' });
    expect(coming.timing).toEqual(ISLAND_OPEN);
  });

  it('puts the focus on the coming view\'s title, never on the leaving one\'s, and not when the page first draws', () => {
    recordAnimations();
    const { rerender } = render(<Page view="list"><Titled name="Pratiche" /></Page>);
    expect(document.activeElement).toBe(document.body);

    rerender(<Page view="detail"><Titled name="Una pratica" /></Page>);
    // The leaving view is still on screen, inert: its title comes first and is not taken.
    expect(screen.getByText('Pratiche').closest('[inert]')).not.toBeNull();
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

  it('with a view whose code is on its way (Learn), keeps the view left until it is there, then slides it in with its content', async () => {
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
    expect(coming?.frames[0]).toEqual({ opacity: 0, transform: 'translateX(24px)' });
    expect(coming?.timing).toEqual(ISLAND_OPEN);
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
