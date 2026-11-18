import { useId, type ReactNode } from 'react';
import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../studia/progress/tokens';
import { plannerStore } from './plannerStore';
import { MENU_TRIGGER } from './plannerStyles';

export const GROUP_HEADING = 'font-serif text-lg font-medium text-slate-900 dark:text-slate-50';
const COUNT = 'ml-2 font-sans text-sm font-normal text-slate-600 dark:text-slate-400';

interface Props {
  /** The section's id, for a link or a scroll to it (a day of «Prossimi giorni»). */
  anchorId?: string;
  /** The group's key in `plannerStore.folded`, for the session: «today:missed», «upcoming:2026-10-22», «today:dossier:…». */
  foldKey: string;
  heading: string;
  count: number;
  /** The group's «⋯»: the dossier's «Apri la pratica». Adding is the field at the top's alone (LC83). */
  actions?: { label: string; icon: LucideIcon; onSelect: () => void }[];
  children: ReactNode;
}

/**
 * A group of a view, folded and opened by its heading (the accordion pattern: the toggle inside the `h3`, named by
 * the heading's own words, its state `aria-expanded`): the arrow, the name, the count, «⋯»; then its rows.
 * Folding is instant: nothing moves, under reduced motion or not, but the arrow's turn.
 */
export function TaskGroup({ anchorId, foldKey, heading, count, actions = [], children }: Props) {
  const id = useId();
  const folded = plannerStore((s) => Boolean(s.folded[foldKey]));
  return (
    <section id={anchorId} aria-labelledby={`${id}-heading`} className="min-w-0">
      <div className="flex items-center gap-1 border-b border-slate-300 dark:border-slate-700">
        <h3 id={`${id}-heading`} className={cn(GROUP_HEADING, 'min-w-0 flex-1')}>
          {/* bare-button: the group's heading itself, its words in the heading's type (the accordion pattern). */}
          <button
            type="button"
            aria-expanded={!folded}
            aria-controls={folded ? undefined : `${id}-rows`}
            onClick={() => plannerStore.getState().toggleFolded(foldKey)}
            className={cn('-ml-1 flex min-h-[44px] w-full items-center gap-1.5 rounded px-1 text-left', FOCUS_RING)}
          >
            <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-slate-500 transition-transform motion-reduce:transition-none', folded && '-rotate-90')} />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {heading}
              <span className={COUNT}>
                <span className="sr-only">, </span>
                {count}
                <span className="sr-only">{count === 1 ? ' compito' : ' compiti'}</span>
              </span>
            </span>
          </button>
        </h3>
        {actions.length > 0 && (
          <MenuButton label={`Azioni del gruppo: ${heading}`} triggerClassName={MENU_TRIGGER} items={actions}>
            <MoreHorizontal size={18} aria-hidden />
          </MenuButton>
        )}
      </div>
      {!folded && (
        <div id={`${id}-rows`}>
          {children}
        </div>
      )}
    </section>
  );
}
