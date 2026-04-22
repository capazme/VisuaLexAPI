import type { Annotation } from '../../../types';
import { StickyNote, X } from 'lucide-react';

export interface NotesPanelProps {
    annotations: Annotation[];
    showComposer: boolean;
    noteAnchor: { anchorText: string; startOffset: number; scopedArticleId: string } | null;
    noteText: string;
    onNoteTextChange: (text: string) => void;
    onClearAnchor: () => void;
    onSaveNote: () => void;
    onRemoveAnnotation: (id: string) => void;
}

export function NotesPanel({
    annotations,
    showComposer,
    noteAnchor,
    noteText,
    onNoteTextChange,
    onClearAnchor,
    onSaveNote,
    onRemoveAnnotation,
}: NotesPanelProps) {
    return (
        <div className="hidden md:block mb-4 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/20 rounded-lg p-4 transition-all">
            <h6 className="text-xs font-bold text-amber-700 dark:text-amber-500 uppercase mb-3 flex items-center gap-2">
                <StickyNote size={14} /> Note Personali
            </h6>

            <div className="space-y-3 mb-3">
                {annotations.map(note => (
                    <div key={note.id} className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-sm text-sm relative group border border-amber-100 dark:border-amber-900/20">
                        {note.anchorText && (
                            <div className="text-xs italic text-amber-700 dark:text-amber-400 mb-1.5 flex items-start gap-1.5 pr-6">
                                <StickyNote size={11} className="mt-0.5 shrink-0" />
                                <span className="line-clamp-2">&ldquo;{note.anchorText}&rdquo;</span>
                            </div>
                        )}
                        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{note.text}</p>
                        <div className="text-xs text-slate-400 mt-2">{new Date(note.createdAt).toLocaleString()}</div>
                        <button
                            onClick={() => onRemoveAnnotation(note.id)}
                            className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all opacity-0 group-hover:opacity-100"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>

            {showComposer && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    {noteAnchor && (
                        <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-amber-100/70 dark:bg-amber-900/30 rounded-md text-xs border border-amber-300/60 dark:border-amber-800/40">
                            <StickyNote size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                            <span className="italic flex-1 truncate text-amber-800 dark:text-amber-300">
                                Ancorata a: &ldquo;{noteAnchor.anchorText}&rdquo;
                            </span>
                            <button
                                onClick={onClearAnchor}
                                className="p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800/50 rounded text-amber-700 dark:text-amber-400 transition-colors"
                                title="Rimuovi ancoraggio"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <textarea
                            value={noteText}
                            onChange={e => onNoteTextChange(e.target.value)}
                            placeholder={noteAnchor ? `Scrivi una nota su "${noteAnchor.anchorText.slice(0, 30)}${noteAnchor.anchorText.length > 30 ? '…' : ''}"` : 'Scrivi una nota...'}
                            className="flex-1 text-sm rounded-lg border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 min-h-[60px]"
                        />
                        <button
                            onClick={onSaveNote}
                            className="self-end bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            Salva
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
