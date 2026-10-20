import { todayInRome } from '../../../utils/dateUtils';
import { BLOCK_HEADING, TILE } from '../studia/progress/tokens';
import { cn } from '../../../lib/utils';
import { QuickAddField } from './QuickAddField';
import { TaskList } from './TaskList';
import { TaskListSkeleton, TaskViewError, TruncatedNote } from './TaskViewStates';
import { useTaskView } from './useTaskView';

/**
 * «Compiti» on a dossier's page (the planner's row 13): the dossier's open tasks, with the quick add, the dossier
 * already chosen. The rows do not repeat the dossier's name. Nothing here touches the dossier's entries.
 */
export function DossierTasksPanel({ dossierId }: { dossierId: string }) {
  const state = useTaskView('dossier', dossierId);
  const today = state.answer?.today ?? todayInRome();
  const tasks = state.answer?.tasks ?? [];
  return (
    <section aria-labelledby="dossier-tasks-heading" className={cn(TILE, 'mb-6 space-y-3 p-3 md:p-4')}>
      <h3 id="dossier-tasks-heading" tabIndex={-1} data-focus-fallback className={cn(BLOCK_HEADING, 'focus-visible:outline-none')}>
        Compiti
        {tasks.length > 0 && (
          <span className="ml-2 font-sans text-sm font-normal text-slate-600 dark:text-slate-400">
            <span className="sr-only">, </span>
            {tasks.length}
            <span className="sr-only">{tasks.length === 1 ? ' compito' : ' compiti'}</span>
          </span>
        )}
      </h3>
      <QuickAddField key={dossierId} view="dossier" today={today} defaults={{ dossierId }} dossierLocked />
      <div aria-busy={state.status === 'loading'}>
        {state.status === 'error' && <TaskViewError onRetry={state.reload} />}
        {state.answer === null ? (
          state.status === 'loading' && <TaskListSkeleton rows={2} />
        ) : tasks.length === 0 ? (
          <p className="px-1 text-sm text-slate-600 dark:text-slate-400">Nessun compito in questo dossier.</p>
        ) : (
          <TaskList label="Compiti del dossier" tasks={tasks} today={today} optimistic={state.optimistic} showDossier={false} />
        )}
        {state.answer?.truncated && <TruncatedNote />}
      </div>
    </section>
  );
}
