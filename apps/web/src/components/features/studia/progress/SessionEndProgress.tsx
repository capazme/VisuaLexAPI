import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';
import { useProgress } from './useProgress';

/**
 * The end of a review session (Studia progress spec §6.4): today's goal and the streak as they now stand,
 * from the dashboard's own read. Nothing is drawn until it answers, and nothing if it fails: the session's
 * own sentence says what was done.
 */
export function SessionEndProgress() {
  const progress = useProgress(undefined);
  if (progress.status !== 'ready') return null;
  const { oggi, serie } = progress.data;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <GoalRing ripassi={oggi.ripassi} obiettivo={oggi.obiettivo} raggiunto={oggi.raggiunto} />
      <StreakBadge attuale={serie.attuale} record={serie.record} ultimiGiorni={serie.ultimiGiorni} />
    </div>
  );
}
