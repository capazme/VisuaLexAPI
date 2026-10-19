import { MenuButton } from '../../components/ui/MenuButton';
import { useSection } from './useSection';

/**
 * The switcher at the top of the sidebar, where the open book was (spec S3): the active section's
 * icon, a menu of the sections the user can enter, each with its line. The Forum's count rides its
 * entry, and a dot on the icon says it from any other section (S5).
 */
export function SectionSwitcher({ forumCount, onChoose }: { forumCount: number; onChoose?: () => void }) {
  const { section, active, sections, chooseSection } = useSection();
  const forumDot = forumCount > 0 && section !== 'forum';

  return (
    <MenuButton
      label={`Sezione: ${active.name}, cambia sezione${forumDot ? ', nuove attività nel Forum' : ''}`}
      align="left"
      menuClassName="w-72"
      triggerClassName="relative justify-center w-12 h-12 md:w-11 md:h-11 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
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
      {/* The section's own hue lives only here and on page headers' hairline (spec 2026-10-18-redesign-inchiostro §4.1). */}
      <span aria-hidden data-section={section} className="vlx-section-mark grid h-9 w-9 place-items-center rounded-[10px] text-white transition-colors">
        <active.icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      {forumDot && (
        <span aria-hidden data-testid="forum-dot" className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
      )}
    </MenuButton>
  );
}
