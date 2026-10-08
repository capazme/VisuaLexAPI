import { MessageCircle } from 'lucide-react';
import { toolbarToggleClass } from './toolbarToggle';

export interface DiscussionButtonProps {
    isOpen: boolean;
    onToggle: () => void;
    /** What is discussed, in the tooltip and the accessible name (e.g. «Discussioni sull’articolo»). */
    name: string;
    /** Set when the reader may not discuss (a past text): the button is off, with this as the reason. */
    lockedReason?: string;
}

/**
 * The discussion button of the reading toolbar, shared by the article's desktop toolbar (`ReadingToolbar`) and the
 * decision's (`DecisionReadingToolbar`); the article's phone row keeps its own, larger button. One look, one behaviour, a 44px target on touch screens.
 */
export function DiscussionButton({ isOpen, onToggle, name, lockedReason }: DiscussionButtonProps) {
    return (
        <button
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            aria-label={name}
            className={toolbarToggleClass(isOpen, 'relative')}
            title={lockedReason ? `${name} — ${lockedReason}` : name}
            disabled={Boolean(lockedReason)}
        >
            <MessageCircle size={16} aria-hidden />
        </button>
    );
}
