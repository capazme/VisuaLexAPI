import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import type { Proposal } from '../../../types';
import { cn } from '../../../lib/utils';
import { GLOSS_WORDS } from '../../../constants/glossWords';
import { glossAnchor } from '../../../utils/aiReview';
import { resolveGlosses, type ResolvedAnchor } from '../../../utils/articleAnnotations';
import { rangeFromPlainOffsets } from '../../../utils/selectionOffset';
import { placeGlossCards } from '../../../utils/glossLayout';
import { scrollToMiddle } from '../../../utils/scrollParent';
import type { ProposalActions } from './BlockAnnotationsPopover';
import { GlossCard } from './GlossCard';

export interface GlossMarginHandle {
    /** Focuses a gloss's card, when the column is shown: false otherwise (the caller opens the popover instead). */
    focus: (id: string) => boolean;
}

export interface GlossMarginProps {
    /** The entry's glosses (`useEntryProposals`): those whose words land are drawn here, the others listed apart. */
    glosses: readonly Proposal[];
    /** The projection the anchors count in (an article's text without `\n`, a decision's `decisionProjection`). */
    plain: string;
    actions?: ProposalActions;
    /** The reader's text root: a passage's height is read from its words there. */
    textRootRef: RefObject<HTMLElement | null>;
    /** The HTML on screen: a redraw moves the words, the cards follow. */
    contentKey: string;
    /** The gloss whose words are shown (`useGlossPassage`), and the card that says so. */
    shownId?: string | null;
    onShowPassage?: (id: string, show: boolean) => void;
    /** Whether the column is shown (the container has room): the reader's sign then focuses a card. */
    onWideChange?: (wide: boolean) => void;
    /** The text (`ArticleBody`): always the first child, so adding or removing glosses never mounts it again. */
    children: ReactNode;
    ref?: Ref<GlossMarginHandle>;
}

type Landed = Extract<ResolvedAnchor, { kind: 'gloss' }>;

/**
 * The glosses beside the text (D8), as a word processor's comments: the text keeps the left, a column of cards
 * (`GlossCard`) on the right, each at the height of its passage — the top of the first line of its words in the text
 * root, read from a DOM range, so no element is added to the text (root rule 23) — and pushed down under the one above
 * when they would overlap, in the order of the text (`placeGlossCards`). The column is a container query's
 * (`.vlx-glossed`, index.css): with less room it is not drawn, and the reader's block signs open the cards in their
 * popover instead (`onWideChange`). The cards follow the text as it redraws or reflows, and each other as one grows
 * (an edit, «Cosa non va?»): a `ResizeObserver` on the text root, the container and every card.
 */
export function GlossMargin({
    glosses, plain, actions, textRootRef, contentKey, shownId = null, onShowPassage, onWideChange, children, ref,
}: GlossMarginProps) {
    const active = !!actions && glosses.length > 0;
    const wrapperRef = useRef<HTMLDivElement>(null);
    const columnRef = useRef<HTMLElement>(null);
    const cards = useRef(new Map<string, HTMLElement>());

    // The glosses whose words land, in the order of the text.
    const landed = useMemo<Landed[]>(() => {
        if (!active) return [];
        const byId = new Map(glosses.map((g) => [g.id, g]));
        return (resolveGlosses(plain, glosses.map(glossAnchor)) as Landed[])
            .filter((a) => byId.has(a.gloss.id))
            .sort((x, y) => x.start - y.start || x.end - y.end);
    }, [active, glosses, plain]);
    const byId = useMemo(() => new Map(glosses.map((g) => [g.id, g])), [glosses]);

    const [wide, setWide] = useState(false);
    const [layout, setLayout] = useState<{ tops: Record<string, number>; height: number } | null>(null);

    const measure = useCallback(() => {
        const column = columnRef.current;
        const root = textRootRef.current;
        const isWide = !!column && column.offsetWidth > 0;
        setWide(isWide);
        if (!isWide || !column || !root) return;
        const origin = column.getBoundingClientRect().top;
        const slots = landed.map((a) => {
            const range = rangeFromPlainOffsets(root, a.start, a.end);
            const rect = range?.getClientRects?.()[0] ?? range?.getBoundingClientRect?.();
            return { id: a.gloss.id, want: rect ? rect.top - origin : 0, height: cards.current.get(a.gloss.id)?.offsetHeight ?? 0 };
        });
        const next = placeGlossCards(slots);
        setLayout((prev) => (prev && prev.height === next.height && slots.every((s) => prev.tops[s.id] === next.tops[s.id]) ? prev : next));
    }, [landed, textRootRef]);

    // Measured in a frame, after the browser laid the text out (and not as a state set inside the effect).
    const frame = useRef(0);
    const schedule = useCallback(() => {
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(measure);
    }, [measure]);
    useLayoutEffect(() => {
        if (!active) return;
        schedule();
        return () => cancelAnimationFrame(frame.current);
    }, [active, schedule, contentKey]);

    useEffect(() => {
        if (!active || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(schedule);
        if (wrapperRef.current) observer.observe(wrapperRef.current);
        if (textRootRef.current) observer.observe(textRootRef.current);
        for (const card of cards.current.values()) observer.observe(card);
        return () => observer.disconnect();
    }, [active, schedule, textRootRef, landed, contentKey]);

    const reportWide = useRef(onWideChange);
    useEffect(() => { reportWide.current = onWideChange; });
    const shownWide = active && wide;
    useEffect(() => { reportWide.current?.(shownWide); }, [shownWide]);

    useImperativeHandle(ref, () => ({
        focus: (id) => {
            const card = cards.current.get(id);
            if (!shownWide || !card) return false;
            card.focus({ preventScroll: true });
            scrollToMiddle(card);
            return true;
        },
    }), [shownWide]);

    return (
        <div ref={wrapperRef} className={cn(active && 'vlx-glossed')}>
            <div className="vlx-glossed-grid">
                <div className="min-w-0">{children}</div>
                {active && (
                    <aside
                        ref={columnRef}
                        aria-label={GLOSS_WORDS.column}
                        className="vlx-gloss-column"
                        style={layout ? { height: layout.height } : undefined}
                    >
                        {landed.map(({ gloss: anchor }) => {
                            const gloss = byId.get(anchor.id);
                            if (!gloss || !actions) return null;
                            const top = layout?.tops[anchor.id];
                            return (
                                <GlossCard
                                    key={anchor.id}
                                    ref={(el: HTMLElement | null) => {
                                        if (el) cards.current.set(anchor.id, el);
                                        else cards.current.delete(anchor.id);
                                    }}
                                    gloss={gloss}
                                    actions={actions}
                                    active={shownId === anchor.id}
                                    onShowPassage={(show) => onShowPassage?.(anchor.id, show)}
                                    className={cn('vlx-gloss-card', top === undefined && 'invisible')}
                                    style={top === undefined ? undefined : { transform: `translateY(${top}px)` }}
                                />
                            );
                        })}
                    </aside>
                )}
            </div>
        </div>
    );
}
