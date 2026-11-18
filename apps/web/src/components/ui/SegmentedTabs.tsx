import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { FOCUS_RING } from '../../constants/interactions';
import { CONTROL_RADIUS } from './controlStyles';
import { cn } from '../../lib/utils';
import { markTransition, panelEntrance, PANEL_ENTRANCE_TIMING } from './segmentedTabsMotion';

/**
 * «Linguette che scorrono» (U1; first on the Forum's three, S7a): a row of segments, the app's one component for a
 * segmented choice (LC105: `SegmentedControl` is gone into it). The chosen segment's mark, the light pill behind it,
 * slides to the new one on the app's spring while the words change colour in the same time. Under reduced motion the
 * mark is drawn in place. The mark does not move on the first drawing: Framer's `layoutId` animates a change, not a
 * mount. Each row's marks are its own (`LayoutGroup` with the row's id), so two rows on a page never trade them.
 *
 * Over a panel (`panelId`, with a `SegmentedTabPanel`) the row is tabs: `tablist` / `tab` / `tabpanel`, the panel's
 * content coming in the way the choice moved (`segmentedTabsMotion.ts`). Without a panel it is a choice in a form (the
 * card's kind, a relation's end): `radiogroup` / `radio`, since a tab with no panel is a wrong promise to a reader.
 * Either way the chosen segment is the only one in the Tab order, the arrows, Home and End moving the choice and the
 * focus together. Links between pages are `SegmentedTabLinks`, below.
 */

export interface SegmentedTab<T extends string> {
  id: T;
  /** What the tab says, which is its name. */
  label: ReactNode;
  /** Drawn on the tab after its words, over the mark (a count). */
  extra?: ReactNode;
}

export interface SegmentedTabsProps<T extends string> {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  value: T;
  onChange: (id: T) => void;
  /** The row's name («Sezioni del Forum»). */
  label: string;
  /** The panel's id (`SegmentedTabPanel`), from which the tabs' ids are made; without it the row is a choice. */
  panelId?: string;
  id?: string;
  /** The row's width. */
  className?: string;
  /** Each tab's width and padding. */
  tabClassName?: string;
  /**
   * `sm` (LC106): a choice set among the fields of a row, the whole row as tall as they are — 44 px on a phone, 36
   * from md (`CONTROL_HEIGHT.md`) — and their 4 px corners (`CONTROL_RADIUS`).
   */
  size?: 'md' | 'sm';
}

const tabId = (panelId: string, id: string) => `${panelId}-tab-${id}`;

