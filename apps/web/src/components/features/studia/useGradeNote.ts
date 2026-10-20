import { useCallback, useEffect, useRef, useState } from 'react';
import type { SchedaDiRipasso, Voto } from '../../../types/studia';
import { formatInterval } from './formatInterval';

/** How long the note after a grade stays on screen (Gymnasium spec §5.4: «about a second»). */
export const GRADE_NOTE_MS = 1000;

const GRADE_KEYS: Record<string, Voto> = { '1': 1, '2': 2, '3': 3, '4': 4 };

/**
 * What the note says after a grade: «Torna tra 3 giorni» from the card's `anteprima`, «Torna domani»;
 * «Torna in coda» for «Di nuovo», which sends the card to the back of today's session; «Fatta per oggi»
 * for a practice pass that takes it out (nothing is recorded, so no interval is promised).
 */
export function gradeNote(rating: Voto, days: number, practice: boolean): string {
  if (rating === 1) return 'Torna in coda';
  if (practice) return 'Fatta per oggi';
  const when = formatInterval(days);
  return when === 'oggi' || when === 'domani' ? `Torna ${when}` : `Torna tra ${when}`;
}

export interface GradeNoteInput {
  /** `useReviewSession`'s `step`: it moves on when a grade (or a skip, or a new read) changes the head. */
  step: number;
  current: SchedaDiRipasso | null;
  revealed: boolean;
  practice: boolean;
  saving: boolean;
  skipped: boolean;
  /** The screen's dialog is open: the session leaves the keys alone, and so does this. */
  paused: boolean;
}

interface Intent {
  step: number;
  rating: Voto;
  days: number;
  practice: boolean;
}

/**
 * The note shown for a second after a grade (Gymnasium spec §5.4). `useReviewSession` is read only (its
 * logic is the spec's §3), and it does not say which grade moved the queue, so the grade is read here
 * where the user gives it: a click on the bar (`recordGrade`, called before `grade`) or a key 1–4,
 * heard on the window's capture phase, ahead of the session's own listener on the document. A key is
 * taken only when the session would take it — the same filters (a modifier, a repeat, an open dialog or
 * `data-find-overlay` layer, a field), the answer shown, no grade on its way — and the note is drawn only
 * when the step moves on from the one it was given at, never for a card that left the review (`skipped`).
 * A grade that failed to reach the server moves nothing, and the next one replaces it. The note takes no
 * focus and blocks nothing.
 */
export function useGradeNote({ step, current, revealed, practice, saving, skipped, paused }: GradeNoteInput) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [note, setNote] = useState<{ key: number; text: string } | null>(null);
  const [seenStep, setSeenStep] = useState(step);
  // A grade is on its way from the moment it is given, before the session's `saving` reaches the screen:
  // a second key in between is one the session ignores, so it must not replace the first here.
  const inFlight = useRef(false);

  const recordGrade = useCallback(
    (rating: Voto) => {
      if (!current || !revealed || inFlight.current) return;
      inFlight.current = true;
      setIntent({ step, rating, days: current.anteprima[`${rating}`], practice });
    },
    [current, revealed, step, practice],
  );

  // The grade has landed (the step moved on), failed (saving is over), was a practice pass, which posts nothing,
  // or was never taken by the session (a key stopped on its way): a render with nothing on its way frees the guard.
  useEffect(() => {
    if (!saving) inFlight.current = false;
  }, [step, saving, intent]);

  useEffect(() => {
    if (paused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.key in GRADE_KEYS) || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector('[aria-modal="true"], [data-find-overlay]') !== null) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return;
      recordGrade(GRADE_KEYS[event.key]);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [paused, recordGrade]);

  // A move with no grade behind it (a skipped card, a new read after «Continua») takes the last note away with it.
  if (step !== seenStep) {
    setSeenStep(step);
    if (intent) setIntent(null);
    setNote(intent && intent.step === seenStep && !skipped ? { key: step, text: gradeNote(intent.rating, intent.days, intent.practice) } : null);
  }

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), GRADE_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  return { note: note?.text ?? null, noteKey: note?.key ?? null, recordGrade };
}
