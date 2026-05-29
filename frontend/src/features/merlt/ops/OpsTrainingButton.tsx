import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { startMerltTraining } from '../../../services/merltService';

/**
 * Admin-only control to kick off a manual RLCF training run (loop-closure A5).
 *
 * No auto-training: a run starts only on this explicit click. The server gate
 * (requireAdmin on POST /api/merlt/ops/rlcf/training/start) is authoritative; this
 * button is rendered only inside the opsVisible card of the hub.
 */

type State =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'started'; message: string }
  | { status: 'error'; message: string };

export function OpsTrainingButton(): React.ReactElement {
  const [state, setState] = useState<State>({ status: 'idle' });

  const onStart = async (): Promise<void> => {
    setState({ status: 'starting' });
    try {
      const res = await startMerltTraining();
      const message = typeof res.message === 'string' ? res.message : 'Training avviato';
      setState({ status: 'started', message });
    } catch {
      setState({ status: 'error', message: 'MERL-T non raggiungibile' });
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={state.status === 'starting'}
        onClick={onStart}
      >
        {state.status === 'starting' ? 'Avvio…' : 'Avvia training RLCF'}
      </Button>
      {state.status === 'started' && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{state.message}</p>
      )}
      {state.status === 'error' && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
      )}
    </div>
  );
}
