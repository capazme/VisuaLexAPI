import { useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { promoteBatch, extractUrnConflictsError } from './opsIngestionApi';
import type { BatchDetail, UrnConflict } from './types';

export interface PromoteBatchDialogProps {
  batch: BatchDetail;
  onClose: () => void;
  /** Called once the promote call returns 200 (batch now 'promoting', async). */
  onPromoted: () => void;
}

type SubmitState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };

/**
 * Danger confirmation for promoting a pending_review batch into the graph.
 * Uses `Modal` directly (not the generic ConfirmDialog) because it needs a
 * summary of what enters, the conflict list, a conditional "force" checkbox,
 * and an optional reason field. Follows the held-id + confirm pattern used
 * across the codebase (EnvironmentPage's replace-mode guard).
 */
export function PromoteBatchDialog({ batch, onClose, onPromoted }: PromoteBatchDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const report = batch.conflict_report;
  const [urnConflicts, setUrnConflicts] = useState<UrnConflict[]>(report?.urn_conflicts ?? []);
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  const nodesNew = report?.stats.nodes_new ?? batch.stats?.nodes_new ?? 0;
  const nodesUpdate = report?.stats.nodes_update ?? batch.stats?.nodes_update ?? 0;
  const hasConflicts = urnConflicts.length > 0;
  const blocked = hasConflicts && !force;

  const handleConfirm = async (): Promise<void> => {
    setState({ status: 'submitting' });
    try {
      await promoteBatch(batch.id, { force, reason: reason.trim() || undefined });
      onPromoted();
    } catch (err) {
      const conflicts = extractUrnConflictsError(err);
      if (conflicts) {
        console.error('PromoteBatchDialog: blocked by unresolved URN conflicts:', err);
        setUrnConflicts(conflicts);
        setState({
          status: 'error',
          message: 'Sono presenti conflitti URN non risolti. Spunta "Forza promozione" per procedere comunque.',
        });
        return;
      }
      const status = typeof err === 'object' && err !== null ? (err as { status?: number }).status : undefined;
      if (status === 409) {
        console.error('PromoteBatchDialog: batch no longer promotable (state changed/expired):', err);
        setState({
          status: 'error',
          message: 'Il batch non è più promuovibile: lo stato è cambiato o è scaduto. Aggiorna l\'elenco.',
        });
        return;
      }
      console.error('PromoteBatchDialog: promote failed:', err);
      setState({ status: 'error', message: 'Promozione non riuscita. MERL-T potrebbe non essere raggiungibile.' });
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      role="alertdialog"
      size="md"
      variant="danger"
      icon={<AlertTriangle size={20} />}
      title={`Promuovere "${batch.scope_label}"?`}
      description="Il batch verrà unito al grafo centrale. L'operazione è asincrona e non è reversibile con un semplice annulla."
      initialFocusRef={confirmRef}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={state.status === 'submitting'}>
            Annulla
          </Button>
          <Button
            ref={confirmRef}
            variant="danger"
            size="sm"
            disabled={blocked || state.status === 'submitting'}
            onClick={() => void handleConfirm()}
          >
            {state.status === 'submitting' ? 'Promozione…' : 'Sì, promuovi'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <ul className="list-disc pl-5 text-slate-700 dark:text-slate-300">
          <li>{nodesNew} nodi nuovi</li>
          <li>{nodesUpdate} nodi aggiornati</li>
        </ul>

        {hasConflicts && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
              {urnConflicts.length} conflitto/i URN
            </p>
            <ul className="space-y-1 text-xs text-red-800 dark:text-red-200 font-mono max-h-32 overflow-y-auto">
              {urnConflicts.map((c) => (
                <li key={c.urn}>{c.urn}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
              />
              Forza promozione (ignora conflitti URN)
            </label>
          </div>
        )}

        <div>
          <label htmlFor="promote-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Motivazione (opzionale)
          </label>
          <textarea
            id="promote-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {state.status === 'error' && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {state.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
