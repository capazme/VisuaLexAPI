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

describe('Layout — where the full-screen button floats over the page (U1)', () => {
  const FROM_LG = 'lg:[--focus-button-room:4.25rem]';
  const FROM_MD = 'md:[--focus-button-room:4.25rem]';

  it('gives a top row its room from lg, where the button floats over the page\'s top right', () => {
    at('/dossier');
    expect(frame()).toHaveClass(FROM_LG);
    expect(frame()).not.toHaveClass(FROM_MD);
  });

  it('from md in full screen, which draws no bar for the button to sit in', () => {
    fullScreen(true);
    at('/');
    expect(frame()).toHaveClass(FROM_MD);
  });

  it('none over the search page\'s field, which ends before the button', () => {
    at('/');
    expect(frame()).not.toHaveClass(FROM_LG);
    expect(frame()).not.toHaveClass(FROM_MD);
  });
});

describe('Layout — the full-screen button (U1)', () => {
  it('is named in Italian, the same in both states, and says its state with `aria-pressed`', () => {
    at('/dossier');
    const button = screen.getByRole('button', { name: 'Tutto schermo' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', expect.stringMatching(/^Tutto schermo \((?:⌘⇧F|Ctrl\+⇧F)\)$/));
    expect(button).toHaveAttribute('aria-keyshortcuts', expect.stringMatching(/^(?:Meta|Control)\+Shift\+F$/));
    expect(button).toHaveAttribute('type', 'button');

    fireEvent.click(button);
    expect(appStore.getState().settings.focusMode).toBe(true);
    const pressed = screen.getByRole('button', { name: 'Tutto schermo' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed).toHaveAttribute('title', expect.stringMatching(/^Esci dal tutto schermo \((?:⌘⇧F|Ctrl\+⇧F)\)$/));
    expect(screen.queryByRole('button', { name: /Focus Mode/ })).toBeNull();
  });

  it('takes ⌘⇧F (Ctrl+⇧F) as its key, the letter in either case', () => {
    at('/dossier');
    const button = () => screen.getByRole('button', { name: 'Tutto schermo' });
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'f', metaKey: true, shiftKey: true });
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('no longer takes ⌘Space, which opens Spotlight on a Mac, nor ⌘F without Shift, nor ⌘⌥⇧F', () => {
    at('/dossier');
    const button = () => screen.getByRole('button', { name: 'Tutto schermo' });
    fireEvent.keyDown(window, { key: ' ', metaKey: true });
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true, altKey: true });
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(appStore.getState().settings.focusMode).toBe(false);
  });
});
