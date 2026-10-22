import { Lightbulb, Package, Search, type LucideIcon } from 'lucide-react';
import { SegmentedTabs } from '../../ui/SegmentedTabs';
import { FORUM_PANEL_ID, FORUM_TAB_ORDER, type ForumTab } from './forumSections';

export type { ForumTab } from './forumSections';

/**
 * The Forum's three tabs, each with a short label for a phone and the whole one from `sm` (S7a): «I miei pubblicati»
 * and «Suggerimenti» did not fit beside «Esplora» at 320 px, and the last was cut. Short, the three share the row in
 * equal parts on a phone, at 320 as at 390, with nothing to scroll. Drawn by `ui/SegmentedTabs` (U1): the chosen
 * tab's mark slides to the new one, and the view under it shifts the same way.
 */
const TABS: Record<ForumTab, { label: string; short: string; icon: LucideIcon }> = {
  explore: { label: 'Esplora', short: 'Esplora', icon: Search },
  my: { label: 'I miei pubblicati', short: 'Miei', icon: Package },
  suggestions: { label: 'Suggerimenti', short: 'Suggeriti', icon: Lightbulb },
};

export interface ForumTabsProps {
  active: ForumTab;
  onChange: (tab: ForumTab) => void;
  /** The suggestions waiting for the user, counted on their tab. */
  pendingCount: number;
}

export function ForumTabs({ active, onChange, pendingCount }: ForumTabsProps) {
  return (
    <SegmentedTabs
      id="tour-forum-tabs"
      label="Sezioni del Forum"
      panelId={FORUM_PANEL_ID}
      value={active}
      onChange={onChange}
      className="w-full sm:w-fit sm:max-w-full"
      tabClassName="flex-1 whitespace-nowrap px-2 sm:flex-none sm:px-4"
      tabs={FORUM_TAB_ORDER.map((id) => {
        const { label, short, icon: Icon } = TABS[id];
        return {
          id,
          label: (
            <>
              <Icon size={16} className="hidden sm:block" aria-hidden />
              {/* One of the two is drawn: the short label on a phone, the whole one from `sm`. A browser leaves the one
                  not displayed out of the tab's name, which is what the reader sees; jsdom, with no CSS, joins both. */}
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          ),
          extra:
            id === 'suggestions' && pendingCount > 0 ? (
              // Off the word's end at 320 px, where «Suggeriti» nearly fills its third of the row.
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-xs text-white">
                {pendingCount}
                <span className="sr-only"> in attesa</span>
              </span>
            ) : undefined,
        };
      })}
    />
  );
}
