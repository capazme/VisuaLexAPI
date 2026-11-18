import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, FileDown, FolderMinus, GitBranch, GripVertical, Loader2, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { DRAG_ROLE_DESCRIPTION } from './dragAnnouncements';
import { CSS } from '@dnd-kit/utilities';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData, Norma } from '../../../types';
import { MenuButton } from '../../ui/MenuButton';
import { useSimpleReading } from './simpleReading';
import { removePracticeActWithUndo } from './practiceUndo';
import { articleItemIds, useActItemIds } from './inDossier';
import { removeItemsWithUndo } from '../dossier/removeItemsWithUndo';
import { Z_INDEX } from '../../../constants/zIndex';
import { HIDDEN_SCROLLBAR } from '../../../constants/interactions';
import { TreeViewPanel } from '../search/TreeViewPanel';
import { AnnexSuggestion } from '../search/AnnexSuggestion';
import { ArticleNavigation } from '../workspace/ArticleNavigation';
import { LazyStudyMode as StudyMode } from '../workspace/LazyStudyMode';
import { articleLabel, layoutDossier, shownAnnex } from '../dossier/dossierLayout';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { matchesQuery, useFontiTools } from './fontiTools';
import { useActDetails } from '../dossier/useActDetails';
import { PracticeArticleRow } from './PracticeArticleRow';
import { PracticeArticleEntry } from './PracticeIndexEntry';
import type { PracticeLayout } from './PracticeColumn';
import { PRACTICE_VT, practiceTransitionName } from './practiceSwitch';
import { useAnnexNavigation } from '../../../hooks/useAnnexNavigation';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { useTour } from '../../../hooks/useTour';
import { formatNormaMeta } from '../../../utils/normaMeta';
import { actHeading } from '../../../utils/sources';
import { READ_ONLY_REASON, describeVersion, historicalItemLabel } from '../../../utils/versionDisplay';
import { filterLoadedIdsForAnnex, getUniqueArticleId } from '../../../utils/articleIds';
import { structureTitle } from '../../../utils/actTree';
import { findPracticeArticle, isBoundPractice, practiceArticleKey, type PracticeAct } from '../../../utils/practice';

export interface PracticeActBlockProps {
  practiceId: string;
  act: PracticeAct;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  /** The phone's section, the overview's panel or the index's entry (U2, `PracticeColumn`). */
  layout: PracticeLayout;
}

/**
 * The act's tools (R3): quiet buttons, neutral, the icon and (from `lg`) the word — no colour of their own, as the
 * article's actions; 36 px, on a computer only (a phone has them in «⋯»). The 44 px below `md` is for a narrow window.
 */
const TOOL_BUTTON =
  'vlx-hover-tile flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 md:h-9 md:min-h-0 md:min-w-0 dark:text-slate-300 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40';
const MENU_TRIGGER =
  'vlx-hover-tile flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-slate-600 transition-colors hover:text-slate-900 md:h-9 md:min-h-0 md:min-w-0 dark:text-slate-300';

/** A row's chip in the act's index: «2043», «All. A 1», «5 · testo al 29/12/2007». */
function chipLabel(article: ArticleData): string {
  const annex = shownAnnex(article.norma_data);
  const number = annex ? `All. ${annex} ${article.norma_data.numero_articolo}` : article.norma_data.numero_articolo;
  const past = historicalItemLabel(article.norma_data);
  return past ? `${number} · ${past.charAt(0).toLowerCase()}${past.slice(1)}` : number;
}

/**
 * One act on the practice's table (spec §3.2), shaped like the dossier's `DossierActBlock`: the
 * heading with its tools (Studio, Struttura, PDF, «⋯»), an index of the act's rows on top, then the
 * rows one under the other. In the overview (U2) it is a panel of the grid, its tools beside its title; in the reading
 * view's index, its heading with «⋯» (the tools inside it, as on a phone) and its articles one entry a line, each
 * opening beside. The structure (LC77) opens in the block, between its heading and its rows: on a computer when the store
 * names this act (`structureWindow.blockId`), on a phone when toggled here or named by the store.
 */
