import { useIsDesktop } from '../../../../hooks/useIsDesktop';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { ActivityCalendar } from './ActivityCalendar';
import { CardStatesBar } from './CardStatesBar';
import { DueForecast } from './DueForecast';
import { SubjectProgress } from './SubjectProgress';
import { PANEL, PANEL_HEADING, subjectHue } from './tokens';

export interface ProgressPanelsProps {
  data: Progressi;
  materia: Materia | undefined;
  onSelectMateria: (materia: Materia | undefined) => void;
}

/** The calendar spans six months on a computer and twelve weeks on a phone (spec decision 12). */
const DESKTOP_WEEKS = 26;
const PHONE_WEEKS = 12;

/**
 * The panels under «I tuoi progressi» at the foot of «Oggi» (Gymnasium spec §5.1, until G3 gives them a page):
 * the activity calendar across the width, the cards by state and the coming days side by side from `md`,
 * then the subjects. Their headings sit under the section's own.
 */
export function ProgressPanels({ data, materia, onSelectMateria }: ProgressPanelsProps) {
  const desktop = useIsDesktop();
  const hue = materia ? subjectHue(materia) : undefined;
  return (
    <>
      <section aria-labelledby="studia-attivita" className={cn(PANEL, 'space-y-3')}>
        <h4 id="studia-attivita" className={PANEL_HEADING}>
          Attività
        </h4>
        <ActivityCalendar calendario={data.calendario} today={data.oggi.giorno} weeks={desktop ? DESKTOP_WEEKS : PHONE_WEEKS} hue={hue} />
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="studia-stati" className={cn(PANEL, 'space-y-3')}>
          <h4 id="studia-stati" className={PANEL_HEADING}>
            Schede per stato
          </h4>
          <CardStatesBar stati={data.stati} />
        </section>
        <section aria-labelledby="studia-prossimi" className={cn(PANEL, 'space-y-3')}>
          <h4 id="studia-prossimi" className={PANEL_HEADING}>
            Prossimi 14 giorni
          </h4>
          <DueForecast prossimi={data.prossimi} hue={hue} />
        </section>
      </div>
      <section aria-labelledby="studia-materie" className={cn(PANEL, 'space-y-3')}>
        <h4 id="studia-materie" className={PANEL_HEADING}>
          Per materia
        </h4>
        <SubjectProgress materie={data.materie} selected={materia} onSelect={onSelectMateria} />
      </section>
    </>
  );
}

/** The panels' places at their final size while the first read travels (spec §6.2): nothing jumps when it answers. */
export function ProgressPanelsSkeleton({ pulsing }: { pulsing: boolean }) {
  const block = cn('rounded-2xl bg-slate-100 dark:bg-slate-800/60', pulsing && 'motion-safe:animate-pulse');
  return (
    <div aria-hidden className="space-y-4">
      <div className={cn(block, 'h-64')} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className={cn(block, 'h-48')} />
        <div className={cn(block, 'h-48')} />
      </div>
      <div className={cn(block, 'h-80')} />
    </div>
  );
}
