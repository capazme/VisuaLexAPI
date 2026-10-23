import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, FileDown, FolderInput, GitBranch, GripVertical, Loader2, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData, Norma } from '../../../types';
import { MenuButton } from '../../ui/MenuButton';
import { removePracticeActWithUndo } from './practiceUndo';
import { Modal } from '../../ui/Modal';
import { Z_INDEX } from '../../../constants/zIndex';
import { HIDDEN_SCROLLBAR } from '../../../constants/interactions';
import { TreeViewPanel } from '../search/TreeViewPanel';
import { AnnexSuggestion } from '../search/AnnexSuggestion';
import { ArticleNavigation } from '../workspace/ArticleNavigation';
import { LazyStudyMode as StudyMode } from '../workspace/LazyStudyMode';
import { shownAnnex } from '../dossier/dossierLayout';
import { PracticeArticleRow } from './PracticeArticleRow';
import { fromPracticePair, practicePair } from './practiceView';
import { useAnnexNavigation } from '../../../hooks/useAnnexNavigation';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { useTour } from '../../../hooks/useTour';
import { formatNormaMeta } from '../../../utils/normaMeta';
import { actHeading, shortAct } from '../../../utils/sources';
import { READ_ONLY_REASON, describeVersion, historicalItemLabel } from '../../../utils/versionDisplay';
import { filterLoadedIdsForAnnex } from '../../../utils/articleIds';
import { findPracticeArticle, practiceArticleKey, type PracticeAct } from '../../../utils/practice';

