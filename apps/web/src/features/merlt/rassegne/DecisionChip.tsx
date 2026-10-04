// apps/web/src/features/merlt/rassegne/DecisionChip.tsx
import { Link } from 'react-router-dom';
import { DECISION_PAGE_AVAILABLE, linkableDecisionPath } from '../../../utils/decisionLinks';
import type { RassegnaPronuncia } from './types';

const CHIP = 'px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';

/** A decision cited in a paragraph: a link to its page once that page exists, a plain label until then. */
export function DecisionChip({ pronuncia }: { pronuncia: RassegnaPronuncia }) {
  const path = DECISION_PAGE_AVAILABLE ? linkableDecisionPath(pronuncia) : null;
  return path ? (
    <Link to={path} className={`${CHIP} hover:underline`} title={pronuncia.label}>{pronuncia.label}</Link>
  ) : (
    <span className={CHIP} title={pronuncia.label}>{pronuncia.label}</span>
  );
}
