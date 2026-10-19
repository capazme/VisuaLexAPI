import type { Progressi } from '../../../../types/studia';
import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';
import { TILE } from './tokens';

/**
 * The end of a lesson (Studia progress spec §6.4, Gymnasium spec §5.4): today's goal and the streak as they now
 * stand, from the dashboard's own read, which the session's end makes. Nothing is drawn until it answers, and
 * nothing if it fails: the session's own sentence says what was done.
 */
export function SessionEndProgress({ data }: { data: Progressi | null }) {
  if (!data) return null;
  const { oggi, serie } = data;
  return (
    <div className={`${TILE} flex flex-wrap items-center justify-center gap-x-8 gap-y-4 p-5`}>
      <GoalRing ripassi={oggi.ripassi} obiettivo={oggi.obiettivo} raggiunto={oggi.raggiunto} />
      <StreakBadge attuale={serie.attuale} record={serie.record} ultimiGiorni={serie.ultimiGiorni} />
    </div>
  );
}
