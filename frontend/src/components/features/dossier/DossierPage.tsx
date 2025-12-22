import { useState, useMemo, useEffect } from 'react';
import { Folder, FileText, Trash2, FolderPlus, ChevronRight, ArrowLeft, Download, Search, Tag, Star, Edit2, X, GripVertical, Share2, CheckSquare, Square, FolderInput, Circle, BookOpen, AlertCircle, CheckCircle2, FileJson, TreeDeciduous, Loader2, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { DossierModal } from '../../ui/DossierModal';
import { jsPDF } from 'jspdf';
import { cn } from '../../../lib/utils';
import { parseItalianDate } from '../../../utils/dateUtils';
import type { Dossier, DossierItem } from '../../../types';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTour } from '../../../hooks/useTour';

// Status configuration
type DossierItemStatus = 'unread' | 'reading' | 'important' | 'done';

const STATUS_CONFIG: Record<DossierItemStatus, { label: string; icon: any; color: string; bg: string }> = {
  unread: { label: 'Da leggere', icon: Circle, color: 'text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700' },
  reading: { label: 'In lettura', icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  important: { label: 'Importante', icon: AlertCircle, color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  done: { label: 'Completato', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30' },
};

// Sortable item component
function SortableItem({
  item,
  isSelected,
  onToggleSelect,
  onView,
  onRemove,
  onStatusChange,
  showCheckbox
}: {
  item: DossierItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onRemove: () => void;
  onStatusChange: (status: 'unread' | 'reading' | 'important' | 'done') => void;
  showCheckbox: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const status = item.status || 'unread';
  const StatusIcon = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.icon || Circle;
  const statusConfig = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.unread;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onView}
      className={cn(
        "bg-white dark:bg-gray-800 p-3 md:p-4 rounded-lg border shadow-sm group hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer",
        isSelected ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-200 dark:border-gray-700"
      )}
    >
      <div className="flex items-center gap-2 md:gap-3">
        {showCheckbox && (
          <button onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} className="text-gray-400 hover:text-blue-500 p-2 -m-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:p-0 md:m-0 flex items-center justify-center">
            {isSelected ? <CheckSquare size={20} className="text-blue-500" /> : <Square size={20} />}
          </button>
        )}
        {/* Hide drag handle on mobile - simplified UX */}
        <div {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} className="hidden md:block text-gray-300 dark:text-gray-600 cursor-grab hover:text-gray-500">
          <GripVertical size={20} />
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded text-blue-600 flex-shrink-0">
          <FileText size={18} />
        </div>
        <div className="flex-1 min-w-0">
          {item.type === 'norma' ? (
            <>
              <h4 className="font-medium text-sm md:text-base text-gray-900 dark:text-white truncate">
                {item.data.tipo_atto} {item.data.numero_atto}
              </h4>
              <p className="text-xs md:text-sm text-gray-500 truncate">Art. {item.data.numero_articolo} • {item.data.data}</p>
            </>
          ) : (
            <p className="text-sm md:text-base text-gray-700 dark:text-gray-300 italic truncate">"{item.data}"</p>
          )}
          <div className="text-xs text-gray-400 mt-1 hidden md:block">
            Aggiunto il {new Date(item.addedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Status dropdown */}
          <div className="relative group/status" onClick={(e) => e.stopPropagation()}>
            <button
              className={cn("p-2 md:p-2 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center", statusConfig.color, statusConfig.bg)}
              title={statusConfig.label}
            >
              <StatusIcon size={18} />
            </button>
            <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50 hidden group-hover/status:block">
              {(Object.entries(STATUS_CONFIG) as [DossierItemStatus, typeof STATUS_CONFIG[DossierItemStatus]][]).map(([key, config]) => (
                <button
                  key={key}
                  onClick={(e) => { e.stopPropagation(); onStatusChange(key); }}
                  className={cn(
                    "w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px]",
                    status === key && "bg-gray-100 dark:bg-gray-700"
                  )}
                >
                  <config.icon size={16} className={config.color} />
                  {config.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center"
            title="Rimuovi"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Article viewer modal component
function ArticleViewerModal({
  item,
  isOpen,
  onClose
}: {
  item: DossierItem | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen || !item) return null;

  const isNorma = item.type === 'norma';
  const title = isNorma
    ? `${item.data.tipo_atto} ${item.data.numero_atto || ''} - Art. ${item.data.numero_articolo}`
    : 'Nota';
  const content = isNorma ? item.data.article_text : item.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden border border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {content ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br />') }}
            />
          ) : (
            <p className="text-gray-500 italic text-center py-8">Contenuto non disponibile</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Edit dossier modal
function EditDossierModal({
  dossier,
  isOpen,
  onClose,
  onSave
}: {
  dossier: Dossier | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (title: string, description: string, tags: string[]) => void;
}) {
  const [title, setTitle] = useState(dossier?.title || '');
  const [description, setDescription] = useState(dossier?.description || '');
  const [tagsInput, setTagsInput] = useState((dossier?.tags || []).join(', '));

  if (!isOpen || !dossier) return null;

  const handleSave = () => {
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    onSave(title, description, tags);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-800">
        <div className="p-6">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-4">Modifica Dossier</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Titolo</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrizione</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tag (separati da virgola)</label>
              <input
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="diritto civile, contratti, obbligazioni"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              Annulla
            </button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Salva
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Import Dossier Modal
function ImportDossierModal({
  dossier,
  isOpen,
  onClose,
  onConfirm
}: {
  dossier: Dossier | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen || !dossier) return null;

  const stats = {
    total: dossier.items.length,
    norme: dossier.items.filter(i => i.type === 'norma').length,
    note: dossier.items.filter(i => i.type === 'note').length
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <FolderInput className="text-blue-600" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Importa Dossier</h2>
            <p className="text-sm text-gray-500">Qualcuno ha condiviso un dossier con te</p>
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4">
          <h3 className="font-medium text-gray-900 dark:text-white text-lg mb-2">{dossier.title}</h3>
          {dossier.description && (
            <p className="text-gray-600 dark:text-gray-300 text-sm mb-3">{dossier.description}</p>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
              {stats.total} elementi
            </span>
            {stats.norme > 0 && (
              <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                {stats.norme} articoli
              </span>
            )}
            {stats.note > 0 && (
              <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
                {stats.note} note
              </span>
            )}
          </div>
          {dossier.tags && dossier.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {dossier.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-xs text-gray-600 dark:text-gray-300">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <FolderInput size={18} />
            Importa
          </button>
        </div>
      </div>
    </div>
  );
}

// Tree Navigator Modal for importing articles from a norm
function TreeNavigatorModal({
  isOpen,
  onClose,
  onImport
}: {
  isOpen: boolean;
  onClose: () => void;
  onImport: (articles: { numero: string; urn?: string }[], normInfo: { tipo_atto: string; data: string; numero_atto: string }) => void;
}) {
  const [actType, setActType] = useState('codice civile');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<Array<string | Record<string, string>>>([]);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const fetchTree = async () => {
    setLoading(true);
    setError(null);
    try {
      // First get the norma data to get the URN
      const normaRes = await fetch('/fetch_norma_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          act_type: actType,
          act_number: actNumber || undefined,
          date: actDate ? parseItalianDate(actDate) : undefined,
          article: '1' // dummy article to get URN
        })
      });
      const normaData = await normaRes.json();

      if (!normaData.urn) {
        throw new Error('Impossibile generare URN per questa norma');
      }

      // Now fetch the tree
      const treeRes = await fetch('/fetch_tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urn: normaData.urn,
          link: true
        })
      });
      const treeData = await treeRes.json();

      if (treeData.error) {
        throw new Error(treeData.error);
      }

      setTree(treeData.tree || []);
      setSelectedArticles(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel recupero della struttura');
    } finally {
      setLoading(false);
    }
  };

  const toggleArticle = (articleNum: string) => {
    setSelectedArticles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(articleNum)) newSet.delete(articleNum);
      else newSet.add(articleNum);
      return newSet;
    });
  };

  const selectAll = () => {
    const allArticles = tree.map(item =>
      typeof item === 'string' ? item : Object.keys(item)[0]
    );
    setSelectedArticles(new Set(allArticles));
  };

  const handleImport = () => {
    const articles = Array.from(selectedArticles).map(num => {
      const item = tree.find(t =>
        typeof t === 'string' ? t === num : Object.keys(t)[0] === num
      );
      return {
        numero: num,
        urn: typeof item === 'object' ? Object.values(item)[0] : undefined
      };
    });
    onImport(articles, { tipo_atto: actType, data: actDate, numero_atto: actNumber });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] border border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-white flex items-center gap-2">
            <TreeDeciduous size={20} className="text-green-600" />
            Importa articoli da norma
          </h3>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo atto</label>
              <select
                value={actType}
                onChange={e => setActType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="codice civile">Codice Civile</option>
                <option value="codice penale">Codice Penale</option>
                <option value="codice procedura civile">Codice Procedura Civile</option>
                <option value="codice procedura penale">Codice Procedura Penale</option>
                <option value="costituzione">Costituzione</option>
                <option value="legge">Legge</option>
                <option value="decreto legislativo">Decreto Legislativo</option>
                <option value="decreto legge">Decreto Legge</option>
                <option value="d.p.r.">D.P.R.</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Numero</label>
              <input
                value={actNumber}
                onChange={e => setActNumber(e.target.value)}
                placeholder="241"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data</label>
              <input
                type="text"
                value={actDate}
                onChange={e => setActDate(e.target.value)}
                placeholder="aaaa o gg-mm-aaaa"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <button
            onClick={fetchTree}
            disabled={loading}
            className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            {loading ? 'Caricamento...' : 'Cerca articoli'}
          </button>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {tree.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">{tree.length} articoli trovati</span>
                <button onClick={selectAll} className="text-sm text-blue-600 hover:underline">
                  Seleziona tutti
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                {tree.map((item, idx) => {
                  const articleNum = typeof item === 'string' ? item : Object.keys(item)[0];
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleArticle(articleNum)}
                      className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      {selectedArticles.has(articleNum) ? (
                        <CheckSquare size={16} className="text-blue-500" />
                      ) : (
                        <Square size={16} className="text-gray-400" />
                      )}
                      <span className="text-sm">Art. {articleNum}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            Annulla
          </button>
          <button
            onClick={handleImport}
            disabled={selectedArticles.size === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            Importa {selectedArticles.size > 0 ? `(${selectedArticles.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DossierPage() {
  const { dossiers, deleteDossier, removeFromDossier, updateDossier, toggleDossierPin, reorderDossierItems, updateDossierItemStatus, moveToDossier, triggerSearch, importDossier } = useAppStore();
  const [selectedDossierId, setSelectedDossierId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'items'>('date');
  const [viewingItem, setViewingItem] = useState<DossierItem | null>(null);
  const [editingDossier, setEditingDossier] = useState<Dossier | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [moveToModalOpen, setMoveToModalOpen] = useState(false);
  const [treeNavigatorOpen, setTreeNavigatorOpen] = useState(false);
  const [importingDossier, setImportingDossier] = useState<Dossier | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tryStartTour } = useTour();

  // Start dossier tour on first visit
  useEffect(() => {
    tryStartTour('dossier');
  }, [tryStartTour]);

  // Handle import from share link
  useEffect(() => {
    const importData = searchParams.get('import');
    if (importData) {
      try {
        const decoded = atob(decodeURIComponent(importData));
        const dossier = JSON.parse(decoded) as Dossier;
        setImportingDossier(dossier);
        // Clear the URL parameter
        setSearchParams({}, { replace: true });
      } catch (e) {
        console.error('Failed to parse import data:', e);
        alert('Link di importazione non valido');
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  const handleConfirmImport = () => {
    if (importingDossier) {
      const newId = importDossier(importingDossier);
      setImportingDossier(null);
      setSelectedDossierId(newId);
    }
  };

  const selectedDossier = dossiers.find(d => d.id === selectedDossierId);
  const { addToDossier } = useAppStore();

  const handleDossierItemClick = (item: DossierItem) => {
    if (item.type === 'norma') {
      // Navigate to search page and trigger search
      navigate('/');
      triggerSearch({
        act_type: item.data.tipo_atto,
        act_number: item.data.numero_atto || '',
        date: item.data.data || '',
        article: item.data.numero_articolo?.toString() || '',
        version: 'vigente',
        version_date: '',
        show_brocardi_info: true
      });
    }
  };

  // Open all dossier items on dashboard (grouped by norm)
  const handleOpenAllOnDashboard = () => {
    if (!selectedDossier) return;

    // Filter only norma items
    const normaItems = selectedDossier.items.filter(i => i.type === 'norma');
    if (normaItems.length === 0) return;

    // Group by norm (tipo_atto + numero_atto + data)
    const groups = new Map<string, typeof normaItems>();
    normaItems.forEach(item => {
      const key = `${item.data.tipo_atto}|${item.data.numero_atto || ''}|${item.data.data || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });

    // Take the first group and create a search with all articles
    const firstGroup = groups.values().next().value;
    if (!firstGroup || firstGroup.length === 0) return;

    const articles = firstGroup.map((i: DossierItem) => i.data.numero_articolo).join(',');

    navigate('/');
    triggerSearch({
      act_type: firstGroup[0].data.tipo_atto,
      act_number: firstGroup[0].data.numero_atto || '',
      date: firstGroup[0].data.data || '',
      article: articles,
      version: 'vigente',
      version_date: '',
      show_brocardi_info: true,
      tabLabel: selectedDossier.title // Pass dossier name as tab label
    });
  };

  // Drag & drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && selectedDossier) {
      const oldIndex = selectedDossier.items.findIndex(item => item.id === active.id);
      const newIndex = selectedDossier.items.findIndex(item => item.id === over.id);
      reorderDossierItems(selectedDossier.id, oldIndex, newIndex);
    }
  };

  // Bulk selection helpers
  const toggleItemSelection = (itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) newSet.delete(itemId);
      else newSet.add(itemId);
      return newSet;
    });
  };

  const selectAllItems = () => {
    if (selectedDossier) {
      setSelectedItems(new Set(selectedDossier.items.map(i => i.id)));
    }
  };

  const clearSelection = () => setSelectedItems(new Set());

  const deleteSelectedItems = () => {
    if (selectedDossier && selectedItems.size > 0) {
      selectedItems.forEach(itemId => removeFromDossier(selectedDossier.id, itemId));
      clearSelection();
    }
  };

  const handleMoveToDossier = (targetDossierId: string) => {
    if (selectedDossier && selectedItems.size > 0) {
      moveToDossier(selectedDossier.id, targetDossierId, Array.from(selectedItems));
      clearSelection();
      setMoveToModalOpen(false);
    }
  };

  // JSON export/import
  const exportDossierJSON = (dossier: Dossier) => {
    const data = JSON.stringify(dossier, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dossier.title.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async (dossier: Dossier) => {
    const data = btoa(JSON.stringify(dossier));
    const shareUrl = `${window.location.origin}/dossier?import=${encodeURIComponent(data)}`;
    await navigator.clipboard.writeText(shareUrl);
    alert('Link copiato negli appunti!');
  };

  // Import articles from tree navigator
  const handleTreeImport = (
    articles: { numero: string; urn?: string }[],
    normInfo: { tipo_atto: string; data: string; numero_atto: string }
  ) => {
    if (!selectedDossier) return;
    articles.forEach(art => {
      addToDossier(selectedDossier.id, {
        tipo_atto: normInfo.tipo_atto,
        data: normInfo.data,
        numero_atto: normInfo.numero_atto,
        numero_articolo: art.numero,
        urn: art.urn
      }, 'norma');
    });
  };

  // Get all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    dossiers.forEach(d => d.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [dossiers]);

  // Filter and sort dossiers
  const filteredDossiers = useMemo(() => {
    let result = [...dossiers];

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(d =>
        d.title.toLowerCase().includes(query) ||
        d.description?.toLowerCase().includes(query) ||
        d.items.some(item => {
          if (item.type === 'norma') {
            return item.data.tipo_atto?.toLowerCase().includes(query) ||
                   item.data.numero_articolo?.includes(query);
          }
          return item.data?.toLowerCase?.().includes(query);
        })
      );
    }

    // Filter by tag
    if (selectedTag) {
      result = result.filter(d => d.tags?.includes(selectedTag));
    }

    // Sort
    result.sort((a, b) => {
      // Pinned first
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      switch (sortBy) {
        case 'name':
          return a.title.localeCompare(b.title);
        case 'items':
          return b.items.length - a.items.length;
        case 'date':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return result;
  }, [dossiers, searchQuery, selectedTag, sortBy]);

  const handleExportPdf = (dossierId: string) => {
    const dossier = dossiers.find(d => d.id === dossierId);
    if (!dossier) return;

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 50;

    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(dossier.title, 40, y);
    y += 30;

    // Description
    if (dossier.description) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'italic');
      const descWrapped = doc.splitTextToSize(dossier.description, 500);
      doc.text(descWrapped, 40, y);
      y += descWrapped.length * 14 + 10;
    }

    // Tags
    if (dossier.tags?.length) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Tag: ${dossier.tags.join(', ')}`, 40, y);
      y += 20;
    }

    // Separator
    doc.setDrawColor(200);
    doc.line(40, y, 555, y);
    y += 20;

    // Items
    doc.setFont('helvetica', 'normal');
    dossier.items.forEach((item, idx) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      const itemTitle = item.type === 'norma'
        ? `${idx + 1}. ${item.data.tipo_atto} ${item.data.numero_atto || ''} - Art. ${item.data.numero_articolo}`
        : `${idx + 1}. Nota`;
      doc.text(itemTitle, 40, y);
      y += 18;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const content = item.type === 'norma'
        ? (item.data.article_text || '').replace(/<[^>]+>/g, '').substring(0, 2000)
        : item.data;
      const wrapped = doc.splitTextToSize(content, 500);
      wrapped.slice(0, 50).forEach((line: string) => {
        if (y > 760) {
          doc.addPage();
          y = 50;
        }
        doc.text(line, 40, y);
        y += 13;
      });
      y += 15;
    });

    doc.save(`${dossier.title.replace(/[^a-z0-9]/gi, '_')}.pdf`);
  };

  const handleUpdateDossier = (title: string, description: string, tags: string[]) => {
    if (editingDossier) {
      updateDossier(editingDossier.id, { title, description, tags });
    }
  };

  // Detail view
  if (selectedDossier) {
    return (
      <div className="animate-in slide-in-from-right-10 duration-300">
        {/* Mobile back button - prominent */}
        <button
          onClick={() => setSelectedDossierId(null)}
          className="md:hidden mb-4 flex items-center gap-2 px-4 py-3 text-base font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors w-full"
        >
          <ArrowLeft size={20} /> Torna ai Dossier
        </button>

        {/* Desktop back button - subtle */}
        <button
          onClick={() => setSelectedDossierId(null)}
          className="hidden md:flex mb-4 items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          <ArrowLeft size={16} /> Torna ai Dossier
        </button>

        <header className="mb-6 border-b border-gray-200 dark:border-gray-800 pb-4">
          <div className="flex flex-col md:flex-row justify-between md:items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2 md:gap-3">
                  <Folder className="text-blue-500" size={24} />
                  <span className="truncate">{selectedDossier.title}</span>
                </h2>
                {selectedDossier.isPinned && (
                  <Star size={16} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />
                )}
              </div>
              {selectedDossier.description && (
                <p className="text-sm md:text-base text-gray-500 mt-1 line-clamp-2 md:line-clamp-none">{selectedDossier.description}</p>
              )}
              {selectedDossier.tags && selectedDossier.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedDossier.tags.map(tag => (
                    <span key={tag} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs md:text-sm text-gray-400 mt-2">
                Creato il {new Date(selectedDossier.createdAt).toLocaleDateString()} • {selectedDossier.items.length} elementi
              </div>
              {/* Statistics bar - scrollable on mobile */}
              {selectedDossier.items.length > 0 && (
                <div id="tour-dossier-stats" className="flex gap-2 md:gap-3 mt-3 text-xs overflow-x-auto pb-2 md:pb-0 -mx-1 px-1">
                  <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    <Circle size={12} className="text-gray-400 flex-shrink-0" />
                    {selectedDossier.items.filter(i => !i.status || i.status === 'unread').length} da leggere
                  </span>
                  <span className="flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 rounded text-blue-600 dark:text-blue-300 whitespace-nowrap">
                    <BookOpen size={12} className="flex-shrink-0" />
                    {selectedDossier.items.filter(i => i.status === 'reading').length} in lettura
                  </span>
                  <span className="flex items-center gap-1 px-2 py-1 bg-orange-50 dark:bg-orange-900/20 rounded text-orange-600 dark:text-orange-300 whitespace-nowrap">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    {selectedDossier.items.filter(i => i.status === 'important').length} importanti
                  </span>
                  <span className="flex items-center gap-1 px-2 py-1 bg-green-50 dark:bg-green-900/20 rounded text-green-600 dark:text-green-300 whitespace-nowrap">
                    <CheckCircle2 size={12} className="flex-shrink-0" />
                    {selectedDossier.items.filter(i => i.status === 'done').length} completati
                  </span>
                </div>
              )}
            </div>

            {/* Mobile toolbar - simplified with larger touch targets (44px min) */}
            <div className="md:hidden flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
              <button
                onClick={() => setEditingDossier(selectedDossier)}
                className="flex-shrink-0 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 p-3 rounded-lg transition-colors"
                title="Modifica"
              >
                <Edit2 size={20} />
              </button>
              <button
                onClick={() => handleExportPdf(selectedDossier.id)}
                className="flex-shrink-0 dossier-export text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 p-3 rounded-lg transition-colors"
                title="Esporta PDF"
              >
                <Download size={20} />
              </button>
              <button
                onClick={() => copyShareLink(selectedDossier)}
                className="flex-shrink-0 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 p-3 rounded-lg transition-colors"
                title="Condividi"
              >
                <Share2 size={20} />
              </button>
              <button
                onClick={handleOpenAllOnDashboard}
                className="flex-shrink-0 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 p-3 rounded-lg transition-colors disabled:opacity-50"
                title="Apri su Dashboard"
                disabled={selectedDossier.items.filter(i => i.type === 'norma').length === 0}
              >
                <ExternalLink size={20} />
              </button>
              <button
                onClick={() => {
                  if (confirm('Sei sicuro di voler eliminare questo dossier?')) {
                    deleteDossier(selectedDossier.id);
                    setSelectedDossierId(null);
                  }
                }}
                className="flex-shrink-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-3 rounded-lg transition-colors"
                title="Elimina"
              >
                <Trash2 size={20} />
              </button>
            </div>

            {/* Desktop toolbar - full functionality */}
            <div className="hidden md:flex gap-2">
              <button
                onClick={() => setEditingDossier(selectedDossier)}
                className="text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 p-2 rounded-md transition-colors"
                title="Modifica"
              >
                <Edit2 size={18} />
              </button>
              <button
                id="tour-dossier-pin"
                onClick={() => toggleDossierPin(selectedDossier.id)}
                className={cn(
                  "p-2 rounded-md transition-colors",
                  selectedDossier.isPinned
                    ? "text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                    : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                )}
                title={selectedDossier.isPinned ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
              >
                <Star size={18} className={selectedDossier.isPinned ? "fill-current" : ""} />
              </button>
              <button
                id="tour-dossier-export"
                onClick={() => handleExportPdf(selectedDossier.id)}
                className="dossier-export text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 p-2 rounded-md transition-colors"
                title="Esporta PDF"
              >
                <Download size={18} />
              </button>
              <button
                onClick={() => exportDossierJSON(selectedDossier)}
                className="text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 p-2 rounded-md transition-colors"
                title="Esporta JSON"
              >
                <FileJson size={18} />
              </button>
              <button
                onClick={() => copyShareLink(selectedDossier)}
                className="text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 p-2 rounded-md transition-colors"
                title="Copia link di condivisione"
              >
                <Share2 size={18} />
              </button>
              <button
                onClick={() => setTreeNavigatorOpen(true)}
                className="text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 p-2 rounded-md transition-colors"
                title="Importa da norma"
              >
                <TreeDeciduous size={18} />
              </button>
              <button
                onClick={handleOpenAllOnDashboard}
                className="text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 p-2 rounded-md transition-colors"
                title="Apri tutti su Dashboard"
                disabled={selectedDossier.items.filter(i => i.type === 'norma').length === 0}
              >
                <ExternalLink size={18} />
              </button>
              <button
                onClick={() => {
                  if (confirm('Sei sicuro di voler eliminare questo dossier?')) {
                    deleteDossier(selectedDossier.id);
                    setSelectedDossierId(null);
                  }
                }}
                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-md transition-colors"
                title="Elimina Dossier"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Bulk actions toolbar */}
        {selectedDossier.items.length > 0 && (
          <div className="mb-4 flex flex-col md:flex-row items-stretch md:items-center gap-3 md:justify-between bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setShowBulkActions(!showBulkActions)}
                className={cn(
                  "px-4 py-2 md:px-3 md:py-1.5 rounded-md text-sm transition-colors min-h-[44px] md:min-h-0",
                  showBulkActions
                    ? "bg-blue-600 text-white"
                    : "bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600"
                )}
              >
                {showBulkActions ? "Annulla selezione" : "Seleziona"}
              </button>
              {showBulkActions && (
                <>
                  <button
                    onClick={selectAllItems}
                    className="text-sm text-blue-600 hover:underline min-h-[44px] md:min-h-0 px-2"
                  >
                    Seleziona tutti
                  </button>
                  <span className="text-sm text-gray-500">
                    {selectedItems.size} selezionati
                  </span>
                </>
              )}
            </div>
            {showBulkActions && selectedItems.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMoveToModalOpen(true)}
                  className="flex-1 md:flex-none px-4 py-2 md:px-3 md:py-1.5 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 flex items-center justify-center gap-1 min-h-[44px] md:min-h-0"
                >
                  <FolderInput size={16} />
                  <span className="md:inline">Sposta</span>
                </button>
                <button
                  onClick={deleteSelectedItems}
                  className="flex-1 md:flex-none px-4 py-2 md:px-3 md:py-1.5 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 rounded-md hover:bg-red-100 dark:hover:bg-red-900/50 flex items-center justify-center gap-1 min-h-[44px] md:min-h-0"
                >
                  <Trash2 size={16} />
                  <span className="md:inline">Elimina</span>
                </button>
              </div>
            )}
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={selectedDossier.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            <div id="tour-dossier-items" className="space-y-3">
              {selectedDossier.items.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500">Questo dossier è vuoto.</p>
                  <p className="text-xs text-gray-400 mt-1">Aggiungi articoli dai risultati di ricerca.</p>
                </div>
              ) : (
                selectedDossier.items.map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    isSelected={selectedItems.has(item.id)}
                    onToggleSelect={() => toggleItemSelection(item.id)}
                    onView={() => handleDossierItemClick(item)}
                    onRemove={() => removeFromDossier(selectedDossier.id, item.id)}
                    onStatusChange={(status) => updateDossierItemStatus(selectedDossier.id, item.id, status)}
                    showCheckbox={showBulkActions}
                  />
                ))
              )}
            </div>
          </SortableContext>
        </DndContext>

        {/* Move to dossier modal */}
        {moveToModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMoveToModalOpen(false)} />
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-gray-800">
              <div className="p-6">
                <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-4">Sposta in altro dossier</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {dossiers.filter(d => d.id !== selectedDossier.id).map(d => (
                    <button
                      key={d.id}
                      onClick={() => handleMoveToDossier(d.id)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                    >
                      <Folder size={16} className="text-blue-500" />
                      {d.title}
                    </button>
                  ))}
                  {dossiers.filter(d => d.id !== selectedDossier.id).length === 0 && (
                    <p className="text-gray-500 text-sm text-center py-4">Nessun altro dossier disponibile</p>
                  )}
                </div>
                <button
                  onClick={() => setMoveToModalOpen(false)}
                  className="mt-4 w-full px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                >
                  Annulla
                </button>
              </div>
            </div>
          </div>
        )}

        <ArticleViewerModal
          item={viewingItem}
          isOpen={!!viewingItem}
          onClose={() => setViewingItem(null)}
        />

        <EditDossierModal
          dossier={editingDossier}
          isOpen={!!editingDossier}
          onClose={() => setEditingDossier(null)}
          onSave={handleUpdateDossier}
        />

        <TreeNavigatorModal
          isOpen={treeNavigatorOpen}
          onClose={() => setTreeNavigatorOpen(false)}
          onImport={handleTreeImport}
        />

        <ImportDossierModal
          dossier={importingDossier}
          isOpen={!!importingDossier}
          onClose={() => setImportingDossier(null)}
          onConfirm={handleConfirmImport}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-6">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">I tuoi Dossier</h2>
        <button
          id="tour-dossier-create"
          onClick={() => setIsModalOpen(true)}
          className="dossier-create-button bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm min-h-[44px] md:min-h-0"
        >
          <FolderPlus size={20} /> Nuovo Dossier
        </button>
      </div>

      {/* Search and filters */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div id="tour-dossier-search" className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cerca nei dossier..."
              className="w-full pl-10 pr-4 py-3 md:py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[44px] md:min-h-0"
            />
          </div>
          <select
            id="tour-dossier-sort"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as 'date' | 'name' | 'items')}
            className="px-4 py-3 md:py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[44px] md:min-h-0"
          >
            <option value="date">Ordina per data</option>
            <option value="name">Ordina per nome</option>
            <option value="items">Ordina per elementi</option>
          </select>
        </div>

        {/* Tags filter - scrollable on mobile */}
        {allTags.length > 0 && (
          <div id="tour-dossier-filters" className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            <button
              onClick={() => setSelectedTag(null)}
              className={cn(
                "px-4 py-2 md:px-3 md:py-1 rounded-full text-sm transition-colors whitespace-nowrap min-h-[44px] md:min-h-0 flex items-center",
                !selectedTag
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              )}
            >
              Tutti
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                className={cn(
                  "px-4 py-2 md:px-3 md:py-1 rounded-full text-sm transition-colors flex items-center gap-1 whitespace-nowrap min-h-[44px] md:min-h-0",
                  selectedTag === tag
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                <Tag size={14} />
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dossier grid - full width cards on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {filteredDossiers.length === 0 ? (
          <div className="col-span-full text-center py-12 md:py-20">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Folder size={32} className="text-gray-400 md:w-10 md:h-10" />
            </div>
            {searchQuery || selectedTag ? (
              <>
                <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Nessun risultato</h3>
                <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-2">Prova a modificare i filtri di ricerca.</p>
              </>
            ) : (
              <>
                <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Nessun dossier creato</h3>
                <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-2">Organizza le tue ricerche creando dei dossier tematici.</p>
              </>
            )}
          </div>
        ) : (
          filteredDossiers.map((dossier, idx) => (
            <div
              key={dossier.id}
              id={idx === 0 ? 'tour-dossier-card' : undefined}
              onClick={() => setSelectedDossierId(dossier.id)}
              className="dossier-card bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 md:p-5 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer group relative active:scale-[0.98]"
            >
              {dossier.isPinned && (
                <Star size={14} className="absolute top-3 right-3 text-yellow-500 fill-yellow-500" />
              )}
              <div className="flex justify-between items-start mb-3 md:mb-4">
                <Folder className="text-blue-500 group-hover:scale-110 transition-transform flex-shrink-0" size={28} />
                <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs px-2 py-1 rounded-full whitespace-nowrap">
                  {dossier.items.length} elementi
                </span>
              </div>
              <h3 className="font-bold text-base md:text-lg text-gray-900 dark:text-white mb-1 group-hover:text-blue-600 transition-colors line-clamp-2">
                {dossier.title}
              </h3>
              <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 line-clamp-2 min-h-[2.5em]">
                {dossier.description || "Nessuna descrizione"}
              </p>
              {dossier.tags && dossier.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 md:mt-3">
                  {dossier.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded truncate max-w-[100px]">
                      {tag}
                    </span>
                  ))}
                  {dossier.tags.length > 3 && (
                    <span className="text-xs text-gray-400">+{dossier.tags.length - 3}</span>
                  )}
                </div>
              )}
              <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                <span className="text-xs text-gray-400">{new Date(dossier.createdAt).toLocaleDateString()}</span>
                <ChevronRight size={18} className="text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all flex-shrink-0" />
              </div>
            </div>
          ))
        )}
      </div>

      <DossierModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      <EditDossierModal
        dossier={editingDossier}
        isOpen={!!editingDossier}
        onClose={() => setEditingDossier(null)}
        onSave={handleUpdateDossier}
      />

      <ImportDossierModal
        dossier={importingDossier}
        isOpen={!!importingDossier}
        onClose={() => setImportingDossier(null)}
        onConfirm={handleConfirmImport}
      />
    </div>
  );
}
