// apps/web/src/features/merlt/rassegne/DecisionChip.tsx
import { DECISION_PAGE_AVAILABLE, formatDecisionShort, linkableDecisionPath } from '../../../utils/decisionLinks';
import { DecisionLink } from '../../../components/features/decisions/DecisionLink';
import type { RassegnaPronuncia } from './types';

const CHIP = 'px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';

/** A decision cited in a paragraph: a link to its page when the data name it well enough to make one
 *  (`linkableDecisionPath`: a known court, a number, a year), a plain label when they do not. The
 *  label is the source convention's short form with the massime (D2), written from the fields: the
 *  server's `label` is a copy made when the volume was read, which an older volume wrote otherwise. */
export function DecisionChip({ pronuncia }: { pronuncia: RassegnaPronuncia }) {
  const path = DECISION_PAGE_AVAILABLE ? linkableDecisionPath(pronuncia) : null;
  const label = formatDecisionShort(pronuncia, pronuncia.rv);
  return path ? (
    <DecisionLink to={pronuncia} className={`${CHIP} hover:underline`} title={label}>{label}</DecisionLink>
  ) : (
    <span className={CHIP} title={label}>{label}</span>
  );
}
