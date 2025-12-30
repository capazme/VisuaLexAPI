import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, RefreshCw, Eraser, Plus, Minus, Loader2, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SearchParams } from '../../../types';
import { parseItalianDate } from '../../../utils/dateUtils';
import { extractArticleIdsFromTree } from '../../../utils/treeUtils';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { FOCUS_RING } from '../../../constants/interactions';
import { useAppStore } from '../../../store/useAppStore';

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  isLoading: boolean;
}

const ACT_TYPES = [
  // Fonti Primarie
  { label: 'Costituzione', value: 'costituzione', group: 'Fonti Primarie' },
  { label: 'Legge', value: 'legge', group: 'Fonti Primarie' },
  { label: 'Decreto Legge', value: 'decreto legge', group: 'Fonti Primarie' },
  { label: 'Decreto Legislativo', value: 'decreto legislativo', group: 'Fonti Primarie' },
  { label: 'D.P.R.', value: 'decreto del presidente della repubblica', group: 'Fonti Primarie' },
  { label: 'Regio Decreto', value: 'regio decreto', group: 'Fonti Primarie' },

  // Codici Fondamentali
  { label: 'Codice Civile', value: 'codice civile', group: 'Codici Fondamentali' },
  { label: 'Codice Penale', value: 'codice penale', group: 'Codici Fondamentali' },
  { label: 'Codice Proc. Civile', value: 'codice di procedura civile', group: 'Codici Fondamentali' },
  { label: 'Codice Proc. Penale', value: 'codice di procedura penale', group: 'Codici Fondamentali' },
  { label: 'Preleggi', value: 'preleggi', group: 'Codici Fondamentali' },
  { label: 'Disp. Att. Cod. Civile', value: 'disposizioni per l\'attuazione del Codice civile e disposizioni transitorie', group: 'Codici Fondamentali' },
  { label: 'Disp. Att. Cod. Proc. Civile', value: 'disposizioni per l\'attuazione del Codice di procedura civile e disposizioni transitorie', group: 'Codici Fondamentali' },

  // Codici Settoriali
  { label: 'Codice della Strada', value: 'codice della strada', group: 'Codici Settoriali' },
  { label: 'Codice della Navigazione', value: 'codice della navigazione', group: 'Codici Settoriali' },
  { label: 'Codice del Consumo', value: 'codice del consumo', group: 'Codici Settoriali' },
  { label: 'Codice della Privacy', value: 'codice in materia di protezione dei dati personali', group: 'Codici Settoriali' },
  { label: 'Codice Ambiente', value: 'norme in materia ambientale', group: 'Codici Settoriali' },
  { label: 'Codice Contratti Pubblici', value: 'codice dei contratti pubblici', group: 'Codici Settoriali' },
  { label: 'Codice Beni Culturali', value: 'codice dei beni culturali e del paesaggio', group: 'Codici Settoriali' },
  { label: 'Codice Assicurazioni', value: 'codice delle assicurazioni private', group: 'Codici Settoriali' },
  { label: 'Codice Processo Tributario', value: 'codice del processo tributario', group: 'Codici Settoriali' },
  { label: 'Codice Processo Amm.vo', value: 'codice del processo amministrativo', group: 'Codici Settoriali' },
  { label: 'Codice Amm. Digitale', value: 'codice dell\'amministrazione digitale', group: 'Codici Settoriali' },
  { label: 'Codice Proprietà Industriale', value: 'codice della proprietà industriale', group: 'Codici Settoriali' },
  { label: 'Codice Comunicazioni', value: 'codice delle comunicazioni elettroniche', group: 'Codici Settoriali' },
  { label: 'Codice Pari Opportunità', value: 'codice delle pari opportunità', group: 'Codici Settoriali' },
  { label: 'Codice Ord. Militare', value: 'codice dell\'ordinamento militare', group: 'Codici Settoriali' },
  { label: 'Codice del Turismo', value: 'codice del turismo', group: 'Codici Settoriali' },
  { label: 'Codice Antimafia', value: 'codice antimafia', group: 'Codici Settoriali' },
  { label: 'Codice Giustizia Contabile', value: 'codice di giustizia contabile', group: 'Codici Settoriali' },
  { label: 'Codice Terzo Settore', value: 'codice del Terzo settore', group: 'Codici Settoriali' },
  { label: 'Codice Protezione Civile', value: 'codice della protezione civile', group: 'Codici Settoriali' },
  { label: 'Codice Crisi Impresa', value: 'codice della crisi d\'impresa e dell\'insolvenza', group: 'Codici Settoriali' },
  { label: 'Codice Nautica Diporto', value: 'codice della nautica da diporto', group: 'Codici Settoriali' },

  // Unione Europea
  { label: 'TUE', value: 'TUE', group: 'Unione Europea' },
  { label: 'TFUE', value: 'TFUE', group: 'Unione Europea' },
  { label: 'CDFUE', value: 'CDFUE', group: 'Unione Europea' },
  { label: 'Regolamento UE', value: 'Regolamento UE', group: 'Unione Europea' },
  { label: 'Direttiva UE', value: 'Direttiva UE', group: 'Unione Europea' },
];

