import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X, Check, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AnnexMetadata } from '../../../types';
import { useTour } from '../../../hooks/useTour';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { normalizeArticleId } from '../../../utils/treeUtils';
import type { RubrichePart } from '../../../hooks/useAnnexNavigation';
import { abrogatiFor, rubricheFor } from '../../../utils/actRubriche';
import { articleLabel, buildActTree, headingLabel, type ActTreeItem, type ActTreeNode } from '../../../utils/actTree';
import { Expand } from '../../ui/Expand';

/** Accents stripped, lowercased: a lawyer types «responsabilita» and expects «Responsabilità del debitore». */
function foldIndexLabel(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Above this many headings the tree opens collapsed, but for the way to the articles on the table. */
const COLLAPSE_THRESHOLD = 8;

export interface TreeViewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  treeData: ActTreeItem[];
  urn: string;
  /** «Struttura del Codice civile» (`structureTitle`). */
  title?: string;
  /** An article picked: its number and its part (null for the dispositivo). */
  onArticleSelect?: (articleNumber: string, targetAnnex: string | null) => void;
  /** The articles on the table, as unique ids («2043», «all2:2043»). */
  loadedArticles?: string[];
  /** The article open now, as a unique id: marked, and the list opens scrolled to it. */
  activeArticle?: string;
  /** The act's parts: with more than one, a menu chooses which the tree shows. */
  annexes?: AnnexMetadata[];
  /** The part the panel opens on: the open article's, else the act's main part (`useAnnexNavigation`). */
  currentAnnex?: string | null;
  /**
   * Rubriche keyed by article number («2043» → «Risarcimento per fatto illecito»). They arrive after the tree and are
   * partial: an article without one is its number alone.
   */
  rubriche?: Record<string, string>;
  /** Keys of the articles the act declares repealed (flat acts). */
  abrogati?: string[];
  /** Per-part titles: for an act in parts they replace `rubriche` (`utils/actRubriche.ts`). */
  rubricheParts?: RubrichePart[];
  /** The space's id, for the «Struttura» command's `aria-controls`. */
  id?: string;
}

interface Row {
  node: ActTreeNode;
  depth: number;
}

/** The headings' keys under `nodes` that hold an article `holds` says yes to. */
function headingsHolding(nodes: ActTreeNode[], holds: (numero: string) => boolean, into = new Set<string>()): boolean {
  let any = false;
  for (const node of nodes) {
    if (node.type === 'article') {
      if (holds(node.numero)) any = true;
    } else if (headingsHolding(node.children, holds, into)) {
      into.add(node.key);
      any = true;
    }
  }
  return any;
}

function filterTree(nodes: ActTreeNode[], keep: (numero: string) => boolean): ActTreeNode[] {
  return nodes.flatMap((node): ActTreeNode[] => {
    if (node.type === 'article') return keep(node.numero) ? [node] : [];
    const children = filterTree(node.children, keep);
    return children.length ? [{ ...node, children }] : [];
  });
}

function countArticles(nodes: ActTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.type === 'article' ? 1 : countArticles(node.children)), 0);
}

function countHeadings(nodes: ActTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.type === 'heading' ? 1 + countHeadings(node.children) : 0), 0);
}

/**
 * The act's structure (LC71): its title, the part when it has several, a filter, and the tree of books, titles and
 * chapters with each article as «Art. 2043 · Risarcimento per fatto illecito». A pick opens the article on the table
 * and leaves the index open. LC77: no longer a window over the table nor a dialog on a phone, but a space in the act's
 * own card (`Expand`), opening under its heading and pushing the text down. The filter has the focus on opening, the
 * arrows walk the list, Esc empties the filter and then closes, giving the focus back to what opened it.
 */
