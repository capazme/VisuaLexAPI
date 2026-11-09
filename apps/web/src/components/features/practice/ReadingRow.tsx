import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FOCUS_RING } from '../../../constants/interactions';
import { Z_INDEX } from '../../../constants/zIndex';
import { cn } from '../../../lib/utils';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { FIND_WINDOW_ESTIMATED_HEIGHT, FIND_WINDOW_MARGIN, FIND_WINDOW_WIDTH, setFindWindowDefaultPlace } from '../../../utils/findWindowControl';
import { MAX_BESIDE, besideRefOfRow, practiceCounts, type BesideRef, type Practice } from '../../../utils/practice';
import { scrollParentOf } from '../../../utils/scrollParent';
import { workspaceOrigin } from '../../../utils/workspaceOrigin';
import { FOCUS_BUTTON_CLEARANCE } from '../../layout/PageFrame';
import { INDEX_WIDTH, RAIL_WIDTH, besideLayout } from './besideLayout';
import { PracticeTable, type PracticeTableProps } from './PracticeTable';
import { ReadingWindow } from './ReadingWindow';
import { PRACTICE_VT, practiceTransitionName } from './practiceSwitch';

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
 * The row's width, kept current by a `ResizeObserver`. The search page is a `full` page (U1): the row takes the frame's
 * width with or without a window beside, and never reaches past it — it did while the page held the results area to
 * `ReaderLayout`'s `max-w-5xl`, now gone. Before it is measured, the results area's width.
 */
function useRowWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() => workspaceOrigin().width);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const measured = el.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** A control the keyboard reaches (the overlay's first, the table's first). */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The overview's place in the page's scroller, one per practice, kept while the reading view is on screen and given
 * back when its last window closes (U2): the reading view is usually shorter than the overview, and the browser clamps
 * the scroller to it. Followed on `scroll` while the overview is drawn — read after the switch, it would already be
 * clamped. Entering the reading view, the scroller goes to its top: the index starts there, and the windows hold their
 * place at the top of the page whatever the scroll (a clamped place could open a long index in the middle).
 */
function useOverviewScroll(rootRef: RefObject<HTMLElement | null>, practiceId: string | undefined, reading: boolean) {
  const kept = useRef(new Map<string, number>());
  const was = useRef<{ practiceId: string | undefined; reading: boolean }>({ practiceId, reading });
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = root ? scrollParentOf(root) : null;
    const samePractice = was.current.practiceId === practiceId;
    const back = samePractice && was.current.reading && !reading;
    const into = samePractice && !was.current.reading && reading;
    was.current = { practiceId, reading };
    if (!scroller || !practiceId) return undefined;
    if (back && kept.current.has(practiceId)) scroller.scrollTop = kept.current.get(practiceId) as number;
    if (into) scroller.scrollTop = 0;
    if (reading) return undefined;
    const follow = () => { kept.current.set(practiceId, scroller.scrollTop); };
    follow();
    scroller.addEventListener('scroll', follow, { passive: true });
    // Taken away in the commit that draws the reading view, before the browser clamps the scroller to it.
    return () => scroller.removeEventListener('scroll', follow);
  }, [rootRef, practiceId, reading]);
}

/**
 * The practice's table with its windows beside it, in the results area (spec §4), in two views (U2, L-61). With no
 * window, the overview: the table takes the area, its acts a grid of panels. With windows, the reading view: the table
 * becomes a narrow index on the left (`INDEX_WIDTH`) and the windows share the rest (`besideLayout`); on an area too
 * narrow for that the index folds into a rail that opens it as an overlay over the windows. A row the practice reveals
 * meanwhile opens beside — there is no row to open in place. Only the active practice's windows are drawn: switching
 * practice hides them, returning shows them (D9). Gives the find window its default place, clear of the windows'
 * headers (§4.4).
 */
