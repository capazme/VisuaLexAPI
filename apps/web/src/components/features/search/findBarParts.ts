import { FOCUS_RING } from '../../../constants/interactions';

export const ICON_BUTTON =
    'inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors ' + FOCUS_RING;

/** «3 di 12», «Nessun risultato», «oltre 1000: affina la ricerca»; empty before a query is searched. */
export function counterText({ count, index, truncated, searched }: { count: number; index: number; truncated: boolean; searched: boolean }): string {
    if (truncated) return 'oltre 1000: affina la ricerca';
    if (!searched) return '';
    if (count === 0) return 'Nessun risultato';
    return `${index + 1} di ${count}`;
}

