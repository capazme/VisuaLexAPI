import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Toast } from '../../ui/Toast';
import { Z_INDEX } from '../../../constants/zIndex';
import { taskService } from '../../../services/taskService';
import { todayInRome } from '../../../utils/dateUtils';
import { plannerStore } from './plannerStore';
import { TaskDialog } from './TaskDialog';
import { belongsTo } from './taskDraft';
import type { TaskView } from '../../../types/tasks';

/** The view the page shows, for «c»: what a new task starts with, and whether it will be seen there. */
function pageView(pathname: string, dossierId: string | null): { view: TaskView; dossierId?: string } | null {
  if (dossierId) return { view: 'dossier', dossierId };
  if (pathname === '/opus/oggi') return { view: 'today' };
  if (pathname === '/opus/prossimi') return { view: 'upcoming' };
  if (pathname === '/opus/ingresso') return { view: 'inbox' };
  return null;
}

/** The bar's count is read again every two minutes while the tab is on screen, and after every write. */
const COUNT_EVERY_MS = 120_000;

/**
 * The key that opens the quick add from anywhere: «c», as in «compito». Free in the app (Layout's shortcuts carry a
 * modifier; the dossier list's n / i, the selection popup's h / n, Study Mode's letters, the review's Space and 1–4).
 */
export const QUICK_ADD_KEY = 'c';

/** The inputs that take letters; a checkbox (where the arrows leave the focus in a list) or a button does not. */
const TYPING_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

/** Whether a key press belongs to something else: a field, an open dialog or menu, a full-screen overlay. */
function keyIsTaken(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.defaultPrevented) return true;
  const target = event.target as HTMLElement | null;
  if (target instanceof HTMLInputElement && TYPING_INPUTS.has(target.type)) return true;
  if (target && (['TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return true;
  return document.querySelector('[aria-modal="true"], [data-find-overlay], [role="menu"]') !== null;
}

/**
 * The planner's pieces every page needs, mounted once by `Layout` (gotcha 27): «c» and the quick-add dialog (on a
 * dossier's page the dossier is chosen), the planner's toast, and the count of today's and overdue tasks the sidebar
 * shows beside «Oggi».
 */
export function PlannerHost({ enabled }: { enabled: boolean }) {
  const quickAdd = plannerStore((s) => s.quickAdd);
  const notice = plannerStore((s) => s.notice);
  const version = plannerStore((s) => s.version);
  // The store's own function: stable, so the toast's timer is not restarted by each render.
  const clearNotice = plannerStore((s) => s.clearNotice);
  const serverToday = plannerStore((s) => s.today);
  const { pathname, search } = useLocation();
  const openDossierId = pathname === '/dossier' ? new URLSearchParams(search).get('dossier') : null;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== QUICK_ADD_KEY || event.shiftKey || keyIsTaken(event)) return;
      event.preventDefault();
      plannerStore.getState().openQuickAdd(openDossierId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, openDossierId]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const read = () => {
      if (document.visibilityState !== 'visible') return;
      taskService.list('today').then(
        (answer) => {
          if (!live) return;
          plannerStore.getState().setTodayCount(answer.tasks.length);
          // A new day here makes every view mounted read again (`useTaskView`).
          plannerStore.getState().setToday(answer.today);
        },
        // The count keeps its last value; the status only, never a title.
        (error: { status?: number }) => console.warn('[planner] the count of today could not be read', error?.status ?? 'no answer'),
      );
    };
    read();
    const timer = setInterval(read, COUNT_EVERY_MS);
    document.addEventListener('visibilitychange', read);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, [enabled, version]);

  const today = serverToday ?? todayInRome();
  const shown = pageView(pathname, openDossierId);
  // On «Oggi» and «Prossimi giorni» a new task is for today, as their own field proposes.
  const forToday = shown?.view === 'today' || shown?.view === 'upcoming';

  return (
    <>
      {quickAdd && (
        <TaskDialog
          defaults={{ ...(quickAdd.dossierId ? { dossierId: quickAdd.dossierId } : {}), ...(forToday ? { plannedDate: today } : {}) }}
          onClose={() => plannerStore.getState().closeQuickAdd()}
          onCreated={(task) => {
            // As the views' own field says it: a task the page will not list is announced.
            const unseen = shown !== null && !belongsTo(task, shown.view, today, shown.dossierId);
            plannerStore.getState().notify(unseen ? 'Compito aggiunto: non è in questa vista' : 'Compito aggiunto', unseen ? 'info' : 'success');
          }}
        />
      )}
      <Toast
        key={notice?.id}
        message={notice?.message ?? ''}
        type={notice?.type ?? 'success'}
        isVisible={notice !== null}
        onClose={clearNotice}
        // At the top: the undo toast of a tick or a deletion holds the bottom edge.
        position="top"
        duration={notice?.type === 'error' ? 6000 : 3000}
        className={Z_INDEX.toast}
      />
    </>
  );
}
