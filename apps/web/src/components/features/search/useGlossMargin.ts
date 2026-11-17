import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../../lib/motion';

/** The margin beside the text (LC74): about 340 px, 1.5rem from it. */
export const GLOSS_MARGIN_REM = 21.25;
const SPAN_REM = GLOSS_MARGIN_REM + 1.5;
/** The rows come in one after the other, 30 ms apart, after the card has started to widen; past the eighth together. */
const STAGGER_MS = 30;
const STAGGER_ROWS = 8;
const ROWS_AFTER_MS = 80;

/**
 * Where the article's glosses open. `beside`: the card has room to widen to the right, the text keeps its column.
 * `column`: the notes' column is already beside the text (`AnnotationMargin`), the glosses take its place, so nothing
 * moves. `below`: no room (a narrow window, a phone, a window beside the table), under the text, in the card.
 */
export type GlossPlacement = 'beside' | 'column' | 'below';

const remPx = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const px = (n: number) => `${Math.round(n * 10) / 10}px`;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function contentWidth(el: HTMLElement) {
    const style = getComputedStyle(el);
    return el.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
}

/**
 * Whether the card can widen by the margin: only the one-act card of the Ricerca grows (`PracticeTable`'s
 * `data-glosses-room`), up to what holds it; a card already widened by a margin counts as it was.
 */
export function roomBeside(root: HTMLElement): boolean {
    const room = root.closest<HTMLElement>('[data-glosses-room]');
    const outer = room?.parentElement;
    if (!room || !outer) return false;
    const span = SPAN_REM * remPx();
    const widened = room.querySelector('[data-glosses-beside]') ? span : 0;
    return contentWidth(outer) - (room.getBoundingClientRect().width - widened) >= span - 0.5;
}

/** Where an element is now, its own animations included. */
function now(el: HTMLElement, keys: string[]): Keyframe {
    const style = getComputedStyle(el) as unknown as Record<string, string>;
    return Object.fromEntries(keys.map((key) => [key, style[key]]));
}

interface Options {
    /** The reader asked for the glosses (the button is pressed). */
    open: boolean;
    /** The article's root: the beside layout is its, the card around it widens. */
    rootRef: RefObject<HTMLElement | null>;
    /** `AnnotationMargin`'s column is shown beside the text. */
    columnShown: boolean;
}

/**
 * The glosses' margin (LC74): where it goes, and its motion, with the search island's times and technique (Web
 * Animations, `ISLAND_OPEN` / `ISLAND_CLOSE`). Opening, beside: the card widens to the right while the margin is
 * uncovered at its edge (the same time and curve, so the edge carries it), the text never moving; then the rows come
 * in, faded and 8 px low, one after the other. Closing: the rows fade, the card narrows back. Under reduced motion, the
 * rows fade, nothing moves. Turned while running, each way goes on from where it is.
 *
 * The margin is one component kept in a node of its own (`host`), moved into the slot of its place: its glosses, its
 * draft and its count stay as the place changes. It is drawn (`shown`) until the closing ends.
 */
