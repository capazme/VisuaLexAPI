import { useCallback, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, FolderInput, GitBranch, GripVertical, Loader2, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData, Norma } from '../../../types';
import { MenuButton } from '../../ui/MenuButton';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Modal } from '../../ui/Modal';
import { Z_INDEX } from '../../../constants/zIndex';
import { TreeViewPanel } from '../search/TreeViewPanel';
import { AnnexSuggestion } from '../search/AnnexSuggestion';
import { ArticleNavigation } from '../workspace/ArticleNavigation';
import { LazyStudyMode as StudyMode } from '../workspace/LazyStudyMode';
import { shownAnnex } from '../dossier/dossierLayout';
import { PracticeArticleRow } from './PracticeArticleRow';
import { useAnnexNavigation } from '../../../hooks/useAnnexNavigation';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
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

const TOOL_BUTTON =
  'flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors md:min-h-0 md:min-w-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40';
const MENU_TRIGGER =
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-slate-500 transition-colors hover:bg-slate-100 md:min-h-0 md:min-w-0 md:py-1.5 dark:text-slate-300 dark:hover:bg-slate-700';

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
    toggleActCollapse, revealPracticeArticle, revealPracticeRow, addArticlesToPractice, removePracticeAct,
    moveActToPractice, createPractice, openStructureWindow, closeStructureWindow,
  } = useAppStore(useShallow((s) => ({
    toggleActCollapse: s.toggleActCollapse,
    revealPracticeArticle: s.revealPracticeArticle,
    revealPracticeRow: s.revealPracticeRow,
    addArticlesToPractice: s.addArticlesToPractice,
    removePracticeAct: s.removePracticeAct,
    moveActToPractice: s.moveActToPractice,
    createPractice: s.createPractice,
    openStructureWindow: s.openStructureWindow,
    closeStructureWindow: s.closeStructureWindow,
  })));
  const practices = useAppStore((s) => s.practices);
  const isStructureWindowOpen = useAppStore((s) => s.structureWindow.blockId === act.id);
  // The act's open rows, oldest first: a reveal moves its row to the end (`revealRow`).
  const prefix = `${practiceId}/${act.id}/`;
  const openKeys = useAppStore(useShallow((s) => Object.keys(s.practiceRows)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))));
  const isDesktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The row Study Mode shows while it is open; null, closed.
  const [studyKey, setStudyKey] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

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
    } else {
      setDrawerOpen((open) => !open);
    }
    if (!treeData) fetchTree();
  };

  const openStudy = (article: ArticleData | undefined) => {
    if (!isLocked(article)) setStudyKey(practiceArticleKey(article as ArticleData));
  };

  const others = practices.filter((p) => p.id !== practiceId);
  const moveTo = (target: string) => {
    setMoveOpen(false);
    moveActToPractice(act.id, practiceId, target);
  };
  const annexes = treeMetadata?.annexes && treeMetadata.annexes.length > 1 ? treeMetadata.annexes : null;
  const showNavigation = (allArticleIds && allArticleIds.length > 1) || act.articles.length > 1;

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      aria-label={heading}
      className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      {/* The sticky-row convention: opaque, edge to edge, over the rows it heads. */}
      <header
        className={cn(
          'sticky top-0 flex items-start gap-1 rounded-t-xl border-b border-slate-100 bg-white px-2 py-2 md:gap-2 md:px-3 dark:border-slate-700 dark:bg-slate-800',
          Z_INDEX.sticky,
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Sposta ${heading}`}
          className="mt-1.5 hidden cursor-grab rounded text-slate-300 hover:text-slate-500 md:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-600"
        >
          <GripVertical size={18} aria-hidden />
        </button>
        <div className="min-w-0 flex-1 px-1 py-1">
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
              className="flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 rounded-md text-base font-semibold text-slate-900 md:min-h-0 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <ChevronDown
                size={16}
                aria-hidden
                className={cn('flex-shrink-0 text-slate-400 transition-transform', act.isCollapsed && '-rotate-90')}
              />
              {/* A cut act name says nothing: on a phone it wraps. */}
              <span className="break-words md:truncate">{heading}</span>
            </div>
          </h3>
          <p className="ml-6 truncate text-sm text-slate-500 dark:text-slate-400">
            {formatNormaMeta(act.norma, act.articles.length)}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => openStudy(current)}
            disabled={studyLocked}
            title={current && studyLocked ? `Modalità studio — ${READ_ONLY_REASON}` : 'Modalità studio'}
            aria-label="Modalità studio"
            className={cn(TOOL_BUTTON, 'border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100 dark:border-purple-800/30 dark:bg-purple-900/20 dark:text-purple-400')}
          >
            <BookOpen size={13} aria-hidden />
            <span className="hidden lg:inline">Studio</span>
          </button>
          {act.norma.urn && (
            <>
              <button
                type="button"
                onClick={toggleStructure}
                aria-label="Struttura della norma"
                aria-pressed={isDesktop ? isStructureWindowOpen : drawerOpen}
                className={cn(TOOL_BUTTON, 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:border-emerald-800/30 dark:bg-emerald-900/20 dark:text-emerald-400')}
              >
                <GitBranch size={13} aria-hidden />
                <span className="hidden lg:inline">{treeLoading ? 'Carico…' : 'Struttura'}</span>
              </button>
              <button
                type="button"
                onClick={() => onViewPdf(act.norma.urn as string)}
                aria-label="Esporta PDF della norma"
                className={cn(TOOL_BUTTON, 'border-slate-200 bg-white text-slate-600 hover:text-red-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300')}
              >
                PDF
              </button>
            </>
          )}
          <MenuButton
            label={`Azioni su ${heading}`}
            triggerClassName={MENU_TRIGGER}
            items={[
              { label: "Sposta in un'altra pratica", icon: FolderInput, onSelect: () => setMoveOpen(true) },
              { label: "Rimuovi l'atto", icon: Trash2, danger: true, separatorBefore: true, onSelect: () => setConfirmRemove(true) },
            ]}
          >
            <MoreHorizontal size={18} aria-hidden />
          </MenuButton>
        </div>
      </header>

      {!act.isCollapsed && (
        <div className="px-1 py-1 md:px-2">
          {/* The index on top (D3): one chip per row, then the act's arrows. */}
          {(act.articles.length > 0 || loadingArticle || showNavigation) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5">
              <ul aria-label={`Articoli sul tavolo di ${heading}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {act.articles.map((article) => {
                  const key = practiceArticleKey(article);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => revealPracticeRow(practiceId, act.id, key)}
                        className={cn(
                          'min-h-[44px] rounded-md px-2 text-xs font-medium transition-colors md:min-h-0 md:py-0.5',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                          openKeys.includes(key)
                            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700',
                        )}
                      >
                        {chipLabel(article)}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {loadingArticle && (
                <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
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
            <div className="flex flex-col items-center gap-1 px-6 py-8 text-center text-slate-400">
              <p className="text-sm font-medium">Scegli un articolo dall'indice</p>
              {act.norma.urn && (
                <button
                  type="button"
                  onClick={toggleStructure}
                  className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 md:min-h-0 md:py-1 dark:text-emerald-400 dark:hover:bg-emerald-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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
        onClose={isDesktop ? closeStructureWindow : () => setDrawerOpen(false)}
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

      <ConfirmDialog
        open={confirmRemove}
        variant="danger"
        title="Rimuovere l'atto?"
        message="Tutti gli articoli dell'atto verranno tolti dalla pratica. Gli articoli salvati nei segnalibri e nei dossier, le note e le evidenziazioni non saranno toccati."
        confirmLabel="Rimuovi"
        onConfirm={() => {
          setConfirmRemove(false);
          removePracticeAct(practiceId, act.id);
        }}
        onCancel={() => setConfirmRemove(false)}
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
              // A new practice named after the act, as a search names one (T11); this table stays on screen.
              onClick={() => moveTo(createPractice(shortAct(act.norma), { activate: false }))}
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
          articles={act.articles}
          onNavigate={(articleId) => {
            const hit = findPracticeArticle(act, articleId);
            if (hit) setStudyKey(practiceArticleKey(hit));
          }}
          onCrossReferenceNavigate={onCrossReference}
          normaLabel={heading}
          allArticleIds={allArticleIds}
          onLoadArticle={(number) => openArticle(number)}
        />
      )}
    </section>
  );
}
