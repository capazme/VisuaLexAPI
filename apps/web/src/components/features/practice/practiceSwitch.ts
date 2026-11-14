import { flushSync } from 'react-dom';
import { canTransitionPage } from '../../../lib/pageTransition';
import { appStore } from '../../../store/useAppStore';
import { articleRowKey, decisionRowKey, type BesideRef } from '../../../utils/practice';

/**
 * The passage between the practice's two views (U2, L-62): an act's panel shrinks and slides into the index while the
 * window comes in from the right, and back. A View Transition (`index.css`), 260 ms, played only for a row's «Apri
 * accanto» that opens the first window and a window's «Chiudi» that closes the last; any other change of view is
 * immediate. The pieces are named only while it plays: the class on the root, as `vlx-page-changing` (a
 * `view-transition-name` makes a stacking context, gotcha 22), and each piece's name in `--vlx-vt` on an element of
 * class `vlx-vt` (`practiceTransitionName`).
 */
export const PRACTICE_SWITCHING = 'vlx-practice-switching';

/** The class of an element named while the passage plays; its name is `--vlx-vt` in its own style. */
export const PRACTICE_VT = 'vlx-vt';

/** The transition playing, if any: a change asked meanwhile waits for it to end. */
let playing: ViewTransition | null = null;

/** While a transition plays, `retry` runs when it ends (it ended or failed) and this answers true; else false. A change
 *  that waits decides again what it does once it runs: the view may have changed meanwhile. */
function waitForPlaying(retry: () => void): boolean {
  if (!playing) return false;
  playing.finished.then(retry, retry);
  return true;
}

/** A piece's name: a prefix and an id made a CSS identifier (a saved act's id is untrusted text). */
export function practiceTransitionName(prefix: string, id = ''): string {
  return `vlx-${prefix}${id ? `-${id.replace(/[^A-Za-z0-9_-]/g, '_')}` : ''}`;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Changes the view with `update` (a store action), drawn at once (`flushSync`), then runs `after` on the new page (a
 * focus to give). With View Transitions and motion allowed, inside one; a change asked while one plays waits for it to
 * end and then plays its own, so neither jumps. Without them, or under reduced motion, at once.
 */
export function switchPracticeView(update: () => void, after?: () => void): void {
  const apply = () => {
    flushSync(update);
    after?.();
  };
  if (!canTransitionPage() || reducedMotion()) {
    apply();
    return;
  }
  if (waitForPlaying(() => switchPracticeView(update, after))) return;
  const root = document.documentElement;
  root.classList.add(PRACTICE_SWITCHING);
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(apply);
  } catch (error) {
    // Never left named, never left unchanged.
    console.warn('switchPracticeView: the View Transition did not start; the view changes at once', error);
    root.classList.remove(PRACTICE_SWITCHING);
    apply();
    return;
  }
  playing = transition;
  // Registered before any change that waits on it, so the class is off and the way free when that one starts.
  const done = () => {
    if (playing !== transition) return;
    playing = null;
    root.classList.remove(PRACTICE_SWITCHING);
  };
  transition.finished.then(done, done);
}

/**
 * The row of `ref`'s subject in the overview, focused without moving the page; for an article in a folded act, the
 * act's heading. A topic search has neither: `ReadingRow` has given the focus to the table's first control.
 */
function focusRowOf(practiceId: string, ref: BesideRef): void {
  const rowKey = ref.kind === 'article' ? articleRowKey(practiceId, ref.actId, ref.articleKey)
    : ref.kind === 'decision' ? decisionRowKey(practiceId, ref.decisionId) : null;
  if (!rowKey) return;
  const row = Array.from(document.querySelectorAll<HTMLElement>('[data-practice-row]')).find((el) => el.dataset.practiceRow === rowKey);
  const act = ref.kind === 'article'
    ? Array.from(document.querySelectorAll<HTMLElement>('[data-act-id]')).find((el) => el.dataset.actId === ref.actId)
    : undefined;
  // The row's toggle, or the act heading's (the drag handle is a `<button>`, not a `role="button"`).
  (row ?? act)?.querySelector<HTMLElement>('[role="button"]')?.focus({ preventScroll: true });
}

/**
 * A window's «Chiudi»: the subject stays in the table (D7). Closing the last window brings the overview back through
 * the passage and gives the focus to the subject's row; closing another gives it to the window left open.
 */
export function closePracticeWindow(practiceId: string, ref: BesideRef): void {
  if (waitForPlaying(() => closePracticeWindow(practiceId, ref))) return;
  const { practices, closeBeside, openBeside } = appStore.getState();
  const left = practices.find((p) => p.id === practiceId)?.beside.filter((b) => b.id !== ref.id) ?? [];
  if (left.length > 0) {
    closeBeside(practiceId, ref.id);
    openBeside(practiceId, left[left.length - 1], undefined, { focus: true });
    return;
  }
  switchPracticeView(() => closeBeside(practiceId, ref.id), () => focusRowOf(practiceId, ref));
}

/** A row's «Apri accanto» in the overview: the first window opens through the passage, and takes the focus. */
export function openPracticeWindow(practiceId: string, ref: BesideRef): void {
  if (waitForPlaying(() => openPracticeWindow(practiceId, ref))) return;
  const opened = () => appStore.getState().openBeside(practiceId, ref, undefined, { focus: true });
  const shown = appStore.getState().practices.find((p) => p.id === practiceId)?.beside.length ?? 0;
  if (shown > 0) opened();
  else switchPracticeView(opened);
}
