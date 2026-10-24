import { act, render, screen } from '@testing-library/react';
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
// The comparison's module, counted as it is loaded.
const compare = vi.hoisted(() => ({ loads: 0, broken: false }));
vi.mock('../../features/compare/CompareView', () => {
  compare.loads += 1;
  return {
    CompareView: () => {
      if (compare.broken) throw new Error('chunk missing');
      return <p>Il confronto</p>;
    },
  };
});

import { Layout } from '../Layout';
import { closeCompare, forgetCompareOpened, getCompareState, openCompareWithArticle } from '../../../hooks/useCompare';

const ARTICLE = {
  article: { article_text: 'Testo.', norma_data: { tipo_atto: 'codice civile', numero_articolo: '2043' } },
  sourceNorma: { tipo_atto: 'codice civile' },
  label: 'art. 2043 c.c.',
} as Parameters<typeof openCompareWithArticle>[0];

describe('Layout — the comparison', () => {
  it('loads its code only when it first opens, then keeps it mounted', async () => {
    render(<MemoryRouter initialEntries={['/']}><Layout /></MemoryRouter>);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(compare.loads).toBe(0);
    expect(screen.queryByText('Il confronto')).toBeNull();

    act(() => { openCompareWithArticle(ARTICLE); });
    expect(await screen.findByText('Il confronto')).toBeInTheDocument();
    expect(compare.loads).toBe(1);

    // Closed, it stays mounted as before (CompareView draws nothing while closed, and keeps its full-screen choice).
    act(() => { closeCompare(); });
    expect(screen.getByText('Il confronto')).toBeInTheDocument();
  });

  it('closes the comparison, the page kept, when its code cannot be had, and tries again at the next opening', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A visit where the comparison has not opened yet, and its code will fail.
    act(() => { closeCompare(); forgetCompareOpened(); });
    compare.broken = true;
    render(<MemoryRouter initialEntries={['/']}><Layout /></MemoryRouter>);
    expect(screen.queryByText('Il confronto')).toBeNull();
    act(() => { openCompareWithArticle(ARTICLE); });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(getCompareState().isOpen).toBe(false);
    expect(screen.queryByText('Il confronto')).toBeNull();
    expect(screen.getByTestId('layout-content')).toBeInTheDocument();
    compare.broken = false;
    act(() => { openCompareWithArticle(ARTICLE); });
    expect(await screen.findByText('Il confronto')).toBeInTheDocument();
    error.mockRestore();
  });
});
