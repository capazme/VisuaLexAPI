import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls, useMotionValue } from 'framer-motion';
import { X, Check, FileText, List, Layers, GripHorizontal, Search, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AnnexMetadata } from '../../../types';
import { useTour } from '../../../hooks/useTour';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { useAppStore } from '../../../store/useAppStore';
import type { RubrichePart } from '../../../hooks/useAnnexNavigation';
import { Z_INDEX } from '../../../constants/zIndex';
import { cleanSectionTitle } from '../../../utils/sectionTitle';

/** Window geometry, also used to keep the parked position inside the viewport. */
const WINDOW_WIDTH = 420;
/** How much of the window must stay on screen vertically after a drag. */
const WINDOW_MIN_VISIBLE = 160;

function clampToViewport(position: { x: number; y: number }) {
  const maxX = Math.max(0, window.innerWidth - WINDOW_WIDTH);
  const maxY = Math.max(0, window.innerHeight - WINDOW_MIN_VISIBLE);
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  };
}

// Normalize article ID for comparison (handles "3 bis" vs "3-bis")
function normalizeArticleId(id: string): string {
  if (!id) return id;
  return id.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Fold a string for filtering: accents stripped, lowercased.
 * A lawyer types "responsabilita" and expects "Responsabilità del debitore".
 */
function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Above this many sections the index opens collapsed — the codice civile has 406. */
const COLLAPSE_THRESHOLD = 8;

// A tree node is either a section-title string or an article object carrying
// its number and (optional) annex marker.
interface TreeArticleNode {
  numero?: string;
  allegato?: string | null;
  [key: string]: unknown;
}
type TreeViewNode = string | TreeArticleNode;

export interface TreeViewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  treeData: TreeViewNode[];
  urn: string;
  title?: string;
  /** Callback when article is selected - includes target annex (null for dispositivo) */
  onArticleSelect?: (articleNumber: string, targetAnnex: string | null) => void;
  loadedArticles?: string[];
  /** Annex metadata for tabs - if provided, shows annex tabs */
  annexes?: AnnexMetadata[];
  /** Currently selected annex (from loaded articles) */
  currentAnnex?: string | null;
  /**
   * Article rubriche keyed by article number ("2043" → "Risarcimento per
   * fatto illecito"). Arrives after the tree and is always partial: coverage
   * is ~89% for the codici and 0% for acts that carry no rubriche at all.
   * An article without one renders as a bare number.
   */
  rubriche?: Record<string, string>;
  /** Keys of the articles the act declares repealed (fallback for flat acts). */
  abrogati?: string[];
  /**
   * Per-annex titles. Preferred over the flat `rubriche` map when a part can
   * be matched to the annex on screen — see `activePart`.
   */
  rubricheParts?: RubrichePart[];
  /**
   * Which shell to wear.
   *
   * `window` is the desktop surface: a draggable, backdrop-less window
   * portalled to `document.body`. The portal is why this variant also checks
   * the viewport and renders nothing on small screens — a portal escapes the
   * `hidden md:block` wrapper it lives under, so without the check the desktop
   * renderer would leak a window onto phones alongside the mobile drawer.
   *
   * `drawer` is the mobile surface: today's right-side sheet with a backdrop,
   * not portalled, so its `md:hidden` wrapper keeps it off desktop.
   */
  variant?: 'window' | 'drawer';
}

// Check if a string is an article number (numeric or roman numeral)
function isArticleString(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();

  // Numeric articles: "1", "1-bis", "2 bis", "2409-octiesdecies", "669-terdecies".
  //
  // The suffix is ANY single lowercase word, not an enumerated list. Normattiva
  // runs well past `decies` — art. 669-terdecies c.p.c. (reclamo cautelare),
  // art. 2409-octiesdecies c.c., art. 25-undecies of D.Lgs. 231/2001 — and an
  // enumerated list silently reclassified every one of them as a SECTION TITLE,
  // dropping them from the index entirely.
  //
  // Staying lowercase and single-word is what keeps section headers out: those
  // arrive uppercase and multi-word ("LIBRO PRIMO DELLE PERSONE…").
  if (/^\d+(?:[-\s][a-z]+)?$/.test(trimmed)) {
    return true;
  }

  // Roman numerals: "I", "II", "III", "I-bis", "II terdecies"
  if (/^[IVXLCDM]+(?:[-\s][a-z]+)?$/.test(trimmed)) {
    return true;
  }

  return false;
}

