import { useState, useEffect, useCallback } from 'react';
import { SearchForm } from './SearchForm';
import { NormaCard } from './NormaCard';
import { PDFViewer } from '../../ui/PDFViewer';
import type { SearchParams, ArticleData, Norma } from '../../../types';
import { SearchX, Search } from 'lucide-react';
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
  const [results, setResults] = useState<Record<string, { norma: Norma, articles: ArticleData[] }>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { setComparisonArticle } = useAppStore();
  const [latestNormaKey, setLatestNormaKey] = useState<string | null>(null);
  
  // PDF State
  const [pdfState, setPdfState] = useState<{ isOpen: boolean; url: string | null; isLoading: boolean }>({
    isOpen: false,
    url: null,
    isLoading: false
  });

  // Restore previous session
  useEffect(() => {
    try {
        const saved = localStorage.getItem('visualex-session-results');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                setResults(parsed);
            }
        }
    } catch (e) {
        console.error('Unable to restore session results', e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('visualex-session-results', JSON.stringify(results));
  }, [results]);

  // Scroll to latest norma when it's added
  useEffect(() => {
    if (latestNormaKey) {
      const timer = setTimeout(() => {
        const element = document.getElementById(`norma-${latestNormaKey}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Clear the highlight after a few seconds
        setTimeout(() => setLatestNormaKey(null), 3000);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [latestNormaKey]);

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

      setResults(prev => {
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

          // Mark as latest if it's a new norma or new article
          if (!existing || isNewArticle) {
              setLatestNormaKey(key);
          }

          // Remove the key from prev to avoid being overwritten by spread
          const { [key]: _, ...restPrev } = prev;
          
          return {
              [key]: { norma, articles: newArticles }, 
              ...restPrev
          };
      });
  }, []);

  const processResults = useCallback((items: ArticleData[]) => {
      items.forEach(processResult);
  }, [processResult]);

  const handleSearch = useCallback(async (params: SearchParams) => {
    setIsLoading(true);
    setError(null);
    
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

    } catch (err: any) {
        setError(err.message || "Si è verificato un errore.");
    } finally {
        setIsLoading(false);
    }
  }, [processResults, processResult]);

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

  const handleCloseArticle = (normaKey: string, articleId: string) => {
      setResults(prev => {
          const newResults = { ...prev };
          const normaGroup = newResults[normaKey];
          if (normaGroup) {
              normaGroup.articles = normaGroup.articles.filter(a => a.norma_data.numero_articolo !== articleId);
              if (normaGroup.articles.length === 0) {
                  delete newResults[normaKey];
              }
          }
          return newResults;
      });
  };

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

  const hasResults = Object.keys(results).length > 0;

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* Left: Search Form (Sticky handled in component) */}
      <div className="w-full lg:w-80 xl:w-96 shrink-0">
        <SearchForm onSearch={handleSearch} isLoading={isLoading} />
      </div>

      {/* Right: Results */}
      <div className="flex-1 min-w-0">
        {error && (
             <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-md">
                <div className="flex">
                    <div className="flex-shrink-0">
                         <SearchX className="h-5 w-5 text-red-400" />
                    </div>
                    <div className="ml-3">
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                </div>
            </div>
        )}

        {hasResults ? (
             <div className="space-y-6 pb-10">
                 {Object.entries(results).map(([key, group]) => (
                     <div key={key} id={`norma-${key}`} className={latestNormaKey === key ? "animate-pulse-once" : ""}>
                         <NormaCard 
                            norma={group.norma} 
                            articles={group.articles}
                            onCloseArticle={(articleId) => handleCloseArticle(key, articleId)}
                            onViewPdf={handleViewPdf}
                            onPinArticle={() => {}}
                            onCompareArticle={handleCompareArticle}
                            onCrossReference={handleCrossReferenceNavigate}
                            isNew={latestNormaKey === key}
                         />
                     </div>
                 ))}
             </div>
        ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 mt-20 lg:mt-0">
                <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                    <Search size={40} className="opacity-50" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-300">Inizia la ricerca</h3>
                <p className="text-sm max-w-xs text-center mt-2">Seleziona i parametri nel pannello laterale per visualizzare le norme e i brocardi.</p>
            </div>
        )}
      </div>

      {/* PDF Viewer Modal */}
      <PDFViewer 
        isOpen={pdfState.isOpen} 
        onClose={() => setPdfState(s => ({...s, isOpen: false}))} 
        pdfUrl={pdfState.url} 
        isLoading={pdfState.isLoading} 
      />
    </div>
  );
}
