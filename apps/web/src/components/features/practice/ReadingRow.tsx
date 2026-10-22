import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FOCUS_RING } from '../../../constants/interactions';
import { Z_INDEX } from '../../../constants/zIndex';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { FIND_WINDOW_ESTIMATED_HEIGHT, FIND_WINDOW_MARGIN, FIND_WINDOW_WIDTH, setFindWindowDefaultPlace } from '../../../utils/findWindowControl';
import { MAX_BESIDE, practiceCounts, type BesideRef, type Practice } from '../../../utils/practice';
import { workspaceOrigin } from '../../../utils/workspaceOrigin';
import { RAIL_WIDTH, besideLayout } from './besideLayout';
import { PracticeTable, type PracticeTableProps } from './PracticeTable';
import { ReadingWindow } from './ReadingWindow';
import { scrollParentOf } from './practiceView';

const NO_WINDOWS: BesideRef[] = [];

/** The gap, in pixels, between two pinned elements still read as one stack (`space-y-3` is 12). */
const PINNED_GAP = 16;

/** The practice header, the first act's heading and the pinned reading bar. */
const FIRST_GROUP = 3;

const OVERLAY_ID = 'reading-row-overlay';

/** A row's column is as tall as the viewport less the margins above and below it, and holds its
 *  place while the table beside it scrolls (the windows are in-flow columns, spec §4). */
const COLUMN_FRAME = 'sticky top-4 h-app-row flex-none';

/**
 * The row's width, kept current by a `ResizeObserver`, and — when `wide` — how far past its parent
 * it may reach on each side. The search page holds the results area to `ReaderLayout`'s `max-w-5xl`
 * (about 960 px of content), under the 1260 px that three columns need; with a window beside, the row takes the scroller's full width (less the
 * gutter the page keeps), measured here rather than assumed, and only for this row: Layout and the
 * other routes are untouched. Before it is measured, the results area's width.
 */
