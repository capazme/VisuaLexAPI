import { Search } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface FindInTextButtonProps {
    isOpen: boolean;
    onToggle: () => void;
}

/**
 * The magnifier of the reading toolbar that opens `FindInTextBar`, shared by the article's toolbars and the decision's
 * (like `DiscussionButton`): one look, one behaviour, a 44px target on touch screens.
 */
export function FindInTextButton({ isOpen, onToggle }: FindInTextButtonProps) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={isOpen}
            aria-label="Cerca nel testo"
            title="Cerca nel testo"
            className={cn(
                'inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2.5 md:min-h-0 md:min-w-0 md:p-1.5 rounded-md transition-colors',
                isOpen
                    ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500',
            )}
        >
            <Search size={16} aria-hidden />
        </button>
    );
}
