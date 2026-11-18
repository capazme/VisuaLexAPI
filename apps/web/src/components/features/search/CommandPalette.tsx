import { createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useState, useSyncExternalStore, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from 'react';
import { Command, useCommandState } from 'cmdk';
import { autoUpdate, FloatingFocusManager, FloatingPortal, offset, shift, size, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { motion, AnimatePresence, useIsPresent, usePresence, useReducedMotion } from 'framer-motion';
import { BookOpen, ChevronDown, ChevronRight, Gavel, Library, List, Search, Settings2, SlidersHorizontal, Tag, X, Zap } from 'lucide-react';
import type { SearchParams, CustomAlias, SearchFilters } from '../../../types';
import { cn } from '../../../lib/utils';
import { ISLAND_CLOSE, ISLAND_OPEN, dur, ease, spring } from '../../../lib/motion';
import { parseItalianDate } from '../../../utils/dateUtils';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useTour } from '../../../hooks/useTour';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { isNumberedActType } from '../../../utils/sources/numberedActTypes';
import { useAliasCatalog, foldAlias } from '../../../hooks/useAliasCatalog';
import { Z_INDEX } from '../../../constants/zIndex';
import { FIELD_TEXT, FOCUS_RING, TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { activeFiltersLabel, countActiveFilters, defaultSearchFilters } from '../../../utils/searchFilters';
import { ISLAND_FIELD_FOCUS, ISLAND_LENS, ISLAND_PLACEHOLDER, ISLAND_SHAPE, ISLAND_SURFACE, ISLAND_TEXT, ISLAND_WORDS, SEARCH_FIELD_FORM_ID, SEARCH_ISLAND_ID, returnWordsToSearchField } from '../../../utils/searchFieldControl';
import { citationSearchParams, useSearchQuery } from '../../../hooks/useSearchQuery';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import { Button } from '../../ui/Button';
import { isTopmostDialog, openDialog } from '../../ui/dialogStack';
import { useRassegneForTopic } from '../rassegne/useRassegneForTopic';
import { rememberSearch } from '../rassegne/searchMemory';
import { provenance } from '../rassegne/rassegnaFilters';
import { filterPaletteActs, paletteActName, queryMatches, matchRanges } from './paletteActs';
import { useOpenSettings } from '../settings/settingsRoute';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (params: SearchParams) => void;
  /**
   * Open an act's index without picking an article — the "browse a code"
   * path. Skips the article step entirely.
   */
  onBrowseStructure?: (params: SearchParams) => void;
  /** Called once a decision or a topic was put in the practices: the host shows the search page, which
   *  alone draws them. */
  onShowSearch?: () => void;
  /** Open the page «Rassegne» on the search just remembered (`rememberSearch`), with the passage chosen, if any, by id. */
  onOpenRassegne?: (passo?: string) => void;
}

type PaletteStep = 'select_act' | 'input_article' | 'input_details';

const STEP_ORDER: Record<PaletteStep, number> = { select_act: 0, input_details: 1, input_article: 2 };

/** How many favourites and aliases «A portata di mano» shows before the box is typed in. */
const AT_HAND_ROWS = 6;

/** The panel's height on a computer, at most (40 rem). */
const PANEL_MAX_HEIGHT = 640;

/** Case-insensitive, for the reason given on `paletteActName`: an act named
 *  by the server ("regolamento ue") must reach the same branch as the same act
 *  picked from the list ("Regolamento UE"), or the palette skips the step that
 *  collects its number and date. */
function requiresDetails(actValue: string): boolean {
  return isNumberedActType(actValue);
}

// One row of the lists: 44 px, a colour change when chosen, never a lift (UI conventions).
const ROW = 'relative isolate flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-800 dark:text-ink-100';
const ROW_ICON = 'shrink-0 text-ink-500 dark:text-ink-400';
const SUBTLE = 'text-ink-600 dark:text-ink-400';
// A group's heading, drawn by cmdk (`heading`), which also names the group for a screen reader.
const GROUP_WITH_HEADING = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-600 dark:[&_[cmdk-group-heading]]:text-ink-400';
// Pietra's type (LC81): a serif title at 18 px and weight 400, as its headings; a group's name 12 px, weight 600.
const COLUMN_TITLE = 'px-3 pt-3 font-serif text-lg font-normal text-ink-900 dark:text-ink-50';
const QUIET_LINE = 'px-3 py-2 text-sm text-ink-600 dark:text-ink-400';
const FIELD_INPUT = cn(
  'h-11 w-full min-w-0 rounded-lg border border-ink-200 bg-white px-3 text-ink-900 placeholder:text-ink-500',
  FIELD_TEXT,
  'dark:border-ink-700 dark:bg-ink-950 dark:text-ink-50 dark:placeholder:text-ink-500 dark:placeholder:text-ink-400',
  FOCUS_RING,
);
const SMALL_INPUT = cn(
  'min-h-[44px] rounded-lg border border-ink-200 bg-white px-3 text-ink-900 md:min-h-9',
  FIELD_TEXT,
  'dark:border-ink-700 dark:bg-ink-950 dark:text-ink-50',
  FOCUS_RING,
);

/**
 * The keys cmdk takes for its list wherever they are pressed inside it: Enter (it picks the chosen row
 * and prevents the key), the arrows, Home and End. A control of the palette that is not the box keeps
 * them, or Enter on «Filtri avanzati» would open the first act and the arrows of «Fonte» would move the
 * list.
 */
const LIST_KEYS = new Set(['Enter', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
function keepKeys(event: ReactKeyboardEvent) {
  if (LIST_KEYS.has(event.key) && !(event.target as HTMLElement).hasAttribute('cmdk-input')) event.stopPropagation();
}

/** What the box holds: the chosen row's tint slides only between rows of one list, never from a row a
 *  letter typed has just filtered away. */
const ChosenRowScope = createContext('');

/**
 * The tint under the row the keyboard (or the pointer) has chosen. One element, carried from row to row
 * (`layoutId`), so the choice slides instead of jumping; under reduced motion it is drawn in place.
 */
function RowHighlight({ value, still }: { value: string; still: boolean }) {
  const chosen = useCommandState((state) => state.value?.toLowerCase() === value.toLowerCase());
  const scope = useContext(ChosenRowScope);
  if (!chosen) return null;
  // A stone tile, as the sidebar's active row (LC32: no edge bar beside it, the anti-slop review).
  const tint = 'absolute inset-0 -z-10 rounded-lg bg-ink-200 dark:bg-ink-700';
  return still
    ? <span aria-hidden className={tint} />
    : <motion.span aria-hidden layoutId={`command-palette-chosen-row:${scope}`} transition={spring.snappy} className={tint} />;
}

/**
 * A row of the menu (R2): while the box filters, the rows left slide to their places (`layout`) and those filtered out
 * fade away, popped out of the list (`AnimatePresence mode="popLayout"` around a list's rows) — and a row leaving is
 * `disabled` for cmdk, so Enter never picks a row no longer there. Under reduced motion nothing moves.
 */
function PaletteRow({ ref, value, onSelect, still, entering = false, className, children }: {
  ref?: Ref<HTMLDivElement>;
  value: string;
  onSelect: () => void;
  still: boolean;
  /** In a list that filters: it fades in when a letter brings it back. */
  entering?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const present = useIsPresent();
  return (
    // Leaving, it is not an option any more: not for Enter (`disabled`), not for a screen reader (`aria-hidden`).
    <Command.Item asChild value={value} onSelect={onSelect} disabled={!present} aria-hidden={!present || undefined}>
      <motion.div
        ref={ref}
        layout={still ? false : 'position'}
        initial={entering && !still ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: dur.press } }}
        transition={{ layout: spring.snappy, opacity: { duration: dur.press } }}
        className={cn(ROW, className)}
      >
        <RowHighlight value={value} still={still} />
        {children}
      </motion.div>
    </Command.Item>
  );
}

/** A row's words with the letters the box matched drawn in the app's ink (R2). */
function Matched({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end]) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<span key={start} className="font-semibold text-toga-700 dark:text-toga-300">{text.slice(start, end)}</span>);
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The visual viewport's height (a phone's keyboard shortens it, `100dvh` does not on iOS); null where it is unknown. */
const subscribeViewport = (change: () => void) => {
  window.visualViewport?.addEventListener('resize', change);
  return () => window.visualViewport?.removeEventListener('resize', change);
};
const viewportHeight = () => window.visualViewport?.height ?? null;
/** Closed, or on a computer: nothing watched. */
const subscribeNothing = () => () => {};
const noHeight = () => null;

/**
 * The island (LC69, written again from scratch after a frame-by-frame look; Luca, 17 Nov: «mixa tutta una serie di
 * stili diversi»). One way for every opening: the panel grows out of what opened it — the top bar's pill, the search
 * page's field — and goes back into it. One technique, Web Animations; `usePresence` only keeps the panel mounted while
 * it closes. Two layers moved by the same rectangle, the same time and the same curve: the shape (the card's ground,
 * edge and shadow) and the content, clipped to the shape, fading in as it grows and out as it shrinks. The pill is
 * hidden while the panel is out and shown again when the shape is back on it. Any change of mind (closed while it
 * opens, opened while it closes) starts from where the layers are on screen. Nothing to grow from, or reduced motion:
 * the panel only fades.
 */
