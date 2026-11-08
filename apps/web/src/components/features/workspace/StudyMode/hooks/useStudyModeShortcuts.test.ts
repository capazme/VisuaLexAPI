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

describe('useStudyModeShortcuts — keys that are not Study Mode\'s (H1)', () => {
  it('a key an open menu took (its Esc) never closes Study Mode', () => {
    const h = handlers();
    renderHook(() => useStudyModeShortcuts(h));
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    document.body.appendChild(menu);
    // The menu's own handler prevents its Esc; the arrows and letters it leaves alone are not Study Mode's either.
    item.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); }, { once: true });
    for (const key of ['Escape', 'ArrowLeft', 'ArrowRight', 't']) {
      item.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    menu.remove();
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });

  it('a dialog over Study Mode keeps its keys: Esc, the arrows and what is typed in it', () => {
    const h = handlers();
    renderHook(() => useStudyModeShortcuts(h));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h3');
    heading.tabIndex = -1;
    const field = document.createElement('input');
    dialog.append(heading, field);
    document.body.appendChild(dialog);
    for (const target of [heading, field]) {
      for (const key of ['Escape', 'ArrowLeft', 'ArrowRight', 'h', '1', '+']) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      }
    }
    // Esc in the dialog's field is the field's: Study Mode does not take the focus out of it.
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(field);
    // The focus outside it (a click on its words, the moment before its first focus): still the dialog's keys.
    field.blur();
    for (const key of ['Escape', 'ArrowRight', '2']) press(key);
    dialog.remove();
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
    // Gone, the keys are Study Mode's again.
    press('Escape');
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('an Esc another handler already took is left alone', () => {
    const h = handlers();
    renderHook(() => useStudyModeShortcuts(h));
    const stop = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', stop, { capture: true, once: true });
    press('Escape');
    expect(h.onClose).not.toHaveBeenCalled();
    press('Escape');
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it('with text selected, H and N are the selection popup\'s', () => {
    const h = handlers();
    renderHook(() => useStudyModeShortcuts(h));
    const text = document.createElement('p');
    text.textContent = 'Gli interessi superiori';
    document.body.appendChild(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    press('h');
    press('n');
    expect(h.onNavigate).not.toHaveBeenCalled();
    expect(h.onNewNote).not.toHaveBeenCalled();
    window.getSelection()!.removeAllRanges();
    text.remove();
    press('h');
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('prev');
  });
});
