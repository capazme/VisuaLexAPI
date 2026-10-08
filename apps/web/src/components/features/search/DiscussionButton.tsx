import type { Ref } from 'react';
import { MessageCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface DiscussionButtonProps {
    isOpen: boolean;
    onToggle: () => void;
    /** What is discussed, in the tooltip and the accessible name (e.g. «Discussioni sull’articolo»). */
    name: string;
    buttonRef?: Ref<HTMLButtonElement | null>;
    /** Set when the reader may not discuss (a past text): the button is off, with this as the reason. */
    lockedReason?: string;
}

/**
 * The discussion button of the reading toolbar, shared by the article's (`ReadingToolbar`) and the
 * decision's (`DecisionReadingToolbar`): one look, one behaviour, a 44px target on touch screens.
 */
export function DiscussionButton({ isOpen, onToggle, name, buttonRef, lockedReason }: DiscussionButtonProps) {
    return (
        <button
            ref={buttonRef}
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            aria-label={name}
            className={cn(
                'inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2.5 md:min-h-0 md:min-w-0 md:p-1.5 rounded-md transition-colors relative',
                isOpen
                    ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500',
            )}
            title={lockedReason ? `${name} — ${lockedReason}` : name}
            disabled={Boolean(lockedReason)}
        >
            <MessageCircle size={16} aria-hidden />
        </button>
    );
}
