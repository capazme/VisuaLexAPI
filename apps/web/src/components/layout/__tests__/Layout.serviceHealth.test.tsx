import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceHealthState } from '../../../services/healthService';

const seen = vi.hoisted(() => ({ props: [] as Array<{ layout?: string; serviceHealth?: unknown }> }));
const probe = vi.hoisted(() => ({ overall: 'online' as string, calls: 0 }));
vi.mock('../Sidebar', () => ({
  Sidebar: (props: { layout?: string; serviceHealth?: unknown }) => {
    seen.props.push(props);
    return null;
  },
}));
vi.mock('../../../hooks/useServiceHealth', async () => {
  const { useMemo } = await import('react');
  return {
    useServiceHealth: () => {
      probe.calls += 1;
      const overall = probe.overall;
      return useMemo(() => ({ snapshot: { overall, services: [], checkedAt: '' }, refresh: () => Promise.resolve() }), [overall]);
    },
  };
});
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ UndoToastContainer: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));

import { appStore } from '../../../store/useAppStore';
import { Layout } from '../Layout';

const at = (path = '/dossier') => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);
const dot = () => document.querySelector('[data-service-health-dot]');

beforeEach(() => {
  appStore.setState((s) => ({ settings: { ...s.settings, focusMode: false }, sidebarVisible: true }));
  seen.props = [];
  probe.overall = 'online';
  probe.calls = 0;
});

describe('Layout — the services\' probe, in one place (S1)', () => {
  it('hands the one reading to both copies of the sidebar, whose user menu shows it', () => {
    at();
    const [desktop, phone] = [seen.props.find((p) => p.layout !== 'drawer'), seen.props.find((p) => p.layout === 'drawer')];
    expect(desktop?.serviceHealth).toBeDefined();
    expect(phone?.serviceHealth).toBe(desktop?.serviceHealth);
  });

  it('keeps probing with no sidebar drawn (Focus mode), so the menu need not be open', () => {
    appStore.setState((s) => ({ settings: { ...s.settings, focusMode: true } }));
    at();
    expect(seen.props).toHaveLength(0);
    expect(probe.calls).toBeGreaterThan(0);
  });

  it.each([
    ['degraded', 'alcune fonti non disponibili'],
    ['offline', 'servizio non raggiungibile'],
  ] as const)('puts the dot on the phone\'s menu button too when %s, and says it in its name', (state: ServiceHealthState, words) => {
    probe.overall = state;
    at();
    const button = screen.getByRole('button', { name: `Apri il menu, ${words}` });
    expect(button).toContainElement(dot() as HTMLElement);
  });

  it.each(['online', 'checking'] as const)('draws no dot when %s', (state: ServiceHealthState) => {
    probe.overall = state;
    at();
    expect(screen.getByRole('button', { name: 'Apri il menu' })).toBeInTheDocument();
    expect(dot()).toBeNull();
  });
});
