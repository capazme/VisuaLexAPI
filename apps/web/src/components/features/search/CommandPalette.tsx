import { createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useState, useSyncExternalStore, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from 'react';
import { Command, useCommandState } from 'cmdk';
import { autoUpdate, FloatingFocusManager, FloatingPortal, offset, size, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { motion, AnimatePresence, useIsPresent, usePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight, Gavel, List, Search, Settings2, SlidersHorizontal, Sparkles, Tag, X, Zap } from 'lucide-react';
import type { SearchParams, CustomAlias, SearchFilters } from '../../../types';
import { cn } from '../../../lib/utils';
import { dur, ease, spring } from '../../../lib/motion';
import { parseItalianDate } from '../../../utils/dateUtils';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useTour } from '../../../hooks/useTour';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { ACT_TYPES_REQUIRING_DETAILS } from '../../../constants/actTypes';
import { useAliasCatalog, foldAlias } from '../../../hooks/useAliasCatalog';
import { Z_INDEX } from '../../../constants/zIndex';
import { FIELD_TEXT, FOCUS_RING, TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { activeFiltersLabel, countActiveFilters, defaultSearchFilters } from '../../../utils/searchFilters';
import { SEARCH_FIELD_FORM_ID, returnWordsToSearchField } from '../../../utils/searchFieldControl';
import { citationSearchParams, useSearchQuery } from '../../../hooks/useSearchQuery';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import { Button } from '../../ui/Button';
import { isTopmostDialog, openDialog } from '../../ui/dialogStack';
import { filterPaletteActs, paletteActName, queryMatches, matchRanges } from './paletteActs';

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
  const wanted = (actValue || '').toLowerCase();
  return ACT_TYPES_REQUIRING_DETAILS.some(v => v.toLowerCase() === wanted);
}

// One row of the lists: 44 px, a colour change when chosen, never a lift (UI conventions).
const ROW = 'relative isolate flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-800 dark:text-ink-100';
const ROW_ICON = 'shrink-0 text-ink-500 dark:text-ink-400';
const SUBTLE = 'text-ink-600 dark:text-ink-400';
// A group's heading, drawn by cmdk (`heading`), which also names the group for a screen reader.
const GROUP_WITH_HEADING = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-600 dark:[&_[cmdk-group-heading]]:text-ink-400';
const COLUMN_TITLE = 'px-3 pt-3 font-serif text-base font-medium text-ink-900 dark:text-ink-50';
const QUIET_LINE = 'px-3 py-2 text-sm text-ink-600 dark:text-ink-400';
const FIELD_INPUT = cn(
  'h-11 w-full min-w-0 rounded-lg border border-ink-200 bg-white px-3 text-ink-900 placeholder:text-ink-500',
  FIELD_TEXT,
  'dark:border-ink-700 dark:bg-ink-950 dark:text-ink-50 dark:placeholder:text-ink-400',
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
  // A tint and an edge in toga: the tint alone is too faint a mark for the row in use.
  const tint = cn(
    'absolute inset-0 -z-10 rounded-lg bg-ink-100 dark:bg-ink-800',
    'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-toga-600 dark:before:bg-toga-300',
  );
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

/** The search field's corner radius (`rounded-xl`) and the panel's (`rounded-2xl`): the growth goes from one to the other. */
const FIELD_RADIUS = 12;
const PANEL_RADIUS = 16;
/** The growth: about 280 ms opening, 200 ms closing (the brief's), on the app's curves; no bounce. */
const GROW_S = 0.28;
const SHRINK_S = 0.2;
/** The groups entering: the first four, 30 ms apart, from when the panel is half grown. */
const GROUPS_ENTERING = 4;
const GROUP_STAGGER_MS = 30;
const GROUPS_AT_MS = 140;

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
 * The panel growing out of the search page's field (R2), inspired by Animorio's «menu dei comandi», written from
 * scratch with Web Animations and Framer Motion: the same place and width, the height uncovered from the field's down
 * to the panel's (`clip-path`, the corners from the field's to a card's), then the clip goes and the card's shadow
 * shows; the content fades in as it grows. Closing, the same way back (`usePresence`); opened again meanwhile, it grows
 * back from where the closing was. Under reduced motion it only fades.
 */
function PanelGrowth({ still, fromHeight, className, children }: { still: boolean; fromHeight: number; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isPresent, safeToRemove] = usePresence();
  // `safeToRemove` is a new function at every render: kept here, it does not start the closing again (one closing,
  // one animation).
  const remove = useRef(safeToRemove);
  useEffect(() => {
    remove.current = safeToRemove;
  });
  // The closing on its way (or just finished, its end held), for a new opening to take over from where it is.
  const closing = useRef<Animation | null>(null);
  // An opening whose growth has not started yet (a close or StrictMode's second run before its first frames): when
  // the panel comes back it is still an opening, with its groups' entrance, though a clip is already set.
  const opening = useRef(false);
  // The part hidden at the bottom, as a share of the panel and a length: the panel's own height is set by floating-ui
  // after it mounts, so it is never measured here. One template, so the two ends interpolate.
  const clipFor = (share: number, px: number, radius: number) => `inset(0px 0px calc(${share}% - ${px}px) 0px round ${radius}px)`;
  const asField = clipFor(100, fromHeight, FIELD_RADIUS);
  const asPanel = clipFor(0, 0, PANEL_RADIUS);
  const curve = `cubic-bezier(${ease.out.join(', ')})`;
  // Web Animations with no fill: once over, nothing holds the clip (the shadow outside it shows), and a closing
  // interrupted by a new opening starts from where it was. (A DOM without them, a test's, draws the panel at once.)
  const canAnimate = (el: HTMLElement) => typeof el.animate === 'function';

  // Growing: from the field on an opening; from where a closing was, when the panel comes back before it went.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !isPresent) return;
    el.style.pointerEvents = '';
    // Coming back before it went (the layout effects run before the closing's cleanup), or before its removal once
    // it ended: from where the closing is.
    let left: { clipPath: string; opacity: string } | null = null;
    if (closing.current) {
      const now = getComputedStyle(el);
      left = { clipPath: now.clipPath, opacity: now.opacity };
      closing.current.onfinish = null;
      closing.current.cancel();
      closing.current = null;
    }
    if (still) {
      el.style.clipPath = '';
      opening.current = false;
      const fade = canAnimate(el)
        ? el.animate([{ opacity: left ? Number(left.opacity) : 0 }, { opacity: 1 }], { duration: dur.pop * 1000, easing: curve })
        : null;
      return () => fade?.cancel();
    }
    if (left && left.clipPath && left.clipPath !== 'none') el.style.clipPath = left.clipPath;
    // An opening (nothing left by a closing or a growth cut short): set before the first paint, or the panel would
    // flash open meanwhile.
    const held = el.style.clipPath && el.style.clipPath !== 'none' ? el.style.clipPath : '';
    const isOpening = opening.current || !held;
    const from = held || asField;
    if (!canAnimate(el)) {
      el.style.clipPath = '';
      return;
    }
    el.style.clipPath = from;
    opening.current = isOpening;
    // Started once the first frame is drawn: mounting the menu's rows is a long frame, and an animation started before
    // it would run its time out unseen, the panel appearing whole — and so is the render that brings it back during a
    // closing: started there, it was nine tenths over by the first frame drawn.
    let grow: Animation | null = null;
    let groups: Animation[] = [];
    const start = () => {
      // The groups come one after the other as it grows: the first four, 30 ms apart, rising 4 px — on an opening only.
      opening.current = false;
      groups = isOpening
        ? [...el.querySelectorAll<HTMLElement>('[cmdk-group]')].slice(0, GROUPS_ENTERING).map((group, i) =>
          group.animate(
            [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
            { duration: dur.pop * 1000, delay: GROUPS_AT_MS + i * GROUP_STAGGER_MS, easing: curve, fill: 'backwards' },
          ))
        : [];
      grow = el.animate([{ clipPath: from }, { clipPath: asPanel }], { duration: GROW_S * 1000, easing: curve });
      // Grown, the clip goes: the card's own shadow shows.
      grow.onfinish = () => {
        el.style.clipPath = '';
      };
    };
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(start);
    });
    return () => {
      cancelAnimationFrame(frame);
      // Cut short (a closing, mid-growth): the closing starts from here, not from the field or the full panel.
      if (grow?.playState === 'running') el.style.clipPath = getComputedStyle(el).clipPath;
      if (grow) {
        grow.onfinish = null;
        grow.cancel();
      }
      groups.forEach((animation) => animation.cancel());
    };
    // Once per opening (or coming back): the panel's own re-renders do not grow it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the field's height is read as it opens
  }, [still, isPresent]);

  // Closing: the same way back, from where it is (a growth cut short included); it takes no pointer meanwhile.
  useEffect(() => {
    if (isPresent) return;
    const el = ref.current;
    if (!el || !canAnimate(el)) {
      remove.current?.();
      return;
    }
    el.style.pointerEvents = 'none';
    const now = getComputedStyle(el).clipPath;
    const run = still
      ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur.press * 1000, fill: 'forwards' })
      : el.animate([{ clipPath: now && now !== 'none' ? now : asPanel }, { clipPath: asField }], { duration: SHRINK_S * 1000, easing: `cubic-bezier(${ease.inOut.join(', ')})`, fill: 'forwards' });
    // Its end is held (`forwards`) until the panel goes: kept in the ref, so a panel brought back before its removal
    // drops it (a finished closing left on it would clip the panel to the field once the new growth is over).
    run.onfinish = () => remove.current?.();
    closing.current = run;
    return () => {
      // Taken over by a new opening already (see the growth: a second cancel does nothing), or gone with the panel.
      run.onfinish = null;
      run.cancel();
      if (closing.current === run) closing.current = null;
    };
    // Once per closing: the field's height and the curves are read as it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `asField`/`asPanel` are strings rebuilt each render
  }, [isPresent, still]);

  return (
    <div ref={ref} className={cn('rounded-2xl shadow-lg', className)}>
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: dur.press, delay: still ? 0 : 0.04, ease: ease.out } }}
      >
        {children}
      </motion.div>
    </div>
  );
}