export function TreeViewPanel({
  isOpen,
  onClose,
  treeData,
  title = 'Struttura',
  onArticleSelect,
  loadedArticles = [],
  activeArticle,
  annexes,
  currentAnnex,
  rubriche,
  abrogati,
  rubricheParts,
  id,
}: TreeViewPanelProps) {
  // The part chosen in the menu; undefined follows `currentAnnex`.
  const [selectedAnnex, setSelectedAnnex] = useState<string | null | undefined>(undefined);
  const [filterQuery, setFilterQuery] = useState('');
  // Open/closed choices, keyed by part and heading so a part does not inherit another's.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const { tryStartTour } = useTour();
  const isDesktop = useIsDesktop();
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  const selectId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = setTimeout(() => tryStartTour('treeView'), 300);
    return () => clearTimeout(timer);
  }, [isOpen, tryStartTour]);

  // A new act, a reopened panel: no inherited part, filter or open headings (gotcha 11). Not on closing: the index
  // fades out as it was, not reset under the reader's eyes.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedAnnex(undefined);
    setFilterQuery('');
    setOverrides({});
  }, [currentAnnex, isOpen]);

  // The focus is the space's (`Expand`): to the filter on opening, back to the opener on closing.
  useEffect(() => {
    if (!isOpen) scrolledRef.current = false;
  }, [isOpen]);

  const effectiveAnnex = selectedAnnex !== undefined ? selectedAnnex : (currentAnnex ?? null);
  const showAnnexes = !!annexes && annexes.length > 1;
  const annexInfo = annexes?.find((a) => a.number === effectiveAnnex);

  const tree = useMemo<ActTreeNode[]>(() => {
    const built = buildActTree(treeData ?? [], effectiveAnnex, annexes?.map((a) => a.label));
    // No headings in this part: the part's own list, when the metadata has it, is the fuller one.
    if (countHeadings(built) === 0 && annexInfo?.article_numbers?.length) {
      return annexInfo.article_numbers.map((numero) => ({ type: 'article' as const, numero }));
    }
    return built;
  }, [treeData, effectiveAnnex, annexes, annexInfo]);

  const loadedSet = useMemo(() => new Set(loadedArticles.map(normalizeArticleId)), [loadedArticles]);
  // «Art. 1» of Allegato 1 («all1:1») is never «Art. 1» of the dispositivo («1»).
  const uniqueId = (numero: string) => (effectiveAnnex ? `all${effectiveAnnex}:${numero}` : numero);
  const isLoaded = (numero: string) => loadedSet.has(normalizeArticleId(uniqueId(numero)));
  const activeId = activeArticle ? normalizeArticleId(activeArticle) : null;
  const isActive = (numero: string) => activeId !== null && normalizeArticleId(uniqueId(numero)) === activeId;

  // Which titles belong to the part on screen: `utils/actRubriche.ts`. Keyed as article numbers are compared, so
  // «1-bis» finds a rubrica stored under «1 bis» (gotcha 9).
  const partNumbers = annexInfo?.article_numbers ?? null;
  const rubricheNormalized = useMemo(
    () => rubricheFor({ rubriche, parts: rubricheParts }, partNumbers),
    [rubriche, rubricheParts, partNumbers],
  );
  const abrogatiNormalized = useMemo(
    () => abrogatiFor({ abrogati, parts: rubricheParts }, partNumbers),
    [abrogati, rubricheParts, partNumbers],
  );
  const rubricaFor = (numero: string) => rubricheNormalized[normalizeArticleId(numero)] ?? '';
  const isAbrogato = (numero: string) => abrogatiNormalized.has(normalizeArticleId(numero));

  const query = foldIndexLabel(filterQuery.trim());
  const isFiltering = query.length > 0;
  const shown = useMemo(() => {
    if (!isFiltering) return tree;
    return filterTree(tree, (numero) =>
      foldIndexLabel(numero).startsWith(query)
      || foldIndexLabel(rubricheNormalized[normalizeArticleId(numero)] ?? '').includes(query)
      || (abrogatiNormalized.has(normalizeArticleId(numero)) && 'abrogato'.includes(query)));
  }, [tree, isFiltering, query, rubricheNormalized, abrogatiNormalized]);

  const collapsedByDefault = countHeadings(tree) > COLLAPSE_THRESHOLD;
  // Where the reader already is stays open: the headings over the articles on the table and the open one.
  const openByDefault = useMemo(() => {
    const keys = new Set<string>();
    headingsHolding(tree, (numero) => isLoaded(numero) || isActive(numero), keys);
    return keys;
    // isLoaded and isActive read these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, loadedSet, activeId, effectiveAnnex]);
  const overrideKey = (key: string) => `${effectiveAnnex ?? 'main'}::${key}`;
  const isExpanded = (key: string) => {
    if (isFiltering) return true;
    const override = overrides[overrideKey(key)];
    if (override !== undefined) return override;
    return !collapsedByDefault || openByDefault.has(key);
  };
  const toggle = (key: string, expanded: boolean) => setOverrides((prev) => ({ ...prev, [overrideKey(key)]: !expanded }));

  const rows: Row[] = [];
  const walk = (nodes: ActTreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.type === 'heading' && isExpanded(node.key)) walk(node.children, depth + 1);
    }
  };
  walk(shown, 0);

  // A new filter shows its matches from the top.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filterQuery]);

  // Once per opening, the open article in view; rubriche landing later do not scroll again.
  const treeReady = tree.length > 0;
  useEffect(() => {
    if (!isOpen || !treeReady || scrolledRef.current) return;
    scrolledRef.current = true;
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="true"]');
    // The list's own scroll, not `scrollIntoView`: in the page's flow that would move the page too.
    if (list && current) list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
  }, [isOpen, treeReady]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      // The first Esc empties a filled filter; the next is the space's, which closes it.
      if (filterQuery) {
        e.preventDefault();
        e.stopPropagation();
        setFilterQuery('');
        filterRef.current?.focus();
      }
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? []);
    const at = list.indexOf(e.target as HTMLElement);
    // From the filter or a row only: the part's menu keeps its own arrows.
    if (!list.length || (at === -1 && e.target !== filterRef.current)) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, list.length - 1) : at - 1;
    if (next < 0) filterRef.current?.focus();
    else list[next].focus();
  };

  // On a phone, rows and fields a finger can hit.
  const drawer = !isDesktop;
  const rowHeight = drawer ? 'min-h-[44px] py-2' : 'min-h-8 py-1';
  const ROW_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500';

  // One Tab stop in the list (the open article's row, else the first); the arrows walk it.
  const activeRow = rows.findIndex(({ node }) => node.type === 'article' && isActive(node.numero));
  const tabStop = activeRow === -1 ? 0 : activeRow;

  const renderRow = ({ node, depth }: Row, index: number): ReactNode => {
    const indent = { paddingLeft: 8 + depth * 14 };
    const tabIndex = index === tabStop ? 0 : -1;
    if (node.type === 'heading') {
      const expanded = isExpanded(node.key);
      return (
        <div
          key={node.key}
          role="button"
          tabIndex={tabIndex}
          data-tree-row
          aria-expanded={expanded}
          onClick={() => toggle(node.key, expanded)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowRight' && !expanded) || (e.key === 'ArrowLeft' && expanded)) {
              e.preventDefault();
              toggle(node.key, expanded);
            }
          }}
          style={indent}
          className={cn(
            'flex w-full cursor-pointer select-none items-start gap-1.5 rounded-md pr-2 text-left text-sm font-medium leading-snug text-slate-800 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/70',
            rowHeight,
            ROW_FOCUS,
          )}
        >
          <ChevronRight
            size={14}
            aria-hidden
            className={cn('mt-[3px] shrink-0 text-slate-400 transition-transform duration-150', expanded && 'rotate-90')}
          />
          <span className="min-w-0 flex-1">{headingLabel(node.title)}</span>
        </div>
      );
    }
    const { numero } = node;
    const loaded = isLoaded(numero);
    const active = isActive(numero);
    const clickable = !!onArticleSelect && !loaded;
    const rubrica = rubricaFor(numero);
    const tail = rubrica || (isAbrogato(numero) ? 'abrogato' : '');
    return (
      <button
        key={`a${index}-${numero}`}
        type="button"
        tabIndex={tabIndex}
        data-tree-row
        onClick={() => clickable && onArticleSelect(numero, effectiveAnnex)}
        // aria-disabled, not disabled: a loaded row stays in the tab order and keeps its tooltip (the rubrica is cut
        // to one line). The click is guarded instead.
        aria-disabled={!clickable}
        aria-current={active ? 'true' : undefined}
        title={rubrica || undefined}
        style={indent}
        className={cn(
          'flex w-full items-baseline gap-1.5 rounded-md pr-2 text-left text-sm transition-colors',
          rowHeight,
          ROW_FOCUS,
          // The open article: a firmer ground than the hover's and a rule on its left edge, in the text's ink.
          active
            ? 'bg-slate-200 text-slate-900 shadow-[inset_2px_0_0_currentColor] dark:bg-slate-700/80 dark:text-white'
            : loaded
              ? 'cursor-default text-slate-700 dark:text-slate-300'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70',
        )}
      >
        {/* The number never shrinks: «Art. 2409-octiesdecies» widens its row instead of spilling out of it. */}
        <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-slate-900 dark:text-slate-100">
          {articleLabel(numero)}
        </span>
        {/* The spaces make the name «Art. 2043 Risarcimento per fatto illecito»; the dot is for the eye. */}
        {tail && (
          <>
            {' '}
            <span aria-hidden className="shrink-0 text-slate-400 dark:text-slate-500">·</span>
            {' '}
            <span className={cn('min-w-0 flex-1 truncate', rubrica ? 'text-slate-600 dark:text-slate-400' : 'italic text-slate-500 dark:text-slate-400')}>
              {tail}
            </span>
          </>
        )}
        {loaded && !active && (
          <>
            <span className="sr-only">, sul tavolo</span>
            <Check size={13} aria-hidden className="ml-auto shrink-0 self-center text-slate-400" />
          </>
        )}
      </button>
    );
  };

  const fieldHeight = drawer ? 'min-h-[44px] text-base' : 'h-8 text-sm';
  const FIELD = cn(
    'w-full rounded-md border border-slate-300 bg-transparent px-2 text-slate-800 dark:border-slate-600 dark:text-slate-100',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
    fieldHeight,
  );
  const matched = isFiltering ? countArticles(shown) : 0;

  const panelBody = (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 py-1.5 pl-4 pr-1.5 dark:border-slate-800">
        <h4 id={titleId} className="min-w-0 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">{title}</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi la struttura"
          title="Chiudi la struttura"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
            drawer ? 'h-11 w-11' : 'h-8 w-8',
            ROW_FOCUS,
          )}
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        {showAnnexes && (
          <>
            <label htmlFor={selectId} className="sr-only">Parte dell'atto</label>
            {/* The parts in the act's order, by their whole names. */}
            <select
              id={selectId}
              value={effectiveAnnex ?? ''}
              onChange={(e) => setSelectedAnnex(e.target.value === '' ? null : e.target.value)}
              className={cn(FIELD, 'cursor-pointer dark:bg-slate-900')}
            >
              {annexes!.map((annex) => (
                <option key={annex.number ?? 'main'} value={annex.number ?? ''}>
                  {headingLabel(annex.label)}
                </option>
              ))}
            </select>
          </>
        )}
        <input
          ref={filterRef}
          type="text"
          role="searchbox"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Filtra per numero o rubrica"
          aria-label="Filtra gli articoli per numero o rubrica"
          autoComplete="off"
          spellCheck={false}
          className={FIELD}
        />
        {isFiltering && (
          <p role="status" aria-live="polite" className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {matched} di {countArticles(tree)}
          </p>
        )}
      </div>

      <div ref={listRef} aria-label="Indice dell'atto" role="group" className="relative min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {!treeReady ? (
          <p className="px-2 py-6 text-sm text-slate-500 dark:text-slate-400">Struttura non ancora disponibile</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-sm text-slate-500 dark:text-slate-400">Nessun articolo corrisponde al filtro</p>
        ) : (
          rows.map(renderRow)
        )}
      </div>
    </>
  );

  return (
    <Expand id={id} open={isOpen} onClose={onClose} initialFocusRef={filterRef} onKeyDown={onKeyDown}>
      {/* In the card, between its heading and its text: a list as long as the c.c.'s scrolls inside its own height. */}
      <section
        aria-labelledby={titleId}
        className={cn(
          'my-2 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
          drawer ? 'max-h-[70vh]' : 'max-h-[min(60vh,32rem)]',
        )}
      >
        {panelBody}
      </section>
    </Expand>
  );
}