/**
 * Where along each way (as a share of the shape's way, not of the time) the content is seen: from a quarter of the
 * opening; gone by four fifths of the closing. The closing ends in a crossfade: the shape, a few pixels off the pill,
 * gives way to the pill itself.
 */
const CONTENT_FROM = 0.25;
const CONTENT_UNTIL = 0.8;
const PILL_FROM = 0.99;
/** The longest the opening waits for the mount's long frames to pass, so none of it is skipped. */
const SETTLE_MS = 150;
const SHAPE_KEYS = ['top', 'right', 'bottom', 'left', 'borderRadius', 'boxShadow', 'opacity'];

type Inset = { top: number; right: number; bottom: number; left: number; radius: number };
const px = (n: number) => `${Math.round(n * 10) / 10}px`;
const shapeAt = (i: Inset) => ({ top: px(i.top), right: px(i.right), bottom: px(i.bottom), left: px(i.left), borderRadius: px(i.radius) });
const clipAt = (i: Inset) => `inset(${px(i.top)} ${px(i.right)} ${px(i.bottom)} ${px(i.left)} round ${px(i.radius)})`;
/** The same shadow, every colour transparent: interpolates with the card's own (same layers, same lengths). */
const noShadow = (shadow: string) => shadow.replace(/(?:rgba?|oklch|oklab|lab|lch|color)\([^)]*\)/g, 'rgba(0, 0, 0, 0)');

/** The source's rectangle inside the panel's box, or null where there is none to grow from (gone, or not under it). */
function insetOf(source: HTMLElement | null, box: DOMRect): Inset | null {
  if (!source?.isConnected) return null;
  const r = source.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const inset = { top: r.top - box.top, right: box.right - r.right, bottom: box.bottom - r.bottom, left: r.left - box.left };
  if (Object.values(inset).some((v) => v < -1)) return null;
  // Its corners: its own, or those of what draws it inside (the search page's form holds a round field).
  const drawn = [source, ...source.querySelectorAll<HTMLElement>('*')].find((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0 && Math.abs(el.getBoundingClientRect().height - r.height) < 1);
  const radius = Math.min(drawn ? parseFloat(getComputedStyle(drawn).borderTopLeftRadius) : 0, r.height / 2);
  return { ...inset, radius };
}

/**
 * LC81: the field the pill becomes, and the rest of the panel's content (the siblings along the way up from it), which
 * fades around it. The field is seen from the first frame, on the pill's box, and goes to its place (FLIP: a move and
 * its width; the lens and the words keep their place in it). Without the field (a later step), the content fades whole.
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

/** The values the layers show now (an animation running included), to go on from there. */
function now(el: HTMLElement, keys: string[]): Keyframe {
  const style = getComputedStyle(el) as unknown as Record<string, string>;
  return Object.fromEntries(keys.map((key) => [key, style[key]]));
}

function IslandPanel({ still, source, className, children }: { still: boolean; source: HTMLElement | null; className: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isPresent, safeToRemove] = usePresence();
  const remove = useRef(safeToRemove);
  // Before the effects that call it: the closing render's own (a removal at once happens in the same commit).
  useLayoutEffect(() => {
    remove.current = safeToRemove;
  });
  // What the pill was grown from, hidden while the panel is out; and the layers' running animations.
  const hidden = useRef<HTMLElement | null>(null);
  const running = useRef<Animation[]>([]);
  const started = useRef(false);
  const showPill = () => {
    if (hidden.current) hidden.current.style.opacity = '';
    hidden.current = null;
  };
  useEffect(() => showPill, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const shape = shapeRef.current;
    const content = contentRef.current;
    if (!root || !shape || !content || typeof root.animate !== 'function') {
      if (!isPresent) remove.current?.();
      return undefined;
    }
    // Where the layers are now (the other way's animations included), then those animations stopped: the card's own
    // shadow is read once nothing runs.
    const take = () => {
      const { field, rest } = fieldAndRest(content);
      const was = running.current.length > 0
        ? {
          shape: now(shape, SHAPE_KEYS),
          content: now(content, ['clipPath', 'opacity']),
          root: now(root, ['opacity']),
          field: field && now(field, FIELD_KEYS),
          rest: { opacity: rest[0] ? getComputedStyle(rest[0]).opacity : '1' },
        }
        : null;
      running.current.forEach((a) => a.cancel());
      running.current = [];
      const own = getComputedStyle(shape);
      // The panel as its CSS draws it: its corners are the theme's `rounded-2xl`.
      const full: Inset = { top: 0, right: 0, bottom: 0, left: 0, radius: parseFloat(own.borderTopLeftRadius) || 0 };
      // No clip is the whole panel, as an inset: `none` does not interpolate with one (the clip would jump halfway).
      if (was && (!was.content.clipPath || was.content.clipPath === 'none')) was.content.clipPath = clipAt(full);
      return { was, shadow: own.boxShadow, full, field, rest };
    };
    let frame = 0;
    let idle = 0;

    if (isPresent) {
      const open = () => {
        started.current = true;
        const { was, shadow, full, field, rest } = take();
        root.style.opacity = '';
        // Back from a closing, which took the pointer away.
        root.style.pointerEvents = '';
        const from = still ? null : insetOf(source, root.getBoundingClientRect());
        const timing = { ...ISLAND_OPEN, fill: 'backwards' as const };
        // LC81: the field, at its place now (nothing runs on it), and where it starts: on the pill, or where it is.
        const fieldHome = field && fieldOn(field, field.getBoundingClientRect());
        const fieldFrom = field && (was?.field ?? (from && source ? { ...fieldOn(field, source.getBoundingClientRect()), opacity: 1 } : null));
        running.current = fieldHome && fieldFrom && (was || from)
          ? [
            was
              ? shape.animate([was.shape, { ...shapeAt(full), boxShadow: shadow, opacity: 1 }], timing)
              : shape.animate([{ ...shapeAt(from!), boxShadow: noShadow(shadow) }, { ...shapeAt(full), boxShadow: shadow }], timing),
            content.animate([{ clipPath: was ? was.content.clipPath : clipAt(from!) }, { clipPath: clipAt(full) }], timing),
            field!.animate([fieldFrom, { ...fieldHome, opacity: 1 }], timing),
            ...rest.map((el) => el.animate(was ? [was.rest, { opacity: 1 }] : [{ opacity: 0 }, { opacity: 0, offset: CONTENT_FROM }, { opacity: 1 }], timing)),
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
        if (from && source) {
          source.style.opacity = '0';
          hidden.current = source;
        }
        // Open: nothing holds, the layers are their own CSS again.
        const ran = running.current;
        ran[0].onfinish = () => {
          if (running.current !== ran) return;
          ran.forEach((a) => a.cancel());
          running.current = [];
        };
      };
      // Coming back while it closes goes on at once; so does a fade, which has nothing to skip, and under reduced motion
      // the app's rule gives every opacity change a CSS transition (`index.css`), which an inline wait would start.
      if (running.current.length > 0 || still) open();
      else {
        // Hidden until it starts (the pill shows meanwhile): mounting the menu is long frames, and a way started under
        // them is seen from a third of it. Started on the frame after the page is idle, at most `SETTLE_MS` later
        // (no idle callback, Safari: after two frames).
        root.style.opacity = '0';
        const start = () => {
          frame = requestAnimationFrame(open);
        };
        if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(start, { timeout: SETTLE_MS });
        else frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(start);
        });
      }
      return () => {
        cancelAnimationFrame(frame);
        if (idle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
      };
    }

    // Closing, from where it is, into the pill where it is now, or a fade. Closed before it started: gone at once.
    root.style.pointerEvents = 'none';
    if (!started.current) {
      showPill();
      remove.current?.();
      return undefined;
    }
    const { was, shadow, full, field, rest } = take();
    const pill = hidden.current;
    const to = still ? null : insetOf(pill ?? source, root.getBoundingClientRect());
    const timing = { ...ISLAND_CLOSE, fill: 'forwards' as const };
    const shapeNow = was?.shape ?? { ...shapeAt(full), boxShadow: shadow, opacity: 1 };
    const contentNow = was?.content ?? { clipPath: clipAt(full), opacity: 1 };
    // LC81: the field goes back onto the pill, seen to the end, and gives way to it in the same crossfade as the shape.
    const back = pill ?? source;
    running.current = to && field && back
      ? [
        shape.animate([shapeNow, { opacity: 1, offset: PILL_FROM }, { ...shapeAt(to), boxShadow: noShadow(shadow), opacity: 0 }], timing),
        content.animate([{ clipPath: contentNow.clipPath }, { clipPath: clipAt(to) }], timing),
        field.animate([was?.field ?? { ...fieldOn(field, field.getBoundingClientRect()), opacity: 1 }, { opacity: 1, offset: PILL_FROM }, { ...fieldOn(field, back.getBoundingClientRect()), opacity: 0 }], timing),
        ...rest.map((el) => el.animate([was?.rest ?? { opacity: 1 }, { opacity: 0, offset: CONTENT_UNTIL }, { opacity: 0 }], timing)),
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
      // The pill's own CSS again (it ends where its CSS is); the panel's layers hold their end until it is removed.
      showPill();
      ran.filter((a) => a.effect && (a.effect as KeyframeEffect).target === pill).forEach((a) => a.cancel());
      remove.current?.();
    };
    return undefined;
    // Once per opening and per closing: the panel's own renders move nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the source is read as each way starts
  }, [isPresent]);

  return (
    <div ref={rootRef} className={cn(className, 'relative')}>
      <div ref={shapeRef} aria-hidden data-island-shape="" className={cn('pointer-events-none absolute inset-0 rounded-2xl shadow-lg', ISLAND_SURFACE)} />
      <div ref={contentRef} data-island-content="" className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        {children}
      </div>
    </div>
  );
}

