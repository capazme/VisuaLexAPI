import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useOutlet } from 'react-router-dom';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, canUseDevMode: false, devMode: false, setDevMode: vi.fn(), isAuthenticated: true }) }));
vi.mock('../../../features/connections/ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('../../../features/merlt/privacy/MerltDataSection', () => ({ MerltDataSection: () => null }));
vi.mock('../../../services/accountService', () => ({ accountService: {} }));

import { SettingsPage } from './SettingsPage';
import { SETTINGS_PATH, useOpenSettings, useSettingsRequests } from './settingsRoute';
import { PageSlide } from '../../ui/PageSlide';
import { PageFade } from '../../layout/PageFade';
import { pageKeyOf } from '../../layout/pageChange';
import { resetNotifications } from '../../ui/notifications/notifications';

/** `Layout`'s two layers of page movement, as it nests them. */
function Shell() {
  useSettingsRequests();
  const { pathname } = useLocation();
  const slidePage = pathname === SETTINGS_PATH ? 'impostazioni' : 'app';
  return (
    <main>
      <PageSlide pageKey={slidePage} back={slidePage === 'app'}>
        <PageFade pageKey={pageKeyOf(pathname)}>{useOutlet()}</PageFade>
      </PageSlide>
    </main>
  );
}

function Scadenze() {
  const openSettings = useOpenSettings();
  return (
    <>
      <h1 data-page-title>Scadenze</h1>
      <button type="button" onClick={() => openSettings()}>Apri le impostazioni</button>
    </>
  );
}

function app() {
  render(
    <MemoryRouter initialEntries={['/work/scadenziario']}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/work/scadenziario" element={<Scadenze />} />
          <Route path="/impostazioni" element={<SettingsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

type Call = { el: Element; frames: Keyframe[] };
let calls: Call[] = [];
/** The movements of a page: the ones on an element holding a page's title. */
const pageMoves = () => calls.filter((c) => c.el.querySelector('h1'));

function reduceMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: on && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

const matchMedia = window.matchMedia;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  reduceMotion(false);
  calls = [];
  Element.prototype.animate = function (this: Element, frames: Keyframe[]) {
    calls.push({ el: this, frames });
    return { cancel: vi.fn(), onfinish: null } as unknown as Animation;
  } as unknown as typeof Element.prototype.animate;
});
afterEach(() => {
  resetNotifications();
  delete (Element.prototype as Partial<Element>).animate;
  window.matchMedia = matchMedia;
});

const titles = () => screen.queryAllByRole('heading', { level: 1 }).map((h) => h.textContent);

describe('Impostazioni coming and going (LC127)', () => {
  it('never draws two pages: the leaving one goes at once, the coming one slides in alone', () => {
    app();
    fireEvent.click(screen.getByRole('button', { name: 'Apri le impostazioni' }));
    // Right after the change, while its movement runs.
    expect(titles()).toEqual(['Impostazioni']);
    expect(pageMoves().map((c) => c.frames[0])).toEqual([{ opacity: 0, transform: 'translateX(24px)' }]);

    calls = [];
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(titles()).toEqual(['Scadenze']);
    expect(pageMoves().map((c) => c.frames[0])).toEqual([{ opacity: 0, transform: 'translateX(-24px)' }]);
  });

  it.each([
    ['«Indietro»', () => fireEvent.click(screen.getByRole('button', { name: 'Indietro' }))],
    ['Esc', () => fireEvent.keyDown(screen.getByRole('button', { name: 'Indietro' }), { key: 'Escape' })],
  ])('after %s, the focus is on the title of the page reached, never on the body', async (_, back) => {
    app();
    fireEvent.click(screen.getByRole('button', { name: 'Apri le impostazioni' }));
    // As a hand does: the press ends the entrance's own watch for Impostazioni's title (`focusLanding`).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Indietro' }));
    screen.getByRole('button', { name: 'Indietro' }).focus();
    back();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Scadenze' })).toHaveFocus());
  });

  it('under reduced motion, only the fade, both ways', () => {
    reduceMotion(true);
    app();
    fireEvent.click(screen.getByRole('button', { name: 'Apri le impostazioni' }));
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(pageMoves().map((c) => c.frames[0])).toEqual([{ opacity: 0, transform: 'none' }, { opacity: 0, transform: 'none' }]);
  });
});
