import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Eraser, Plus, Minus, Loader2 } from 'lucide-react';
import type { SearchParams } from '../../../types';
import { parseItalianDate } from '../../../utils/dateUtils';
import { extractArticleIdsFromTree } from '../../../utils/treeUtils';

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
  const [formData, setFormData] = useState<SearchParams>({
    act_type: '',
    act_number: '',
    date: '',
    article: '1',
    version: 'vigente',
    version_date: '',
    show_brocardi_info: false
  });

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

      console.log('🔍 [SearchForm] Checking if should fetch articles...', {
        act_type: formData.act_type,
        act_number: formData.act_number,
        date: formData.date,
        normaKey,
        lastFetchedNorma,
        isSameNorma: normaKey === lastFetchedNorma
      });

      // Don't refetch if same norma or no act_type
      if (!formData.act_type) {
        console.log('❌ [SearchForm] No act_type, skipping fetch');
        return;
      }

      if (normaKey === lastFetchedNorma) {
        console.log('⏭️ [SearchForm] Same norma, skipping fetch');
        return;
      }

      // For acts requiring details, wait until we have at least number or date
      const needsDetails = ACT_TYPES_REQUIRING_DETAILS.includes(formData.act_type);
      console.log('📋 [SearchForm] Needs details?', { needsDetails, act_type: formData.act_type });

      if (needsDetails && !formData.act_number && !formData.date) {
        console.log('⏳ [SearchForm] Needs details but missing number/date, clearing list');
        setArticleList([]);
        return;
      }

      console.log('🚀 [SearchForm] Starting fetch for articles...');
      setIsLoadingArticles(true);

      try {
        // First get the URN
        const requestBody = {
          act_type: formData.act_type,
          act_number: formData.act_number || undefined,
          date: formData.date ? parseItalianDate(formData.date) : undefined,
          article: '1'
        };
        console.log('📤 [SearchForm] Fetching norma data with:', requestBody);

        const normaRes = await fetch('/fetch_norma_data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        console.log('📥 [SearchForm] Norma response status:', normaRes.status);

        if (!normaRes.ok) {
          const errorText = await normaRes.text();
          console.error('❌ [SearchForm] Norma fetch failed:', errorText);
          throw new Error('Errore fetch norma');
        }

        const normaData = await normaRes.json();
        console.log('📥 [SearchForm] Norma data received:', normaData);

        // Extract URN from the response - it's inside norma_data array
        const urnToUse = normaData.norma_data?.[0]?.urn || normaData.norma_data?.[0]?.url;
        console.log('🔗 [SearchForm] Extracted URN:', urnToUse);

        if (!urnToUse) {
          console.log('❌ [SearchForm] No URN in response, clearing list');
          setArticleList([]);
          return;
        }

        // Then fetch the tree
        console.log('🌳 [SearchForm] Fetching tree for URN:', urnToUse);
        const treeRes = await fetch('/fetch_tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urn: urnToUse, link: false, details: false })
        });

        console.log('📥 [SearchForm] Tree response status:', treeRes.status);

        if (!treeRes.ok) {
          const errorText = await treeRes.text();
          console.error('❌ [SearchForm] Tree fetch failed:', errorText);
          throw new Error('Errore fetch tree');
        }

        const treeResponse = await treeRes.json();
        console.log('🌳 [SearchForm] Tree response received:', {
          hasArticles: !!treeResponse.articles,
          count: treeResponse.count,
          articlesType: typeof treeResponse.articles,
          isArray: Array.isArray(treeResponse.articles),
          sample: Array.isArray(treeResponse.articles) ? treeResponse.articles.slice(0, 5) : treeResponse
        });

        // Extract article IDs from tree - API returns { articles: [...], count: N }
        const treeData = treeResponse.articles || treeResponse;
        const articles = extractArticleIdsFromTree(treeData);
        console.log('📚 [SearchForm] Extracted articles:', {
          count: articles.length,
          first10: articles.slice(0, 10),
          last5: articles.slice(-5)
        });

        setArticleList(articles);
        setLastFetchedNorma(normaKey);

        console.log(`✅ [SearchForm] Successfully loaded ${articles.length} articles for navigation`);
      } catch (e) {
        console.error('💥 [SearchForm] Error fetching article tree:', e);
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

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleIncrementArticle = () => {
    console.log('➕ [SearchForm] Increment clicked', {
      currentArticle: formData.article,
      articleListLength: articleList.length,
      articleListSample: articleList.slice(0, 5)
    });

    if (articleList.length > 0) {
      // Use real article list
      const currentIndex = articleList.findIndex(a => a === formData.article);
      console.log('➕ [SearchForm] Current index in list:', currentIndex);

      if (currentIndex === -1) {
        // Current article not in list, go to first
        console.log('➕ [SearchForm] Article not in list, going to first:', articleList[0]);
        setFormData(prev => ({ ...prev, article: articleList[0] }));
      } else if (currentIndex < articleList.length - 1) {
        // Go to next article
        const nextArticle = articleList[currentIndex + 1];
        console.log('➕ [SearchForm] Going to next article:', nextArticle);
        setFormData(prev => ({ ...prev, article: nextArticle }));
      } else {
        console.log('➕ [SearchForm] Already at end of list');
      }
    } else {
      // Fallback to numeric increment
      const newArticle = (parseInt(formData.article) + 1).toString();
      console.log('➕ [SearchForm] Fallback numeric increment:', newArticle);
      setFormData(prev => ({ ...prev, article: newArticle }));
    }
  };

  const handleDecrementArticle = () => {
    console.log('➖ [SearchForm] Decrement clicked', {
      currentArticle: formData.article,
      articleListLength: articleList.length
    });

    if (articleList.length > 0) {
      // Use real article list
      const currentIndex = articleList.findIndex(a => a === formData.article);
      console.log('➖ [SearchForm] Current index in list:', currentIndex);

      if (currentIndex === -1) {
        // Current article not in list, go to first
        console.log('➖ [SearchForm] Article not in list, going to first:', articleList[0]);
        setFormData(prev => ({ ...prev, article: articleList[0] }));
      } else if (currentIndex > 0) {
        // Go to previous article
        const prevArticle = articleList[currentIndex - 1];
        console.log('➖ [SearchForm] Going to previous article:', prevArticle);
        setFormData(prev => ({ ...prev, article: prevArticle }));
      } else {
        console.log('➖ [SearchForm] Already at start of list');
      }
    } else {
      // Fallback to numeric decrement
      setFormData(prev => {
        const val = parseInt(prev.article);
        const newArticle = val > 1 ? (val - 1).toString() : '1';
        console.log('➖ [SearchForm] Fallback numeric decrement:', newArticle);
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
      show_brocardi_info: false
    });
    setArticleList([]);
    setLastFetchedNorma('');
  };

  // Group options
  const groupedOptions = ACT_TYPES.reduce((acc, option) => {
    if (!acc[option.group]) acc[option.group] = [];
    acc[option.group].push(option);
    return acc;
  }, {} as Record<string, typeof ACT_TYPES>);

  return (
    <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl border border-gray-200 dark:border-gray-700 sticky top-6">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-t-xl">
        <h5 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Search size={18} />
          Parametri
        </h5>
      </div>
      <div className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="search-act-type" className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tipo atto</label>
            <select
              id="search-act-type"
              name="act_type"
              value={formData.act_type}
              onChange={handleChange}
              className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
              required
            >
              <option value="">Seleziona...</option>
              {Object.entries(groupedOptions).map(([group, options]) => (
                <optgroup label={group} key={group}>
                  {options.map(opt => (
                    <option value={opt.value} key={opt.value}>{opt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="act_number" className="block text-xs font-semibold text-gray-500 uppercase mb-1">Numero</label>
              <input
                type="text"
                id="act_number"
                name="act_number"
                value={formData.act_number}
                onChange={handleChange}
                disabled={!isDetailsRequired}
                placeholder="n."
                className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 p-2 border"
              />
            </div>
            <div>
              <label htmlFor="date" className="block text-xs font-semibold text-gray-500 uppercase mb-1">Data</label>
              <input
                type="text"
                id="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                disabled={!isDetailsRequired}
                placeholder="aaaa"
                className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 p-2 border"
              />
            </div>
          </div>

          {/* Modern Article Number Input */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase">Articolo</label>
              {isLoadingArticles && (
                <span className="flex items-center gap-1 text-xs text-blue-500">
                  <Loader2 size={12} className="animate-spin" />
                  Carico...
                </span>
              )}
              {!isLoadingArticles && articleList.length > 0 && (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                  {articlePosition > 0 ? `${articlePosition}/${articleList.length}` : `${articleList.length} articoli`}
                </span>
              )}
            </div>
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
              <button
                type="button"
                onClick={handleDecrementArticle}
                disabled={articleList.length > 0 && articlePosition <= 1}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-gray-700 shadow-sm transition-all text-gray-600 dark:text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed"
                title={articleList.length > 0 ? "Articolo precedente" : "Decrementa articolo"}
              >
                <Minus size={16} />
              </button>
              <input
                type="text"
                id="article"
                name="article"
                value={formData.article}
                onChange={handleChange}
                className="flex-1 bg-transparent text-center font-mono text-xl font-bold border-none focus:ring-0 text-gray-900 dark:text-white outline-none"
              />
              <button
                type="button"
                onClick={handleIncrementArticle}
                disabled={articleList.length > 0 && articlePosition >= articleList.length}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-gray-700 shadow-sm transition-all text-gray-600 dark:text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed"
                title={articleList.length > 0 ? "Articolo successivo" : "Incrementa articolo"}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="bg-gray-100 dark:bg-gray-700/50 p-3 rounded-md">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Versione</label>
            <div className="flex gap-4 mb-2">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="vigente"
                  name="version"
                  value="vigente"
                  checked={formData.version === 'vigente'}
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <label htmlFor="vigente" className="ml-2 text-sm text-gray-700 dark:text-gray-300">Vigente</label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="originale"
                  name="version"
                  value="originale"
                  checked={formData.version === 'originale'}
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <label htmlFor="originale" className="ml-2 text-sm text-gray-700 dark:text-gray-300">Originale</label>
              </div>
            </div>
            <input
              type="date"
              name="version_date"
              value={formData.version_date}
              onChange={handleChange}
              disabled={true}
              className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm p-2 border disabled:opacity-50"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="show_brocardi_info"
              name="show_brocardi_info"
              checked={formData.show_brocardi_info}
              onChange={handleChange}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="show_brocardi_info" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
              Includi Brocardi & Ratio
            </label>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 px-4 rounded-md font-medium shadow-sm transition-colors disabled:opacity-70"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <Search size={18} />
              )}
              Estrai
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={handleReset} className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 py-1.5 px-3 rounded-md text-sm transition-colors">
                <RefreshCw size={14} /> Reset
              </button>
              <button type="button" onClick={handleReset} className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 py-1.5 px-3 rounded-md text-sm transition-colors">
                <Eraser size={14} /> Pulisci
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
