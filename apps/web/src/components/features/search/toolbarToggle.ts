import { cn } from '../../../lib/utils';

/** A reading toolbar's toggle while it is on (its panel open, the highlighter's tool on): the one tinted look. */
export const TOOLBAR_TOGGLE_ON = 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400';

/**
 * The look of a reading toolbar's toggle button (discussions, find in text): a 44px target on touch screens, tinted
 * while its panel is open. `extra` adds classes after the base ones.
 */
export function toolbarToggleClass(isOpen: boolean, extra?: string): string {
    return cn(
        'inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2.5 md:min-h-0 md:min-w-0 md:p-1.5 rounded-md transition-colors',
        extra,
        isOpen
            ? TOOLBAR_TOGGLE_ON
            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500',
    );
}
