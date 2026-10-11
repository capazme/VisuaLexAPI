import { useCallback, useEffect, useRef, useState } from 'react';
import { studiaService } from '../../../services/studiaService';
import type { Materia, SchedaDiRipasso, Voto } from '../../../types/studia';

const MAX_DURATION_MS = 3_600_000;

/** A card in the queue; `posted` once its first grade has reached the server: later passes are practice and are not sent. */
interface Entry {
  card: SchedaDiRipasso;
  posted: boolean;
}

export interface ReviewSummary {
  /** Distinct cards graded at least once. */
  reviewed: number;
  /** Distinct cards that got «Di nuovo» at least once. */
  again: number;
  /** The shortest interval, in days, the recorded grades scheduled; null when none was recorded. */
  nextDue: number | null;
}

export interface ReviewSessionOptions {
  /** The keys are left alone while a dialog of the screen is open. */
  paused?: boolean;
  /** Esc was pressed (and no dialog was open). */
  onEscape?: () => void;
}

const GRADE_KEYS: Record<string, Voto> = { '1': 1, '2': 2, '3': 3, '4': 4 };

/** Keys typed into a field, or meant for a control that has its own, are not the session's. */
function isForOtherControl(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, select') || target.isContentEditable) return true;
  // A focused button or link takes space itself: acting here as well would act twice.
  return key === ' ' && target.closest('button, a[href], [role="button"]') !== null;
}

/**
 * The review queue of a session. It is read once; the head is `current`. Space shows the answer,
 * 1–4 grade it (only once shown). The first grade of a card is sent to the server, with the time
 * spent; «Di nuovo» (1) puts the card back at the end, and its later passes are not sent — 1 sends
 * it back again, 2–4 take it out. A grade that fails to reach the server leaves the card in place,
 * shown, with `saveError` set; grading again sends it again.
 */
export function useReviewSession(materia?: Materia, { paused = false, onEscape }: ReviewSessionOptions = {}) {
  const [queue, setQueue] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<ReadonlySet<string>>(new Set());
  const [againIds, setAgainIds] = useState<ReadonlySet<string>>(new Set());
  const [nextDue, setNextDue] = useState<number | null>(null);

  // When the question was shown: the grade's duration runs from here.
  const shownAt = useRef(Date.now());
  const busy = useRef(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setLoadError(false);
    try {
      const session = await studiaService.session(materia);
      if (request !== latest.current) return;
      setQueue(session.cards.map((card) => ({ card, posted: false })));
      setRevealed(false);
      setSaveError(false);
      setReviewedIds(new Set());
      setAgainIds(new Set());
      setNextDue(null);
      shownAt.current = Date.now();
    } catch {
      if (request !== latest.current) return;
      setQueue([]);
      setLoadError(true);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [materia]);

  useEffect(() => {
    // Leaving (or asking again) makes the answer in flight stale.
    const requests = latest;
    void load();
    return () => {
      requests.current++;
    };
  }, [load]);

  const current = queue[0]?.card ?? null;

  const reveal = useCallback(() => {
    if (current) setRevealed(true);
  }, [current]);

  const grade = useCallback(
    async (rating: Voto) => {
      const entry = queue[0];
      if (!entry || !revealed || busy.current) return;
      busy.current = true;
      setSaving(true);
      const { card } = entry;
      try {
        if (!entry.posted) {
          const durataMs = Math.min(MAX_DURATION_MS, Math.max(0, Date.now() - shownAt.current));
          const outcome = await studiaService.review({ cardId: card.id, rating, durataMs });
          setReviewedIds((before) => new Set(before).add(card.id));
          if (rating === 1) setAgainIds((before) => new Set(before).add(card.id));
          setNextDue((before) => (before === null ? outcome.scheduledDays : Math.min(before, outcome.scheduledDays)));
        }
        setQueue((before) => {
          const [, ...rest] = before;
          return rating === 1 ? [...rest, { card, posted: true }] : rest;
        });
        setRevealed(false);
        setSaveError(false);
        shownAt.current = Date.now();
      } catch {
        setSaveError(true);
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [queue, revealed],
  );

  useEffect(() => {
    if (paused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      // A dialog that is not this screen's own (shortcuts, feedback) owns the keyboard.
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      if (isForOtherControl(event.target, event.key)) return;
      if (event.key === 'Escape') {
        onEscape?.();
      } else if (event.key === ' ') {
        event.preventDefault();
        reveal();
      } else if (event.key in GRADE_KEYS) {
        void grade(GRADE_KEYS[event.key]);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [paused, onEscape, reveal, grade]);

  const summary: ReviewSummary = { reviewed: reviewedIds.size, again: againIds.size, nextDue };

  return {
    current,
    revealed,
    reveal,
    grade,
    remaining: queue.length,
    done: !loading && !loadError && queue.length === 0,
    summary,
    loading,
    loadError,
    saveError,
    saving,
    reload: load,
  };
}
