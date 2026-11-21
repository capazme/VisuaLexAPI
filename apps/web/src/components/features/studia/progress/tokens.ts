import type { IllustrationName } from '../../../ui/Illustration';
import type { ConteggiStati, Materia, StatoGiorno } from '../../../../types/studia';

/**
 * Direction D, «Registro vivo» (Studia progress spec §6.1): the app's own tokens, light and dark. Ink is the
 * deep end of the primary scale; the goal's mark is the ink too (G9: the red stamp is gone); each subject takes a hue
 * of the category palette.
 */
export const INK_TEXT = 'text-primary-900 dark:text-primary-300';
export const INK_BG = 'bg-primary-900 dark:bg-primary-300';
export const INK_BORDER = 'border-primary-900 dark:border-primary-300';
/** Text on an ink fill. */
export const ON_INK = 'text-white dark:text-slate-950';
// green-700 in light: 600 was 3,2:1 on white for the goal's count (M1).
export const SUCCESS_TEXT = 'text-green-700 dark:text-green-400';
export const MUTED_TEXT = 'text-slate-500 dark:text-slate-400';

/** A tile of the dashboard: the missions, the statistics, a stop of the road. */
// LC23: the prototype's surface (#faf8f4 on the stone page), not white.
// LC112: 8 px, a box that holds things (`CARD_RADIUS`, the consultant's rule).
export const TILE = 'rounded-[8px] border border-slate-200 bg-card dark:border-slate-800 dark:bg-slate-900';
/**
 * A block's heading: the reader's serif, in sentence case. One type language (Gymnasium spec §5.1): headings
 * in EB Garamond, labels in Inter; no small capitals and no double rule.
 */
export const BLOCK_HEADING = 'font-serif text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50';

export const FOCUS_RING = 'focus-visible:outline-none ';

const SUBJECT_TOKEN: Record<Materia, string> = {
  DIRITTO_CIVILE: '--category-civil',
  DIRITTO_PENALE: '--category-penal',
  DIRITTO_AMMINISTRATIVO: '--category-administrative',
  DIRITTO_PROCESSUALE_CIVILE: '--category-compliance',
  DIRITTO_PROCESSUALE_PENALE: '--category-penal-procedure',
};

/** Each subject's engraved emblem (LC35): with its name, what tells the subjects apart (LC37), more than the hue. */
export const SUBJECT_ART: Record<Materia, IllustrationName> = {
  DIRITTO_CIVILE: 'materia-civile',
  DIRITTO_PENALE: 'materia-penale',
  DIRITTO_AMMINISTRATIVO: 'materia-amministrativo',
  DIRITTO_PROCESSUALE_CIVILE: 'materia-proc-civile',
  DIRITTO_PROCESSUALE_PENALE: 'materia-proc-penale',
};

/** The subject's hue as a CSS colour, for an inline style: it follows the theme through the variable. */
export function subjectHue(materia: Materia): string {
  return `hsl(var(${SUBJECT_TOKEN[materia]}))`;
}

/**
 * The three states, their names and their swatches: the bar here and the road's stops (Gymnasium spec §5.2). One
 * ordered scale, stone to ink (LC37, Luca: «Sti colori sgargianti sono un pugno all'occhio»): a card goes from new to
 * consolidated, so its colour goes from light to dark, never orange, blue and green.
 */
export const CARD_STATES: { key: keyof ConteggiStati; label: string; swatch: string }[] = [
  { key: 'nuove', label: 'Nuove', swatch: 'bg-ink-300 dark:bg-ink-700' },
  { key: 'apprendimento', label: 'In apprendimento', swatch: 'bg-ink-500 dark:bg-ink-400' },
  { key: 'consolidate', label: 'Consolidate', swatch: 'bg-ink-900 dark:bg-ink-100' },
];

/** A day's state in words: the boxes are never read by their look alone. */
export const DAY_STATE_LABEL: Record<StatoGiorno | 'futuro' | 'vuoto', string> = {
  fatto: 'obiettivo raggiunto',
  riposo: 'giorno di riposo, la serie regge',
  saltato: 'non fatto',
  oggi: 'oggi, da fare',
  futuro: 'ancora da venire',
  vuoto: 'prima del primo giorno',
};
