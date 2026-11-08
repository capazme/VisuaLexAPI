import { useCallback, useEffect, useRef, useState } from 'react';
import { scrollParentOf } from '../practice/practiceView';
import { Search, Upload, Filter, ChevronDown, RefreshCw, Users, TrendingUp, Clock, Download, Trophy, X as XIcon } from 'lucide-react';
import { CARD_GRID, SharedEnvironmentCard } from './SharedEnvironmentCard';
import { EmptyState } from '../../ui/EmptyState';
import { StudyPacksBand } from './StudyPacksBand';
import { FORUM_CATEGORIES } from '../../../utils/forumCategories';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import type { SharedEnvironment, EnvironmentCategory, StudyImportReport } from '../../../types';

export type SortOption = 'newest' | 'popular' | 'mostDownloaded';

/** The community's dossiers (S7a): the cards' grid. */
const GRID = CARD_GRID;
/** On a phone VisuaLex's packs come after this many of the community's dossiers. */
const PHONE_CARDS_BEFORE_PACKS = 2;

/** `short`: the button's word under `sm`, where half a 320 px row cut the label («Più rece…»); the menu and the
 *  button's name keep the label. */
const SORT_OPTIONS: { value: SortOption; label: string; short: string; icon: React.ReactNode }[] = [
  { value: 'newest', label: 'Più recenti', short: 'Recenti', icon: <Clock size={14} /> },
  { value: 'popular', label: 'Più popolari', short: 'Popolari', icon: <TrendingUp size={14} /> },
  { value: 'mostDownloaded', label: 'Più aggiunti', short: 'Aggiunti', icon: <Users size={14} /> },
];

/** The category and order buttons: half the row each on a phone (44 px tall), their own width from `sm`. */
const FILTER_BUTTON = 'flex w-full min-h-[44px] items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors sm:min-w-[180px] sm:px-4 sm:text-base md:min-h-0';

const CATEGORY_OPTIONS: ReadonlyArray<{ value: EnvironmentCategory | 'all'; label: string }> = [
  { value: 'all', label: 'Tutte le categorie' },
  ...FORUM_CATEGORIES,
];

interface ForumExploreViewProps {
  environments: SharedEnvironment[];
  pagination: { page: number; pages: number; total: number };
  loading: boolean;
  likingIds: Set<string>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  category: EnvironmentCategory | 'all';
  setCategory: (category: EnvironmentCategory | 'all') => void;
  sort: SortOption;
  setSort: (sort: SortOption) => void;
  showCategoryDropdown: boolean;
  setShowCategoryDropdown: (show: boolean) => void;
  showSortDropdown: boolean;
  setShowSortDropdown: (show: boolean) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onRefresh: () => void;
  onPaginate: (page: number) => void;
  onLike: (id: string) => void;
  onImport: (env: SharedEnvironment) => void;
  onReport: (id: string) => void;
  onSuggest: (env: SharedEnvironment) => void;
  onPublishClick: () => void;
  onPacksAdded: (report: StudyImportReport) => void;
  onPacksError: (message: string) => void;
  onResetFilters: () => void;
}

