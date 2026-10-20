import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Command, useCommandState } from 'cmdk';
import { autoUpdate, FloatingPortal, offset, size, useFloating } from '@floating-ui/react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight, Gavel, List, Search, Settings2, SlidersHorizontal, Sparkles, Tag, X, Zap } from 'lucide-react';
import type { SearchParams, CustomAlias, SearchFilters } from '../../../types';
import { cn } from '../../../lib/utils';
import { dur, ease, spring } from '../../../lib/motion';
import { parseItalianDate } from '../../../utils/dateUtils';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useTour } from '../../../hooks/useTour';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { ACT_TYPES_REQUIRING_DETAILS } from '../../../constants/actTypes';
import { useAliasCatalog, foldAlias } from '../../../hooks/useAliasCatalog';
import { Z_INDEX } from '../../../constants/zIndex';
import { FOCUS_RING, TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { activeFiltersLabel, countActiveFilters, defaultSearchFilters } from '../../../utils/searchFilters';
import { SEARCH_FIELD_FORM_ID } from '../../../utils/searchFieldControl';
import { citationSearchParams, useSearchQuery } from '../../../hooks/useSearchQuery';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { filterPaletteActs, paletteActName, queryMatches } from './paletteActs';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (params: SearchParams) => void;
  /**
   * Open an act's index without picking an article — the "browse a code"
   * path. Skips the article step entirely.
   */
  onBrowseStructure?: (params: SearchParams) => void;
  /** Called once a decision or a topic was put in the practices: the host shows the search page, which
   *  alone draws them. */
  onShowSearch?: () => void;
}

type PaletteStep = 'select_act' | 'input_article' | 'input_details';

const STEP_ORDER: Record<PaletteStep, number> = { select_act: 0, input_details: 1, input_article: 2 };

/** How many favourites and aliases «A portata di mano» shows before the box is typed in. */
const AT_HAND_ROWS = 6;

/** The panel's height on a computer, at most (40 rem). */
const PANEL_MAX_HEIGHT = 640;

/** Case-insensitive, for the reason given on `paletteActName`: an act named
 *  by the server ("regolamento ue") must reach the same branch as the same act
 *  picked from the list ("Regolamento UE"), or the palette skips the step that
 *  collects its number and date. */
function requiresDetails(actValue: string): boolean {
  const wanted = (actValue || '').toLowerCase();
  return ACT_TYPES_REQUIRING_DETAILS.some(v => v.toLowerCase() === wanted);
}

// One row of the lists: 44 px, a colour change when chosen, never a lift (UI conventions).
const ROW = 'relative isolate flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-800 dark:text-ink-100';
const ROW_ICON = 'shrink-0 text-ink-500 dark:text-ink-400';
const SUBTLE = 'text-ink-600 dark:text-ink-400';
// A group's heading, drawn by cmdk (`heading`), which also names the group for a screen reader.
const GROUP_WITH_HEADING = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-600 dark:[&_[cmdk-group-heading]]:text-ink-400';
const COLUMN_TITLE = 'px-3 pt-3 font-serif text-base font-medium text-ink-900 dark:text-ink-50';
const QUIET_LINE = 'px-3 py-2 text-sm text-ink-600 dark:text-ink-400';
const FIELD_INPUT = cn(
  'h-11 w-full min-w-0 rounded-lg border border-ink-200 bg-white px-3 text-base text-ink-900 placeholder:text-ink-500 md:text-sm',
  'dark:border-ink-700 dark:bg-ink-950 dark:text-ink-50 dark:placeholder:text-ink-400',
  FOCUS_RING,
);
const SMALL_INPUT = cn(
  'min-h-[44px] rounded-lg border border-ink-200 bg-white px-3 text-base text-ink-900 md:min-h-9 md:text-sm',
  'dark:border-ink-700 dark:bg-ink-950 dark:text-ink-50',
  FOCUS_RING,
);

/**
 * The keys cmdk takes for its list wherever they are pressed inside it: Enter (it picks the chosen row
 * and prevents the key), the arrows, Home and End. A control of the palette that is not the box keeps
 * them, or Enter on «Filtri avanzati» would open the first act and the arrows of «Fonte» would move the
 * list.
 */
