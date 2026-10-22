import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { BLOCK_HEADING, MUTED_TEXT, TILE } from '../progress/tokens';
import { MissionRow } from './MissionMark';
import { allMissions, soonLine, type MissionGroup } from './missions';

const GROUPS: { group: MissionGroup; label: string }[] = [
  { group: 'giornaliera', label: 'Giornaliere' },
  { group: 'settimanale', label: 'Settimanali' },
  { group: 'lungo', label: 'A lungo termine' },
];

/** The rows of each group, before the read: the day's without today's three (whether the validator's is listed is the read's). */
const SKELETON_ROWS: Record<MissionGroup, number> = { giornaliera: 3, settimanale: 1, lungo: 1 };

export interface MissionListProps {
  /** The whole day's answer; null before the first one, or when it could not be read. */
  data: Progressi | null;
  /** The first read is travelling. */
  loading: boolean;
}

/** A small label at the end of a mission's line, in place of its count. */
function Tag({ children }: { children: string }) {
  return (
    // The row's hidden state already says it to a screen reader.
    <span aria-hidden className="shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">
      {children}
    </span>
  );
}

/**
 * «Tutte le missioni» (Gymnasium spec §5.1), after the statistics: the day's, the week's and the long run's, without the
 * day's three, which «Le missioni di oggi» shows above (G6: drawn twice, they made the page long). Each as the server
 * decides it (G1c), with its state, its count where it has one, its line and its points. Only the missions that can be
 * done (G8: half the rows were dotted rings «In arrivo»): those announced and not yet recorded are named in one quiet
 * line at the foot, with no ring and nothing to tick. «convalida» is listed when the server lists it (a validator's
 * only). A failed read leaves the list out: the day block says so above.
 */
export function MissionList({ data, loading }: MissionListProps) {
  if (!data) {
    // The list's shape is known before the read: its places at their final size, so nothing below jumps.
    return loading ? (
      <div aria-hidden className="space-y-3">
        <div className="h-7 w-48 rounded bg-slate-100 dark:bg-slate-800/60" />
        <div className={cn(TILE, 'divide-y divide-slate-100 px-4 dark:divide-slate-800 md:px-6')}>
          {GROUPS.map(({ group }) => (
            <div key={group} className="space-y-4 py-4">
              <div className="h-5 w-28 rounded bg-slate-100 dark:bg-slate-800/60" />
              {Array.from({ length: SKELETON_ROWS[group] }, (_, row) => (
                <div key={row} className="h-6 rounded-md bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800/60" />
              ))}
            </div>
          ))}
        </div>
      </div>
    ) : null;
  }
  const missions = allMissions(data).filter((mission) => !mission.main);
  const active = missions.filter((mission) => mission.status !== 'in-arrivo');
  const groups = GROUPS.filter(({ group }) => active.some((mission) => mission.group === group));
  const soon = soonLine(missions);
  return (
    <section aria-labelledby="studia-tutte" className="space-y-3">
      <div className="space-y-1">
        <h3 id="studia-tutte" className={BLOCK_HEADING}>
          Tutte le missioni
        </h3>
        <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Le tre di oggi sono qui sopra.</p>
      </div>
      {groups.length > 0 && (
        <div className={cn(TILE, 'divide-y divide-slate-100 px-4 dark:divide-slate-800 md:px-6')}>
          {groups.map(({ group, label }) => (
            <section key={group} aria-labelledby={`studia-missioni-${group}`} className="py-4">
              <h4 id={`studia-missioni-${group}`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {label}
              </h4>
              <ul aria-labelledby={`studia-missioni-${group}`}>
                {active
                  .filter((mission) => mission.group === group)
                  .map((mission) => (
                    <MissionRow
                      key={mission.id}
                      mission={mission}
                      aside={
                        mission.status === 'vuota' ? (
                          // A `vuota` keeps what it counted: «convalida» with one vote and nothing left to vote on, «1 di 2».
                          <>
                            {mission.progress && <span className="shrink-0 text-sm tabular-nums text-slate-600 dark:text-slate-300">{`${mission.progress.done} di ${mission.progress.of}`}</span>}
                            <Tag>Niente oggi</Tag>
                          </>
                        ) : undefined
                      }
                    />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {soon && <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>{soon}</p>}
    </section>
  );
}
