import { useState, type RefObject } from 'react';
import { useFindInText } from '../../../hooks/useFindInText';
import { FindInTextBar } from './FindInTextBar';

export interface FindInTextBoxProps {
    /** The element whose text is searched: the text root alone, never the popups, panels or other sections around it. */
    rootRef: RefObject<HTMLElement | null>;
    onClose: () => void;
    /** The toolbar's toggle, where focus goes on close. */
    returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * «Cerca nel testo» for one reading surface: the find box over `useFindInText`, mounted only while it is open (closing
 * clears the highlights and forgets the query). Shared by the article's tab and the decision's.
 */
export function FindInTextBox({ rootRef, onClose, returnFocusRef }: FindInTextBoxProps) {
    const [query, setQuery] = useState('');
    const find = useFindInText(rootRef, { open: true, query });
    return <FindInTextBar query={query} onQueryChange={setQuery} find={find} onClose={onClose} returnFocusRef={returnFocusRef} />;
}
