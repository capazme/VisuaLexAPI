import { Link } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { HubCard, StatusPill } from './HubCard';
import type { AsyncSlice } from './useHubData';
import type { MyContribJob } from '../contrib/contribApi';

/**
 * I miei contributi card (§3.3). Shows the last extraction job status when the
 * user can contribute (`full`), else a gated affordance. "Carica appunti" →
 * /merlt/contribuisci.
 */

export interface ContribCardProps {
  canContribute: boolean;
  lastContrib: AsyncSlice<MyContribJob | null>;
}

const STATUS_LABEL: Record<MyContribJob['status'], string> = {
  pending: 'In coda',
  running: 'In estrazione',
  completed: 'Completato',
  failed: 'Fallito',
  timeout: 'Timeout',
};

const STATUS_TONE: Record<MyContribJob['status'], string> = {
  pending: 'text-slate-500',
  running: 'text-blue-600 dark:text-blue-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
  timeout: 'text-amber-600 dark:text-amber-400',
};

export function ContribCard({ canContribute, lastContrib }: ContribCardProps) {
  const pill = !canContribute ? (
    <StatusPill tone="gated">Consenso completo</StatusPill>
  ) : lastContrib.status === 'error' ? (
    <StatusPill tone="error">Non raggiungibile</StatusPill>
  ) : undefined;

  return (
    <HubCard testId="hub-card-contrib" icon={UploadCloud} title="I miei contributi" pill={pill}>
      {!canContribute ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Carica i tuoi appunti per proporre nodi al grafo (RLCF).
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Richiede il consenso <strong>completo</strong>.
          </p>
        </>
      ) : (
        <>
          {lastContrib.status === 'loading' && <p className="text-sm text-slate-400">Caricamento…</p>}
          {lastContrib.status === 'error' && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Contributi non raggiungibili al momento.
            </p>
          )}
          {lastContrib.status === 'success' && lastContrib.data && (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Ultimo caricamento: doc #{lastContrib.data.documentId} —{' '}
              <span className={STATUS_TONE[lastContrib.data.status]}>
                {STATUS_LABEL[lastContrib.data.status]}
              </span>
              {lastContrib.data.candidatesCreated != null && (
                <span className="text-slate-400"> ({lastContrib.data.candidatesCreated} candidati)</span>
              )}
            </p>
          )}
          {lastContrib.status === 'success' && !lastContrib.data && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Non hai ancora caricato appunti.
            </p>
          )}
          <div className="mt-auto pt-3">
            <Link to="/merlt/contribuisci">
              <Button variant="primary" size="sm">
                Carica appunti
              </Button>
            </Link>
          </div>
        </>
      )}
    </HubCard>
  );
}
