import { useIsDesktop } from '../../../../hooks/useIsDesktop';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { Sheet } from '../../../ui/Sheet';
import { ActivityCalendar } from './ActivityCalendar';
import { DueForecast } from './DueForecast';
import { MUTED_TEXT } from './tokens';

export interface MonthSheetProps {
  /** The answer for the subject chosen, or the whole day's. */
  data: Progressi;
  /** The subject the page is narrowed to, by name: the calendar and the coming days are its own. */
  subject?: string;
  /** The subject's hue, when one is chosen. */
  hue?: string;
  onClose: () => void;
}

/** The calendar spans six months on a computer and twelve weeks on a phone (Studia progress spec decision 12). */
const DESKTOP_WEEKS = 26;
const PHONE_WEEKS = 12;

const SECTION_HEADING = 'font-serif text-lg font-medium text-slate-900 dark:text-slate-50';

/**
 * «Il tuo mese» (Gymnasium spec §5.1): the long calendar and the coming fourteen days, out of the page and into a
 * sheet, until G3 gives them `/studia/progressi`. It holds nothing typed, so Esc and the backdrop close it.
 */
export function MonthSheet({ data, subject, hue, onClose }: MonthSheetProps) {
  const desktop = useIsDesktop();
  return (
    <Sheet title="Il tuo mese" onClose={onClose} closeOnEscape closeOnBackdrop className="md:mx-auto md:max-w-2xl">
      <div className="grid gap-6 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        {subject && <p className={cn('-mb-2 text-sm', MUTED_TEXT)}>In {subject}.</p>}
        <section aria-labelledby="studia-attivita" className="grid gap-3">
          <h3 id="studia-attivita" className={SECTION_HEADING}>
            Attività
          </h3>
          <ActivityCalendar calendario={data.calendario} today={data.oggi.giorno} weeks={desktop ? DESKTOP_WEEKS : PHONE_WEEKS} hue={hue} />
        </section>
        <section aria-labelledby="studia-prossimi" className="grid gap-3">
          <h3 id="studia-prossimi" className={SECTION_HEADING}>
            Prossimi 14 giorni
          </h3>
          <DueForecast prossimi={data.prossimi} hue={hue} />
        </section>
      </div>
    </Sheet>
  );
}
