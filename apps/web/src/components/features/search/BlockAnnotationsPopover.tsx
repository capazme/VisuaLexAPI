import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
    FloatingFocusManager,
    FloatingPortal,
    autoUpdate,
    flip,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
    useRole,
} from '@floating-ui/react';
import { LocateFixed, MessageCircle, MessageSquareText, Trash2, X } from 'lucide-react';
import type { ArticleDiscussionPassageSummary, Highlight, Proposal } from '../../../types';
import { isProposal, type BlockAnnotations } from '../../../utils/articleAnnotations';
import { getHighlightSwatch } from '../../../utils/highlightColors';
import { getTransformOrigin } from '../../../utils/floatingOrigin';
import { signReference } from '../../../utils/blockAnchorRect';
import { revealAnnotation, type AnnotationTarget } from '../../../utils/revealAnnotation';
import { useNoteEditing } from '../../../hooks/useNoteEditing';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { AttributionChip } from '../bulletin/AttributionChip';
import { NoteCard } from './NoteCard';
import { ProposalCard } from './ProposalCard';
import { GlossCard } from './GlossCard';
import { GLOSS_WORDS } from '../../../constants/glossWords';

export interface BlockAnnotationsPopoverProps {
    /** The element holding the article text (ArticleBody's contentRef). */
    containerRef: RefObject<HTMLElement | null>;
    /** The block whose sign opened the popover (its `data-block`). */
    blockIndex: number;
    /** `describeBlock`: the printed enumerator, or the block's opening words. */
    blockLabel: string;
    group: BlockAnnotations;
    /**
     * The HTML currently rendered in the body. An edit or a removal redraws
     * the text, sign included: the popover then measures the new sign.
     */
    contentKey: string;
    onClose: () => void;
    onUpdateNote: (id: string, text: string) => void;
    onRemoveNote: (id: string) => void;
    onRemoveHighlight: (id: string) => void;
    /** Open this discussion in the panel (the popover closes first). */
    onOpenThread?: (threadId: string) => void;
    /** Fingerprint of the text on screen, to tell a discussion opened on another text. */
    textHash?: string | null;
    /** What the user does with a passage an application proposed (D7b); only a dossier entry's reader has proposals. */
    proposalActions?: ProposalActions;
    /**
     * The entry's glosses (D8), of which the block's (`group.glosses`) are listed first as `GlossCard`s, with
     * `proposalActions` — unless they are in the column beside the text (`glossesInMargin`), where the popover only
     * offers the way to them (`onGoToGloss`).
     */
    glosses?: readonly Proposal[];
    glossesInMargin?: boolean;
    /** Focuses the gloss's card in the column: false when it could not (the column gone meanwhile). */
    onGoToGloss?: (id: string) => boolean;
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
 * The annotations of one block of an article, opened from its sign in the
 * margin or at the end of the block (round B). Lists the block's notes —
 * edit and delete in place — and its highlights — remove — each with
 * "Vai al passo". The passages an application proposed come first (D7b,
 * `ProposalCard`): validated, flagged for review, their note edited, removed. Esc and the close button give focus back to the sign; a
 * press outside closes it and leaves focus where the reader pressed.
 */
export function BlockAnnotationsPopover({
    containerRef,
    blockIndex,
    blockLabel,
    group,
    contentKey,
    onClose,
    onUpdateNote,
    onRemoveNote,
    onRemoveHighlight,
    onOpenThread,
    textHash,
    proposalActions,
    glosses: entryGlosses,
    glossesInMargin = false,
    onGoToGloss,
    shownGlossId = null,
    onShowGlossPassage,
}: BlockAnnotationsPopoverProps) {
    const titleId = useId();
    // Where focus goes on close: the sign after Esc, the close button or "Vai
    // al passo"; nowhere after an outside press.
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const editing = useNoteEditing(group.notes, onUpdateNote);

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

    // The application's notes being edited here (D7b), by proposal: while one is, an outside press keeps the popover
    // open; over a changed one, its X, Esc or «Vai al passo» first ask in that card «Scartare la modifica?».
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

    // Placed against the whole block (blockAnchorRect): beside it when the
    // margin has room, else below it, else above it — never over the passage
    // it lists, wherever the container query put the sign.
    const { refs, floatingStyles, context, placement, isPositioned, update } = useFloating({
        open: true,
        onOpenChange: (open, _event, reason) => { if (!open) closeOrAsk(reason === 'escape-key'); },
        placement: 'right-start',
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['bottom-end', 'top-end'] }),
            shift({ padding: 12, crossAxis: true }),
        ],
        whileElementsMounted: autoUpdate,
    });

    // A virtual reference that finds the live sign on every measurement and
    // keeps its last place while the sign has no box; hidden until positioned
    // (gotcha 13).
    useLayoutEffect(() => {
        refs.setPositionReference(signReference(findSign, containerRef.current ?? undefined));
    }, [findSign, refs, containerRef]);

    // A redraw replaced the sign: measure the new one.
    useLayoutEffect(() => { update(); }, [contentKey, update]);

    const dismiss = useDismiss(context, {
        escapeKey: true,
        // A press on this block's own sign is not "outside": its click toggles
        // the popover shut (useArticleTextInteractions); closing here first
        // would let that click open it again.
        outsidePress: (event) => {
            // A note being edited is never lost to a stray click.
            if (Object.keys(drafts).length > 0) return false;
            const sign = findSign();
            return !(sign && event.target instanceof Node && sign.contains(event.target));
        },
    });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    // The block's glosses (D8), as the entry holds them: listed here, or in the column beside the text.
    const blockGlosses = proposalActions && entryGlosses
        ? group.glosses.flatMap((g) => entryGlosses.find((e) => e.id === g.id) ?? [])
        : [];
    // The column could not take the focus (the reader narrowed meanwhile): the cards are listed here after all.
    const [marginFailed, setMarginFailed] = useState(false);
    const inMargin = glossesInMargin && !marginFailed;
    const listedGlosses = inMargin ? [] : blockGlosses;
    const total = group.notes.length + group.highlights.length + group.threads.length + listedGlosses.length;
    // Only a reader that can act on them lists proposals apart; none other is ever given one.
    const proposals = proposalActions ? group.highlights.filter(isProposal) : [];
    const highlights = proposalActions ? group.highlights.filter((h) => !isProposal(h)) : group.highlights;
    const remove = (run: () => void) => {
        run();
        // The block's last annotation takes the sign with it; otherwise the focus, on a card just gone, comes back to
        // the popover itself rather than fall to the page.
        if (total === 1) close(false);
        else refs.floating.current?.focus();
    };
    const goTo = (target: AnnotationTarget) => {
        if (requestClose(true)) return;
        const sign = findSign();
        const container = containerRef.current;
        close(true);
        if (container) revealAnnotation(container, target, sign?.parentElement);
    };

    return (
        <FloatingPortal>
            {/* Modal focus: with a virtual reference there is no element in the
                text for floating-ui to bridge Tab back to, so Tab cycles in
                here and Esc returns to the sign. */}
            {/* Focus goes to the dialog itself (not its first button, which
                would scroll): `initialFocus={-1}` would mean no focus at all. */}
            <FloatingFocusManager
                context={context}
                // eslint-disable-next-line react-hooks/refs -- the ref object is handed over; floating-ui reads it in an effect
                initialFocus={refs.floating}
                returnFocus={returnFocusRef}
            >
                {/* Outer element: floating-ui positioning only. */}
                <div
                    // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
                    ref={refs.setFloating}
                    // Transparent, not `visibility: hidden`, until positioned
                    // (gotcha 13): a hidden element refuses the initial focus,
                    // and a keyboard user would be left on the sign.
                    style={{ ...floatingStyles, opacity: isPositioned ? 1 : 0, pointerEvents: isPositioned ? undefined : 'none' }}
                    {...getFloatingProps()}
                    aria-labelledby={titleId}
                    tabIndex={-1}
                    className={cn(Z_INDEX.citationPreview, 'outline-none')}
                >
                    {/* Inner element: the entry animation (gotcha 10). */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'flex max-h-[60vh] w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border shadow-md',
                            'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                            'animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
                            <h3 id={titleId} className="min-w-0 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                                <span className="uppercase tracking-wide">Annotazioni</span> · {blockLabel}
                            </h3>
                            <button
                                type="button"
                                onClick={() => closeOrAsk(true)}
                                aria-label="Chiudi annotazioni"
                                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:min-w-0 md:p-1 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                            {inMargin && blockGlosses.length > 0 && onGoToGloss && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (requestClose(false)) return;
                                        if (!onGoToGloss(blockGlosses[0].id)) {
                                            // No card took it: the popover stays, its cards drawn in it, the focus on it.
                                            setMarginFailed(true);
                                            refs.floating.current?.focus();
                                            return;
                                        }
                                        returnFocusRef.current = null;
                                        onClose();
                                    }}
                                    // 44 px on a touch screen (a tablet's wide reader too), compact for a fine pointer, as the cards.
                                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded px-1 text-xs font-medium text-primary-700 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [@media(pointer:fine)]:min-h-8 dark:text-primary-300 dark:hover:text-primary-200"
                                >
                                    <MessageSquareText size={13} aria-hidden /> {GLOSS_WORDS.goTo(blockGlosses.length)}
                                </button>
                            )}
                            {listedGlosses.length > 0 && proposalActions && (
                                <section className="space-y-2">
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">{GLOSS_WORDS.column}</h4>
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
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Proposte dell'IA</h4>
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
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Note</h4>
                                    {group.notes.map((note) => (
                                        <NoteCard
                                            key={note.id}
                                            note={note}
                                            isEditing={editing.editingId === note.id}
                                            editingText={editing.editingText}
                                            onStartEdit={() => editing.startEdit(note)}
                                            onChangeEdit={editing.setEditingText}
                                            onCommitEdit={editing.commitEdit}
                                            onCancelEdit={editing.cancelEdit}
                                            onRemove={() => remove(() => onRemoveNote(note.id))}
                                            onGoTo={() => goTo({ kind: 'note', id: note.id })}
                                        />
                                    ))}
                                </section>
                            )}
                            {highlights.length > 0 && (
                                <section className="space-y-2">
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Evidenziazioni</h4>
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
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Glosse</h4>
                                    {group.threads.map((thread) => (
                                        <ThreadCard
                                            key={thread.id}
                                            thread={thread}
                                            currentTextHash={textHash}
                                            onOpen={() => {
                                                // Close popover without returning focus to sign; the panel takes it
                                                returnFocusRef.current = null;
                                                onClose();
                                                onOpenThread?.(thread.id);
                                            }}
                                        />
                                    ))}
                                </section>
                            )}
                        </div>
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
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
                    className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:text-primary-400"
                >
                    <LocateFixed size={12} aria-hidden /> Vai al passo
                </button>
                <button
                    type="button"
                    onClick={onRemove}
                    className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded px-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:bg-red-900/20"
                >
                    <Trash2 size={12} aria-hidden /> Rimuovi
                </button>
            </div>
        </div>
    );
}

/** A passage discussion of the block. */
function ThreadCard({
    thread,
    currentTextHash,
    onOpen,
}: {
    thread: ArticleDiscussionPassageSummary;
    currentTextHash?: string | null;
    onOpen: () => void;
}) {
    const isTextDifferent =
        Boolean(thread.textHash) &&
        Boolean(currentTextHash) &&
        thread.textHash !== currentTextHash;

    const repliesLabel =
        thread.commentCount === 1 ? '1 risposta' : `${thread.commentCount} risposte`;

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <p className="line-clamp-2 text-[11px] italic text-primary-700 dark:text-primary-300">
                &ldquo;{thread.passage.quote}&rdquo;
            </p>
            {thread.title ? (
                <p className="mt-1 font-medium text-slate-800 dark:text-slate-200">
                    {thread.title}
                </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                @{thread.user.username} &middot; {repliesLabel}
            </p>
            {isTextDifferent && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Il testo è cambiato da quando è stata aperta
                </p>
            )}
            <div className="mt-2 flex items-center">
                <button
                    type="button"
                    onClick={onOpen}
                    className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:text-primary-400"
                >
                    <MessageCircle size={12} aria-hidden /> Apri glossa
                </button>
            </div>
        </div>
    );
}
