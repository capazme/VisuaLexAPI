import { useState, useEffect, useCallback } from 'react';
import { FloatingSearchPanel } from './FloatingSearchPanel';
import { FloatingPanelManager } from '../workspace/FloatingPanelManager';
import { CommandPalette } from './CommandPalette';
import { PDFViewer } from '../../ui/PDFViewer';
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
  const { setComparisonArticle, addFloatingPanel, floatingPanels } = useAppStore();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [resultsBuffer, setResultsBuffer] = useState<Record<string, { norma: Norma, articles: ArticleData[] }>>({});

  // PDF State
  const [pdfState, setPdfState] = useState<{ isOpen: boolean; url: string | null; isLoading: boolean }>({
    isOpen: false,
    url: null,
    isLoading: false
  });

  const processResult = useCallback((result: ArticleData) => {
      if (result.error) {
          console.error("Backend Error for item:", result.error);
          return;
      }

      const normaData = result.norma_data;

      if (!normaData) {
          console.error("Received result without norma_data", result);
          return;
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
              [key]: { norma, articles: newArticles }
          };
      });
  }, []);

  const processResults = useCallback((items: ArticleData[]) => {
      items.forEach(processResult);
  }, [processResult]);

  const handleSearch = useCallback(async (params: SearchParams) => {
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
            processResults(data);
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
                            processResult(result);
                        } catch (e) {
                            console.error("Error parsing line", line, e);
                        }
                    }
                }
            }
            if (buffer.trim()) {
                 try {
                    const result = JSON.parse(buffer);
                    processResult(result);
                } catch (e) {}
            }
        }

        // After streaming/loading is complete, create floating panels from buffer
        setResultsBuffer(currentBuffer => {
            Object.entries(currentBuffer).forEach(([key, group]) => {
                addFloatingPanel(group.norma, group.articles, key);
            });
            return {}; // Clear buffer
        });

    } catch (err: any) {
        setError(err.message || "Si è verificato un errore.");
    } finally {
        setIsLoading(false);
    }
  }, [processResults, processResult, addFloatingPanel]);

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

  const handleCompareArticle = useCallback((article: ArticleData) => {
      setComparisonArticle(article);
  }, [setComparisonArticle]);

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

  const hasPanels = floatingPanels.length > 0;

  return (
    <>
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onSearch={handleSearch}
      />

      {/* Floating Search Panel */}
      <FloatingSearchPanel onSearch={handleSearch} isLoading={isLoading} />

      {/* Floating Panels Manager */}
      <FloatingPanelManager
        onViewPdf={handleViewPdf}
        onCompareArticle={handleCompareArticle}
        onCrossReference={handleCrossReferenceNavigate}
      />

      {/* Main Content Area - Empty state when no panels */}
      {!hasPanels && (
        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 mt-20 lg:mt-0">
          <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
            <Search size={40} className="opacity-50" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-300">Inizia la ricerca</h3>
          <p className="text-sm max-w-xs text-center mt-2">Premi Cmd+K per aprire la ricerca e visualizzare le norme.</p>
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
