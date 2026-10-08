import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useArticlePassageThreads } from './useArticlePassageThreads';
import { buildPassage, textFingerprint } from '../utils/threadPassages';
import { revealAnnotation } from '../utils/revealAnnotation';
import type { LocatedThread } from '../utils/articleAnnotations';
import type { ThreadPassage } from '../types';

export interface DiscussionWiringOptions {
  /** What the discussions hang on: an article's key and id, or a decision's key and ''. */
  anchor: { normaKey: string; articleId: string };
  /** The text whose SHA-256 is recorded on a new discussion (`textFingerprint` normalises it). */
  text: string;
  /** The plain text (the projection, for a decision) the passages are located against. */
  plain: string;
  /** False: no passage request and no sign (no text yet, a past text, nobody logged in...). */
  enabled: boolean;
  /** The reading surface's root, where «Vai al passo» scrolls. */
  contentRef: RefObject<HTMLElement | null>;
  /** The selection cannot become a passage. */
  onInvalidSelection: () => void;
}

/**
 * The discussion wiring a reading surface shares with every other: passage threads (load and
 * reload), the ones that still land in the text, the panel's open state, the focused thread, the
 * «Discuti» draft and the text fingerprint. The article and the decision both use it; the host
 * keeps what is its own (the anchor's label and version, the heading, the read-only gate).
 */
export function useDiscussionWiring({ anchor, text, plain, enabled, contentRef, onInvalidSelection }: DiscussionWiringOptions) {
  const [open, setOpen] = useState(false);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ passage: ThreadPassage } | null>(null);
  const [textHash, setTextHash] = useState<string | null>(null);

  const {
    threads, isLoading: loading, error, reload, locations,
  } = useArticlePassageThreads(anchor, { enabled, plainText: plain });

  const locatedThreads = useMemo<LocatedThread[]>(
    () => threads.flatMap((t) => {
      const at = locations.get(t.id);
      return at && at.state !== 'detached' ? [{ thread: t, start: at.start, end: at.end }] : [];
    }),
    [threads, locations],
  );
  const passageStates = useMemo(
    () => Object.fromEntries(Array.from(locations.entries()).map(([id, loc]) => [id, loc.state])),
    [locations],
  );

  useEffect(() => {
    let cancelled = false;
    textFingerprint(text)
      .then((hash) => { if (!cancelled) setTextHash(hash); })
      .catch((err) => console.warn('[useDiscussionWiring] text fingerprint failed', err));
    return () => { cancelled = true; };
  }, [text]);

  const popupDiscuss = (selected: string, startOffset: number) => {
    const passage = buildPassage(plain, startOffset, selected);
    if (!passage) {
      onInvalidSelection();
      return;
    }
    setDraft({ passage });
    setOpen(true);
  };

  /** A sign's popover opens a discussion: the panel shows it expanded and its words light up. */
  const openThread = (id: string) => {
    setPanelFocus(id);
    setFocusedThreadId(id);
    setOpen(true);
  };

  const onDraftConsumed = useCallback(() => setDraft(null), []);
  const onClose = useCallback(() => {
    setOpen(false);
    setFocusedThreadId(null);
    setPanelFocus(null);
    setDraft(null);
  }, []);
  const onGoToPassage = useCallback((id: string) => {
    setFocusedThreadId(id);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const root = contentRef.current;
        if (root) revealAnnotation(root, { kind: 'thread', id });
      }),
    );
  }, [contentRef]);

  return {
    open,
    toggle: () => setOpen((v) => !v),
    focusedThreadId,
    locatedThreads,
    loading,
    error,
    reload,
    textHash,
    popupDiscuss,
    openThread,
    /** Spread into `ArticleDiscussionPanel`, beside the host's anchor, label and heading. */
    panelProps: {
      isOpen: open,
      textHash,
      passageLoadError: error,
      passageThreadsLoading: loading,
      onRetryPassageLoad: reload,
      passageStates,
      focusThreadId: panelFocus,
      onFocusThread: setFocusedThreadId,
      draft,
      onDraftConsumed,
      onThreadCreated: reload,
      onGoToPassage,
      onClose,
    },
  };
}
