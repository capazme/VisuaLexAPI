import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/FeedbackModal', () => ({ FeedbackModal: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));
// The comparison's module, counted as it is loaded, and held until the test lets it arrive.
const compare = vi.hoisted(() => {
  let open = () => {};
  const arrival = new Promise<void>((resolve) => { open = resolve; });
  return { loads: 0, arrival, arrive: () => open() };
});
vi.mock('../../features/compare/CompareView', async () => {
  compare.loads += 1;
  await compare.arrival;
  return { CompareView: () => <p>Il confronto</p> };
});

import { Layout } from '../Layout';
import { closeCompare, openCompareWithArticle } from '../../../hooks/useCompare';

const ARTICLE = {
  article: { article_text: 'Testo.', norma_data: { tipo_atto: 'codice civile', numero_articolo: '2043' } },
  sourceNorma: { tipo_atto: 'codice civile' },
  label: 'art. 2043 c.c.',
} as Parameters<typeof openCompareWithArticle>[0];

describe('Layout — the comparison', () => {
  it('loads its code only when it first opens, waits only while open, then keeps it mounted', async () => {
    render(<MemoryRouter initialEntries={['/']}><Layout /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(compare.loads).toBe(0);
    expect(screen.queryByTestId('compare-waiting')).toBeNull();

    // Opened: the code is asked for, a spinner stands where the comparison will.
    act(() => { openCompareWithArticle(ARTICLE); });
    await waitFor(() => expect(compare.loads).toBe(1));
    expect(screen.getByTestId('compare-waiting')).toBeInTheDocument();
    // Closed before the code arrives: no spinner left behind.
    act(() => { closeCompare(); });
    expect(screen.queryByTestId('compare-waiting')).toBeNull();

    act(() => { openCompareWithArticle(ARTICLE); });
    expect(screen.getByTestId('compare-waiting')).toBeInTheDocument();
    await act(async () => { compare.arrive(); });
    expect(await screen.findByText('Il confronto')).toBeInTheDocument();
    expect(screen.queryByTestId('compare-waiting')).toBeNull();
    expect(compare.loads).toBe(1);

    // Closed, it stays mounted as before (CompareView draws nothing while closed, and keeps its full-screen choice).
    act(() => { closeCompare(); });
    expect(screen.getByText('Il confronto')).toBeInTheDocument();
  });
});
