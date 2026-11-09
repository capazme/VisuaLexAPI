import { useCallback, useRef, useState, type RefObject } from 'react';
import { LocateFixed, Trash2 } from 'lucide-react';
import type { Highlight, Proposal } from '../../../types';
import { isProposal, type BlockAnnotations } from '../../../utils/articleAnnotations';
import { getHighlightSwatch } from '../../../utils/highlightColors';
import { revealAnnotation, type AnnotationTarget } from '../../../utils/revealAnnotation';
import { AttributionChip } from '../bulletin/AttributionChip';
import { Sheet } from '../../ui/Sheet';
import { ProposalCard } from './ProposalCard';
import { GlossCard } from './GlossCard';
import { NoteMarginCard, ThreadCard } from './MarginCards';
import { GLOSS_WORDS } from '../../../constants/glossWords';

export interface BlockAnnotationsSheetProps {
    /** The element holding the article text (ArticleBody's contentRef). */
    containerRef: RefObject<HTMLElement | null>;
    /** The block whose sign opened the sheet (its `data-block`). */
    blockIndex: number;
    /** `describeBlock`: the printed enumerator, or the block's opening words. */
    blockLabel: string;
    group: BlockAnnotations;
    onClose: () => void;
    onUpdateNote: (id: string, text: string) => void;
    onRemoveNote: (id: string) => void;
    onRemoveHighlight: (id: string) => void;
    /** Open this discussion in the panel (the sheet closes first). */
    onOpenThread?: (threadId: string) => void;
    /** Fingerprint of the text on screen, to tell a discussion opened on another text. */
    textHash?: string | null;
    /** What the user does with a passage an application proposed (D7b); only a dossier entry's reader has proposals. */
    proposalActions?: ProposalActions;
    /** The entry's glosses (D8), of which the block's (`group.glosses`) are listed first as `GlossCard`s. */
    glosses?: readonly Proposal[];
    /** A gloss's card hovered or focused: the reader shows its words (`useGlossPassage`). */
    shownGlossId?: string | null;
    onShowGlossPassage?: (id: string, show: boolean) => void;
}

/** A proposed passage's actions, by its id (`ProposalCard`). */
export interface ProposalActions {
    validate: (id: string, validated: boolean) => void;
    flag: (id: string, flagged: boolean) => void;
    comment: (id: string, text: string) => void;
    editNote: (id: string, text: string) => void;
    /** The caller's notice offers «Annulla». */
    remove: (id: string) => void;
    /** «Sposta l'evidenziazione»: the reader asks for the passage's new words (absent where it cannot). */
    move?: (id: string) => void;
}

/**
 * Everything one block of a text holds, from its sign (A4 §6; round B's popover before it): a sheet from the bottom
 * where the column beside the text is not shown (a phone, a narrow reader), where the block has nothing in the column
 * (its highlights alone, an application's proposed passages), and with Shift on a computer (the keyboard's way to the
 * block's highlights beside its cards). The passages an application proposed come first (D7b, `ProposalCard`), then its
 * glosses (D8), the reader's notes — edited and removed in place —, the highlights — removed — each with «Vai al passo»,
 * and the discussions, opened in their panel. Esc and the X give the focus back to the sign; a note being edited is never
 * dropped without asking.
 */
