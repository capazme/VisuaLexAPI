import { useState } from 'react';
import { ShieldCheck, BookOpen, MessageSquare, GraduationCap } from 'lucide-react';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { HubCard } from './HubCard';
import { HUB_TEXT } from './hubStyles';
import { useConsent } from '../consent/useConsent';
import { RevokeConsentDialog } from '../consent/RevokeConsentDialog';
import { LEVEL_LABEL } from '../consent/levels';
import type { MerltConsentLevel } from '../merltConsent';

/**
 * Consenso & privacy card (§3.3). Renders the current level, the read→ask→teach
 * ladder as a visual, plus change (opens the shared dialog) and revoke, through the
 * same dialog as Impostazioni: revoke only, or revoke and erase what was collected.
 * Since S7b it opens from the hub's row of links at the page's foot, not in the grid.
 */

const PANEL_BUTTON = `inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${FOCUS_RING}`;

export interface ConsentCardProps {
  /** Opens the shared ConsentDialog owned by the page. */
  onManage: () => void;
}


/** The three ladder rungs, in order; `min` is the level that unlocks each. */
const LADDER: { min: MerltConsentLevel; icon: typeof BookOpen; label: string; desc: string }[] = [
  { min: 'none', icon: BookOpen, label: 'Leggi', desc: 'Consulta il grafo. Sempre libero.' },
  { min: 'basic', icon: MessageSquare, label: 'Chiedi', desc: 'Fai domande all’assistente.' },
  { min: 'full', icon: GraduationCap, label: 'Insegna', desc: 'Contribuisci e valida.' },
];

const LEVEL_RANK: Record<MerltConsentLevel, number> = { none: 0, basic: 1, full: 2 };

export function ConsentCard({ onManage }: ConsentCardProps) {
  const { level, consent, notice } = useConsent();
  const [revokeOpen, setRevokeOpen] = useState(false);

  return (
    <HubCard
      testId="hub-card-consent"
      icon={ShieldCheck}
      title="Consenso e privacy"
      action={
        <>
          {/* Without a notice (no MERL-T on the server) there is nothing to choose: no «Gestisci» doing nothing. */}
          {notice && (
            <button type="button" onClick={onManage} className={PANEL_BUTTON}>
              Gestisci
            </button>
          )}
          {level !== 'none' && (
            <button type="button" onClick={() => setRevokeOpen(true)} className={PANEL_BUTTON}>
              Revoca
            </button>
          )}
        </>
      }
    >
      <p className={HUB_TEXT}>
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
                'flex items-start gap-2 text-[13px]',
                // A rung not open yet stays readable (4.5:1): the icon's colour says which are open.
                active ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400',
              )}
            >
              <Icon size={14} aria-hidden className={cn('mt-0.5 shrink-0', active ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500')} />
              <span>
                <strong>{rung.label}</strong> — {rung.desc}
                {!active && <span className="sr-only"> (non attivo)</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {consent?.lastAuditAt && (
        <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-400">
          Ultima modifica: {new Date(consent.lastAuditAt).toLocaleString('it-IT')}
        </p>
      )}

      <RevokeConsentDialog open={revokeOpen} onClose={() => setRevokeOpen(false)} />
    </HubCard>
  );
}
