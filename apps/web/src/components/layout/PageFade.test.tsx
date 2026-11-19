import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageFade } from './PageFade';
import { pageFade, pageKeyOf } from './pageChange';
import { PAGE_CHANGING } from '../../lib/pageTransition';
import { focusLanding } from '../../utils/focusPage';
import { dur } from '../../lib/motion';

let go: (to: string) => void = () => {};

function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    go = navigate;
  }, [navigate]);
  return <main><PageFade pageKey={pageKeyOf(pathname)}>{useOutlet()}</PageFade></main>;
}

// Each its own element, as real pages are (the same `h1` reused would not be a new title).
const page = (name: string) => <h1 key={name} data-page-title>{name}</h1>;

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={page('Ricerca')} />
          <Route path="/pratiche" element={page('Pratiche')} />
          <Route path="/work/scadenziario" element={page('Scadenziario')} />
          <Route path="/work/prossimi" element={page('Prossimi')} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
const original = matchMedia;

beforeEach(() => {
  reducedMotion(false);
  animate.mockClear();
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  document.documentElement.classList.remove(PAGE_CHANGING);
  window.matchMedia = original;
});

describe('pageKeyOf (LC126)', () => {
  it.each([
    ['/', '/'],
    ['/pratiche', '/pratiche'],
    ['/work', '/work'],
    ['/work/scadenziario', '/work'],
    ['/learn/ripasso/sessione', '/learn'],
    ['/forum', '/forum'],
    ['/forum/community/12', '/forum/community'],
    ['/admin/utenti', '/admin'],
    ['/labs/grafo', '/labs/grafo'],
    ['/workshop', '/workshop'],
  ])('%s is the page %s', (pathname, key) => expect(pageKeyOf(pathname)).toBe(key));
});

describe('PageFade (LC126)', () => {
  it('fades the coming page in, rising by 5 px, with the motion tokens; nothing as the app first draws', async () => {
    at('/work/scadenziario');
    expect(animate).not.toHaveBeenCalled();
    act(() => go('/'));
    await screen.findByText('Ricerca');
    expect(animate).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledWith(
      [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }],
      { duration: dur.pop * 1000, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
    // Only the coming page is drawn.
    expect(screen.queryByText('Scadenziario')).toBeNull();
  });

  it('plays nothing for a view inside the same page: `ViewSlide` moves it', async () => {
    at('/work/scadenziario');
    act(() => go('/work/prossimi'));
    await screen.findByText('Prossimi');
    expect(animate).not.toHaveBeenCalled();
  });

  it('plays nothing while a section change runs its View Transition', async () => {
    at('/work/scadenziario');
    document.documentElement.classList.add(PAGE_CHANGING);
    act(() => go('/pratiche'));
    await screen.findByText('Pratiche');
    expect(animate).not.toHaveBeenCalled();
  });

  it('under reduced motion only fades, briefly', async () => {
    reducedMotion(true);
    at('/');
    act(() => go('/pratiche'));
    await screen.findByText('Pratiche');
    expect(animate).toHaveBeenCalledWith(pageFade(true).keyframes, pageFade(true).timing);
    expect(pageFade(true).keyframes[0]).toEqual({ opacity: 0, transform: 'none' });
  });

  it('leaves the focus to the caller: it lands on the new page’s title', async () => {
    at('/');
    act(() => {
      go('/pratiche');
      focusLanding(true);
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Pratiche' })).toHaveFocus());
  });
});
