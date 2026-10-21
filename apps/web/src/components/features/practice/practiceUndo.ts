import { showUndoToast } from '../../../hooks/useUndoableAction';
import { appStore } from '../../../store/useAppStore';

/**
 * Closing a practice, all of them, or taking an act off the table, with «Annulla» instead of a confirmation (K1a): the
 * practices are the browser's working table, not data on the server (spec D6), so «Annulla» puts back exactly what was
 * there — the practices at their places with their open rows and the active one, the act at its place with the windows
 * it had beside. What was opened meanwhile stays.
 */

const rowsUnder = (prefix: string) =>
  Object.fromEntries(Object.entries(appStore.getState().practiceRows).filter(([key]) => key.startsWith(prefix))) as Record<string, true>;

export function closePracticeWithUndo(practiceId: string): void {
  const state = appStore.getState();
  const practice = state.practices.find((p) => p.id === practiceId);
  if (!practice) return;
  const at = state.practices.indexOf(practice);
  const rows = rowsUnder(`${practiceId}/`);
  const wasActive = state.activePracticeId === practiceId;
  void showUndoToast({
    action: () => appStore.getState().closePractice(practiceId),
    undo: () => appStore.getState().reopenPractices([{ practice, index: at }], rows, wasActive ? practiceId : null),
    message: `Pratica «${practice.label}» chiusa`,
  });
}

export function closeAllPracticesWithUndo(): void {
  const { practices, practiceRows, activePracticeId } = appStore.getState();
  if (practices.length === 0) return;
  void showUndoToast({
    action: () => appStore.getState().closeAllPractices(),
    undo: () => appStore.getState().reopenPractices(practices.map((practice, index) => ({ practice, index })), { ...practiceRows }, activePracticeId),
    message: practices.length === 1 ? 'Pratica chiusa' : `${practices.length} pratiche chiuse`,
  });
}

export function removePracticeActWithUndo(practiceId: string, actId: string): void {
  const practice = appStore.getState().practices.find((p) => p.id === practiceId);
  const act = practice?.acts.find((a) => a.id === actId);
  if (!practice || !act) return;
  const at = practice.acts.indexOf(act);
  const beside = practice.beside.filter((b) => b.kind === 'article' && b.actId === actId);
  const rows = rowsUnder(`${practiceId}/${actId}/`);
  void showUndoToast({
    action: () => appStore.getState().removePracticeAct(practiceId, actId),
    undo: () => appStore.getState().restorePracticeAct(practiceId, act, at, beside, rows),
    message: 'Atto tolto dalla pratica',
  });
}
