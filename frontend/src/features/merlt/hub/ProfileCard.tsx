import { useState } from 'react';
import { Sparkles, HelpCircle, Star } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { HubCard, StatusPill } from './HubCard';
import { authorityToStars } from './authority';
import type { AsyncSlice } from './useHubData';
import type { MerltProfile } from '../../../services/merltService';

/**
 * Profilo card (§3.3). Replaces the bare "Authority 0.44" with a human
 * explanation ("Il peso del tuo voto: ★★☆ — cresce validando e contribuendo")
 * plus a short "come funziona" popover. The raw number stays available on the
 * star row title and in the detail line.
 */

export interface ProfileCardProps {
  profile: AsyncSlice<MerltProfile>;
}

function StarRow({ filled }: { filled: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          size={16}
          className={cn(
            i < filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600',
          )}
        />
      ))}
    </span>
  );
}

export function ProfileCard({ profile }: ProfileCardProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  const pill =
    profile.status === 'error' ? <StatusPill tone="error">Non disponibile</StatusPill> : undefined;

  return (
    <HubCard testId="hub-card-profile" icon={Sparkles} title="Il tuo profilo" pill={pill}>
      {profile.status === 'loading' && <p className="text-sm text-slate-400">Caricamento profilo…</p>}

      {profile.status === 'error' && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Dati di authority non disponibili al momento.
        </p>
      )}

      {profile.status === 'success' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-700 dark:text-slate-200">Il peso del tuo voto:</span>
            <span title={`Authority ${profile.data.authorityScore.toFixed(2)}`}>
              <StarRow filled={authorityToStars(profile.data.authorityScore)} />
            </span>
            <div className="relative">
              <button
                type="button"
                aria-label="Come funziona il peso del voto"
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen((v) => !v)}
                className="rounded-full p-0.5 text-slate-400 transition-colors hover:text-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                <HelpCircle size={15} />
              </button>
              {helpOpen && (
                <div
                  role="tooltip"
                  className="absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Il peso del tuo voto misura quanto le tue valutazioni influenzano il sistema.
                  Cresce quando validi proposte e contribuisci con appunti di qualità, e riflette
                  la tua qualifica e il tuo storico.
                </div>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Cresce validando le proposte e contribuendo.
          </p>

          {/* Human-first: the raw authority score is available on the star row's
              hover title (and the help tooltip), never as a bare stat field. */}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Contributi</dt>
              <dd className="font-semibold text-slate-900 dark:text-white">
                {profile.data.totalContributions}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Qualifica</dt>
              <dd className="font-semibold text-slate-900 dark:text-white">
                {profile.data.baselineQual}
              </dd>
            </div>
          </dl>
        </>
      )}
    </HubCard>
  );
}
