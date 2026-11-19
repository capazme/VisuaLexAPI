import { cn } from '../../lib/utils';
import { useSection } from './useSection';
import { goToLabel, type SectionId } from './sections';
import { preparePage } from '../../pageCode';

/** The prototype's order (12 November): Work, Learn, Forum, Labs. `SECTIONS` keeps Labs before the Forum. */
const TAB_ORDER: readonly SectionId[] = ['opus', 'gymnasium', 'forum', 'academia'];

/**
 * The sections as a row of tabs under the logo (LC21), where the wide bar and the phone's drawer had a menu: four
 * words, the active one on a stone tile. One press goes to the section's home. The rail keeps `SectionSwitcher`'s one
 * button, which the four words would not fit. The Forum's count rides its tab as a dot, from any other section.
 */
export function SectionTabs({ forumCount, onChoose, inDrawer = false }: { forumCount: number; onChoose?: () => void; inDrawer?: boolean }) {
  const { section, sections, chooseSection } = useSection();
  const tabs = TAB_ORDER.map((id) => sections.find((s) => s.id === id)).filter((s) => s !== undefined);
  const forumDot = forumCount > 0 && section !== 'forum';

  return (
    // LC39: each tab as wide as its word, the room left shared (equal columns cut the bold «Forum» to «For…»); 4 px a
    // side, so the four of a development account (Labs too) fit the 224 px bar with the text a size up.
    <div role="group" aria-label="Sezioni" className="flex w-full gap-0.5">
      {tabs.map((s) => {
        const active = s.id === section;
        return (
          <button
            key={s.id}
            type="button"
            aria-label={s.id === 'forum' && forumDot ? `${s.name}, nuove attività` : active ? goToLabel(s) : s.name}
            aria-current={active ? 'true' : undefined}
            // The home's code asked for as the tab is pointed at or focused, as the sidebar's entries do (LC133): the
            // press then finds the page, its title there with the change, not after its code.
            onPointerEnter={() => preparePage(s.home)}
            onPointerDown={() => preparePage(s.home)}
            onFocus={() => preparePage(s.home)}
            onClick={(event) => {
              chooseSection(s.id, { still: inDrawer, byPointer: event.detail > 0 });
              onChoose?.();
            }}
            className={cn(
              'relative h-[30px] flex-auto whitespace-nowrap rounded px-1 text-center text-[13px]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              // 44 px on a touch screen, which the drawer is; the desktop bar keeps the prototype's 30.
              inDrawer && 'h-11',
              active
                ? 'bg-ink-300/70 font-semibold text-slate-900 transition-colors duration-100 dark:bg-ink-700/60 dark:text-slate-50'
                : 'vlx-hover-tile font-medium text-slate-600 dark:text-slate-400',
            )}
          >
            {s.name}
            {s.id === 'forum' && forumDot && (
              <span aria-hidden data-testid="forum-dot" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
            )}
          </button>
        );
      })}
    </div>
  );
}
