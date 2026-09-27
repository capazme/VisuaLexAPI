import { useState } from 'react';
import { ShieldCheck, BookOpen, MessageSquare, GraduationCap } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { cn } from '../../../lib/utils';
import { HubCard } from './HubCard';
import { useConsent } from '../consent/useConsent';
import type { MerltConsentLevel } from '../merltConsent';

/**
 * Consenso & privacy card (§3.3). Renders the current level, the read→ask→teach
 * ladder as a visual, plus change (opens the shared dialog) and REVOKE — the
 * latter wires the previously-dead `revokeConsent` DELETE (design D3).
 */

export interface ConsentCardProps {
  /** Opens the shared ConsentDialog owned by the page. */
  onManage: () => void;
}

const LEVEL_LABEL: Record<MerltConsentLevel, string> = {
  none: 'Nessuno',
  basic: 'Base',
  full: 'Completo',
};

/** The three ladder rungs, in order; `min` is the level that unlocks each. */
const LADDER: { min: MerltConsentLevel; icon: typeof BookOpen; label: string; desc: string }[] = [
  { min: 'none', icon: BookOpen, label: 'Leggi', desc: 'Consulta il grafo. Sempre libero.' },
  { min: 'basic', icon: MessageSquare, label: 'Chiedi', desc: 'Fai domande all’assistente.' },
  { min: 'full', icon: GraduationCap, label: 'Insegna', desc: 'Contribuisci e valida.' },
];

const LEVEL_RANK: Record<MerltConsentLevel, number> = { none: 0, basic: 1, full: 2 };

export function ConsentCard({ onManage }: ConsentCardProps) {
  const { level, consent, revokeConsent } = useConsent();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = () => {
    setRevoking(true);
    // revokeConsent is async; the context reconciles the level on success. On
    // failure we surface nothing louder than the console — the dialog closes and
    // the level stays as the server reports it (context handles the error state).
    revokeConsent('revoked from hub')
      .catch((err) => {
        console.error('hub: consent revoke failed:', err);
      })
      .finally(() => {
        setRevoking(false);
        setConfirmRevoke(false);
      });
  };

  return (
    <HubCard testId="hub-card-consent" icon={ShieldCheck} title="Consenso & Privacy">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Livello attuale: <strong>{LEVEL_LABEL[level]}</strong>.
      </p>

      <ul className="mt-3 space-y-1.5" data-testid="consent-ladder">
        {LADDER.map((rung) => {
          const active = LEVEL_RANK[level] >= LEVEL_RANK[rung.min];
          const Icon = rung.icon;
          return (
            <li
              key={rung.label}
              className={cn(
                'flex items-start gap-2 text-xs',
                active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-600',
              )}
            >
              <Icon size={14} className={cn('mt-0.5 shrink-0', active && 'text-primary-500')} />
              <span>
                <strong>{rung.label}</strong> — {rung.desc}
              </span>
            </li>
          );
        })}
      </ul>

      {consent?.lastAuditAt && (
        <p className="mt-2 text-xs text-slate-400">
          Ultima modifica: {new Date(consent.lastAuditAt).toLocaleString('it-IT')}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <Button variant="secondary" size="sm" onClick={onManage}>
          Gestisci
        </Button>
        {level !== 'none' && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
            Revoca
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmRevoke}
        variant="danger"
        title="Revocare il consenso?"
        message="MERL-T smetterà di raccogliere qualsiasi segnale dalla tua attività. I dati già associati alle tue contribuzioni restano attribuiti a te. Potrai riattivare il consenso in qualsiasi momento."
        confirmLabel={revoking ? 'Revoca in corso…' : 'Revoca consenso'}
        onConfirm={handleRevoke}
        onCancel={() => setConfirmRevoke(false)}
      />
    </HubCard>
  );
}
