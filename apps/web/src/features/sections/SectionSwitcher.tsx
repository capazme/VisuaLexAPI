import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';
import { useSection } from './useSection';
import { SECTION_HOME_CODE, SECTIONS, goToLabel, type Section, type SectionId } from './sections';
import { prefersReducedMotion } from './sectionTransition';
import { SECTION_MENU_MS, rollName, rollUpMenu, slideCheck, unrollMenu, type RollingUp } from './sectionMenuMotion';

/** Closed; open; chosen (the check arrives, nothing more can be chosen); rolling back up. */
type Phase = 'closed' | 'open' | 'chosen' | 'closing';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const HOVER = 'hover:bg-slate-100 dark:hover:bg-slate-800';

/**
 * Runs `then` in the second frame from now: the first frame drawn after a section change holds the old page's picture
 * (T1's View Transition draws nothing until the new page is there), so a motion started earlier would be over behind
 * it. Returns the way to cancel it.
 */
function afterHold(then: () => void): () => void {
  let second = 0;
  const first = requestAnimationFrame(() => (second = requestAnimationFrame(then)));
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/** Where the motions can play: not under reduced motion, and not where the Web Animations API is missing. */
const motionHere = () => typeof Element.prototype.animate === 'function' && !prefersReducedMotion();

/**
 * The switcher at the top of the sidebar, where the open book was (spec S3). `withName`: the bar with words (from `xl`,
 * and the phone's drawer) makes it a split button (S6): on the left the section's mark and name, which go to its home
 * («Vai a Gymnasium: Oggi»); after a thin rule an arrow, which opens the menu of the sections. In the rail it is one
 * button, the mark, which opens the menu. The menu unrolls from the top, its entries come in one after the other, one
 * check slides to the section chosen, and the menu closes by itself a moment after, while the page has already
 * changed and the button's name rolls to the new one. The Forum's count rides its entry, and a dot on the mark says it
 * from any other section (S5). `inDrawer`: the phone's drawer, which closes over the change, so the page changes at
 * once under it (T1).
 */
export function SectionSwitcher({ forumCount, onChoose, withName = false, inDrawer = false }: { forumCount: number; onChoose?: () => void; withName?: boolean; inDrawer?: boolean }) {
  const { section, active, sections, chooseSection } = useSection();
  const forumDot = forumCount > 0 && section !== 'forum';
  const news = forumDot ? ', nuove attività nel Forum' : '';

  const [phase, setPhase] = useState<Phase>('closed');
  // Which entry takes the focus once the menu is drawn.
  const [focusAt, setFocusAt] = useState<'first' | 'last'>('first');
  // The entry just chosen: the check goes there at once, before the page has swapped.
  const [chosen, setChosen] = useState<SectionId | null>(null);
  // The section the menu was opened on, written in bold while it is open.
  const [openedOn, setOpenedOn] = useState<SectionId>(section);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closing = useRef<RollingUp | null>(null);
  // Opened again while it rolled up: it turns back from where it is, and does not unroll from the top.
  const turnedBack = useRef(false);
  // The close that follows a choice, on its way: a new opening or a close by hand calls it off.
  const closeLater = useRef<() => void>(() => {});
  const menuId = useId();
  const shown = phase !== 'closed';
  const expanded = phase === 'open';

  const finishClosing = () => {
    closing.current = null;
    setPhase('closed');
    setChosen(null);
  };
  const close = (returnFocus: boolean) => {
    closeLater.current();
    if (returnFocus) arrowRef.current?.focus();
    if (!shown || phase === 'closing') return;
    setPhase('closing');
    closing.current = rollUpMenu(menuRef.current, finishClosing);
  };
  const open = (at: 'first' | 'last') => {
    closeLater.current();
    turnedBack.current = closing.current !== null;
    closing.current?.turnBack();
    closing.current = null;
    setFocusAt(at);
    setChosen(null);
    setOpenedOn(section);
    setPhase('open');
    // A failed fetch is the route's to report, when it is visited.
    sections.forEach((s) => s.id !== section && SECTION_HOME_CODE[s.id]?.().catch(() => {}));
  };

  // The menu is in the DOM only after the render that opens it.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (phase !== 'open' || !menu) return;
    const entries = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    if (!turnedBack.current) {
      const checkedAt = entries.findIndex((entry) => entry.getAttribute('aria-checked') === 'true');
      unrollMenu(menu, entries, menu.querySelector<HTMLElement>('[data-testid="section-check"]'), Math.max(checkedAt, 0));
    }
    turnedBack.current = false;
    (focusAt === 'first' ? entries[0] : entries[entries.length - 1])?.focus();
  }, [phase, focusAt]);

  useEffect(() => {
    if (!shown) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!arrowRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });

  useEffect(() => () => closeLater.current(), []);

  const onArrowKey = (event: KeyboardEvent) => {
    // Enter and Space are the button's own click, which opens it.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(event.key === 'ArrowDown' ? 'first' : 'last');
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault();
      close(true);
    }
  };

  const choose = (id: SectionId, event: ReactMouseEvent<HTMLButtonElement>) => {
    setChosen(id);
    setPhase('chosen');
    // The focus leaves the menu before the change starts, which gives it to the new page's title (T1).
    arrowRef.current?.focus();
    // A key's click (Enter, Space) has `detail` 0.
    chooseSection(id, { still: inDrawer, byPointer: event.detail > 0 });
    onChoose?.();
    closeLater.current();
    // The phone's drawer closes over the change and takes the menu with it (T1): it goes at once, as it did.
    if (!motionHere() || inDrawer) {
      finishClosing();
      return;
    }
    // The 200 ms in which the check is seen arriving count from the first frame drawn after the choice: the change
    // holds the screen still until the new page is there (T1).
    let timer = 0;
    const cancelFrames = afterHold(() => (timer = window.setTimeout(() => close(false), SECTION_MENU_MS.closeAfter)));
    closeLater.current = () => {
      cancelFrames();
      window.clearTimeout(timer);
    };
  };

  const goHome = (event: ReactMouseEvent<HTMLButtonElement>) => {
    close(false);
    chooseSection(section, { still: inDrawer, byPointer: event.detail > 0 });
    onChoose?.();
  };

  // The section's own hue lives only here and on page headers' hairline (spec 2026-10-18-redesign-inchiostro §4.1).
  // On a change of section it passes to the new hue in 200 ms, the change's one touch of colour (T1).
  const mark = (
    <>
      <span aria-hidden data-section={section} className="vlx-section-mark grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-white transition-colors duration-200 ease-out motion-reduce:transition-none">
        <active.icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      {forumDot && (
        <span aria-hidden data-testid="forum-dot" className="absolute top-1.5 left-7 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
      )}
    </>
  );

  const arrowProps = {
    ref: arrowRef,
    type: 'button' as const,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': expanded,
    'aria-controls': shown ? menuId : undefined,
    onClick: () => (expanded ? close(false) : open('first')),
    onKeyDown: onArrowKey,
  };

  return (
    <div className={cn('relative', withName && 'w-full')}>
      {withName ? (
        <div className="inline-flex h-11 max-w-full items-stretch">
          {/* The mark sits where it sits in the rail (4 px in from a 44 px control), so widening the bar moves no icon. */}
          <button
            type="button"
            aria-label={goToLabel(active)}
            onClick={goHome}
            className={cn('relative flex min-w-0 items-center gap-2.5 rounded-l-xl pl-1 pr-3 transition-colors', HOVER, FOCUS)}
          >
            {mark}
            <RollingName section={section} />
          </button>
          <span aria-hidden className="my-2.5 w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
          <button {...arrowProps} aria-label={`Cambia sezione${news}`} className={cn('grid w-11 shrink-0 place-items-center rounded-r-xl text-slate-500 transition-colors dark:text-slate-400', HOVER, FOCUS)}>
            <ChevronDown
              aria-hidden
              className={cn(
                'h-4 w-4 transition-transform ease-out motion-reduce:transition-none',
                phase === 'open' || phase === 'chosen' ? 'rotate-180 duration-[260ms]' : 'duration-[180ms]',
              )}
            />
          </button>
        </div>
      ) : (
        <button {...arrowProps} aria-label={`Sezione: ${active.name}, cambia sezione${news}`} className={cn('relative grid h-11 w-11 place-items-center rounded-xl transition-colors', HOVER, FOCUS)}>
          {mark}
        </button>
      )}
      {shown && (
        <SectionMenu
          ref={menuRef}
          id={menuId}
          sections={sections}
          checked={chosen ?? section}
          current={openedOn}
          forumCount={forumCount}
          inDrawer={inDrawer}
          chosen={phase !== 'open'}
          onChoose={choose}
          onClose={close}
        />
      )}
    </div>
  );
}

