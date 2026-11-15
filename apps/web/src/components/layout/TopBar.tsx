import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FOCUS_RING } from '../../constants/interactions';
import { pageName } from '../../features/sections/pageNames';
import { PALETTE_SHORTCUT } from '../../utils/searchFieldControl';
import type { Section } from '../../features/sections/sections';

/**
 * The text of the page's title (the first `h1` in the scroller), followed as the page draws or replaces it: the
 * breadcrumb's last step on a page deeper than its list («Dossier › Pratica 2026/14»).
 */
function usePageHeading(scroller: HTMLElement | null, resetKey: string): string {
  const [heading, setHeading] = useState('');
  useEffect(() => {
    if (!scroller) return undefined;
    const read = () => setHeading(scroller.querySelector('h1')?.textContent?.trim() ?? '');
    read();
    const observer = new MutationObserver(read);
    observer.observe(scroller, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [scroller, resetKey]);
  return heading;
}

/** The first segment of an address that names a list: `/dossier/42` → `/dossier`, `/work/oggi` → `/work/oggi`. */
function listOf(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'work' || parts[0] === 'learn' || parts[0] === 'labs' ? `/${parts.slice(0, 2).join('/')}` : `/${parts[0] ?? ''}`;
}

/**
 * `field`: the search page's own field, compact, in the place of the search button (its words open the menu).
 * The bar over every page from `lg` (LC21, the prototype of 12 November): where the reader is, as a path («Work ›
 * Dossier › Pratica 2026/14»), and on its right the search, compact (it opens the menu, ⌘K), the version's news and
 * the page's two controls, «Commenti» and «Tutto schermo», which until 1.19.0 floated over the page. The search page
 * keeps its own bar, its field.
 */
export function TopBar({ section, pathname, search = '', scroller, actions, onSearch, field }: { section: Section; pathname: string; search?: string; scroller: HTMLElement | null; actions: ReactNode; onSearch: () => void; field?: ReactNode }) {
  // The search page is Work's «Corpus» and the other sections' «Ricerca», as the sidebar names it.
  const page = pathname === '/' ? (section.id === 'opus' ? 'Corpus' : 'Ricerca') : pageName(pathname);
  const list = listOf(pathname);
  // Deeper than its list: a further segment, or a query that opens one item of it (`/dossier?dossier=…`).
  const deeper = page !== undefined && (pathname.replace(/\/$/, '') !== list || search.length > 1);
  const heading = usePageHeading(scroller, pathname + search);
  const leaf = deeper && heading && heading !== page ? heading : null;

  return (
    <div data-testid="top-bar" className="hidden h-[52px] shrink-0 items-center gap-3 border-b border-slate-200 px-6 lg:flex dark:border-slate-800">
      <nav aria-label="Percorso" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[13px] text-slate-600 dark:text-slate-400">
          <li className="shrink-0">
            <Link to={section.home} className={cn('rounded-sm hover:text-slate-900 dark:hover:text-slate-100', FOCUS_RING)}>
              {section.name}
            </Link>
          </li>
          {page && (
            <li className="flex min-w-0 items-center gap-2">
              <ChevronRight aria-hidden size={14} className="shrink-0" />
              {leaf ? (
                <Link to={list} className={cn('shrink-0 rounded-sm hover:text-slate-900 dark:hover:text-slate-100', FOCUS_RING)}>{page}</Link>
              ) : (
                <span aria-current="page" className="truncate font-semibold text-slate-900 dark:text-slate-50">{page}</span>
              )}
            </li>
          )}
          {leaf && (
            <li className="flex min-w-0 items-center gap-2">
              <ChevronRight aria-hidden size={14} className="shrink-0" />
              <span aria-current="page" className="truncate font-semibold text-slate-900 dark:text-slate-50">{leaf}</span>
            </li>
          )}
        </ol>
      </nav>
      {field ?? <button
        type="button"
        // As the phone's bar: focused first (Safari does not focus a clicked button), so the menu gives the focus back here.
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onSearch();
        }}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          'flex h-8 min-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-card pl-3 pr-2 text-[13px] text-slate-600 transition-colors',
          'hover:border-slate-300 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600',
          FOCUS_RING,
        )}
      >
        <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0" />
        <span>Norma, dossier o pagina</span>
        <kbd aria-hidden className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:border-slate-700">{PALETTE_SHORTCUT}</kbd>
      </button>}
      {actions}
    </div>
  );
}
