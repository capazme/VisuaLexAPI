import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FOCUS_RING } from '../../constants/interactions';
import { pageName } from '../../features/sections/pageNames';
import { PALETTE_SHORTCUT, SEARCH_ISLAND_ID, ISLAND_FOCUS, ISLAND_HINT, ISLAND_LENS, ISLAND_PLACEHOLDER, ISLAND_SHAPE, ISLAND_SURFACE, ISLAND_TEXT } from '../../utils/searchFieldControl';
import type { Section } from '../../features/sections/sections';

/**
 * The text of the page's title (the first `h1` in the scroller), followed as the page draws or replaces it: the
 * breadcrumb's last step on a page deeper than its list («Dossier › Pratica 2026/14»).
 */
function usePageHeading(scroller: HTMLElement | null, resetKey: string): string {
  const [heading, setHeading] = useState('');
  useEffect(() => {
    if (!scroller) return undefined;
    const read = () => setHeading(scroller.querySelector('h1')?.textContent?.trim() ?? '');
    read();
    const observer = new MutationObserver(read);
    observer.observe(scroller, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [scroller, resetKey]);
  return heading;
}

/** The segments of an address that name a list: `/pratiche/42` → `/pratiche`, `/work/atti/7` → `/work/atti`. */
function listOf(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  // Learn's planner is Work's one level down (LC130): `/learn/attivita/ingresso` is a list, as `/work/ingresso`.
  if (parts[0] === 'learn' && parts[1] === 'attivita') return `/${parts.slice(0, 3).join('/')}`;
  return parts[0] === 'work' || parts[0] === 'learn' || parts[0] === 'labs' ? `/${parts.slice(0, 2).join('/')}` : `/${parts[0] ?? ''}`;
}

/**
 * `field`: the search page's own field, compact, in the place of the search button (its words open the menu).
 * The bar over every page from `lg` (LC21, the prototype of 12 November): where the reader is, as a path («Work ›
 * Dossier › Pratica 2026/14»), and on its right the search, compact (it opens the menu, ⌘K), the version's news and
 * the page's two controls, «Commenti» and «Tutto schermo», which until 1.19.0 floated over the page. The search page
 * keeps its own bar, its field.
 */
/** The field's widest (the lists' column under the bar) and the air it keeps from the bar's controls (the bar's gap). */
const FIELD_MAX = 768;
const FIELD_AIR = 12;

/**
 * L-75: where the search's field may stand in the bar, measured against the controls actually drawn at its right
 * («Novità» after a release, «Commenti», «Tutto schermo»): centred on the pill when it fits, else moved left just enough
 * to keep clear of them (Papiniano, #599: a fixed room let the field cover «Novità»). In the bar's own coordinates.
 */
function useFieldRoom(bar: HTMLElement | null, controls: HTMLElement | null) {
  const [room, setRoom] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    if (!bar || !controls || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const b = bar.getBoundingClientRect();
      const c = controls.getBoundingClientRect();
      const start = parseFloat(getComputedStyle(bar).paddingLeft) || 0;
      const end = (c.width > 0 ? c.left - b.left : b.width - start) - FIELD_AIR;
      const width = Math.max(0, Math.min(FIELD_MAX, end - start));
      setRoom({ left: Math.max(start, Math.min(b.width / 2 - width / 2, end - width)), width });
    };
    measure();
    // The window's width moves the bar; a control coming or going («Novità») moves the controls.
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [bar, controls]);
  return room;
}

export function TopBar({ section, pathname, search = '', scroller, actions, onSearch, field }: { section: Section; pathname: string; search?: string; scroller: HTMLElement | null; actions: ReactNode; onSearch: () => void; field?: ReactNode }) {
  // The search page is «Ricerca» in every section, as the sidebar names it (LC48).
  const page = pathname === '/' ? 'Ricerca' : pageName(pathname);
  const list = listOf(pathname);
  // Deeper than its list: a further segment, or a query that opens one item of it (`/pratiche?dossier=…`).
  // Never on the search page, whose `h1` is the desk's greeting or a practice's name, not a step of the path.
  const deeper = pathname !== '/' && page !== undefined && (pathname.replace(/\/$/, '') !== list || search.length > 1);
  const heading = usePageHeading(scroller, pathname + search);
  const leaf = deeper && heading && heading !== page ? heading : null;
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const room = useFieldRoom(bar, controls);

  return (
    <div
      ref={setBar}
      data-testid="top-bar"
      data-palette-bar=""
      className={cn(
        'relative hidden h-[52px] shrink-0 items-center gap-3 border-b border-slate-200 px-6 lg:grid dark:border-slate-800',
        // LC141: three columns, the path · the search · the controls. The middle one is flexible (2fr: a fixed
        // `minmax(0,22rem)` was taken to its 22 rem first, Papiniano at e4088e23), the pill in it at most 22 rem; the path
        // may shrink to 0 and clip; the controls never go below their whole width (`max-content`). Centred while the
        // controls fit their 1fr, a little to the left when they need more.
        'grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(max-content,1fr)]',
        // L-75: while the search's field is in the bar (its slot not empty), the field takes the path's place.
        '[&:has([data-palette-slot]:not(:empty))>[data-bar-path]]:invisible',
      )}
    >
      {/* The path in the first column, clipped to it (`overflow-hidden`: its least width is 0, LC141). */}
      <nav aria-label="Percorso" data-bar-path="" className="min-w-0 overflow-hidden">
        <ol className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[13px] text-slate-600 dark:text-slate-400">
          <li className="shrink-0">
            <Link to={section.home} className={cn('rounded-sm hover:text-slate-900 dark:hover:text-slate-100', FOCUS_RING)}>
              {section.name}
            </Link>
          </li>
          {page && (
            <li className="flex min-w-0 items-center gap-2">
              <ChevronRight aria-hidden size={14} className="shrink-0" />
              {leaf ? (
                <Link to={list} className={cn('shrink-0 rounded-sm hover:text-slate-900 dark:hover:text-slate-100', FOCUS_RING)}>{page}</Link>
              ) : (
                <span aria-current="page" className="truncate font-semibold text-slate-900 dark:text-slate-50">{page}</span>
              )}
            </li>
          )}
          {leaf && (
            <li className="flex min-w-0 items-center gap-2">
              <ChevronRight aria-hidden size={14} className="shrink-0" />
              <span aria-current="page" className="truncate font-semibold text-slate-900 dark:text-slate-50">{leaf}</span>
            </li>
          )}
        </ol>
      </nav>
      {/* LC40 (Luca: «in alto devo avere centrale la barra di ricerca … effetto espansione Dynamic Island»): the search in
          the bar's middle, on every page; the menu grows out of it (`CommandPalette`). */}
      <div data-bar-search="" className="flex min-w-0 justify-center">
      {field ?? <button
        id={SEARCH_ISLAND_ID}
        data-compact=""
        type="button"
        // As the phone's bar: focused first (Safari does not focus a clicked button), so the menu gives the focus back here.
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onSearch();
        }}
        // The phone's name too: the placeholder words are not the button's purpose.
        aria-label="Apri il menu di ricerca"
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          // LC81: the panel's field's shape, type and lens.
          'w-full min-w-0 max-w-[22rem] overflow-hidden transition-colors', ISLAND_SHAPE, ISLAND_TEXT, ISLAND_HINT, ISLAND_SURFACE,
          ISLAND_FOCUS,
        )}
      >
        <Search aria-hidden className={ISLAND_LENS} />
        <span className="truncate">{ISLAND_PLACEHOLDER}</span>
        <kbd aria-hidden className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:border-slate-700">{PALETTE_SHORTCUT}</kbd>
      </button>}
      </div>
      {/* One box for the controls, measured for the field's room; the bar's gap between them, as before. */}
      <div ref={setControls} className="flex shrink-0 items-center gap-3 justify-self-end [&>*]:shrink-0">{actions}</div>
      {/* L-75: the search's field, grown out of the pill (`CommandPalette`) to both sides, in the room the controls leave
          (`useFieldRoom`). After them in the page's order, so Tab goes from the field to the lists under the bar. */}
      <div
        data-palette-slot=""
        style={room ? { left: room.left, width: room.width } : undefined}
        className={cn('absolute inset-y-0 flex items-center empty:hidden', !room && 'left-1/2 w-[min(48rem,calc(100%-22rem))] -translate-x-1/2')}
      />
    </div>
  );
}