export function ForumExploreView({
  environments,
  pagination,
  loading,
  likingIds,
  searchQuery,
  setSearchQuery,
  category,
  setCategory,
  sort,
  setSort,
  showCategoryDropdown,
  setShowCategoryDropdown,
  showSortDropdown,
  setShowSortDropdown,
  onSearchSubmit,
  onRefresh,
  onPaginate,
  onLike,
  onImport,
  onReport,
  onSuggest,
  onPublishClick,
  onPacksAdded,
  onPacksError,
  onResetFilters,
}: ForumExploreViewProps) {
  const selectedSort = SORT_OPTIONS.find(o => o.value === sort)!;
  const selectedCategory = CATEGORY_OPTIONS.find(o => o.value === category)!;
  const hasFilter = Boolean(searchQuery) || category !== 'all';
  // The community's dossiers first, the Forum's reason (S7a); VisuaLex's packs after them — on a computer after the
  // grid, on a phone after its first two cards, so the first screen shows what the community published.
  const desktop = useIsDesktop();
  // The packs load after the band: the strip is there to be brought up only once they are shown.
  const [packsShown, setPacksShown] = useState(false);
  const showPacks = useCallback(() => setPacksShown(true), []);
  const packs = <StudyPacksBand category={category} onAdded={onPacksAdded} onError={onPacksError} onShown={showPacks} />;
  const cards = (list: SharedEnvironment[], offset = 0) => (
    <div className={GRID}>
      {list.map((env, idx) => (
        <SharedEnvironmentCard
          key={env.id}
          environment={env}
          onLike={onLike}
          onImport={onImport}
          onReport={onReport}
          onSuggest={onSuggest}
          isLiking={likingIds.has(env.id)}
          isFirst={offset + idx === 0}
        />
      ))}
    </div>
  );
  // No dossier: what to do about it, a search to clear or a dossier to publish.
  const emptyState = hasFilter ? (
    <EmptyState
      variant="search"
      title="Nessun dossier pubblicato corrisponde ai filtri"
      description={
        searchQuery && category !== 'all'
          ? `Nessun risultato per "${searchQuery}" nella categoria ${selectedCategory.label.toLowerCase()}.`
          : searchQuery
          ? `Nessun risultato per "${searchQuery}".`
          : `Nessun dossier pubblicato nella categoria "${selectedCategory.label}".`
      }
      action={
        <button
          onClick={onResetFilters}
          className={`inline-flex ${TOUCH_TARGET_RESPONSIVE} items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg transition-colors`}
        >
          <XIcon size={16} />
          Azzera filtri
        </button>
      }
    />
  ) : (
    <EmptyState
      variant="generic"
      title="Ancora nessun dossier nel Forum"
      description="Pubblica un tuo dossier di studio: gli altri lo aggiungono ai loro dossier."
      action={
        <button
          onClick={onPublishClick}
          className={`inline-flex ${TOUCH_TARGET_RESPONSIVE} items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors`}
        >
          <Upload size={16} />
          Pubblica un dossier
        </button>
      }
    />
  );
  // «Pronti da VisuaLex» from elsewhere (the empty dossier list, `/forum#pronti`): once the dossiers are read and the
  // strip has its place, the content scroller alone brings it to the top (never `scrollIntoView`, gotcha 34), and the
  // strip takes the focus, so the keyboard is there too.
  // The address's fragment, read from the window: the router writes it there, and this view needs no router of its own.
  const broughtToPacks = useRef(false);
  useEffect(() => {
    if (window.location.hash !== '#pronti' || loading || broughtToPacks.current) return;
    const strip = document.getElementById('pronti');
    const scroller = strip && scrollParentOf(strip);
    if (!strip || !scroller) return;
    broughtToPacks.current = true;
    const heading = strip.closest('section') ?? strip;
    // Under the phone's bar, which the scroller's `scroll-padding-top` measures, and 16 px of air.
    const padding = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
    const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - padding - 16;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    scroller.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    strip.focus({ preventScroll: true });
    // Once: the fragment leaves the address (the router's state kept), so going back to Explore from another tab, or
    // reloading, neither scrolls to the strip again nor takes the focus.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }, [loading, packsShown]);
  const skeleton = (count: number) => (
    <div aria-hidden className={GRID}>
      {[...Array(count)].map((_, i) => (
        // As tall as a card that has come (P1: the grid grew 159 px under the strip at 1920, 209 on a phone).
        <div key={i} className="min-h-[16.75rem] overflow-hidden rounded-xl border border-slate-200 bg-white motion-safe:animate-pulse md:min-h-[15.25rem] dark:border-slate-700 dark:bg-slate-900">
          <div className="space-y-3 p-4">
            <div className="h-5 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-4 w-full rounded bg-slate-100 dark:bg-slate-800" />
            <div className="mt-4 flex gap-2">
              <div className="h-10 w-12 rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-10 flex-1 rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Filters: one row from sm; on a phone the search across the page and under it the category and the order, half
          each, with the refresh beside them (M1). */}
      <div id="tour-forum-filters" className="flex flex-wrap gap-2 sm:flex-nowrap sm:gap-3">
        {/* Search */}
        <form onSubmit={onSearchSubmit} className="relative basis-full sm:basis-auto sm:flex-1">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca nei dossier pubblici…"
            aria-label="Cerca nei dossier pubblici"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </form>

        {/* Category Filter */}
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <button
            onClick={() => {
              setShowCategoryDropdown(!showCategoryDropdown);
              setShowSortDropdown(false);
            }}
            aria-label={`Categoria: ${selectedCategory.label}`}
            aria-expanded={showCategoryDropdown}
            className={FILTER_BUTTON}
          >
            <Filter size={16} aria-hidden className="hidden shrink-0 sm:block" />
            {/* «Tutte» on a phone, as the dossier list's menu: half the row does not hold «Tutte le categorie». */}
            <span className="min-w-0 flex-1 truncate text-left">
              {category === 'all' ? <><span className="sm:hidden">Tutte</span><span className="hidden sm:inline">{selectedCategory.label}</span></> : selectedCategory.label}
            </span>
            <ChevronDown size={16} aria-hidden className="shrink-0" />
          </button>
          {showCategoryDropdown && (
            <div className="absolute top-full left-0 mt-1 w-max min-w-full bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 py-1 z-20">
              {CATEGORY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setCategory(option.value);
                    setShowCategoryDropdown(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                    category === option.value
                      ? 'text-primary-600 dark:text-primary-400 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <button
            onClick={() => {
              setShowSortDropdown(!showSortDropdown);
              setShowCategoryDropdown(false);
            }}
            aria-label={`Ordine: ${selectedSort.label}`}
            aria-expanded={showSortDropdown}
            className={cn(FILTER_BUTTON, 'sm:min-w-[160px]')}
          >
            <span aria-hidden className="hidden shrink-0 sm:block">{selectedSort.icon}</span>
            <span className="min-w-0 flex-1 truncate text-left">
              <span className="sm:hidden">{selectedSort.short}</span>
              <span className="hidden sm:inline">{selectedSort.label}</span>
            </span>
            <ChevronDown size={16} aria-hidden className="shrink-0" />
          </button>
          {showSortDropdown && (
            <div className="absolute top-full right-0 mt-1 w-max min-w-full bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 py-1 z-20">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setSort(option.value);
                    setShowSortDropdown(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 ${
                    sort === option.value
                      ? 'text-primary-600 dark:text-primary-400 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label="Aggiorna l'elenco"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center p-2.5 md:min-h-0 md:min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Close dropdowns on outside click */}
      {(showCategoryDropdown || showSortDropdown) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => {
            setShowCategoryDropdown(false);
            setShowSortDropdown(false);
          }}
        />
      )}

      {/* Results count; while the read travels its line is kept, empty, so the cards do not move down when it comes (P1). */}
      {loading ? (
        <p aria-hidden className="h-5" />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {pagination.total} {pagination.total === 1 ? 'dossier pubblicato' : 'dossier pubblicati'}
        </p>
      )}

      {/* The community's dossiers: on a phone their first two, VisuaLex's packs, then the rest — in fixed places, so the
          strip is never mounted again (an addition on its way keeps its state) while a new read travels. */}
      <h2 id="forum-community-dossiers" className="sr-only">
        Dalla comunità
      </h2>
      {loading
        ? skeleton(desktop ? 6 : PHONE_CARDS_BEFORE_PACKS)
        : environments.length === 0
          ? emptyState
          : cards(desktop ? environments : environments.slice(0, PHONE_CARDS_BEFORE_PACKS))}
      {!desktop && packs}
      {!desktop && (loading || environments.length > PHONE_CARDS_BEFORE_PACKS) && (
        <>
          <h2 className="sr-only">Altri dossier della comunità</h2>
          {loading ? skeleton(4) : cards(environments.slice(PHONE_CARDS_BEFORE_PACKS), PHONE_CARDS_BEFORE_PACKS)}
        </>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => onPaginate(pagination.page - 1)}
            disabled={pagination.page <= 1 || loading}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Precedente
          </button>
          <span className="px-4 py-2 text-slate-600 dark:text-slate-400">
            Pagina {pagination.page} di {pagination.pages}
          </span>
          <button
            onClick={() => onPaginate(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages || loading}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Successivo
          </button>
        </div>
      )}

      {/* On a computer VisuaLex's packs after the community's dossiers and their pages; then the most added. */}
      {desktop && packs}
      <TopEnvironmentsWidget onImport={onImport} />
    </>
  );
}

type TopState =
  | { status: 'loading' }
  | { status: 'success'; items: SharedEnvironment[] }
  | { status: 'error' };

interface TopEnvironmentsWidgetProps {
  onImport: (env: SharedEnvironment) => void;
}

// Small social-proof block listing the 3 most-added published
// dossiers. Self-contained: fetches once on mount via the existing
// `sort=mostDownloaded&limit=3` list endpoint (no backend changes). Renders
// nothing on error or when there is no download history yet.
function TopEnvironmentsWidget({ onImport }: TopEnvironmentsWidgetProps) {
  const [state, setState] = useState<TopState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    sharedEnvironmentService
      .list({ sort: 'mostDownloaded', limit: 3 })
      .then((res) => {
        if (!active) return;
        setState({ status: 'success', items: res.data });
      })
      .catch((err) => {
        console.error('TopEnvironmentsWidget: failed to load the most-added dossiers:', err);
        if (!active) return;
        setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'error') return null;

  if (state.status === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">I più aggiunti</h2>
        </div>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-9 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Only dossiers someone actually added are worth surfacing.
  const items = state.items.filter((env) => env.downloadCount > 0);
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={16} className="text-amber-500" />
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">I più aggiunti</h2>
      </div>
      <ul className="space-y-1">
        {items.map((env, idx) => (
          <li key={env.id}>
            <button
              type="button"
              onClick={() => onImport(env)}
              className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${TOUCH_TARGET_RESPONSIVE}`}
            >
              <span className="w-5 shrink-0 text-sm font-bold text-amber-700 dark:text-amber-400 text-center">{idx + 1}</span>
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                {env.title}
              </span>
              <span className="flex items-center gap-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                <Download size={12} />
                {env.downloadCount}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
