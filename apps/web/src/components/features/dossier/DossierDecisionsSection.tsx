import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { DossierItem } from '../../../types';
import { decisionPath, identityOf } from '../../../utils/decisionLinks';
import { decisionCitationOf } from './dossierUtils';
import type { SentenzaItem } from './dossierLayout';

interface Props {
  decisions: SentenzaItem[];
  onRemove: (item: DossierItem) => void;
}

/**
 * «Giurisprudenza», after the acts: one row per decision, in stored order, its citation linking
 * to the decision's page. The minimal list the owner chose for Sentenze PR C (4 October 2026);
 * the dossier-by-act round's PR 3 gives each row the star and the reader in place. The citation
 * is recomputed from the stored identity, never the stored copy (source convention, Q9).
 */
export function DossierDecisionsSection({ decisions, onRemove }: Props) {
  if (decisions.length === 0) return null;
  return (
    <section
      aria-labelledby="dossier-decisions-heading"
      className="rounded-xl border border-slate-200 bg-white p-3 md:p-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <h3 id="dossier-decisions-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Giurisprudenza ({decisions.length})
      </h3>
      <ul className="space-y-1">
        {decisions.map((item) => {
          const citation = decisionCitationOf(item.data);
          return (
            <li key={item.id} className="group flex items-center gap-2">
              <Link
                to={decisionPath(identityOf(item.data))}
                className="flex min-h-[44px] min-w-0 flex-1 items-center rounded text-sm text-primary-600 hover:underline md:min-h-0 dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span className="truncate">{citation}</span>
              </Link>
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={`Rimuovi ${citation} dal dossier`}
                className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:text-red-500 md:min-h-0 md:min-w-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <Trash2 size={15} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
