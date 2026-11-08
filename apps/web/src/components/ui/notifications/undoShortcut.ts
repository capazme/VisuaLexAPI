/**
 * Ctrl+Z (⌘Z on a Mac) runs the newest «Annulla» still on screen (L-36): pure parts, for `NotificationHost` and its
 * tests. Inside a field, an editor or anything editable the key is the browser's own undo, never this.
 */

/** A Mac (or an iPad with a keyboard): ⌘, not Ctrl. */
export const isMacPlatform = () => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform ?? '');

/** What the notification writes beside its «Annulla»: «⌘Z» or «Ctrl+Z». */
export const undoShortcutLabel = (mac = isMacPlatform()) => (mac ? '⌘Z' : 'Ctrl+Z');

/** For `aria-keyshortcuts`. */
export const undoShortcutKeys = (mac = isMacPlatform()) => (mac ? 'Meta+Z' : 'Control+Z');

/**
 * The key is the shortcut: Z with ⌘ on a Mac, with Ctrl elsewhere; no Shift (that is redo), no Alt. On a keyboard that
 * writes no Latin letter (Cyrillic, Greek) the key is read by its place, Z's.
 */
export function isUndoShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { code?: string }, mac = isMacPlatform()): boolean {
  const isZ = event.key.toLowerCase() === 'z' || (event.code === 'KeyZ' && !/^[a-z]$/i.test(event.key));
  if (!isZ || event.shiftKey || event.altKey) return false;
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/**
 * Where the key undoes typing: a field, a list to choose from, an editor, anything editable — and an element that
 * stands for a field (`data-text-field`: the search page's field, a button that opens the search menu with what is
 * typed on it).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [data-text-field]') !== null;
}

/**
 * Where the key would undo unseen: under a modal dialog, or an overlay over the workspace (`data-find-overlay`) — but
 * not one the notifications are drawn over and where marks are removed (`data-undo-through`: Study Mode), whose
 * «Annulla» is on screen.
 */
export function isUndoCovered(): boolean {
  if (document.querySelector('[aria-modal="true"]') !== null) return true;
  return [...document.querySelectorAll('[data-find-overlay]')].some((el) => !el.hasAttribute('data-undo-through'));
}
