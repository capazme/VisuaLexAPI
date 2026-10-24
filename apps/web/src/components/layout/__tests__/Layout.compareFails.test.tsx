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
// The comparison's module: its first fetch fails (a dropped connection), the next one arrives.
const compare = vi.hoisted(() => ({ loads: 0 }));
vi.mock('../../features/compare/CompareView', () => {
  compare.loads += 1;
  if (compare.loads === 1) throw new Error('Failed to fetch dynamically imported module');
  return { CompareView: () => <p>Il confronto</p> };
});

import { Layout } from '../Layout';
import { getCompareState, openCompareWithArticle } from '../../../hooks/useCompare';

const ARTICLE = {
  article: { article_text: 'Testo.', norma_data: { tipo_atto: 'codice civile', numero_articolo: '2043' } },
  sourceNorma: { tipo_atto: 'codice civile' },
  label: 'art. 2043 c.c.',
} as Parameters<typeof openCompareWithArticle>[0];

describe('Layout — the comparison whose code cannot be fetched', () => {
  it('closes the comparison, the page kept, and fetches its code again at the next opening', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MemoryRouter initialEntries={['/']}><Layout /></MemoryRouter>);
    act(() => { openCompareWithArticle(ARTICLE); });
    await waitFor(() => expect(getCompareState().isOpen).toBe(false));
    expect(compare.loads).toBe(1);
    expect(screen.queryByText('Il confronto')).toBeNull();
    expect(screen.queryByTestId('compare-waiting')).toBeNull();
    expect(screen.getByTestId('layout-content')).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith('the comparison could not be loaded', expect.anything());

    act(() => { openCompareWithArticle(ARTICLE); });
    expect(await screen.findByText('Il confronto')).toBeInTheDocument();
    expect(compare.loads).toBe(2);
    error.mockRestore();
  });
});
