import { ScrollText } from 'lucide-react';
import { HubAction, HubCard } from './HubCard';
import { HUB_NOTE, HUB_TEXT } from './hubStyles';
import type { AsyncSlice } from './useHubData';

/**
 * Valida proposte card (§3.3). Shows the live count of proposals awaiting the
 * user's vote ("N proposte in attesa") → /merlt/valida. Zero is shown, not
 * hidden. Requires `full` consent (canValidate): when not, the action says so
 * (S7b) — not an error.
 */

export interface ValidateCardProps {
  canValidate: boolean;
  pendingCount: AsyncSlice<number>;
  /** The consent is still being read: no action yet, rather than one that says consent is missing. */
  consentLoading?: boolean;
}

export function ValidateCard({ canValidate, consentLoading = false, pendingCount }: ValidateCardProps) {
  const waiting = pendingCount.status === 'success' && pendingCount.data > 0;
  const action = !canValidate ? (
    consentLoading ? undefined : <HubAction gated="Serve il consenso completo" />
  ) : (
    <HubAction to="/merlt/valida">{waiting ? 'Vota ora' : 'Apri la coda'}</HubAction>
  );

  return (
    <HubCard testId="hub-card-validate" icon={ScrollText} title="Valida proposte" action={action}>
      {!canValidate ? (
        <p className={HUB_TEXT}>Vota le proposte di nodi e relazioni della community (RLCF).</p>
      ) : pendingCount.status === 'loading' ? (
        <p className={HUB_NOTE}>Caricamento…</p>
      ) : pendingCount.status === 'error' ? (
        <p className={HUB_TEXT}>Non è stato possibile contare le proposte in attesa.</p>
      ) : pendingCount.status === 'success' && pendingCount.data > 0 ? (
        <p className={HUB_TEXT}>
          <strong className="text-lg text-primary-700 dark:text-primary-300">{pendingCount.data}</strong>{' '}
          {pendingCount.data === 1 ? 'proposta in attesa' : 'proposte in attesa'} del tuo voto.
        </p>
      ) : (
        <p className={HUB_TEXT}>Nessuna proposta in attesa. Ottimo lavoro!</p>
      )}
    </HubCard>
  );
}
