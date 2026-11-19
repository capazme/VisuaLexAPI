import { MessageCircle } from 'lucide-react';
import { TOOL_PRESSED } from './toolbarToggle';
import { IconButton } from '../../ui/IconButton';
import { cn } from '../../../lib/utils';

export interface DiscussionButtonProps {
    isOpen: boolean;
    onToggle: () => void;
    /** What is discussed, in the tooltip and the accessible name (e.g. «Glosse sull’articolo»). */
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
        <IconButton
            size="sm"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            aria-label={name}
            className={cn('relative', isOpen && TOOL_PRESSED)}
            title={lockedReason ? `${name}: ${lockedReason}` : name}
            disabled={Boolean(lockedReason)}
            icon={<MessageCircle aria-hidden />}
        />
    );
}
