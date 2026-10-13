import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { useConsent } from './useConsent';

/**
 * Revoking the MERL-T consent. The revocation counts from now; what was collected before can go
 * with it (the owner's decision 123: revoking offers to delete), so the two ways out are named.
 */
export interface RevokeConsentDialogProps {
  open: boolean;
  onClose: () => void;
  /** Told how it went, for the caller's toast. */
  onDone?: (message: string) => void;
}

export function RevokeConsentDialog({ open, onClose, onDone }: RevokeConsentDialogProps) {
  const { revokeConsent } = useConsent();
  const [busy, setBusy] = useState<'erase' | 'keep' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (deleteData: boolean) => {
    setBusy(deleteData ? 'erase' : 'keep');
    setError(null);
    try {
      const { erasureCompleted } = await revokeConsent({ reason: 'Revocato dall’utente', deleteData });
      onDone?.(
        !deleteData
          ? 'Consenso revocato. MERL-T non raccoglie più nulla.'
          : erasureCompleted
            ? 'Consenso revocato e dati MERL-T eliminati.'
            : 'Consenso revocato. L’eliminazione dei dati è in corso e si completa da sola.',
      );
      onClose();
    } catch {
      setError('La revoca non è riuscita: riprova.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Revocare il consenso a MERL-T?"
      size="md"
      variant="danger"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="sm" className="min-h-[44px] md:min-h-0" onClick={onClose} disabled={busy !== null}>
            Annulla
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="min-h-[44px] md:min-h-0"
            loading={busy === 'keep'}
            disabled={busy !== null}
            onClick={() => void revoke(false)}
          >
            Revoca soltanto
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="min-h-[44px] md:min-h-0"
            loading={busy === 'erase'}
            disabled={busy !== null}
            onClick={() => void revoke(true)}
          >
            Revoca ed elimina i dati raccolti
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
        <p>Da ora MERL-T non raccoglie più nulla della tua attività.</p>
        <p>
          Puoi anche eliminare quanto ha raccolto finora: letture, evidenziazioni, note, domande all’assistente,
          giudizi e documenti. I contributi già approvati dalla comunità restano, senza più alcun legame con te.
        </p>
        {error && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
