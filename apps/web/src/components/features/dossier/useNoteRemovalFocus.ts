import { useEffect, useRef } from 'react';

/**
 * Where the focus goes once a note removed from the keyboard leaves its list (LC61): the next note, else the one
 * before, else the row the notes belong to, else the heading after the notes' section (the one before at the end);
 * never the page's body. `register` is each note's ref; `remove` wraps the removal.
 */
export function useNoteRemovalFocus<T extends { id: string }>(notes: T[], onRemove: ((note: T) => void) | undefined) {
  const els = useRef(new Map<string, HTMLElement>());
  const pending = useRef<{ removed: string; targets: HTMLElement[] } | null>(null);
  const settle = () => {
    const next = pending.current?.targets.find((el) => el.isConnected);
    pending.current = null;
    if (!next) return;
    if (/^H[1-6]$/.test(next.tagName)) {
      if (!next.hasAttribute('tabindex')) next.tabIndex = -1;
      next.focus();
    } else (next.querySelector<HTMLElement>('button') ?? next).focus();
  };
  useEffect(() => {
    if (pending.current && !notes.some((n) => n.id === pending.current?.removed)) settle();
  }, [notes]);
  // The last note gone can take the list away with it (a section drawn only while it has notes).
  useEffect(() => () => { if (pending.current) settle(); }, []);

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };
  const remove = (note: T) => {
    const el = els.current.get(note.id);
    if (el?.contains(document.activeElement)) {
      const at = notes.indexOf(note);
      const around = [...notes.slice(at + 1), ...notes.slice(0, at).reverse()].flatMap((n) => els.current.get(n.id) ?? []);
      const row = el.closest('[data-dossier-item], [data-practice-row]')?.querySelector<HTMLElement>('[aria-expanded]');
      const section = el.closest('section') ?? el;
      const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4')).filter((h) => !section.contains(h));
      const after = headings.find((h) => section.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
      const before = headings.filter((h) => section.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING).at(-1);
      pending.current = { removed: note.id, targets: [...around, ...(row ? [row] : []), ...(after ? [after] : []), ...(before ? [before] : [])] };
    }
    onRemove?.(note);
  };
  return { register, remove };
}
