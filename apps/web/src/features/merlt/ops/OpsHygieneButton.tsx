import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { runGraphHygiene, type GraphHygieneResponse } from './opsConfigApi';

/**
 * Admin-only control to run one graph hygiene sweep now (co-evolution
 * Slice C): reconcile provisional/confirmed duplicates, decay stale
 * provisional nodes, quarantine doubtful ones for /merlt/valida, prune faded
 * noise. Seed and confirmed nodes are never touched. The periodic sweep
 * depends on MERLT_HYGIENE_INTERVAL_HOURS on merlt-api; this button is the
 * way to run it on demand and to see the counts.
 */

type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; stats: GraphHygieneResponse }
  | { status: 'error'; message: string };

function describe(stats: GraphHygieneResponse): string {
  const parts = [
    `${stats.reconciled ?? 0} riconciliati`,
    `${stats.decayed ?? 0} decaduti`,
    `${stats.quarantined ?? 0} in revisione`,
    `${stats.pruned ?? 0} rimossi`,
  ];
  return `Pulizia eseguita: ${parts.join(', ')}.`;
}

export function OpsHygieneButton(): React.ReactElement {
  const [state, setState] = useState<State>({ status: 'idle' });

  const onRun = async (): Promise<void> => {
    setState({ status: 'running' });
    try {
      const stats = await runGraphHygiene();
      setState({ status: 'done', stats });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setState({
        status: 'error',
        message:
          detail === 'merlt_auth_misconfigured'
            ? 'Chiave amministrativa MERL-T non configurata (MERLT_API_KEY).'
            : 'MERL-T non raggiungibile',
      });
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="secondary" size="sm" disabled={state.status === 'running'} onClick={onRun}>
        {state.status === 'running' ? 'Pulizia in corso…' : 'Esegui pulizia del grafo'}
      </Button>
      {state.status === 'done' && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{describe(state.stats)}</p>
      )}
      {state.status === 'error' && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
      )}
    </div>
  );
}
