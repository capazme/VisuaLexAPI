import { useEffect, useState, useCallback, useMemo } from 'react';
import { Command } from 'cmdk';
import { Search, X, Check, Star, Zap, Lightbulb, Settings2 } from 'lucide-react';
import type { SearchParams } from '../../../types';
import { cn } from '../../../lib/utils';
import { parseItalianDate } from '../../../utils/dateUtils';
import { useAppStore } from '../../../store/useAppStore';
import { parseLegalCitation, isSearchReady, formatParsedCitation, toSearchParams, type ParsedCitation } from '../../../utils/citationParser';
import { useTour } from '../../../hooks/useTour';
import { ACT_TYPES, ACT_TYPES_REQUIRING_DETAILS, getActTypesByGroup } from '../../../constants/actTypes';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (params: SearchParams) => void;
}

type PaletteStep = 'select_act' | 'input_article' | 'input_details';

export function CommandPalette({ isOpen, onClose, onSearch }: CommandPaletteProps) {
  const { quickNorms, useQuickNorm, settings, openQuickNormsManager } = useAppStore();
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

  // Smart citation parsing
  const parsedCitation = useMemo<ParsedCitation | null>(() => {
    if (!inputValue || inputValue.length < 3) return null;
    return parseLegalCitation(inputValue);
  }, [inputValue]);

  const citationReady = useMemo(() => isSearchReady(parsedCitation), [parsedCitation]);
  const citationPreview = useMemo(() => parsedCitation ? formatParsedCitation(parsedCitation) : '', [parsedCitation]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setStep('select_act');
        setSelectedAct('');
        setArticle('1');
        setActNumber('');
        setActDate('');
        setInputValue('');
      }, 200);
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

    if (ACT_TYPES_REQUIRING_DETAILS.includes(actValue)) {
      setStep('input_details');
    } else {
      setStep('input_article');
    }
  }, []);

  const handleSelectQuickNorm = useCallback((id: string) => {
    const qn = useQuickNorm(id);
    if (qn) {
      onSearch(qn.searchParams);
      onClose();
    }
  }, [useQuickNorm, onSearch, onClose]);

  const handleOpenQuickNormsManager = useCallback(() => {
    onClose();
    // Small delay to let the palette close before opening manager
    setTimeout(() => openQuickNormsManager(), 100);
  }, [onClose, openQuickNormsManager]);

  // Handle smart citation search
  const handleCitationSearch = useCallback(() => {
    if (!parsedCitation) return;

    if (citationReady) {
      // Citation is complete - search immediately
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
      // Partial citation - pre-fill fields and move to next step
      setSelectedAct(parsedCitation.act_type);
      if (parsedCitation.article) setArticle(parsedCitation.article);
      if (parsedCitation.act_number) setActNumber(parsedCitation.act_number);
      if (parsedCitation.date) setActDate(parsedCitation.date);
      setInputValue('');

      if (ACT_TYPES_REQUIRING_DETAILS.includes(parsedCitation.act_type)) {
        if (parsedCitation.act_number && parsedCitation.date) {
          setStep('input_article');
        } else {
          setStep('input_details');
        }
      } else {
        setStep('input_article');
      }
    }
  }, [parsedCitation, citationReady, onSearch, onClose, includeBrocardi]);

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

  if (!isOpen) return null;

  const selectedActLabel = ACT_TYPES.find(act => act.value === selectedAct)?.label;

  return (
    <div className="fixed inset-0 z-[9999] animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Command Palette */}
      <div className="fixed left-1/2 top-[20vh] -translate-x-1/2 w-full max-w-2xl">
        <Command
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
          label="Command Menu"
        >
          {/* Header */}
          <div className="border-b border-gray-200 dark:border-gray-800">
            {/* Step Indicators */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <div className={cn(
                "flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium transition-colors",
                step === 'select_act' ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" :
                  selectedAct ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400" :
                    "bg-gray-100 dark:bg-gray-800 text-gray-500"
              )}>
                {selectedAct ? <Check size={14} /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-current" />}
                <span>Atto</span>
              </div>
              {ACT_TYPES_REQUIRING_DETAILS.includes(selectedAct) && (
                <div className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium transition-colors",
                  step === 'input_details' ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" :
                    (actNumber && actDate) ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400" :
                      "bg-gray-100 dark:bg-gray-800 text-gray-500"
                )}>
                  {(actNumber && actDate) ? <Check size={14} /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-current" />}
                  <span>Dettagli</span>
                </div>
              )}
              <div className={cn(
                "flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium transition-colors",
                step === 'input_article' ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" :
                  "bg-gray-100 dark:bg-gray-800 text-gray-500"
              )}>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-current" />
                <span>Articolo</span>
              </div>
            </div>

            {/* Input Area */}
            <div className="flex items-center gap-3 px-4 pb-3">
              <Search className="text-gray-400" size={20} />
              {step === 'select_act' && (
                <div className="flex-1">
                  <Command.Input
                    value={inputValue}
                    onValueChange={setInputValue}
                    placeholder="Incolla citazione (es. 'art 2043 cc') o seleziona..."
                    className="w-full bg-transparent text-gray-900 dark:text-white placeholder-gray-400 outline-none text-base"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && parsedCitation) {
                        e.preventDefault();
                        handleCitationSearch();
                      }
                    }}
                  />
                  {/* Citation preview */}
                  {parsedCitation && citationPreview && (
                    <div className="mt-2 flex items-center gap-2">
                      <Zap size={14} className={cn(
                        citationReady ? "text-green-500" : "text-amber-500"
                      )} />
                      <span className={cn(
                        "text-sm font-medium",
                        citationReady ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
                      )}>
                        {citationPreview}
                      </span>
                      {citationReady ? (
                        <span className="text-xs text-green-500">↵ per cercare</span>
                      ) : (
                        <span className="text-xs text-amber-500">↵ per completare</span>
                      )}
                    </div>
                  )}
                  {!parsedCitation && (
                    <div className="mt-1 flex gap-2">
                      <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-gray-50 dark:bg-gray-800 px-1.5 text-[10px] font-medium text-gray-500">
                        <span className="text-xs">⌘</span>K
                      </kbd>
                    </div>
                  )}
                </div>
              )}
              {step === 'input_details' && (
                <div className="flex-1">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span className="font-semibold text-gray-900 dark:text-white">{selectedActLabel}</span>
                  </p>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder="Numero (es. 241)"
                      value={actNumber}
                      onChange={(e) => setActNumber(e.target.value)}
                      className="flex-1 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-700 outline-none focus:border-blue-500"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmitDetails()}
                    />
                    <input
                      type="text"
                      value={actDate}
                      onChange={(e) => setActDate(e.target.value)}
                      placeholder="aaaa o gg-mm-aaaa"
                      className="flex-1 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-700 outline-none focus:border-blue-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmitDetails()}
                    />
                  </div>
                </div>
              )}
              {step === 'input_article' && (
                <div className="flex-1">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span className="font-semibold text-gray-900 dark:text-white">{selectedActLabel}</span>
                    {actNumber && actDate && (
                      <span className="ml-2 text-xs text-gray-500">n. {actNumber} del {actDate}</span>
                    )}
                  </p>
                  <input
                    type="text"
                    placeholder="Numero articolo (es. 1414) o range (es. 1414-1415)"
                    value={article}
                    onChange={(e) => setArticle(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-700 outline-none focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitArticle()}
                  />
                </div>
              )}
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <X size={18} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* Content */}
          {step === 'select_act' && (
            <Command.List id="command-palette-results" className="max-h-[400px] overflow-y-auto p-2">
              <Command.Empty className="px-4 py-8 text-center text-gray-500 text-sm">
                Nessun risultato trovato.
              </Command.Empty>

              {/* QuickNorms - Favorite norms for quick access */}
              <Command.Group heading="Preferiti" className="px-2 py-2">
                <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-2 px-2 flex items-center gap-1.5">
                  <Star size={12} fill="currentColor" />
                  Preferiti
                </div>
                {/* Manage QuickNorms - Always visible */}
                <Command.Item
                  value="gestisci preferiti manage favorites"
                  onSelect={handleOpenQuickNormsManager}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                    "aria-selected:bg-blue-50 dark:aria-selected:bg-blue-900/20",
                    "aria-selected:text-blue-600 dark:aria-selected:text-blue-400"
                  )}
                >
                  <Settings2 size={16} className="text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">Gestisci Preferiti</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block">
                      Aggiungi, modifica o rimuovi ricerche frequenti
                    </span>
                  </div>
                </Command.Item>
                {quickNorms.slice(0, 5).map((qn) => (
                  <Command.Item
                    key={qn.id}
                    value={`preferito ${qn.label}`}
                    onSelect={() => handleSelectQuickNorm(qn.id)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                      "aria-selected:bg-amber-50 dark:aria-selected:bg-amber-900/20",
                      "aria-selected:text-amber-700 dark:aria-selected:text-amber-400"
                    )}
                  >
                    <Star size={16} className="text-amber-500" fill="currentColor" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{qn.label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate block">
                        {qn.searchParams.act_type}
                        {qn.searchParams.act_number && ` n. ${qn.searchParams.act_number}`}
                      </span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>

              {Object.entries(getActTypesByGroup()).map(([group, acts]) => (
                <Command.Group key={group} heading={group} className="px-2 py-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 px-2">
                    {group}
                  </div>
                  {acts.map((act) => {
                    const Icon = act.icon;
                    return (
                      <Command.Item
                        key={act.value}
                        value={act.value}
                        onSelect={() => handleSelectAct(act.value)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                          "aria-selected:bg-blue-50 dark:aria-selected:bg-blue-900/20",
                          "aria-selected:text-blue-600 dark:aria-selected:text-blue-400"
                        )}
                      >
                        <Icon size={16} className="text-gray-400" />
                        <span className="text-sm">{act.label}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          )}

          {step === 'input_details' && (
            <div className="p-4">
              <button
                onClick={handleSubmitDetails}
                disabled={!actNumber || !actDate}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                Continua
              </button>
            </div>
          )}

          {step === 'input_article' && (
            <div className="p-4">
              <button
                onClick={handleSubmitArticle}
                disabled={!article}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                Cerca Articolo
              </button>
            </div>
          )}

          {/* Footer with options and hints */}
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            {/* Brocardi Toggle */}
            <div id="command-palette-brocardi-toggle" className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={includeBrocardi}
                    onChange={(e) => setIncludeBrocardi(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Lightbulb size={14} className={includeBrocardi ? "text-blue-500" : "text-gray-400"} />
                  Includi Brocardi
                </span>
              </label>
              <span className="text-xs text-gray-400">spiegazioni, ratio, massime</span>
            </div>
            {/* Keyboard hints */}
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-4">
                <span><kbd className="px-2 py-1 bg-white dark:bg-gray-900 rounded border border-gray-300 dark:border-gray-700">↑↓</kbd> naviga</span>
                <span><kbd className="px-2 py-1 bg-white dark:bg-gray-900 rounded border border-gray-300 dark:border-gray-700">↵</kbd> seleziona</span>
              </div>
              <span><kbd className="px-2 py-1 bg-white dark:bg-gray-900 rounded border border-gray-300 dark:border-gray-700">esc</kbd> chiudi</span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
