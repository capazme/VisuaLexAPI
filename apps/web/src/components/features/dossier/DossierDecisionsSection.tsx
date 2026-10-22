import { Trash2 } from 'lucide-react';
import type { DossierItem } from '../../../types';
import { identityOf } from '../../../utils/decisionLinks';
import { DecisionLink } from '../decisions/DecisionLink';
import { decisionCitationOf, formatTimestampLong } from './dossierUtils';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../studia/progress/tokens';
import { ROW, ROW_LINE, ROW_REMOVE, SECTION_COUNT, SECTION_HEADING, SECTION_TILE } from './dossierStyles';
import type { SentenzaItem } from './dossierLayout';

interface Props {
  decisions: SentenzaItem[];
  onRemove: (item: DossierItem) => void;
}

/**
 * «Giurisprudenza», after the acts: one row per decision, in stored order, as the planner's rows (S7c) — the citation,
 * a grey line «Aggiunta il …», the removal at the right, 44 px —, its citation a
 * `DecisionLink`: a click opens its preview, whose «Apri la sentenza» goes to the decision's address. The minimal list the owner chose for Sentenze PR C (4 October 2026);
 * the dossier-by-act round's PR 3 gives each row the star and the reader in place. The citation
 * is recomputed from the stored identity, never the stored copy (source convention, Q9).
 */
export function DossierDecisionsSection({ decisions, onRemove }: Props) {
  if (decisions.length === 0) return null;
  return (
    <section aria-labelledby="dossier-decisions-heading" className={cn(SECTION_TILE, 'px-3 pb-1 pt-3 md:px-4')}>
      <h2 id="dossier-decisions-heading" className={SECTION_HEADING}>
        Giurisprudenza <span className={SECTION_COUNT}>({decisions.length})</span>
      </h2>
      <ul className="mt-1">
        {decisions.map((item) => {
          const citation = decisionCitationOf(item.data);
          return (
            <li key={item.id} className={cn(ROW, 'flex items-start gap-1 pl-1')}>
              <div className="min-w-0 flex-1 py-1.5">
                <DecisionLink
                  to={identityOf(item.data)}
                  // The row's title in the link's ink: 15 px, as a task's.
                  className={cn('-my-1 flex min-h-[44px] items-center rounded text-[15px] font-medium leading-snug text-primary-700 hover:underline dark:text-primary-300', FOCUS_RING)}
                >
                  <span className="[overflow-wrap:anywhere]">{citation}</span>
                </DecisionLink>
                <p className={cn(ROW_LINE, 'pb-1')}>Aggiunta il {formatTimestampLong(item.addedAt)}</p>
              </div>
              <button type="button" onClick={() => onRemove(item)} aria-label={`Rimuovi ${citation} dal dossier`} className={ROW_REMOVE}>
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
