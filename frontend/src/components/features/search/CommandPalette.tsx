import { useEffect, useState, useCallback, useMemo } from 'react';
import { Command } from 'cmdk';
import { Search, X, Check, Star, Zap, Lightbulb, ArrowRight, Book, Tag, List, Plus, Settings2, Sparkles } from 'lucide-react';
import type { SearchParams, CustomAlias } from '../../../types';
import { cn } from '../../../lib/utils';
import { parseItalianDate } from '../../../utils/dateUtils';
import { useAppStore } from '../../../store/useAppStore';
import { parseLegalCitation, isSearchReady, formatParsedCitation, toSearchParams, type ParsedCitation } from '../../../utils/citationParser';
import { useTour } from '../../../hooks/useTour';
import { ACT_TYPES, ACT_TYPES_REQUIRING_DETAILS, getActTypesByGroup } from '../../../constants/actTypes';
import { useAliasCatalog, foldAlias } from '../../../hooks/useAliasCatalog';
import { Z_INDEX } from '../../../constants/zIndex';
import { motion, AnimatePresence } from 'framer-motion';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (params: SearchParams) => void;
  /**
   * Open an act's index without picking an article — the "browse a code"
   * path. Skips the article step entirely.
   */
  onBrowseStructure?: (params: SearchParams) => void;
}

type PaletteStep = 'select_act' | 'input_article' | 'input_details';

/** Case-insensitive, for the reason given on `selectedActLabel`: an act named
 *  by the server ("regolamento ue") must reach the same branch as the same act
 *  picked from the grid ("Regolamento UE"), or the palette skips the step that
 *  collects its number and date. */
function requiresDetails(actValue: string): boolean {
  const wanted = (actValue || '').toLowerCase();
  return ACT_TYPES_REQUIRING_DETAILS.some(v => v.toLowerCase() === wanted);
}