export function BlockAnnotationsSheet({
    containerRef,
    blockIndex,
    blockLabel,
    group,
    onClose,
    onUpdateNote,
    onRemoveNote,
    onRemoveHighlight,
    onOpenThread,
    textHash,
    proposalActions,
    glosses: entryGlosses,
    shownGlossId = null,
    onShowGlossPassage,
}: BlockAnnotationsSheetProps) {
    // Where focus goes on close: the sign after Esc, the X or "Vai al passo"; nowhere when something else takes it.
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // The sign is SafeHTML markup, replaced on every redraw of the text:
    // always look it up again rather than hold an element.
    const findSign = useCallback(
        () => containerRef.current?.querySelector<HTMLElement>(`.vlx-sign[data-block="${blockIndex}"]`) ?? null,
        [containerRef, blockIndex],
    );

    const close = useCallback((refocus: boolean) => {
        returnFocusRef.current = refocus ? findSign() : null;
        onClose();
    }, [findSign, onClose]);

    // The notes being edited here (the reader's, an application's, D7b), by id: over a changed one, the X, Esc or «Vai al
    // passo» first ask in that card «Scartare la modifica?».
    const [drafts, setDrafts] = useState<Record<string, 'clean' | 'dirty'>>({});
    const reportDraft = useCallback((id: string, state: 'none' | 'clean' | 'dirty') => {
        setDrafts((d) => {
            if (state === 'none') {
                if (!(id in d)) return d;
                const rest = { ...d };
                delete rest[id];
                return rest;
            }
            return d[id] === state ? d : { ...d, [id]: state };
        });
    }, []);
    const [closeAsk, setCloseAsk] = useState<{ id: string; refocus: boolean } | null>(null);
    const requestClose = (refocus: boolean): boolean => {
        const dirty = Object.keys(drafts).find((id) => drafts[id] === 'dirty');
        if (!dirty) return false;
        setCloseAsk({ id: dirty, refocus });
        return true;
    };
    const closeOrAsk = (refocus: boolean) => { if (!requestClose(refocus)) close(refocus); };
    const answerClose = (discarded: boolean) => {
        const ask = closeAsk;
        setCloseAsk(null);
        if (discarded && ask) close(ask.refocus);
    };

    // The block's glosses (D8), as the entry holds them.
    const listedGlosses = proposalActions && entryGlosses
        ? group.glosses.flatMap((g) => entryGlosses.find((e) => e.id === g.id) ?? [])
        : [];
    const total = group.notes.length + group.highlights.length + group.threads.length + listedGlosses.length;
    // Only a reader that can act on them lists proposals apart; none other is ever given one.
    const proposals = proposalActions ? group.highlights.filter(isProposal) : [];
    const highlights = proposalActions ? group.highlights.filter((h) => !isProposal(h)) : group.highlights;
    const remove = (run: () => void) => {
        run();
        // The block's last annotation takes the sign with it; otherwise the focus, on a card just gone, comes back to
        // the sheet's list rather than fall to the page.
        if (total === 1) close(false);
        else listRef.current?.focus();
    };
    const goTo = (target: AnnotationTarget) => {
        if (requestClose(true)) return;
        const sign = findSign();
        const container = containerRef.current;
        close(true);
        if (container) revealAnnotation(container, target, sign?.parentElement);
    };

    return (
        <Sheet
            title={`Annotazioni · ${blockLabel}`}
            onClose={() => closeOrAsk(true)}
            closeOnEscape
            returnFocusRef={returnFocusRef}
            className="sm:mx-auto sm:max-w-lg"
        >
            <div ref={listRef} tabIndex={-1} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none">
                {listedGlosses.length > 0 && proposalActions && (
                    <section className="space-y-2">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">{GLOSS_WORDS.column}</h3>
                        {listedGlosses.map((gloss) => (
                            <GlossCard
                                key={gloss.id}
                                gloss={gloss}
                                actions={proposalActions}
                                active={shownGlossId === gloss.id}
                                onShowPassage={(show) => onShowGlossPassage?.(gloss.id, show)}
                                onRemove={() => remove(() => proposalActions.remove(gloss.id))}
                                onMove={proposalActions.move && (() => {
                                    if (requestClose(false)) return;
                                    returnFocusRef.current = null;
                                    onClose();
                                    proposalActions.move!(gloss.id);
                                })}
                                onDraftState={(state) => reportDraft(gloss.id, state)}
                                closeRequested={closeAsk?.id === gloss.id}
                                onCloseAnswer={answerClose}
                                className="shadow-none"
                            />
                        ))}
                    </section>
                )}
                {proposals.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Proposte dell'IA</h3>
                        {proposalActions && proposals.map((proposal) => (
                            <ProposalCard
                                key={proposal.id}
                                highlight={proposal}
                                onValidate={(validated) => proposalActions.validate(proposal.id, validated)}
                                onFlag={(flagged) => proposalActions.flag(proposal.id, flagged)}
                                onReviewComment={(text) => proposalActions.comment(proposal.id, text)}
                                onEditNote={(text) => proposalActions.editNote(proposal.id, text)}
                                onRemove={() => remove(() => proposalActions.remove(proposal.id))}
                                onMove={proposalActions.move && (() => {
                                    // A changed note asks first («Scartare la modifica?»); the bar takes the focus.
                                    if (requestClose(false)) return;
                                    returnFocusRef.current = null;
                                    onClose();
                                    proposalActions.move!(proposal.id);
                                })}
                                onDraftState={(state) => reportDraft(proposal.id, state)}
                                closeRequested={closeAsk?.id === proposal.id}
                                onCloseAnswer={answerClose}
                            />
                        ))}
                    </section>
                )}
                {group.notes.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Note</h3>
                        {group.notes.map((note) => (
                            <div key={note.id} className="space-y-0.5">
                                <NoteMarginCard
                                    note={note}
                                    onUpdate={onUpdateNote}
                                    onRemove={() => remove(() => onRemoveNote(note.id))}
                                    onDraftState={(state) => reportDraft(note.id, state)}
                                    closeRequested={closeAsk?.id === note.id}
                                    onCloseAnswer={answerClose}
                                    className="shadow-none"
                                />
                                <GoTo onClick={() => goTo({ kind: 'note', id: note.id })} />
                            </div>
                        ))}
                    </section>
                )}
                {highlights.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Evidenziazioni</h3>
                        {highlights.map((highlight) => (
                            <HighlightCard
                                key={highlight.id}
                                highlight={highlight}
                                onGoTo={() => goTo({ kind: 'highlight', id: highlight.id })}
                                onRemove={() => remove(() => onRemoveHighlight(highlight.id))}
                            />
                        ))}
                    </section>
                )}
                {group.threads.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Glosse</h3>
                        {group.threads.map((thread) => (
                            <ThreadCard
                                key={thread.id}
                                thread={thread}
                                currentTextHash={textHash}
                                className="shadow-none"
                                onOpen={() => {
                                    // The sheet closes without giving the focus back to the sign: the panel takes it.
                                    returnFocusRef.current = null;
                                    onClose();
                                    onOpenThread?.(thread.id);
                                }}
                            />
                        ))}
                    </section>
                )}
            </div>
        </Sheet>
    );
}

