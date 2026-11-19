import { cn } from '../../../lib/utils';
import { buttonClassName } from '../../ui/buttonStyles';

/** A reading toolbar's toggle while it is on (its panel open, the highlighter's tool on): the one tinted look. */
export const TOOLBAR_TOGGLE_ON = 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400';

/** A reading tool's button while the tool is on (A4): the toggles' look, over whatever look the bar gives, its hover too. */
export const TOOL_PRESSED = cn(TOOLBAR_TOGGLE_ON, 'hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-900/20 dark:hover:text-primary-400');

/**
 * The look of a reading toolbar's toggle button (discussions, find in text, the decision's key passages): `IconButton`'s
 * small square (44 px on a phone, 32 from md), tinted while its panel is open. `extra` adds classes after the base ones.
 */
export function toolbarToggleClass(isOpen: boolean, extra?: string): string {
    return cn(buttonClassName('quiet', 'sm'), 'min-w-11 px-0 md:min-w-8', extra, isOpen && TOOL_PRESSED);
}
