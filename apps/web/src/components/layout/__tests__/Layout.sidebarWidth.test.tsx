import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ props: [] as Array<{ layout?: string; onToggleWide?: () => void; logoSweep?: boolean }> }));
vi.mock('../Sidebar', () => ({
  Sidebar: (props: { layout?: string; onToggleWide?: () => void; logoSweep?: boolean }) => {
    seen.props.push(props);
    return null;
  },
}));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
// The planner's host reads the tasks from the server: not under test here.
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));

import { appStore } from '../../../store/useAppStore';
import { Layout } from '../Layout';
import { sidebarWidthStore } from '../sidebarWidth';

function atWidth(xl: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(min-width: 1280px)' ? xl : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList);
  seen.props = [];
  const { container } = render(<MemoryRouter initialEntries={['/dossier']}><Layout /></MemoryRouter>);
  const last = seen.props.slice(-2);
  const root = container.firstElementChild as HTMLElement;
  return {
    desktop: last.find((p) => p.layout !== 'drawer'),
    phone: last.find((p) => p.layout === 'drawer'),
    sidebarWidth: root.style.getPropertyValue('--sidebar-width'),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  appStore.setState((s) => ({ settings: { ...s.settings, focusMode: false }, sidebarVisible: true }));
  sidebarWidthStore.setState({ collapsed: false });
});
afterEach(() => vi.restoreAllMocks());

describe('Layout — the sidebar\'s two copies (Gymnasium spec §4)', () => {
  it('gives the phone\'s copy the drawer, with no toggle', () => {
    const { phone } = atWidth(true);
    expect(phone).toBeDefined();
    expect(phone?.onToggleWide).toBeUndefined();
  });

  it('gives the desktop copy its words from xl, with the toggle', () => {
    const { desktop } = atWidth(true);
    expect(desktop?.layout).toBe('wide');
    expect(desktop?.onToggleWide).toBeTypeOf('function');
  });

  it('gives the desktop copy the rail below xl, with no toggle', () => {
    const { desktop } = atWidth(false);
    expect(desktop?.layout).toBe('rail');
    expect(desktop?.onToggleWide).toBeUndefined();
  });

  it('keeps the rail from xl when the user narrowed it', () => {
    sidebarWidthStore.setState({ collapsed: true });
    const { desktop } = atWidth(true);
    expect(desktop?.layout).toBe('rail');
    expect(desktop?.onToggleWide).toBeTypeOf('function');
  });

  // For what would float beside it from `lg`; the services pill, its one reader, went into the user menu (S1).
  it('tells what floats beside it the width it is drawn at: 224, 64, or 0 when hidden or in Focus mode', () => {
    expect(atWidth(true).sidebarWidth).toBe('224px');
    expect(atWidth(false).sidebarWidth).toBe('64px');
    sidebarWidthStore.setState({ collapsed: true });
    expect(atWidth(true).sidebarWidth).toBe('64px');
    appStore.setState({ sidebarVisible: false });
    expect(atWidth(true).sidebarWidth).toBe('0px');
    appStore.setState((s) => ({ sidebarVisible: true, settings: { ...s.settings, focusMode: true } }));
    expect(atWidth(true).sidebarWidth).toBe('0px');
  });
});

describe('Layout — the logo\'s sweep (LC16)', () => {
  it('asks the desktop bar for it once a browser session, not when the shell is drawn again', () => {
    const first = atWidth(true);
    expect(first.desktop?.logoSweep).toBe(true);
    cleanup();
    // The shell drawn again (back from a page outside it, a reload in the same tab): no sweep.
    const again = atWidth(true);
    expect(again.desktop?.logoSweep).toBe(false);
  });

  // The subagent of LC16: on a phone the sweep played in the closed drawer, where nobody saw it.
  it('on a phone plays it at the drawer\'s first opening in the session, not before and not again', () => {
    const phoneNow = () => seen.props.filter((p) => p.layout === 'drawer').at(-1);
    atWidth(false);
    expect(phoneNow()?.logoSweep).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Apri il menu' }));
    expect(phoneNow()?.logoSweep).toBe(true);
    cleanup();
    atWidth(false);
    fireEvent.click(screen.getByRole('button', { name: 'Apri il menu' }));
    expect(phoneNow()?.logoSweep).toBe(false);
  });
});
