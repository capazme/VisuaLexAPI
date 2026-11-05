import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/FeedbackModal', () => ({ FeedbackModal: () => null }));
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

import { Layout } from '../Layout';
import { FULL_PAGE_FRAME, PAGE_FRAME } from '../frame';
import { appStore } from '../../../store/useAppStore';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);
const frame = () => screen.getByTestId('layout-content');
const fullScreen = (on: boolean) => appStore.setState((s) => ({ settings: { ...s.settings, focusMode: on } }));

afterEach(() => fullScreen(false));

describe('Layout — the frame (U1)', () => {
  it('draws every page in the frame: the window less its margins, at most 1600 px, wider for a `full` page', () => {
    at('/dossier');
    expect(frame()).toHaveClass(...PAGE_FRAME.split(' '), 'max-w-frame', FULL_PAGE_FRAME);
    // The old frame and its narrowing in full screen are gone.
    expect(frame().className).not.toMatch(/\bmax-w-(?:7xl|4xl)\b|\bpy-12\b/);
  });

  it('widens in full screen to 2400 px, never narrows', () => {
    fullScreen(true);
    at('/dossier');
    expect(frame()).toHaveClass(...PAGE_FRAME.split(' '), 'max-w-frame-full');
    expect(frame()).not.toHaveClass('max-w-frame');
    expect(frame().className).not.toMatch(/\bmax-w-4xl\b|\bpy-12\b/);
  });
});

describe('Layout — the full-screen button (U1)', () => {
  it('is named in Italian, the same in both states, and says its state with `aria-pressed`', () => {
    at('/dossier');
    const button = screen.getByRole('button', { name: 'Tutto schermo' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', expect.stringMatching(/^Tutto schermo \((?:⌘Spazio|Ctrl\+Spazio)\)$/));
    expect(button).toHaveAttribute('aria-keyshortcuts', expect.stringMatching(/^(?:Meta|Control)\+Space$/));
    expect(button).toHaveAttribute('type', 'button');

    fireEvent.click(button);
    expect(appStore.getState().settings.focusMode).toBe(true);
    const pressed = screen.getByRole('button', { name: 'Tutto schermo' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed).toHaveAttribute('title', expect.stringMatching(/^Esci dal tutto schermo \((?:⌘Spazio|Ctrl\+Spazio)\)$/));
    expect(screen.queryByRole('button', { name: /Focus Mode/ })).toBeNull();
  });

  it('keeps ⌘Space (Ctrl+Space) as its key', () => {
    at('/dossier');
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Tutto schermo' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: ' ', metaKey: true });
    expect(screen.getByRole('button', { name: 'Tutto schermo' })).toHaveAttribute('aria-pressed', 'false');
  });
});
