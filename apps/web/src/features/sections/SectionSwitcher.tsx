import { MenuButton } from '../../components/ui/MenuButton';
import { cn } from '../../lib/utils';
import { useSection } from './useSection';

/**
 * The switcher at the top of the sidebar, where the open book was (spec S3): the active section's
 * icon, a menu of the sections the user can enter, each with its line. The Forum's count rides its
 * entry, and a dot on the icon says it from any other section (S5). `withName`: the bar with words
 * (from `xl`, and the phone's drawer) writes the section's name beside its mark.
 */
export function SectionSwitcher({ forumCount, onChoose, withName = false }: { forumCount: number; onChoose?: () => void; withName?: boolean }) {
  const { section, active, sections, chooseSection } = useSection();
  const forumDot = forumCount > 0 && section !== 'forum';

  return (
    <MenuButton
      label={`Sezione: ${active.name}, cambia sezione${forumDot ? ', nuove attività nel Forum' : ''}`}
      align="left"
      menuClassName="w-72"
      className={withName ? 'w-full' : undefined}
      triggerClassName={cn(
        'relative rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800',
        // The mark sits where it sits in the rail (4 px in from a 44 px control), so widening the bar moves no icon.
        withName ? 'w-full h-11 justify-start gap-2.5 overflow-hidden px-1' : 'justify-center w-11 h-11',
      )}
      items={sections.map((s) => ({
        label: `VisuaLex ${s.name}`,
        description: s.line,
        icon: s.icon,
        checked: s.id === section,
        badge: s.id === 'forum' ? forumCount : undefined,
        onSelect: () => {
          chooseSection(s.id);
          onChoose?.();
        },
      }))}
    >
      {/* The section's own hue lives only here and on page headers' hairline (spec 2026-10-18-redesign-inchiostro §4.1).
          On a change of section it passes to the new hue in 200 ms, the change's one touch of colour (T1). */}
      <span aria-hidden data-section={section} className="vlx-section-mark grid h-9 w-9 place-items-center rounded-[10px] text-white transition-colors duration-200 ease-out motion-reduce:transition-none">
        <active.icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      {withName && (
        <span aria-hidden className="min-w-0 truncate whitespace-nowrap text-sm font-semibold text-slate-900 dark:text-slate-100">
          {active.name}
        </span>
      )}
      {forumDot && (
        <span aria-hidden data-testid="forum-dot" className="absolute top-1.5 left-7 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
      )}
    </MenuButton>
  );
}
