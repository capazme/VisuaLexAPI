import { FOCUS_RING } from '../../../constants/interactions';

/**
 * Academia's «Assistente», consent first (S7b): the planner's measures — every control 44 px at every width, no text
 * under 12 px — in the «Inchiostro» tokens, light and dark. The hub's cards, its consent block and its row of links
 * draw from here.
 */

/** A card of the hub: a tile on the paper, no shadow, as tall as its row, its one action at its foot. */
export const HUB_TILE = 'flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900';

/** A card's heading: the reader's serif, sentence case. */
export const HUB_HEADING = 'flex items-center gap-2 font-serif text-lg font-medium tracking-tight text-slate-900 dark:text-slate-50';

/** A card's text. */
export const HUB_TEXT = 'text-sm text-slate-700 dark:text-slate-300';

/** A card's quieter line under its text: 13 px, never under 12. */
export const HUB_NOTE = 'text-[13px] text-slate-600 dark:text-slate-400';

/** A card's action, and the consent block's. */
export const HUB_PRIMARY = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 ${FOCUS_RING}`;

/** An action that needs more consent than the user gave: said in its words, disabled, no badge. */
export const HUB_GATED = `inline-flex min-h-[44px] cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 text-sm font-medium text-slate-600 dark:border-slate-600 dark:text-slate-400 ${FOCUS_RING}`;

/** A plain action with words beside a card's text: the example question, the last one to take up. */
export const HUB_QUIET_BUTTON = `w-full min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-800 transition-colors hover:border-primary-300 hover:bg-primary-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 ${FOCUS_RING}`;

/** A link of the row at the page's foot («Consenso e privacy», «Il tuo profilo»): words, 44 px tall. */
export const HUB_LINK = `inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-medium text-primary-700 underline-offset-4 hover:underline dark:text-primary-300 ${FOCUS_RING}`;

/**
 * Where the consent stands for the cards' actions: read (`known`), being read, not readable (`unread`: the read
 * failed), or not to be given here (`off`: a server without MERL-T or without its notice).
 */
export type ConsentGate = 'known' | 'loading' | 'unread' | 'off';

/** What a card's action says when it needs more consent than the user gave; nothing while the consent is read. */
export function gateLabel(gate: ConsentGate, needed: 'base' | 'completo'): string | null {
  if (gate === 'loading') return null;
  if (gate === 'unread') return 'Consenso non letto';
  if (gate === 'off') return 'Non attivo su questo server';
  return `Serve il consenso ${needed}`;
}
