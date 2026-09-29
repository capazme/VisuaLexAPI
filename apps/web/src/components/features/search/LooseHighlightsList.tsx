import { X } from 'lucide-react';
import type { Highlight } from '../../../types';
import { getHighlightSwatch } from '../../../utils/highlightColors';

export interface LooseHighlightsListProps {
    /** `highlightsWithoutSign`: the highlights no block's sign shows. */
    highlights: Highlight[];
    /** The article's own id: its highlights here are the ones whose text moved. */
    articleId: string;
    onRemove: (id: string) => void;
}

/** "Brocardi · Ratio" for `<article>/brocardi/ratio`; "Non più nel testo" for the article's own. */
function originLabel(highlight: Highlight, articleId: string): string {
    if (highlight.articleId === articleId) return 'Non più nel testo';
    const section = highlight.articleId.split('/').pop() ?? '';
    const name = section ? section[0].toUpperCase() + section.slice(1) : '';
    return highlight.articleId.includes('/brocardi/') ? `Brocardi · ${name}` : name;
}

/**
 * What remains of the "Evidenziazioni" box under the article (round B): only
 * the highlights no sign in the text can reach — those made in the Brocardi
 * sections, and those whose text changed — so they can still be removed.
 * Desktop only, as the box was; absent when there are none.
 */
export function LooseHighlightsList({ highlights, articleId, onRemove }: LooseHighlightsListProps) {
    if (highlights.length === 0) return null;
    return (
        <section className="hidden md:block mt-8 mb-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <h6 className="mb-2 font-semibold text-slate-600 dark:text-slate-300">Altre evidenziazioni</h6>
            <ul className="custom-scrollbar max-h-40 space-y-2 overflow-y-auto">
                {highlights.map((h) => (
                    <li key={h.id} className="relative flex items-start gap-2 overflow-hidden rounded border border-slate-100 bg-white py-1.5 pl-3 pr-1.5 dark:border-slate-700 dark:bg-slate-900">
                        <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: getHighlightSwatch(h.color) }} />
                        <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-xs text-slate-700 dark:text-slate-300">&ldquo;{h.text}&rdquo;</p>
                            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{originLabel(h, articleId)}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => onRemove(h.id)}
                            aria-label="Rimuovi evidenziazione"
                            title="Rimuovi evidenziazione"
                            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20"
                        >
                            <X size={14} aria-hidden />
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
