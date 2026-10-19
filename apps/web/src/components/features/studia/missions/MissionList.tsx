import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { BLOCK_HEADING, MUTED_TEXT, TILE } from '../progress/tokens';
import { MissionRow } from './MissionMark';
import { allMissions, type MissionGroup } from './missions';

const GROUPS: { group: MissionGroup; label: string }[] = [
  { group: 'giornaliera', label: 'Giornaliere' },
  { group: 'settimanale', label: 'Settimanali' },
  { group: 'lungo', label: 'A lungo termine' },
];

/** The rows of each group, before the read (the validator's mission is not known yet). */
const SKELETON_ROWS: Record<MissionGroup, number> = { giornaliera: 6, settimanale: 1, lungo: 1 };

export interface MissionListProps {
  /** The whole day's answer; null before the first one, or when it could not be read. */
  data: Progressi | null;
  /** The first read is travelling. */
  loading: boolean;
  /** The validation mission is listed for a validator only. */
  validator: boolean;
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
 * «Tutte le missioni» (Gymnasium spec §5.1), third on the page: the day's, the week's and the long run's. Those the
 * web counts show their state; those the server must record first are listed with «In arrivo», never ticked. No
 * points and no level until the server keeps them. A failed read leaves the list out: the missions say so above.
 */
export function MissionList({ data, loading, validator }: MissionListProps) {
  if (!data) {
    // The list's shape is known before the read: its places at their final size, so nothing below jumps.
    return loading ? (
      <div aria-hidden className="space-y-3">
        <div className="h-7 w-48 rounded bg-slate-100 dark:bg-slate-800/60" />
        <div className="h-5 w-72 max-w-full rounded bg-slate-100 dark:bg-slate-800/60" />
        <div className={cn(TILE, 'divide-y divide-slate-100 px-5 dark:divide-slate-800 md:px-6')}>
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
  const missions = allMissions(data, { validator });
  return (
    <section aria-labelledby="studia-tutte" className="space-y-3">
      <div className="space-y-1">
        <h3 id="studia-tutte" className={BLOCK_HEADING}>
          Tutte le missioni
        </h3>
        <p className={cn('text-sm', MUTED_TEXT)}>Le missioni «In arrivo» non si possono ancora compiere.</p>
      </div>
      <div className={cn(TILE, 'divide-y divide-slate-100 px-5 dark:divide-slate-800 md:px-6')}>
        {GROUPS.map(({ group, label }) => (
          <section key={group} aria-labelledby={`studia-missioni-${group}`} className="py-4">
            <h4 id={`studia-missioni-${group}`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {label}
            </h4>
            <ul aria-labelledby={`studia-missioni-${group}`}>
              {missions
                .filter((mission) => mission.group === group)
                .map((mission) => (
                  <MissionRow
                    key={mission.id}
                    // The notes are today's missions' (above): here the title, the state and the count.
                    mission={{ ...mission, note: undefined }}
                    aside={mission.status === 'in-arrivo' ? <Tag>In arrivo</Tag> : mission.status === 'vuota' ? <Tag>Niente oggi</Tag> : undefined}
                  />
                ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
