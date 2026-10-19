import { Settings2 } from 'lucide-react';
import { Sheet } from '../../../ui/Sheet';
import { cn } from '../../../../lib/utils';
import { StudyPreferences } from '../StudyPreferences';
import { FOCUS_RING } from './tokens';

/** The gear that opens the study settings: «Oggi»'s statistics and the strip over the area's other views. */
export function SettingsGear({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Impostazioni dello studio"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      className={cn(
        'ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
        FOCUS_RING,
      )}
    >
      <Settings2 size={20} aria-hidden />
    </button>
  );
}

/**
 * The study settings in a sheet (Gymnasium spec §4): `StudyPreferences` open, the same content, no disclosure;
 * centred and capped from `md`. Not closed by Esc or the backdrop: a number being typed must not be lost.
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