/** «Vai al passo» under a note's card: the sheet closes and the text shows its words. */
function GoTo({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [@media(pointer:fine)]:min-h-8 dark:text-slate-400 dark:hover:text-primary-400"
        >
            <LocateFixed size={12} aria-hidden /> Vai al passo
        </button>
    );
}

/** A highlight of the block: its colour as a stripe (UI conventions), its text, and what to do with it. */
function HighlightCard({ highlight, onGoTo, onRemove }: { highlight: Highlight; onGoTo: () => void; onRemove: () => void }) {
    return (
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3.5 pr-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: getHighlightSwatch(highlight.color) }} />
            <p className="line-clamp-3 text-slate-800 dark:text-slate-200">&ldquo;{highlight.text}&rdquo;</p>
            {highlight.sourceSuggestionId && (
                <div className="mt-1">
                    <AttributionChip author={highlight.originalAuthor} />
                </div>
            )}
            <div className="mt-1 flex items-center gap-1">
                <button
                    type="button"
                    onClick={onGoTo}
                    className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [@media(pointer:fine)]:min-h-8 dark:text-slate-400 dark:hover:text-primary-400"
                >
                    <LocateFixed size={12} aria-hidden /> Vai al passo
                </button>
                <button
                    type="button"
                    onClick={onRemove}
                    className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded px-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 [@media(pointer:fine)]:min-h-8 dark:text-slate-400 dark:hover:bg-red-900/20"
                >
                    <Trash2 size={12} aria-hidden /> Rimuovi
                </button>
            </div>
        </div>
    );
}
