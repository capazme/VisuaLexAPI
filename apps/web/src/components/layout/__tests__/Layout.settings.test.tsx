import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The sidebar's «Impostazioni» and «Scorciatoie», drawn as what they are given.
vi.mock('../Sidebar', () => ({
  Sidebar: ({ openSettings, openKeyboardShortcuts }: { openSettings: () => void; openKeyboardShortcuts: () => void }) => (
    <>
      <button type="button" onClick={openSettings}>Impostazioni</button>
      <button type="button" onClick={openKeyboardShortcuts}>Scorciatoie</button>
    </>
  ),
}));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/FeedbackModal', () => ({ FeedbackModal: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));

import { Layout } from '../Layout';

/** Where the app is, and where Impostazioni will go back to. */
function Where() {
  const { pathname, hash, state } = useLocation();
  return <p data-testid="where" data-from={(state as { settingsFrom?: string } | null)?.settingsFrom ?? ''}>{pathname + hash}</p>;
}

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="*" element={<Where />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);
const where = () => screen.getAllByTestId('where').at(-1)!;

describe('Layout — Impostazioni is a page (LC84), opened from anywhere', () => {
  it('the sidebar\'s «Impostazioni» goes to its top, remembering the page it left', () => {
    at('/pratiche');
    fireEvent.click(screen.getAllByRole('button', { name: 'Impostazioni' })[0]);
    expect(where()).toHaveTextContent(/^\/impostazioni$/);
    expect(where()).toHaveAttribute('data-from', '/pratiche');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Scorciatoie» goes to its shortcuts', () => {
    at('/learn/ripasso');
    fireEvent.click(screen.getAllByRole('button', { name: 'Scorciatoie' })[0]);
    expect(where()).toHaveTextContent('/impostazioni#scorciatoie');
    expect(where()).toHaveAttribute('data-from', '/learn/ripasso');
  });

  it('«?» goes to the shortcuts too, outside a field', () => {
    at('/pratiche');
    fireEvent.keyDown(window, { key: '?' });
    expect(where()).toHaveTextContent('/impostazioni#scorciatoie');
  });
});
