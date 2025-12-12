import { useState, useMemo, useEffect, useRef } from 'react';
import type { ArticleData, SearchParams } from '../../../types';
import { BrocardiDisplay } from './BrocardiDisplay';
import { ExternalLink, Paperclip, Calendar, Bookmark, FolderPlus, Copy, StickyNote, Highlighter, Share2, Download, X, Tag, MoreHorizontal, Clock } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { DossierModal } from '../../ui/DossierModal';
import { Toast } from '../../ui/Toast';
import { CopyModal, type CopyOptions } from '../../ui/CopyModal';
import { SafeHTML } from '../../../utils/sanitize';

interface ArticleTabContentProps {
  data: ArticleData;
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

export function ArticleTabContent({ data, onCrossReferenceNavigate }: ArticleTabContentProps) {
  const { article_text, norma_data, brocardi_info, url, versionInfo } = data;
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
    triggerSearch,
  } = useAppStore();
  
  const [showDossierModal, setShowDossierModal] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [tagsEditorOpen, setTagsEditorOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [highlightColor, setHighlightColor] = useState<'yellow' | 'green' | 'red' | 'blue'>('yellow');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showVersionInput, setShowVersionInput] = useState(false);
  const [versionDate, setVersionDate] = useState('');
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

  const handleAdvancedCopy = async (options: CopyOptions) => {
      try {
          let textToCopy = '';

          if (options.includeText) {
              const plainText = (article_text || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ');
              textToCopy += plainText;
          }

          if (options.includeCitation) {
              const citation = `\n\n---\nTratto da: ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${norma_data.data}` : ''}, Art. ${norma_data.numero_articolo}`;
              textToCopy += citation;
          }

          if (options.includeNotes && itemAnnotations.length > 0) {
              textToCopy += `\n\nNote personali:\n${itemAnnotations.map((n, i) => `${i + 1}. ${n.text}`).join('\n')}`;
          }

          if (options.includeHighlights && articleHighlights.length > 0) {
              textToCopy += `\n\nEvidenziazioni:\n${articleHighlights.map((h, i) => `${i + 1}. "${h.text}"`).join('\n')}`;
          }

          await navigator.clipboard.writeText(textToCopy);
          showToast('Contenuto copiato negli appunti', 'success');
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
           {versionInfo?.isHistorical ? (
             <>
               <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded text-orange-700 dark:text-orange-400 font-medium flex items-center gap-1">
                 <Clock size={11} />
                 Versione storica
               </span>
               <span className="text-orange-600 dark:text-orange-400 font-medium">
                 Richiesta: {versionInfo.requestedDate}
               </span>
               {versionInfo.effectiveDate && (
                 <span className="flex items-center gap-1">
                   <Calendar size={12} /> Vigente al: {versionInfo.effectiveDate}
                 </span>
               )}
             </>
           ) : (
             <>
               <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 font-medium">
                 {norma_data.versione || 'Vigente'}
               </span>
               <span className="flex items-center gap-1">
                 <Calendar size={12} /> {norma_data.data_versione || 'N/A'}
               </span>
             </>
           )}
           {norma_data.allegato && (
             <span className="flex items-center gap-1">
               <Paperclip size={12} /> {norma_data.allegato}
             </span>
           )}
        </div>
        <div className="flex flex-wrap gap-1">
            {/* Primary buttons */}
            <button
                onClick={handleBookmark}
                className={cn("p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors", isBookmarkedItem ? "text-yellow-500" : "text-gray-400")}
                title="Segnalibro"
            >
                <Bookmark size={16} className={isBookmarkedItem ? "fill-current" : ""} />
            </button>
            <button
                onClick={() => setShowNotes(!showNotes)}
                className={cn("p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors relative", showNotes || itemAnnotations.length > 0 ? "text-blue-500" : "text-gray-400")}
                title="Note Personali"
            >
                <StickyNote size={16} />
                {itemAnnotations.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center">
                        {itemAnnotations.length}
                    </span>
                )}
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
                        "p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors relative",
                        articleHighlights.length > 0 ? "text-purple-500" : "text-gray-400 hover:text-purple-500"
                    )}
                    title="Evidenzia Testo"
                >
                    <Highlighter size={16} />
                    {articleHighlights.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 text-white text-[10px] rounded-full flex items-center justify-center">
                            {articleHighlights.length}
                        </span>
                    )}
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
            <button
                onClick={() => setShowCopyModal(true)}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-green-500 transition-colors"
                title="Copia"
            >
                <Copy size={16} />
            </button>

            {/* More menu */}
            <div className="relative">
                <button
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className={cn(
                        "p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
                        showMoreMenu ? "text-blue-500 bg-gray-100 dark:bg-gray-800" : "text-gray-400"
                    )}
                    title="Altre azioni"
                >
                    <MoreHorizontal size={16} />
                </button>
                {showMoreMenu && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 animate-in fade-in zoom-in-95 duration-200 py-1">
                            <button
                                onClick={() => {
                                    if (!isBookmarkedItem) {
                                        showToast('Aggiungi prima un segnalibro per usare i tag', 'error');
                                        return;
                                    }
                                    setTagsEditorOpen(prev => !prev);
                                    setShowMoreMenu(false);
                                }}
                                disabled={!isBookmarkedItem}
                                className={cn(
                                    "w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors",
                                    !isBookmarkedItem
                                        ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                )}
                            >
                                <Tag size={14} />
                                Gestisci tag
                            </button>
                            <button
                                onClick={() => {
                                    setShowDossierModal(true);
                                    setShowMoreMenu(false);
                                }}
                                className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <FolderPlus size={14} />
                                Aggiungi a dossier
                            </button>
                            <button
                                onClick={() => {
                                    handleShareLink();
                                    setShowMoreMenu(false);
                                }}
                                className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Share2 size={14} />
                                Condividi link
                            </button>
                            <button
                                onClick={() => {
                                    handleExportRtf();
                                    setShowMoreMenu(false);
                                }}
                                className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Download size={14} />
                                Esporta RTF
                            </button>

                            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />

                            <button
                                onClick={() => {
                                    setShowVersionInput(true);
                                    setShowMoreMenu(false);
                                }}
                                className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Clock size={14} />
                                Cerca versione...
                            </button>
                        </div>
                    </>
                )}
            </div>
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

      <CopyModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        onCopy={handleAdvancedCopy}
        hasNotes={itemAnnotations.length > 0}
        hasHighlights={articleHighlights.length > 0}
      />

      {showVersionInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowVersionInput(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-sm mx-4 p-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white">Cerca Versione</h3>
              <button onClick={() => setShowVersionInput(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Inserisci una data per cercare la versione dell'articolo vigente a quella data.
            </p>
            <input
              type="date"
              value={versionDate}
              onChange={(e) => setVersionDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowVersionInput(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Annulla
              </button>
              <button
                onClick={() => {
                  if (versionDate) {
                    // Trigger search with version date
                    const searchParams: SearchParams = {
                      act_type: norma_data.tipo_atto,
                      act_number: norma_data.numero_atto || '',
                      date: norma_data.data || '',
                      article: norma_data.numero_articolo,
                      version: 'vigente',
                      version_date: versionDate,
                      show_brocardi_info: true
                    };
                    console.log('🔎 Triggering version search with params:', searchParams);
                    showToast(`Ricerca versione del ${versionDate}`, 'info');
                    setShowVersionInput(false);
                    setVersionDate('');
                    triggerSearch(searchParams);
                  } else {
                    showToast('Seleziona una data', 'error');
                  }
                }}
                disabled={!versionDate}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg flex items-center gap-2"
              >
                <Clock size={14} />
                Cerca
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function parseInlineStyle(style: string): React.CSSProperties {
    const entries = style.split(';').filter(Boolean).map(rule => {
        const [prop, value] = rule.split(':');
        // Convert CSS property name to camelCase (e.g., background-color -> backgroundColor)
        const camelProp = prop.trim().replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        return [camelProp, value.trim()];
    });
    return Object.fromEntries(entries);
}