/** The section's name on the button: on a change the old one rises and goes, the new one comes from below (S6). */
function RollingName({ section }: { section: SectionId }) {
  const [names, setNames] = useState<{ now: SectionId; leaving: SectionId | null }>({ now: section, leaving: null });
  // Derived during render: the name to roll away is the one drawn until now.
  if (names.now !== section) setNames({ now: section, leaving: motionHere() ? names.now : null });
  const box = useRef<HTMLSpanElement>(null);
  const leaving = useRef<HTMLSpanElement>(null);
  const coming = useRef<HTMLSpanElement>(null);

  // In the next frame drawn, which is after the change's hold (T1), and measured there: a measure in the commit would
  // force a layout of the whole page while the new one is drawn.
  useLayoutEffect(() => {
    if (!names.leaving) return;
    const frame = requestAnimationFrame(() => {
      if (!box.current || !coming.current) return;
      // A roll that ends after a newer one began leaves the newer one alone.
      rollName(box.current, leaving.current, coming.current, leaving.current?.offsetWidth ?? 0, () =>
        setNames((current) => (current.now === names.now ? { ...current, leaving: null } : current)),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [names]);

  const nameOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.name;
  return (
    <span ref={box} aria-hidden className="relative flex min-w-0 overflow-hidden text-sm font-semibold text-slate-900 dark:text-slate-100">
      {names.leaving && (
        <span ref={leaving} key={names.leaving} className="absolute left-0 top-0 whitespace-nowrap">
          {nameOf(names.leaving)}
        </span>
      )}
      {/* Not truncated: while the box widens to a longer name, an ellipsis would show in the first frames. */}
      <span ref={coming} key={names.now} className="whitespace-nowrap">
        {nameOf(names.now)}
      </span>
    </span>
  );
}

interface SectionMenuProps {
  ref: React.Ref<HTMLDivElement>;
  id: string;
  sections: Section[];
  checked: SectionId;
  /**
   * The section the menu opened on, in bold, and so while it is open: a change of weight on the choice would lay the
   * page out again while the new one is drawn. The check says the choice.
   */
  current: SectionId;
  forumCount: number;
  inDrawer: boolean;
  /** Chosen, or rolling up: nothing more can be chosen in it. */
  chosen: boolean;
  onChoose: (id: SectionId, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClose: (returnFocus: boolean) => void;
}

/**
 * The menu of the sections (WAI-ARIA menu, `menuitemradio` entries): arrows, Home and End move, Escape closes and
 * gives the focus back to the arrow, Tab closes. One check, on the entry checked, slides when it changes.
 */
function SectionMenu({ ref, id, sections, checked, current, forumCount, inDrawer, chosen, onChoose, onClose }: SectionMenuProps) {
  const check = useRef<HTMLSpanElement>(null);
  const lines = useRef(new Map<SectionId, HTMLSpanElement>());
  const placed = useRef<number | null>(null);

  // The check sits on the checked entry's name; the first placement does not move. After a choice it slides in the
  // first frames drawn once the change lets the screen go (T1), or the slide would play behind the held picture.
  // Measured there too: a measure in the commit would force a layout of the whole page while the new one is drawn.
  useLayoutEffect(() => {
    const line = lines.current.get(checked);
    const mark = check.current;
    const entry = line?.closest<HTMLElement>('[role="menuitemradio"]');
    if (!mark || !line || !entry) return;
    // Each entry is positioned, so the name's offset is from its entry whether or not its entrance transforms it.
    const measure = () => entry.offsetTop + line.offsetTop + (line.offsetHeight - 16) / 2;
    const from = placed.current;
    const place = () => {
      placed.current = measure();
      slideCheck(mark, from, placed.current);
    };
    if (from === null) return place();
    return afterHold(place);
  }, [checked]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      entries[(to + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      onClose(true);
    } else if (event.key === 'Tab') onClose(false);
  };

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label="Cambia sezione"
      onKeyDown={onKey}
      className={cn(
        Z_INDEX.dropdown,
        'absolute top-full mt-1 origin-top rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800',
        // In the phone's drawer, as wide as the drawer less 32 px (16 on each side; the switcher's row has 10).
        inDrawer ? 'left-1.5 w-[calc(100%-12px)]' : 'left-0 w-72',
      )}
    >
      {sections.map((s) => {
        const isChecked = s.id === checked;
        const badge = s.id === 'forum' ? forumCount : 0;
        return (
          <button
            key={s.id}
            type="button"
            role="menuitemradio"
            aria-checked={isChecked}
            tabIndex={-1}
            onClick={(event) => !chosen && onChoose(s.id, event)}
            className={cn(
              'relative flex w-full items-start gap-3 px-3 py-2 pr-10 text-left text-sm text-slate-700 dark:text-slate-200',
              inDrawer ? 'min-h-14 py-2.5' : 'min-h-[44px]',
              'hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700',
            )}
          >
            <span aria-hidden data-section={s.id} className="vlx-section-mark grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white">
              <s.icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span
                ref={(el) => {
                  if (el) lines.current.set(s.id, el);
                  else lines.current.delete(s.id);
                }}
                className={cn(s.id === current && 'font-semibold')}
              >
                VisuaLex {s.name}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{s.line}</span>
            </span>
            {badge > 0 && (
              <span className="ml-auto flex shrink-0 self-start pt-0.5">
                <span aria-hidden className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-semibold leading-none">
                  {badge > 99 ? '99+' : badge}
                </span>
                <span className="sr-only">, {badge} notifiche</span>
              </span>
            )}
          </button>
        );
      })}
      {/* One check for the menu, which slides to the entry chosen; `aria-checked` says it to a screen reader. */}
      <span ref={check} aria-hidden data-testid="section-check" className="pointer-events-none absolute right-3 top-0 text-primary-600 dark:text-primary-400">
        <Check size={16} />
      </span>
    </div>
  );
}
