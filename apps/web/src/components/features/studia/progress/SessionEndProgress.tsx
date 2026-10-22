import type { Progressi } from '../../../../types/studia';
import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';

/**
 * The end of a lesson (Studia progress spec §6.4, Gymnasium spec §5.4): today's goal and the streak as they now stand —
 * the streak with its strip of the last seven days, which is the week: no second row of it (G8) —, from the dashboard's
 * own read, which the session's end makes, inside the end's one card. Nothing is drawn until it answers, and nothing if
 * it fails: the session's own sentence says what was done.
 */
export function SessionEndProgress({ data }: { data: Progressi | null }) {
  if (!data) return null;
  const { oggi, serie } = data;
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-x-8 gap-y-4">
      <GoalRing giorno={oggi.giorno} ripassi={oggi.ripassi} obiettivo={oggi.obiettivo} raggiunto={oggi.raggiunto} />
      <StreakBadge attuale={serie.attuale} record={serie.record} ultimiGiorni={serie.ultimiGiorni} />
    </div>
  );
}
