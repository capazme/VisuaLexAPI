import type { Ref } from 'react';
import { Settings2 } from 'lucide-react';
import { Collapsible } from '../../../ui/Collapsible';
import { cn } from '../../../../lib/utils';
import { StudyPreferences } from '../StudyPreferences';
import { FOCUS_RING } from './tokens';

interface SettingsGearProps {
  open: boolean;
  /** Opens and closes the panel. */
  onClick: () => void;
  /** The id of the panel it opens in place (`StudySettingsPanel`). */
  controls: string;
  ref?: Ref<HTMLButtonElement>;
}

/** The gear of the study settings: «Oggi»'s statistics and the strip over «Da validare», each opening the panel in place. */
export function SettingsGear({ open, onClick, controls, ref }: SettingsGearProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Impostazioni dello studio"
      aria-controls={controls}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        'ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
        open && 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
        FOCUS_RING,
      )}
    >
      <Settings2 size={20} aria-hidden />
    </button>
  );
}

export interface StudySettingsPanelProps {
  id: string;
  open: boolean;
  /** Esc inside it: the card or the strip closes it and gives the focus back to its gear. */
  onClose: () => void;
  onChanged: () => void;
  /** Each new value opens the community's subjects. */
  communityRequest?: number;
  /** The card is «Oggi»'s right column from `xl`: the switches in one column there, in two from `md` elsewhere. */
  aside?: boolean;
}

/**
 * The study settings in place, inside «I tuoi progressi» under its heading (the owner, 21 October 2026: «si estende il
 * tab»): `ui/Collapsible`, the app's one way to open a panel in place (U1a) — no window and no veil, the card grows
 * downward, Esc inside closes it. Mounted closed with the band, so the settings are read before the gear is pressed
 * and the height grows once, to its full size (read on opening, they arrived halfway and the card jumped).
 */
export function StudySettingsPanel({ id, open, onClose, onChanged, communityRequest = 0, aside = false }: StudySettingsPanelProps) {
  return (
    <Collapsible
      id={id}
      open={open}
      onClose={onClose}
      role="region"
      aria-label="Impostazioni dello studio"
      tabIndex={-1}
      className="focus:outline-none"
      // 20 px above the line, the card's gap when the panel was a row of its grid; room under the last control in the
      // strip too, whose own padding is small.
      contentClassName="mt-5 border-t border-slate-200 pb-2 pt-4 dark:border-slate-800"
    >
      <StudyPreferences open communityRequest={communityRequest} onChanged={onChanged} listClassName={cn('md:grid-cols-2', aside && 'xl:grid-cols-1')} />
    </Collapsible>
  );
}