/** The mark's corners (`rounded-md`) and shadow (`shadow-sm`). */
const MARK_STYLE = { borderRadius: 6, boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' };

const TRACK = 'flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800';
// The small row: 2 px of track round segments of 40 and 32 px make `CONTROL_HEIGHT.md`'s 44 and 36.
const TRACK_SM = cn('p-0.5', CONTROL_RADIUS);
const SEGMENT_SM = 'min-h-10 px-3 text-xs md:min-h-8';
/** The small mark's corners: 2 px inside the track's 4. */
const MARK_STYLE_SM = { ...MARK_STYLE, borderRadius: 2 };
// The words change colour over the mark's slide (`spring.snappy`, 0.3 s).
const SEGMENT = 'relative flex min-h-[44px] items-center justify-center rounded-md text-sm font-medium transition-colors duration-300';
const segmentTone = (active: boolean) =>
  active ? 'text-slate-900 dark:text-ink-950' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white';

/** The chosen segment's mark, measured again only when `choice` changes, not on every render of the page around it. */
function SegmentedMark({ choice, small = false, className }: { choice: string; small?: boolean; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span
      layoutId="segmented-tabs-mark"
      layoutDependency={choice}
      data-segmented-mark
      aria-hidden
      className={cn('absolute inset-0 bg-white dark:bg-toga-400', className)}
      // The corners and the shadow in `style`, which Framer corrects as the mark stretches between tabs of different
      // widths; as classes they were squashed during the slide.
      style={small ? MARK_STYLE_SM : MARK_STYLE}
      transition={markTransition(reduced)}
    />
  );
}

export function SegmentedTabs<T extends string>({ tabs, value, onChange, label, panelId, id, className, tabClassName, size = 'md' }: SegmentedTabsProps<T>) {
  const small = size === 'sm';
  const group = useId();
  const base = panelId ?? group;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt and the arrows are the browser's back and forward (Cmd on a Mac): those stay the browser's.
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const at = tabs.findIndex((tab) => tab.id === value);
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight' ? (at + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
          : event.key === 'Home' ? 0
            : event.key === 'End' ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(tabId(base, tabs[next].id))?.focus();
  };

  return (
    <LayoutGroup id={group}>
      <div id={id} role={panelId ? 'tablist' : 'radiogroup'} aria-label={label} onKeyDown={onKeyDown} className={cn(TRACK, small && TRACK_SM, className)}>
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              id={tabId(base, tab.id)}
              type="button"
              {...(panelId
                ? { role: 'tab', 'aria-selected': active, 'aria-controls': panelId }
                : { role: 'radio', 'aria-checked': active })}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(SEGMENT, small && cn(SEGMENT_SM, CONTROL_RADIUS), FOCUS_RING, segmentTone(active), tabClassName)}
            >
              {active && <SegmentedMark choice={value} small={small} />}
              <span className="relative flex items-center gap-2">{tab.label}</span>
              {tab.extra}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export interface SegmentedTabLink {
  /** The view's address. */
  to: string;
  /** What the link says, which is its name. */
  label: ReactNode;
  /** Drawn on the link after its words, over the mark (a count). */
  extra?: ReactNode;
  /** Drawn over the words in the bar at the foot (`footBar`), below `md` only. */
  icon?: ReactNode;
  /** Chosen only on this exact address, not under it (`NavLink`'s `end`). */
  end?: boolean;
}

export interface SegmentedTabLinksProps {
  links: ReadonlyArray<SegmentedTabLink>;
  /** The navigation's name («Viste di Work»). */
  label: string;
  /** A link followed (the page keeping its place). */
  onNavigate?: () => void;
  /** The row's width. */
  className?: string;
  /** Each link's width and padding. */
  tabClassName?: string;
  /** `SegmentedTabs`'s `sm`: 44 px on a phone, 36 from md, 4 px corners. */
  size?: 'md' | 'sm';
  /**
   * Below `md` the row is a bar at the screen's foot (LC33, Opus's views): no track, the links share its width, each
   * its icon over a short word, the mark a tint of ink, since the bar is the paper the light mark would vanish on. Where
   * the bar is placed is the page's (its fixed box).
   */
  footBar?: boolean;
}

const FOOT_TRACK = 'max-md:bg-transparent max-md:p-0 max-md:dark:bg-transparent';
const FOOT_SEGMENT = 'max-md:min-h-11 max-md:flex-1 max-md:py-1.5 max-md:text-xs';
const FOOT_MARK = 'max-md:bg-ink-200 max-md:dark:bg-ink-700';
// On the bar's dark tint the chosen words are light, not the ink drawn on the toga mark.
const FOOT_TONE = 'max-md:dark:text-slate-50';

/**
 * The same row as `SegmentedTabs` for views that each have their address (Opus's, Learn's): a `nav` of router links,
 * the current one carrying `aria-current="page"` and the sliding mark. Links, not tabs: each is in the Tab order and
 * the arrows are left to the page.
 */
export function SegmentedTabLinks({ links, label, onNavigate, className, tabClassName, size = 'md', footBar = false }: SegmentedTabLinksProps) {
  const group = useId();
  const { pathname } = useLocation();
  const small = size === 'sm';
  return (
    <LayoutGroup id={group}>
      <nav aria-label={label} className={cn(TRACK, small && TRACK_SM, footBar && FOOT_TRACK, className)}>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            onClick={onNavigate}
            className={({ isActive }) => cn(
              SEGMENT, small && cn(SEGMENT_SM, CONTROL_RADIUS), FOCUS_RING, segmentTone(isActive),
              footBar && cn(FOOT_SEGMENT, isActive && FOOT_TONE), tabClassName,
            )}
          >
            {({ isActive }) => (
              <>
                {isActive && <SegmentedMark choice={pathname} small={small} className={footBar ? FOOT_MARK : undefined} />}
                <span className={cn('relative flex items-center gap-2', footBar && 'max-md:flex-col max-md:gap-0.5')}>
                  {link.icon && <span aria-hidden className={cn('inline-flex', footBar && 'md:hidden')}>{link.icon}</span>}
                  {link.label}
                </span>
                {link.extra}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </LayoutGroup>
  );
}

export interface SegmentedTabPanelProps<T extends string> {
  /** The same id as the row's `panelId`. */
  panelId: string;
  /** The tabs' order, left to right: the side the content comes in from. */
  order: ReadonlyArray<T>;
  value: T;
  /** The content's own layout (its gaps). */
  className?: string;
  children: ReactNode;
}

/**
 * The panel under a `SegmentedTabs` row: named by the chosen tab, its content coming in at each change. The shift is
 * clipped at the sides, 8 px out, so it never widens the page while focus rings and shadows keep their room.
 */
export function SegmentedTabPanel<T extends string>({ panelId, order, value, className, children }: SegmentedTabPanelProps<T>) {
  // The way the choice moved, derived during render (react-hooks/set-state-in-effect): -1, 0 or 1.
  const [shown, setShown] = useState({ value, direction: 0, changed: false });
  if (shown.value !== value) {
    setShown({ value, direction: Math.sign(order.indexOf(value) - order.indexOf(shown.value)), changed: true });
  }
  return (
    <div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, value)} className="-mx-2 overflow-x-clip px-2">
      {/* A new element for each view, so its entrance plays once as it is drawn. */}
      <div key={value} className={cn(panelEntrance(shown.direction, shown.changed), className)} style={shown.changed ? PANEL_ENTRANCE_TIMING : undefined}>
        {children}
      </div>
    </div>
  );
}