// Parse tree data into structured sections
// Handles both flat string arrays ["1", "2", ...] and object arrays [{allegato, numero}, ...]
interface ParsedSection {
  title: string;
  articles: string[];
}

/**
 * Parse tree data filtering by a specific annex.
 * The tree contains a mix of:
 * - Objects: {allegato: null|"1"|"2", numero: "X"} - articles with their annex
 * - Strings: Section titles like "LIBRO PRIMO...", "TITOLO II...", "CAPO I..."
 *
 * Section titles are applied to following articles, but only sections with
 * articles matching the target annex are included.
 */
function parseTreeDataForAnnex(data: TreeViewNode[], targetAnnex: string | null): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection = { title: 'Articoli', articles: [] };
  let pendingSectionTitle: string | null = null;

  for (const item of data) {
    // Handle string items (section titles or legacy article numbers)
    if (typeof item === 'string') {
      if (isArticleString(item)) {
        // Legacy format: plain article number string (no annex info)
        // Only include if targeting dispositivo (null annex)
        if (targetAnnex === null) {
          if (pendingSectionTitle && pendingSectionTitle !== currentSection.title) {
            if (currentSection.articles.length > 0) {
              sections.push(currentSection);
            }
            currentSection = { title: pendingSectionTitle, articles: [] };
            pendingSectionTitle = null;
          }
          currentSection.articles.push(item);
        }
      } else {
        // It's a section title - store it for when we find matching articles
        pendingSectionTitle = item;
      }
      continue;
    }

    // Handle object items (article data with allegato info)
    if (item && typeof item === 'object' && item.numero !== undefined) {
      const itemAnnex = item.allegato ?? null;

      // Check if this article belongs to the target annex
      // Compare with type coercion: null === null, "1" === "1"
      const annexMatches = (itemAnnex === null && targetAnnex === null) ||
                           (itemAnnex !== null && targetAnnex !== null && String(itemAnnex) === String(targetAnnex));

      if (annexMatches) {
        // Create new section if we have a pending title
        if (pendingSectionTitle && pendingSectionTitle !== currentSection.title) {
          if (currentSection.articles.length > 0) {
            sections.push(currentSection);
          }
          currentSection = { title: pendingSectionTitle, articles: [] };
          pendingSectionTitle = null;
        }
        currentSection.articles.push(item.numero);
      }
      continue;
    }
  }

  // Push last section
  if (currentSection.articles.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

export function TreeViewPanel({
  isOpen,
  onClose,
  treeData,
  title = 'Struttura Atto',
  onArticleSelect,
  loadedArticles = [],
  annexes,
  currentAnnex,
  rubriche,
  abrogati,
  rubricheParts,
  variant = 'drawer'
}: TreeViewPanelProps) {
  // Track which annex tab is selected in the UI
  // This is separate from currentAnnex (which reflects loaded articles)
  // Allows user to select a tab and click articles before loading completes
  const [selectedAnnex, setSelectedAnnex] = useState<string | null | undefined>(undefined);
  // Free-text filter over article numbers and rubriche
  const [filterQuery, setFilterQuery] = useState('');
  // Explicit expand/collapse choices, keyed by annex + section index so a tab
  // switch cannot inherit the previous tab's open sections.
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({});
  const { tryStartTour } = useTour();

  const isDesktop = useIsDesktop();
  const isWindow = variant === 'window';
  const storedPosition = useAppStore(s => s.structureWindow.position);
  const setStructureWindowPosition = useAppStore(s => s.setStructureWindowPosition);

  const dragControls = useDragControls();
  // Motion values seed from the parked position once, clamped in case the
  // window was parked on a wider screen than the one rehydrating it.
  const initialPosition = useMemo(() => clampToViewport(storedPosition), [storedPosition]);
  const x = useMotionValue(initialPosition.x);
  const y = useMotionValue(initialPosition.y);

  // Drag from the header only, and never when the pointer went down on a
  // control inside it — otherwise the close button would start a drag.
  const startWindowDrag = (event: React.PointerEvent) => {
    if (!isWindow) return;
    if ((event.target as HTMLElement).closest('button')) return;
    dragControls.start(event);
  };

  const handleWindowDragEnd = () => {
    const next = clampToViewport({ x: x.get(), y: y.get() });
    x.set(next.x);
    y.set(next.y);
    setStructureWindowPosition(next);
  };

  // Start tree view tour on first open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => tryStartTour('treeView'), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, tryStartTour]);

  // Reset selected annex when panel opens or when currentAnnex changes externally
  useEffect(() => {
    // External-sync: reset local selection when the panel opens or the annex
    // changes from outside. (CLAUDE.md gotcha #11)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedAnnex(undefined);
    // Same transaction, same justification: a new act (or a reopened panel)
    // must not inherit the previous one's filter or open sections.
    setFilterQuery('');
    setSectionOverrides({});
  }, [currentAnnex, isOpen]);

  // The annex to use for display and article clicks
  // If user selected a tab, use that; otherwise use the loaded annex
  const effectiveAnnex = selectedAnnex !== undefined ? selectedAnnex : currentAnnex;

  // Show annexes section if we have multiple annexes
  const showAnnexes = annexes && annexes.length > 1;

  // Handle annex tab click - just change the view, don't load articles
  // User will click on a specific article to load it
  const handleAnnexTabClick = (annexNumber: string | null) => {
    // Skip if already on this annex
    if (annexNumber === effectiveAnnex) return;

    // Just update the selected tab - this changes which articles are displayed
    // No article is loaded until user clicks one
    setSelectedAnnex(annexNumber);
  };
  // Parse tree data into sections filtered by current annex
  // This ensures each annex tab shows its own section structure (titles/chapters)
  const parsedSections = useMemo(() => {
    if (treeData && treeData.length > 0) {
      return parseTreeDataForAnnex(treeData, effectiveAnnex ?? null);
    }
    return null;
  }, [treeData, effectiveAnnex]);

  // Get articles for the currently selected annex from metadata
  // This ensures we show the correct articles for each annex tab
  const articlesForCurrentAnnex = useMemo(() => {
    if (!annexes || annexes.length === 0) return null;

    // Find the annex matching effectiveAnnex
    const currentAnnexInfo = annexes.find(a =>
      a.number === effectiveAnnex ||
      (a.number === null && effectiveAnnex === null)
    );

    if (currentAnnexInfo?.article_numbers && currentAnnexInfo.article_numbers.length > 0) {
      return currentAnnexInfo.article_numbers;
    }

    return null;
  }, [annexes, effectiveAnnex]);

  // Check if parsedSections has actual structure (titles/chapters, not just one generic section)
  const hasStructuredSections = parsedSections && (
    parsedSections.length > 1 ||
    (parsedSections.length === 1 && parsedSections[0].title !== 'Articoli')
  );

  // Determine display mode:
  // - Prefer structured view (with titles/chapters) when available for ANY annex
  // - Fall back to flat article list only when no section structure exists
  const useStructuredView = hasStructuredSections;
  const displayArticles = useStructuredView ? null : articlesForCurrentAnnex;

  // Count stats based on what we're displaying
  const stats = useMemo(() => {
    if (displayArticles) {
      return { total: displayArticles.length, loaded: loadedArticles.length };
    }
    if (parsedSections) {
      const totalArticles = parsedSections.reduce((sum, s) => sum + s.articles.length, 0);
      return { total: totalArticles, loaded: loadedArticles.length };
    }
    return null;
  }, [displayArticles, parsedSections, loadedArticles]);

  // Create normalized set for comparison
  const loadedSetNormalized = useMemo(
    () => new Set(loadedArticles.map(normalizeArticleId)),
    [loadedArticles]
  );
  const isArticleLoaded = (id: string) => loadedSetNormalized.has(normalizeArticleId(id));

  // Build unique ID with current annex context, so "Art. 1" of Allegato 1
  // ("all1:1") is never mistaken for "Art. 1" of the dispositivo ("1").
  const uniqueIdForContext = (articleNum: string) =>
    effectiveAnnex ? `all${effectiveAnnex}:${articleNum}` : articleNum;

  // Which set of titles belongs to the annex on screen.
  //
  // Every annex has its own article 1: "Capacità giuridica" in the codice
  // civile, "Indicazione delle fonti" in the preleggi, and no rubrica at all in
  // the Dispositivo, whose art. 1 is the enacting provision. A single flat map
  // therefore labels two annexes out of three with the third's titles — which
  // is exactly what the Dispositivo showed before this.
  //
  // Matched by ARTICLE NUMBERS rather than by name: the AKN part names
  // ("CODICE CIVILE") and the annex labels are only sometimes the same string,
  // while the article sets always coincide.
  const activePart = useMemo(() => {
    if (!rubricheParts || rubricheParts.length === 0) return null;

    const annexNumbers = annexes?.find(
      a => a.number === effectiveAnnex || (a.number === null && effectiveAnnex === null)
    )?.article_numbers;
    if (!annexNumbers || annexNumbers.length === 0) return null;

    const wanted = new Set(annexNumbers.map(normalizeArticleId));
    let best: typeof rubricheParts[number] | null = null;
    let bestScore = 0;
    for (const part of rubricheParts) {
      const overlap = part.keys.reduce(
        (n: number, k: string) => (wanted.has(normalizeArticleId(k)) ? n + 1 : n), 0
      );
      if (overlap > bestScore) {
        bestScore = overlap;
        best = part;
      }
    }
    // Require a real majority: a couple of shared numbers is coincidence
    // (every annex has an article 1), a matching set is identification.
    return bestScore >= Math.max(1, Math.min(wanted.size, best?.keys.length ?? 0) * 0.5)
      ? best
      : null;
  }, [rubricheParts, annexes, effectiveAnnex]);

  // Rubriche keyed the same way article numbers are compared, so a tree
  // emitting "1-bis" still finds a rubrica stored under "1 bis" (gotcha 9).
  const rubricheNormalized = useMemo(() => {
    const source: Record<string, string> = activePart ? activePart.rubriche : (rubriche ?? {});
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value) map[normalizeArticleId(key)] = value;
    }
    return map;
  }, [rubriche, activePart]);
  const rubricaFor = (articleNum: string) => rubricheNormalized[normalizeArticleId(articleNum)] ?? '';

  // An abrogated article has no rubrica because it has no content. Saying so
  // beats a blank row: the reader cannot otherwise tell "repealed" from "we
  // could not find the title".
  const abrogatiNormalized = useMemo(() => {
    const source = activePart ? activePart.abrogati : (abrogati ?? []);
    return new Set(source.map(normalizeArticleId));
  }, [abrogati, activePart]);
  const isAbrogato = (articleNum: string) => abrogatiNormalized.has(normalizeArticleId(articleNum));

  // One shape for both display modes: the flat per-annex list becomes a single
  // section, so filtering, counting and collapsing have a single code path.
  const annexLabel = annexes?.find(
    a => a.number === effectiveAnnex || (a.number === null && effectiveAnnex === null)
  )?.label || 'Articoli';

  const displaySections = useMemo<ParsedSection[] | null>(() => {
    if (displayArticles) return [{ title: annexLabel, articles: displayArticles }];
    if (parsedSections && parsedSections.length > 0) return parsedSections;
    return null;
  }, [displayArticles, parsedSections, annexLabel]);

  const normalizedQuery = foldForSearch(filterQuery.trim());
  const isFiltering = normalizedQuery.length > 0;

  // Sections carry their original index so a collapse choice survives the
  // filter hiding the sections above it.
  const sectionsToRender = useMemo(() => {
    if (!displaySections) return null;
    const indexed = displaySections.map((section, idx) => ({ ...section, idx }));
    if (!isFiltering) return indexed;

    return indexed
      .map(section => ({
        ...section,
        articles: section.articles.filter(articleNum =>
          foldForSearch(articleNum).startsWith(normalizedQuery) ||
          foldForSearch(rubricheNormalized[normalizeArticleId(articleNum)] ?? '').includes(normalizedQuery) ||
          (abrogatiNormalized.has(normalizeArticleId(articleNum)) && 'abrogato'.includes(normalizedQuery))
        ),
      }))
      .filter(section => section.articles.length > 0);
  }, [displaySections, isFiltering, normalizedQuery, rubricheNormalized, abrogatiNormalized]);

  const totalArticleCount = useMemo(
    () => displaySections?.reduce((sum, s) => sum + s.articles.length, 0) ?? 0,
    [displaySections]
  );
  const matchedArticleCount = useMemo(
    () => sectionsToRender?.reduce((sum, s) => sum + s.articles.length, 0) ?? 0,
    [sectionsToRender]
  );

  // The codice civile has 406 sections; opening all of them defeats the point
  // of an index. Below the threshold everything stays open.
  const collapsedByDefault = (displaySections?.length ?? 0) > COLLAPSE_THRESHOLD;
  const sectionKey = (idx: number) => `${effectiveAnnex ?? 'main'}::${idx}`;

  const isSectionExpanded = (section: { idx: number; articles: string[] }) => {
    // A filter is a request to see the matches, so it wins over every default.
    if (isFiltering) return true;
    const override = sectionOverrides[sectionKey(section.idx)];
    if (override !== undefined) return override;
    if (!collapsedByDefault) return true;
    // Where you already are stays open.
    return section.articles.some(articleNum => isArticleLoaded(uniqueIdForContext(articleNum)));
  };

  const toggleSection = (idx: number, expanded: boolean) => {
    setSectionOverrides(prev => ({ ...prev, [sectionKey(idx)]: !expanded }));
  };

  // One row per article: number in a fixed leading slot, rubrica beside it.
  const renderArticleRow = (articleNum: string, sectionIdx: number, articleIdx: number) => {
    const isLoaded = isArticleLoaded(uniqueIdForContext(articleNum));
    const isClickable = onArticleSelect && !isLoaded;
    // Create unique key: section index + article index + article number
    const uniqueKey = `sec${sectionIdx}-art${articleIdx}-${articleNum}`;
    const rubrica = rubricaFor(articleNum);
    const abrogato = !rubrica && isAbrogato(articleNum);

    return (
      <button
        key={uniqueKey}
        onClick={() => isClickable && onArticleSelect(articleNum, effectiveAnnex ?? null)}
        // aria-disabled rather than disabled: a `disabled` button is dropped
        // from the tab order AND renders no native tooltip in Chrome or Safari.
        // Both matter here — the rubrica is truncated to one line and `title` is
        // the only route to the full text, and the rows a lawyer most wants to
        // re-read are exactly the loaded ones. The click is guarded instead.
        aria-disabled={!isClickable}
        title={rubrica || undefined}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-md px-2 text-left border border-transparent transition-colors",
          variant === 'drawer' ? "min-h-[44px] py-2" : "py-1",
          isLoaded
            ? "bg-emerald-50 border-emerald-200/70 text-emerald-700 dark:bg-emerald-900/25 dark:border-emerald-800/50 dark:text-emerald-400 cursor-default"
            : "text-slate-700 dark:text-slate-300 hover:bg-primary-50 dark:hover:bg-primary-900/40 hover:border-primary-200 dark:hover:border-primary-800 hover:text-primary-600 dark:hover:text-primary-400 cursor-pointer"
        )}
      >
        {/* min-w, not a fixed w: the slot has to hold "2409-octiesdecies" as
            well as "3". A hard 44px with shrink-0 makes a long id spill left,
            out of the row — and the codici are full of them. */}
        <span className="min-w-11 shrink-0 text-right text-xs font-bold tabular-nums">
          {articleNum}
        </span>
        {rubrica ? (
          <span className="flex-1 min-w-0 truncate text-xs font-normal">
            {rubrica}
          </span>
        ) : abrogato ? (
          <span className="flex-1 min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Abrogato
          </span>
        ) : null}
        {isLoaded && (
          <Check size={12} strokeWidth={3} aria-hidden className="ml-auto shrink-0 text-emerald-500" />
        )}
      </button>
    );
  };

  const panelBody = (
    <>
            {/* Header with Glass-like effect — doubles as the window drag handle */}
            <div
              onPointerDown={startWindowDrag}
              // `touch-none` is load-bearing, not cosmetic: with
              // `dragListener={false}` framer-motion drives the gesture from
              // this handle's pointer events, and a handle left at the default
              // `touch-action: auto` lets the browser claim the gesture for
              // panning — the window then never moves.
              className={cn(
                "sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 px-6 py-5 z-10",
                isWindow && "cursor-grab active:cursor-grabbing select-none touch-none",
              )}
            >
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  {isWindow && (
                    <GripHorizontal
                      size={16}
                      aria-hidden
                      className="text-slate-300 dark:text-slate-600 shrink-0"
                    />
                  )}
                  <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm border border-primary-200/50 dark:border-primary-800/50">
                    <List size={22} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white leading-tight uppercase tracking-tight">{title}</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Indice Strutturale</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700 shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Enhanced Stats */}
              {stats && (
                <div id="tour-tree-stats" className="flex items-center gap-4">
                  <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center gap-2">
                    <FileText size={14} className="text-slate-500" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {stats.total} <span className="opacity-60 font-medium">Articoli totali</span>
                    </span>
                  </div>
                  <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center gap-2 border border-emerald-100/50 dark:border-emerald-800/30">
                    <Check size={14} className="text-emerald-500" />
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {stats.loaded} <span className="opacity-60 font-medium uppercase text-[10px]">Caricati</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Annex Tabs - Show when multiple annexes exist */}
            {showAnnexes && (
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-800/50 dark:to-slate-900">
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={14} className="text-primary-500" />
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Sezioni documento
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {annexes!.map((annex) => {
                    const isActive = effectiveAnnex === annex.number ||
                      (effectiveAnnex === null && annex.number === null);

                    return (
                      <motion.button
                        key={annex.number || 'main'}
                        onClick={() => handleAnnexTabClick(annex.number)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        // No `layout`. The annex list is static — nothing ever
                        // enters, leaves or reorders — so a layout animation has
                        // nothing to describe and only re-measures. It made the
                        // whole row visibly shuffle on every re-render, and the
                        // rubriche landing seconds after the tree added exactly
                        // such a re-render: the section moved on its own while
                        // the reader was looking at it, and a chip mid-animation
                        // rendered blank. `whileHover`/`whileTap` stay: a scale
                        // transform does not affect layout, so siblings hold
                        // still.
                        className={cn(
                          "relative px-3 py-2 text-xs font-semibold rounded-xl transition-colors border overflow-hidden",
                          isActive
                            ? "bg-gradient-to-br from-primary-500 to-primary-600 text-white border-primary-500 shadow-lg shadow-primary-500/25"
                            : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:text-primary-600 dark:hover:text-primary-400 hover:shadow-md"
                        )}
                      >
                        {/* Active indicator glow */}
                        {isActive && (
                          <motion.div
                            layoutId="annexActiveGlow"
                            className="absolute inset-0 bg-gradient-to-br from-primary-400/20 to-transparent"
                            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                          />
                        )}
                        <span className="relative block truncate max-w-[140px]">{annex.label}</span>
                        <span className={cn(
                          "relative text-[10px] block mt-0.5 font-medium",
                          isActive ? "text-primary-100" : "text-slate-400 dark:text-slate-500"
                        )}>
                          {annex.article_count} articoli
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Scrollable Content — a dense list of rows, one article each */}
            <div id="tour-tree-structure" className="flex-1 overflow-y-auto px-3 py-2 custom-scrollbar">
              {sectionsToRender ? (
                <>
                  {/* Filter — sticky, bled edge to edge over the content padding */}
                  <div className="sticky top-0 z-20 -mx-3 px-3 pt-1 pb-2 bg-white dark:bg-slate-900 border-b border-slate-200/70 dark:border-slate-800">
                    <div className="relative">
                      <Search
                        size={14}
                        aria-hidden
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                      <input
                        type="text"
                        value={filterQuery}
                        onChange={(e) => setFilterQuery(e.target.value)}
                        placeholder="Filtra per numero o rubrica…"
                        aria-label="Filtra gli articoli per numero o rubrica"
                        className={cn(
                          "w-full pl-8 pr-3 rounded-lg border text-xs",
                          "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800",
                          "text-slate-700 dark:text-slate-200 placeholder:text-slate-400",
                          "focus:outline-none focus:ring-2 focus:ring-primary-500",
                          variant === 'drawer' ? "min-h-[44px] py-2" : "py-1.5"
                        )}
                      />
                    </div>
                    {isFiltering && (
                      <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 tabular-nums">
                        {matchedArticleCount} di {totalArticleCount}
                      </p>
                    )}
                  </div>

                  {sectionsToRender.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                      <Search size={32} className="opacity-20 mb-3" />
                      <p className="text-xs font-medium">Nessun articolo corrisponde al filtro</p>
                    </div>
                  ) : (
                    <div className="space-y-1 pt-2 pb-10">
                      {sectionsToRender.map((section) => {
                        const expanded = isSectionExpanded(section);

                        return (
                          <div key={section.idx}>
                            {/* Section header — the only element carrying
                                role="button", so no interactive child can
                                re-trigger the toggle. */}
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={expanded}
                              aria-label={`${expanded ? 'Comprimi' : 'Espandi'} ${cleanSectionTitle(section.title)}`}
                              onClick={() => toggleSection(section.idx, expanded)}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleSection(section.idx, expanded);
                                }
                              }}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 rounded-md cursor-pointer select-none",
                                "hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                                variant === 'drawer' ? "min-h-[44px] py-2" : "py-1.5"
                              )}
                            >
                              <ChevronRight
                                size={14}
                                aria-hidden
                                className={cn(
                                  "shrink-0 text-slate-400 transition-transform",
                                  expanded && "rotate-90"
                                )}
                              />
                              <span className="flex-1 min-w-0 truncate text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                {cleanSectionTitle(section.title)}
                              </span>
                              <span className="shrink-0 text-[10px] font-semibold text-slate-400 tabular-nums">
                                {section.articles.length}
                              </span>
                            </div>

                            {expanded && (
                              <div className="pl-3">
                                {section.articles.map((articleNum, artIdx) =>
                                  renderArticleRow(articleNum, section.idx, artIdx)
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-20 text-slate-400"
                >
                  <List size={48} className="opacity-20 mb-4" />
                  <p className="text-sm font-medium">Struttura non ancora disponibile</p>
                </motion.div>
              )}
            </div>

            {/* Footer shadow fade */}
            <div className="h-10 bg-gradient-to-t from-white dark:from-slate-900 to-transparent pointer-events-none sticky bottom-0" />
    </>
  );

  if (isWindow) {
    // Rendered on the viewport, not in place: the workspace tab panel this
    // component lives under is transform-driven, and a transformed ancestor
    // becomes the containing block for `fixed` descendants — a window
    // positioned inside it would be placed against the panel rather than the
    // screen (CLAUDE.md gotcha #22). The portal escapes that, which is also
    // why the viewport check below is needed: a portal escapes the
    // `hidden md:block` wrapper too, and would otherwise surface on phones.
    if (!isDesktop) return null;

    return createPortal(
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            drag
            dragListener={false}
            dragControls={dragControls}
            dragMomentum={false}
            dragConstraints={{
              left: 0,
              top: 0,
              right: Math.max(0, window.innerWidth - WINDOW_WIDTH),
              bottom: Math.max(0, window.innerHeight - WINDOW_MIN_VISIBLE),
            }}
            onDragEnd={handleWindowDragEnd}
            style={{ x, y, width: WINDOW_WIDTH }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            aria-label={`${title} — finestra`}
            className={cn(
              "fixed top-0 left-0 max-h-[76vh] rounded-2xl overflow-hidden",
              "bg-white dark:bg-slate-900 shadow-2xl flex flex-col",
              "border border-slate-200 dark:border-slate-800",
              Z_INDEX.structure,
            )}
          >
            {panelBody}
          </motion.aside>
        )}
      </AnimatePresence>,
      document.body,
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop with Glass effect */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[100]"
          />

          {/* Sidebar Side Panel */}
          <motion.aside
            initial={{ x: '100%', opacity: 0.9 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.9 }}
            transition={{ type: 'spring', damping: 35, stiffness: 400 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[450px] bg-white dark:bg-slate-900 shadow-2xl z-[100] flex flex-col border-l border-slate-200 dark:border-slate-800"
          >
            {panelBody}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
