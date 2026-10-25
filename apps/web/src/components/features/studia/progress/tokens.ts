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
export const SUCCESS_TEXT = 'text-green-600 dark:text-green-400';
export const MUTED_TEXT = 'text-slate-500 dark:text-slate-400';

/** A tile of the dashboard: the missions, the statistics, a stop of the road. */
export const TILE = 'rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
/**
 * A block's heading: the reader's serif, in sentence case. One type language (Gymnasium spec §5.1): headings
 * in Newsreader, labels in Geist; no small capitals and no double rule.
 */
export const BLOCK_HEADING = 'font-serif text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50';

export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

/** A secondary button: an ink outline, 44 px, a press that gives a little. */
export const SECONDARY_BUTTON = `min-h-[44px] rounded-xl border px-4 text-sm font-semibold transition-[background-color,scale] active:scale-[0.97] ${INK_BORDER} text-primary-900 hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-900/30 ${FOCUS_RING}`;
/** A solid ink button, 44 px: the one action of a block («+ Nuova scheda» in an empty list, «Proponi alla comunità», «Invia»). */
export const INK_BUTTON = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-semibold transition-[background-color,opacity,scale] active:scale-[0.97] disabled:opacity-60 hover:bg-primary-800 dark:hover:bg-primary-200 ${INK_BG} ${ON_INK} ${FOCUS_RING}`;
/** A quiet action under a mission: words in ink, 44 px tall, underlined on hover. */
export const QUIET_BUTTON = `-mx-2 min-h-[44px] justify-self-start rounded-lg px-2 text-left text-sm font-medium text-primary-900 underline-offset-4 hover:underline dark:text-primary-200 ${FOCUS_RING}`;

const SUBJECT_TOKEN: Record<Materia, string> = {
  DIRITTO_CIVILE: '--category-civil',
  DIRITTO_PENALE: '--category-penal',
  DIRITTO_AMMINISTRATIVO: '--category-administrative',
  DIRITTO_PROCESSUALE_CIVILE: '--category-compliance',
  DIRITTO_PROCESSUALE_PENALE: '--category-penal-procedure',
};

/** The subject's hue as a CSS colour, for an inline style: it follows the theme through the variable. */
export function subjectHue(materia: Materia): string {
  return `hsl(var(${SUBJECT_TOKEN[materia]}))`;
}

/** The three states, their names and their swatches: the bar here and the road's stops (Gymnasium spec §5.2). */
export const CARD_STATES: { key: keyof ConteggiStati; label: string; swatch: string }[] = [
  { key: 'nuove', label: 'Nuove', swatch: 'bg-amber-500 dark:bg-amber-400' },
  { key: 'apprendimento', label: 'In apprendimento', swatch: 'bg-primary-500' },
  { key: 'consolidate', label: 'Consolidate', swatch: 'bg-emerald-600 dark:bg-emerald-500' },
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
