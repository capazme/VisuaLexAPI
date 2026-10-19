import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { HubCard, StatusPill } from './HubCard';
import type { AsyncSlice } from './useHubData';

/**
 * Valida proposte card (§3.3). Shows the live count of proposals awaiting the
 * user's vote ("N proposte in attesa") → /merlt/valida. Zero is shown, not
 * hidden. Requires `full` consent (canValidate): when not, a gated state — not
 * an error.
 */

export interface ValidateCardProps {
  canValidate: boolean;
  pendingCount: AsyncSlice<number>;
}

export function ValidateCard({ canValidate, pendingCount }: ValidateCardProps) {
  const pill = !canValidate ? (
    <StatusPill tone="gated">Consenso completo</StatusPill>
  ) : pendingCount.status === 'error' ? (
    <StatusPill tone="error">Non raggiungibile</StatusPill>
  ) : undefined;

  return (
    <HubCard testId="hub-card-validate" icon={ScrollText} title="Valida proposte" pill={pill}>
      {!canValidate ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Vota le proposte di nodi e relazioni della community (RLCF).
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Richiede il consenso <strong>completo</strong> per insegnare al sistema.
          </p>
        </>
      ) : pendingCount.status === 'loading' ? (
        <p className="text-sm text-slate-400">Caricamento…</p>
      ) : pendingCount.status === 'error' ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Non è stato possibile contare le proposte in attesa.
          </p>
          <div className="mt-auto pt-3">
            <Link to="/merlt/valida">
              <Button variant="secondary" size="sm">
                Apri la coda
              </Button>
            </Link>
          </div>
        </>
      ) : (
        <>
          {pendingCount.status === 'success' && pendingCount.data > 0 ? (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              <strong className="text-lg text-primary-600 dark:text-primary-400">
                {pendingCount.data}
              </strong>{' '}
              {pendingCount.data === 1 ? 'proposta in attesa' : 'proposte in attesa'} del tuo voto.
            </p>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nessuna proposta in attesa. Ottimo lavoro!
            </p>
          )}
          <div className="mt-auto pt-3">
            <Link to="/merlt/valida">
              <Button variant="primary" size="sm">
                {pendingCount.status === 'success' && pendingCount.data > 0 ? 'Vota ora' : 'Apri la coda'}
              </Button>
            </Link>
          </div>
        </>
      )}
    </HubCard>
  );
}
