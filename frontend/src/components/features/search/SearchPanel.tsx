import { useState, useEffect, useCallback } from 'react';
import { FloatingSearchPanel } from './FloatingSearchPanel';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { CommandPalette } from './CommandPalette';
import { PDFViewer } from '../../ui/PDFViewer';
import { WorkspaceNavigator } from '../workspace/WorkspaceNavigator';
import type { SearchParams, ArticleData, Norma } from '../../../types';
import { SearchX, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';

// Helper to generate keys (replicates original JS logic)
const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
const generateNormaKey = (norma: Norma) => {
    if (!norma) return '';
    const parts = [norma.tipo_atto];
    if (norma.numero_atto?.trim()) parts.push(norma.numero_atto);
    if (norma.data?.trim()) parts.push(norma.data);
    return parts.map(part => sanitize(part || '')).join('--');
};

export function SearchPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { addWorkspaceTab, addNormaToTab, workspaceTabs, searchTrigger, clearSearchTrigger } = useAppStore();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [resultsBuffer, setResultsBuffer] = useState<Record<string, { norma: Norma, articles: ArticleData[], versionDate?: string }>>({});

  // PDF State
  const [pdfState, setPdfState] = useState<{ isOpen: boolean; url: string | null; isLoading: boolean }>({
    isOpen: false,
    url: null,
    isLoading: false
  });

  const processResult = useCallback((result: ArticleData, versionDate?: string) => {
      if (result.error) {
          console.error("Backend Error for item:", result.error);
          return;
      }

      const normaData = result.norma_data;

      if (!normaData) {
          console.error("Received result without norma_data", result);
          return;
      }

      // Mark as historical if version_date was provided
      if (versionDate) {
          console.log('📅 Processing with versionDate:', versionDate, 'norma data_versione:', normaData.data_versione);
          result.versionInfo = {
              isHistorical: true,
              requestedDate: versionDate,
              effectiveDate: normaData.data_versione || normaData.data
          };
      }

      const norma: Norma = {
          tipo_atto: normaData.tipo_atto,
          data: normaData.data,
          numero_atto: normaData.numero_atto,
          urn: normaData.url
      };

      const key = generateNormaKey(norma);
      if (!key) return;

      // Buffer results temporarily during streaming
      setResultsBuffer(prev => {
          const existing = prev[key];
          const newArticles = existing ? [...existing.articles] : [];

          const isNewArticle = !newArticles.find(a => a.norma_data.numero_articolo === result.norma_data.numero_articolo);

          if (isNewArticle) {
             newArticles.push(result);
             newArticles.sort((a, b) => {
                 const numA = parseInt(a.norma_data.numero_articolo) || 0;
                 const numB = parseInt(b.norma_data.numero_articolo) || 0;
                 return numA - numB;
             });
          } else {
             const idx = newArticles.findIndex(a => a.norma_data.numero_articolo === result.norma_data.numero_articolo);
             newArticles[idx] = result;
          }

          return {
              ...prev,
              [key]: { norma, articles: newArticles, versionDate }
          };
      });
  }, []);

  const processResults = useCallback((items: ArticleData[], versionDate?: string) => {
      items.forEach(item => processResult(item, versionDate));
  }, [processResult]);

  const handleSearch = useCallback(async (params: SearchParams) => {
    console.log('🔍 SearchPanel handleSearch called with:', params);
    setIsLoading(true);
    setError(null);
    setResultsBuffer({}); // Clear buffer before new search

    try {
        const endpoint = params.show_brocardi_info ? '/fetch_all_data' : '/stream_article_text';
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (!response.ok) throw new Error('Errore nella richiesta');

        if (params.show_brocardi_info) {
            const data = await response.json();
            processResults(data, params.version_date);
        } else {
            if (!response.body) return;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const result = JSON.parse(line);
                            processResult(result, params.version_date);
                        } catch (e) {
                            console.error("Error parsing line", line, e);
                        }
                    }
                }
            }
            if (buffer.trim()) {
                 try {
                    const result = JSON.parse(buffer);
                    processResult(result, params.version_date);
                } catch (e) {}
            }
        }

        // Results buffer will be processed by useEffect below

    } catch (err: any) {
        setError(err.message || "Si è verificato un errore.");
    } finally {
        setIsLoading(false);
    }
  }, [processResults, processResult]);

  // Process results buffer and create workspace tabs
  useEffect(() => {
    if (Object.keys(resultsBuffer).length > 0 && !isLoading) {
      console.log('📦 Processing results buffer:', resultsBuffer);
      Object.entries(resultsBuffer).forEach(([key, group]) => {
        // For historical versions, always create a new tab
        const isHistorical = group.articles.some(a => a.versionInfo?.isHistorical);
        console.log('🏷️ Processing group:', key, 'isHistorical:', isHistorical, 'versionDate:', group.versionDate);

        if (isHistorical) {
          // Create new tab with version date in label
          const versionDate = group.versionDate ? ` - Ver. ${group.versionDate}` : ' - Storico';
          const label = `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}${versionDate}`;
          console.log('➕ Creating historical tab with label:', label);
          addWorkspaceTab(label, group.norma, group.articles);
        } else {
          // Check if there's an existing tab with this norma (current version)
          const existingTab = workspaceTabs.find(tab =>
            tab.content.some(item =>
              item.type === 'norma' &&
              item.norma.tipo_atto === group.norma.tipo_atto &&
              item.norma.numero_atto === group.norma.numero_atto &&
              item.norma.data === group.norma.data &&
              !item.articles?.some(a => a.versionInfo?.isHistorical) // Make sure it's not a historical tab
            )
          );

          if (existingTab) {
            // Add articles to existing tab's norma
            addNormaToTab(existingTab.id, group.norma, group.articles);
          } else {
            // Create new tab
            const label = `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}`;
            addWorkspaceTab(label, group.norma, group.articles);
          }
        }
      });

      // Clear buffer after processing
      setResultsBuffer({});
    }
  }, [resultsBuffer, isLoading, addWorkspaceTab, addNormaToTab, workspaceTabs]);

  useEffect(() => {
    const shareValue = searchParams.get('share');
    if (shareValue) {
        try {
            const decoded = JSON.parse(atob(shareValue));
            if (decoded) {
                handleSearch(decoded);
            }
        } catch (e) {
            console.error('Invalid share link', e);
        }
        const next = new URLSearchParams(searchParams);
        next.delete('share');
        setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, handleSearch]);

  // Listen for programmatic search triggers
  useEffect(() => {
    if (searchTrigger) {
      handleSearch(searchTrigger);
      clearSearchTrigger();
    }
  }, [searchTrigger, handleSearch, clearSearchTrigger]);

  const handleCrossReferenceNavigate = useCallback((articleNumber: string, normaData: ArticleData['norma_data']) => {
      const params: SearchParams = {
          act_type: normaData.tipo_atto,
          act_number: normaData.numero_atto || '',
          date: normaData.data || '',
          article: articleNumber,
          version: (normaData.versione as 'vigente' | 'originale') || 'vigente',
          version_date: normaData.data_versione || '',
          show_brocardi_info: true
      };
      handleSearch(params);
  }, [handleSearch]);


  const handleViewPdf = async (urn: string) => {
      setPdfState({ isOpen: true, url: null, isLoading: true });
      try {
          const response = await fetch('/export_pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urn })
          });
          
          if (!response.ok) throw new Error('Errore generazione PDF');
          
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          setPdfState({ isOpen: true, url, isLoading: false });
      } catch (e) {
          console.error(e);
          setPdfState({ isOpen: false, url: null, isLoading: false });
          setError("Impossibile caricare il PDF.");
      }
  };

  const hasTabs = workspaceTabs.length > 0;

  return (
    <>
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onSearch={handleSearch}
      />

      {/* Floating Search Panel */}
      <FloatingSearchPanel onSearch={handleSearch} isLoading={isLoading} />

      {/* Workspace Manager - renders all tabs */}
      <WorkspaceManager
        onViewPdf={handleViewPdf}
        onCrossReference={handleCrossReferenceNavigate}
      />

      {/* Workspace Navigator - dock at bottom showing all tabs */}
      <WorkspaceNavigator />

      {/* Main Content Area - Empty state when no tabs */}
      {!hasTabs && !isLoading && (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 animate-in fade-in duration-700">
          {/* Interactive Search Icon */}
          <div
            className="relative group cursor-pointer"
            onClick={() => setCommandPaletteOpen(true)}
            title="Apri ricerca (Cmd+K)"
          >
            {/* Blur Background */}
            <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl group-hover:bg-blue-500/30 transition-all duration-500" />

            {/* Icon Container */}
            <div className="relative w-32 h-32 bg-white dark:bg-gray-800 rounded-3xl shadow-2xl flex items-center justify-center border border-gray-100 dark:border-gray-700 group-hover:scale-105 transition-transform duration-300">
              <Search size={48} className="text-blue-500 stroke-[1.5]" />
            </div>

            {/* Keyboard Shortcut Badge */}
            <div className="absolute -bottom-3 -right-3 bg-gray-900 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border-2 border-white dark:border-gray-800">
              ⌘K
            </div>
          </div>

          {/* Title and Description */}
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-10 mb-3">
            Ricerca Intelligente
          </h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-sm text-center leading-relaxed">
            Cerca norme, articoli o concetti giuridici. <br/>
            Prova con <span className="text-blue-600 font-medium">"Art 2043 cc"</span> o{' '}
            <span className="text-blue-600 font-medium">"responsabilità oggettiva"</span>.
          </p>
        </div>
      )}

      {/* Loading Skeleton - Shows while search is in progress */}
      {isLoading && !hasTabs && (
        <div className="w-full max-w-4xl mx-auto p-8 space-y-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            {/* Skeleton Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-shimmer w-3/4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-shimmer w-1/2" />
            </div>

            {/* Skeleton Content */}
            <div className="p-6 space-y-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-shimmer w-full" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-shimmer w-5/6" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-shimmer w-4/6" />
            </div>
          </div>

          {/* Additional Skeleton Cards */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            <div className="p-6 space-y-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-shimmer w-full" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-shimmer w-3/4" />
            </div>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-md shadow-lg max-w-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <SearchX className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-auto pl-3"
            >
              <X size={16} className="text-red-400 hover:text-red-600" />
            </button>
          </div>
        </div>
      )}

      {/* PDF Viewer Modal */}
      <PDFViewer
        isOpen={pdfState.isOpen}
        onClose={() => setPdfState(s => ({...s, isOpen: false}))}
        pdfUrl={pdfState.url}
        isLoading={pdfState.isLoading}
      />
    </>
  );
}
