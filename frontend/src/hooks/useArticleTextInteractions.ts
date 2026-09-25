import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface OpenUpdateNote {
  id: string;
  /** The "(119)" chip the note was opened from — the popover's anchor. */
  anchorEl: HTMLElement;
}

interface State {
  key: string;
  updatesOpen: boolean;
  openNote: (OpenUpdateNote & { contentKey: string }) | null;
}

const fresh = (key: string): State => ({ key, updatesOpen: false, openNote: null });

export interface ArticleTextInteractionOptions {
  /** False until the body is mounted (the dossier reader renders it after its fetch). */
  enabled?: boolean;
  /**
   * The HTML currently rendered in the body. When it changes, `SafeHTML`
   * replaces every node, including the chip an open note is anchored to, so
   * the note closes instead of floating off a detached element.
   */
  contentKey?: string;
}

/**
 * The interactive parts of a structured article text (utils/articleRender.ts):
 * a "(119)" reference opens its AGGIORNAMENTO note, the "Note di
 * aggiornamento" toggle folds the notes at the bottom. One delegated click and
 * one keydown listener on the body, because the markup comes from `SafeHTML`
 * and has no React handlers of its own; Enter and Space activate, as on a
 * button.
 *
 * Folding is a class on the text container (`vlx-updates-open`, applied by
 * the caller from `updatesOpen`), not part of the rendered HTML: toggling
 * never replaces the text, so keyboard focus and any open selection survive.
 *
 * State belongs to one article: `resetKey` changing (another article in the
 * same component) returns to closed. Both resets are derived during render,
 * not performed in an effect (CLAUDE.md gotcha 11).
 */
export function useArticleTextInteractions(
  containerRef: RefObject<HTMLElement | null>,
  resetKey: string,
  { enabled = true, contentKey = '' }: ArticleTextInteractionOptions = {},
): {
  updatesOpen: boolean;
  openNote: OpenUpdateNote | null;
  closeNote: () => void;
  /** Unfolds the AGGIORNAMENTO notes — e.g. before scrolling to a search hit inside them. */
  openUpdates: () => void;
} {
  const [state, setState] = useState<State>(() => fresh(resetKey));
  const current = state.key === resetKey ? state : fresh(resetKey);
  const openNote =
    current.openNote && current.openNote.contentKey === contentKey
      ? { id: current.openNote.id, anchorEl: current.openNote.anchorEl }
      : null;
  const closeNote = useCallback(() => {
    setState((s) => (s.key === resetKey ? { ...s, openNote: null } : fresh(resetKey)));
  }, [resetKey]);

  const openUpdates = useCallback(() => {
    setState((s) => ({ ...(s.key === resetKey ? s : fresh(resetKey)), updatesOpen: true }));
  }, [resetKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    const base = (s: State): State => (s.key === resetKey ? s : fresh(resetKey));

    const activate = (target: Element): boolean => {
      const chip = target.closest<HTMLElement>('.vlx-ref');
      if (chip && container.contains(chip)) {
        // A note the reader anchored on the reference itself wins the click:
        // its own popover (the reader's note-anchor handler) opens instead.
        const noteAnchor = target.closest('.note-anchor');
        if (noteAnchor && chip.contains(noteAnchor)) return false;
        const id = chip.dataset.note;
        if (!id) return false;
        setState((s) => {
          const b = base(s);
          const same = b.openNote?.id === id && b.openNote.anchorEl === chip && b.openNote.contentKey === contentKey;
          return { ...b, openNote: same ? null : { id, anchorEl: chip, contentKey } };
        });
        return true;
      }
      const toggle = target.closest<HTMLElement>('.vlx-updates-toggle');
      if (toggle && container.contains(toggle)) {
        setState((s) => {
          const b = base(s);
          return { ...b, updatesOpen: !b.updatesOpen, openNote: null };
        });
        return true;
      }
      return false;
    };

    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && activate(e.target)) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target;
      if (!(target instanceof Element) || !target.matches('.vlx-ref, .vlx-updates-toggle')) return;
      if (activate(target)) e.preventDefault(); // Space would scroll the page
    };
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('click', onClick);
      container.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, resetKey, enabled, contentKey]);

  // The toggle lives in SafeHTML's markup, which React does not own: keep its
  // aria-expanded in step with the state (a DOM write, not a state update).
  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>('.vlx-updates-toggle')
      ?.setAttribute('aria-expanded', current.updatesOpen ? 'true' : 'false');
  }, [current.updatesOpen, containerRef, contentKey]);

  return { updatesOpen: current.updatesOpen, openNote, closeNote, openUpdates };
}
