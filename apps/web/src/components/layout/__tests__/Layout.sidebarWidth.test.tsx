import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ props: [] as Array<{ layout?: string; onToggleWide?: () => void }> }));
vi.mock('../Sidebar', () => ({
  Sidebar: (props: { layout?: string; onToggleWide?: () => void }) => {
    seen.props.push(props);
    return null;
  },
}));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ UndoToastContainer: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../ui/ServiceHealthBanner', () => ({ ServiceHealthBanner: () => null }));
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
  render(<MemoryRouter initialEntries={['/dossier']}><Layout /></MemoryRouter>);
  const last = seen.props.slice(-2);
  return { desktop: last.find((p) => p.layout !== 'drawer'), phone: last.find((p) => p.layout === 'drawer') };
}

beforeEach(() => {
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
});