export function useGlossMargin({ open, rootRef, columnShown }: Options) {
    const [host] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')));
    const [roomy, setRoomy] = useState(false);
    const [shown, setShown] = useState(false);
    const [textWidth, setTextWidth] = useState<number | null>(null);
    const [besideSlot, setBesideSlot] = useState<HTMLElement | null>(null);
    const [columnSlot, setColumnSlot] = useState<HTMLElement | null>(null);
    const [belowSlot, setBelowSlot] = useState<HTMLElement | null>(null);
    const placement: GlossPlacement = columnShown ? 'column' : roomy ? 'beside' : 'below';

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        const check = () => setRoomy(roomBeside(root));
        check();
        const outer = root.closest('[data-glosses-room]')?.parentElement;
        if (!outer || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(check);
        observer.observe(outer);
        return () => observer.disconnect();
    }, [rootRef]);

    // The margin goes where it is drawn; closed, under the text, empty.
    const slot = shown ? { beside: besideSlot, column: columnSlot, below: belowSlot }[placement] : belowSlot;
    useLayoutEffect(() => {
        if (host && slot && host.parentElement !== slot) slot.appendChild(host);
    }, [host, slot]);

    // Asked for: the text's width is taken before the card widens, for the text to keep it, and the card's.
    const cardBefore = useRef<number | null>(null);
    useLayoutEffect(() => {
        if (!open || shown) return;
        const root = rootRef.current;
        const room = root?.closest<HTMLElement>('[data-glosses-room]');
        cardBefore.current = room ? room.getBoundingClientRect().width : null;
        if (root && room && placement === 'beside') {
            const width = root.getBoundingClientRect().width;
            setTextWidth(width);
            // Every article of a card widened keeps its text where it was (`index.css`).
            if (!room.querySelector('[data-glosses-beside]')) room.style.setProperty('--glosses-text-width', px(width));
        }
        setShown(true);
    }, [open, shown, placement, rootRef]);

    const running = useRef<Animation[]>([]);
    // The way last animated: a new place for the margin (the window resized) does not start it again.
    const way = useRef<boolean | null>(null);
    useLayoutEffect(() => {
        if (!shown) {
            // Closed: the card's and the margin's own CSS again.
            running.current.forEach((a) => a.cancel());
            running.current = [];
            way.current = null;
            return;
        }
        const root = rootRef.current;
        // Each way starts once the margin is in its place.
        if (!root || !host || !slot || host.parentElement !== slot || way.current === open) return;
        way.current = open;
        const still = reduced();
        // Under the text: the page brings it into view, under the article's bar pinned over the text.
        if (open && placement === 'below' && belowSlot) {
            const bar = root.querySelector<HTMLElement>('[data-pinned-head]');
            const pinned = bar ? bar.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(bar).top) || 0) : 0;
            belowSlot.style.scrollMarginTop = px(pinned + 16);
            belowSlot.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
        }
        if (typeof host.animate !== 'function') {
            if (!open) setShown(false);
            return;
        }
        const beside = placement === 'beside' && !still;
        const room = beside ? root.closest<HTMLElement>('[data-glosses-room]') : null;
        const besideEl = beside ? besideSlot : null;
        const rows = [...host.querySelectorAll<HTMLElement>('[data-gloss-row]')];
        const span = SPAN_REM * remPx();
        const shut = `inset(0px ${px(span)} 0px 0px)`;
        const whole = 'inset(0px 0px 0px 0px)';

        // Where each layer is now, then their animations stopped.
        const was = running.current.length > 0;
        const from = was
            ? { room: room ? now(room, ['maxWidth']) : null, beside: besideEl ? now(besideEl, ['clipPath']) : null, rows: rows.map((r) => now(r, ['opacity', 'transform'])) }
            : null;
        running.current.forEach((a) => a.cancel());
        running.current = [];
        // Only the last margin open in a card narrows it back.
        const alone = !!room && room.querySelectorAll('[data-glosses-beside]').length === 1;

        let ran: Animation[];
        if (open) {
            const timing = { ...ISLAND_OPEN, fill: 'backwards' as const };
            ran = [];
            const roomTo = room?.getBoundingClientRect().width;
            const roomFrom = from?.room ?? (cardBefore.current !== null ? { maxWidth: px(cardBefore.current) } : null);
            if (room && roomFrom && roomTo !== undefined && roomFrom.maxWidth !== px(roomTo)) {
                ran.push(room.animate([roomFrom, { maxWidth: px(roomTo) }], timing));
            }
            if (besideEl) ran.push(besideEl.animate([from?.beside ?? { clipPath: shut }, { clipPath: whole }], timing));
            rows.forEach((row, i) => {
                const start = from?.rows[i] ?? { opacity: 0, transform: still ? 'none' : 'translateY(8px)' };
                const delay = was ? 0 : (beside ? ROWS_AFTER_MS : 0) + Math.min(i, STAGGER_ROWS) * STAGGER_MS;
                ran.push(row.animate([start, { opacity: 1, transform: 'none' }], { ...timing, delay }));
            });
        } else {
            const timing = { ...ISLAND_CLOSE, fill: 'forwards' as const };
            ran = rows.map((row, i) => row.animate([from?.rows[i] ?? { opacity: 1 }, { opacity: 0 }], timing));
            if (room && alone && cardBefore.current !== null) {
                ran.push(room.animate([from?.room ?? { maxWidth: px(room.getBoundingClientRect().width) }, { maxWidth: px(cardBefore.current) }], timing));
            }
            if (besideEl) ran.push(besideEl.animate([from?.beside ?? { clipPath: whole }, { clipPath: shut }], timing));
        }
        running.current = ran;
        if (ran.length === 0) {
            if (!open) setShown(false);
            return;
        }
        Promise.all(ran.map((a) => a.finished)).then(() => {
            if (running.current !== ran) return;
            if (open) {
                // Open: nothing holds, the layers are their own CSS again.
                ran.forEach((a) => a.cancel());
                running.current = [];
            } else setShown(false);
        }, () => undefined);
        // Once per way: the margin's own renders move nothing.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the place and the slots are read as each way starts
    }, [shown, open, slot]);

    return {
        /** The node the margin is rendered into (`createPortal`). */
        host,
        placement,
        /** Drawn: from the asking until the closing ends. */
        shown,
        /** Beside: the text's column, as wide as it was closed. */
        textWidth,
        setBesideSlot,
        setColumnSlot,
        setBelowSlot,
    };
}
