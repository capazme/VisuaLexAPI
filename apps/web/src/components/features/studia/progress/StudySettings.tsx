import { useState, type KeyboardEvent, type Ref } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Settings2 } from 'lucide-react';
import { Sheet } from '../../../ui/Sheet';
import { dur, ease } from '../../../../lib/motion';
import { cn } from '../../../../lib/utils';
import { StudyPreferences } from '../StudyPreferences';
import { FOCUS_RING } from './tokens';

interface SettingsGearProps {
  open: boolean;
  /** Opens the settings, or — when it drives a panel in place — opens and closes it. */
  onClick: () => void;
  /** The id of the panel it opens in place (`StudySettingsPanel`); without one it opens a sheet. */
  controls?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** The gear of the study settings: «Oggi»'s statistics (a panel in the card) and the strip over the area's other views (a sheet). */
export function SettingsGear({ open, onClick, controls, ref }: SettingsGearProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Impostazioni dello studio"
      aria-haspopup={controls ? undefined : 'dialog'}
      aria-controls={controls}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        'ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
        open && controls && 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
        FOCUS_RING,
      )}
    >
      <Settings2 size={20} aria-hidden />
    </button>
  );
}

/**
 * The study settings in a sheet (Gymnasium spec §4): `StudyPreferences` open, the same content, no disclosure;
 * centred and capped from `md`. Not closed by Esc or the backdrop: a number being typed must not be lost. The strip
 * over «Le mie schede» and «Da validare» keeps it; «Oggi» opens them in its card (`StudySettingsPanel`).
 */
export function StudySettingsSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet title="Impostazioni dello studio" onClose={onClose} className="md:mx-auto md:max-w-lg">
      <div className="overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <StudyPreferences open onChanged={onChanged} />
      </div>
    </Sheet>
  );
}

export interface StudySettingsPanelProps {
  id: string;
  open: boolean;
  /** Esc inside it: the band closes it and gives the focus back to the gear. */
  onClose: () => void;
  onChanged: () => void;
  /** Each new value opens the community's subjects. */
  communityRequest?: number;
  /** The card is «Oggi»'s right column from `xl`: the switches in one column there, in two from `md` elsewhere. */
  aside?: boolean;
}

/**
 * The study settings in place, inside «I tuoi progressi» under its heading (the owner, 21 October 2026: «si estende il
 * tab»): no window and no veil; the card grows downward, its height in `dur.pop` on `ease.out`, at once under reduced
 * motion. Esc inside it closes it. Mounted closed with the band, so the settings are read before the gear is pressed and
 * the height grows once, to its full size (read on opening, they arrived halfway and the card jumped); closed it is
 * `hidden` and `inert`, once its height has gone.
 */
export function StudySettingsPanel({ id, open, onClose, onChanged, communityRequest = 0, aside = false }: StudySettingsPanelProps) {
  const reduce = useReducedMotion() ?? false;
  // Still drawn while it closes; `hidden` once the height has reached 0.
  const [shown, setShown] = useState(open);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };
  return (
    <motion.div
      id={id}
      role="region"
      aria-label="Impostazioni dello studio"
      tabIndex={-1}
      hidden={!open && !shown}
      inert={!open}
      onKeyDown={onKeyDown}
      initial={false}
      animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
      transition={{ duration: reduce ? 0 : dur.pop, ease: ease.out }}
      onAnimationComplete={() => setShown(open)}
      // The height moves only while it opens or closes; the controls' rings stay inside its edge.
      className="-mx-1 overflow-hidden px-1 focus:outline-none"
    >
      <div className="border-t border-slate-200 pb-1 pt-4 dark:border-slate-800">
        <StudyPreferences open communityRequest={communityRequest} onChanged={onChanged} listClassName={cn('md:grid-cols-2', aside && 'xl:grid-cols-1')} />
      </div>
    </motion.div>
  );
}
