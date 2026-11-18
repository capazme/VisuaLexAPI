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

/** The reading area the margin needs, the brief's «about 1100 px»: the card at the measure (44rem) and the margin. */
const AREA_REM = 44 + SPAN_REM;

/**
 * Where the margin has room, in the one-act card of the Ricerca (`PracticeTable`'s `data-glosses-room`), the only one
 * that grows. `column`: the reading area is wide enough (`AREA_REM`): the notes' column, where it is, may take the
 * glosses. `beside`: besides, the card can widen by the margin up to what holds it (a card already widened by a margin
 * counts as it was). Elsewhere (a window, the index, the grid of acts, a narrow window): none, under the text.
 */
export function marginRoom(root: HTMLElement): { column: boolean; beside: boolean } {
    const room = root.closest<HTMLElement>('[data-glosses-room]');
    const outer = room?.parentElement;
    if (!room || !outer) return { column: false, beside: false };
    const area = contentWidth(outer);
    const span = SPAN_REM * remPx();
    const widened = room.querySelector('[data-glosses-beside]') ? span : 0;
    const column = area >= AREA_REM * remPx() - 0.5;
    return { column, beside: column && area - (room.getBoundingClientRect().width - widened) >= span - 0.5 };
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
    /**
     * The text has things at its margin (a note, a gloss on a passage: `AnnotationMargin`'s `onContentChange`, told in
     * the commit that draws them): its card has the notes' column, and the glosses go there, at once when the first one
     * is published.
     */
    marginContent?: boolean;
}

/** The text's box (its first line's left edge is what the eye follows). */
const textOf = (root: HTMLElement) => root.querySelector<HTMLElement>('.vlx-art');

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
export function useGlossMargin({ open, rootRef, columnShown, marginContent = false }: Options) {
    const [host] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')));
    const [room, setRoom] = useState({ column: false, beside: false });
    const [shown, setShown] = useState(false);
    const [textWidth, setTextWidth] = useState<number | null>(null);
    const [besideSlot, setBesideSlot] = useState<HTMLElement | null>(null);
    const [columnSlot, setColumnSlot] = useState<HTMLElement | null>(null);
    const [belowSlot, setBelowSlot] = useState<HTMLElement | null>(null);
    const placement: GlossPlacement = columnShown || marginContent ? (room.column ? 'column' : 'below') : room.beside ? 'beside' : 'below';

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        const check = () => {
            recordBeside.current();
            const next = marginRoom(root);
            setRoom((was) => (was.column === next.column && was.beside === next.beside ? was : next));
        };
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
        if (!host || !slot || host.parentElement === slot) return;
        // A node moved takes the focus out of the page: what had it in the margin takes it again (the margin opened in
        // the notes' column is focused under the text a commit before its slot is there).
        const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
        slot.appendChild(host);
        focused?.focus({ preventScroll: true });
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

    // The way last animated: a new place for the margin (the window resized) does not start it again.
    const way = useRef<boolean | null>(null);

    // Where the card and the text are while the margin is beside: the place a move to the column starts from.
    // Taken as the margin goes beside and again as the frame is resized (`room`'s observer): not at every render.
    const besideAt = useRef<{ card: number; text: number } | null>(null);
    const recordBeside = useRef(() => {});
    useLayoutEffect(() => {
        recordBeside.current = () => {
            const root = rootRef.current;
            const text = root && textOf(root);
            const room = root?.closest<HTMLElement>('[data-glosses-room]');
            if (shown && placement === 'beside' && text && room) {
                besideAt.current = { card: room.getBoundingClientRect().width, text: text.getBoundingClientRect().left };
            }
        };
        recordBeside.current();
    }, [shown, placement, textWidth, rootRef]);

    // The first gloss on a passage (or a note) published with the margin beside: the article takes the layout with the
    // notes' column, and the glosses go into it. The card widens to the frame on the island's opening, and the text is
    // held where it was until the column stands (it is drawn a few frames later), then glides to its place: it never
    // jumps. The glosses come in again where they land.
    const moves = useRef<{ frame: number; anims: Animation[] }>({ frame: 0, anims: [] });
    const lastPlacement = useRef(placement);
    useLayoutEffect(() => {
        const was = lastPlacement.current;
        lastPlacement.current = placement;
        const root = rootRef.current;
        const from = besideAt.current;
        if (!shown || was !== 'beside' || placement !== 'column' || !root || !from) return;
        way.current = null;
        const room = root.closest<HTMLElement>('[data-glosses-room]');
        const column = root.firstElementChild instanceof HTMLElement ? root.firstElementChild : null;
        if (!room || !column || typeof room.animate !== 'function' || reduced()) return;
        cancelAnimationFrame(moves.current.frame);
        moves.current.anims.forEach((a) => a.cancel());
        const anims: Animation[] = [room.animate([{ maxWidth: px(from.card) }, { maxWidth: px(room.getBoundingClientRect().width) }], { ...ISLAND_OPEN, fill: 'backwards' })];
        moves.current = { frame: 0, anims };
        // The text held: measured without the hold, then moved back to where it was. Again before every paint in which its
        // frame changed size (a `ResizeObserver` is told after layout, before paint) and at every frame, until it stands.
        const place = () => {
            const text = textOf(root);
            column.style.transform = '';
            const x = text ? text.getBoundingClientRect().left : from.text;
            const dx = from.text - x;
            column.style.transform = Math.abs(dx) >= 0.5 ? `translateX(${px(dx)})` : '';
            return { x, dx };
        };
        const frame = textOf(root)?.parentElement;
        const observer = typeof ResizeObserver === 'undefined' || !frame ? null : new ResizeObserver(() => { place(); });
        if (frame) observer?.observe(frame);
        let still = 0;
        let frames = 0;
        let last = Number.NaN;
        const hold = () => {
            const { x, dx } = place();
            still = Math.abs(x - last) < 0.5 && root.querySelector('.vlx-glossed') ? still + 1 : 0;
            last = x;
            frames += 1;
            if (still < 3 && frames < 40) {
                moves.current.frame = requestAnimationFrame(hold);
                return;
            }
            observer?.disconnect();
            column.style.transform = '';
            if (Math.abs(dx) >= 0.5) anims.push(column.animate([{ transform: `translateX(${px(dx)})` }, { transform: 'none' }], ISLAND_OPEN));
        };
        hold();
    }, [placement, shown, rootRef]);
    useLayoutEffect(() => () => {
        cancelAnimationFrame(moves.current.frame);
        moves.current.anims.forEach((a) => a.cancel());
    }, []);

    const running = useRef<Animation[]>([]);
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
        // Closing: the card goes to the width its CSS gives it once the margin is gone, measured now (another article's
        // margin, or the notes' column, may keep it wide), not to the width it had when it opened.
        const closedWidth = () => {
            if (!room) return null;
            root.removeAttribute('data-glosses-beside');
            const width = room.getBoundingClientRect().width;
            root.setAttribute('data-glosses-beside', '');
            return width;
        };

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
            const to = closedWidth();
            const at = room?.getBoundingClientRect().width;
            if (room && to !== null && at !== undefined && Math.abs(to - at) >= 0.5) {
                ran.push(room.animate([from?.room ?? { maxWidth: px(at) }, { maxWidth: px(to) }], timing));
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