function useRowWidth(ref: RefObject<HTMLElement | null>, wide: boolean): { width: number; overshoot: number } {
  const [width, setWidth] = useState(() => workspaceOrigin().width);
  const [overshoot, setOvershoot] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    const scroller = wide ? scrollParentOf(el) : null;
    const measure = () => {
      const measured = el.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
      if (!wide || !parent || !scroller) {
        setOvershoot(0);
        return;
      }
      const gutter = parseFloat(getComputedStyle(scroller.firstElementChild ?? scroller).paddingLeft) || 0;
      const usable = scroller.clientWidth - 2 * gutter;
      setOvershoot(Math.max(0, Math.round(usable - parent.getBoundingClientRect().width)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (parent) observer.observe(parent);
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, [ref, wide]);
  return { width, overshoot };
}

/**
 * The practice's table with its windows beside it, in the results area (spec §4). The widths are
 * `besideLayout`'s, from the area's own width: half and half with one window, thirds with two, and
 * with two on a narrow area the table folds into a rail that opens it as an overlay over the
 * windows. Only the active practice's windows are drawn: switching practice hides them, returning
 * shows them (D9). Gives the find window its default place, clear of the windows' headers (§4.4).
 */
export function ReadingRow(props: PracticeTableProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.activePracticeId));
  const revealPending = useAppStore((s) => s.pendingReveal?.practiceId === s.activePracticeId);
  const windows = practice?.beside ?? NO_WINDOWS;
  const count = Math.min(windows.length, MAX_BESIDE) as 0 | 1 | 2;

  const rootRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { width, overshoot } = useRowWidth(rootRef, count > 0);
  const layout = besideLayout(width, count);
  const isRail = layout.table === 'rail';

  // The rail's overlay is open for one practice and one set of windows: switching practice, a layout
  // that has room for the table again, or a window opening or closing (an «Apri accanto» pressed in
  // the overlay itself) closes it; so does a window being asked to take focus (a folded row's header,
  // an index chip of an article shown beside), or the overlay would stay open over the window it sent
  // focus to. A row revealed while the table is folded opens it, so the reveal (a search that landed,
  // an index pick) is not made out of sight.
  const windowsKey = practice ? `${practice.id}#${windows.map((w) => w.id).join('|')}` : null;
  const focusNamesWindow = useAppStore((s) => s.windowFocusRequest !== null && windows.some((w) => w.id === s.windowFocusRequest));
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (openFor !== null && (!isRail || openFor !== windowsKey || focusNamesWindow)) setOpenFor(null);
  else if (isRail && windowsKey && revealPending && !focusNamesWindow && openFor !== windowsKey) setOpenFor(windowsKey);
  const overlayOpen = isRail && windowsKey !== null && openFor === windowsKey;

  useEffect(() => {
    if (!overlayOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A dialog opened from the table (a confirmation) takes this Esc; the overlay stays under it.
      if (document.querySelector('[aria-modal="true"]')) return;
      setOpenFor(null);
      railButtonRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || overlayRef.current?.contains(target) || railButtonRef.current?.contains(target)) return;
      // What the table's own controls open outside it (a confirmation, a menu, the structure window,
      // the find window) is part of the overlay's use, not a click away from it.
      if (target.closest('[role="dialog"], [aria-modal="true"], [role="menu"], [data-floating-tool]')) return;
      setOpenFor(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [overlayOpen]);

  // Opened by the reader on the rail, the overlay takes the focus (its first control); one a reveal
  // opened does not steal it.
  const focusOnOpenRef = useRef(false);
  useEffect(() => {
    if (!overlayOpen || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    const overlay = overlayRef.current;
    (overlay?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? overlay)?.focus();
  }, [overlayOpen]);

  // The find window's default place (spec §4.4), asked when it opens: right-aligned in its target
  // column and under whatever is pinned at the column's top, never over a control: the practice
  // header, the first act's heading (sticky from `md`), an open row's reading toolbar pinned under it
  // (all marked `data-pinned-head`), and every window's header. The target is the table's column
  // (with or without windows), or the first window's body when the table is a rail.
  const railRef = useRef(isRail);
  useEffect(() => {
    railRef.current = isRail;
  });
  useEffect(() => {
    setFindWindowDefaultPlace(() => {
      const root = rootRef.current;
      if (!root) return null;
      const rail = railRef.current;
      const column = (rail ? root.querySelector('[data-reading-window-body]') : tableRef.current)?.getBoundingClientRect();
      if (!column) return null;
      let bottom = Math.max(column.top, 0);
      for (const header of root.querySelectorAll('[data-reading-window-header]')) {
        bottom = Math.max(bottom, header.getBoundingClientRect().bottom);
      }
      // The pinned stack, followed from the top: each element that starts where the last one ends
      // (a few pixels of gap allowed) is under the window's way.
      const target = rail ? root.querySelector('[data-reading-window-body]') : tableRef.current;
      const pinned = [...(target?.querySelectorAll('[data-pinned-head]') ?? [])]
        .map((el) => el.getBoundingClientRect())
        .sort((x, y) => x.top - y.top);
      const base = bottom;
      const stack: DOMRect[] = [];
      for (const rect of pinned) {
        if (rect.top <= bottom + PINNED_GAP && rect.bottom > bottom) {
          stack.push(rect);
          bottom = rect.bottom;
        }
      }
      // A stack so deep that the window would run off the screen (several acts folded one under the
      // other, each heading pinned): only the first group counts — the practice header, the first
      // act's heading and the pinned bar — and the window may sit over the headings below them.
      if (bottom + 8 + FIND_WINDOW_ESTIMATED_HEIGHT > window.innerHeight) {
        bottom = stack.slice(0, FIRST_GROUP).reduce((low, rect) => Math.max(low, rect.bottom), base);
      }
      return { x: Math.max(column.left, column.right - FIND_WINDOW_WIDTH - FIND_WINDOW_MARGIN), y: bottom + 8 };
    });
    return () => setFindWindowDefaultPlace(null);
  }, []);

  const tableWidth = layout.table === 'rail' ? undefined : layout.table;

  return (
    <div
      ref={rootRef}
      data-testid="reading-row"
      className="relative flex w-full items-start"
      // Past the page's cap on both sides, centred, while a window is beside.
      style={overshoot > 0 ? { marginInline: -overshoot / 2, width: `calc(100% + ${overshoot}px)` } : undefined}
    >
      {isRail ? (
        practice && (
          <div data-testid="reading-row-rail" className={COLUMN_FRAME} style={{ width: RAIL_WIDTH }}>
            <button
              ref={railButtonRef}
              type="button"
              aria-expanded={overlayOpen}
              aria-controls={OVERLAY_ID}
              aria-label={`Pratica ${practice.label}`}
              title={practice.label}
              onClick={() => {
                focusOnOpenRef.current = !overlayOpen;
                setOpenFor(overlayOpen ? null : windowsKey);
              }}
              data-testid="practice-rail"
              className={cn(
                'flex h-full w-full flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                FOCUS_RING,
              )}
            >
              <RailCount practice={practice} />
              <span aria-hidden className="text-sm font-medium [writing-mode:vertical-rl]">Pratica</span>
            </button>
          </div>
        )
      ) : (
        <div
          ref={tableRef}
          data-testid="reading-row-table"
          className={cn('min-w-0', count === 0 ? 'w-full' : 'flex-none pr-4')}
          style={count === 0 ? undefined : { width: tableWidth }}
        >
          <PracticeTable {...props} />
        </div>
      )}
      {overlayOpen && (
        <div
          ref={overlayRef}
          id={OVERLAY_ID}
          tabIndex={-1}
          role="region"
          aria-label={`Pratica ${practice?.label ?? ''}`}
          data-testid="reading-row-overlay"
          style={{ left: RAIL_WIDTH, width: `min(56rem, calc(100% - ${RAIL_WIDTH}px))` }}
          className={cn(
            'absolute top-0 h-app-row overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900',
            Z_INDEX.dropdown,
          )}
        >
          <PracticeTable {...props} />
        </div>
      )}
      {practice && windows.slice(0, MAX_BESIDE).map((ref, index) => (
        <div
          key={ref.id}
          data-testid="reading-row-window"
          className={cn(COLUMN_FRAME, 'pl-4')}
          style={{ width: layout.windows[index] }}
        >
          <ReadingWindow
            practiceId={practice.id}
            besideRef={ref}
            onCrossReference={props.onCrossReference}
            // The right-hand window ends under Layout's full-screen toggle (fixed, top right).
            clearTopRight={index === Math.min(windows.length, MAX_BESIDE) - 1}
          />
        </div>
      ))}
    </div>
  );
}

// The rail's count: what is on the table, the texts to read (articles and decisions).
function RailCount({ practice }: { practice: Practice }) {
  const { articles, decisions } = practiceCounts(practice);
  return (
    <span data-testid="practice-rail-count" className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-200">
      {articles + decisions}
    </span>
  );
}
