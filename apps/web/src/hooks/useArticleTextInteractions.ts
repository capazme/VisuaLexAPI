import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export interface OpenUpdateNote {
  id: string;
  /** The "(119)" chip the note was opened from — the popover's anchor. */
  anchorEl: HTMLElement;
}

interface State {
  key: string;
  updatesOpen: boolean;
  openNote: (OpenUpdateNote & { contentKey: string }) | null;
  /** The block whose annotations are open (its sign's `data-block`). */
  openBlock: number | null;
}

const fresh = (key: string, updatesOpen: boolean): State => ({ key, updatesOpen, openNote: null, openBlock: null });

export interface ArticleTextInteractionOptions {
  /** False until the body is mounted (the dossier reader renders it after its fetch). */
  enabled?: boolean;
  /**
   * The HTML currently rendered in the body. When it changes, `SafeHTML`
   * replaces every node, including the chip an open note is anchored to, so
   * the note closes instead of floating off a detached element.
   */
  contentKey?: string;
  /**
   * Whether the "Note di aggiornamento" start unfolded (default `false`): the
   * state of an article starts with it, another `resetKey` returns to it, and
   * the toggle still folds and unfolds them. A past text opens them because
   * the rule that applies is often in them.
   */
  updatesOpenByDefault?: boolean;
}

/**
 * The interactive parts of a structured article text (utils/articleRender.ts):
 * a "(119)" reference opens its AGGIORNAMENTO note, the "Note di
 * aggiornamento" toggle folds the notes at the bottom, an annotation sign
 * opens its block's notes and highlights. One delegated click and one keydown
 * listener on the body, because the markup comes from `SafeHTML` and has no
 * React handlers of its own; Enter and Space activate, as on a button. One
 * popover at a time: opening a note closes a block and the reverse.
 *
 * Folding is a class on the text container (`vlx-updates-open`, applied by
 * the caller from `updatesOpen`), not part of the rendered HTML: toggling
 * never replaces the text, so keyboard focus and any open selection survive.
 *
 * State belongs to one article: `resetKey` changing (another article in the
 * same component) returns to the default (`updatesOpenByDefault`), adjusted during render rather than in an
 * effect (CLAUDE.md gotcha 11); a changed `contentKey` closes an open note.
 */
export function useArticleTextInteractions(
  containerRef: RefObject<HTMLElement | null>,
  resetKey: string,
  { enabled = true, contentKey = '', updatesOpenByDefault = false }: ArticleTextInteractionOptions = {},
): {
  updatesOpen: boolean;
  openNote: OpenUpdateNote | null;
  closeNote: () => void;
  /** Unfolds the AGGIORNAMENTO notes — e.g. before scrolling to a search hit inside them. */
  openUpdates: () => void;
  /**
   * The block whose annotation sign was activated. Unlike a note it survives
   * a redraw of the text — an edit or a removal made inside it redraws the
   * body — and closes on another article.
   */
  openBlock: number | null;
  closeBlock: () => void;
} {
  // The default is part of the identity of the state: the same article shown
  // as a past text and then as the text in force (or the reverse) keeps its
  // `resetKey` but not its folding.
  const scope = `${updatesOpenByDefault ? 'open' : 'closed'}:${resetKey}`;
  const [state, setState] = useState<State>(() => fresh(scope, updatesOpenByDefault));
  // Another article: start from the default, and store it. Deriving alone would let an
  // A → B → A round trip find its old state valid again and reopen a note or
  // a block nobody asked for (React's pattern for state that follows a prop).
  if (state.key !== scope) setState(fresh(scope, updatesOpenByDefault));
  const current = state.key === scope ? state : fresh(scope, updatesOpenByDefault);
  const openNote =
    current.openNote && current.openNote.contentKey === contentKey
      ? { id: current.openNote.id, anchorEl: current.openNote.anchorEl }
      : null;
  const closeNote = useCallback(() => {
    setState((s) => (s.key === scope ? { ...s, openNote: null } : fresh(scope, updatesOpenByDefault)));
  }, [scope, updatesOpenByDefault]);

  const closeBlock = useCallback(() => {
    setState((s) => (s.key === scope ? { ...s, openBlock: null } : fresh(scope, updatesOpenByDefault)));
  }, [scope, updatesOpenByDefault]);

  const openUpdates = useCallback(() => {
    setState((s) => ({ ...(s.key === scope ? s : fresh(scope, updatesOpenByDefault)), updatesOpen: true }));
  }, [scope, updatesOpenByDefault]);

  // A layout effect, not a passive one: the signs and chips are focusable
  // buttons from the commit that draws them, and a passive effect runs in a
  // later task — a press in between (a busy main thread) was silently lost.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    const base = (s: State): State => (s.key === scope ? s : fresh(scope, updatesOpenByDefault));

    const activate = (target: Element): boolean => {
      const sign = target.closest<HTMLElement>('.vlx-sign');
      if (sign && container.contains(sign)) {
        const index = Number(sign.dataset.block);
        if (sign.dataset.block === undefined || !Number.isInteger(index) || index < 0) return false;
        setState((s) => {
          const b = base(s);
          return { ...b, openNote: null, openBlock: b.openBlock === index ? null : index };
        });
        return true;
      }
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
          return { ...b, openBlock: null, openNote: same ? null : { id, anchorEl: chip, contentKey } };
        });
        return true;
      }
      const toggle = target.closest<HTMLElement>('.vlx-updates-toggle');
      if (toggle && container.contains(toggle)) {
        setState((s) => {
          const b = base(s);
          return { ...b, updatesOpen: !b.updatesOpen, openNote: null, openBlock: null };
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
      if (!(target instanceof Element) || !target.matches('.vlx-ref, .vlx-updates-toggle, .vlx-sign')) return;
      if (activate(target)) e.preventDefault(); // Space would scroll the page
    };
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('click', onClick);
      container.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, scope, enabled, contentKey, updatesOpenByDefault]);

  // The toggle lives in SafeHTML's markup, which React does not own: keep its
  // aria-expanded in step with the state (a DOM write, not a state update).
  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>('.vlx-updates-toggle')
      ?.setAttribute('aria-expanded', current.updatesOpen ? 'true' : 'false');
  }, [current.updatesOpen, containerRef, contentKey]);

  return { updatesOpen: current.updatesOpen, openNote, closeNote, openUpdates, openBlock: current.openBlock, closeBlock };
}
