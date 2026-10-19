import { useCallback, useEffect, useRef, useState } from 'react';
import { studiaService } from '../../../services/studiaService';
import type { Materia, OggiDelVoto, SchedaDiRipasso, Voto } from '../../../types/studia';

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

/** The card is no longer the user's to review (an `apiClient` rejection carries `status`). */
function isGone(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

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
 * spent; «Di nuovo» (1) puts the card back at the end, and its later passes (`practice`) are not
 * sent — 1 sends it back again, 2–4 take it out. A grade that fails to reach the server leaves the
 * card in place, shown, with `saveError` set; grading again sends it again. A grade answered 404
 * (the card left the user's scope meanwhile) is no failure to retry: the card is dropped and
 * `skipped` set, uncounted, until the user moves on.
 *
 * The queue and the shown flag live in refs as well as in state: the key listener in place between
 * a post resolving and the screen rendering would otherwise act on the card already graded. Every
 * move of the queue is made from the ref, and checks that the head is still the card it was made for.
 */
export function useReviewSession(materia?: Materia, { paused = false, onEscape }: ReviewSessionOptions = {}) {
  const [queue, setQueueState] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revealed, setRevealedState] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<ReadonlySet<string>>(new Set());
  const [againIds, setAgainIds] = useState<ReadonlySet<string>>(new Set());
  const [nextDue, setNextDue] = useState<number | null>(null);
  // Today's goal as the last recorded grade left it, and the grade that made the day count (Studia progress spec §5.3).
  const [today, setToday] = useState<OggiDelVoto | null>(null);
  const [goalMet, setGoalMet] = useState<OggiDelVoto | null>(null);
  // How many times the queue has moved on: a card that comes straight back is a new step.
  const [step, setStep] = useState(0);

  const queueRef = useRef<Entry[]>([]);
  const revealedRef = useRef(false);
  // When the question was shown: the grade's duration runs from here.
  const shownAt = useRef(Date.now());
  const busy = useRef(false);
  const latest = useRef(0);

  const setQueue = useCallback((next: Entry[]) => {
    queueRef.current = next;
    setQueueState(next);
  }, []);
  const setRevealed = useCallback((next: boolean) => {
    revealedRef.current = next;
    setRevealedState(next);
  }, []);

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
      setSkipped(false);
      setStep((n) => n + 1);
      shownAt.current = Date.now();
    } catch {
      if (request !== latest.current) return;
      setQueue([]);
      setLoadError(true);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [materia, setQueue, setRevealed]);

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
    if (queueRef.current.length === 0) return;
    setRevealed(true);
    setSkipped(false);
  }, [setRevealed]);

  const grade = useCallback(
    async (rating: Voto) => {
      const entry = queueRef.current[0];
      if (!entry || !revealedRef.current || busy.current) return;
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
          if (outcome.oggi) {
            setToday(outcome.oggi);
            if (outcome.oggi.appenaRaggiunto) setGoalMet(outcome.oggi);
          }
        }
        // The session may have been read again while the post was on its way.
        if (queueRef.current[0]?.card.id === card.id) {
          const [, ...rest] = queueRef.current;
          setQueue(rating === 1 ? [...rest, { card, posted: true }] : rest);
          setRevealed(false);
          setStep((n) => n + 1);
          shownAt.current = Date.now();
        }
        setSaveError(false);
      } catch (error) {
        if (isGone(error)) {
          if (queueRef.current[0]?.card.id === card.id) {
            setQueue(queueRef.current.slice(1));
            setRevealed(false);
            setStep((n) => n + 1);
            shownAt.current = Date.now();
            // Only when this queue still held the card: a session reloaded meanwhile skipped nothing.
            setSkipped(true);
          }
          setSaveError(false);
        } else {
          setSaveError(true);
        }
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [setQueue, setRevealed],
  );

  useEffect(() => {
    if (paused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      // A dialog or sheet that is not this screen's own (shortcuts, feedback, an article) owns the keyboard.
      if (document.querySelector('[aria-modal="true"]') !== null || document.querySelector('[data-find-overlay]') !== null) return;
      if (isForOtherControl(event.target, event.key)) return;
      if (event.key === 'Escape') {
        onEscape?.();
      } else if (event.key === ' ') {
        // Once the answer is shown, space is the page's again: a long answer scrolls.
        if (revealedRef.current || queueRef.current.length === 0) return;
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
    /** The head has already been graded once today in this session: a pass for practice, not sent. */
    practice: queue[0]?.posted ?? false,
    step,
    loading,
    loadError,
    saveError,
    /** The last grade found the card gone from the review: it was dropped, not graded. */
    skipped,
    saving,
    reload: load,
    /** Today's goal after the last recorded grade; null before one. */
    today,
    /** The answer of the grade that made the day count, while this session lasts; null until then. */
    goalMet,
  };
}