export function CommandPalette({ isOpen, onClose, onSearch, onBrowseStructure, onShowSearch }: CommandPaletteProps) {
  const {
    quickNorms, selectQuickNorm, settings, openQuickNormsManager,
    customAliases, trackAliasUsage, openAliasManager, openDecision, openTopicSearch, takeCommandPaletteQuery, commandPaletteQuery
  } = useAppStore(useShallow(s => ({
    quickNorms: s.quickNorms,
    selectQuickNorm: s.selectQuickNorm,
    settings: s.settings,
    openQuickNormsManager: s.openQuickNormsManager,
    customAliases: s.customAliases,
    trackAliasUsage: s.trackAliasUsage,
    openAliasManager: s.openAliasManager,
    openDecision: s.openDecision,
    openTopicSearch: s.openTopicSearch,
    takeCommandPaletteQuery: s.takeCommandPaletteQuery,
    commandPaletteQuery: s.commandPaletteQuery,
  })));
  // The box is focused as the palette opens; the first-open tour (driver.js, started 300 ms later)
  // can take that focus, so when the tour ends the box gets it back. Only if the box is still there:
  // the ref is empty once the palette has closed or moved on to another step.
  const boxRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
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

  const handleOpenQuickNormsManager = useCallback(() => {
    done();
    // Small delay to let the palette close before opening manager
    setTimeout(() => openQuickNormsManager(), 100);
  }, [done, openQuickNormsManager]);

  const handleOpenAliasManager = useCallback(() => {
    done();
    setTimeout(() => openAliasManager(), 100);
  }, [done, openAliasManager]);

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
  const anchor = field?.isConnected ? field : null;
  // The height the panel grows from: the field's, where it grows out of it; a field's height elsewhere (a phone's bar).
  const growFrom = anchor?.offsetHeight || 44;
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
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    elements: { reference: anchor },
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [
      // Its top on the field's: the panel's own box takes the field's place.
      offset(({ rects }) => -rects.reference.height),
      // As wide as the field; as tall as what it holds, up to the height it always had (Bill: one row is not a
      // 640 px panel), the window allowing.
      size({
        padding: 16,
        apply({ rects, availableHeight, elements }) {
          elements.floating.style.width = `${rects.reference.width}px`;
          elements.floating.style.setProperty('--palette-max-h', `${Math.min(PANEL_MAX_HEIGHT, Math.max(320, availableHeight))}px`);
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  // The field gone while the menu is open (another page, Focus mode): what `size` wrote on the box goes with it, or
  // the panel hung at the top would keep the field's width and height.
  useLayoutEffect(() => {
    if (anchor || !isDesktop) return;
    const box = refs.floating.current;
    box?.style.removeProperty('width');
    box?.style.removeProperty('--palette-max-h');
  }, [anchor, isDesktop, refs]);
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
          // The field's border carries the focus ring (`focus-within`); the box inside draws none, or the
          // global `input:focus-visible` ring would stand out around it, over the icon.
          <div className={cn(
            'flex h-12 min-w-0 flex-1 items-center gap-3 rounded-lg border border-ink-200 bg-white px-3',
            'focus-within:border-toga-500 focus-within:ring-2 focus-within:ring-toga-500/30',
            'dark:border-ink-700 dark:bg-ink-950 dark:focus-within:border-toga-400',
          )}>
            <Search size={20} aria-hidden className="shrink-0 text-ink-500 dark:text-ink-400" />
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
              placeholder="Atto o citazione, es. art 2043 cc"
              // 18 px, and never under 16 px: with the text size «piccolo» `text-lg` was 15.75 px, and Safari on an
              // iPhone zooms into a field under 16 px (`FIELD_TEXT`).
              className="h-full w-full min-w-0 bg-transparent text-[length:max(1.125rem,16px)] font-medium text-ink-900 outline-none placeholder:font-normal placeholder:text-ink-500 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-50 dark:placeholder:text-ink-400"
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
        className={cn('inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100', FOCUS_RING)}
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );

  // The help line, or what the box was read as, 10 px under the field and on the line of its text: the
  // field's edge (12 px of row, 1 of border, 12 of padding), then on the first step the icon's 20 px and
  // the gap's 12. The visible line is aria-hidden: the status region says it.
  // The line under the box says what no row says: the wait for the server. A decision, a norm or a topic read in the
  // box is its row, the chosen one, with «↵» — a second line saying the same was one too many (Bill).
  const lineSays = step === 'select_act' && preview && (waiting || resolvingRemotely) ? preview : null;
  const fieldLine = (
    <div aria-hidden className="flex min-h-5 items-center gap-3 pb-3 pl-[25px] pr-4 pt-2.5 text-xs">
      {step === 'select_act' && (
        <span className="flex w-5 shrink-0 justify-center">
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
            <p className={QUIET_LINE}>Nessun preferito: il fulmine su un articolo lo aggiunge qui</p>
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
              <Sparkles size={14} aria-hidden className={ROW_ICON} />
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
      {/* Covers the workspace: Cmd/Ctrl+F is left to the browser (`isWorkspaceCovered`). Drawn only while
          open, so the mark goes with the click that closes, not with the panel's fade. */}
      {isOpen && (
        <div
          data-find-overlay=""
          aria-hidden
          // `touch-none`: a drag on it does not scroll the page under it (iOS).
          className={cn('fixed inset-0 touch-none bg-ink-950/20 dark:bg-ink-950/50', Z_INDEX.commandPalette)}
          onClick={onClose}
        />
      )}
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
            // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
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
            {/* The field grows into the panel (R2): `PanelGrowth`. As tall as its content, up to `--palette-max-h`: the
                lists scroll inside it past that. */}
            <PanelGrowth still={still} fromHeight={growFrom} className="pointer-events-auto flex min-h-0 max-h-[var(--palette-max-h,40rem)] flex-col overflow-hidden border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900">
              {content}
            </PanelGrowth>
          </div>
        )}
      </AnimatePresence>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
