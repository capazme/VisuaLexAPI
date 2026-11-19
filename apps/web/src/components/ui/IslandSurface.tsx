import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { usePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../lib/motion';
import { ISLAND_SURFACE } from '../../utils/searchFieldControl';
import { CARD_RADIUS } from './controlStyles';
import { now, useReducedMotionLive } from './islandMotion';

/**
 * The island (LC69, written again from scratch after a frame-by-frame look; Luca, 17 Nov: «mixa tutta una serie di
 * stili diversi»), made the app's one way for what opens over the content (LC85, L-76: the «⋯» menus, the
 * notifications, the confirmations): the surface grows out of what opened it and goes back into it. One technique, Web
 * Animations. Two layers moved by the same rectangle, the same time and the same curve: the shape (the card's ground,
 * edge and shadow) and the content, clipped to the shape, fading in as it grows and out as it shrinks. Any change of
 * mind (closed while it opens, opened while it closes) starts from where the layers are on screen. Nothing to grow
 * from, or reduced motion (read live: a change of the preference counts at the next way): the surface only fades.
 *
 * Kept mounted while it closes by `AnimatePresence` (its `usePresence`), or by its owner through `open` and `onClosed`.
 */

/**
 * Where along each way (as a share of the shape's way, not of the time) the content is seen: from a quarter of the
 * opening; gone by four fifths of the closing. The closing ends in a crossfade: the shape, a few pixels off the source,
 * gives way to the source itself.
 */
const CONTENT_FROM = 0.25;
const CONTENT_UNTIL = 0.8;
const PILL_FROM = 0.99;
const SHAPE_KEYS = ['top', 'right', 'bottom', 'left', 'borderRadius', 'boxShadow', 'opacity'];

type Inset = { top: number; right: number; bottom: number; left: number; radius: number };
/** A rectangle on screen to grow from where no element is (the notifications' pill); round ends unless it says. */
export type SourceRect = { top: number; right: number; bottom: number; left: number; radius?: number };
/** What the surface grows from: an element, a rectangle measured against the surface's own box, or nothing. */
export type IslandSource = HTMLElement | ((box: DOMRect) => SourceRect) | null;

const px = (n: number) => `${Math.round(n * 10) / 10}px`;
const shapeAt = (i: Inset) => ({ top: px(i.top), right: px(i.right), bottom: px(i.bottom), left: px(i.left), borderRadius: px(i.radius) });
const clipAt = (i: Inset) => `inset(${px(i.top)} ${px(i.right)} ${px(i.bottom)} ${px(i.left)} round ${px(i.radius)})`;
/** The same shadow, every colour transparent: interpolates with the card's own (same layers, same lengths). */
const noShadow = (shadow: string) => shadow.replace(/(?:rgba?|oklch|oklab|lab|lch|color)\([^)]*\)/g, 'rgba(0, 0, 0, 0)');

/**
 * The source's rectangle inside the surface's box, or null where there is none to grow from (gone, off screen, or,
 * with `within`, not under it). Outside the box the insets are negative: the shape starts beyond it (a menu under its
 * button, a confirmation in the middle of the screen from a button at the foot).
 */
