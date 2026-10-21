import { describe, expect, it } from 'vitest';
import { isEditableTarget, isUndoShortcut, undoShortcutKeys, undoShortcutLabel } from './undoShortcut';

const key = (over: Partial<KeyboardEvent>) => ({ key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

describe('the undo shortcut (L-36)', () => {
  it('is Ctrl+Z elsewhere and ⌘Z on a Mac; Shift (redo) and Alt are not it', () => {
    expect(isUndoShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isUndoShortcut(key({ key: 'Z', ctrlKey: true }), false)).toBe(true);
    expect(isUndoShortcut(key({ metaKey: true }), false)).toBe(false);
    expect(isUndoShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isUndoShortcut(key({ key: 'y', ctrlKey: true }), false)).toBe(false);
  });

  it('is written and declared for each platform', () => {
    expect(undoShortcutLabel(false)).toBe('Ctrl+Z');
    expect(undoShortcutLabel(true)).toBe('⌘Z');
    expect(undoShortcutKeys(false)).toBe('Control+Z');
    expect(undoShortcutKeys(true)).toBe('Meta+Z');
  });

  it('leaves fields, editors and anything editable to the browser\'s own undo', () => {
    document.body.innerHTML = '<input id="a"><textarea id="b"></textarea><div contenteditable="true"><p id="c">x</p></div><div role="textbox" id="d"></div><button id="e">ok</button>';
    for (const id of ['a', 'b', 'c', 'd']) expect(isEditableTarget(document.getElementById(id)), id).toBe(true);
    expect(isEditableTarget(document.getElementById('e'))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
