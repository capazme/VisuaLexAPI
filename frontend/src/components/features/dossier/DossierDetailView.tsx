import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Folder,
  Trash2,
  ArrowLeft,
  Download,
  Search,
  Edit2,
  Share2,
  FolderInput,
  FileJson,
  TreeDeciduous,
  ExternalLink,
  Star,
  X,
  ListChecks,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { EmptyState } from '../../ui/EmptyState';
import { showUndoToast } from '../../../hooks/useUndoableAction';
import type { Dossier, DossierItem } from '../../../types';
import { SortableDossierItem } from './SortableDossierItem';
import { formatTimestampLong, STATUS_CONFIG, computeNormaGroups, type DossierItemStatus, type NormaGroup } from './dossierUtils';
import { EditDossierModal } from './EditDossierModal';
import { MoveToDossierModal } from './MoveToDossierModal';
import { TreeNavigatorModal } from './TreeNavigatorModal';
import { ArticleViewerModal } from './ArticleViewerModal';
import { OpenOnDashboardPicker } from './OpenOnDashboardPicker';
import { ToolbarButton } from './ToolbarButton';

type ToastType = 'success' | 'error' | 'info';

interface Props {
  dossier: Dossier;
  onBack: () => void;
  showToast: (message: string, type?: ToastType) => void;
}