function insetOf(source: IslandSource, box: DOMRect, within: boolean): Inset | null {
  if (!source) return null;
  if (typeof source === 'function') {
    const r = source(box);
    return { top: r.top - box.top, right: box.right - r.right, bottom: box.bottom - r.bottom, left: r.left - box.left, radius: r.radius ?? (r.bottom - r.top) / 2 };
  }
  if (!source.isConnected) return null;
  const r = source.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null;
  const inset = { top: r.top - box.top, right: box.right - r.right, bottom: box.bottom - r.bottom, left: r.left - box.left };
  if (within && Object.values(inset).some((v) => v < -1)) return null;
  // Its corners: its own, or those of what draws it inside (the search page's form holds a round field).
  const drawn = [source, ...source.querySelectorAll<HTMLElement>('*')].find((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0 && Math.abs(el.getBoundingClientRect().height - r.height) < 1);
  const radius = Math.min(drawn ? parseFloat(getComputedStyle(drawn).borderTopLeftRadius) : 0, r.height / 2);
  return { ...inset, radius };
}

/**
 * LC81: the field the pill becomes, and the rest of the content (the siblings along the way up from it), which fades
 * around it. The field is seen from the first frame, on the pill's box, and goes to its place (FLIP: a move and its
 * width; the lens and the words keep their place in it). Without a field (every surface but the search's), the
 * content fades whole.
 */
function fieldAndRest(content: HTMLElement): { field: HTMLElement | null; rest: HTMLElement[] } {
  const field = content.querySelector<HTMLElement>('[data-island-field]');
  const rest: HTMLElement[] = [];
  for (let el = field; el && el !== content; el = el.parentElement) {
    for (const sibling of Array.from(el.parentElement?.children ?? [])) if (sibling !== el && sibling instanceof HTMLElement) rest.push(sibling);
  }
  return { field, rest };
}
/** The field on a box (the pill's, or its own place): measured with no animation on it. */
const FIELD_KEYS = ['transform', 'minWidth', 'maxWidth', 'opacity'];
function fieldOn(field: HTMLElement, box: DOMRect): Keyframe {
  const r = field.getBoundingClientRect();
  return { transform: `translate(${px(box.left - r.left)}, ${px(box.top - r.top)})`, minWidth: px(box.width), maxWidth: px(box.width) };
}

export interface IslandSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  ref?: Ref<HTMLDivElement>;
  /** What it grows from and goes back into. */
  source: IslandSource;
  /** Driven by its owner instead of `AnimatePresence`: shown while true; `onClosed` once its closing is over. */
  open?: boolean;
  onClosed?: () => void;
  /** The source is hidden while the surface is out and comes back as it lands (the search's pill, which it becomes). */
  hideSource?: boolean;
  /** Grows only from a source under its box (the search's pill or field); elsewhere it fades. */
  within?: boolean;
  /** Its two ways' times: the island's by default; a repeated action takes shorter ones (`lib/motion.ts`, LC132). */
  timing?: { open: KeyframeAnimationOptions; close: KeyframeAnimationOptions };
  /** The shape's look: ground, edge, corners, shadow. The content's corners must match its corners. */
  surfaceClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function IslandSurface({
  ref,
  source,
  open,
  onClosed,
  hideSource = false,
  within = false,
  timing: ways = { open: ISLAND_OPEN, close: ISLAND_CLOSE },
  className,
  surfaceClassName = cn('shadow-lg', CARD_RADIUS, ISLAND_SURFACE),
  contentClassName = cn('relative flex min-h-0 flex-1 flex-col overflow-hidden', CARD_RADIUS),
  children,
  ...rest
}: IslandSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const still = useReducedMotionLive();
  const [presence, safeToRemove] = usePresence();
  const isPresent = open ?? presence;
  const remove = useRef(onClosed ?? safeToRemove);
  const shown = useRef(isPresent);
  // Before the effects that call it: the closing render's own (a removal at once happens in the same commit).
  useLayoutEffect(() => {
    remove.current = onClosed ?? safeToRemove;
    shown.current = isPresent;
  });
  // The source hidden while the surface is out (`hideSource`); and the layers' running animations.
  const hidden = useRef<HTMLElement | null>(null);
  const running = useRef<Animation[]>([]);
  const started = useRef(false);
  const showSource = () => {
    if (hidden.current) hidden.current.style.opacity = '';
    hidden.current = null;
  };
  useEffect(() => showSource, []);
  // Gone at once, from a passive effect: it runs after every layout effect of the commit, `AnimatePresence`'s included,
  // which counts the exit only then (called from the layout effect below, the removal was ignored).
  const removeSoon = useRef(false);
  useEffect(() => {
    if (!removeSoon.current) return;
    removeSoon.current = false;
    // Not if it was opened again meanwhile.
    if (!shown.current) remove.current?.();
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const shape = shapeRef.current;
    const content = contentRef.current;
    const removeNow = () => {
      removeSoon.current = true;
    };
    if (!root || !shape || !content || typeof root.animate !== 'function') {
      if (!isPresent) removeNow();
      return undefined;
    }
    // Where the layers are now (the other way's animations included), then those animations stopped: the card's own
    // shadow is read once nothing runs.
    const take = () => {
      const { field, rest: others } = fieldAndRest(content);
      const was = running.current.length > 0
        ? {
          shape: now(shape, SHAPE_KEYS),
          content: now(content, ['clipPath', 'opacity']),
          root: now(root, ['opacity']),
          field: field && now(field, FIELD_KEYS),
          rest: { opacity: others[0] ? getComputedStyle(others[0]).opacity : '1' },
        }
        : null;
      running.current.forEach((a) => a.cancel());
      running.current = [];
      const own = getComputedStyle(shape);
      // The surface as its CSS draws it: its own corners.
      const full: Inset = { top: 0, right: 0, bottom: 0, left: 0, radius: parseFloat(own.borderTopLeftRadius) || 0 };
      // No clip is the whole surface, as an inset: `none` does not interpolate with one (the clip would jump halfway).
      if (was && (!was.content.clipPath || was.content.clipPath === 'none')) was.content.clipPath = clipAt(full);
      return { was, shadow: own.boxShadow, full, field, rest: others };
    };
    if (isPresent) {
      const grow = () => {
        started.current = true;
        const { was, shadow, full, field, rest: others } = take();
        root.style.opacity = '';
        // Back from a closing, which took the pointer away.
        root.style.pointerEvents = '';
        const from = still ? null : insetOf(source, root.getBoundingClientRect(), within);
        const element = source instanceof HTMLElement ? source : null;
        const timing = { ...ways.open, fill: 'backwards' as const };
        // LC81: the field, at its place now (nothing runs on it), and where it starts: on the pill, or where it is.
        const fieldHome = field && fieldOn(field, field.getBoundingClientRect());
        const fieldFrom = field && (was?.field ?? (from && element ? { ...fieldOn(field, element.getBoundingClientRect()), opacity: 1 } : null));
        running.current = fieldHome && fieldFrom && (was || from)
          ? [
            was
              ? shape.animate([was.shape, { ...shapeAt(full), boxShadow: shadow, opacity: 1 }], timing)
              : shape.animate([{ ...shapeAt(from!), boxShadow: noShadow(shadow) }, { ...shapeAt(full), boxShadow: shadow }], timing),
            content.animate([{ clipPath: was ? was.content.clipPath : clipAt(from!) }, { clipPath: clipAt(full) }], timing),
            field!.animate([fieldFrom, { ...fieldHome, opacity: 1 }], timing),
            ...others.map((el) => el.animate(was ? [was.rest, { opacity: 1 }] : [{ opacity: 0 }, { opacity: 0, offset: CONTENT_FROM }, { opacity: 1 }], timing)),
            ...(was ? [root.animate([was.root, { opacity: 1 }], timing)] : []),
          ]
          : was
          // Coming back while it closes: from where it is.
          ? [
            shape.animate([was.shape, { ...shapeAt(full), boxShadow: shadow, opacity: 1 }], timing),
            content.animate([was.content, { clipPath: clipAt(full), opacity: 1 }], timing),
            root.animate([was.root, { opacity: 1 }], timing),
          ]
          : from
            ? [
              shape.animate([{ ...shapeAt(from), boxShadow: noShadow(shadow) }, { ...shapeAt(full), boxShadow: shadow }], timing),
              content.animate([{ clipPath: clipAt(from), opacity: 0 }, { opacity: 0, offset: CONTENT_FROM }, { clipPath: clipAt(full), opacity: 1 }], timing),
            ]
            : [root.animate([{ opacity: 0 }, { opacity: 1 }], timing)];
        if (hideSource && from && element) {
          element.style.opacity = '0';
          hidden.current = element;
        }
        // Open: nothing holds, the layers are their own CSS again.
        const ran = running.current;
        ran[0].onfinish = () => {
          if (running.current !== ran) return;
          ran.forEach((a) => a.cancel());
          running.current = [];
        };
      };
      // At once, with no wait for the mount's frames (LC132: ⌘K waited up to 150 ms before growing).
      grow();
      return undefined;
    }

    // Closing, from where it is, into the source where it is now, or a fade. Closed before it started: gone at once.
    root.style.pointerEvents = 'none';
    if (!started.current) {
      showSource();
      removeNow();
      return undefined;
    }
    const { was, shadow, full, field, rest: others } = take();
    const pill = hidden.current;
    const to = still ? null : insetOf(pill ?? source, root.getBoundingClientRect(), within);
    const timing = { ...ways.close, fill: 'forwards' as const };
    const shapeNow = was?.shape ?? { ...shapeAt(full), boxShadow: shadow, opacity: 1 };
    const contentNow = was?.content ?? { clipPath: clipAt(full), opacity: 1 };
    // LC81: the field goes back onto the pill, seen to the end, and gives way to it in the same crossfade as the shape.
    const back = pill ?? (source instanceof HTMLElement ? source : null);
    running.current = to && field && back
      ? [
        shape.animate([shapeNow, { opacity: 1, offset: PILL_FROM }, { ...shapeAt(to), boxShadow: noShadow(shadow), opacity: 0 }], timing),
        content.animate([{ clipPath: contentNow.clipPath }, { clipPath: clipAt(to) }], timing),
        field.animate([was?.field ?? { ...fieldOn(field, field.getBoundingClientRect()), opacity: 1 }, { opacity: 1, offset: PILL_FROM }, { ...fieldOn(field, back.getBoundingClientRect()), opacity: 0 }], timing),
        ...others.map((el) => el.animate([was?.rest ?? { opacity: 1 }, { opacity: 0, offset: CONTENT_UNTIL }, { opacity: 0 }], timing)),
        ...(pill ? [pill.animate([{ opacity: 0 }, { opacity: 0, offset: PILL_FROM }, { opacity: 1 }], timing)] : []),
      ]
      : to
      ? [
        shape.animate([shapeNow, { opacity: 1, offset: PILL_FROM }, { ...shapeAt(to), boxShadow: noShadow(shadow), opacity: 0 }], timing),
        content.animate([contentNow, { opacity: 0, offset: CONTENT_UNTIL }, { clipPath: clipAt(to), opacity: 0 }], timing),
        // The pill comes back under the shape as it lands, by the same time and curve.
        ...(pill ? [pill.animate([{ opacity: 0 }, { opacity: 0, offset: PILL_FROM }, { opacity: 1 }], timing)] : []),
      ]
      : [root.animate([was?.root ?? { opacity: 1 }, { opacity: 0 }], timing)];
    const ran = running.current;
    ran[0].onfinish = () => {
      if (running.current !== ran) return;
      // The source's own CSS again (it ends where its CSS is); the layers hold their end until the surface is removed.
      showSource();
      ran.filter((a) => a.effect && (a.effect as KeyframeEffect).target === pill).forEach((a) => a.cancel());
      remove.current?.();
    };
    return undefined;
    // Once per opening and per closing: the surface's own renders move nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the source is read as each way starts
  }, [isPresent]);

  const setRoot = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  return (
    // Closing, it takes no key and no click (an Enter on a confirmation going back must not confirm). Placed by its
    // owner, or `relative` for its shape.
    <div ref={setRoot} {...rest} inert={!isPresent || undefined} className={cn('relative', className)}>
      <div ref={shapeRef} aria-hidden data-island-shape="" className={cn('pointer-events-none absolute inset-0', surfaceClassName)} />
      <div ref={contentRef} data-island-content="" className={contentClassName}>
        {children}
      </div>
    </div>
  );
}
