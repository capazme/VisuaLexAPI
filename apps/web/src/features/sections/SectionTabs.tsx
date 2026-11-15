import { cn } from '../../lib/utils';
import { useSection } from './useSection';
import { goToLabel, type SectionId } from './sections';

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
    <div role="group" aria-label="Sezioni" className="grid w-full auto-cols-fr grid-flow-col gap-0.5">
      {tabs.map((s) => {
        const active = s.id === section;
        return (
          <button
            key={s.id}
            type="button"
            aria-label={s.id === 'forum' && forumDot ? `${s.name}, nuove attività` : active ? goToLabel(s) : s.name}
            aria-current={active ? 'true' : undefined}
            onClick={(event) => {
              chooseSection(s.id, { still: inDrawer, byPointer: event.detail > 0 });
              onChoose?.();
            }}
            className={cn(
              'relative h-[30px] min-w-0 truncate rounded px-1 text-center text-[13px] transition-colors duration-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              // 44 px on a touch screen, which the drawer is; the desktop bar keeps the prototype's 30.
              inDrawer && 'h-11',
              active
                ? 'bg-ink-300/70 font-semibold text-slate-900 dark:bg-ink-700/60 dark:text-slate-50'
                : 'font-medium text-slate-600 hover:bg-ink-200/70 dark:text-slate-400 dark:hover:bg-ink-800/60',
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