export function PracticeActBlock({ practiceId, act, onViewPdf, onCrossReference, layout }: PracticeActBlockProps) {
  const {
    toggleActCollapse, revealPracticeArticle, revealPracticeRow, addArticlesToPractice,
    openStructureWindow, closeStructureWindow,
  } = useAppStore(useShallow((s) => ({
    toggleActCollapse: s.toggleActCollapse,
    revealPracticeArticle: s.revealPracticeArticle,
    revealPracticeRow: s.revealPracticeRow,
    addArticlesToPractice: s.addArticlesToPractice,
    openStructureWindow: s.openStructureWindow,
    closeStructureWindow: s.closeStructureWindow,
  })));
  const isStructureWindowOpen = useAppStore((s) => s.structureWindow.blockId === act.id);
  // The act's open rows, oldest first: a reveal moves its row to the end (`revealRow`).
  const prefix = `${practiceId}/${act.id}/`;
  const openKeys = useAppStore(useShallow((s) => Object.keys(s.practiceRows)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))));
  const isDesktop = useIsDesktop();
  const { simple, practiceItems, tableName } = useSimpleReading();
  const isIndex = layout === 'index';
  const isPanel = layout === 'overview';
  // Studio, Struttura and PDF as buttons beside the title: the overview's panel; on a phone and in the index they are
  // entries of «⋯».
  const toolsShown = isDesktop && !isIndex;
  // The act's tour, on the practice's first act and once the table's own tour has been seen (when it
  // is done it hands over to this one, `PracticeTable`). Asked once: `tryStartTour` is new each render.
  const isFirstAct = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.acts[0]?.id === act.id);
  // The table's only act (LC70): nothing to reorder, and folding it would leave its heading alone; as in Lettura
  // semplice, no grip and no fold, whatever its articles. The index keeps its heading as an entry among the others.
  const alone = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.acts.length === 1) && !isIndex;
  const plain = simple || alone;
  // A dossier's table (LC54): no tour of the practice, and no other practice to move an act to.
  const bound = useAppStore((s) => s.practices.some((p) => p.id === practiceId && isBoundPractice(p)));
  // In a dossier's «Lettura» (LC55): the act's articles in the dossier. With some, «Rimuovi l'atto» becomes «Togli dal
  // dossier» (to the trash, with «Annulla»; the rows stay on the table): a removal from the table alone would come back
  // with the next re-sync.
  const { dossier: hostDossier, ids: dossierIds } = useActItemIds(act);
  // In a dossier's «Fonti» (LC86) a closed row has no text yet: its rubric comes from the act's index, read once per
  // act as the old list read it (`useActDetails`).
  const heldDossier = useAppStore((s) => (hostDossier ? s.dossiers.find((d) => d.id === hostDossier.id) : undefined));
  const dossierItems = heldDossier?.items;
  const dossierBlock = useMemo(() => (dossierItems ? layoutDossier(dossierItems).acts.find((a) => a.key === act.key) : undefined), [dossierItems, act.key]);
  const { rubricaOf, title: actTitle } = useActDetails(dossierBlock);
  // «Fonti»'s filter (LC88): the act by its name shows all its rows; else a row by its number, its rubric or the text of
  // the dossier's notes about it. An act left with no row closes, until the filter changes.
  const tools = useFontiTools();
  const query = tools?.query ?? '';
  const shownArticles = useMemo(() => {
    if (!query || matchesQuery(query, actHeading(act.norma), actTitle)) return act.articles;
    return act.articles.filter((article) => {
      const text = article.article_text;
      const rubrica = (text ? getRubricText(text, parseArticleStructure(text)) : null) ?? rubricaOf(article.norma_data);
      const ids = new Set(articleItemIds(heldDossier, article.norma_data));
      const notes = (dossierItems ?? []).filter((i) => i.type === 'note' && i.aboutItemId && ids.has(i.aboutItemId)).map((i) => String(i.data));
      return matchesQuery(query, articleLabel(article.norma_data), article.norma_data.numero_articolo, rubrica, ...notes);
    });
  // `rubricaOf` is new on each render; the act's title stands for what it reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, act.articles, act.norma, actTitle, heldDossier, dossierItems]);
  const report = tools?.report;
  useEffect(() => { report?.(act.id, shownArticles.length, act.articles.length); }, [report, act.id, shownArticles.length, act.articles.length]);
  useEffect(() => () => report?.(act.id, 0, 0), [report, act.id]);
  const folded = act.isCollapsed || (query !== '' && shownArticles.length === 0);
  // A separator only under a command: on a computer an act has none above its removal (the tests of 16-11; LC60: the
  // Ricerca's act lost «Sposta in un'altra pratica»).
  const commandsAbove = !toolsShown;
  const theme = useAppStore((s) => s.settings.theme);
  const { tryStartTour, hasSeenTour } = useTour({ theme: theme as 'light' | 'dark' });
  const tourAsked = useRef(false);
  useEffect(() => {
    // Not from the index: its steps point at the panel's tools, its index line and a row's «Apri accanto».
    if (!isFirstAct || isIndex || bound || tourAsked.current || !hasSeenTour('practice')) return;
    tourAsked.current = true;
    tryStartTour('practiceAct');
  });
  const [drawerToggled, setDrawerToggled] = useState(false);
  // On a phone the index is the drawer (§8). «Apri l'indice e sfoglia» points the structure window at
  // the act it drops (§5.1): on a phone that request opens this act's drawer too.
  const drawerOpen = drawerToggled || (!isDesktop && isStructureWindowOpen);
  const structureOpen = isDesktop ? isStructureWindowOpen : drawerOpen;
  const structureId = useId();
  const closeDrawer = () => {
    setDrawerToggled(false);
    if (isStructureWindowOpen) closeStructureWindow();
  };
  // The row Study Mode shows while it is open; null, closed.
  const [studyKey, setStudyKey] = useState<string | null>(null);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: act.id, attributes: { roleDescription: DRAG_ROLE_DESCRIPTION } });

  const heading = actHeading(act.norma);
  const byKey = useMemo(() => new Map(act.articles.map((a) => [practiceArticleKey(a), a])), [act.articles]);
  // The row the block reads from (Studio, the arrows, the annex): the last one opened, else the first. Only an open one
  // is the index's current chip (LC70): one chip marked, not every open row.
  const activeKey = useMemo(() => {
    for (let i = openKeys.length - 1; i >= 0; i--) {
      if (byKey.has(openKeys[i])) return openKeys[i];
    }
    return null;
  }, [openKeys, byKey]);
  const current = (activeKey && byKey.get(activeKey)) || act.articles[0];
  const studyArticle = (studyKey && byKey.get(studyKey)) || current;
  // Study Mode's tools write notes keyed by the article, not the version: never on a past text (gotcha 32).
  const isLocked = (article: ArticleData | undefined) =>
    !article || describeVersion(article.validity, article.norma_data).readOnly;
  const studyLocked = isLocked(current);
  // Study Mode steps over, and resolves a number against, the rows it may write on: a past text
  // sorts next to its text in force and would shadow it (gotcha 32).
  const studyRows = useMemo(
    () => act.articles.filter((a) => !describeVersion(a.validity, a.norma_data).readOnly),
    [act.articles],
  );
  // The heading's height, for the open rows' reading toolbars to pin under it (from `md`; a long title wraps it).
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return undefined;
    const measure = () => setHeaderHeight(node.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A loaded article lands in this act and its row opens (spec §6.4).
  const landInAct = useCallback((norma: Norma, loaded: ArticleData[]) => {
    addArticlesToPractice(practiceId, norma, loaded, { reveal: 'first' });
  }, [addArticlesToPractice, practiceId]);
  const {
    treeData, treeMetadata, rubriche, abrogati, rubricheParts, currentAnnex, allArticleIds,
    loadingArticle, fetchTree, handleAnnexSelect, handleLoadArticle, loadedArticleIds,
  } = useAnnexNavigation({ norma: act.norma, articles: act.articles, addArticles: landInAct, activeArticle: current });

  // An index pick, an arrow, Study Mode: a row already holding the article is revealed, and only an
  // article not on the table is fetched (T2). `targetAnnex` null = the body, undefined = the current annex.
  const openArticle = (articleNumber: string, targetAnnex?: string | null) => {
    const annex = targetAnnex !== undefined ? targetAnnex : currentAnnex;
    if (revealPracticeArticle(practiceId, act.id, annex ? `all${annex}:${articleNumber}` : articleNumber)) return;
    handleLoadArticle(articleNumber, targetAnnex);
  };

  const toggleStructure = () => {
    if (isDesktop) {
      if (isStructureWindowOpen) closeStructureWindow();
      else openStructureWindow(act.id);
    } else if (drawerOpen) {
      closeDrawer();
    } else {
      setDrawerToggled(true);
    }
    if (!treeData) fetchTree();
  };

  const openStudy = (article: ArticleData | undefined) => {
    if (!isLocked(article)) setStudyKey(practiceArticleKey(article as ArticleData));
  };

  const annexes = treeMetadata?.annexes && treeMetadata.annexes.length > 1 ? treeMetadata.annexes : null;
  const showNavigation = (allArticleIds && allArticleIds.length > 1) || act.articles.length > 1;
  // Where the selector stands (LC70, Luca): with one article at the end of its status line, the rule under both; with
  // more, on a computer, at the right of the act's heading; on a phone with more, first in the index's line.
  const navigation = (className: string) => (
    <ArticleNavigation
      className={className}
      allArticleIds={allArticleIds}
      loadedArticleIds={filterLoadedIdsForAnnex(loadedArticleIds, currentAnnex)}
      activeArticleId={current?.norma_data.numero_articolo || null}
      loadingArticleId={loadingArticle}
      onNavigate={(number) => {
        revealPracticeArticle(practiceId, act.id, currentAnnex ? `all${currentAnnex}:${number}` : number);
      }}
      onLoadArticle={(number) => openArticle(number)}
    />
  );
  const loadingStatus = loadingArticle && (
    <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
      <Loader2 size={12} aria-hidden className="animate-spin text-primary-600 dark:text-primary-400" />
      Caricamento…
    </span>
  );
  const navInHead = showNavigation && !simple && toolsShown;
  const statusEnd = simple && (showNavigation || loadingArticle)
    ? <>{loadingStatus}{showNavigation && navigation('-mr-3 shrink-0 md:-mr-1')}</>
    : undefined;

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        // Read by an open row's reading toolbar (`--reading-toolbar-top`) and by the rows' scroll margin;
        // 0 on a phone, where the heading scrolls with the block, and in the index, which pins nothing.
        ['--practice-head' as string]: `${isDesktop && !isIndex ? headerHeight : 0}px`,
        // The panel and the index's entry are one piece of the passage between the views (L-62).
        ...(layout !== 'phone' ? { ['--vlx-vt' as string]: practiceTransitionName('practice-act', act.id) } : {}),
      }}
      aria-label={heading}
      data-layout={layout}
      // Found by the passage between the views (`practiceSwitch`) to give its heading the focus.
      data-act-id={act.id}
      // A section of the page (R3: one level of paper, the practice's): its title and a hairline. In the overview's grid
      // a panel (U2): a hairline box on the page's own ground, no shadow.
      className={cn('practice-act', isPanel && 'rounded-xl border border-slate-200 px-3 pb-2 dark:border-slate-800', layout !== 'phone' && PRACTICE_VT)}
    >
      {/* The sticky-row convention: opaque — the page's own ground —, over the rows it heads (and over an open
          row's sticky toolbar, which slides up under it as the row ends). */}
      <header
        ref={headerRef}
        // Pinned at the top of its column from `md`: the find window opens under it (`ReadingRow`).
        data-pinned-head
        className={cn(
          // One row: on a phone the title (wrapping) and «⋯», which holds Studio, Struttura and PDF (R3: the text
          // first; four 44 px buttons took a row of their own), from `md` the tools beside it. Sticky from `md`
          // only: on a phone, with an open row's toolbar pinned under it, the two took half the screen. In the index
          // it pins nothing: the acts are a few lines each, and their headings would stack.
          'practice-act-head relative flex items-start gap-1 border-slate-200 bg-slate-50 py-1 md:items-center md:gap-2 dark:border-slate-800 dark:bg-slate-950',
          // Lettura semplice (LC70): the one rule is under the status line and the selector, not here.
          !simple && 'border-b',
          isIndex ? 'md:py-1' : cn('md:sticky md:top-0 md:py-2', Z_INDEX.stickyHead),
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Sposta ${heading}`}
          // Lettura semplice (LC28): one act, nothing to reorder.
          // 44 px to grab on a computer too (LC86); its reach goes into the panel's margin, the grip where it was.
          className={cn(plain ? 'hidden' : 'hidden md:flex', 'min-h-[44px] min-w-[44px] items-center justify-center rounded text-slate-300 hover:text-slate-500 md:-my-2 md:-ml-3 md:-mr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-600')}
        >
          <GripVertical size={18} aria-hidden />
        </button>
        {/* In the overview the title gives way and the tools follow it, not the row's far end (U2). */}
        <div className={cn('min-w-0 flex-1 py-1', isPanel && 'md:flex-initial')}>
          {/* One act (LC68): the table's name, small, over the act's title; the act's head is the only one. */}
          {!isIndex && tableName}
          {/* The accordion pattern: the heading holds the toggle, its name is the act's own words. */}
          <h3 className="min-w-0">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!folded}
              onClick={() => toggleActCollapse(practiceId, act.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleActCollapse(practiceId, act.id);
                }
              }}
              // The act's title, in the reader's serif (R3): 22 px; 17 px in the index, a heading among its entries.
              className={cn(
                'flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 rounded-md font-serif font-medium leading-tight text-slate-900 md:min-h-0 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                isIndex ? 'text-[17px]' : 'text-[22px]',
              )}
            >
              {!plain && (
                <ChevronDown
                  size={16}
                  aria-hidden
                  className={cn('flex-shrink-0 text-slate-400 transition-transform', folded && '-rotate-90')}
                />
              )}
              {/* A cut act name says nothing: on a phone it wraps; on a computer, cut beside the tools or in the index, its
                  tooltip says it whole. */}
              <span title={isDesktop ? heading : undefined} className="min-w-0 break-words md:truncate">{heading}</span>
            </div>
          </h3>
          {/* On a phone only what the count does not say: the act's articles are its rows and its index, just below. The
              index says neither: its entries are the articles. */}
          {!isIndex && (
            <p className={cn(plain ? 'ml-0' : 'ml-6', 'truncate text-sm text-slate-600 dark:text-slate-400', !formatNormaMeta(act.norma) && 'hidden md:block')}>
              {formatNormaMeta(act.norma, act.articles.length)}
            </p>
          )}
        </div>
        {/* `mt-1` on a phone: «⋯» level with the title's 44 px line, not with the column's top; `-mr-3`: its 44 px reach
            into the page's margin, as every icon on the column's right edge (R3b). */}
        <div className={cn('-mr-3 mt-1 flex flex-shrink-0 items-center gap-1 md:mr-0 md:mt-0', !isPanel && 'ml-auto')}>
          {/* The tools in the overview; on a phone and in the index they are entries of «⋯» (below), not drawn at all. */}
          {navInHead && navigation('shrink-0')}
          {toolsShown && <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openStudy(current)}
              disabled={studyLocked}
              title={current && studyLocked ? `Modalità studio: ${READ_ONLY_REASON}` : 'Modalità studio'}
              aria-label="Modalità studio"
              className={cn(TOOL_BUTTON, 'practice-act-study')}
            >
              <BookOpen size={16} aria-hidden />
              <span className="hidden lg:inline">Studio</span>
            </button>
            {act.norma.urn && (
              <>
                <button
                  type="button"
                  onClick={toggleStructure}
                  aria-label="Struttura della norma"
                  // It opens a space (the index): expanded, not pressed (R3b).
                  aria-expanded={structureOpen}
                  aria-controls={structureId}
                  className={cn(TOOL_BUTTON, 'practice-act-structure aria-expanded:bg-ink-300/70 aria-expanded:text-slate-900 dark:aria-expanded:bg-ink-700/60 dark:aria-expanded:text-white')}
                >
                  <GitBranch size={16} aria-hidden />
                  {/* Its name, loading or not (LC86): the tree's arrival shows in the space it opens. */}
                  <span className="hidden lg:inline">Struttura</span>
                </button>
                <button
                  type="button"
                  onClick={() => onViewPdf(act.norma.urn as string)}
                  aria-label="Esporta PDF della norma"
                  className={TOOL_BUTTON}
                >
                  <FileDown size={16} aria-hidden />
                  <span className="hidden lg:inline">PDF</span>
                </button>
              </>
            )}
          </div>}
          <MenuButton
            label={`Azioni su ${heading}`}
            triggerClassName={MENU_TRIGGER}
            items={[
              ...(toolsShown ? [] : [
                {
                  label: 'Modalità studio',
                  icon: BookOpen,
                  onSelect: () => openStudy(current),
                  disabled: studyLocked,
                  description: current && studyLocked ? READ_ONLY_REASON : undefined,
                },
                ...(act.norma.urn ? [
                  { label: 'Struttura della norma', icon: GitBranch, onSelect: toggleStructure },
                  { label: 'Esporta PDF della norma', icon: FileDown, onSelect: () => onViewPdf(act.norma.urn as string) },
                ] : []),
              ]),
              hostDossier && dossierIds.length > 0
                ? {
                  label: 'Togli dalla pratica', icon: FolderMinus, danger: true, separatorBefore: commandsAbove,
                  onSelect: () => removeItemsWithUndo(hostDossier.id, dossierIds, dossierIds.length === 1
                    ? 'Articolo tolto dalla pratica' : `${dossierIds.length} articoli tolti dalla pratica`, hostDossier.onTrashChanged),
                }
                : { label: "Rimuovi l'atto", icon: Trash2, danger: true, separatorBefore: commandsAbove, onSelect: () => removePracticeActWithUndo(practiceId, act.id) },
              ...practiceItems,
            ]}
          >
            <MoreHorizontal size={18} aria-hidden />
          </MenuButton>
        </div>
      </header>

      {/* The index (LC77): in the card, under its heading, pushing the rows down; it does not close on a pick. Outside
          the folded part: a folded act still opens its structure. */}
      <TreeViewPanel
        id={structureId}
        isOpen={structureOpen}
        onClose={isDesktop ? closeStructureWindow : closeDrawer}
        treeData={treeData || []}
        urn={act.norma.urn || ''}
        title={structureTitle(heading)}
        loadedArticles={loadedArticleIds}
        activeArticle={current ? getUniqueArticleId(current) : undefined}
        onArticleSelect={(articleNumber, targetAnnex) => openArticle(articleNumber, targetAnnex)}
        annexes={treeMetadata?.annexes}
        currentAnnex={currentAnnex}
        rubriche={rubriche}
        abrogati={abrogati}
        rubricheParts={rubricheParts}
      />

      {!folded && isIndex && (
        <div className="py-1">
          {shownArticles.length > 0 && (
            <ul aria-label={`Articoli sul tavolo di ${heading}`} className="space-y-0.5">
              {shownArticles.map((article) => (
                <PracticeArticleEntry key={practiceArticleKey(article)} practiceId={practiceId} actId={act.id} article={article} />
              ))}
            </ul>
          )}
          {loadingArticle && (
            <span role="status" aria-live="polite" className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              <Loader2 size={12} aria-hidden className="animate-spin text-primary-600 dark:text-primary-400" />
              Caricamento…
            </span>
          )}
          {act.articles.length === 0 && !loadingArticle && act.norma.urn && (
            <button
              type="button"
              onClick={toggleStructure}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <Plus size={13} aria-hidden /> Scegli un articolo dalla struttura
            </button>
          )}
        </div>
      )}

      {!folded && !isIndex && (
        <div className="py-1">
          {/* The index on top (D3): one chip per row, then the act's arrows. */}
          {/* Lettura semplice (LC70): no line of its own; the selector and the loading are in the status line. */}
          {!simple && ((act.articles.length > 1 && !hostDossier) || loadingArticle || (showNavigation && !navInHead)) && (
            // On a phone one row: the chips scroll sideways beside the arrows (R3: two rows of chips came before the text).
            // The arrows first, the left arrow's glyph on the text's edge (LC68: no empty half row before them).
            <div className="flex items-center gap-x-3 gap-y-1 py-1 md:flex-wrap md:py-1.5">
              {showNavigation && !navInHead && navigation('-ml-3 shrink-0 md:-ml-1')}
              {/* A compact index, with more than one article: one alone says nothing it does not say below (R3). */}
              {/* Not in a dossier's «Fonti» (LC86): its rows are right below, the chips would repeat them. */}
              {act.articles.length > 1 && !hostDossier && (
                <ul aria-label={`Articoli sul tavolo di ${heading}`} className={cn('practice-act-index flex min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex-wrap md:overflow-visible', HIDDEN_SCROLLBAR)}>
                  {act.articles.map((article) => {
                    const key = practiceArticleKey(article);
                    return (
                      <li key={key} className="shrink-0">
                        <button
                          type="button"
                          onClick={() => revealPracticeRow(practiceId, act.id, key)}
                          aria-current={key === activeKey ? 'true' : undefined}
                          className={cn(
                            'min-h-[44px] rounded-md px-2 font-medium transition-colors md:min-h-0 md:py-0.5',
                            // 14 px in a dossier's «Lettura» (LC55); the Corpus keeps its 12.
                            hostDossier ? 'text-sm' : 'text-xs',
                            // Inset: the row scrolls sideways on a phone and would clip a ring drawn outside the chip.
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
                            key === activeKey
                              ? 'bg-slate-200/70 text-slate-900 dark:bg-slate-800 dark:text-white'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                          )}
                        >
                          {chipLabel(article)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {loadingStatus}
            </div>
          )}

          {act.articles.length === 0 && !loadingArticle && (
            <div className="flex flex-col items-center gap-1 px-6 py-8 text-center text-slate-600 dark:text-slate-400">
              <p className="text-sm font-medium">Scegli un articolo dall'indice</p>
              {act.norma.urn && (
                <button
                  type="button"
                  onClick={toggleStructure}
                  className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary-700 hover:bg-primary-50 md:min-h-0 md:py-1 dark:text-primary-300 dark:hover:bg-primary-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <Plus size={13} aria-hidden /> Apri la struttura
                </button>
              )}
            </div>
          )}

          {shownArticles.map((article) => {
            const key = practiceArticleKey(article);
            const { numero_articolo: numero, allegato } = article.norma_data;
            return (
              <PracticeArticleRow
                key={key}
                practiceId={practiceId}
                actId={act.id}
                article={article}
                onCrossReference={onCrossReference}
                onOpenStudyMode={() => openStudy(article)}
                statusEnd={statusEnd}
                rubrica={rubricaOf(article.norma_data)}
                annexSuggestion={annexes && openKeys.includes(key) ? (
                  <AnnexSuggestion
                    className="mb-3"
                    articleNumber={numero}
                    currentAnnex={allegato || null}
                    annexes={annexes}
                    onSwitchAnnex={async (annexNumber): Promise<string | null> => {
                      // Already on the table: reveal it, no request (T2).
                      const wanted = annexNumber ? `all${annexNumber}:${numero}` : numero;
                      if (revealPracticeArticle(practiceId, act.id, wanted)) return numero;
                      const found = await handleAnnexSelect(annexNumber, numero);
                      if (found) revealPracticeArticle(practiceId, act.id, annexNumber ? `all${annexNumber}:${found}` : found);
                      return found;
                    }}
                  />
                ) : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Mounted only with an article in hand: StudyMode dereferences it, and an act opened from the
          index has none until the first pick. */}
      {studyArticle && (
        <StudyMode
          isOpen={studyKey !== null}
          onClose={() => setStudyKey(null)}
          article={studyArticle}
          articles={studyRows}
          onNavigate={(articleId) => {
            const hit = findPracticeArticle({ ...act, articles: studyRows }, articleId);
            if (hit) setStudyKey(practiceArticleKey(hit));
          }}
          normaLabel={heading}
          allArticleIds={allArticleIds}
          onLoadArticle={(number) => openArticle(number)}
        />
      )}
    </section>
  );
}
