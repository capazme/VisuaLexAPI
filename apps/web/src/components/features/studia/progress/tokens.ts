import type { ConteggiStati, Materia } from '../../../../types/studia';

/**
 * Direction D, «Registro vivo» (Studia progress spec §6.1): the app's own tokens, light and dark. Ink is the
 * deep end of the primary scale; the stamp is the one red; each subject takes a hue of the category palette.
 */
export const INK_TEXT = 'text-primary-900 dark:text-primary-300';
export const INK_BG = 'bg-primary-900 dark:bg-primary-300';
export const INK_BORDER = 'border-primary-900 dark:border-primary-300';
/** Text on an ink fill. */
export const ON_INK = 'text-white dark:text-slate-950';
export const STAMP = 'border-red-700 text-red-700 dark:border-red-400 dark:text-red-400';
export const SUCCESS_TEXT = 'text-green-600 dark:text-green-400';
export const MUTED_TEXT = 'text-slate-500 dark:text-slate-400';

/** A tile of the dashboard: the band and the panels. */
export const TILE = 'rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
/** A panel: a tile with the register's double rule in ink down its left edge. */
export const PANEL = `${TILE} border-l-4 [border-left-style:double] border-l-primary-900 dark:border-l-primary-300 p-4`;
/** A panel's heading, in the reader's serif and small capitals. */
export const PANEL_HEADING = `font-serif text-base tracking-wide [font-variant:small-caps] ${INK_TEXT}`;

export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

const SUBJECT_TOKEN: Record<Materia, string> = {
  DIRITTO_CIVILE: '--category-civil',
  DIRITTO_PENALE: '--category-penal',
  DIRITTO_AMMINISTRATIVO: '--category-administrative',
  DIRITTO_PROCESSUALE_CIVILE: '--category-compliance',
  DIRITTO_PROCESSUALE_PENALE: '--brocardi',
};

/** The subject's hue as a CSS colour, for an inline style: it follows the theme through the variable. */
export function subjectHue(materia: Materia): string {
  return `hsl(var(${SUBJECT_TOKEN[materia]}))`;
}

/** The calendar's scale, 0 (nothing) to 4 (the busiest day), as fill classes. */
export const HEAT_FILL = [
  'fill-slate-100 dark:fill-slate-800',
  'fill-primary-200 dark:fill-primary-900',
  'fill-primary-400 dark:fill-primary-700',
  'fill-primary-600 dark:fill-primary-500',
  'fill-primary-900 dark:fill-primary-300',
] as const;

/** The three states, their names and their swatches: the bar here and the road's stops (Gymnasium spec §5.2). */
export const CARD_STATES: { key: keyof ConteggiStati; label: string; swatch: string }[] = [
  { key: 'nuove', label: 'Nuove', swatch: 'bg-amber-500 dark:bg-amber-400' },
  { key: 'apprendimento', label: 'In apprendimento', swatch: 'bg-primary-500' },
  { key: 'consolidate', label: 'Consolidate', swatch: 'bg-emerald-600 dark:bg-emerald-500' },
];
