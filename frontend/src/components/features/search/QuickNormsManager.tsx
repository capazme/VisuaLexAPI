import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Link, FileText, Star, Trash2, ExternalLink, Pencil, Check } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { parseNormattivaUrl, generateLabelFromParams, validateSearchParams } from '../../../utils/normattivaParser';
import type { SearchParams, QuickNorm } from '../../../types';
import { cn } from '../../../lib/utils';
import { getActTypesByGroup } from '../../../constants/actTypes';
import { useTour } from '../../../hooks/useTour';

interface QuickNormsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch?: (params: SearchParams) => void; // Optional - QuickNorms use triggerSearch from store
}

type InputMode = 'url' | 'manual';

export function QuickNormsManager({ isOpen, onClose }: QuickNormsManagerProps) {
  const { quickNorms, addQuickNorm, removeQuickNorm, updateQuickNormLabel, selectQuickNorm, triggerSearch } = useAppStore();
  const { tryStartTour } = useTour();

  // Start quickNorms tour on first open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => tryStartTour('quickNorms'), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, tryStartTour]);

  const [inputMode, setInputMode] = useState<InputMode>('manual');
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  // Manual form state
  const [actType, setActType] = useState('codice civile');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [article, setArticle] = useState('1');
  const [customLabel, setCustomLabel] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const resetForm = useCallback(() => {
    setUrlInput('');
    setUrlError(null);
    setActType('codice civile');
    setActNumber('');
    setActDate('');
    setArticle('1');
    setCustomLabel('');
  }, []);

  const handleUrlParse = useCallback(() => {
    if (!urlInput.trim()) {
      setUrlError('Inserisci un URL di Normattiva');
      return;
    }

    const result = parseNormattivaUrl(urlInput);

    if (!result.success || !result.params) {
      setUrlError(result.error || 'Impossibile parsare l\'URL');
      return;
    }

    // Fill form with parsed data
    if (result.params.act_type) setActType(result.params.act_type);
    if (result.params.act_number) setActNumber(result.params.act_number);
    if (result.params.date) setActDate(result.params.date);
    if (result.params.article) setArticle(result.params.article);

    // Generate suggested label
    setCustomLabel(generateLabelFromParams(result.params));
    setUrlError(null);

    // Switch to manual mode to review/edit
    setInputMode('manual');
  }, [urlInput]);

  const handleAddQuickNorm = useCallback(() => {
    const searchParams: SearchParams = {
      act_type: actType,
      act_number: actNumber,
      date: actDate,
      article: article || '1',
      version: 'vigente',
      show_brocardi_info: true
    };

    if (!validateSearchParams(searchParams)) {
      return;
    }

    const label = customLabel.trim() || generateLabelFromParams(searchParams);
    addQuickNorm(label, searchParams, inputMode === 'url' ? urlInput : undefined);
    resetForm();
  }, [actType, actNumber, actDate, article, customLabel, urlInput, inputMode, addQuickNorm, resetForm]);

  const handleUseQuickNorm = useCallback((qn: QuickNorm) => {
    selectQuickNorm(qn.id);
    triggerSearch(qn.searchParams);
    onClose();
  }, [selectQuickNorm, triggerSearch, onClose]);

  const handleStartEdit = useCallback((qn: QuickNorm) => {
    setEditingId(qn.id);
    setEditLabel(qn.label);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingId && editLabel.trim()) {
      updateQuickNormLabel(editingId, editLabel.trim());
    }
    setEditingId(null);
    setEditLabel('');
  }, [editingId, editLabel, updateQuickNormLabel]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditLabel('');
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={cn(
          'relative w-full max-w-2xl max-h-[85vh] overflow-hidden',
          'bg-white/85 dark:bg-slate-900/85 backdrop-blur-2xl',
          'rounded-2xl shadow-glass-lg',
          'border border-white/20 dark:border-white/10',
          'flex flex-col'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 dark:border-white/5 bg-white/20 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <Star className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Ricerche Frequenti
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-500 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Add New Section */}
          <div id="tour-qn-add" className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Aggiungi Nuova
            </h3>

            {/* Mode Toggle */}
            <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              <button
                onClick={() => setInputMode('manual')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  inputMode === 'manual'
                    ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                )}
              >
                <FileText size={16} />
                Manuale
              </button>
              <button
                onClick={() => setInputMode('url')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  inputMode === 'url'
                    ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                )}
              >
                <Link size={16} />
                Da Link
              </button>
            </div>

            {/* URL Input */}
            {inputMode === 'url' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      setUrlError(null);
                    }}
                    placeholder="Incolla link di Normattiva..."
                    className={cn(
                      'flex-1 px-4 py-2.5 rounded-xl text-sm',
                      'bg-slate-50 dark:bg-slate-800 border',
                      urlError
                        ? 'border-red-300 dark:border-red-700'
                        : 'border-slate-200 dark:border-slate-700',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500/30'
                    )}
                  />
                  <button
                    onClick={handleUrlParse}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    Importa
                  </button>
                </div>
                {urlError && (
                  <p className="text-sm text-red-500">{urlError}</p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Esempio: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art1
                </p>
              </div>
            )}

            {/* Manual Form */}
            {inputMode === 'manual' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      Tipo Atto
                    </label>
                    <select
                      value={actType}
                      onChange={(e) => setActType(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    >
                      {Object.entries(getActTypesByGroup()).map(([group, acts]) => (
                        <optgroup key={group} label={group}>
                          {acts.map(at => (
                            <option key={at.value} value={at.value}>{at.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      Articolo
                    </label>
                    <input
                      type="text"
                      value={article}
                      onChange={(e) => setArticle(e.target.value)}
                      placeholder="es. 2043"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      Numero Atto <span className="text-slate-400">(opzionale)</span>
                    </label>
                    <input
                      type="text"
                      value={actNumber}
                      onChange={(e) => setActNumber(e.target.value)}
                      placeholder="es. 241"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      Data <span className="text-slate-400">(opzionale)</span>
                    </label>
                    <input
                      type="text"
                      value={actDate}
                      onChange={(e) => setActDate(e.target.value)}
                      placeholder="aaaa-mm-gg"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    Nome personalizzato <span className="text-slate-400">(opzionale)</span>
                  </label>
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder="es. Risarcimento del danno"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>

                <button
                  onClick={handleAddQuickNorm}
                  disabled={!actType || !article}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors disabled:cursor-not-allowed"
                >
                  <Plus size={18} />
                  Aggiungi ai Preferiti
                </button>
              </div>
            )}
          </div>

          {/* Saved QuickNorms */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Le tue Ricerche Frequenti ({quickNorms.length})
            </h3>

            {quickNorms.length === 0 ? (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                <Star className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nessuna ricerca frequente salvata</p>
                <p className="text-xs mt-1">Aggiungi le norme che consulti spesso per accedervi rapidamente</p>
              </div>
            ) : (
              <div className="space-y-2">
                {quickNorms.map((qn) => (
                  <div
                    key={qn.id}
                    className="group flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    {editingId === qn.id ? (
                      // Edit mode
                      <>
                        <Star className="w-4 h-4 text-amber-500 shrink-0" />
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            className="flex-1 px-3 py-1.5 rounded-lg text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            autoFocus
                          />
                          <button
                            onClick={handleSaveEdit}
                            className="p-2 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg text-green-600"
                            title="Salva"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-500"
                            title="Annulla"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </>
                    ) : (
                      // View mode
                      <>
                        <button
                          onClick={() => handleUseQuickNorm(qn)}
                          className="flex-1 flex items-center gap-3 text-left"
                        >
                          <Star className="w-4 h-4 text-amber-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-white truncate">
                              {qn.label}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {qn.searchParams.act_type}
                              {qn.searchParams.act_number && ` n. ${qn.searchParams.act_number}`}
                              {qn.usageCount > 0 && ` · Usato ${qn.usageCount}x`}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleStartEdit(qn)}
                            className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg text-slate-500 hover:text-blue-600"
                            title="Rinomina"
                          >
                            <Pencil size={16} />
                          </button>
                          {qn.sourceUrl && (
                            <a
                              href={qn.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-500"
                              title="Apri su Normattiva"
                            >
                              <ExternalLink size={16} />
                            </a>
                          )}
                          <button
                            onClick={() => removeQuickNorm(qn.id)}
                            className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg text-slate-500 hover:text-red-600"
                            title="Rimuovi"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
