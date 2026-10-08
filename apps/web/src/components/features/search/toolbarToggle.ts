import { cn } from '../../../lib/utils';

/**
 * The look of a reading toolbar's toggle button (discussions, find in text): a 44px target on touch screens, tinted
 * while its panel is open. `extra` adds classes after the base ones.
 */
export function toolbarToggleClass(isOpen: boolean, extra?: string): string {
    return cn(
        'inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2.5 md:min-h-0 md:min-w-0 md:p-1.5 rounded-md transition-colors',
        extra,
        isOpen
            ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500',
    );
}
