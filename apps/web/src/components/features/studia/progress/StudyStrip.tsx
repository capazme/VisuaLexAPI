import { useState, type RefObject } from 'react';
import { Settings2 } from 'lucide-react';
import { Sheet } from '../../../ui/Sheet';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { StudyPreferences } from '../StudyPreferences';
import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';
import { FOCUS_RING, TILE } from './tokens';

export interface StudyStripProps {
  /** The last answer; null before the first one, or when it could not be read. */
  data: Progressi | null;
  /** The first read is travelling: the strip holds its places. */
  loading: boolean;
  /** Called after a setting reached the server: the day's counts may have moved. */
  onSettingsChanged: () => void;
  /** The smaller strip over the area's other views. */
  dense?: boolean;
  /** Where the celebration's confetti start: the goal's ring. */
  ringRef?: RefObject<HTMLDivElement | null>;
  /** The celebration: the streak's count pops. */
  celebrate?: boolean;
}

/**
 * The strip over Gymnasium (spec §5.1): the streak and today's goal, always in view, and at its end the gear
 * that opens the study settings in a sheet. «Oggi» shows it in full; the other views of the area show it
 * smaller (`dense`). A read that failed leaves only the gear: the view under it says nothing of progress.
 */
export function StudyStrip({ data, loading, onSettingsChanged, dense = false, ringRef, celebrate = false }: StudyStripProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className={cn(TILE, 'flex min-h-14 items-center gap-x-4 gap-y-2 px-3 md:gap-x-6 md:px-4', dense ? 'py-1' : 'py-2')} aria-busy={loading}>
      {data ? (
        <>
          <StreakBadge compact dense={dense} attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} pop={celebrate} />
          {/* The ring's «5 di 10» never wraps: the streak's line gives way first. */}
          <div ref={ringRef} className="shrink-0">
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
      <button
        type="button"
        aria-label="Impostazioni dello studio"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen(true)}
        className={cn(
          'ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
          FOCUS_RING,
        )}
      >
        <Settings2 size={20} aria-hidden />
      </button>
      {settingsOpen && (
        <Sheet title="Impostazioni dello studio" onClose={() => setSettingsOpen(false)} className="md:mx-auto md:max-w-lg">
          <div className="overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
            <StudyPreferences open onChanged={onSettingsChanged} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
