import { Eye, EyeOff, Download, Highlighter } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ReaderSpace } from './ReaderSpace';

export interface HighlightsActionsPickerProps {
    isOpen: boolean;
    /** Total number of highlights for the current article (used to disable actions when 0). */
    highlightsCount: number;
    /** True when highlights are currently rendered as transparent in the article body. */
    highlightsHidden: boolean;
    onClose: () => void;
    onToggleVisibility: () => void;
    onExportTxt: () => void;
}

/**
 * «Evidenziazioni» under the reading toolbar (LC139, L-73; it was a bar floating over the text): show or hide the
 * `.highlight-mark` spans, and export the highlights to a .txt file. Creation of new highlights stays in the
 * SelectionPopup. Esc and «Chiudi» close it and the focus goes back to the toolbar's button.
 */
export function HighlightsActionsPicker({
    isOpen,
    highlightsCount,
    highlightsHidden,
    onClose,
    onToggleVisibility,
    onExportTxt,
}: HighlightsActionsPickerProps) {
    const empty = highlightsCount === 0;
    return (
        <ReaderSpace
            open={isOpen}
            onClose={onClose}
            title="Evidenziazioni"
            line={empty ? 'Nessuna evidenziazione' : undefined}
            icon={<Highlighter size={16} aria-hidden className="shrink-0" />}
            className="max-w-md"
        >
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={empty} onClick={onToggleVisibility}>
                    {highlightsHidden ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
                    {highlightsHidden ? 'Mostra' : 'Nascondi'}
                </Button>
                <Button variant="secondary" disabled={empty} onClick={() => { onExportTxt(); onClose(); }}>
                    <Download size={16} aria-hidden />
                    Esporta in .txt
                </Button>
            </div>
        </ReaderSpace>
    );
}
