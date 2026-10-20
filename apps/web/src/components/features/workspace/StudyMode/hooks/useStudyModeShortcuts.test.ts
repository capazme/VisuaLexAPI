import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { STUDY_MODE_SHORTCUTS, useStudyModeShortcuts } from './useStudyModeShortcuts';

function handlers() {
  return {
    onClose: vi.fn(), onNavigate: vi.fn(), onFontSize: vi.fn(), onToggleTools: vi.fn(), onToggleSettings: vi.fn(),
    onTheme: vi.fn(), onBookmark: vi.fn(), onNewNote: vi.fn(), onExport: vi.fn(), onToggleFullscreen: vi.fn(),
  };
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe('useStudyModeShortcuts — the B key (D-078)', () => {
  it('Cmd/Ctrl+B still saves the bookmark', () => {
    const h = handlers();
    renderHook(() => useStudyModeShortcuts(h));
    expect(press('b', { metaKey: true }).defaultPrevented).toBe(true);
    expect(press('b', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(h.onBookmark).toHaveBeenCalledTimes(2);
  });

  it('a bare B does nothing and is left to the page: the Brocardi panel it opened is gone', () => {
    const h = handlers();
    renderHook(() => useStudyModeShortcuts(h));
    expect(press('b').defaultPrevented).toBe(false);
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
    expect(STUDY_MODE_SHORTCUTS.map((s) => s.key)).not.toContain('B');
  });
});
