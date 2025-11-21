import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { Search, Book, FileText, Globe, X } from 'lucide-react';
import type { SearchParams } from '../../../types';
import { cn } from '../../../lib/utils';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (params: SearchParams) => void;
}

const ACT_TYPES = [
  { label: 'Costituzione', value: 'costituzione', group: 'Fonti Primarie', icon: FileText },
  { label: 'Legge', value: 'legge', group: 'Fonti Primarie', icon: FileText },
  { label: 'Decreto Legge', value: 'decreto legge', group: 'Fonti Primarie', icon: FileText },
  { label: 'Decreto Legislativo', value: 'decreto legislativo', group: 'Fonti Primarie', icon: FileText },
  { label: 'Codice Civile', value: 'codice civile', group: 'Codici', icon: Book },
  { label: 'Codice Penale', value: 'codice penale', group: 'Codici', icon: Book },
  { label: 'Codice Proc. Civile', value: 'codice di procedura civile', group: 'Codici', icon: Book },
  { label: 'Codice Proc. Penale', value: 'codice di procedura penale', group: 'Codici', icon: Book },
  { label: 'Regolamento UE', value: 'Regolamento UE', group: 'Unione Europea', icon: Globe },
  { label: 'Direttiva UE', value: 'Direttiva UE', group: 'Unione Europea', icon: Globe },
  { label: 'TUE', value: 'TUE', group: 'Unione Europea', icon: Globe },
  { label: 'TFUE', value: 'TFUE', group: 'Unione Europea', icon: Globe },
  { label: 'CDFUE', value: 'CDFUE', group: 'Unione Europea', icon: Globe },
];

const ACT_TYPES_REQUIRING_DETAILS = [
  'legge', 'decreto legge', 'decreto legislativo',
  'Regolamento UE', 'Direttiva UE'
];

type PaletteStep = 'select_act' | 'input_article' | 'input_details';

export function CommandPalette({ isOpen, onClose, onSearch }: CommandPaletteProps) {
  const [step, setStep] = useState<PaletteStep>('select_act');
  const [selectedAct, setSelectedAct] = useState('');
  const [article, setArticle] = useState('1');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [inputValue, setInputValue] = useState('');

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

  const handleSubmitArticle = useCallback(() => {
    if (!selectedAct || !article) return;

    onSearch({
      act_type: selectedAct,
      article,
      act_number: actNumber || undefined,
      date: actDate || undefined,
      version: 'vigente',
      version_date: '',
      show_brocardi_info: true
    });

    onClose();
  }, [selectedAct, article, actNumber, actDate, onSearch, onClose]);

  const handleSubmitDetails = useCallback(() => {
    if (!selectedAct || !actNumber || !actDate) return;
    setStep('input_article');
  }, [selectedAct, actNumber, actDate]);

  if (!isOpen) return null;

  const selectedActLabel = ACT_TYPES.find(act => act.value === selectedAct)?.label;

  return (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
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
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <Search className="text-gray-400" size={20} />
            {step === 'select_act' && (
              <Command.Input
                value={inputValue}
                onValueChange={setInputValue}
                placeholder="Cerca tipo di atto..."
                className="flex-1 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 outline-none text-base"
              />
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
                    type="date"
                    value={actDate}
                    onChange={(e) => setActDate(e.target.value)}
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
                  placeholder="Numero articolo (es. 1414)"
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

          {/* Content */}
          {step === 'select_act' && (
            <Command.List className="max-h-[400px] overflow-y-auto p-2">
              <Command.Empty className="px-4 py-8 text-center text-gray-500 text-sm">
                Nessun risultato trovato.
              </Command.Empty>

              {Object.entries(
                ACT_TYPES.reduce((acc, act) => {
                  if (!acc[act.group]) acc[act.group] = [];
                  acc[act.group].push(act);
                  return acc;
                }, {} as Record<string, typeof ACT_TYPES>)
              ).map(([group, acts]) => (
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

          {/* Footer hint */}
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
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