export interface PracticeActBlockProps {
  practiceId: string;
  act: PracticeAct;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

/**
 * The act's tools (R3): quiet buttons, neutral, the icon and (from `lg`) the word — no colour of their own, as the
 * article's actions; 36 px, on a computer only (a phone has them in «⋯»). The 44 px below `md` is for a narrow window.
 */
const TOOL_BUTTON =
  'flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:h-9 md:min-h-0 md:min-w-0 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40';
const MENU_TRIGGER =
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:h-9 md:min-h-0 md:min-w-0 dark:text-slate-300 dark:hover:bg-slate-800';

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
 * rows one under the other. The structure window is the desktop's (`structureWindow.blockId`), the
 * drawer the phone's: one per breakpoint (gotcha 26).
 */
export function PracticeActBlock({ practiceId, act, onViewPdf, onCrossReference }: PracticeActBlockProps) {
  const {
    toggleActCollapse, revealPracticeArticle, revealPracticeRow, addArticlesToPractice,
    moveActToPractice, openStructureWindow, closeStructureWindow,
  } = useAppStore(useShallow((s) => ({
    toggleActCollapse: s.toggleActCollapse,
    revealPracticeArticle: s.revealPracticeArticle,
    revealPracticeRow: s.revealPracticeRow,
    addArticlesToPractice: s.addArticlesToPractice,
    moveActToPractice: s.moveActToPractice,
    openStructureWindow: s.openStructureWindow,
    closeStructureWindow: s.closeStructureWindow,
  })));
  // Only what the move dialog lists, and only while it is open: a stream into another practice does
  // not re-render every act's rows. `useShallow` compares the pairs' fields.
  const [moveOpen, setMoveOpen] = useState(false);
  const moveTargets = useAppStore(useShallow((s) => (moveOpen
    ? s.practices.filter((p) => p.id !== practiceId).map(practicePair)
    : [])));
  const isStructureWindowOpen = useAppStore((s) => s.structureWindow.blockId === act.id);
  // The act's open rows, oldest first: a reveal moves its row to the end (`revealRow`).
  const prefix = `${practiceId}/${act.id}/`;
  const openKeys = useAppStore(useShallow((s) => Object.keys(s.practiceRows)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))));
  const isDesktop = useIsDesktop();
  // The act's tour, on the practice's first act and once the table's own tour has been seen (when it
  // is done it hands over to this one, `PracticeTable`). Asked once: `tryStartTour` is new each render.
  const isFirstAct = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.acts[0]?.id === act.id);
  const theme = useAppStore((s) => s.settings.theme);
  const { tryStartTour, hasSeenTour } = useTour({ theme: theme as 'light' | 'dark' });
  const tourAsked = useRef(false);
  useEffect(() => {
    if (!isFirstAct || tourAsked.current || !hasSeenTour('practice')) return;
    tourAsked.current = true;
    tryStartTour('practiceAct');
  });
  const [drawerToggled, setDrawerToggled] = useState(false);
  // On a phone the index is the drawer (§8). «Apri l'indice e sfoglia» points the structure window at
  // the act it drops (§5.1): on a phone that request opens this act's drawer too.
  const drawerOpen = drawerToggled || (!isDesktop && isStructureWindowOpen);
  const closeDrawer = () => {
    setDrawerToggled(false);
    if (isStructureWindowOpen) closeStructureWindow();
  };
  // The row Study Mode shows while it is open; null, closed.
  const [studyKey, setStudyKey] = useState<string | null>(null);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: act.id });

  const heading = actHeading(act.norma);
  const byKey = useMemo(() => new Map(act.articles.map((a) => [practiceArticleKey(a), a])), [act.articles]);
  // The row the block reads from (Studio, the arrows, the annex): the last one opened, else the first.
  const current = useMemo(() => {
    for (let i = openKeys.length - 1; i >= 0; i--) {
      const hit = byKey.get(openKeys[i]);
      if (hit) return hit;
    }
    return act.articles[0];
  }, [openKeys, byKey, act.articles]);
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
    treeData, treeMetadata, treeLoading, rubriche, abrogati, rubricheParts, currentAnnex, allArticleIds,
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

  const others = moveTargets.map(fromPracticePair);
  const moveTo = (target: string | { newLabel: string }) => {
    setMoveOpen(false);
    moveActToPractice(act.id, practiceId, target);
  };
  const annexes = treeMetadata?.annexes && treeMetadata.annexes.length > 1 ? treeMetadata.annexes : null;
  const showNavigation = (allArticleIds && allArticleIds.length > 1) || act.articles.length > 1;

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        // Read by an open row's reading toolbar (`--reading-toolbar-top`) and by the rows' scroll margin;
        // 0 on a phone, where the heading scrolls with the block.
        ['--practice-head' as string]: `${isDesktop ? headerHeight : 0}px`,
      }}
      aria-label={heading}
      // A section of the page, not a card (R3: one level of paper, the practice's): its title and a hairline.
      className="practice-act"
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
          // only: on a phone, with an open row's toolbar pinned under it, the two took half the screen.
          'practice-act-head relative flex items-start gap-1 border-b border-slate-200 bg-slate-50 py-1 md:sticky md:top-0 md:items-center md:gap-2 md:py-2 dark:border-slate-800 dark:bg-slate-950',
          Z_INDEX.stickyHead,
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Sposta ${heading}`}
          className="hidden cursor-grab rounded text-slate-300 hover:text-slate-500 md:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-600"
        >
          <GripVertical size={18} aria-hidden />
        </button>
        <div className="min-w-0 flex-1 py-1">
          {/* The accordion pattern: the heading holds the toggle, its name is the act's own words. */}
          <h3 className="min-w-0">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!act.isCollapsed}
              onClick={() => toggleActCollapse(practiceId, act.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleActCollapse(practiceId, act.id);
                }
              }}
              // The act's title, in the reader's serif (R3): 22 px.
              className="flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 rounded-md font-serif text-[22px] font-medium leading-tight text-slate-900 md:min-h-0 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <ChevronDown
                size={16}
                aria-hidden
                className={cn('flex-shrink-0 text-slate-400 transition-transform', act.isCollapsed && '-rotate-90')}
              />
              {/* A cut act name says nothing: on a phone it wraps. */}
              <span className="min-w-0 break-words md:truncate">{heading}</span>
            </div>
          </h3>
          {/* On a phone only what the count does not say: the act's articles are its rows and its index, just below. */}
          <p className={cn('ml-6 truncate text-sm text-slate-600 dark:text-slate-400', !formatNormaMeta(act.norma) && 'hidden md:block')}>
            {formatNormaMeta(act.norma, act.articles.length)}
          </p>
        </div>
        {/* `mt-1` on a phone: «⋯» level with the title's 44 px line, not with the column's top; `-mr-3`: its 44 px reach
            into the page's margin, as every icon on the column's right edge (R3b). */}
        <div className="-mr-3 ml-auto mt-1 flex flex-shrink-0 items-center gap-1 md:mr-0 md:mt-0">
          {/* The tools on a computer; on a phone they are entries of «⋯» (below), not drawn at all. */}
          {isDesktop && <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openStudy(current)}
              disabled={studyLocked}
              title={current && studyLocked ? `Modalità studio — ${READ_ONLY_REASON}` : 'Modalità studio'}
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
                  // It opens a window (the index): expanded, not pressed (R3b).
                  aria-expanded={isStructureWindowOpen}
                  className={cn(TOOL_BUTTON, 'practice-act-structure aria-expanded:bg-slate-200/70 aria-expanded:text-slate-900 dark:aria-expanded:bg-slate-800 dark:aria-expanded:text-white')}
                >
                  <GitBranch size={16} aria-hidden />
                  <span className="hidden lg:inline">{treeLoading ? 'Carico…' : 'Struttura'}</span>
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
              ...(isDesktop ? [] : [
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
              { label: "Sposta in un'altra pratica", icon: FolderInput, onSelect: () => setMoveOpen(true), separatorBefore: !isDesktop },
              { label: "Rimuovi l'atto", icon: Trash2, danger: true, separatorBefore: true, onSelect: () => removePracticeActWithUndo(practiceId, act.id) },
            ]}
          >
            <MoreHorizontal size={18} aria-hidden />
          </MenuButton>
        </div>
      </header>

      {!act.isCollapsed && (
        <div className="py-1">
          {/* The index on top (D3): one chip per row, then the act's arrows. */}
          {(act.articles.length > 1 || loadingArticle || showNavigation) && (
            // On a phone one row: the chips scroll sideways beside the arrows (R3: two rows of chips came before the text).
            <div className="flex items-center gap-x-3 gap-y-1 py-1 md:flex-wrap md:py-1.5">
              {/* A compact index, with more than one article: one alone says nothing it does not say below (R3). */}
              {act.articles.length > 1 ? (
                <ul aria-label={`Articoli sul tavolo di ${heading}`} className={cn('practice-act-index flex min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex-wrap md:overflow-visible', HIDDEN_SCROLLBAR)}>
                  {act.articles.map((article) => {
                    const key = practiceArticleKey(article);
                    return (
                      <li key={key} className="shrink-0">
                        <button
                          type="button"
                          onClick={() => revealPracticeRow(practiceId, act.id, key)}
                          aria-current={openKeys.includes(key) ? 'true' : undefined}
                          className={cn(
                            'min-h-[44px] rounded-md px-2 text-xs font-medium transition-colors md:min-h-0 md:py-0.5',
                            // Inset: the row scrolls sideways on a phone and would clip a ring drawn outside the chip.
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
                            openKeys.includes(key)
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
              ) : (
                // The place the index takes, so the arrows stay at the right.
                <span aria-hidden className="flex-1" />
              )}
              {loadingArticle && (
                <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                  <Loader2 size={12} aria-hidden className="animate-spin text-primary-600 dark:text-primary-400" />
                  Caricamento…
                </span>
              )}
              {showNavigation && (
                <ArticleNavigation
                  allArticleIds={allArticleIds}
                  loadedArticleIds={filterLoadedIdsForAnnex(loadedArticleIds, currentAnnex)}
                  activeArticleId={current?.norma_data.numero_articolo || null}
                  loadingArticleId={loadingArticle}
                  onNavigate={(number) => {
                    revealPracticeArticle(practiceId, act.id, currentAnnex ? `all${currentAnnex}:${number}` : number);
                  }}
                  onLoadArticle={(number) => openArticle(number)}
                />
              )}
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

          {act.articles.map((article) => {
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

      {/* The index: a window on the desktop, a drawer on the phone; neither closes on a pick. */}
      <TreeViewPanel
        variant={isDesktop ? 'window' : 'drawer'}
        isOpen={isDesktop ? isStructureWindowOpen : drawerOpen}
        onClose={isDesktop ? closeStructureWindow : closeDrawer}
        treeData={treeData || []}
        urn={act.norma.urn || ''}
        title="Struttura dell'atto"
        loadedArticles={loadedArticleIds}
        onArticleSelect={(articleNumber, targetAnnex) => openArticle(articleNumber, targetAnnex)}
        annexes={treeMetadata?.annexes}
        currentAnnex={currentAnnex}
        rubriche={rubriche}
        abrogati={abrogati}
        rubricheParts={rubricheParts}
      />


      <Modal
        isOpen={moveOpen}
        onClose={() => setMoveOpen(false)}
        size="sm"
        title="Sposta in un'altra pratica"
        description={`«${heading}» passa con i suoi articoli nella pratica scelta.`}
      >
        <ul className="space-y-1">
          {others.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => moveTo(p.id)}
                className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm text-slate-700 hover:bg-slate-100 md:min-h-0 md:py-2 dark:text-slate-200 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {p.label}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              // A new practice named after the act, as a search names one (T11), made and moved into in one write; this table stays on screen.
              onClick={() => moveTo({ newLabel: shortAct(act.norma) })}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-primary-700 hover:bg-primary-50 md:min-h-0 md:py-2 dark:text-primary-300 dark:hover:bg-primary-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <Plus size={14} aria-hidden />
              Nuova pratica
            </button>
          </li>
        </ul>
      </Modal>

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