const ACT_TYPES_REQUIRING_DETAILS = [
  'legge', 'decreto legge', 'decreto legislativo',
  'decreto del presidente della repubblica', 'regio decreto',
  'Regolamento UE', 'Direttiva UE'
];

export function SearchForm({ onSearch, isLoading }: SearchFormProps) {
  // Get alias data and functions from store
  const { customAliases, trackAliasUsage } = useAppStore();

  // Memoized sorted aliases for dropdown (by usage, then alphabetically)
  const sortedAliases = useMemo(() => {
    return [...customAliases].sort((a, b) =>
      b.usageCount - a.usageCount || a.trigger.localeCompare(b.trigger)
    );
  }, [customAliases]);

  const [formData, setFormData] = useState<SearchParams>({
    act_type: '',
    act_number: '',
    date: '',
    article: '1',
    version: 'vigente',
    version_date: '',
    show_brocardi_info: false,
    annex: ''
  });

  // State for Advanced Options collapsible
  const [showAdvanced, setShowAdvanced] = useState(false);

  // State for real article navigation
  const [articleList, setArticleList] = useState<string[]>([]);
  const [isLoadingArticles, setIsLoadingArticles] = useState(false);
  const [lastFetchedNorma, setLastFetchedNorma] = useState<string>('');

  // Generate a key for the current norma to detect changes
  const getNormaKey = useCallback(() => {
    return `${formData.act_type}|${formData.act_number}|${formData.date}`;
  }, [formData.act_type, formData.act_number, formData.date]);

  // Fetch article tree when norma details change
  useEffect(() => {
    const fetchArticleTree = async () => {
      const normaKey = getNormaKey();

      if (!formData.act_type) {
        return;
      }

      if (normaKey === lastFetchedNorma) {
        return;
      }

      // For acts requiring details, wait until we have at least number or date
      const needsDetails = ACT_TYPES_REQUIRING_DETAILS.includes(formData.act_type);

      if (needsDetails && !formData.act_number && !formData.date) {
        setArticleList([]);
        return;
      }

      setIsLoadingArticles(true);

      try {
        // First get the URN
        const requestBody = {
          act_type: formData.act_type,
          act_number: formData.act_number || undefined,
          date: formData.date ? parseItalianDate(formData.date) : undefined,
          article: '1'
        };

        const normaRes = await fetch('/fetch_norma_data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!normaRes.ok) {
          throw new Error('Errore fetch norma');
        }

        const normaData = await normaRes.json();
        const urnToUse = normaData.norma_data?.[0]?.urn || normaData.norma_data?.[0]?.url;

        if (!urnToUse) {
          setArticleList([]);
          return;
        }

        // Then fetch the tree
        const treeRes = await fetch('/fetch_tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urn: urnToUse, link: false, details: false })
        });

        if (!treeRes.ok) {
          throw new Error('Errore fetch tree');
        }

        const treeResponse = await treeRes.json();
        const treeData = treeResponse.articles || treeResponse;
        const articles = extractArticleIdsFromTree(treeData);

        setArticleList(articles);
        setLastFetchedNorma(normaKey);
      } catch (e) {
        console.error('Error fetching article tree:', e);
        setArticleList([]);
      } finally {
        setIsLoadingArticles(false);
      }
    };

    // Debounce the fetch
    const timeout = setTimeout(fetchArticleTree, 500);
    return () => clearTimeout(timeout);
  }, [formData.act_type, formData.act_number, formData.date, getNormaKey, lastFetchedNorma]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    // Check if this is an alias selection (special prefix)
    if (name === 'act_type' && value.startsWith('__ALIAS__:')) {
      const aliasId = value.replace('__ALIAS__:', '');
      const alias = customAliases.find(a => a.id === aliasId);

      if (alias) {
        // Increment usage count
        trackAliasUsage(alias.id);

        if (alias.searchParams) {
          // Reference alias: fill all params
          setFormData(prev => ({
            ...prev,
            act_type: alias.searchParams!.act_type || '',
            act_number: alias.searchParams!.act_number || '',
            date: alias.searchParams!.date || '',
            article: alias.searchParams!.article || prev.article
          }));
          // Reset article list since norma changed
          setArticleList([]);
          setLastFetchedNorma('');
        }
      }
      return;
    }

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleIncrementArticle = () => {
    if (articleList.length > 0) {
      const currentIndex = articleList.findIndex(a => a === formData.article);
      if (currentIndex === -1) {
        setFormData(prev => ({ ...prev, article: articleList[0] }));
      } else if (currentIndex < articleList.length - 1) {
        setFormData(prev => ({ ...prev, article: articleList[currentIndex + 1] }));
      }
    } else {
      const newArticle = (parseInt(formData.article) + 1).toString();
      setFormData(prev => ({ ...prev, article: newArticle }));
    }
  };

  const handleDecrementArticle = () => {
    if (articleList.length > 0) {
      const currentIndex = articleList.findIndex(a => a === formData.article);
      if (currentIndex === -1) {
        setFormData(prev => ({ ...prev, article: articleList[0] }));
      } else if (currentIndex > 0) {
        setFormData(prev => ({ ...prev, article: articleList[currentIndex - 1] }));
      }
    } else {
      setFormData(prev => {
        const val = parseInt(prev.article);
        const newArticle = val > 1 ? (val - 1).toString() : '1';
        return { ...prev, article: newArticle };
      });
    }
  };

  const isDetailsRequired = ACT_TYPES_REQUIRING_DETAILS.includes(formData.act_type);

  // Calculate position in article list for display
  const articlePosition = articleList.length > 0
    ? articleList.findIndex(a => a === formData.article) + 1
    : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({
      ...formData,
      date: formData.date ? parseItalianDate(formData.date) : '',
      version_date: formData.version_date ? parseItalianDate(formData.version_date) : ''
    });
  };

  const handleReset = () => {
    setFormData({
      act_type: '',
      act_number: '',
      date: '',
      article: '1',
      version: 'vigente',
      version_date: '',
      show_brocardi_info: false,
      annex: ''
    });
    setArticleList([]);
    setLastFetchedNorma('');
    setShowAdvanced(false);
  };

  // Group options
  const groupedOptions = ACT_TYPES.reduce((acc, option) => {
    const group = option.group || 'Altro';
    if (!acc[group]) acc[group] = [];
    acc[group].push(option);
    return acc;
  }, {} as Record<string, typeof ACT_TYPES>);

  return (
    <div id="tour-search-form" className="bg-white dark:bg-slate-900 shadow-xl rounded-2xl border border-slate-200 dark:border-slate-800 sticky top-6 overflow-hidden">
      {/* Header Container with premium gradient/glass look */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
        <h5 className="font-bold text-slate-900 dark:text-white flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
            <Search size={20} />
          </div>
          <span className="text-lg tracking-tight">Parametri di Estrazione</span>
        </h5>
      </div>

      <div className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Act Type Selection */}
          <div id="tour-act-type" className="space-y-2">
            <label htmlFor="search-act-type" className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Fonte Normativa</label>
            <select
              id="search-act-type"
              name="act_type"
              value={formData.act_type}
              onChange={handleChange}
              className={cn(
                "w-full text-sm rounded-xl px-4 py-3 appearance-none cursor-pointer border shadow-sm transition-all",
                "bg-white dark:bg-slate-800 text-slate-900 dark:text-white",
                "border-slate-200 dark:border-slate-700",
                FOCUS_RING, "focus:border-primary-500"
              )}
              required
            >
              <option value="">Seleziona Atto...</option>

              {/* Custom Aliases */}
              {sortedAliases.length > 0 && (
                <optgroup label="📌 Alias Personalizzati" className="font-bold text-indigo-500 bg-white dark:bg-slate-900">
                  {sortedAliases.map(alias => (
                    <option
                      value={`__ALIAS__:${alias.id}`}
                      key={`alias-${alias.id}`}
                      className="text-indigo-600 dark:text-indigo-400 font-medium"
                    >
                      {alias.trigger} → {alias.expandTo}
                    </option>
                  ))}
                </optgroup>
              )}

              {Object.entries(groupedOptions).map(([group, options]) => (
                <optgroup label={group} key={group} className="font-bold text-slate-400 bg-white dark:bg-slate-900">
                  {options.map(opt => (
                    <option value={opt.value} key={opt.value} className="text-slate-900 dark:text-white font-medium">{opt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Act Number & Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="act_number" className="block text-xs font-bold text-slate-400 uppercase tracking-widest text-center sm:text-left">Numero Atto</label>
              <input
                type="text"
                id="act_number"
                name="act_number"
                value={formData.act_number}
                onChange={handleChange}
                disabled={!isDetailsRequired}
                placeholder="n."
                className={cn(
                  "w-full text-sm rounded-xl px-4 py-3 border shadow-sm transition-all",
                  "bg-white dark:bg-slate-800 text-slate-900 dark:text-white",
                  "border-slate-200 dark:border-slate-700 disabled:opacity-30 disabled:bg-slate-50 dark:disabled:bg-slate-900",
                  FOCUS_RING, "focus:border-primary-500 placeholder:text-slate-400"
                )}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="date" className="block text-xs font-bold text-slate-400 uppercase tracking-widest text-center sm:text-left">Anno/Data</label>
              <input
                type="text"
                id="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                disabled={!isDetailsRequired}
                placeholder="aaaa"
                className={cn(
                  "w-full text-sm rounded-xl px-4 py-3 border shadow-sm transition-all",
                  "bg-white dark:bg-slate-800 text-slate-900 dark:text-white",
                  "border-slate-200 dark:border-slate-700 disabled:opacity-30 disabled:bg-slate-50 dark:disabled:bg-slate-900",
                  FOCUS_RING, "focus:border-primary-500 placeholder:text-slate-400"
                )}
              />
            </div>
          </div>

          {/* Premium Article Navigator */}
          <div id="tour-article-input" className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between px-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Articolo</label>
              {isLoadingArticles ? (
                <div className="flex items-center gap-2 text-[10px] font-bold text-primary-500 uppercase">
                  <Loader2 size={12} className="animate-spin" />
                  Indicizzazione...
                </div>
              ) : articleList.length > 0 ? (
                <div className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                  {articlePosition > 0 ? `${articlePosition} di ${articleList.length}` : `${articleList.length} totali`}
                </div>
              ) : null}
            </div>

            <div className="flex items-center bg-white dark:bg-slate-800 rounded-xl p-1.5 shadow-sm border border-slate-200 dark:border-slate-700">
              <IconButton
                icon={<Minus size={18} />}
                onClick={handleDecrementArticle}
                disabled={articleList.length > 0 && articlePosition <= 1}
                size="lg"
                variant="ghost"
                aria-label="Articolo precedente"
              />

              <input
                type="text"
                id="article"
                name="article"
                value={formData.article}
                onChange={handleChange}
                className="flex-1 bg-transparent text-center font-bold text-2xl tracking-tighter border-none focus:ring-0 text-slate-900 dark:text-white outline-none"
              />

              <IconButton
                icon={<Plus size={18} />}
                onClick={handleIncrementArticle}
                disabled={articleList.length > 0 && articlePosition >= articleList.length}
                size="lg"
                variant="ghost"
                aria-label="Articolo successivo"
              />
            </div>

            {articleList.length > 0 && (
              <div className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-full mt-1 overflow-hidden">
                <motion.div
                  className="h-full bg-primary-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${(articlePosition / articleList.length) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Version Selection Card */}
          <div id="tour-version-select" className="bg-slate-50 dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Linea Temporale</label>
              <div className="p-1 px-2 rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-[10px] font-bold">ALPHA VERSION</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormData(p => ({ ...p, version: 'vigente' }))}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold transition-all border",
                  formData.version === 'vigente'
                    ? "bg-white dark:bg-slate-800 border-primary-500 text-primary-600 dark:text-primary-400 shadow-md ring-4 ring-primary-500/5"
                    : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                Vigente
              </button>
              <button
                type="button"
                onClick={() => setFormData(p => ({ ...p, version: 'originale' }))}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold transition-all border",
                  formData.version === 'originale'
                    ? "bg-white dark:bg-slate-800 border-primary-500 text-primary-600 dark:text-primary-400 shadow-md ring-4 ring-primary-500/5"
                    : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                Originale
              </button>
            </div>

            <input
              type="date"
              name="version_date"
              value={formData.version_date}
              onChange={handleChange}
              disabled={true}
              className="w-full text-xs font-bold rounded-xl border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50 text-slate-400 dark:text-slate-500 shadow-sm p-3 border disabled:cursor-not-allowed opacity-50"
            />
          </div>

          {/* Brocardi Toggle - Modern look */}
          <div id="tour-brocardi-toggle" className="group flex items-center justify-between p-4 bg-white dark:bg-slate-800 border border-purple-100/50 dark:border-purple-900/20 rounded-2xl cursor-pointer hover:border-purple-300 dark:hover:border-purple-800 transition-colors shadow-sm" onClick={() => setFormData(p => ({ ...p, show_brocardi_info: !p.show_brocardi_info }))}>
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                formData.show_brocardi_info
                  ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                  : "bg-slate-100 dark:bg-slate-900 text-slate-400"
              )}>
                <RefreshCw size={18} className={formData.show_brocardi_info ? "animate-spin-slow" : ""} />
              </div>
              <div>
                <span className="block text-sm font-bold text-slate-900 dark:text-white">Brocardi & Ratio</span>
                <span className="text-[10px] font-medium text-slate-400">Analisi dottrinale inclusa</span>
              </div>
            </div>
            <div className={cn(
              "w-12 h-6 rounded-full relative transition-colors p-1",
              formData.show_brocardi_info ? "bg-purple-500" : "bg-slate-200 dark:bg-slate-700"
            )}>
              <motion.div
                className="w-4 h-4 rounded-full bg-white shadow-sm"
                animate={{ x: formData.show_brocardi_info ? 24 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
              />
            </div>
          </div>

          {/* Advanced Options - Collapsible */}
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Opzioni Avanzate</span>
              <motion.div
                animate={{ rotate: showAdvanced ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown size={16} className="text-slate-400" />
              </motion.div>
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 pt-0 space-y-3">
                    <div className="space-y-2">
                      <label htmlFor="annex" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Allegato (opzionale)
                      </label>
                      <input
                        type="text"
                        id="annex"
                        name="annex"
                        value={formData.annex}
                        onChange={handleChange}
                        placeholder="Es: 1, 2, A, B"
                        maxLength={3}
                        className={cn(
                          "w-24 text-sm font-semibold rounded-xl px-4 py-3 border shadow-sm transition-all",
                          "bg-white dark:bg-slate-800 text-slate-900 dark:text-white",
                          "border-slate-200 dark:border-slate-700",
                          FOCUS_RING, "focus:border-primary-500",
                          "placeholder:text-slate-400 placeholder:font-normal"
                        )}
                      />
                      <p className="text-[10px] text-slate-400 font-medium">
                        Specifica il numero o la lettera dell'allegato da consultare
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-4">
            <Button
              type="submit"
              disabled={isLoading}
              loading={isLoading}
              variant="primary"
              size="lg"
              icon={<Search size={18} />}
              className="w-full h-14 font-black uppercase tracking-widest"
            >
              Estrai Contenuto
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                onClick={handleReset}
                variant="outline"
                size="md"
                icon={<RefreshCw size={14} />}
                className="text-xs font-bold uppercase tracking-wider"
              >
                Reset
              </Button>
              <Button
                type="button"
                onClick={handleReset}
                variant="outline"
                size="md"
                icon={<Eraser size={14} />}
                className="text-xs font-bold uppercase tracking-wider"
              >
                Pulisci
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