/** The veil under the island: the same times and curves, by the same technique. */
function IslandVeil({ onClick }: { onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isPresent, safeToRemove] = usePresence();
  const remove = useRef(safeToRemove);
  // Before the effects that call it: the closing render's own (a removal at once happens in the same commit).
  useLayoutEffect(() => {
    remove.current = safeToRemove;
  });
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // Closing, it lets the pointer through: a tap on the pill opens the panel again from where it is.
    if (el) el.style.pointerEvents = isPresent ? '' : 'none';
    if (!el || typeof el.animate !== 'function') {
      if (!isPresent) remove.current?.();
      return;
    }
    const from = running.current ? now(el, ['opacity']) : { opacity: isPresent ? 0 : 1 };
    running.current?.cancel();
    const animation = el.animate([from, { opacity: isPresent ? 1 : 0 }], { ...(isPresent ? ISLAND_OPEN : ISLAND_CLOSE), fill: 'both' });
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      if (isPresent) {
        animation.cancel();
        running.current = null;
      } else remove.current?.();
    };
    // Once per way.
  }, [isPresent]);
  return (
    <div
      ref={ref}
      data-palette-veil=""
      aria-hidden
      // `touch-none`: a drag on it does not scroll the page under it (iOS).
      className={cn('fixed inset-0 touch-none bg-ink-950/20 dark:bg-ink-950/50', Z_INDEX.commandPalette)}
      onClick={onClick}
    />
  );
}