export function DossierDetailView({ dossier, onBack, showToast }: Props) {
  const {
    dossiers,
    deleteDossier,
    removeFromDossier,
    restoreDossierItem,
    updateDossier,
    toggleDossierPin,
    reorderDossierItems,
    updateDossierItemStatus,
    moveToDossier,
    triggerSearch,
    triggerMultiSearch,
    addToDossier,
    addWorkspaceTab,
  } = useAppStore();
  const navigate = useNavigate();

  const [viewingItem, setViewingItem] = useState<DossierItem | null>(null);
  const [editingDossier, setEditingDossier] = useState<Dossier | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [moveToModalOpen, setMoveToModalOpen] = useState(false);
  const [treeNavigatorOpen, setTreeNavigatorOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DossierItemStatus | null>(null);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [bulkStatusMenuOpen, setBulkStatusMenuOpen] = useState(false);
  const bulkStatusMenuRef = useRef<HTMLDivElement>(null);
  const [openPickerGroups, setOpenPickerGroups] = useState<NormaGroup[] | null>(null);

  // Close the bulk-status menu on click-outside / Escape.
  useEffect(() => {
    if (!bulkStatusMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (bulkStatusMenuRef.current && !bulkStatusMenuRef.current.contains(e.target as Node)) {
        setBulkStatusMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBulkStatusMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bulkStatusMenuOpen]);

  // Items filtered by status + free-text query. Drag-reorder still operates on
  // the full `dossier.items` array, so indexes stay absolute even while filtered.
  const visibleItems = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    return dossier.items.filter((item) => {
      if (statusFilter && (item.status ?? 'unread') !== statusFilter) return false;
      if (!q) return true;
      if (item.type === 'norma') {
        const d = item.data;
        return (
          d.tipo_atto?.toLowerCase().includes(q) ||
          d.numero_articolo?.toString().toLowerCase().includes(q) ||
          d.numero_atto?.toString().toLowerCase().includes(q) ||
          d.data?.toString().toLowerCase().includes(q)
        );
      }
      return typeof item.data === 'string' && item.data.toLowerCase().includes(q);
    });
  }, [dossier.items, statusFilter, itemSearchQuery]);

  const hasFilter = statusFilter !== null || itemSearchQuery.trim().length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = dossier.items.findIndex((item) => item.id === active.id);
      const newIndex = dossier.items.findIndex((item) => item.id === over.id);
      reorderDossierItems(dossier.id, oldIndex, newIndex);
    }
  };

  const toggleItemSelection = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectAllItems = () => {
    setSelectedItems(new Set(dossier.items.map((i) => i.id)));
  };

  const clearSelection = () => setSelectedItems(new Set());

  // Remove one item with a 5s undo window. Snapshot id + position + data up
  // front so undo can re-insert at the exact spot with status/addedAt intact.
  const handleRemoveSingle = (item: DossierItem) => {
    const atIndex = dossier.items.findIndex((i) => i.id === item.id);
    if (atIndex < 0) return;
    void showUndoToast({
      action: () => {
        removeFromDossier(dossier.id, item.id);
        return { item, atIndex };
      },
      undo: ({ item: snap, atIndex: idx }) => restoreDossierItem(dossier.id, snap, idx),
      message: 'Elemento rimosso',
    });
  };

  const confirmBulkDelete = () => {
    if (selectedItems.size === 0) return;
    setBulkDeleteConfirmOpen(false);
    // Snapshot items + their indexes BEFORE deletion, in ascending order so
    // undo can restore them in the same sequence (later items get the right
    // index once earlier ones have been re-inserted).
    const snapshots = Array.from(selectedItems)
      .map((itemId) => {
        const atIndex = dossier.items.findIndex((i) => i.id === itemId);
        return atIndex >= 0 ? { item: dossier.items[atIndex], atIndex } : null;
      })
      .filter((s): s is { item: DossierItem; atIndex: number } => s !== null)
      .sort((a, b) => a.atIndex - b.atIndex);
    const count = snapshots.length;
    clearSelection();
    void showUndoToast({
      action: () => {
        snapshots.forEach((s) => removeFromDossier(dossier.id, s.item.id));
        return snapshots;
      },
      undo: (snaps) => {
        snaps.forEach((s) => restoreDossierItem(dossier.id, s.item, s.atIndex));
      },
      message: count === 1 ? 'Elemento rimosso' : `${count} elementi rimossi`,
    });
  };

  const bulkChangeStatus = (status: DossierItemStatus) => {
    if (selectedItems.size === 0) return;
    selectedItems.forEach((itemId) => updateDossierItemStatus(dossier.id, itemId, status));
    setBulkStatusMenuOpen(false);
    clearSelection();
    showToast(`Stato aggiornato per ${selectedItems.size} elementi`, 'success');
  };

  const handleMoveToDossier = (targetDossierId: string) => {
    if (selectedItems.size === 0) return;
    moveToDossier(dossier.id, targetDossierId, Array.from(selectedItems));
    clearSelection();
    setMoveToModalOpen(false);
  };

  const handleDossierItemClick = (item: DossierItem) => {
    if (item.type === 'norma') {
      navigate('/');
      triggerSearch({
        act_type: item.data.tipo_atto,
        act_number: item.data.numero_atto || '',
        date: item.data.data || '',
        article: item.data.numero_articolo?.toString() || '',
        version: 'vigente',
        version_date: '',
        show_brocardi_info: true,
      });
    } else {
      setViewingItem(item);
    }
  };

  const normaGroups = useMemo<NormaGroup[]>(() => computeNormaGroups(dossier.items), [dossier.items]);

  // Single-group open also pre-creates the dossier tab so results never leak
  // into pre-existing custom tabs with the same label (e.g. orphans from past
  // sessions, workspaceTabs is persisted in localStorage).
  const openGroupOnDashboard = (group: NormaGroup) => {
    const tabId = addWorkspaceTab(dossier.title, undefined, undefined, { isCustom: true });
    navigate('/');
    triggerSearch({
      act_type: group.tipo_atto,
      act_number: group.numero_atto,
      date: group.data,
      article: group.articles.join(','),
      version: 'vigente',
      version_date: '',
      show_brocardi_info: true,
      tabLabel: dossier.title,
      targetTabId: tabId,
    });
  };

  // Queue one search per norma-group. We pre-create an empty custom tab and
  // pass its id as `targetTabId` in every params — this avoids any label-match
  // timing races inside SearchPanel (each search knows exactly where to write).
  const openAllGroupsOnDashboard = () => {
    if (normaGroups.length === 0) return;
    const tabId = addWorkspaceTab(dossier.title, undefined, undefined, { isCustom: true });
    const paramsList = normaGroups.map((g) => ({
      act_type: g.tipo_atto,
      act_number: g.numero_atto,
      date: g.data,
      article: g.articles.join(','),
      version: 'vigente' as const,
      version_date: '',
      show_brocardi_info: true,
      tabLabel: dossier.title,
      targetTabId: tabId,
    }));
    navigate('/');
    triggerMultiSearch(paramsList);
  };

  const handleOpenAllOnDashboard = () => {
    if (normaGroups.length === 0) return;
    if (normaGroups.length === 1) {
      openGroupOnDashboard(normaGroups[0]);
      return;
    }
    setOpenPickerGroups(normaGroups);
  };

  const exportDossierJSON = () => {
    const data = JSON.stringify(dossier, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dossier.title.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async () => {
    const data = btoa(JSON.stringify(dossier));
    const shareUrl = `${window.location.origin}/dossier?import=${encodeURIComponent(data)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link di condivisione copiato negli appunti', 'success');
    } catch {
      showToast('Impossibile copiare il link', 'error');
    }
  };

  const handleTreeImport = (
    articles: { numero: string; urn?: string }[],
    normInfo: { tipo_atto: string; data: string; numero_atto: string },
  ) => {
    articles.forEach((art) => {
      addToDossier(dossier.id, {
        tipo_atto: normInfo.tipo_atto,
        data: normInfo.data,
        numero_atto: normInfo.numero_atto,
        numero_articolo: art.numero,
        urn: art.urn,
      }, 'norma');
    });
  };

  const handleExportPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 50;

    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(dossier.title, 40, y);
    y += 30;

    if (dossier.description) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'italic');
      const descWrapped = doc.splitTextToSize(dossier.description, 500);
      doc.text(descWrapped, 40, y);
      y += descWrapped.length * 14 + 10;
    }

    if (dossier.tags?.length) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Tag: ${dossier.tags.join(', ')}`, 40, y);
      y += 20;
    }

    doc.setDrawColor(200);
    doc.line(40, y, 555, y);
    y += 20;

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

  const hasNormaItems = dossier.items.some((i) => i.type === 'norma');

  return (
    <div className="animate-in slide-in-from-right-10 duration-300">
      <button
        onClick={onBack}
        className="md:hidden mb-4 flex items-center gap-2 px-4 py-3 text-base font-medium text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <ArrowLeft size={20} /> Torna ai Dossier
      </button>
      <button
        onClick={onBack}
        className="hidden md:flex mb-4 items-center gap-2 text-sm text-slate-500 hover:text-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
      >
        <ArrowLeft size={16} /> Torna ai Dossier
      </button>

      <header className="mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex flex-col md:flex-row justify-between md:items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 md:gap-3">
                <Folder className="text-blue-500" size={24} />
                <span className="truncate">{dossier.title}</span>
              </h2>
              {dossier.isPinned && (
                <Star size={16} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />
              )}
            </div>
            {dossier.description && (
              <p className="text-sm md:text-base text-slate-500 mt-1 line-clamp-2 md:line-clamp-none">{dossier.description}</p>
            )}
            {dossier.tags && dossier.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {dossier.tags.map((tag) => (
                  <span key={tag} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs md:text-sm text-slate-400 mt-2">
              Creato il {formatTimestampLong(dossier.createdAt)} • {dossier.items.length} elementi
            </div>
            {dossier.items.length > 0 && (
              <div id="tour-dossier-stats" className="flex gap-2 md:gap-3 mt-3 text-xs overflow-x-auto pb-2 md:pb-0 -mx-1 px-1 items-center">
                {(Object.keys(STATUS_CONFIG) as DossierItemStatus[]).map((key) => {
                  const cfg = STATUS_CONFIG[key];
                  const Icon = cfg.icon;
                  const count = dossier.items.filter((i) => (i.status ?? 'unread') === key).length;
                  const active = statusFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatusFilter(active ? null : key)}
                      aria-pressed={active}
                      aria-label={`${active ? 'Rimuovi filtro' : 'Filtra per'} ${cfg.label.toLowerCase()} (${count})`}
                      className={cn(
                        'inline-flex items-center gap-1.5 min-h-7 px-2.5 py-1 rounded-full whitespace-nowrap transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                        cfg.bg, cfg.color,
                        active
                          ? 'font-semibold ring-1 ring-current/40 shadow-sm'
                          : 'opacity-80 hover:opacity-100',
                      )}
                    >
                      <Icon size={12} className="flex-shrink-0" />
                      {count} {cfg.label.toLowerCase()}
                    </button>
                  );
                })}
                {statusFilter && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter(null)}
                    aria-label="Azzera filtro stato"
                    className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-1 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="md:hidden flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            <ToolbarButton
              variant="mobile"
              color="slate"
              icon={Edit2}
              onClick={() => setEditingDossier(dossier)}
              title="Modifica"
              ariaLabel="Modifica dossier"
            />
            <ToolbarButton
              variant="mobile"
              color="slateMuted"
              pressedColor="yellow"
              pressed={!!dossier.isPinned}
              icon={Star}
              onClick={() => toggleDossierPin(dossier.id)}
              title={dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
              ariaLabel={dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            />
            <ToolbarButton
              variant="mobile"
              color="emerald"
              icon={Download}
              onClick={handleExportPdf}
              title="Esporta PDF"
              ariaLabel="Esporta PDF"
              className="dossier-export"
            />
            <ToolbarButton
              variant="mobile"
              color="blue"
              icon={Share2}
              onClick={copyShareLink}
              title="Condividi"
              ariaLabel="Condividi dossier"
            />
            <ToolbarButton
              variant="mobile"
              color="indigo"
              icon={ExternalLink}
              onClick={handleOpenAllOnDashboard}
              disabled={!hasNormaItems}
              title="Apri su Dashboard"
              ariaLabel="Apri tutti su Dashboard"
            />
            <ToolbarButton
              variant="mobile"
              color="green"
              icon={TreeDeciduous}
              onClick={() => setTreeNavigatorOpen(true)}
              title="Importa da norma"
              ariaLabel="Importa articoli da norma"
            />
            <ToolbarButton
              variant="mobile"
              color="red"
              icon={Trash2}
              onClick={() => setConfirmDeleteOpen(true)}
              title="Elimina"
              ariaLabel="Elimina dossier"
            />
          </div>

          <div className="hidden md:flex gap-2">
            <ToolbarButton
              color="slate"
              icon={Edit2}
              onClick={() => setEditingDossier(dossier)}
              title="Modifica"
              ariaLabel="Modifica dossier"
            />
            <ToolbarButton
              id="tour-dossier-pin"
              color="slateMuted"
              pressedColor="yellow"
              pressed={!!dossier.isPinned}
              icon={Star}
              onClick={() => toggleDossierPin(dossier.id)}
              title={dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
              ariaLabel={dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            />
            <ToolbarButton
              id="tour-dossier-export"
              color="emerald"
              icon={Download}
              onClick={handleExportPdf}
              title="Esporta PDF"
              ariaLabel="Esporta PDF"
              className="dossier-export"
            />
            <ToolbarButton
              color="purple"
              icon={FileJson}
              onClick={exportDossierJSON}
              title="Esporta JSON"
              ariaLabel="Esporta JSON"
            />
            <ToolbarButton
              color="blue"
              icon={Share2}
              onClick={copyShareLink}
              title="Copia link di condivisione"
              ariaLabel="Copia link di condivisione"
            />
            <ToolbarButton
              color="green"
              icon={TreeDeciduous}
              onClick={() => setTreeNavigatorOpen(true)}
              title="Importa da norma"
              ariaLabel="Importa articoli da norma"
            />
            <ToolbarButton
              color="indigo"
              icon={ExternalLink}
              onClick={handleOpenAllOnDashboard}
              disabled={!hasNormaItems}
              title="Apri tutti su Dashboard"
              ariaLabel="Apri tutti su Dashboard"
            />
            <ToolbarButton
              color="red"
              icon={Trash2}
              onClick={() => setConfirmDeleteOpen(true)}
              title="Elimina Dossier"
              ariaLabel="Elimina dossier"
            />
          </div>
        </div>
      </header>

      {dossier.items.length > 0 && (
        <div className="mb-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={itemSearchQuery}
              onChange={(e) => setItemSearchQuery(e.target.value)}
              placeholder="Cerca in questo dossier..."
              aria-label="Cerca negli elementi del dossier"
              className="w-full pl-9 pr-9 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            {itemSearchQuery && (
              <button
                type="button"
                onClick={() => setItemSearchQuery('')}
                aria-label="Azzera ricerca"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {dossier.items.length > 0 && (
        <div className="mb-4 flex flex-col md:flex-row items-stretch md:items-center gap-3 md:justify-between bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setShowBulkActions(!showBulkActions)}
              aria-pressed={showBulkActions}
              className={cn(
                'px-4 py-2 md:px-3 md:py-1.5 rounded-md text-sm transition-colors min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                showBulkActions
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600',
              )}
            >
              {showBulkActions ? 'Annulla selezione' : 'Seleziona'}
            </button>
            {showBulkActions && (
              <>
                <button onClick={selectAllItems} className="text-sm text-blue-600 hover:underline min-h-[44px] md:min-h-0 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                  Seleziona tutti
                </button>
                <span className="text-sm text-slate-500">{selectedItems.size} selezionati</span>
              </>
            )}
          </div>
          {showBulkActions && selectedItems.size > 0 && (
            <div className="flex items-center gap-2">
              <div ref={bulkStatusMenuRef} className="relative">
                <button
                  onClick={() => setBulkStatusMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={bulkStatusMenuOpen}
                  className="flex-1 md:flex-none px-4 py-2 md:px-3 md:py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center gap-1 min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  <ListChecks size={16} />
                  <span className="md:inline">Stato</span>
                </button>
                {bulkStatusMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50"
                  >
                    {(Object.keys(STATUS_CONFIG) as DossierItemStatus[]).map((key) => {
                      const cfg = STATUS_CONFIG[key];
                      const Icon = cfg.icon;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="menuitem"
                          onClick={() => bulkChangeStatus(key)}
                          className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px] focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700"
                        >
                          <Icon size={16} className={cfg.color} />
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button onClick={() => setMoveToModalOpen(true)} className="flex-1 md:flex-none px-4 py-2 md:px-3 md:py-1.5 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 flex items-center justify-center gap-1 min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <FolderInput size={16} />
                <span className="md:inline">Sposta</span>
              </button>
              <button onClick={() => setBulkDeleteConfirmOpen(true)} className="flex-1 md:flex-none px-4 py-2 md:px-3 md:py-1.5 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 rounded-md hover:bg-red-100 dark:hover:bg-red-900/50 flex items-center justify-center gap-1 min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                <Trash2 size={16} />
                <span className="md:inline">Elimina</span>
              </button>
            </div>
          )}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div id="tour-dossier-items" className="space-y-3">
            {dossier.items.length === 0 ? (
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700">
                <EmptyState
                  variant="dossier"
                  title="Dossier vuoto"
                  description="Aggiungi articoli dai risultati di ricerca o importa da una norma."
                  action={
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <button onClick={() => navigate('/')} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg inline-flex items-center justify-center gap-2 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                        <Search size={18} />
                        Cerca articoli
                      </button>
                      <button onClick={() => setTreeNavigatorOpen(true)} className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg inline-flex items-center justify-center gap-2 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2">
                        <TreeDeciduous size={18} />
                        Importa da norma
                      </button>
                    </div>
                  }
                />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-10 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                Nessun elemento corrisponde ai filtri.
                {hasFilter && (
                  <button
                    type="button"
                    onClick={() => { setStatusFilter(null); setItemSearchQuery(''); }}
                    className="ml-2 text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    Azzera filtri
                  </button>
                )}
              </div>
            ) : (
              visibleItems.map((item) => (
                <SortableDossierItem
                  key={item.id}
                  item={item}
                  isSelected={selectedItems.has(item.id)}
                  onToggleSelect={() => toggleItemSelection(item.id)}
                  onView={() => handleDossierItemClick(item)}
                  onRemove={() => handleRemoveSingle(item)}
                  onStatusChange={(status: DossierItemStatus) => updateDossierItemStatus(dossier.id, item.id, status)}
                  showCheckbox={showBulkActions}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      {moveToModalOpen && (
        <MoveToDossierModal
          currentDossierId={dossier.id}
          dossiers={dossiers}
          onMove={handleMoveToDossier}
          onClose={() => setMoveToModalOpen(false)}
        />
      )}

      {viewingItem && (
        <ArticleViewerModal item={viewingItem} onClose={() => setViewingItem(null)} />
      )}

      {editingDossier && (
        <EditDossierModal
          dossier={editingDossier}
          onClose={() => setEditingDossier(null)}
          onSave={handleUpdateDossier}
        />
      )}

      {treeNavigatorOpen && (
        <TreeNavigatorModal
          onClose={() => setTreeNavigatorOpen(false)}
          onImport={handleTreeImport}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        variant="danger"
        title="Eliminare questo dossier?"
        message={`"${dossier.title}" verrà rimosso. Gli articoli originali salvati nei segnalibri o in altri dossier non saranno toccati.`}
        confirmLabel="Elimina"
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          deleteDossier(dossier.id);
          onBack();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        variant="danger"
        title={selectedItems.size === 1 ? 'Eliminare l’elemento selezionato?' : `Eliminare ${selectedItems.size} elementi?`}
        message="Verranno rimossi da questo dossier. Gli articoli originali salvati nei segnalibri o in altri dossier non saranno toccati."
        confirmLabel="Elimina"
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />

      {openPickerGroups && (
        <OpenOnDashboardPicker
          groups={openPickerGroups}
          onPick={(group) => {
            setOpenPickerGroups(null);
            openGroupOnDashboard(group);
          }}
          onPickAll={() => {
            setOpenPickerGroups(null);
            openAllGroupsOnDashboard();
          }}
          onClose={() => setOpenPickerGroups(null)}
        />
      )}
    </div>
  );
}
