import { useConsent } from './useConsent';
import { ConsentChoiceModal } from './ConsentChoiceModal';

/**
 * «Cambia scelta»: the consent chosen again on request (Impostazioni, the MERL-T hub, the graph),
 * with the same notice and levels as the once-only screen, and dismissible.
 */
export interface ConsentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ConsentDialog({ open, onClose }: ConsentDialogProps) {
  const { notice, consent, setConsent } = useConsent();
  if (!notice || !consent) return null;
  return (
    <ConsentChoiceModal
      isOpen={open}
      notice={notice}
      initialLevel={consent.updatedAt !== null ? consent.storedLevel : null}
      dismissible
      intro="Scegli se MERL-T può imparare dalla tua attività, e quanto. La scelta vale da subito."
      onConfirm={async (level, noticeId) => {
        await setConsent(level, noticeId, 'Aggiornato dall’utente');
        onClose();
      }}
      onCancel={onClose}
    />
  );
}
