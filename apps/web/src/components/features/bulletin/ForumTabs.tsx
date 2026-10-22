import { Lightbulb, Package, Search, type LucideIcon } from 'lucide-react';
import { cn } from '../../../lib/utils';

export type ForumTab = 'explore' | 'my' | 'suggestions';

/**
 * The Forum's three tabs, each with a short label for a phone and the whole one from `sm` (S7a): «I miei pubblicati»
 * and «Suggerimenti» did not fit beside «Esplora» at 320 px, and the last was cut. Short, the three share the row in
 * equal parts on a phone, at 320 as at 390, with nothing to scroll.
 */
const TABS: ReadonlyArray<{ id: ForumTab; label: string; short: string; icon: LucideIcon }> = [
  { id: 'explore', label: 'Esplora', short: 'Esplora', icon: Search },
  { id: 'my', label: 'I miei pubblicati', short: 'Miei', icon: Package },
  { id: 'suggestions', label: 'Suggerimenti', short: 'Suggeriti', icon: Lightbulb },
];

export interface ForumTabsProps {
  active: ForumTab;
  onChange: (tab: ForumTab) => void;
  /** The suggestions waiting for the user, counted on their tab. */
  pendingCount: number;
}

export function ForumTabs({ active, onChange, pendingCount }: ForumTabsProps) {
  return (
    // A group of pressed buttons, as the subject chips: one of three views, no tab panels to move between.
    <div
      id="tour-forum-tabs"
      role="group"
      aria-label="Sezioni del Forum"
      className="flex w-full gap-1 rounded-lg bg-slate-100 p-1 sm:w-fit sm:max-w-full dark:bg-slate-800"
    >
      {TABS.map(({ id, label, short, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={active === id}
          className={cn(
            'relative flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:flex-none sm:px-4 md:min-h-0',
            active === id
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          <Icon size={16} className="hidden sm:block" aria-hidden />
          {/* One of the two is drawn: the short label on a phone, the whole one from `sm`. A browser leaves the one not
              displayed out of the button's name, which is what the reader sees; jsdom, with no CSS, joins both. */}
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{label}</span>
          {id === 'suggestions' && pendingCount > 0 && (
            // Off the word's end at 320 px, where «Suggeriti» nearly fills its third of the row.
            <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-xs text-white">
              {pendingCount}
              <span className="sr-only"> in attesa</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
