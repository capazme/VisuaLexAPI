import { useRef, type Ref } from 'react';
import { Search } from 'lucide-react';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { toolbarToggleClass } from './toolbarToggle';

export interface FindInTextButtonProps {
    isOpen: boolean;
    /** `wasPressed`: whether the button was pressed when the pointer went down, before the tab
     *  panel's `mousedown` raised its tab (which can make it pressed by the time of the click). */
    onToggle: (wasPressed: boolean) => void;
    /** Lets the toolbar hand the button to `FindWindow` as the place to return focus to. */
    ref?: Ref<HTMLButtonElement>;
    /** Icon size in px: 16 beside the 16 px icons of a desktop row, 20 in the article's phone row. */
    size?: number;
}

/**
 * The magnifier of the reading toolbar that opens `FindWindow`, shared by the article's toolbars and the decision's
 * (like `DiscussionButton`): one look, one behaviour, a 44px target on touch screens.
 */
export function FindInTextButton({ isOpen, onToggle, ref, size = 16 }: FindInTextButtonProps) {
    const pressedAtDown = useRef<boolean | null>(null);
    return (
        <button
            ref={ref}
            type="button"
            onPointerDown={() => { pressedAtDown.current = isOpen; }}
            onBlur={() => { pressedAtDown.current = null; }}
            onClick={() => {
                // A keyboard click has no pointerdown: the state now is the state seen.
                const wasPressed = pressedAtDown.current ?? isOpen;
                pressedAtDown.current = null;
                onToggle(wasPressed);
            }}
            aria-pressed={isOpen}
            aria-label="Cerca nel testo"
            title="Cerca nel testo"
            className={cn(toolbarToggleClass(isOpen), FOCUS_RING)}
        >
            <Search size={size} aria-hidden />
        </button>
    );
}