export function CommandPalette({ isOpen, onClose, onSearch, onBrowseStructure, onShowSearch, onOpenRassegne }: CommandPaletteProps) {
  const {
    quickNorms, selectQuickNorm, settings,
    customAliases, trackAliasUsage, openDecision, openTopicSearch, takeCommandPaletteQuery, commandPaletteQuery
  } = useAppStore(useShallow(s => ({
    quickNorms: s.quickNorms,
    selectQuickNorm: s.selectQuickNorm,
    settings: s.settings,
    customAliases: s.customAliases,
    trackAliasUsage: s.trackAliasUsage,
    openDecision: s.openDecision,
    openTopicSearch: s.openTopicSearch,
    takeCommandPaletteQuery: s.takeCommandPaletteQuery,
    commandPaletteQuery: s.commandPaletteQuery,
  })));
  const openSettings = useOpenSettings();
  // The box is focused as the palette opens; the first-open tour (driver.js, started 300 ms later)
  // can take that focus, so when the tour ends the box gets it back. Only if the box is still there:
  // the ref is empty once the palette has closed or moved on to another step.
  const boxRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  // LC81: how the focus came, for the field's frame (`ISLAND_FIELD_FOCUS`), the pill's rule: 1 px from a pointer, 2 px
  // from the keyboard. Read by a listener on the whole page because a text field always matches `:focus-visible`, a
  // tap's focus included (the pill, a button, does not): CSS alone cannot tell the two apart. Tab, a shortcut (⌘K), an arrow, or Enter or Space on a control count as the keyboard; the words
  // typed in the field, an on-screen keyboard's included, do not.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const onPointer = () => setKeyboard(false);
    const onKey = (event: KeyboardEvent) => {
      const onControl = !(event.target instanceof HTMLInputElement) && (event.key === 'Enter' || event.key === ' ');
      if (event.key === 'Tab' || event.metaKey || event.ctrlKey || event.key.startsWith('Arrow') || onControl) setKeyboard(true);
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
  const { tryStartTour } = useTour({
    theme: settings.theme as 'light' | 'dark',
    onComplete: (tour) => {
      if (tour === 'commandPalette') setTimeout(() => boxRef.current?.focus(), 0);
    },
  });
  const [step, setStep] = useState<PaletteStep>('select_act');
  const [selectedAct, setSelectedAct] = useState('');
  // Empty, its placeholder saying what it takes: a «1» standing there took Backspace's first press (Bill).
  const [article, setArticle] = useState('');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  // Enter pressed while the server was still naming the act: the words it was pressed on (the field's rule, R2).
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  // The arrows moved the chosen row since the words last changed: Enter is then cmdk's, for the row chosen.
  const [moved, setMoved] = useState(false);
  // A choice made in this opening: closed after it, the search page's field is emptied; closed without one (Esc, a
  // click outside, ✕), the words go back to it — one field (R2).
  const [chose, setChose] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(defaultSearchFilters);
  const isDesktop = useIsDesktop();
  const still = Boolean(useReducedMotion());

  // Which way the step moved, for its slide: forward slides in from the right, back from the left.
  // Adjusted during render (own state, no effect). A step changed while the palette is closed (the reset)
  // does not slide the next opening.
  const [shownStep, setShownStep] = useState<PaletteStep>(step);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  if (step !== shownStep) {
    setShownStep(step);
    setDirection(isOpen ? (STEP_ORDER[step] > STEP_ORDER[shownStep] ? 1 : -1) : 0);
  } else if (!isOpen && direction !== 0) {
    setDirection(0);
  }

  // A citation handed over as the palette opens goes into the box (a decision that was not found).
  // Adjusted during render (own state, no effect); the store's copy is then taken in an effect.
  const [handedOver, setHandedOver] = useState<string | null>(null);
  if (isOpen && commandPaletteQuery !== null && commandPaletteQuery !== handedOver) {
    setHandedOver(commandPaletteQuery);
    setInputValue(commandPaletteQuery);
  } else if (commandPaletteQuery === null && handedOver !== null) {
    setHandedOver(null);
  }
  useEffect(() => {
    if (isOpen && commandPaletteQuery !== null) takeCommandPaletteQuery();
  }, [isOpen, commandPaletteQuery, takeCommandPaletteQuery]);

  // The palette's tour on its first opening — an empty one: opened with words or a key typed on the search page's
  // field (R2), the tour would take the focus and the letters that follow.
  const startTourIfEmpty = useEffectEvent(() => {
    if (!inputValue.trim()) tryStartTour('commandPalette');
  });
  useEffect(() => {
    if (isOpen) startTourIfEmpty();
  }, [isOpen]);

  // Sorted custom aliases for display (by usage, then alphabetically)
  const sortedAliases = useMemo(() => {
    return [...customAliases].sort((a, b) =>
      b.usageCount - a.usageCount || a.trigger.localeCompare(b.trigger)
    );
  }, [customAliases]);
  const hasAliases = sortedAliases.length > 0;

  // The aliases we ship. Shown next to the user's own so it is visible what
  // already exists and what still has to be invented — asked for directly:
  // "così che l'utente sappia cosa ha e cosa deve inserire da solo".
  const { catalog } = useAliasCatalog(isOpen);

  const presetEntries = useMemo(() => {
    const mine = new Set(customAliases.map(a => foldAlias(a.trigger)));
    return Object.entries(catalog.presets)
      // 21 of the 80 presets only rename an act type — "codice appalti" IS the
      // "Codice dei contratti pubblici" row that already sits in the list of acts,
      // so listing them duplicated the act list without adding anything. The
      // 59 kept here carry a number and a date ("gdpr" -> Reg. UE 679/2016),
      // which is work the list cannot save you.
      .filter(([, preset]) => Boolean(preset.act_number))
      // A custom alias with the same trigger wins at resolution time, so
      // showing the preset too would advertise a shortcut that no longer runs.
      .filter(([trigger]) => !mine.has(foldAlias(trigger)))
      // Shortest first: an alias earns its keep by being shorter than the name
      // it replaces.
      .sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  }, [catalog.presets, customAliases]);

  // Four, not three: the three shortest are all Testi Unici (tub, tuf, tus) and
  // read as cryptic on their own. The fourth is gdpr, which makes the whole
  // line legible at a glance.
  const presetHint = useMemo(
    () => presetEntries.slice(0, 4).map(([trigger]) => trigger).join(', '),
    [presetEntries]
  );

  // What the box names (a decision, a norm, a topic): one reading, shared with the search page's field.
  const { decisionRef, parsedCitation, citationReady, citationPreview, resolvingRemotely, topic } = useSearchQuery(inputValue);

  // The box filters every list while it is typed (`paletteActs.ts`: each typed word begins a word of the
  // row). cmdk's own filter is off: it reorders the rows by score, across the two columns.
  const typed = inputValue.trim();
  const actGroups = useMemo(() => filterPaletteActs(inputValue), [inputValue]);
  const visibleQuickNorms = typed
    ? quickNorms.filter((qn) => queryMatches(inputValue, qn.label, qn.searchParams.act_type))
    : quickNorms.slice(0, AT_HAND_ROWS);
  const visibleAliases = typed
    ? sortedAliases.filter((a) => queryMatches(inputValue, a.trigger, a.expandTo))
    : sortedAliases.slice(0, AT_HAND_ROWS);
  // Nothing at rest: the alias heading's line says they exist; that is the whole point of not drawing them.
  // They appear once the user types, so the full set stays reachable without weighing on the idle palette.
  const visiblePresets = typed
    ? presetEntries.filter(([trigger, preset]) => queryMatches(inputValue, trigger, preset.act_type))
    : [];
  // The door to the manager, found by typing «alias» too.
  const showAliasDoor = !typed || queryMatches(inputValue, 'alias gestisci crea scorciatoie');

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStep('select_act');
        setSelectedAct('');
        setArticle('');
        setActNumber('');
        setActDate('');
        setInputValue('');
        setWaitingFor(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // On the dialogs' stack while open: opened over one (⌘K over the comparison), it keeps Tab and Esc, which that dialog's
  // trap would otherwise take back, its box being portalled to the body, outside the dialog. Its own focus is floating-ui's.
  const [stackToken] = useState(() => Symbol('palette'));
  useEffect(() => (isOpen ? openDialog(stackToken) : undefined), [isOpen, stackToken]);

  // Handle Escape key. Only while open: a closed palette that took every Escape and called
  // `preventDefault` on it would hide it from whoever honours `defaultPrevented` (the rail's overlay). Only while it is the
  // top-most dialog: one opened over it takes its own Esc.
  useEffect(() => {
    if (!isOpen) return undefined;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopmostDialog(stackToken)) {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isOpen, onClose, stackToken]);

  /** A choice made: the menu closes and the field is left empty. */
  const done = useCallback(() => {
    setChose(true);
    onClose();
  }, [onClose]);

  const handleSelectAct = useCallback((actValue: string) => {
    setSelectedAct(actValue);
    setInputValue('');

    if (requiresDetails(actValue)) {
      setStep('input_details');
    } else {
      setStep('input_article');
    }
  }, []);

  const handleSelectQuickNorm = useCallback((id: string) => {
    const qn = selectQuickNorm(id);
    if (qn) {
      onSearch(qn.searchParams);
      done();
    }
  }, [selectQuickNorm, onSearch, done]);

  // The quick norms and the aliases are parts of Impostazioni (LC84): the palette closes and the page opens there.
  const handleOpenQuickNormsManager = useCallback(() => {
    done();
    openSettings('norme-rapide');
  }, [done, openSettings]);

  const handleOpenAliasManager = useCallback(() => {
    done();
    openSettings('alias');
  }, [done, openSettings]);

  const handleSelectAlias = useCallback((alias: CustomAlias) => {
    trackAliasUsage(alias.id);

    if (alias.searchParams) {
      // Reference alias: execute search directly
      onSearch({
        act_type: alias.searchParams.act_type || '',
        act_number: alias.searchParams.act_number || '',
        date: alias.searchParams.date ? parseItalianDate(alias.searchParams.date) : '',
        article: alias.searchParams.article || '1',
        version: 'vigente',
        version_date: '',
        filters,
      });
      done();
    }
  }, [trackAliasUsage, onSearch, done, filters]);

  const handleSelectPreset = useCallback((trigger: string) => {
    const preset = catalog.presets[trigger];
    if (!preset) return;

    // A preset names an act, never an article, so it seeds the form rather
    // than running a search — same branch a picked act type takes.
    setSelectedAct(preset.act_type);
    setActNumber(preset.act_number ?? '');
    setActDate(preset.date ?? '');
    setInputValue('');
    setStep(
      requiresDetails(preset.act_type) && !(preset.act_number && preset.date)
        ? 'input_details'
        : 'input_article'
    );
  }, [catalog.presets]);

  const handleSearchTopic = useCallback(() => {
    if (!topic) return;
    openTopicSearch({ tema: topic }, `Tema: ${topic}`);
    done();
    onShowSearch?.();
  }, [topic, openTopicSearch, done, onShowSearch]);

  // The reviews' passages on the topic (U3), under the decisions' row: asked only while the first step is shown.
  const rassegne = useRassegneForTopic(isOpen && step === 'select_act' ? topic : null);
  const rassegnePage = rassegne && rassegne.answer !== 'error' && rassegne.answer.volumi > 0 && rassegne.answer.total > 0 ? rassegne.answer : null;
  const handleOpenRassegne = (passo?: string) => {
    if (!rassegne || !rassegnePage || !topic) return;
    // The page reads the search from memory: the words never go in an address nor in the history's state.
    rememberSearch({
      text: topic, q: rassegne.q, archivio: null, total: rassegnePage.total,
      archivi: rassegnePage.archivi, items: rassegnePage.items, next: rassegnePage.next_cursor,
    });
    done();
    onOpenRassegne?.(passo);
  };

  const handleOpenDecision = useCallback(() => {
    if (!decisionRef) return;
    openDecision(decisionRef, { fromLink: true });
    done();
    onShowSearch?.();
  }, [decisionRef, openDecision, done, onShowSearch]);

  const handleCitationSearch = useCallback(() => {
    if (!parsedCitation) return;

    // Track alias usage if citation was resolved from an alias
    if (parsedCitation.fromAlias && parsedCitation.aliasId) {
      trackAliasUsage(parsedCitation.aliasId);
    }

    if (citationReady) {
      onSearch(citationSearchParams(parsedCitation, { filters }));
      done();
    } else if (parsedCitation.act_type) {
      setSelectedAct(parsedCitation.act_type);
      if (parsedCitation.article) setArticle(parsedCitation.article);
      if (parsedCitation.act_number) setActNumber(parsedCitation.act_number);
      if (parsedCitation.date) setActDate(parsedCitation.date);
      setInputValue('');

      if (requiresDetails(parsedCitation.act_type)) {
        if (parsedCitation.act_number && parsedCitation.date) {
          setStep('input_article');
        } else {
          setStep('input_details');
        }
      } else {
        setStep('input_article');
      }
    }
  }, [parsedCitation, citationReady, onSearch, done, filters, trackAliasUsage]);

  // The answer Enter was waiting for has come: run it, once.
  const runWhenAnswered = useEffectEvent(() => {
    setWaitingFor(null);
    if (decisionRef) handleOpenDecision();
    else if (parsedCitation) handleCitationSearch();
    else if (topic) handleSearchTopic();
  });
  useEffect(() => {
    // Not once closed: Esc during the wait drops it (the reset clears it 200 ms later).
    if (isOpen && waitingFor !== null && waitingFor === inputValue && !resolvingRemotely) runWhenAnswered();
  }, [isOpen, waitingFor, inputValue, resolvingRemotely]);
  const waiting = waitingFor !== null && waitingFor === inputValue;

  /** One step back: the article to the details (when the act has them) or to the act, the details to the act. */
  const stepBack = useCallback(() => {
    if (step === 'input_article' && requiresDetails(selectedAct)) setStep('input_details');
    else if (step !== 'select_act') setStep('select_act');
  }, [step, selectedAct]);
  /** Backspace on an empty field goes back a step, as in the field's crumb (R2). */
  const backOnEmpty = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // A held key does not run through the steps: it empties the field and stops there.
    if (event.key === 'Backspace' && event.currentTarget.value === '' && !event.repeat) {
      event.preventDefault();
      stepBack();
    }
  };

  const handleSubmitArticle = useCallback(() => {
    if (!selectedAct || !article) return;

    onSearch({
      act_type: selectedAct,
      article,
      act_number: actNumber || '',
      date: actDate ? parseItalianDate(actDate) : '',
      version: 'vigente',
      version_date: '',
      filters,
    });
    done();
  }, [selectedAct, article, actNumber, actDate, onSearch, done, filters]);

  const handleSubmitDetails = useCallback(() => {
    if (!selectedAct || !actNumber || !actDate) return;
    setStep('input_article');
  }, [selectedAct, actNumber, actDate]);

  /**
   * Leave by the other door: open the act's index instead of an article.
   * Available from the article step, which is where the act (and its details,
   * when required) is already known.
   */
  const handleBrowse = useCallback(() => {
    if (!selectedAct || !onBrowseStructure) return;

    onBrowseStructure({
      act_type: selectedAct,
      article: '',
      act_number: actNumber || '',
      date: actDate ? parseItalianDate(actDate) : '',
      version: 'vigente',
      version_date: '',
      filters,
    });

    done();
  }, [selectedAct, actNumber, actDate, filters, onBrowseStructure, done]);

  /** The act as a lawyer names it (`paletteActName`: case-insensitive, the raw value when unknown). */
  const selectedActLabel = useMemo(() => paletteActName(selectedAct), [selectedAct]);
  /** The crumb in the field, and its name: the act, with its number and year on the article's step. */
  const crumbText = `${selectedActLabel}${step === 'input_article' && actNumber ? ` ${actNumber}${actDate ? `/${actDate.slice(-4)}` : ''}` : ''}`;

  // On a computer the palette drops from the search page's field, as wide as the field, over it;
  // where no field is on screen (another page, Focus mode) it hangs at the top, centred. The form is
  // looked up at every render while open, so a field that mounts later (the address /sentenze) or goes
  // is followed, and passed at render time (gotcha 13).
  const field = isOpen && isDesktop ? document.getElementById(SEARCH_FIELD_FORM_ID) : null;
  // The top bar's compact field (LC21) is no field to grow from (Luca, 15 Nov: the menu was as narrow as it): the menu
  // then hangs at the top, centred and wide, as from every other page — one menu, one place.
  // LC40 (Luca, 16 Nov: «effetto espansione Dynamic Island … in qualsiasi scheda»): the top bar's pill — the search
  // page's compact field, or the bar's button on every other page — is an island: the menu grows out of it, wide, centred
  // on it, its top on the pill's. The search page's own large field (Corpus, below lg) stays a field it drops from.
  // On a phone too (Luca, 16 Nov: «Sì, anche lì»): the bar's «Cerca» pill.
  const island = !isOpen
    ? null
    : isDesktop && field?.isConnected && field.hasAttribute('data-compact')
      ? field
      : document.getElementById(SEARCH_ISLAND_ID);
  const anchor = island?.isConnected ? island : field?.isConnected && !field.hasAttribute('data-compact') ? field : null;
  const isIsland = anchor !== null && anchor === island;
  // What the panel grows out of: what it hangs from, or on a phone's search page (no pill there, and the panel hangs
  // at the top by itself) the page's field, under it (LC69).
  const growSource = anchor ?? (isOpen && !isDesktop ? document.getElementById(SEARCH_FIELD_FORM_ID) : null);
  // From the island the menu's own width, 768 px, the window allowing.
  const islandWidth = Math.min(768, (typeof window === 'undefined' ? 1024 : window.innerWidth) - 32);
  // A phone: the panel as tall as what the keyboard leaves, and the page under it holds still (the sheet it replaced
  // did both).
  const watchViewport = isOpen && !isDesktop;
  const shownHeight = useSyncExternalStore(
    watchViewport ? subscribeViewport : subscribeNothing,
    watchViewport ? viewportHeight : noHeight,
    noHeight,
  );
  useEffect(() => {
    if (!isOpen || isDesktop) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, [isOpen, isDesktop]);
  // A dialog on a computer too: the focus stays inside while it is open and goes back where it was
  // (the field) when it closes. Placed only when the field is there.
  // What the box hangs from now, for `size`, which may run with the last element floating-ui had.
  const anchorRef = useRef(anchor);
  useLayoutEffect(() => {
    anchorRef.current = anchor;
  });
  const { refs, floatingStyles, context, update } = useFloating({
    open: isOpen,
    elements: { reference: anchor },
    placement: isIsland ? 'bottom' : 'bottom-start',
    strategy: 'fixed',
    middleware: [
      // Its top on the field's: the panel's own box takes the field's place.
      offset(({ rects }) => -rects.reference.height),
      // The island's panel, wider than the pill, stays in the window.
      ...(isIsland ? [shift({ padding: 16 })] : []),
      // As wide as the field (from the island: the menu's own width, 768 px, the window allowing); as tall as what it
      // holds, up to the height it always had (Bill: one row is not a 640 px panel), the window allowing.
      // eslint-disable-next-line react-hooks/refs -- `apply` runs as floating-ui places the box, after the render
      size({
        padding: 16,
        apply({ rects, availableHeight, elements }) {
          // Nothing to hang from now: floating-ui may still measure the last element it had (it keeps it, in
          // `@floating-ui/react` and in `react-dom`), a computer's field hidden on a phone, 0 px wide.
          if (elements.reference !== anchorRef.current) return;
          elements.floating.style.width = isIsland ? `${islandWidth}px` : `${rects.reference.width}px`;
          // On a phone what the keyboard leaves (the visual viewport), from the pill down. Read here, not from the
          // render: floating-ui keeps the first `apply` (same source text), so a captured height would stay stale.
          const shown = isDesktop ? null : viewportHeight();
          const room = shown ? shown - rects.reference.y - 8 : availableHeight;
          elements.floating.style.setProperty('--palette-max-h', `${Math.min(PANEL_MAX_HEIGHT, Math.max(isDesktop ? 320 : 200, room))}px`);
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  // The keyboard opening or closing changes only the visual viewport, which autoUpdate does not watch.
  useEffect(() => {
    if (shownHeight !== null) update();
  }, [shownHeight, update]);
  // Nothing to hang from (the field gone, another page, Focus mode, or a phone's search page after a computer's): what
  // `size` wrote on the box goes with it, on a computer and on a phone alike, or the panel would keep a stale width
  // (0 px, after a window narrowed from a computer's to a phone's).
  useLayoutEffect(() => {
    // Closing: the box stays where it is, so the island goes back into the pill (LC69).
    if (anchor || !isOpen) return;
    const box = refs.floating.current;
    box?.style.removeProperty('width');
    // A phone's height is React's own (the visual viewport's, in `style`): only a computer's is `size`'s.
    if (isDesktop) box?.style.removeProperty('--palette-max-h');
  }, [anchor, isDesktop, isOpen, refs]);
  const role = useRole(context, { role: 'dialog' });
  // What had the focus as the palette opened (the field, a button elsewhere): it gets it back.
  // Taken during render as the palette opens (own state, no effect), before the box takes the focus.
  const [wasOpen, setWasOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setChose(false);
      // Opened again before the reset after a close (200 ms): it starts at its first step all the same, with no
      // words but those handed over.
      setStep('select_act');
      setSelectedAct('');
      setArticle('');
      setActNumber('');
      setActDate('');
      setWaitingFor(null);
      setMoved(false);
      if (commandPaletteQuery === null) setInputValue('');
    }
  }
  const { getFloatingProps } = useInteractions([role]);

  // Closed: its words go back to the search page's field when no choice was made (R2: one field), the field is
  // emptied after a choice. Only on a closing, not on the first draw.
  const wordsNow = useRef('');
  const stepNow = useRef<PaletteStep>(step);
  const choseNow = useRef(chose);
  useEffect(() => {
    wordsNow.current = inputValue;
    stepNow.current = step;
    choseNow.current = chose;
  });
  const closedOnce = useRef(isOpen);
  useEffect(() => {
    if (isOpen) {
      closedOnce.current = true;
      return;
    }
    if (!closedOnce.current) return;
    closedOnce.current = false;
    returnWordsToSearchField(!choseNow.current && stepNow.current === 'select_act' ? wordsNow.current.trim() : '');
  }, [isOpen]);

  // The step's content slides in from the side it moved to; the first step of an opening does not move.
  const stepMotion = direction === 0
    ? { initial: false as const }
    : {
        initial: still ? { opacity: 0 } : { opacity: 0, x: direction * 12 },
        animate: still ? { opacity: 1 } : { opacity: 1, x: 0 },
        transition: { duration: dur.pop, ease: ease.out },
      };

  const activeFilters = countActiveFilters(filters);

  // ── The field: the one strong thing of the panel ────────────────────────────────────────────────
  const waitingLine = { icon: Search, tone: 'animate-pulse text-ink-500 dark:text-ink-400', text: 'Cerco l’atto… la ricerca parte appena lo trovo', action: '' };
  const preview = decisionRef
    ? { icon: Gavel, tone: 'text-emerald-700 dark:text-emerald-400', text: `Sentenza → ${formatDecisionShort(decisionRef)}`, action: 'Invio apre' }
    : waiting ? waitingLine
    : parsedCitation && citationPreview
      ? {
          icon: parsedCitation.fromAlias ? Tag : Zap,
          tone: parsedCitation.fromAlias
            ? 'text-toga-700 dark:text-toga-300'
            : citationReady ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
          text: `${parsedCitation.fromAlias ? 'tramite alias → ' : ''}${citationPreview}`,
          action: citationReady ? 'Invio cerca' : 'Invio completa',
        }
      : resolvingRemotely
        ? { ...waitingLine, text: 'Cerco l’atto…' }
        : topic
          ? { icon: Gavel, tone: 'text-emerald-700 dark:text-emerald-400', text: `Cerca «${topic}» nelle sentenze della Cassazione`, action: 'Invio cerca' }
          : null;

  const helpLine = step === 'select_act'
    ? 'Scrivi una citazione: art. 2043 c.c., l. 241/1990, Cass. civ. 10787/2024'
    : step === 'input_details'
      ? "Scrivi il numero e l'anno (o la data) dell'atto: 241 e 1990"
      : "Scrivi il numero dell'articolo: 2043, 1-bis";

  const fieldRow = (
    <div className="flex items-center gap-2 px-3 pt-2" onKeyDown={keepKeys}>
      <motion.div key={step} {...stepMotion} className="flex min-w-0 flex-1 items-center gap-3">
        {step === 'select_act' && (
          // LC81: the pill it grew from, the same object: its shape, type, lens, ground and edge, and its focus on the
          // frame (`ISLAND_FIELD_FOCUS`). The box inside draws none, or the global `input:focus-visible` ring would
          // stand out around it.
          <div data-island-field="" data-keyboard={keyboard ? '' : undefined} className={cn('flex-1', ISLAND_SHAPE, ISLAND_SURFACE, ISLAND_FIELD_FOCUS)}>
            <Search aria-hidden className={ISLAND_LENS} />
            <Command.Input
              ref={boxRef}
              autoFocus
              value={inputValue}
              onValueChange={(value) => {
                // A change of the words drops a wait: a new Enter is needed, even back on the same words.
                setWaitingFor(null);
                setMoved(false);
                setInputValue(value);
              }}
              enterKeyHint="search"
              aria-describedby="command-palette-help"
              // LC81: the pill's words, so nothing changes as it grows; the examples are on the line under the field.
              placeholder={ISLAND_PLACEHOLDER}
              // The pill's type (16 px at least on a phone: Safari on an iPhone zooms into a field under 16 px).
              className={cn('h-full w-full min-w-0 bg-transparent outline-none placeholder:text-slate-500 focus-visible:ring-0 focus-visible:ring-offset-0 dark:placeholder:text-slate-400', ISLAND_TEXT, ISLAND_WORDS)}
              onKeyDown={(e) => {
                // The field's order (R2): a decision, then the server still naming the act (the search runs when it
                // answers), then a norm — unless the arrows chose another row, which Enter then picks.
                if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) setMoved(true);
                // An Enter that ends an IME composition chooses the composed word, it searches nothing.
                if (e.key !== 'Enter' || moved || e.nativeEvent.isComposing) return;
                if (decisionRef) {
                  e.preventDefault();
                  handleOpenDecision();
                } else if (resolvingRemotely) {
                  e.preventDefault();
                  setWaitingFor(inputValue);
                } else if (parsedCitation) {
                  e.preventDefault();
                  handleCitationSearch();
                }
              }}
            />
          </div>
        )}

        {step !== 'select_act' && (
          // The crumb in the field (R2): the act chosen, which takes you back a step; Backspace on an empty field too.
          <button
            type="button"
            onClick={stepBack}
            aria-label={`Torna indietro: ${crumbText}`}
            className={cn('inline-flex min-h-[44px] max-w-[45%] shrink-0 items-center gap-1 rounded-md bg-ink-100 px-2 text-sm font-medium text-ink-800 hover:bg-ink-200 md:min-h-9 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700', FOCUS_RING)}
          >
            <span className="truncate">{crumbText}</span>
            <ChevronRight size={14} aria-hidden className="shrink-0" />
          </button>
        )}
        {step === 'input_details' && (
          <div className="flex min-w-0 flex-1 gap-2 py-1">
            <input
              type="text"
              ref={numberRef}
              aria-label="Numero dell'atto"
              placeholder="Numero, es. 241"
              value={actNumber}
              onChange={(e) => setActNumber(e.target.value)}
              className={cn(FIELD_INPUT, 'flex-[1.5]')}
              autoFocus
              onKeyDown={(e) => (e.key === 'Enter' ? handleSubmitDetails() : backOnEmpty(e))}
            />
            <input
              type="text"
              aria-label="Anno o data dell'atto"
              value={actDate}
              onChange={(e) => setActDate(e.target.value)}
              placeholder="Anno o data"
              className={cn(FIELD_INPUT, 'flex-1')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitDetails();
                // Backspace on an empty date goes back to the number first, while it holds one.
                else if (e.key === 'Backspace' && e.currentTarget.value === '' && actNumber && !e.repeat) {
                  e.preventDefault();
                  numberRef.current?.focus();
                } else backOnEmpty(e);
              }}
            />
          </div>
        )}

        {step === 'input_article' && (
          <div className="min-w-0 flex-1 py-1">
            <input
              type="text"
              aria-label="Numero dell'articolo"
              placeholder="Articolo, es. 12"
              value={article}
              onChange={(e) => setArticle(e.target.value)}
              className={FIELD_INPUT}
              autoFocus
              onKeyDown={(e) => (e.key === 'Enter' ? handleSubmitArticle() : backOnEmpty(e))}
            />
          </div>
        )}
      </motion.div>

      {/* «Chiudi», on a phone too: the panel has no other (R2). */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Chiudi"
        // LC81: as tall as the field (40 px, 32 from lg), 44 px to the finger.
        className={cn("relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-500 after:absolute after:-inset-0.5 after:content-[''] hover:bg-ink-100 hover:text-ink-800 lg:size-8 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100", FOCUS_RING)}
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );

  // The help line, or what the box was read as, 10 px under the field and on the line of its text: the
  // lens's edge (12 px of row, 1 of border, 12 in), then on the first step the lens's 16 px and a gap of 8, to the
  // words' 36 px in (`ISLAND_SHAPE`). The visible line is aria-hidden: the status region says it.
  // The line under the box says what no row says: the wait for the server. A decision, a norm or a topic read in the
  // box is its row, the chosen one, with «↵» — a second line saying the same was one too many (Bill).
  const lineSays = step === 'select_act' && preview && (waiting || resolvingRemotely) ? preview : null;
  const fieldLine = (
    <div aria-hidden className="flex min-h-5 items-center gap-2 pb-3 pl-[25px] pr-4 pt-2.5 text-xs">
      {step === 'select_act' && (
        <span className="flex w-4 shrink-0 justify-center">
          {lineSays && <lineSays.icon size={14} className={lineSays.tone} />}
        </span>
      )}
      {lineSays ? (
        <>
          <span id="command-palette-help" className="sr-only">{helpLine}</span>
          <span className={cn('min-w-0 flex-1 truncate font-medium', lineSays.tone)}>{lineSays.text}</span>
          <span className={cn('shrink-0', SUBTLE)}>{lineSays.action}</span>
        </>
      ) : (
        <span id="command-palette-help" className={SUBTLE}>{helpLine}</span>
      )}
    </div>
  );

  // ── What the box was read as: one strong row, the chosen one, in place of two columns with nothing
  // to choose. Enter in the box runs the same thing.
  const readAs = step !== 'select_act' ? null
    : decisionRef
      ? { icon: Gavel, text: formatDecisionShort(decisionRef), action: 'Apri la sentenza', run: handleOpenDecision }
      : parsedCitation && citationPreview
        ? {
            icon: parsedCitation.fromAlias ? Tag : Zap,
            text: `${parsedCitation.fromAlias ? 'tramite alias → ' : ''}${citationPreview}`,
            action: citationReady ? "Apri l'articolo" : 'Completa',
            run: handleCitationSearch,
          }
        : null;
  const readAsRow = readAs && (
    <Command.Group className="shrink-0 pt-2">
      <PaletteRow value="lettura del campo" onSelect={readAs.run} still={still} className="min-h-[56px] gap-3 text-base">
        <readAs.icon size={18} aria-hidden className="shrink-0 text-toga-700 dark:text-toga-300" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-ink-900 dark:text-ink-50">{readAs.text}</span>
          <span className="font-medium text-toga-700 dark:text-toga-300"> · {readAs.action} ↵</span>
        </span>
      </PaletteRow>
    </Command.Group>
  );

  // ── «Scegli l'atto» ─────────────────────────────────────────────────────────────────────────────
  // A decision or a norm read in the box is `readAs`'s row, which takes the columns' place.
  const noActLine = resolvingRemotely
    ? "Cerco l'atto… riconosco i nomi per esteso, non solo le sigle"
    : 'Nessun atto con questo nome';

  // The tour's second step points here (`#command-palette-results`): an id given to `Command.List` is
  // replaced by cmdk's own, so it lives on a container of ours.
  const actColumn = (
    <div id="command-palette-results">
      <div aria-hidden className={COLUMN_TITLE}>Scegli l'atto</div>
      {actGroups.length === 0 && <p className={QUIET_LINE}>{noActLine}</p>}
      {actGroups.map((group) => (
        <Command.Group
          key={group.heading}
          heading={group.heading}
          className={GROUP_WITH_HEADING}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {group.acts.map((act) => (
              <PaletteRow key={act.value} value={`atto ${act.value}`} onSelect={() => handleSelectAct(act.value)} still={still} entering>
                <span className="min-w-0 flex-1 line-clamp-2">
                  <span className="text-ink-900 dark:text-ink-50"><Matched text={act.name} query={inputValue} /></span>
                  {act.abbreviation && <span className={SUBTLE}> · <Matched text={act.abbreviation} query={inputValue} /></span>}
                </span>
              </PaletteRow>
            ))}
          </AnimatePresence>
        </Command.Group>
      ))}
    </div>
  );

  // ── «A portata di mano» ─────────────────────────────────────────────────────────────────────────
  const hiddenQuickNorms = typed ? 0 : quickNorms.length - visibleQuickNorms.length;
  const hiddenAliases = typed ? 0 : sortedAliases.length - visibleAliases.length;
  const atHandColumn = (
    <div>
      <div aria-hidden className={COLUMN_TITLE}>A portata di mano</div>

      {(!typed || visibleQuickNorms.length > 0) && (
        <Command.Group
          id="command-palette-quick-norms"
          heading="Preferiti"
          // The heading is as tall as «Gestisci» (44 px on a phone), which sits in it and covers no row.
          className={cn('relative', GROUP_WITH_HEADING, '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:min-h-[44px] [&_[cmdk-group-heading]]:items-end md:[&_[cmdk-group-heading]]:min-h-0')}
        >
          <button
            type="button"
            onClick={handleOpenQuickNormsManager}
            onKeyDown={keepKeys}
            className={cn('absolute right-1 top-0 inline-flex items-center rounded px-2 text-xs font-medium text-toga-700 hover:underline md:top-2 dark:text-toga-300', TOUCH_TARGET_RESPONSIVE, FOCUS_RING)}
          >
            Gestisci
          </button>
          {quickNorms.length === 0 ? (
            <p className={QUIET_LINE}>Nessun preferito: «Aggiungi alle norme rapide», nel menu ⋯ di un articolo, lo porta qui</p>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {visibleQuickNorms.map((qn) => (
                <PaletteRow key={qn.id} value={`preferito ${qn.id}`} onSelect={() => handleSelectQuickNorm(qn.id)} still={still} entering>
                  <Zap size={14} aria-hidden className="shrink-0 fill-amber-500 text-amber-600 dark:text-amber-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink-900 dark:text-ink-50"><Matched text={qn.label} query={inputValue} /></span>
                    <span className={cn('block truncate text-xs', SUBTLE)}>{paletteActName(qn.searchParams.act_type)}</span>
                  </span>
                </PaletteRow>
              ))}
            </AnimatePresence>
          )}
          {hiddenQuickNorms > 0 && (
            <PaletteRow value="preferiti tutti" onSelect={handleOpenQuickNormsManager} still={still} className="text-toga-700 dark:text-toga-300">
              Tutti i preferiti ({quickNorms.length})
            </PaletteRow>
          )}
        </Command.Group>
      )}

      {(!typed || visibleAliases.length > 0 || showAliasDoor) && (
        <Command.Group heading="I tuoi alias" className={GROUP_WITH_HEADING}>
          {/* At rest this line is the only trace the presets leave. */}
          {presetEntries.length > 0 && (
            <p className={cn('truncate px-3 pb-1 text-xs', SUBTLE)}>
              +{presetEntries.length} già pronti{presetHint && `: ${presetHint}…`}
            </p>
          )}
          <AnimatePresence initial={false} mode="popLayout">
          {visibleAliases.map((alias) => (
            <PaletteRow key={alias.id} value={`alias ${alias.id}`} onSelect={() => handleSelectAlias(alias)} still={still} entering>
              <Tag size={14} aria-hidden className={ROW_ICON} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-900 dark:text-ink-50"><Matched text={alias.trigger} query={inputValue} /></span>
                <span className={cn('block truncate text-xs', SUBTLE)}>→ {alias.expandTo}</span>
              </span>
            </PaletteRow>
          ))}
          </AnimatePresence>
          {/* The door to the manager. Rendered whatever the user owns, on purpose: gated on owning an
              alias, it hid the only way to make the first one. A row of the list, so typing «alias»
              finds it. */}
          {showAliasDoor && (
            <PaletteRow value="alias gestisci crea scorciatoie" onSelect={handleOpenAliasManager} still={still} className="text-toga-700 dark:text-toga-300">
              {hasAliases ? <Settings2 size={14} aria-hidden className="shrink-0" /> : null}
              <span className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                {hasAliases ? `Gestisci alias${hiddenAliases > 0 ? ` (${sortedAliases.length})` : ''}` : 'Crea un alias'}
              </span>
            </PaletteRow>
          )}
        </Command.Group>
      )}

      {/* Presets — only while the user is typing, under their own heading. */}
      {visiblePresets.length > 0 && (
        <Command.Group heading="In dotazione · non devi crearli" className={GROUP_WITH_HEADING}>
          <AnimatePresence initial={false} mode="popLayout">
          {visiblePresets.map(([trigger, preset]) => (
            <PaletteRow key={trigger} value={`preset ${trigger}`} onSelect={() => handleSelectPreset(trigger)} still={still} entering>
              <Library size={14} aria-hidden className={ROW_ICON} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-900 dark:text-ink-50"><Matched text={trigger} query={inputValue} /></span>
                <span className={cn('block truncate text-xs', SUBTLE)}>
                  → {[paletteActName(preset.act_type), preset.act_number && `n. ${preset.act_number}`, preset.date]
                    .filter(Boolean)
                    .join(' ')}
                </span>
              </span>
            </PaletteRow>
          ))}
          </AnimatePresence>
        </Command.Group>
      )}
    </div>
  );

  // ── The body of each step ───────────────────────────────────────────────────────────────────────
  // `relative`: a row filtered out pops out of the list (`popLayout`, absolute) against its own column, which clips it.
  const scrollColumn = isDesktop ? 'relative min-h-0 overflow-y-auto overscroll-contain custom-scrollbar pb-2' : 'relative pb-2';
  // «A portata di mano» has rows: something saved at rest, or a match while typing.
  const atHandHasRows = typed
    ? visibleQuickNorms.length > 0 || visibleAliases.length > 0 || showAliasDoor || visiblePresets.length > 0
    : quickNorms.length > 0 || hasAliases;
  const selectBody = (
    <Command.List
      // `min-h-0`: in a panel as tall as its content, up to its maximum, the list may shrink below its rows — the
      // columns then scroll — instead of holding the panel at its full length. A flex column all the way down (a percentage height finds nothing definite in a panel sized by its content).
      className={cn('px-2', isDesktop && 'flex min-h-0 flex-1 flex-col [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:min-h-0 [&>[cmdk-list-sizer]]:flex-1 [&>[cmdk-list-sizer]]:flex-col')}
    >
      {/* A topic, not a decision or a norm: its own line, over the two columns */}
      {topic && (
        <Command.Group className="shrink-0 pt-2">
          <PaletteRow value={`cerca-sentenze ${topic}`} onSelect={handleSearchTopic} still={still}>
            <Gavel size={14} aria-hidden className="shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span className="min-w-0 flex-1 truncate font-medium">
              Cerca "{topic}" nelle sentenze della Cassazione
            </span>
          </PaletteRow>
        </Command.Group>
      )}
      {topic && rassegne?.answer === 'error' && (
        <Command.Group heading="Rassegne" className={cn('shrink-0', GROUP_WITH_HEADING)}>
          <p className={QUIET_LINE}>Le rassegne non rispondono al momento.</p>
        </Command.Group>
      )}
      {topic && rassegnePage && (
        <Command.Group heading="Rassegne" className={cn('shrink-0', GROUP_WITH_HEADING)}>
          {rassegnePage.items.slice(0, 3).map((passo) => (
            <PaletteRow key={passo.id} value={`rassegna ${passo.id}`} onSelect={() => handleOpenRassegne(passo.id)} still={still}>
              <BookOpen size={14} aria-hidden className={ROW_ICON} />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-xs', SUBTLE)}>{provenance(passo).split(' › ')[0]}</span>
                <span className="line-clamp-2">{passo.testo}</span>
              </span>
            </PaletteRow>
          ))}
          <PaletteRow value="rassegne tutti i passi" onSelect={() => handleOpenRassegne()} still={still}>
            <List size={14} aria-hidden className={ROW_ICON} />
            <span className="min-w-0 flex-1 font-medium">Tutti i passi</span>
            <span className={cn('shrink-0 text-xs', SUBTLE)}>{rassegnePage.total.toLocaleString('it-IT')}</span>
          </PaletteRow>
        </Command.Group>
      )}
      {readAs ? (
        <>
          {readAsRow}
          {/* Under it, only what still matches (a favourite «Art. 2043 c.c.», an alias, an act), in one column. */}
          <motion.div layoutScroll className={cn(scrollColumn, isDesktop && 'flex-1')}>
            {atHandHasRows && atHandColumn}
            {actGroups.length > 0 && actColumn}
          </motion.div>
        </>
      ) : (
        <div className={cn(isDesktop ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-2' : 'flex flex-col')}>
          {/* The order drawn is the keyboard's. On a computer the acts come first: the row chosen as the menu
              opens is the first act. On a phone «A portata di mano» comes first when it holds something, so a
              favourite is not under forty acts. */}
          {!isDesktop && atHandHasRows && <motion.div layoutScroll className={scrollColumn}>{atHandColumn}</motion.div>}
          <motion.div layoutScroll className={scrollColumn}>{actColumn}</motion.div>
          {(isDesktop || !atHandHasRows) && (
            <motion.div layoutScroll className={cn(scrollColumn, isDesktop && 'border-l border-ink-100 pl-2 dark:border-ink-800')}>{atHandColumn}</motion.div>
          )}
        </div>
      )}
    </Command.List>
  );

  const detailsBody = (
    <div className="space-y-3 px-4 py-4" onKeyDown={keepKeys}>
      <p className="text-sm text-ink-700 dark:text-ink-200">
        Stai consultando: <span className="font-medium text-ink-900 dark:text-ink-50">{selectedActLabel}</span>
      </p>
      {step === 'input_article' && actNumber && actDate && (
        <p className={cn('text-xs', SUBTLE)}>{selectedActLabel} n. {actNumber} del {actDate}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={step === 'input_details' ? handleSubmitDetails : handleSubmitArticle}
          disabled={step === 'input_details' ? (!actNumber || !actDate) : !article}
        >
          {step === 'input_details' ? 'Continua' : "Apri l'articolo"}
        </Button>
        {/* The other door: leave with the act's index instead of one article. Offered on the
            article step, where the act (and its details, when required) is already settled. */}
        {step === 'input_article' && onBrowseStructure && (
          <Button type="button" variant="secondary" icon={<List size={16} aria-hidden />} onClick={handleBrowse}>
            Apri l'indice e sfoglia
          </Button>
        )}
      </div>
    </div>
  );

  const body = (
    <motion.div
      key={step}
      {...stepMotion}
      className={cn(isDesktop ? 'flex min-h-0 flex-1 flex-col' : 'flex-1')}
    >
      {step === 'select_act' ? selectBody : detailsBody}
    </motion.div>
  );

  // ── «Filtri avanzati» and the keys ──────────────────────────────────────────────────────────────
  const filtersBlock = (
    <div className="shrink-0 border-t border-ink-100 dark:border-ink-800" onKeyDown={keepKeys}>
      <button
        type="button"
        onClick={() => setShowAdvancedFilters(value => !value)}
        aria-expanded={showAdvancedFilters}
        aria-controls={showAdvancedFilters ? 'command-palette-filters' : undefined}
        className={cn('flex w-full items-center justify-between gap-3 px-4 text-sm', 'min-h-[44px] md:min-h-10', FOCUS_RING)}
      >
        <span className="flex items-center gap-2 font-medium text-ink-800 dark:text-ink-100">
          <SlidersHorizontal size={14} aria-hidden />
          Filtri avanzati
        </span>
        <span className={cn('flex items-center gap-1 text-xs', activeFilters > 0 ? 'font-medium text-toga-700 dark:text-toga-300' : SUBTLE)}>
          {activeFiltersLabel(filters)}
          <ChevronDown size={14} aria-hidden className={cn('transition-[rotate] duration-150 motion-reduce:transition-none', showAdvancedFilters && 'rotate-180')} />
        </span>
      </button>
      {showAdvancedFilters && (
        <div id="command-palette-filters" className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 pb-3 text-xs">
          <label className={cn('flex flex-col gap-1', SUBTLE)}>
            Fonte
            <select
              value={filters.source}
              onChange={(event) => setFilters(previous => ({ ...previous, source: event.target.value as SearchFilters['source'] }))}
              className={SMALL_INPUT}
            >
              <option value="all">Tutte le fonti</option>
              <option value="normattiva">Normattiva</option>
              <option value="eurlex">EUR-Lex</option>
            </select>
          </label>
          <label className={cn('flex flex-col gap-1', SUBTLE)}>
            Dall'anno
            <input type="number" inputMode="numeric" placeholder="1990" value={filters.yearFrom ?? ''} onChange={(event) => setFilters(previous => ({ ...previous, yearFrom: event.target.value ? Number(event.target.value) : undefined }))} className={cn(SMALL_INPUT, 'w-24')} />
          </label>
          <label className={cn('flex flex-col gap-1', SUBTLE)}>
            All'anno
            <input type="number" inputMode="numeric" placeholder="2024" value={filters.yearTo ?? ''} onChange={(event) => setFilters(previous => ({ ...previous, yearTo: event.target.value ? Number(event.target.value) : undefined }))} className={cn(SMALL_INPUT, 'w-24')} />
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink-800 md:min-h-9 dark:text-ink-100">
            <input type="checkbox" className="size-4 accent-toga-600" checked={filters.onlyHistorical} onChange={(event) => setFilters(previous => ({ ...previous, onlyHistorical: event.target.checked }))} />
            Solo versioni storiche
          </label>
        </div>
      )}
    </div>
  );

  // The keys, on a computer only: a phone has none of them.
  const keysRow = isDesktop && (
    <div className={cn('flex shrink-0 items-center gap-4 border-t border-ink-100 px-4 py-2 text-xs dark:border-ink-800', SUBTLE)}>
      <span><kbd className="font-sans font-medium text-ink-800 dark:text-ink-100">↑↓</kbd> Naviga</span>
      <span><kbd className="font-sans font-medium text-ink-800 dark:text-ink-100">↵</kbd> Seleziona</span>
      <span><kbd className="font-sans font-medium text-ink-800 dark:text-ink-100">Esc</kbd> Chiudi</span>
    </div>
  );

  const content = (
    <ChosenRowScope.Provider value={inputValue}>
    <Command
      id="command-menu-root"
      label="Menu di ricerca"
      shouldFilter={false}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0">
        {/* One live region for the whole life of the palette, its text changing: a region that
            appears already holding its text is often not announced. */}
        <p role="status" className="sr-only">
          {decisionRef
            ? `Sentenza: ${formatDecisionShort(decisionRef)}. Invio per aprire.`
            : waiting ? 'Cerco l’atto… la ricerca parte appena lo trovo.'
            : parsedCitation && citationPreview
              ? `${preview!.text}${preview!.text.endsWith('.') ? '' : '.'} ${citationReady ? 'Premi Invio per cercare.' : 'Premi Invio per completare.'}`
              : resolvingRemotely
                ? 'Cerco l’atto…'
                : topic ? `Cerca "${topic}" nelle sentenze della Cassazione.` : ''}
        </p>
        {fieldRow}
        {fieldLine}
      </div>
      {isDesktop ? (
        <>
          {body}
          {filtersBlock}
          {keysRow}
        </>
      ) : (
        // On a phone the field stays at the top and the rest scrolls under it.
        <motion.div layoutScroll className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {body}
          {filtersBlock}
        </motion.div>
      )}
    </Command>
    </ChosenRowScope.Provider>
  );

  return (
    <FloatingPortal>
      {/* Covers the workspace: Cmd/Ctrl+F is left to the browser (`isWorkspaceCovered`). Drawn only while open, so the
          mark goes with the click that closes, not with the veil's fade. */}
      {isOpen && <span data-find-overlay="" hidden />}
      {/* The veil rises and falls with the island, by the same times and curves (LC69). */}
      <AnimatePresence>{isOpen && <IslandVeil key="command-palette-veil" onClick={onClose} />}</AnimatePresence>
      {/* Outside the presence, so the focus goes back as the palette closes, not once its fade is over. */}
      <FloatingFocusManager
        context={context}
        modal
        disabled={!isOpen}
        initialFocus={step === 'select_act' ? boxRef : 0}
        // Nothing had it (⌘K on the page): the field when it is there, else nowhere — never the page's first control.
        returnFocus={opener && opener !== document.body ? { current: opener } : anchor !== null}
      >
      <AnimatePresence>
        {isOpen && (
          // Two elements: the outer is placed by floating-ui, the inner moves (gotcha 10).
          <div
            key="command-palette"
            ref={refs.setFloating}
            {...getFloatingProps()}
            aria-label="Menu di ricerca"
            style={anchor
              ? floatingStyles
              : !isDesktop && shownHeight
                ? { ['--palette-max-h' as string]: `min(40rem, calc(${shownHeight}px - 1rem - env(safe-area-inset-top)))` }
                : undefined}
            className={cn(
              // The box holds the panel's height; only the panel takes the pointer (a shorter step
              // leaves the rest of the box to the backdrop's click).
              'pointer-events-none flex flex-col',
              anchor
                ? 'fixed'
                : isDesktop
                  ? 'fixed inset-x-4 top-16 mx-auto max-w-3xl [--palette-max-h:min(40rem,calc(100dvh-6rem))]'
                  // A phone: the page's width less 16 px each side, dropping from the bar at the top (R2).
                  : 'fixed inset-x-4 top-[calc(env(safe-area-inset-top)+0.5rem)] [--palette-max-h:min(40rem,calc(100dvh-1rem-env(safe-area-inset-top)))]',
              Z_INDEX.commandPalette,
            )}
          >
            {/* The panel grows out of the pill or the field it opens from (LC69, one way for both). As tall as its content,
                up to `--palette-max-h`: the lists scroll inside it past that. */}
            <IslandPanel still={still} source={growSource} className="pointer-events-auto flex min-h-0 max-h-[var(--palette-max-h,40rem)] flex-col">
              {content}
            </IslandPanel>
          </div>
        )}
      </AnimatePresence>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
