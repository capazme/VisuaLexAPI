import { useState, useMemo, useEffect, useRef } from 'react';
import type { ArticleData, SearchParams } from '../../../types';
import { BrocardiDisplay } from './BrocardiDisplay';
import { ExternalLink, Paperclip, Calendar, Bookmark, FolderPlus, Copy, StickyNote, Highlighter, Share2, GitCompare, Download, X, Tag, SplitSquareHorizontal } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { DossierModal } from '../../ui/DossierModal';
import { Toast } from '../../ui/Toast';
import { diffWords } from 'diff';
import { SafeHTML } from '../../../utils/sanitize';

interface ArticleTabContentProps {
  data: ArticleData;
  onCompare?: (article: ArticleData) => void;
  onCrossReferenceNavigate?: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

const DICTIONARY_TERMS: Record<string, string> = {
    'ratio legis': 'Motivazione giuridica alla base della norma.',
    'ultra vires': 'Atto compiuto oltre i poteri conferiti.',
    'erga omnes': 'Efficace nei confronti di tutti.',
    'ex tunc': 'Con effetti retroattivi.',
    'ex nunc': 'Con effetti solo per il futuro.',
};

const HIGHLIGHT_STYLES: Record<string, string> = {
    yellow: 'background-color:#FEF3C7;color:#92400E;',
    green: 'background-color:#D1FAE5;color:#065F46;',
    red: 'background-color:#FEE2E2;color:#991B1B;',
    blue: 'background-color:#DBEAFE;color:#1E3A8A;',
};

export function ArticleTabContent({ data, onCompare, onCrossReferenceNavigate }: ArticleTabContentProps) {
  const { article_text, norma_data, brocardi_info, url } = data;
  const {
    addBookmark,
    removeBookmark,
    isBookmarked,
    annotations,
    addAnnotation,
    removeAnnotation,
    bookmarks,
    updateBookmarkTags,
    highlights,
    addHighlight,
    removeHighlight,
    comparisonArticle,
  } = useAppStore();
  
  const [showDossierModal, setShowDossierModal] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [tagsEditorOpen, setTagsEditorOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [highlightColor, setHighlightColor] = useState<'yellow' | 'green' | 'red' | 'blue'>('yellow');
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffHtml, setDiffHtml] = useState('');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const highlightSelectionRef = useRef<{ start: number; end: number; text: string } | null>(null);

  const generateKey = () => {
      const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
      const parts = [norma_data.tipo_atto];
      if (norma_data.numero_atto?.trim()) parts.push(norma_data.numero_atto);
      if (norma_data.data?.trim()) parts.push(norma_data.data);
      if (norma_data.numero_articolo?.trim()) parts.push(norma_data.numero_articolo);
      return parts.map(part => sanitize(part || '')).join('--');
  };

  const itemKey = generateKey();
  const isBookmarkedItem = isBookmarked(itemKey);
  const bookmarkRecord = bookmarks.find(b => b.normaKey === itemKey);
  const currentTags = bookmarkRecord?.tags || [];
  const itemAnnotations = annotations.filter(a => a.normaKey === itemKey && a.articleId === norma_data.numero_articolo);
  const articleHighlights = highlights.filter(h => h.normaKey === itemKey && h.articleId === norma_data.numero_articolo);

  useEffect(() => {
      setTagInput(currentTags.join(', '));
  }, [bookmarkRecord?.id, currentTags.join(',')]);

  useEffect(() => {
      if (!toastMessage) return;
      const timeout = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timeout);
  }, [toastMessage]);

