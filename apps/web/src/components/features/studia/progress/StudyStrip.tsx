import { useId, useRef, useState } from 'react';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';
import { SettingsGear, StudySettingsPanel } from './StudySettings';
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
 * The strip over «Da validare» (Gymnasium spec §5.1): the streak and today's goal, so the reward stays in view, and
 * at its end the gear that opens the study settings in place — the strip grows downward with them (U1b,
 * `StudySettingsPanel`, the same panel as «Oggi»'s card), never a window. «Oggi» draws its own statistics instead
 * (`StatsBand`). A read that failed leaves only the gear: the view under it says nothing of progress.
 */
export function StudyStrip({ data, loading, onSettingsChanged, dense = false }: StudyStripProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mounted at the first opening, then kept: «Da validare» reads the study settings only once the gear is pressed
  // (before, the window read them as it opened). Mounted closed, it opens in the next frame, so its height grows.
  const [panelMounted, setPanelMounted] = useState(false);
  const toggleSettings = () => {
    if (panelMounted) {
      setSettingsOpen((v) => !v);
      return;
    }
    setPanelMounted(true);
    requestAnimationFrame(() => setSettingsOpen(true));
  };
  const panelId = useId();
  const gear = useRef<HTMLButtonElement>(null);
  // Esc inside the settings: closed, and the focus back on the gear.
  const close = () => {
    setSettingsOpen(false);
    gear.current?.focus();
  };
  return (
    // The strip's own height counts its padding, as before the panel: closed, the panel has none.
    <div className={cn(TILE, 'flex min-h-14 flex-col justify-center px-3 md:px-4', dense ? 'py-1' : 'py-2')} aria-busy={loading}>
      <div className="flex items-center gap-x-4 md:gap-x-6">
        {data ? (
          <>
            <StreakBadge compact dense={dense} attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} />
            {/* The ring's «5 di 10» never wraps: the streak's line gives way first. */}
            <div className="shrink-0">
              <GoalRing compact giorno={data.oggi.giorno} ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />
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
        <SettingsGear ref={gear} open={settingsOpen} onClick={toggleSettings} controls={panelId} />
      </div>
      {panelMounted && <StudySettingsPanel id={panelId} open={settingsOpen} onClose={close} onChanged={onSettingsChanged} />}
    </div>
  );
}
