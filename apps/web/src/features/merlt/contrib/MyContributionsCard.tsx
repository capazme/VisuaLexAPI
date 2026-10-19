import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { fetchMyContribJobs, type MyContribJob } from './contribApi';

/**
 * Hub widget: the current user's recent extraction jobs.
 *
 * Closes the contribution loop visually — ContribPage state used to live only
 * in `useState`, so a refresh wiped the in-flight document. Now the user can
 * always come back to /merlt and see their previous extractions, click any
 * completed one to re-open the candidates view.
 */

type State =
  | { status: 'loading' }
  | { status: 'success'; jobs: MyContribJob[] }
  | { status: 'error' };

const STATUS_LABEL: Record<MyContribJob['status'], string> = {
  pending: 'In coda',
  running: 'In estrazione',
  completed: 'Completato',
  failed: 'Fallito',
  timeout: 'Timeout',
};

function StatusBadge({ status }: { status: MyContribJob['status'] }): React.ReactElement {
  const config: Record<MyContribJob['status'], { icon: React.ElementType; cls: string }> = {
    pending: { icon: Clock, cls: 'text-slate-500 bg-slate-100 dark:bg-slate-800' },
    running: { icon: Loader2, cls: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40' },
    completed: { icon: CheckCircle2, cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' },
    failed: { icon: AlertCircle, cls: 'text-red-600 bg-red-50 dark:bg-red-950/40' },
    timeout: { icon: AlertCircle, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40' },
  };
  const { icon: Icon, cls } = config[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <Icon className={`h-3 w-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MyContributionsCard(): React.ReactElement {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchMyContribJobs()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', jobs: data.jobs });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return <p className="text-xs text-slate-400">Caricamento contributi…</p>;
  }
  if (state.status === 'error') {
    return <p className="text-xs text-red-500">Impossibile caricare i contributi.</p>;
  }
  if (state.jobs.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Nessun contributo ancora. Carica un file di appunti per iniziare.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5" data-testid="my-contributions-list">
      {state.jobs.slice(0, 5).map((j) => {
        const inner = (
          <span className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
            <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">
              doc #{j.documentId}
              {j.candidatesCreated != null && (
                <span className="ml-2 text-slate-400">{j.candidatesCreated} candidati</span>
              )}
            </span>
            <StatusBadge status={j.status} />
          </span>
        );
        return (
          <li key={j.id}>
            {j.status === 'completed' ? (
              <Link to={`/merlt/contribuisci?documentId=${encodeURIComponent(j.documentId)}`} className="block">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