export function CommandPalette({ isOpen, onClose, onSearch, onBrowseStructure }: CommandPaletteProps) {
  const {
    quickNorms, selectQuickNorm, settings, openQuickNormsManager,
    customAliases, trackAliasUsage, openAliasManager
  } = useAppStore();
  const { tryStartTour } = useTour({ theme: settings.theme as 'light' | 'dark' });
  const [step, setStep] = useState<PaletteStep>('select_act');
  const [selectedAct, setSelectedAct] = useState('');
  const [article, setArticle] = useState('1');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [includeBrocardi, setIncludeBrocardi] = useState(true);

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
      // "Codice Contratti Pubblici" tile that already sits in the grid below,
      // so listing them duplicated the act list without adding anything. The
      // 59 kept here carry a number and a date ("gdpr" -> Reg. UE 679/2016),
      // which is work the grid cannot save you.
      .filter(([, preset]) => Boolean(preset.act_number))
      // A custom alias with the same trigger wins at resolution time, so
      // showing the preset too would advertise a shortcut that no longer runs.
      .filter(([trigger]) => !mine.has(foldAlias(trigger)))
      // Shortest first: an alias earns its keep by being shorter than the name
      // it replaces.
      .sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  }, [catalog.presets, customAliases]);

  // Nothing at rest. The header line says they exist; that is the whole point
  // of not drawing them. They materialise once the user types, and cmdk does
  // the matching, so the full set stays reachable without ever weighing on the
  // idle palette.
  const visiblePresets = inputValue.trim() ? presetEntries : [];

  // Four, not three: the three shortest are all Testi Unici (tub, tuf, tus) and
  // read as cryptic on their own. The fourth is gdpr, which makes the whole
  // line legible at a glance.
  const presetHint = useMemo(
    () => presetEntries.slice(0, 4).map(([trigger]) => trigger).join(', '),
    [presetEntries]
  );

  // Smart citation parsing - include custom aliases for resolution
  // Es. "art 5 gdpr" risolve "gdpr" in Regolamento UE 679/2016
  const localCitation = useMemo<ParsedCitation | null>(() => {
    if (!inputValue || inputValue.length < 2) return null;
    return parseLegalCitation(inputValue, customAliases);
  }, [inputValue, customAliases]);

  // Server-side fallback for act names the client does not carry.
  //
  // The parser above knows the ~40 acts in constants/actTypes.ts plus the
  // ABBREVIATION_MAP hand-copied from the backend's NORMATTIVA_SEARCH. The
  // backend resolver knows 387 names — "statuto dei lavoratori", "legge
  // fornero", "TUSL", "GDPR" — so a lawyer typing any of them got "Nessun
  // risultato trovato" and an Enter that could only autocomplete, because
  // isSearchReady needs an act_type the client had no way to produce.
  //
  // Rather than grow a second copy of those tables here (they would drift the
  // first time the backend gained a name), ask the endpoint that already
  // resolves them. Only as a FALLBACK: whatever the client recognises today
  // still wins, so nothing that works now changes.
  // The answer carries the query it answered, so "is this still current?" is
  // derived at render instead of reset by a synchronous setState in the effect
  // (CLAUDE.md gotcha 11 — derive, do not silence the rule).
  const [serverResult, setServerResult] = useState<{ query: string; citation: ParsedCitation | null } | null>(null);

  // Gated on "not search-ready", not merely "act unnamed". Both shapes reach
  // here: "statuto dei lavoratori" the client cannot name at all, and "gdpr"
  // it names as regolamento UE but without the number and year that
  // isSearchReady requires — so both left the palette on ENTER COMPLETA.
  const remoteQuery = useMemo(() => {
    const query = inputValue.trim();
    return query.length >= 3 && !isSearchReady(localCitation) ? query : null;
  }, [inputValue, localCitation]);

  useEffect(() => {
    if (!remoteQuery) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch('/parse_query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: remoteQuery }),
        signal: controller.signal,
      })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(payload => {
          const parsed = payload?.recognized ? payload.parsed : null;
          setServerResult({
            query: remoteQuery,
            citation: parsed?.act_type
              ? {
                  act_type: parsed.act_type,
                  act_number: parsed.act_number || undefined,
                  date: parsed.date || undefined,
                  article: parsed.article || undefined,
                  // Named by the server's curated tables, not guessed.
                  confidence: 0.9,
                }
              : null,
          });
        })
        .catch(err => {
          if ((err as Error).name === 'AbortError') return;
          // Never swallowed (CLAUDE.md gotcha 18): the palette degrades to
          // local-only matching, but a backend that stopped answering is
          // visible rather than silent.
          console.error('Error resolving query server-side:', remoteQuery, err);
          setServerResult({ query: remoteQuery, citation: null });
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [remoteQuery]);

  const serverCitation = useMemo(
    () => (remoteQuery && serverResult?.query === remoteQuery ? serverResult.citation : null),
    [remoteQuery, serverResult]
  );
  const resolvingRemotely = Boolean(remoteQuery) && serverResult?.query !== remoteQuery;

  // The client wins when its own parse is already searchable; otherwise the
  // server fills in. Nothing that resolves locally today changes.
  const parsedCitation = useMemo<ParsedCitation | null>(
    () => (isSearchReady(localCitation) ? localCitation : serverCitation ?? localCitation),
    [localCitation, serverCitation]
  );

  const citationReady = useMemo(() => isSearchReady(parsedCitation), [parsedCitation]);
  const citationPreview = useMemo(() => parsedCitation ? formatParsedCitation(parsedCitation) : '', [parsedCitation]);

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

  // Handle Escape key
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [onClose]);

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
        show_brocardi_info: includeBrocardi
      });
      onClose();
    }
  }, [trackAliasUsage, onSearch, onClose, includeBrocardi]);

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

  const handleCitationSearch = useCallback(() => {
    if (!parsedCitation) return;

    // Track alias usage if citation was resolved from an alias
    if (parsedCitation.fromAlias && parsedCitation.aliasId) {
      trackAliasUsage(parsedCitation.aliasId);
    }

    if (citationReady) {
      const params = toSearchParams(parsedCitation);
      onSearch({
        ...params,
        date: params.date ? parseItalianDate(params.date) : '',
        version: 'vigente',
        version_date: '',
        show_brocardi_info: includeBrocardi
      });
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
  }, [parsedCitation, citationReady, onSearch, onClose, includeBrocardi, trackAliasUsage]);

  const handleSubmitArticle = useCallback(() => {
    if (!selectedAct || !article) return;

    onSearch({
      act_type: selectedAct,
      article,
      act_number: actNumber || '',
      date: actDate ? parseItalianDate(actDate) : '',
      version: 'vigente',
      version_date: '',
      show_brocardi_info: includeBrocardi
    });

    onClose();
  }, [selectedAct, article, actNumber, actDate, onSearch, onClose, includeBrocardi]);

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
      show_brocardi_info: includeBrocardi,
    });

    onClose();
  }, [selectedAct, actNumber, actDate, includeBrocardi, onBrowseStructure, onClose]);

  /**
   * The act as a human would name it.
   *
   * Matched case-insensitively, and falling back to the raw value, because the
   * two vocabularies disagree: ACT_TYPES carries `Regolamento UE` while the
   * server resolver answers `regolamento ue`. A `===` lookup missed, and the
   * header rendered " n. 1689 del 2024" with no act name at all while
   * "Stai consultando:" trailed off into nothing. Same trap as `codice_urn`
   * on the backend.
   */
  const selectedActLabel = useMemo(() => {
    if (!selectedAct) return '';
    const match = ACT_TYPES.find(
      act => act.value.toLowerCase() === selectedAct.toLowerCase()
    );
    return match?.label ?? selectedAct;
  }, [selectedAct]);

  if (!isOpen) return null;

  return (
    <div className={cn('fixed inset-0 p-4 sm:p-6 md:p-20 overflow-y-auto custom-scrollbar', Z_INDEX.commandPalette)}>
      {/* Premium Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Command Palette - Glass Overlay */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative mx-auto w-full max-w-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-glass border border-white dark:border-slate-800 overflow-hidden"
      >
        <Command
          id="command-menu-root"
          className="flex flex-col h-full"
          label="Menu di Ricerca"
        >
          {/* Header with Glass-style search area */}
          <div className="border-b border-slate-200 dark:border-slate-800">
            {/* Navigation / Step Breadcrumbs */}
            <div className="flex items-center gap-2 px-6 pt-5 pb-3">
              <div
                onClick={() => setStep('select_act')}
                className={cn(
                  "group flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                  step === 'select_act'
                    ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20"
                    : selectedAct
                      ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                )}
              >
                {selectedAct && step !== 'select_act' ? <Check size={12} strokeWidth={3} /> : <Book size={12} strokeWidth={3} />}
                <span>Atto</span>
              </div>

              {requiresDetails(selectedAct) && (
                <div
                  onClick={() => selectedAct && setStep('input_details')}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                    step === 'input_details'
                      ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20"
                      : (actNumber && actDate)
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                  )}
                >
                  {(actNumber && actDate) && step !== 'input_details' ? <Check size={12} strokeWidth={3} /> : <Zap size={12} strokeWidth={3} />}
                  <span>Dettagli</span>
                </div>
              )}

              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                step === 'input_article'
                  ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400"
              )}>
                <Star size={12} strokeWidth={3} />
                <span>Articolo</span>
              </div>
            </div>

            {/* Main Interactive Input Area */}
            <div className="flex items-center gap-4 px-6 pb-6">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                <Search size={24} strokeWidth={1.5} />
              </div>

              {step === 'select_act' && (
                <div className="flex-1">
                  <Command.Input
                    value={inputValue}
                    onValueChange={setInputValue}
                    placeholder="Es. 'cc', 'art 2043 cc' o seleziona..."
                    className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 outline-none text-xl font-bold tracking-tight"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && parsedCitation) {
                        e.preventDefault();
                        handleCitationSearch();
                      }
                    }}
                  />
                  <AnimatePresence>
                    {/* Citation Match Indicator (shows alias badge if from alias) */}
                    {parsedCitation && citationPreview && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-2 flex items-center gap-2.5"
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-md flex items-center justify-center",
                          parsedCitation.fromAlias
                            ? "bg-indigo-500 text-white"
                            : citationReady ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
                        )}>
                          {parsedCitation.fromAlias
                            ? <Tag size={10} strokeWidth={3} />
                            : <Zap size={10} fill="currentColor" strokeWidth={3} />
                          }
                        </div>
                        <span className={cn(
                          "text-xs font-bold uppercase tracking-wider",
                          parsedCitation.fromAlias
                            ? "text-indigo-600 dark:text-indigo-400"
                            : citationReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                        )}>
                          {parsedCitation.fromAlias && <span className="opacity-60 mr-1">via alias →</span>}
                          {citationPreview}
                        </span>
                        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          {citationReady ? "Enter Ricerca" : "Enter Completa"}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {step === 'input_details' && (
                <div className="flex-1 flex gap-3">
                  <input
                    type="text"
                    placeholder="N. Atto (es. 241)"
                    value={actNumber}
                    onChange={(e) => setActNumber(e.target.value)}
                    className="flex-[1.5] bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white px-4 py-3 rounded-2xl text-base font-bold border border-slate-200 dark:border-slate-700 outline-none focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 placeholder:text-slate-400"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitDetails()}
                  />
                  <input
                    type="text"
                    value={actDate}
                    onChange={(e) => setActDate(e.target.value)}
                    placeholder="Anno/Data"
                    className="flex-1 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white px-4 py-3 rounded-2xl text-base font-bold border border-slate-200 dark:border-slate-700 outline-none focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 placeholder:text-slate-400"
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitDetails()}
                  />
                </div>
              )}

              {step === 'input_article' && (
                <div className="flex-1 flex items-end gap-3">
                  {/* The context line sits in the flow. It used to be
                      `absolute -top-6`, which lifted it 24px into the
                      breadcrumb row above and printed it straight over the
                      ATTO / ARTICOLO chips. */}
                  <div className="flex-1 min-w-0">
                    {actNumber && actDate && (
                      <span className="block mb-1.5 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
                        {selectedActLabel} n. {actNumber} del {actDate}
                      </span>
                    )}
                    <input
                      type="text"
                      placeholder="N. Articolo (es. 12)"
                      value={article}
                      onChange={(e) => setArticle(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white px-4 py-3 rounded-2xl text-base font-bold border border-slate-200 dark:border-slate-700 outline-none focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 placeholder:text-slate-400"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmitArticle()}
                    />
                  </div>
                  <button
                    onClick={handleSubmitArticle}
                    className="aspect-square w-12 h-12 bg-primary-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/20 active:scale-90 transition-all"
                  >
                    <ArrowRight size={20} strokeWidth={3} />
                  </button>
                </div>
              )}

              <button
                onClick={onClose}
                className="p-2 sm:hidden text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Results List / Content */}
          <div className="flex-1 overflow-y-auto max-h-[60vh] custom-scrollbar bg-slate-50/30 dark:bg-slate-950/20">
            {step === 'select_act' && (
              <Command.List id="command-palette-results" className="p-3">
                <Command.Empty className="px-6 py-12 text-center text-slate-400">
                  {citationReady ? (
                    <>
                      {/* The act resolved, so Enter will search. Saying "nessun
                          risultato" here describes the local suggestion list,
                          not the query, and reads as a dead end. */}
                      <div className="w-16 h-16 rounded-3xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
                        <Check size={24} className="text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <p className="font-bold text-slate-600 dark:text-slate-300">{citationPreview}</p>
                      <p className="text-xs font-medium opacity-60 mt-1">Premi Enter per cercare</p>
                    </>
                  ) : resolvingRemotely ? (
                    <>
                      {/* The local list has nothing, but the backend resolver —
                          387 act names against the client's ~40 — has not
                          answered yet. Saying "nessun risultato" here would be
                          wrong for the two hundred milliseconds it takes. */}
                      <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
                        <Search size={24} className="animate-pulse" />
                      </div>
                      <p className="font-bold">Cerco l'atto…</p>
                      <p className="text-xs font-medium opacity-60 mt-1">Riconosco i nomi per esteso, non solo le sigle</p>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
                        <X size={24} />
                      </div>
                      <p className="font-bold">Nessun risultato trovato</p>
                      <p className="text-xs font-medium opacity-60 mt-1">Prova a cambiare i criteri di ricerca</p>
                    </>
                  )}
                </Command.Empty>

                {/* QuickNorms Section */}
                <Command.Group className="mb-4">
                  <div className="flex items-center justify-between px-3 mb-3">
                    <div className="flex items-center gap-2 text-[10px] font-black text-amber-500 uppercase tracking-widest">
                      <Star size={12} fill="currentColor" strokeWidth={3} />
                      Preferiti
                    </div>
                    <button
                      onClick={handleOpenQuickNormsManager}
                      className="p-1 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      Gestisci
                    </button>
                  </div>

                  {quickNorms.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {quickNorms.slice(0, 6).map((qn) => (
                        <Command.Item
                          key={qn.id}
                          value={`preferito ${qn.label}`}
                          onSelect={() => handleSelectQuickNorm(qn.id)}
                          className={cn(
                            "group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all",
                            "bg-white dark:bg-slate-900 border border-transparent",
                            "aria-selected:bg-primary-50 dark:aria-selected:bg-primary-900/10 aria-selected:border-primary-200/50 dark:aria-selected:border-primary-800/30"
                          )}
                        >
                          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-500 flex items-center justify-center group-aria-selected:scale-110 transition-transform">
                            <Star size={18} fill="currentColor" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="block text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{qn.label}</span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight line-clamp-1">{qn.searchParams.act_type}</span>
                          </div>
                        </Command.Item>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-2">Nessun preferito salvato</p>
                  )}
                </Command.Group>

                {/* Aliases.
                    Rendered unconditionally, on purpose. This group used to be
                    gated on `sortedAliases.length > 0`, which hid the only route
                    to the alias manager behind already owning an alias — you
                    could not discover how to make your first one. The manager is
                    reached from the tile below, which is a Command.Item so that
                    typing "alias" finds it even when the group is scrolled away. */}
                <Command.Group className="mb-4">
                  <div className="flex items-center justify-between gap-3 px-3 mb-3">
                    <div className="flex items-center gap-2 text-[10px] font-black text-indigo-500 uppercase tracking-widest">
                      <Tag size={12} strokeWidth={3} />
                      I tuoi alias
                    </div>
                    {/* At rest this line is the only trace the presets leave.
                        A second grid of tiles for them duplicated the act list
                        below it. */}
                    {presetEntries.length > 0 && (
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">
                        +{presetEntries.length} già pronti{presetHint && `: ${presetHint}…`}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {sortedAliases.slice(0, 8).map((alias) => (
                      <Command.Item
                        key={alias.id}
                        value={`alias ${alias.trigger} ${alias.expandTo}`}
                        onSelect={() => handleSelectAlias(alias)}
                        className={cn(
                          "group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all",
                          "bg-white dark:bg-slate-900 border border-transparent",
                          "aria-selected:bg-indigo-50 dark:aria-selected:bg-indigo-900/10 aria-selected:border-indigo-200/50 dark:aria-selected:border-indigo-800/30"
                        )}
                      >
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center group-aria-selected:scale-110 transition-transform bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500">
                          <Tag size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="block text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                            {alias.trigger}
                          </span>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight line-clamp-1">
                            → {alias.expandTo}
                          </span>
                        </div>
                      </Command.Item>
                    ))}

                    {/* The door to the manager. Spans the grid when it is the
                        only tile, so an empty alias list reads as an invitation
                        rather than as an empty section. */}
                    <Command.Item
                      value="alias gestisci crea scorciatoie"
                      onSelect={handleOpenAliasManager}
                      className={cn(
                        "group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all",
                        "border border-dashed border-indigo-300 dark:border-indigo-800",
                        "aria-selected:bg-indigo-50 dark:aria-selected:bg-indigo-900/10 aria-selected:border-indigo-500",
                        !hasAliases && "sm:col-span-2"
                      )}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center group-aria-selected:scale-110 transition-transform bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500">
                        {hasAliases ? <Settings2 size={18} /> : <Plus size={18} strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-indigo-600 dark:text-indigo-400 truncate">
                          {hasAliases ? 'Gestisci alias' : 'Crea il tuo primo alias'}
                        </span>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight line-clamp-1">
                          {hasAliases
                            ? 'I tuoi, più quelli già riconosciuti'
                            : 'Una sigla tua per una norma che apri spesso'}
                        </span>
                      </div>
                    </Command.Item>
                  </div>
                </Command.Group>

                {/* Presets — only while the user is typing. Its own
                    Command.Group so cmdk hides the heading along with the
                    items when a query filters them all out. */}
                {visiblePresets.length > 0 && (
                  <Command.Group className="mb-4">
                    <div className="flex items-center justify-between px-3 mb-3">
                      <div className="flex items-center gap-2 text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest">
                        <Sparkles size={12} strokeWidth={3} />
                        In dotazione
                      </div>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        Non devi crearli
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {visiblePresets.map(([trigger, preset]) => (
                        <Command.Item
                          key={trigger}
                          value={`preset ${trigger} ${preset.act_type}`}
                          onSelect={() => handleSelectPreset(trigger)}
                          className={cn(
                            "group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all",
                            "bg-white dark:bg-slate-900 border border-transparent",
                            "aria-selected:bg-emerald-50 dark:aria-selected:bg-emerald-900/10 aria-selected:border-emerald-200/50 dark:aria-selected:border-emerald-800/30"
                          )}
                        >
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center group-aria-selected:scale-110 transition-transform bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-500">
                            <Sparkles size={18} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="block text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                              {trigger}
                            </span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight line-clamp-1">
                              → {[preset.act_type, preset.act_number && `n. ${preset.act_number}`, preset.date]
                                  .filter(Boolean)
                                  .join(' ')}
                            </span>
                          </div>
                        </Command.Item>
                      ))}
                    </div>
                  </Command.Group>
                )}

                {/* Unified Act Types Section */}
                <div className="space-y-4">
                  {Object.entries(getActTypesByGroup()).map(([group, acts]) => (
                    <Command.Group key={group} className="space-y-1">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-2">
                        {group}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 px-1 pb-1">
                        {acts.map((act) => {
                          const Icon = act.icon;
                          const isSelected = selectedAct === act.value;
                          return (
                            <Command.Item
                              key={act.value}
                              value={act.value}
                              onSelect={() => handleSelectAct(act.value)}
                              className={cn(
                                "group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all",
                                "bg-white dark:bg-slate-900 border border-slate-100/50 dark:border-slate-800/50",
                                "aria-selected:bg-primary-500 aria-selected:border-primary-600 aria-selected:shadow-lg aria-selected:shadow-primary-500/20",
                                isSelected && !step.includes('select_act') && "border-emerald-500 ring-2 ring-emerald-500/5"
                              )}
                            >
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                                "bg-slate-50 dark:bg-slate-800 group-aria-selected:bg-primary-600 text-slate-400 group-aria-selected:text-white"
                              )}>
                                <Icon size={20} />
                              </div>
                              <span className="text-sm font-bold text-slate-700 dark:text-slate-200 group-aria-selected:text-white">{act.label}</span>
                            </Command.Item>
                          );
                        })}
                      </div>
                    </Command.Group>
                  ))}
                </div>
              </Command.List>
            )}

            {(step === 'input_details' || step === 'input_article') && (
              <div className="p-8">
                <div className="w-20 h-20 rounded-3xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 mx-auto mb-6">
                  <Zap size={40} strokeWidth={1} />
                </div>
                <div className="text-center mb-8">
                  <h4 className="text-xl font-black text-slate-900 dark:text-white mb-2 uppercase tracking-tight">Inserisci {step === 'input_details' ? 'i Dettagli' : 'Articolo'}</h4>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                    Stai consultando: <span className="text-primary-600 dark:text-primary-400 font-bold">{selectedActLabel}</span>
                  </p>
                </div>

                <button
                  onClick={step === 'input_details' ? handleSubmitDetails : handleSubmitArticle}
                  disabled={step === 'input_details' ? (!actNumber || !actDate) : !article}
                  className="w-full flex items-center justify-center gap-3 h-14 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-primary-500/20 disabled:shadow-none active:scale-[0.98]"
                >
                  <span>Continua</span>
                  <ArrowRight size={20} strokeWidth={3} />
                </button>

                {/* The other door: leave with the act's index instead of one
                    article. Offered on the article step, where the act (and its
                    details, when required) is already settled. */}
                {step === 'input_article' && onBrowseStructure && (
                  <button
                    onClick={handleBrowse}
                    className="mt-3 w-full flex items-center justify-center gap-3 h-12 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-bold transition-all hover:bg-emerald-100 dark:hover:bg-emerald-900/30 active:scale-[0.98]"
                  >
                    <List size={18} strokeWidth={2.5} />
                    <span>Apri l'indice e sfoglia</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Premium Footer */}
          <div className="px-6 py-5 border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl">
            {/* Quick Settings - Brocardi Toggle */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "p-2 rounded-xl border transition-all",
                  includeBrocardi
                    ? "bg-purple-500 text-white border-purple-600 shadow-md shadow-purple-500/20"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700"
                )}>
                  <Lightbulb size={16} fill={includeBrocardi ? "currentColor" : "none"} />
                </div>
                <div>
                  <span className="block text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">Includi dottrina</span>
                  <span className="text-[10px] font-bold text-slate-400">Ratio legis, spiegazioni e massime correlate</span>
                </div>
              </div>

              <div
                onClick={() => setIncludeBrocardi(!includeBrocardi)}
                className={cn(
                  "w-12 h-6 rounded-full relative transition-colors p-1 cursor-pointer",
                  includeBrocardi ? "bg-purple-500" : "bg-slate-200 dark:bg-slate-700"
                )}
              >
                <motion.div
                  className="w-4 h-4 rounded-full bg-white shadow-sm"
                  animate={{ x: includeBrocardi ? 24 : 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 25 }}
                />
              </div>
            </div>

            {/* Hint Badges */}
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100/50 dark:bg-slate-800/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200/50 dark:border-slate-700/50">
                <span className="bg-white dark:bg-slate-900 px-1 rounded shadow-sm border border-slate-200 dark:border-slate-700">↑↓</span> Naviga
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100/50 dark:bg-slate-800/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200/50 dark:border-slate-700/50">
                <span className="bg-white dark:bg-slate-900 px-1 rounded shadow-sm border border-slate-200 dark:border-slate-700">↵</span> Seleziona
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100/50 dark:bg-slate-800/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200/50 dark:border-slate-700/50">
                <span className="bg-white dark:bg-slate-900 px-1 rounded shadow-sm border border-slate-200 dark:border-slate-700">ESC</span> Chiudi
              </div>
            </div>
          </div>
        </Command>
      </motion.div>
    </div>
  );
}