export function ReadingRow(props: Omit<PracticeTableProps, 'layout' | 'concealed'>) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.activePracticeId));
  const revealPending = useAppStore((s) => s.pendingReveal?.practiceId === s.activePracticeId);
  const windows = practice?.beside ?? NO_WINDOWS;
  const count = Math.min(windows.length, MAX_BESIDE) as 0 | 1 | 2;
  const reading = count > 0;

  const rootRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  const width = useRowWidth(rootRef);
  const layout = besideLayout(width, count);
  const isRail = layout.table === 'rail';
  useOverviewScroll(rootRef, practice?.id, reading);

  // In the reading view a row the practice reveals (a search that landed, a pick in the structure window, the act's
  // arrows, a find match, the way back) opens beside, in place of the oldest window: the index draws no row to open in
  // place, and the overview's column takes the reveal only while it is on screen. Taken once (gotcha 14).
  const practiceId = practice?.id;
  const takeReveal = useAppStore((s) => s.takeReveal);
  const openBeside = useAppStore((s) => s.openBeside);
  // The row the reveal opened in the hidden overview is closed again: its subject is in a window, and many reveals (a
  // find stepping through its matches) would otherwise mount as many readers when the overview comes back.
  const setRowOpen = useAppStore((s) => s.setRowOpen);
  useEffect(() => {
    if (!reading || !revealPending || !practiceId) return;
    const taken = takeReveal(practiceId);
    const held = appStore.getState().practices.find((p) => p.id === practiceId);
    const ref = taken && held ? besideRefOfRow(held, taken.rowKey) : null;
    if (!taken || !ref) return;
    openBeside(practiceId, ref);
    setRowOpen(taken.rowKey, false);
  }, [reading, revealPending, practiceId, takeReveal, openBeside, setRowOpen]);

  // A view changed under the focus — the control that had it went with the old view (a row's button, an entry's ✕, a
  // link inside an open row) — would leave it on the page's body. It goes to the newest window in the reading view, to
  // the table's first control in the overview; «Chiudi» then hands it to the subject's row when it can.
  const focusView = useRef(reading);
  useLayoutEffect(() => {
    if (focusView.current === reading) return;
    focusView.current = reading;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const target = reading
      ? Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-window-id]') ?? []).at(-1)
      : tableRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: true });
  }, [reading]);

  // The rail's overlay is open for one practice and one set of windows: switching practice, a layout
  // that has room for the index again, or a window opening or closing (an entry pressed in the overlay
  // itself) closes it; so does a window being asked to take focus, or the overlay would stay open over
  // the window it sent focus to.
  const windowsKey = practice ? `${practice.id}#${windows.map((w) => w.id).join('|')}` : null;
  const focusNamesWindow = useAppStore((s) => s.windowFocusRequest !== null && windows.some((w) => w.id === s.windowFocusRequest));
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (openFor !== null && (!isRail || openFor !== windowsKey || focusNamesWindow)) setOpenFor(null);
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
      if (!target || tableRef.current?.contains(target) || railButtonRef.current?.contains(target)) return;
      // What the table's own controls open outside it (a confirmation, a menu, the structure window,
      // the find window, Study Mode) is part of the overlay's use, not a click away from it.
      if (target.closest('[role="dialog"], [aria-modal="true"], [role="menu"], [data-floating-tool], [data-find-overlay]')) return;
      setOpenFor(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [overlayOpen]);

  // Opened by the reader on the rail, the overlay takes the focus (its first control).
  const focusOnOpenRef = useRef(false);
  useEffect(() => {
    if (!overlayOpen || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    const overlay = tableRef.current;
    (overlay?.querySelector<HTMLElement>(FOCUSABLE) ?? overlay)?.focus();
  }, [overlayOpen]);

  // The find window's default place (spec §4.4), asked when it opens: right-aligned in its target
  // column and under whatever is pinned at the column's top, never over a control: the practice
  // header, the first act's heading (sticky from `md`), an open row's reading toolbar pinned under it
  // (all marked `data-pinned-head`), and every window's header. The target is the table's column in
  // the overview, the first window's body in the reading view (beside the index or the rail: the index
  // is narrower than the find window, and holds no text).
  const readingRef = useRef(reading);
  useEffect(() => {
    readingRef.current = reading;
  });
  useEffect(() => {
    setFindWindowDefaultPlace(() => {
      const root = rootRef.current;
      if (!root) return null;
      const inReading = readingRef.current;
      const column = (inReading ? root.querySelector('[data-reading-window-body]') : tableRef.current)?.getBoundingClientRect();
      if (!column) return null;
      let bottom = Math.max(column.top, 0);
      for (const header of root.querySelectorAll('[data-reading-window-header]')) {
        bottom = Math.max(bottom, header.getBoundingClientRect().bottom);
      }
      // The pinned stack, followed from the top: each element that starts where the last one ends
      // (a few pixels of gap allowed) is under the window's way.
      const target = inReading ? root.querySelector('[data-reading-window-body]') : tableRef.current;
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
    >
      {/* Before the table, so the table keeps its place among the children and its one instance as the view changes:
          the act blocks hold the structure window and Study Mode, which a pick from them must not unmount. */}
      {isRail && practice && (
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
      )}
      {isRail ? (
        // The rail's overlay: the index, unfolded over the windows — its own width and the overlay's padding —, hidden
        // while closed but kept mounted, so what its act blocks hold (the structure window, Study Mode) stays open.
        <div
          ref={tableRef}
          id={OVERLAY_ID}
          tabIndex={-1}
          role="region"
          aria-label={`Pratica ${practice?.label ?? ''}`}
          data-testid="reading-row-overlay"
          hidden={!overlayOpen}
          style={{ left: RAIL_WIDTH, width: `min(${INDEX_WIDTH + 24}px, calc(100% - ${RAIL_WIDTH}px))` }}
          className={cn(
            'absolute top-0 h-app-row overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900',
            Z_INDEX.dropdown,
          )}
        >
          <PracticeTable {...props} layout="index" concealed={!overlayOpen} />
        </div>
      ) : (
        <div
          ref={tableRef}
          data-testid="reading-row-table"
          data-view={reading ? 'index' : 'overview'}
          // Alone in the row it ends at the frame's right edge: its header and the act's pinned heading keep clear of
          // the full-screen button, which floats there in full screen (the last window keeps its own, `clearTopRight`).
          className={cn('min-w-0', reading ? 'flex-none pr-4' : cn('w-full', FOCUS_BUTTON_CLEARANCE))}
          style={reading ? { width: tableWidth } : undefined}
        >
          <PracticeTable {...props} layout={reading ? 'index' : 'overview'} />
        </div>
      )}
      {practice && windows.slice(0, MAX_BESIDE).map((ref, index) => (
        <div
          key={ref.id}
          data-testid="reading-row-window"
          // A piece of the passage between the views (L-62): the window comes in from the right, and goes back there.
          className={cn(COLUMN_FRAME, 'pl-4', PRACTICE_VT)}
          style={{ width: layout.windows[index], ['--vlx-vt' as string]: practiceTransitionName('practice-window', String(index)) }}
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
