import { UploadCloud } from 'lucide-react';
import { HubAction, HubCard } from './HubCard';
import { HUB_NOTE, HUB_TEXT } from './hubStyles';
import type { AsyncSlice } from './useHubData';
import type { MyContribJob } from '../contrib/contribApi';

/**
 * I miei contributi card (§3.3). Shows the last extraction job status when the
 * user can contribute (`full`), else the action says what is missing (S7b).
 * "Carica appunti" → /merlt/contribuisci.
 */

export interface ContribCardProps {
  canContribute: boolean;
  lastContrib: AsyncSlice<MyContribJob | null>;
  /** The consent is still being read: no action yet, rather than one that says consent is missing. */
  consentLoading?: boolean;
}

const STATUS_LABEL: Record<MyContribJob['status'], string> = {
  pending: 'In coda',
  running: 'In estrazione',
  completed: 'Completato',
  failed: 'Fallito',
  timeout: 'Timeout',
};

const STATUS_TONE: Record<MyContribJob['status'], string> = {
  pending: 'text-slate-600 dark:text-slate-400',
  running: 'text-primary-700 dark:text-primary-300',
  completed: 'text-emerald-700 dark:text-emerald-400',
  failed: 'text-red-700 dark:text-red-400',
  timeout: 'text-amber-800 dark:text-amber-400',
};

export function ContribCard({ canContribute, consentLoading = false, lastContrib }: ContribCardProps) {
  const action = !canContribute ? (
    consentLoading ? undefined : <HubAction gated="Serve il consenso completo" />
  ) : (
    <HubAction to="/merlt/contribuisci">Carica appunti</HubAction>
  );

  return (
    <HubCard testId="hub-card-contrib" icon={UploadCloud} title="I miei contributi" action={action}>
      {!canContribute ? (
        <p className={HUB_TEXT}>Carica i tuoi appunti per proporre nodi al grafo (RLCF).</p>
      ) : (
        <>
          {lastContrib.status === 'loading' && <p className={HUB_NOTE}>Caricamento…</p>}
          {lastContrib.status === 'error' && <p className={HUB_TEXT}>Contributi non raggiungibili al momento.</p>}
          {lastContrib.status === 'success' && lastContrib.data && (
            <p className={HUB_TEXT}>
              Ultimo caricamento: doc #{lastContrib.data.documentId} —{' '}
              <span className={STATUS_TONE[lastContrib.data.status]}>{STATUS_LABEL[lastContrib.data.status]}</span>
              {lastContrib.data.candidatesCreated != null && (
                <span className="text-slate-600 dark:text-slate-400"> ({lastContrib.data.candidatesCreated} candidati)</span>
              )}
            </p>
          )}
          {lastContrib.status === 'success' && !lastContrib.data && (
            <p className={HUB_TEXT}>Non hai ancora caricato appunti.</p>
          )}
        </>
      )}
    </HubCard>
  );
}