const LIST_KEYS = new Set(['Enter', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
function keepKeys(event: ReactKeyboardEvent) {
  if (LIST_KEYS.has(event.key) && !(event.target as HTMLElement).hasAttribute('cmdk-input')) event.stopPropagation();
}

/** What the box holds: the chosen row's tint slides only between rows of one list, never from a row a
 *  letter typed has just filtered away. */
const ChosenRowScope = createContext('');

/**
 * The tint under the row the keyboard (or the pointer) has chosen. One element, carried from row to row
 * (`layoutId`), so the choice slides instead of jumping; under reduced motion it is drawn in place.
 */
function RowHighlight({ value, still }: { value: string; still: boolean }) {
  const chosen = useCommandState((state) => state.value?.toLowerCase() === value.toLowerCase());
  const scope = useContext(ChosenRowScope);
  if (!chosen) return null;
  // A tint and an edge in toga: the tint alone is too faint a mark for the row in use.
  const tint = cn(
    'absolute inset-0 -z-10 rounded-lg bg-ink-100 dark:bg-ink-800',
    'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-toga-600 dark:before:bg-toga-300',
  );
  return still
    ? <span aria-hidden className={tint} />
    : <motion.span aria-hidden layoutId={`command-palette-chosen-row:${scope}`} transition={spring.snappy} className={tint} />;
}

function PaletteRow({ value, onSelect, still, className, children }: {
  value: string;
  onSelect: () => void;
  still: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={cn(ROW, className)}>
      <RowHighlight value={value} still={still} />
      {children}
    </Command.Item>
  );
}

export function CommandPalette({ isOpen, onClose, onSearch, onBrowseStructure, onShowSearch }: CommandPaletteProps) {
  const {
    quickNorms, selectQuickNorm, settings, openQuickNormsManager,
    customAliases, trackAliasUsage, openAliasManager, openDecision, openTopicSearch, takeCommandPaletteQuery, commandPaletteQuery
  } = useAppStore(useShallow(s => ({
    quickNorms: s.quickNorms,
    selectQuickNorm: s.selectQuickNorm,
    settings: s.settings,
    openQuickNormsManager: s.openQuickNormsManager,
    customAliases: s.customAliases,
    trackAliasUsage: s.trackAliasUsage,
    openAliasManager: s.openAliasManager,
    openDecision: s.openDecision,
    openTopicSearch: s.openTopicSearch,
    takeCommandPaletteQuery: s.takeCommandPaletteQuery,
    commandPaletteQuery: s.commandPaletteQuery,
  })));
  // The box is focused as the palette opens; the first-open tour (driver.js, started 300 ms later)
  // can take that focus, so when the tour ends the box gets it back. Only if the box is still there:
  // the ref is empty once the palette has closed or moved on to another step.
  const boxRef = useRef<HTMLInputElement>(null);
  const { tryStartTour } = useTour({
    theme: settings.theme as 'light' | 'dark',
    onComplete: (tour) => {
      if (tour === 'commandPalette') setTimeout(() => boxRef.current?.focus(), 0);
    },
  });
  const [step, setStep] = useState<PaletteStep>('select_act');
  const [selectedAct, setSelectedAct] = useState('');
  const [article, setArticle] = useState('1');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(defaultSearchFilters);
  const isDesktop = useIsDesktop();
  const still = Boolean(useReducedMotion());

  // Which way the step moved, for its slide: forward slides in from the right, back from the left.
  // Adjusted during render (own state, no effect). A step changed while the palette is closed (the reset)
  // does not slide the next opening.
  const [shownStep, setShownStep] = useState<PaletteStep>(step);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  if (step !== shownStep) {
    setShownStep(step);
    setDirection(isOpen ? (STEP_ORDER[step] > STEP_ORDER[shownStep] ? 1 : -1) : 0);
  } else if (!isOpen && direction !== 0) {
    setDirection(0);
  }

  // A citation handed over as the palette opens goes into the box (a decision that was not found).
  // Adjusted during render (own state, no effect); the store's copy is then taken in an effect.
  const [handedOver, setHandedOver] = useState<string | null>(null);
  if (isOpen && commandPaletteQuery !== null && commandPaletteQuery !== handedOver) {
    setHandedOver(commandPaletteQuery);
    setInputValue(commandPaletteQuery);
  } else if (commandPaletteQuery === null && handedOver !== null) {
    setHandedOver(null);
  }
  useEffect(() => {
    if (isOpen && commandPaletteQuery !== null) takeCommandPaletteQuery();
  }, [isOpen, commandPaletteQuery, takeCommandPaletteQuery]);

  // Trigger Command Palette tour on first open
  useEffect(() => {
    if (isOpen) {
      tryStartTour('commandPalette');
    }
  }, [isOpen, tryStartTour]);

  // Sorted custom aliases for display (by usage, then alphabetically)
  const sortedAliases = useMemo(() => {
    return [...customAliases].sort((a, b) =>
      b.usageCount - a.usageCount || a.trigger.localeCompare(b.trigger)
    );
  }, [customAliases]);
  const hasAliases = sortedAliases.length > 0;

  // The aliases we ship. Shown next to the user's own so it is visible what
  // already exists and what still has to be invented — asked for directly:
  // "così che l'utente sappia cosa ha e cosa deve inserire da solo".
  const { catalog } = useAliasCatalog(isOpen);

  const presetEntries = useMemo(() => {
    const mine = new Set(customAliases.map(a => foldAlias(a.trigger)));
    return Object.entries(catalog.presets)
      // 21 of the 80 presets only rename an act type — "codice appalti" IS the
      // "Codice dei contratti pubblici" row that already sits in the list of acts,
      // so listing them duplicated the act list without adding anything. The
      // 59 kept here carry a number and a date ("gdpr" -> Reg. UE 679/2016),
      // which is work the list cannot save you.
      .filter(([, preset]) => Boolean(preset.act_number))
      // A custom alias with the same trigger wins at resolution time, so
      // showing the preset too would advertise a shortcut that no longer runs.
      .filter(([trigger]) => !mine.has(foldAlias(trigger)))
      // Shortest first: an alias earns its keep by being shorter than the name
      // it replaces.
      .sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  }, [catalog.presets, customAliases]);

  // Four, not three: the three shortest are all Testi Unici (tub, tuf, tus) and
  // read as cryptic on their own. The fourth is gdpr, which makes the whole
  // line legible at a glance.
  const presetHint = useMemo(
    () => presetEntries.slice(0, 4).map(([trigger]) => trigger).join(', '),
    [presetEntries]
  );

  // What the box names (a decision, a norm, a topic): one reading, shared with the search page's field.
  const { decisionRef, parsedCitation, citationReady, citationPreview, resolvingRemotely, topic } = useSearchQuery(inputValue);

  // The box filters every list while it is typed (`paletteActs.ts`: each typed word begins a word of the
  // row). cmdk's own filter is off: it reorders the rows by score, across the two columns.
  const typed = inputValue.trim();
  const actGroups = useMemo(() => filterPaletteActs(inputValue), [inputValue]);
  const visibleQuickNorms = typed
    ? quickNorms.filter((qn) => queryMatches(inputValue, qn.label, qn.searchParams.act_type))
    : quickNorms.slice(0, AT_HAND_ROWS);
  const visibleAliases = typed
    ? sortedAliases.filter((a) => queryMatches(inputValue, a.trigger, a.expandTo))
    : sortedAliases.slice(0, AT_HAND_ROWS);
  // Nothing at rest: the alias heading's line says they exist; that is the whole point of not drawing them.
  // They appear once the user types, so the full set stays reachable without weighing on the idle palette.
  const visiblePresets = typed
    ? presetEntries.filter(([trigger, preset]) => queryMatches(inputValue, trigger, preset.act_type))
    : [];
  // The door to the manager, found by typing «alias» too.
  const showAliasDoor = !typed || queryMatches(inputValue, 'alias gestisci crea scorciatoie');

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStep('select_act');
        setSelectedAct('');
        setArticle('1');
        setActNumber('');
        setActDate('');
        setInputValue('');
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key. Only while open: a closed palette that took every Escape and called
  // `preventDefault` on it would hide it from whoever honours `defaultPrevented` (the rail's overlay).
  useEffect(() => {
    if (!isOpen) return undefined;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isOpen, onClose]);

  const handleSelectAct = useCallback((actValue: string) => {
    setSelectedAct(actValue);
    setInputValue('');

    if (requiresDetails(actValue)) {
      setStep('input_details');
    } else {
      setStep('input_article');
    }
  }, []);

  const handleSelectQuickNorm = useCallback((id: string) => {
    const qn = selectQuickNorm(id);
    if (qn) {
      onSearch(qn.searchParams);
      onClose();
    }
  }, [selectQuickNorm, onSearch, onClose]);

  const handleOpenQuickNormsManager = useCallback(() => {
    onClose();
    // Small delay to let the palette close before opening manager
    setTimeout(() => openQuickNormsManager(), 100);
  }, [onClose, openQuickNormsManager]);

  const handleOpenAliasManager = useCallback(() => {
    onClose();
    setTimeout(() => openAliasManager(), 100);
  }, [onClose, openAliasManager]);

  const handleSelectAlias = useCallback((alias: CustomAlias) => {
    trackAliasUsage(alias.id);

    if (alias.searchParams) {
      // Reference alias: execute search directly
      onSearch({
        act_type: alias.searchParams.act_type || '',
        act_number: alias.searchParams.act_number || '',
        date: alias.searchParams.date ? parseItalianDate(alias.searchParams.date) : '',
        article: alias.searchParams.article || '1',
        version: 'vigente',
        version_date: '',
        filters,
      });
      onClose();
    }
  }, [trackAliasUsage, onSearch, onClose, filters]);

  const handleSelectPreset = useCallback((trigger: string) => {
    const preset = catalog.presets[trigger];
    if (!preset) return;

    // A preset names an act, never an article, so it seeds the form rather
    // than running a search — same branch a picked act type takes.
    setSelectedAct(preset.act_type);
    setActNumber(preset.act_number ?? '');
    setActDate(preset.date ?? '');
    setInputValue('');
    setStep(
      requiresDetails(preset.act_type) && !(preset.act_number && preset.date)
        ? 'input_details'
        : 'input_article'
    );
  }, [catalog.presets]);

  const handleSearchTopic = useCallback(() => {
    if (!topic) return;
    openTopicSearch({ tema: topic }, `Tema: ${topic}`);
    onClose();
    onShowSearch?.();
  }, [topic, openTopicSearch, onClose, onShowSearch]);

  const handleOpenDecision = useCallback(() => {
    if (!decisionRef) return;
    openDecision(decisionRef, { fromLink: true });
    onClose();
    onShowSearch?.();
  }, [decisionRef, openDecision, onClose, onShowSearch]);

  const handleCitationSearch = useCallback(() => {
    if (!parsedCitation) return;

    // Track alias usage if citation was resolved from an alias
    if (parsedCitation.fromAlias && parsedCitation.aliasId) {
      trackAliasUsage(parsedCitation.aliasId);
    }

    if (citationReady) {
      onSearch(citationSearchParams(parsedCitation, { filters }));
      onClose();
    } else if (parsedCitation.act_type) {
      setSelectedAct(parsedCitation.act_type);
      if (parsedCitation.article) setArticle(parsedCitation.article);
      if (parsedCitation.act_number) setActNumber(parsedCitation.act_number);
      if (parsedCitation.date) setActDate(parsedCitation.date);
      setInputValue('');

      if (requiresDetails(parsedCitation.act_type)) {
        if (parsedCitation.act_number && parsedCitation.date) {
          setStep('input_article');
        } else {
          setStep('input_details');
        }
      } else {
        setStep('input_article');
      }
    }
  }, [parsedCitation, citationReady, onSearch, onClose, filters, trackAliasUsage]);

  const handleSubmitArticle = useCallback(() => {
    if (!selectedAct || !article) return;

    onSearch({
      act_type: selectedAct,
      article,
      act_number: actNumber || '',
      date: actDate ? parseItalianDate(actDate) : '',
      version: 'vigente',
      version_date: '',
      filters,
    });
    onClose();
  }, [selectedAct, article, actNumber, actDate, onSearch, onClose, filters]);

  const handleSubmitDetails = useCallback(() => {
    if (!selectedAct || !actNumber || !actDate) return;
    setStep('input_article');
  }, [selectedAct, actNumber, actDate]);

  /**
   * Leave by the other door: open the act's index instead of an article.
   * Available from the article step, which is where the act (and its details,
   * when required) is already known.
   */
  const handleBrowse = useCallback(() => {
    if (!selectedAct || !onBrowseStructure) return;

    onBrowseStructure({
      act_type: selectedAct,
      article: '',
      act_number: actNumber || '',
      date: actDate ? parseItalianDate(actDate) : '',
      version: 'vigente',
      version_date: '',
      filters,
    });

    onClose();
  }, [selectedAct, actNumber, actDate, filters, onBrowseStructure, onClose]);

  /** The act as a lawyer names it (`paletteActName`: case-insensitive, the raw value when unknown). */
  const selectedActLabel = useMemo(() => paletteActName(selectedAct), [selectedAct]);

  // On a computer the palette drops from the search page's field, as wide as the field and «Opzioni»;
  // where no field is on screen (another page, Focus mode) it hangs at the top, centred. The form is
  // looked up at every render while open, so a field that mounts later (the address /sentenze) or goes
  // is followed, and passed at render time (gotcha 13).
  const field = isOpen && isDesktop ? document.getElementById(SEARCH_FIELD_FORM_ID) : null;
  const anchor = field?.isConnected ? field : null;
  const { refs, floatingStyles } = useFloating({
    open: isOpen && anchor !== null,
    elements: { reference: anchor },
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [
      // Its top on the field's: the panel's own box takes the field's place.
      offset(({ rects }) => -rects.reference.height),
      // As wide as the field and «Opzioni»; one height while the box filters the lists, so the panel
      // does not jump under the hand at every letter.
      size({
        padding: 16,
        apply({ rects, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
            height: `${Math.min(PANEL_MAX_HEIGHT, Math.max(320, availableHeight))}px`,
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  // The step's content slides in from the side it moved to; the first step of an opening does not move.
  const stepMotion = direction === 0
    ? { initial: false as const }
    : {
        initial: still ? { opacity: 0 } : { opacity: 0, x: direction * 12 },
        animate: still ? { opacity: 1 } : { opacity: 1, x: 0 },
        transition: { duration: dur.pop, ease: ease.out },
      };

  const activeFilters = countActiveFilters(filters);

  // ── The field: the one strong thing of the panel ────────────────────────────────────────────────
  const preview = decisionRef
    ? { icon: Gavel, tone: 'text-emerald-700 dark:text-emerald-400', text: `Sentenza → ${formatDecisionShort(decisionRef)}`, action: 'Invio apre' }
    : parsedCitation && citationPreview
      ? {
          icon: parsedCitation.fromAlias ? Tag : Zap,
          tone: parsedCitation.fromAlias
            ? 'text-toga-700 dark:text-toga-300'
            : citationReady ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
          text: `${parsedCitation.fromAlias ? 'tramite alias → ' : ''}${citationPreview}`,
          action: citationReady ? 'Invio ricerca' : 'Invio completa',
        }
      : null;

  const helpLine = step === 'select_act'
    ? 'Scrivi una citazione: art. 2043 c.c., l. 241/1990, Cass. civ. 10787/2024'
    : step === 'input_details'
      ? "Scrivi il numero e l'anno (o la data) dell'atto: 241 e 1990"
      : "Scrivi il numero dell'articolo: 2043, 1-bis";

  const fieldRow = (
    <div className="flex items-center gap-2 px-3 pt-2" onKeyDown={keepKeys}>
      <motion.div key={step} {...stepMotion} className="flex min-w-0 flex-1 items-center gap-3">
        {step === 'select_act' && (
          <>
            <Search size={20} aria-hidden className="ml-1 shrink-0 text-ink-500 dark:text-ink-400" />
            <Command.Input
              ref={boxRef}
              autoFocus
              value={inputValue}
              onValueChange={setInputValue}
              aria-describedby="command-palette-help"
              placeholder="Atto o citazione, es. art 2043 cc"
              className="h-12 w-full min-w-0 bg-transparent text-lg font-medium text-ink-900 outline-none placeholder:font-normal placeholder:text-ink-500 dark:text-ink-50 dark:placeholder:text-ink-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && decisionRef) {
                  e.preventDefault();
                  handleOpenDecision();
                } else if (e.key === 'Enter' && parsedCitation) {
                  e.preventDefault();
                  handleCitationSearch();
                }
              }}
            />
          </>
        )}

        {step === 'input_details' && (
          <div className="flex min-w-0 flex-1 gap-2 py-1">
            <input
              type="text"
              aria-label="Numero dell'atto"
              placeholder="Numero, es. 241"
              value={actNumber}
              onChange={(e) => setActNumber(e.target.value)}
              className={cn(FIELD_INPUT, 'flex-[1.5]')}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitDetails()}
            />
            <input
              type="text"
              aria-label="Anno o data dell'atto"
              value={actDate}
              onChange={(e) => setActDate(e.target.value)}
              placeholder="Anno o data"
              className={cn(FIELD_INPUT, 'flex-1')}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitDetails()}
            />
          </div>
        )}

        {step === 'input_article' && (
          <div className="min-w-0 flex-1 py-1">
            <input
              type="text"
              aria-label="Numero dell'articolo"
              placeholder="Articolo, es. 12"
              value={article}
              onChange={(e) => setArticle(e.target.value)}
              className={FIELD_INPUT}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitArticle()}
            />
          </div>
        )}
      </motion.div>

      {/* On a phone the sheet's own «Chiudi» closes it. */}
      {isDesktop && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          className={cn('inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100', FOCUS_RING)}
        >
          <X size={18} aria-hidden />
        </button>
      )}
    </div>
  );

  // The help line, or what the box was read as. The visible line is aria-hidden: the status region says it.
  const fieldLine = (
    <div aria-hidden className="flex min-h-5 items-center gap-2 px-4 pb-2 text-xs">
      {step === 'select_act' && preview ? (
        <>
          <span id="command-palette-help" className="sr-only">{helpLine}</span>
          <preview.icon size={14} className={cn('shrink-0', preview.tone)} />
          <span className={cn('min-w-0 flex-1 truncate font-medium', preview.tone)}>{preview.text}</span>
          <span className={cn('shrink-0', SUBTLE)}>{preview.action}</span>
        </>
      ) : (
        <span id="command-palette-help" className={SUBTLE}>{helpLine}</span>
      )}
    </div>
  );

  // The steps, a thin trail with the one in use in ink.
  const stepClass = (current: boolean) => cn(
    'inline-flex min-w-[44px] items-center justify-center rounded px-1 md:min-w-0 md:py-0.5',
    TOUCH_TARGET_RESPONSIVE,
    current ? 'font-medium text-ink-900 dark:text-ink-50' : SUBTLE,
  );
  const steps = (
    <nav aria-label="Passi della ricerca" onKeyDown={keepKeys} className="flex items-center gap-1 border-t border-ink-100 px-3 text-xs dark:border-ink-800">
      <button
        type="button"
        onClick={() => setStep('select_act')}
        aria-current={step === 'select_act' ? 'step' : undefined}
        className={cn(stepClass(step === 'select_act'), 'cursor-pointer hover:text-ink-900 dark:hover:text-ink-50', FOCUS_RING)}
      >
        Atto
      </button>
      {requiresDetails(selectedAct) && (
        <>
          <ChevronRight size={12} aria-hidden className="text-ink-400 dark:text-ink-500" />
          <button
            type="button"
            onClick={() => selectedAct && setStep('input_details')}
            aria-current={step === 'input_details' ? 'step' : undefined}
            className={cn(stepClass(step === 'input_details'), 'cursor-pointer hover:text-ink-900 dark:hover:text-ink-50', FOCUS_RING)}
          >
            Dettagli
          </button>
        </>
      )}
      <ChevronRight size={12} aria-hidden className="text-ink-400 dark:text-ink-500" />
      <span aria-current={step === 'input_article' ? 'step' : undefined} className={stepClass(step === 'input_article')}>
        <span>Articolo</span>
      </span>
    </nav>
  );

  // ── «Scegli l'atto» ─────────────────────────────────────────────────────────────────────────────
  const noActLine = decisionRef
    ? 'Nessun atto: Invio apre la sentenza'
    : citationReady
      ? 'Premi Invio per cercare'
      : resolvingRemotely
        ? "Cerco l'atto… riconosco i nomi per esteso, non solo le sigle"
        : 'Nessun atto con questo nome';

  const actColumn = (
    <div>
      <div aria-hidden className={COLUMN_TITLE}>Scegli l'atto</div>
      {actGroups.length === 0 && <p className={QUIET_LINE}>{noActLine}</p>}
      {actGroups.map((group) => (
        <Command.Group
          key={group.heading}
          heading={group.heading}
          className={GROUP_WITH_HEADING}
        >
          {group.acts.map((act) => (
            <PaletteRow key={act.value} value={`atto ${act.value}`} onSelect={() => handleSelectAct(act.value)} still={still}>
              <span className="min-w-0 flex-1 line-clamp-2">
                <span className="text-ink-900 dark:text-ink-50">{act.name}</span>
                {act.abbreviation && <span className={SUBTLE}> · {act.abbreviation}</span>}
              </span>
            </PaletteRow>
          ))}
        </Command.Group>
      ))}
    </div>
  );

  // ── «A portata di mano» ─────────────────────────────────────────────────────────────────────────
  const hiddenQuickNorms = typed ? 0 : quickNorms.length - visibleQuickNorms.length;
  const hiddenAliases = typed ? 0 : sortedAliases.length - visibleAliases.length;
  const atHandColumn = (
    <div>
      <div aria-hidden className={COLUMN_TITLE}>A portata di mano</div>

      {(!typed || visibleQuickNorms.length > 0) && (
        <Command.Group id="command-palette-quick-norms" heading="Preferiti" className={cn('relative', GROUP_WITH_HEADING)}>
          <button
            type="button"
            onClick={handleOpenQuickNormsManager}
            onKeyDown={keepKeys}
            className={cn('absolute right-1 top-1 inline-flex items-center rounded px-2 text-xs font-medium text-toga-700 hover:underline md:top-2 dark:text-toga-300', TOUCH_TARGET_RESPONSIVE, FOCUS_RING)}
          >
            Gestisci
          </button>
          {quickNorms.length === 0 ? (
            <p className={QUIET_LINE}>Nessun preferito: il fulmine su un articolo lo aggiunge qui</p>
          ) : (
            visibleQuickNorms.map((qn) => (
              <PaletteRow key={qn.id} value={`preferito ${qn.id}`} onSelect={() => handleSelectQuickNorm(qn.id)} still={still}>
                <Zap size={14} aria-hidden className="shrink-0 fill-amber-500 text-amber-600 dark:text-amber-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-900 dark:text-ink-50">{qn.label}</span>
                  <span className={cn('block truncate text-xs', SUBTLE)}>{paletteActName(qn.searchParams.act_type)}</span>
                </span>
              </PaletteRow>
            ))
          )}
          {hiddenQuickNorms > 0 && (
            <PaletteRow value="preferiti tutti" onSelect={handleOpenQuickNormsManager} still={still} className="text-toga-700 dark:text-toga-300">
              Tutti i preferiti ({quickNorms.length})
            </PaletteRow>
          )}
        </Command.Group>
      )}

      {(!typed || visibleAliases.length > 0 || showAliasDoor) && (
        <Command.Group heading="I tuoi alias" className={GROUP_WITH_HEADING}>
          {/* At rest this line is the only trace the presets leave. */}
          {presetEntries.length > 0 && (
            <p className={cn('truncate px-3 pb-1 text-xs', SUBTLE)}>
              +{presetEntries.length} già pronti{presetHint && `: ${presetHint}…`}
            </p>
          )}
          {visibleAliases.map((alias) => (
            <PaletteRow key={alias.id} value={`alias ${alias.id}`} onSelect={() => handleSelectAlias(alias)} still={still}>
              <Tag size={14} aria-hidden className={ROW_ICON} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-900 dark:text-ink-50">{alias.trigger}</span>
                <span className={cn('block truncate text-xs', SUBTLE)}>→ {alias.expandTo}</span>
              </span>
            </PaletteRow>
          ))}
          {/* The door to the manager. Rendered whatever the user owns, on purpose: gated on owning an
              alias, it hid the only way to make the first one. A row of the list, so typing «alias»
              finds it. */}
          {showAliasDoor && (
            <PaletteRow value="alias gestisci crea scorciatoie" onSelect={handleOpenAliasManager} still={still} className="text-toga-700 dark:text-toga-300">
              {hasAliases ? <Settings2 size={14} aria-hidden className="shrink-0" /> : null}
              <span className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                {hasAliases ? `Gestisci alias${hiddenAliases > 0 ? ` (${sortedAliases.length})` : ''}` : 'Crea un alias'}
              </span>
            </PaletteRow>
          )}
        </Command.Group>
      )}

      {/* Presets — only while the user is typing, under their own heading. */}
      {visiblePresets.length > 0 && (
        <Command.Group heading="In dotazione · non devi crearli" className={GROUP_WITH_HEADING}>
          {visiblePresets.map(([trigger, preset]) => (
            <PaletteRow key={trigger} value={`preset ${trigger}`} onSelect={() => handleSelectPreset(trigger)} still={still}>
              <Sparkles size={14} aria-hidden className={ROW_ICON} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-900 dark:text-ink-50">{trigger}</span>
                <span className={cn('block truncate text-xs', SUBTLE)}>
                  → {[paletteActName(preset.act_type), preset.act_number && `n. ${preset.act_number}`, preset.date]
                    .filter(Boolean)
                    .join(' ')}
                </span>
              </span>
            </PaletteRow>
          ))}
        </Command.Group>
      )}
    </div>
  );

  // ── The body of each step ───────────────────────────────────────────────────────────────────────
  const scrollColumn = isDesktop ? 'min-h-0 overflow-y-auto overscroll-contain custom-scrollbar pb-2' : 'pb-2';
  const selectBody = (
    <Command.List
      id="command-palette-results"
      className={cn('px-2', isDesktop && 'h-full [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:h-full [&>[cmdk-list-sizer]]:flex-col')}
    >
      {/* A topic, not a decision or a norm: its own line, over the two columns */}
      {topic && (
        <Command.Group className="shrink-0 pt-2">
          <PaletteRow value={`cerca-sentenze ${topic}`} onSelect={handleSearchTopic} still={still}>
            <Gavel size={14} aria-hidden className="shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span className="min-w-0 flex-1 truncate font-medium">
              Cerca "{topic}" nelle sentenze della Cassazione
            </span>
          </PaletteRow>
        </Command.Group>
      )}
      <div className={cn(isDesktop ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-2' : 'flex flex-col')}>
        {/* On a computer «A portata di mano» comes first for the keyboard, drawn on the right: ↓ reaches a
            favourite before forty acts, and Enter on an opening runs the first favourite, as it always did.
            On a phone the order is the one drawn, the acts first. */}
        {isDesktop ? (
          <>
            <motion.div layoutScroll className={cn(scrollColumn, 'col-start-2 row-start-1 border-l border-ink-100 pl-2 dark:border-ink-800')}>{atHandColumn}</motion.div>
            <motion.div layoutScroll className={cn(scrollColumn, 'col-start-1 row-start-1')}>{actColumn}</motion.div>
          </>
        ) : (
          <>
            <motion.div layoutScroll className={scrollColumn}>{actColumn}</motion.div>
            <motion.div layoutScroll className={scrollColumn}>{atHandColumn}</motion.div>
          </>
        )}
      </div>
    </Command.List>
  );

  const detailsBody = (
    <div className="space-y-3 px-4 py-4" onKeyDown={keepKeys}>
      <p className="text-sm text-ink-700 dark:text-ink-200">
        Stai consultando: <span className="font-medium text-ink-900 dark:text-ink-50">{selectedActLabel}</span>
      </p>
      {step === 'input_article' && actNumber && actDate && (
        <p className={cn('text-xs', SUBTLE)}>{selectedActLabel} n. {actNumber} del {actDate}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={step === 'input_details' ? handleSubmitDetails : handleSubmitArticle}
          disabled={step === 'input_details' ? (!actNumber || !actDate) : !article}
        >
          {step === 'input_details' ? 'Continua' : "Apri l'articolo"}
        </Button>
        {/* The other door: leave with the act's index instead of one article. Offered on the
            article step, where the act (and its details, when required) is already settled. */}
        {step === 'input_article' && onBrowseStructure && (
          <Button type="button" variant="secondary" icon={<List size={16} aria-hidden />} onClick={handleBrowse}>
            Apri l'indice e sfoglia
          </Button>
        )}
      </div>
    </div>
  );

  const body = (
    <motion.div
      key={step}
      {...stepMotion}
      className={cn(isDesktop ? 'flex min-h-0 flex-1 flex-col' : 'flex-1')}
    >
      {step === 'select_act' ? selectBody : detailsBody}
    </motion.div>
  );

  // ── «Filtri avanzati» and the keys ──────────────────────────────────────────────────────────────
  const filtersBlock = (
    <div className="shrink-0 border-t border-ink-100 dark:border-ink-800" onKeyDown={keepKeys}>
      <button
        type="button"
        onClick={() => setShowAdvancedFilters(value => !value)}
        aria-expanded={showAdvancedFilters}
        aria-controls={showAdvancedFilters ? 'command-palette-filters' : undefined}
        className={cn('flex w-full items-center justify-between gap-3 px-4 text-sm', 'min-h-[44px] md:min-h-10', FOCUS_RING)}
      >
        <span className="flex items-center gap-2 font-medium text-ink-800 dark:text-ink-100">
          <SlidersHorizontal size={14} aria-hidden />
          Filtri avanzati
        </span>
        <span className={cn('flex items-center gap-1 text-xs', activeFilters > 0 ? 'font-medium text-toga-700 dark:text-toga-300' : SUBTLE)}>
          {activeFiltersLabel(filters)}
          <ChevronDown size={14} aria-hidden className={cn('transition-[rotate] duration-150 motion-reduce:transition-none', showAdvancedFilters && 'rotate-180')} />
        </span>
      </button>
      {showAdvancedFilters && (
        <div id="command-palette-filters" className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 pb-3 text-xs">
          <label className={cn('flex flex-col gap-1', SUBTLE)}>
            Fonte
            <select
              value={filters.source}
              onChange={(event) => setFilters(previous => ({ ...previous, source: event.target.value as SearchFilters['source'] }))}
              className={SMALL_INPUT}
            >
              <option value="all">Tutte le fonti</option>
              <option value="normattiva">Normattiva</option>
              <option value="eurlex">EUR-Lex</option>
            </select>
          </label>
          <label className={cn('flex flex-col gap-1', SUBTLE)}>
            Dall'anno
            <input type="number" inputMode="numeric" placeholder="1990" value={filters.yearFrom ?? ''} onChange={(event) => setFilters(previous => ({ ...previous, yearFrom: event.target.value ? Number(event.target.value) : undefined }))} className={cn(SMALL_INPUT, 'w-24')} />
          </label>
          <label className={cn('flex flex-col gap-1', SUBTLE)}>
            All'anno
            <input type="number" inputMode="numeric" placeholder="2024" value={filters.yearTo ?? ''} onChange={(event) => setFilters(previous => ({ ...previous, yearTo: event.target.value ? Number(event.target.value) : undefined }))} className={cn(SMALL_INPUT, 'w-24')} />
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink-800 md:min-h-9 dark:text-ink-100">
            <input type="checkbox" className="size-4 accent-toga-600" checked={filters.onlyHistorical} onChange={(event) => setFilters(previous => ({ ...previous, onlyHistorical: event.target.checked }))} />
            Solo versioni storiche
          </label>
        </div>
      )}
    </div>
  );

  // The keys, on a computer only: a phone has none of them.
  const keysRow = isDesktop && (
    <div className={cn('flex shrink-0 items-center gap-4 border-t border-ink-100 px-4 py-2 text-xs dark:border-ink-800', SUBTLE)}>
      <span><kbd className="font-sans font-medium text-ink-800 dark:text-ink-100">↑↓</kbd> Naviga</span>
      <span><kbd className="font-sans font-medium text-ink-800 dark:text-ink-100">↵</kbd> Seleziona</span>
      <span><kbd className="font-sans font-medium text-ink-800 dark:text-ink-100">Esc</kbd> Chiudi</span>
    </div>
  );

  const content = (
    <ChosenRowScope.Provider value={inputValue}>
    <Command
      id="command-menu-root"
      label="Menu di ricerca"
      shouldFilter={false}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0">
        {/* One live region for the whole life of the palette, its text changing: a region that
            appears already holding its text is often not announced. */}
        <p role="status" className="sr-only">
          {decisionRef
            ? `Sentenza: ${formatDecisionShort(decisionRef)}. Invio per aprire.`
            : preview ? `${preview.text}. ${citationReady ? 'Premi Invio per cercare.' : 'Premi Invio per completare.'}`
              : topic ? `Cerca "${topic}" nelle sentenze della Cassazione.` : ''}
        </p>
        {fieldRow}
        {fieldLine}
        {steps}
      </div>
      {isDesktop ? (
        <>
          {body}
          {filtersBlock}
          {keysRow}
        </>
      ) : (
        // On a phone the field stays at the top and the rest scrolls under it.
        <motion.div layoutScroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {body}
          {filtersBlock}
        </motion.div>
      )}
    </Command>
    </ChosenRowScope.Provider>
  );

  // A phone: a sheet from the bottom, the whole width (`ui/Sheet`, its own «Chiudi»).
  if (!isDesktop) {
    if (!isOpen) return null;
    return (
      <Sheet
        title="Menu di ricerca"
        onClose={onClose}
        initialFocusRef={step === 'select_act' ? boxRef : undefined}
        closeOnBackdrop
        className={Z_INDEX.commandPalette}
      >
        {content}
      </Sheet>
    );
  }

  return (
    <FloatingPortal>
      {/* Covers the workspace: Cmd/Ctrl+F is left to the browser (`isWorkspaceCovered`). Drawn only while
          open, so the mark goes with the click that closes, not with the panel's fade. */}
      {isOpen && (
        <div
          data-find-overlay=""
          aria-hidden
          className={cn('fixed inset-0 bg-ink-950/20 dark:bg-ink-950/50', Z_INDEX.commandPalette)}
          onClick={onClose}
        />
      )}
      <AnimatePresence>
        {isOpen && (
          // Two elements: the outer is placed by floating-ui, the inner moves (gotcha 10).
          <div
            key="command-palette"
            ref={anchor ? refs.setFloating : undefined}
            style={anchor ? floatingStyles : undefined}
            className={cn(
              // The box holds the panel's height; only the panel takes the pointer (a shorter step
              // leaves the rest of the box to the backdrop's click).
              'pointer-events-none flex flex-col',
              anchor ? 'fixed' : 'fixed inset-x-4 top-16 mx-auto h-[min(40rem,calc(100dvh-6rem))] max-w-3xl',
              Z_INDEX.commandPalette,
            )}
          >
            {/* It drops a few pixels from the field and fades in (about 160 ms), and leaves faster;
                under reduced motion it only fades. */}
            <motion.div
              initial={still ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={still ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={still ? { opacity: 0, transition: { duration: dur.press } } : { opacity: 0, y: -4, transition: { duration: dur.press, ease: ease.out } }}
              transition={{ duration: dur.pop, ease: ease.out }}
              className={cn(
                'pointer-events-auto flex min-h-0 max-h-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900',
                step === 'select_act' && 'flex-1',
              )}
            >
              {content}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </FloatingPortal>
  );
}
