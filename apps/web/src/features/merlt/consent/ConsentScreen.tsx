import { useConsent } from './useConsent';
import { ConsentChoiceModal } from './ConsentChoiceModal';

/**
 * The MERL-T consent, asked once and outside the work flow (the owner, 12 October 2026: «sì» to
 * a consent asked once, with a complete notice, never a banner during work). Mounted in the
 * `global` slot, it opens as the app loads when the person has not answered the current notice:
 * at their first entry, and again only when an administrator publishes a new version. It cannot
 * be dismissed: «Nessuna raccolta» is one choice among three, and the app is usable after any.
 */
export function ConsentScreen() {
  const { needsAnswer, notice, consent, setConsent } = useConsent();
  if (!needsAnswer || !notice || !consent) return null;

  // Someone who chose before (under an older notice) finds their level offered again;
  // someone never asked finds nothing chosen.
  const answeredBefore = consent.updatedAt !== null;
  return (
    <ConsentChoiceModal
      isOpen
      notice={notice}
      initialLevel={answeredBefore ? consent.storedLevel : null}
      dismissible={false}
      intro={
        answeredBefore
          ? 'L’informativa su MERL-T è cambiata. Rileggila e conferma la tua scelta: fino ad allora MERL-T non raccoglie nulla. Puoi cambiarla quando vuoi da Impostazioni › Dati MERL-T.'
          : 'Prima di iniziare, scegli se MERL-T può imparare dalla tua attività, e quanto. Puoi cambiare scelta quando vuoi da Impostazioni › Dati MERL-T.'
      }
      onConfirm={(level, noticeId) => setConsent(level, noticeId, 'Scelta alla schermata del consenso')}
    />
  );
}
