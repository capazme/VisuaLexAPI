import { useState } from 'react';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';
import { SettingsGear, StudySettingsSheet } from './StudySettings';
import { TILE } from './tokens';

export interface StudyStripProps {
  /** The last answer; null before the first one, or when it could not be read. */
  data: Progressi | null;
  /** The first read is travelling: the strip holds its places. */
  loading: boolean;
  /** Called after a setting reached the server: the day's counts may have moved. */
  onSettingsChanged: () => void;
  /** The smaller strip: the streak's count without its line. */
  dense?: boolean;
}

/**
 * The strip over «Le mie schede» and «Da validare» (Gymnasium spec §5.1): the streak and today's goal, so the
 * reward stays in view, and at its end the gear that opens the study settings in a sheet. «Oggi» draws its own
 * statistics instead (`StatsBand`). A read that failed leaves only the gear: the view under it says nothing of
 * progress.
 */
export function StudyStrip({ data, loading, onSettingsChanged, dense = false }: StudyStripProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className={cn(TILE, 'flex min-h-14 items-center gap-x-4 gap-y-2 px-3 md:gap-x-6 md:px-4', dense ? 'py-1' : 'py-2')} aria-busy={loading}>
      {data ? (
        <>
          <StreakBadge compact dense={dense} attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} />
          {/* The ring's «5 di 10» never wraps: the streak's line gives way first. */}
          <div className="shrink-0">
            <GoalRing compact ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />
          </div>
        </>
      ) : (
        loading && (
          <>
            <div aria-hidden className="h-9 w-28 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
            <div aria-hidden className="h-9 w-24 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          </>
        )
      )}
      <SettingsGear open={settingsOpen} onOpen={() => setSettingsOpen(true)} />
      {settingsOpen && <StudySettingsSheet onClose={() => setSettingsOpen(false)} onChanged={onSettingsChanged} />}
    </div>
  );
}