  // Capture text selection for highlighting
  useEffect(() => {
      const handleSelection = () => {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              const selectedText = selection.toString().trim();
              
              if (selectedText && contentRef.current?.contains(range.commonAncestorContainer)) {
                  highlightSelectionRef.current = {
                      start: range.startOffset,
                      end: range.endOffset,
                      text: selectedText
                  };
              }
          }
      };

      document.addEventListener('selectionchange', handleSelection);
      return () => document.removeEventListener('selectionchange', handleSelection);
  }, []);

  // Close highlight picker on outside click
  useEffect(() => {
      if (!showHighlightPicker) return;
      
      const handleClickOutside = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (!target.closest('[data-highlight-picker]') && !target.closest('[data-highlight-button]')) {
              setShowHighlightPicker(false);
          }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHighlightPicker]);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
      setToastMessage({ text, type });
  };

  const handleBookmark = () => {
      if (isBookmarkedItem) {
          removeBookmark(itemKey);
          showToast('Segnalibro rimosso', 'info');
      } else {
          addBookmark(norma_data);
          setTagsEditorOpen(true);
          showToast('Segnalibro aggiunto', 'success');
      }
  };

  const handleTagSave = () => {
      if (!isBookmarkedItem) {
          showToast('Aggiungi prima un segnalibro', 'error');
          return;
      }
      const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
      updateBookmarkTags(itemKey, tags);
      setTagsEditorOpen(false);
      showToast(tags.length > 0 ? `${tags.length} tag salvati` : 'Tag rimossi', 'success');
  };

  const handleCopy = async () => {
      try {
          const selection = window.getSelection()?.toString();
          const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ');
          
          let textToCopy = selection || plainText;
          
          // Add citation
          const citation = `\n\n---\nTratto da: ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${norma_data.data}` : ''}, Art. ${norma_data.numero_articolo}`;
          textToCopy += citation;
          
          // Add notes if any
          if (itemAnnotations.length > 0) {
              textToCopy += `\n\nNote personali:\n${itemAnnotations.map((n, i) => `${i + 1}. ${n.text}`).join('\n')}`;
          }
          
          await navigator.clipboard.writeText(textToCopy);
          showToast(selection ? 'Testo selezionato copiato con citazione' : 'Articolo copiato con citazione e note', 'success');
      } catch (err) {
          showToast('Errore durante la copia', 'error');
      }
  };

  const handleAddNote = () => {
      if (!noteText.trim()) {
          showToast('Inserisci una nota', 'error');
          return;
      }
      addAnnotation(itemKey, norma_data.numero_articolo, noteText);
      setNoteText('');
      showToast('Nota aggiunta', 'success');
  };

  const handleShareLink = async () => {
      try {
          const params: SearchParams = {
              act_type: norma_data.tipo_atto,
              act_number: norma_data.numero_atto || '',
              date: norma_data.data || '',
              article: norma_data.numero_articolo,
              version: (norma_data.versione as 'vigente' | 'originale') || 'vigente',
              version_date: norma_data.data_versione || '',
              show_brocardi_info: true
          };
          const encoded = btoa(JSON.stringify(params));
          const shareUrl = `${window.location.origin}${window.location.pathname}?share=${encoded}`;
          await navigator.clipboard.writeText(shareUrl);
          showToast('Link copiato negli appunti', 'success');
      } catch (err) {
          showToast('Errore durante la copia del link', 'error');
      }
  };

  const handleExportRtf = () => {
      try {
          const escapeRtf = (text: string) => text.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
          const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, '\\par ');
          
          const header = `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}{\\f1 Times New Roman;}}`;
          
          // Title
          const title = `\\f0\\fs28\\b ${escapeRtf(norma_data.tipo_atto)}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}\\b0\\par\\par`;
          
          // Article text
          const body = `\\f1\\fs22 ${escapeRtf(plainText)}\\par\\par`;
          
          // Citation
          const citation = `\\f0\\fs18\\i Tratto da: ${escapeRtf(norma_data.tipo_atto)}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${escapeRtf(norma_data.data)}` : ''}, Art. ${escapeRtf(norma_data.numero_articolo)}\\i0\\par\\par`;
          
          // Notes section
          let notesSection = '';
          if (itemAnnotations.length > 0) {
              notesSection = `\\f0\\fs20\\b Note Personali:\\b0\\par\\par`;
              itemAnnotations.forEach((note, idx) => {
                  notesSection += `\\f1\\fs18 ${idx + 1}. ${escapeRtf(note.text)}\\par`;
              });
              notesSection += '\\par';
          }
          
          // Highlights section
          let highlightsSection = '';
          if (articleHighlights.length > 0) {
              highlightsSection = `\\f0\\fs20\\b Evidenziazioni:\\b0\\par\\par`;
              articleHighlights.forEach((h, idx) => {
                  highlightsSection += `\\f1\\fs18 ${idx + 1}. ${escapeRtf(h.text)}\\par`;
              });
              highlightsSection += '\\par';
          }
          
          const rtf = `${header}${title}${body}${citation}${notesSection}${highlightsSection}}`;
          const blob = new Blob([rtf], { type: 'application/rtf' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          const fileName = `VisuaLex_${norma_data.tipo_atto.replace(/\s+/g, '_')}_Art${norma_data.numero_articolo}.rtf`;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
          showToast('File RTF scaricato con successo', 'success');
      } catch (err) {
          console.error('RTF Export Error:', err);
          showToast('Errore durante l\'esportazione RTF', 'error');
      }
  };

  const handleHighlightAdd = (color?: 'yellow' | 'green' | 'red' | 'blue') => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      
      if (!selectedText) {
          // Try to use saved selection
          if (highlightSelectionRef.current) {
              const saved = highlightSelectionRef.current;
              // Check if already highlighted
              const alreadyHighlighted = articleHighlights.some(h => 
                  h.text.toLowerCase() === saved.text.toLowerCase()
              );
              if (alreadyHighlighted) {
                  showToast('Questo testo è già evidenziato', 'info');
                  highlightSelectionRef.current = null;
                  setShowHighlightPicker(false);
                  return;
              }
              addHighlight(itemKey, norma_data.numero_articolo, saved.text, '', color || highlightColor);
              showToast('Testo evidenziato', 'success');
              highlightSelectionRef.current = null;
          } else {
              showToast('Seleziona del testo da evidenziare', 'error');
          }
          setShowHighlightPicker(false);
          return;
      }

      // Check if already highlighted
      const alreadyHighlighted = articleHighlights.some(h => 
          h.text.toLowerCase() === selectedText.toLowerCase()
      );
      if (alreadyHighlighted) {
          showToast('Questo testo è già evidenziato', 'info');
          setShowHighlightPicker(false);
          selection?.removeAllRanges();
          return;
      }

      const finalColor = color || highlightColor;
      addHighlight(itemKey, norma_data.numero_articolo, selectedText, '', finalColor);
      showToast(`Testo evidenziato in ${finalColor}`, 'success');
      setShowHighlightPicker(false);
      highlightSelectionRef.current = null;
      
      // Clear selection
      selection?.removeAllRanges();
  };

  const handleCompare = () => {
      if (onCompare) {
          onCompare(data);
          showToast('Articolo inviato alla vista comparata', 'success');
      }
  };

  const handleDiff = () => {
      if (!comparisonArticle) {
          showToast('Nessun articolo nella vista comparata', 'error');
          return;
      }
      if (comparisonArticle.norma_data.numero_articolo === norma_data.numero_articolo) {
          showToast('Seleziona un articolo diverso per il confronto', 'error');
          return;
      }
      try {
          const diff = diffWords(comparisonArticle.article_text || '', article_text || '');
          const html = diff.map(part => {
              const color = part.added ? '#16a34a' : part.removed ? '#dc2626' : '#374151';
              const background = part.added ? '#dcfce7' : part.removed ? '#fee2e2' : 'transparent';
              return `<span style="color:${color};background:${background}">${part.value}</span>`;
          }).join('');
          setDiffHtml(html);
          setDiffModalOpen(true);
      } catch (err) {
          showToast('Errore durante il confronto', 'error');
      }
  };

  const formattedText = article_text?.replace(/\n/g, '<br />') || '';

  const processedContent = useMemo(() => {
      let html = formattedText;
      
      // First, apply highlights (before other processing to avoid conflicts)
      // Sort highlights by length (longest first) to avoid partial matches
      const sortedHighlights = [...articleHighlights].sort((a, b) => b.text.length - a.text.length);
      sortedHighlights.forEach(h => {
          const escaped = h.text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
          // Only replace if not already inside a mark tag
          const regex = new RegExp(`(?<!<mark[^>]*>)${escaped}(?!</mark>)`, 'gi');
          html = html.replace(regex, (match) => {
              return `<mark style="${HIGHLIGHT_STYLES[h.color]}" data-highlight="${h.id}" class="highlight-mark">${match}</mark>`;
          });
      });
      
      // Then apply dictionary terms (avoiding already highlighted text)
      Object.entries(DICTIONARY_TERMS).forEach(([term, definition]) => {
          const regex = new RegExp(`(?<!<mark[^>]*>)\\b${term}\\b(?!</mark>)`, 'gi');
          html = html.replace(regex, (match) => `<span class="dictionary-term" data-definition="${definition}">${match}</span>`);
      });
      
      // Finally, apply cross-references
      html = html.replace(/art\.?\s+(\d+)/gi, (_match, p1) => {
          return `<button type="button" class="cross-reference" data-article="${p1}">art. ${p1}</button>`;
      });
      
      return html;
  }, [formattedText, articleHighlights]);

  useEffect(() => {
      if (!onCrossReferenceNavigate) return;
      const container = contentRef.current;
      if (!container) return;
      const handler = (event: Event) => {
          const target = event.target as HTMLElement;
          if (target.classList.contains('cross-reference')) {
              const articleNumber = target.getAttribute('data-article');
              if (articleNumber) {
                  onCrossReferenceNavigate(articleNumber, norma_data);
              }
          }
      };
      container.addEventListener('click', handler);
      return () => container.removeEventListener('click', handler);
  }, [onCrossReferenceNavigate, norma_data]);

  return (
    <div className="animate-in fade-in duration-300 relative">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-dashed border-gray-200 dark:border-gray-700">
        <div className="flex gap-3 text-xs text-gray-500 dark:text-gray-400 items-center">
           <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 font-medium">
             {norma_data.versione || 'Vigente'}
           </span>
           <span className="flex items-center gap-1">
             <Calendar size={12} /> {norma_data.data_versione || 'N/A'}
           </span>
           {norma_data.allegato && (
             <span className="flex items-center gap-1">
               <Paperclip size={12} /> {norma_data.allegato}
             </span>
           )}
        </div>
        <div className="flex flex-wrap gap-1">
            <button 
                onClick={handleBookmark}
                className={cn("p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors", isBookmarkedItem ? "text-yellow-500 fill-yellow-500" : "text-gray-400")}
                title="Segnalibro"
            >
                <Bookmark size={16} className={isBookmarkedItem ? "fill-current" : ""} />
            </button>
            <button 
                onClick={() => {
                    if (!isBookmarkedItem) {
                        showToast('Aggiungi prima un segnalibro per usare i tag', 'error');
                        return;
                    }
                    setTagsEditorOpen(prev => !prev);
                }}
                disabled={!isBookmarkedItem}
                className={cn(
                    "p-1.5 rounded transition-colors",
                    !isBookmarkedItem 
                        ? "text-gray-300 dark:text-gray-600 cursor-not-allowed" 
                        : tagsEditorOpen 
                            ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" 
                            : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                )}
                title={!isBookmarkedItem ? "Aggiungi un segnalibro per usare i tag" : "Gestisci Tag"}
            >
                <Tag size={16} />
            </button>
            <button 
                onClick={() => setShowDossierModal(true)}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500 transition-colors"
                title="Aggiungi a Dossier"
            >
                <FolderPlus size={16} />
            </button>
            <button 
                onClick={handleCopy}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-green-500 transition-colors"
                title="Copia con Citazione"
            >
                <Copy size={16} />
            </button>
             <button 
                onClick={() => setShowNotes(!showNotes)}
                className={cn("p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors", showNotes || itemAnnotations.length > 0 ? "text-blue-500" : "text-gray-400")}
                title="Note Personali"
            >
                <StickyNote size={16} />
            </button>
            <button
                onClick={handleShareLink}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-indigo-500 transition-colors"
                title="Condividi"
            >
                <Share2 size={16} />
            </button>
            <button
                onClick={handleExportRtf}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-emerald-500 transition-colors"
                title="Esporta RTF"
            >
                <Download size={16} />
            </button>
            <div className="relative" data-highlight-picker>
                <button
                    data-highlight-button
                    onClick={() => {
                        const selection = window.getSelection()?.toString().trim();
                        if (!selection && !highlightSelectionRef.current) {
                            showToast('Seleziona del testo da evidenziare', 'error');
                            return;
                        }
                        setShowHighlightPicker(!showHighlightPicker);
                    }}
                    className={cn(
                        "p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
                        articleHighlights.length > 0 ? "text-purple-500" : "text-gray-400 hover:text-purple-500"
                    )}
                    title="Evidenzia Testo Selezionato"
                >
                    <Highlighter size={16} />
                </button>
                {showHighlightPicker && (
                    <div className="absolute left-1/2 -translate-x-1/2 mt-2 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 flex gap-2 z-50 animate-in fade-in zoom-in-95 duration-200">
                        {(['yellow', 'green', 'red', 'blue'] as const).map(color => (
                            <button
                                key={color}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleHighlightAdd(color);
                                }}
                                className={cn(
                                    "w-8 h-8 rounded-full border-2 transition-all hover:scale-110",
                                    color === 'yellow' && 'bg-yellow-200 border-yellow-400',
                                    color === 'green' && 'bg-green-200 border-green-400',
                                    color === 'red' && 'bg-red-200 border-red-400',
                                    color === 'blue' && 'bg-blue-200 border-blue-400',
                                    highlightColor === color && 'ring-2 ring-offset-1 ring-purple-500'
                                )}
                                title={`Evidenzia in ${color}`}
                            />
                        ))}
                    </div>
                )}
            </div>
            {onCompare && (
                <button
                    onClick={handleCompare}
                    className={cn(
                        "p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
                        comparisonArticle?.norma_data.numero_articolo === norma_data.numero_articolo 
                            ? "text-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                            : "text-gray-400 hover:text-purple-500"
                    )}
                    title="Invia a Vista Comparata"
                >
                    <SplitSquareHorizontal size={16} />
                </button>
            )}
            {comparisonArticle && comparisonArticle.norma_data.numero_articolo !== norma_data.numero_articolo && (
                <button
                    onClick={handleDiff}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-rose-500 transition-colors"
                    title="Confronta Differenze"
                >
                    <GitCompare size={16} />
                </button>
            )}
        </div>
      </div>

      {tagsEditorOpen && (
        <div className="mb-4 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-500 uppercase">Tag Segnalibro</label>
            <input 
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Es. #procedura, #esame"
                className="rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-900 px-3 py-2 text-sm"
            />
            <div className="flex gap-2 justify-end">
                <button onClick={() => setTagsEditorOpen(false)} className="text-sm px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">Annulla</button>
                <button onClick={handleTagSave} className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Salva</button>
            </div>
        </div>
      )}

      {(showNotes || itemAnnotations.length > 0) && (
          <div className="mb-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 rounded-lg p-4">
              <h6 className="text-xs font-bold text-yellow-700 dark:text-yellow-500 uppercase mb-2 flex items-center gap-2">
                  <StickyNote size={14} /> Note Personali
              </h6>
              
              <div className="space-y-3 mb-3">
                  {itemAnnotations.map(note => (
                      <div key={note.id} className="bg-white dark:bg-gray-800 p-3 rounded shadow-sm text-sm relative group">
                          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{note.text}</p>
                          <div className="text-xs text-gray-400 mt-1">{new Date(note.createdAt).toLocaleString()}</div>
                          <button 
                            onClick={() => removeAnnotation(note.id)}
                            className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                              <X size={14} />
                          </button>
                      </div>
                  ))}
              </div>

              {showNotes && (
                  <div className="flex gap-2">
                      <textarea 
                        value={noteText} 
                        onChange={e => setNoteText(e.target.value)}
                        placeholder="Scrivi una nota..." 
                        className="flex-1 text-sm rounded-md border-yellow-300 dark:border-yellow-800 bg-white dark:bg-gray-900 p-2 focus:ring-yellow-500 focus:border-yellow-500 min-h-[60px]"
                      />
                      <button 
                        onClick={handleAddNote}
                        className="self-end bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-2 rounded-md text-sm font-medium"
                      >
                          Salva
                      </button>
                  </div>
              )}
          </div>
      )}


      <div className="prose prose-sm dark:prose-invert max-w-none mb-6 bg-white dark:bg-gray-900 p-4 rounded-md border border-gray-100 dark:border-gray-800 min-h-[100px]" ref={contentRef} id={`article-content-${itemKey}`}>
        {processedContent ? (
            <SafeHTML html={processedContent} />
        ) : (
            <div className="text-gray-400 italic text-center py-4">Caricamento testo...</div>
        )}
      </div>

      {articleHighlights.length > 0 && (
        <div className="mb-6 bg-gray-50 dark:bg-gray-800/70 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-sm">
            <h6 className="font-semibold text-gray-600 dark:text-gray-300 mb-2">Evidenziazioni</h6>
            <div className="space-y-2 max-h-40 overflow-y-auto">
                {articleHighlights.map(h => (
                    <div key={h.id} className="flex justify-between items-start gap-2 bg-white dark:bg-gray-900 p-2 rounded border border-gray-100 dark:border-gray-700">
                        <span style={{ ...parseInlineStyle(HIGHLIGHT_STYLES[h.color]) }} className="rounded px-2 py-1 flex-1">{h.text}</span>
                        <button onClick={() => removeHighlight(h.id)} className="text-gray-400 hover:text-red-500 p-1">
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
      )}

      {brocardi_info && (
        <BrocardiDisplay info={brocardi_info} />
      )}

      {url && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <a 
            href={url} 
            target="_blank" 
            rel="noreferrer" 
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            <ExternalLink size={14} />
            Visualizza su Normattiva
          </a>
        </div>
      )}

      {toastMessage && (
        <Toast
          message={toastMessage.text}
          type={toastMessage.type}
          isVisible={!!toastMessage}
          onClose={() => setToastMessage(null)}
        />
      )}

      <DossierModal 
        isOpen={showDossierModal} 
        onClose={() => setShowDossierModal(false)} 
        itemToAdd={norma_data}
        itemType="norma"
      />

      {diffModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setDiffModalOpen(false)} />
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden border border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800">
                    <h4 className="font-semibold text-gray-800 dark:text-gray-100">Diff Vista Comparata</h4>
                    <button onClick={() => setDiffModalOpen(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                        <X size={16} />
                    </button>
                </div>
                <SafeHTML
                  html={diffHtml}
                  className="p-4 overflow-y-auto prose prose-sm dark:prose-invert"
                />
            </div>
        </div>
      )}
    </div>
  );
}

function parseInlineStyle(style: string) {
    const entries = style.split(';').filter(Boolean).map(rule => {
        const [prop, value] = rule.split(':');
        return [prop.trim(), value.trim()];
    });
    return Object.fromEntries(entries);
}
