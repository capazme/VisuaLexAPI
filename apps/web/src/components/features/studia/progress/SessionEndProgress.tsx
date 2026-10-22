import type { Progressi } from '../../../../types/studia';
import { GoalRing } from './GoalRing';
import { WeekRow } from './StatsBand';
import { StreakBadge } from './StreakBadge';

/**
 * The end of a lesson (Studia progress spec §6.4, Gymnasium spec §5.4): today's goal, the streak and the week as they
 * now stand, from the dashboard's own read, which the session's end makes — inside the end's one card (G8). Nothing is
 * drawn until it answers, and nothing if it fails: the session's own sentence says what was done.
 */
export function SessionEndProgress({ data }: { data: Progressi | null }) {
  if (!data) return null;
  const { oggi, serie } = data;
  return (
    <div className="grid w-full justify-items-center gap-5">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
        <GoalRing giorno={oggi.giorno} ripassi={oggi.ripassi} obiettivo={oggi.obiettivo} raggiunto={oggi.raggiunto} />
        <StreakBadge attuale={serie.attuale} record={serie.record} ultimiGiorni={serie.ultimiGiorni} />
      </div>
      <WeekRow data={data} aside={false} />
    </div>
  );
}
