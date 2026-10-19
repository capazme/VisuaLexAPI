import { useRef, useState } from 'react';
import { XCircle } from 'lucide-react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { rejectBatch } from './opsIngestionApi';
import type { BatchDetail } from './types';

export interface RejectBatchDialogProps {
  batch: BatchDetail;
  onClose: () => void;
  /** Called once the reject call succeeds (batch is now 'rejected', synchronous). */
  onRejected: () => void;
}

type SubmitState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };

/**
 * Confirmation for rejecting a pending_review batch — reason is mandatory
 * (rejectBatchBodySchema requires `reason.min(1)` server-side).
 */
export function RejectBatchDialog({ batch, onClose, onRejected }: RejectBatchDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  const trimmedReason = reason.trim();
  const canSubmit = trimmedReason.length > 0 && state.status !== 'submitting';

  const handleConfirm = async (): Promise<void> => {
    if (!canSubmit) return;
    setState({ status: 'submitting' });
    try {
      await rejectBatch(batch.id, { reason: trimmedReason });
      onRejected();
    } catch (err) {
      console.error('RejectBatchDialog: reject failed:', err);
      setState({ status: 'error', message: 'Rifiuto non riuscito. MERL-T potrebbe non essere raggiungibile.' });
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      role="alertdialog"
      size="sm"
      variant="danger"
      icon={<XCircle size={20} />}
      title={`Rifiutare "${batch.scope_label}"?`}
      description="Il batch resta consultabile nello storico ma non entra nel grafo."
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
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
          >
            {state.status === 'submitting' ? 'Rifiuto…' : 'Sì, rifiuta'}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <label htmlFor="reject-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
          Motivazione <span className="text-red-500">*</span>
        </label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          required
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {state.status === 'error' && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {state.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
