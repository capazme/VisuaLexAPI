import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { FOCUS_RING } from '../../constants/interactions';
import { cn } from '../../lib/utils';
import { markTransition, panelEntrance } from './segmentedTabsMotion';

/**
 * «Linguette che scorrono» (U1; first on the Forum's three, S7a): a row of tabs over one panel. The chosen tab's mark,
 * the light pill behind it, slides to the new one on the app's spring while the words change colour in the same time;
 * the panel's content comes in with a short fade and a shift the way the choice moved (`segmentedTabsMotion.ts`).
 * Under reduced motion the mark is drawn in place and the content changes at once. The mark does not move on the first
 * drawing: Framer's `layoutId` animates a change, not a mount. Each row's marks are its own (`LayoutGroup` with the
 * row's id), so two rows on a page never trade them.
 *
 * Tabs, not pressed buttons: `tablist` / `tab` / `tabpanel`, the chosen tab the only one in the Tab order, the arrows,
 * Home and End moving the choice and the focus together.
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
  /** The panel's id (`SegmentedTabPanel`), from which the tabs' ids are made. */
  panelId: string;
  id?: string;
  /** The row's width. */
  className?: string;
  /** Each tab's width and padding. */
  tabClassName?: string;
}

const tabId = (panelId: string, id: string) => `${panelId}-tab-${id}`;

/** The mark's corners (`rounded-md`) and shadow (`shadow-sm`). */
const MARK_STYLE = { borderRadius: 6, boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' };

export function SegmentedTabs<T extends string>({ tabs, value, onChange, label, panelId, id, className, tabClassName }: SegmentedTabsProps<T>) {
  const group = useId();
  const reduced = useReducedMotion() ?? false;

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
    document.getElementById(tabId(panelId, tabs[next].id))?.focus();
  };

  return (
    <LayoutGroup id={group}>
      <div
        id={id}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn('flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800', className)}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              id={tabId(panelId, tab.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                // The words change colour over the mark's slide (`spring.snappy`, 0.3 s).
                'relative flex min-h-[44px] items-center justify-center rounded-md text-sm font-medium transition-colors duration-300',
                FOCUS_RING,
                active ? 'text-slate-900 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                tabClassName,
              )}
            >
              {active && (
                <motion.span
                  layoutId="segmented-tabs-mark"
                  // Measured again only when the choice changes, not on every render of the page around it.
                  layoutDependency={value}
                  data-segmented-mark
                  aria-hidden
                  className="absolute inset-0 bg-white dark:bg-slate-700"
                  // The corners and the shadow in `style`, which Framer corrects as the mark stretches between tabs of
                  // different widths; as classes they were squashed during the slide.
                  style={MARK_STYLE}
                  transition={markTransition(reduced)}
                />
              )}
              <span className="relative flex items-center gap-2">{tab.label}</span>
              {tab.extra}
            </button>
          );
        })}
      </div>
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
      <div key={value} className={cn(panelEntrance(shown.direction, shown.changed), className)}>
        {children}
      </div>
    </div>
  );
}
