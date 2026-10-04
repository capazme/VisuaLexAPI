import { useState, useMemo, useEffect } from 'react';
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
  GripVertical,
  StickyNote,
  ChevronsUpDown,
  ChevronsDownUp,
  Plus,
  MoreHorizontal,
  CheckSquare,
  History,
} from 'lucide-react';
import { AttributionChip } from '../bulletin/AttributionChip';
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
import {
  formatTimestampLong, computeNormaGroups, searchParamsFromNorma, searchesForGroups, type NormaGroup,
} from './dossierUtils';
import { dossierItemOrder, layoutDossier, type ActBlock } from './dossierLayout';
import { DossierActBlock } from './DossierActBlock';
import { DossierNotesSection } from './DossierNotesSection';
import { buildPdfBlocks, loadDossierTexts } from './dossierPdf';
import { actUrnForBlock } from './useActDetails';
import { fetchActRubriche } from '../../../utils/actStructureCache';
import { MenuButton } from '../../ui/MenuButton';
import { EditDossierModal } from './EditDossierModal';
import { MoveToDossierModal } from './MoveToDossierModal';
import { TreeNavigatorModal } from './TreeNavigatorModal';
import { OpenOnDashboardPicker } from './OpenOnDashboardPicker';
import { AddNoteModal } from './AddNoteModal';
import { dossierService, type DossierSnapshotApi } from '../../../services/dossierService';

type ToastType = 'success' | 'error' | 'info';
type NoteItem = Extract<DossierItem, { type: 'note' }>;

const SECONDARY_BUTTON =
  'min-h-[44px] border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0 md:py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
const ICON_BUTTON =
  'min-h-[44px] min-w-[44px] justify-center border border-slate-300 bg-white px-2 text-slate-600 hover:bg-slate-50 md:min-h-0 md:min-w-0 md:py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
    setDossierItemOrder,
    updateDossierItemStatus,
    moveToDossier,
    triggerSearch,
    triggerMultiSearch,
    addToDossier,
    addWorkspaceTab,
  } = useAppStore();
  const navigate = useNavigate();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingDossier, setEditingDossier] = useState<Dossier | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [moveToModalOpen, setMoveToModalOpen] = useState(false);
  // undefined = closed; null = open on a blank form; an act = open on that act's index.
  const [treeNavigatorAct, setTreeNavigatorAct] = useState<{ tipo_atto: string; numero_atto: string; data: string } | null | undefined>(undefined);
  const [foldedActs, setFoldedActs] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [openPickerGroups, setOpenPickerGroups] = useState<NormaGroup[] | null>(null);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<DossierSnapshotApi[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);

  // Hydrate the snapshot list, or the "• N snapshot" counter reads 0 after a
  // reload even when rows exist. Logged on failure, never hidden (gotcha 18).
  useEffect(() => {
    let cancelled = false;
    dossierService.getSnapshots(dossier.id)
      .then(list => { if (!cancelled) setSnapshots(list); })
      .catch(err => console.error('Failed to load dossier snapshots:', err));
    return () => { cancelled = true; };
  }, [dossier.id]);

  // Items filtered by free-text query. Drag-reorder still operates on
  // the full `dossier.items` array, so indexes stay absolute even while filtered.
  const visibleItems = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    return dossier.items.filter((item) => {
      if (!q) return true;
      if (item.type === 'norma') {
        const d = item.data;
        return (
          d.tipo_atto?.toLowerCase().includes(q) ||
          d.numero_articolo?.toString().toLowerCase().includes(q) ||
          d.numero_atto?.toString().toLowerCase().includes(q) ||
          d.data?.toString().toLowerCase().includes(q) ||
          !!item.citation?.toLowerCase().includes(q) ||
          !!item.actCitation?.toLowerCase().includes(q)
        );
      }
      return typeof item.data === 'string' && item.data.toLowerCase().includes(q);
    });
  }, [dossier.items, itemSearchQuery]);

  const hasFilter = itemSearchQuery.trim().length > 0;
  // The page's sections: notes first, then one block per act (spec §1-2).
  const layout = useMemo(() => layoutDossier(visibleItems), [visibleItems]);
  const fullLayout = useMemo(() => layoutDossier(dossier.items), [dossier.items]);
  const countsLine = [
    plural(fullLayout.acts.length, 'atto', 'atti'),
    plural(fullLayout.acts.reduce((n, a) => n + a.articles.length, 0), 'articolo', 'articoli'),
    ...(fullLayout.notes.length > 0 ? [plural(fullLayout.notes.length, 'nota', 'note')] : []),
  ].join(' · ');
  const visibleArticleIds = useMemo(() => layout.acts.flatMap((a) => a.articles.map((i) => i.id)), [layout]);

  const toggleExpanded = (id: string) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleFolded = (key: string) => setFoldedActs((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allExpanded = visibleArticleIds.length > 0 && visibleArticleIds.every(id => expandedIds.has(id));
  // "Espandi tutto" opens every block and every article; "Comprimi tutto" closes the articles only.
  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setFoldedActs(new Set());
      setExpandedIds(new Set(visibleArticleIds));
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Acts reorder; their articles follow them, in display order (spec §4).
  const handleActDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const keys = fullLayout.acts.map((a) => a.key);
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const moved = [...keys];
    moved.splice(to, 0, moved.splice(from, 1)[0]);
    setDossierItemOrder(dossier.id, dossierItemOrder(dossier.items, fullLayout, moved));
  };

  const toggleItemSelection = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // The articles on screen: notes carry no checkbox, so selecting "all" must not take them.
  const selectAllItems = () => {
    setSelectedItems(new Set(visibleArticleIds));
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

  const handleMoveToDossier = (targetDossierId: string) => {
    if (selectedItems.size === 0) return;
    moveToDossier(dossier.id, targetDossierId, Array.from(selectedItems));
    clearSelection();
    setMoveToModalOpen(false);
  };

  // Notes are read in place (expanded row), so only norma items have a
  // dashboard destination.
  const openItemOnDashboard = (item: DossierItem) => {
    if (item.type !== 'norma') return;
    navigate('/');
    triggerSearch(searchParamsFromNorma(item.data));
  };

  const normaGroups = useMemo<NormaGroup[]>(() => computeNormaGroups(dossier.items), [dossier.items]);

  // Queue one search per norma-group (one act's, or the dossier's). The tabs are
  // created up front (the texts in force share the dossier's, each past group has
  // its own) and their ids passed as `targetTabId`, so results never leak into a
  // pre-existing custom tab with the same label (gotcha 15).
  const openGroupsOnDashboard = (groups: NormaGroup[]) => {
    if (groups.length === 0) return;
    const paramsList = searchesForGroups(
      dossier.title, groups,
      (label) => addWorkspaceTab(label, undefined, undefined, { isCustom: true }),
    );
    navigate('/');
    triggerMultiSearch(paramsList);
  };

  const handleOpenAllOnDashboard = () => {
    if (normaGroups.length === 0) return;
    if (normaGroups.length === 1) {
      openGroupsOnDashboard(normaGroups);
      return;
    }
    setOpenPickerGroups(normaGroups);
  };

  // All the act's articles, behind one undo toast that puts them back where they were.
  const handleRemoveAct = (block: ActBlock) => {
    const snapshots = block.articles
      .map((item) => ({ item: item as DossierItem, atIndex: dossier.items.findIndex((i) => i.id === item.id) }))
      .filter((s) => s.atIndex >= 0)
      .sort((a, b) => a.atIndex - b.atIndex);
    if (snapshots.length === 0) return;
    void showUndoToast({
      action: () => {
        snapshots.forEach((s) => removeFromDossier(dossier.id, s.item.id));
        return snapshots;
      },
      undo: (snaps) => snaps.forEach((s) => restoreDossierItem(dossier.id, s.item, s.atIndex)),
      message: snapshots.length === 1 ? 'Articolo rimosso' : `${snapshots.length} articoli rimossi`,
    });
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

  const handleAddNote = (text: string) => {
    addToDossier(dossier.id, text, 'note');
    showToast('Nota aggiunta al dossier', 'success');
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
    if (articles.length > 0) {
      showToast(
        articles.length === 1
          ? '1 articolo importato nel dossier'
          : `${articles.length} articoli importati nel dossier`,
        'success',
      );
    }
  };

  // The PDF as the page is: notes, then each act once with its articles and
  // every text, fetched like the reader's (spec §9). Titles come from the
  // session cache the act blocks already filled.
  const handleExportPdf = async () => {
    if (pdfProgress) return;
    setPdfProgress({ done: 0, total: 0 });
    try {
      const texts = await loadDossierTexts(dossier.items, (done, total) => setPdfProgress({ done, total }));
      const titles = new Map<string, string | null>();
      await Promise.all(fullLayout.acts.map(async (block) => {
        const urn = actUrnForBlock(block);
        if (block.isCode || !urn) return;
        const answer = await fetchActRubriche(urn).catch((err: unknown) => {
          console.error('PDF: act title unavailable for', urn, err);
          return null;
        });
        titles.set(block.key, answer?.title?.trim() || null);
      }));
      const blocks = buildPdfBlocks(dossier.items, texts, titles);

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 44;
      const bottom = 770;
      const width = 507;
      let y = 54;

      const footer = () => {
        const page = doc.getNumberOfPages();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(`${dossier.title} · VisuaLex`, margin, 810);
        doc.text(`Pagina ${page}`, 555, 810, { align: 'right' });
        doc.setTextColor(0);
      };
      const ensureSpace = (height: number) => {
        if (y + height <= bottom) return;
        footer();
        doc.addPage();
        y = 54;
      };
      const writeLines = (lines: string[], lineHeight: number) => {
        lines.forEach(line => {
          ensureSpace(lineHeight);
          doc.text(line, margin, y);
          y += lineHeight;
        });
      };
      const write = (text: string, size: number, style: 'normal' | 'bold' | 'italic', lineHeight: number, grey = false) => {
        doc.setFontSize(size);
        doc.setFont('helvetica', style);
        doc.setTextColor(grey ? 100 : 0);
        writeLines(doc.splitTextToSize(text, width) as string[], lineHeight);
        doc.setTextColor(0);
      };

      doc.setFillColor(30, 64, 175);
      doc.rect(0, 0, 595, 12, 'F');
      write(dossier.title, 22, 'bold', 28);
      write(`Fascicolo normativo · ${countsLine} · Esportato il ${new Date().toLocaleDateString('it-IT')}`, 9, 'normal', 18, true);
      if (dossier.description) {
        write(dossier.description, 11, 'italic', 14);
        y += 6;
      }
      if (dossier.tags?.length) write(`Tag: ${dossier.tags.join(' · ')}`, 9, 'normal', 13, true);
      doc.setDrawColor(190);
      doc.line(margin, y + 4, 551, y + 4);
      y += 22;

      blocks.forEach((block) => {
        if (block.kind === 'notes') {
          ensureSpace(32);
          write('Note', 14, 'bold', 18);
          block.notes.forEach((text) => { write(text, 10, 'normal', 13); y += 6; });
          y += 10;
          return;
        }
        ensureSpace(48);
        write(block.heading, 14, 'bold', 18);
        if (block.title) write(block.title, 10, 'italic', 13, true);
        y += 6;
        block.articles.forEach((article) => {
          ensureSpace(32);
          const head = `${article.label}${article.rubrica ? ` — ${article.rubrica}` : ''}${article.versionLabel ? ` · ${article.versionLabel}` : ''}`;
          write(head, 11, 'bold', 15);
          write(article.text, 9, article.missing === 'none' ? 'normal' : 'italic', 12, article.missing !== 'none');
          y += 10;
        });
        y += 8;
      });

      footer();
      doc.save(`${dossier.title.replace(/[^a-z0-9]/gi, '_')}.pdf`);
      const missing = blocks.reduce((n, b) => n + (b.kind === 'act' ? b.articles.filter((a) => a.missing === 'unavailable').length : 0), 0);
      if (missing > 0) {
        showToast(`PDF salvato: ${missing === 1 ? '1 testo non disponibile' : `${missing} testi non disponibili`}`, 'info');
      }
    } catch (err) {
      console.error('Failed to export the dossier PDF:', err);
      showToast('Impossibile creare il PDF del dossier', 'error');
    } finally {
      setPdfProgress(null);
    }
  };

  const handleCreateSnapshot = async () => {
    setSnapshotBusy(true);
    try {
      const snapshot = await dossierService.createSnapshot(dossier.id, `Verifica ${new Date().toLocaleDateString('it-IT')}`);
      setSnapshots(previous => [snapshot, ...previous.filter(item => item.id !== snapshot.id)]);
      showToast(snapshot.unchanged ? 'Nessuna modifica: snapshot già aggiornato' : `Snapshot v${snapshot.version} salvato`, 'success');
    } catch {
      showToast('Impossibile salvare lo snapshot del dossier', 'error');
    } finally {
      setSnapshotBusy(false);
    }
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
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 md:gap-3">
                <Folder className="text-blue-500" size={24} />
                <span className="truncate">{dossier.title}</span>
              </h2>
              {dossier.isPinned && (
                <Star size={16} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />
              )}
              {dossier.sourceSuggestionId && (
                <AttributionChip author={dossier.originalAuthor} />
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
              Creato il {formatTimestampLong(dossier.createdAt)} · {countsLine}{snapshots.length > 0 ? ` · ${snapshots.length} snapshot` : ''}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenAllOnDashboard}
              disabled={!hasNormaItems}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40 md:min-h-0 md:py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              <ExternalLink size={16} aria-hidden />
              <span>Apri tutto<span className="hidden sm:inline"> su Dashboard</span></span>
            </button>
            <MenuButton
              label="Aggiungi"
              align="left"
              triggerClassName={SECONDARY_BUTTON}
              items={[
                { label: 'Articoli da una norma', icon: TreeDeciduous, onSelect: () => setTreeNavigatorAct(null) },
                { label: 'Nota', icon: StickyNote, onSelect: () => setAddNoteOpen(true) },
                { label: 'Cerca un articolo', icon: Search, onSelect: () => navigate('/') },
              ]}
            >
              <Plus size={16} aria-hidden />
              <span className="hidden sm:inline">Aggiungi</span>
            </MenuButton>
            <MenuButton
              label="Esporta"
              align="left"
              triggerClassName={cn(SECONDARY_BUTTON, 'dossier-export')}
              items={[
                { label: 'PDF', icon: Download, onSelect: () => void handleExportPdf(), disabled: !!pdfProgress },
                { label: 'Copia link di condivisione', icon: Share2, onSelect: () => void copyShareLink() },
                { label: 'JSON', icon: FileJson, onSelect: exportDossierJSON },
                { label: snapshotBusy ? 'Salvo lo snapshot…' : 'Salva snapshot', icon: History, onSelect: () => void handleCreateSnapshot(), disabled: snapshotBusy },
              ]}
            >
              <Download size={16} aria-hidden />
              {pdfProgress ? (
                <span role="status">Preparo il PDF…{pdfProgress.total > 0 ? ` ${pdfProgress.done} di ${pdfProgress.total}` : ''}</span>
              ) : (
                <span className="hidden sm:inline">Esporta</span>
              )}
            </MenuButton>
            <MenuButton
              label="Altre azioni"
              triggerClassName={ICON_BUTTON}
              items={[
                { label: 'Modifica', icon: Edit2, onSelect: () => setEditingDossier(dossier) },
                { label: dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti', icon: Star, onSelect: () => toggleDossierPin(dossier.id) },
                { label: showBulkActions ? 'Annulla selezione' : 'Seleziona elementi', icon: CheckSquare, onSelect: () => { setShowBulkActions((v) => !v); clearSelection(); } },
                { label: 'Elimina dossier', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => setConfirmDeleteOpen(true) },
              ]}
            >
              <MoreHorizontal size={18} />
            </MenuButton>
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
          <button
            type="button"
            onClick={toggleExpandAll}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-pressed={allExpanded}
          >
            {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {allExpanded ? 'Comprimi tutto' : 'Espandi tutto'}
          </button>
        </div>
      )}

      {showBulkActions && dossier.items.length > 0 && (
        <div className="mb-4 flex flex-col md:flex-row items-stretch md:items-center gap-3 md:justify-between bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={selectAllItems} className="text-sm text-blue-600 hover:underline min-h-[44px] md:min-h-0 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
              Seleziona tutti
            </button>
            <span className="text-sm text-slate-500">{selectedItems.size} selezionati</span>
            <button
              onClick={() => { setShowBulkActions(false); clearSelection(); }}
              className="text-sm text-slate-600 dark:text-slate-300 hover:underline min-h-[44px] md:min-h-0 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              Annulla selezione
            </button>
          </div>
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2">
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

      {hasFilter && layout.acts.length > 1 && (
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
          <GripVertical size={12} className="opacity-60" aria-hidden />
          Riordina disabilitato con filtri attivi
        </div>
      )}

      <div id="tour-dossier-items" className="space-y-4">
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
                  <button onClick={() => setTreeNavigatorAct(null)} className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg inline-flex items-center justify-center gap-2 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2">
                    <TreeDeciduous size={18} />
                    Importa da norma
                  </button>
                </div>
              }
            />
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
            <EmptyState
              variant="search"
              title="Nessun elemento corrisponde ai filtri"
              description="La ricerca non ha trovato corrispondenze in questo dossier."
              action={
                <button
                  type="button"
                  onClick={() => setItemSearchQuery('')}
                  className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg inline-flex items-center justify-center gap-2 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  <X size={18} />
                  Azzera filtri
                </button>
              }
            />
          </div>
        ) : (
          <>
            <DossierNotesSection notes={layout.notes as NoteItem[]} onRemove={handleRemoveSingle} />
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleActDragEnd}>
              <SortableContext items={layout.acts.map((a) => a.key)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {layout.acts.map((block) => (
                    <DossierActBlock
                      key={block.key}
                      block={block}
                      dragDisabled={hasFilter}
                      isFolded={foldedActs.has(block.key)}
                      onToggleFold={() => toggleFolded(block.key)}
                      expandedIds={expandedIds}
                      onToggleExpand={toggleExpanded}
                      selectedIds={selectedItems}
                      showCheckbox={showBulkActions}
                      onToggleSelect={toggleItemSelection}
                      onOpenAct={() => openGroupsOnDashboard(block.groups)}
                      onAddArticles={() => setTreeNavigatorAct({
                        tipo_atto: block.articles[0].data.tipo_atto,
                        numero_atto: block.articles[0].data.numero_atto || '',
                        data: block.articles[0].data.data || '',
                      })}
                      onRemoveAct={() => handleRemoveAct(block)}
                      onOpenItem={openItemOnDashboard}
                      onRemoveItem={handleRemoveSingle}
                      onToggleImportant={(item) => updateDossierItemStatus(dossier.id, item.id, item.status === 'important' ? 'unread' : 'important')}
                      showToast={showToast}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>

      {moveToModalOpen && (
        <MoveToDossierModal
          currentDossierId={dossier.id}
          dossiers={dossiers}
          onMove={handleMoveToDossier}
          onClose={() => setMoveToModalOpen(false)}
        />
      )}

      {editingDossier && (
        <EditDossierModal
          dossier={editingDossier}
          onClose={() => setEditingDossier(null)}
          onSave={handleUpdateDossier}
        />
      )}

      {treeNavigatorAct !== undefined && (
        <TreeNavigatorModal
          initialAct={treeNavigatorAct ?? undefined}
          onClose={() => setTreeNavigatorAct(undefined)}
          onImport={handleTreeImport}
        />
      )}

      {addNoteOpen && (
        <AddNoteModal
          onClose={() => setAddNoteOpen(false)}
          onSave={handleAddNote}
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
            openGroupsOnDashboard([group]);
          }}
          onPickAll={() => {
            setOpenPickerGroups(null);
            openGroupsOnDashboard(normaGroups);
          }}
          onClose={() => setOpenPickerGroups(null)}
        />
      )}
    </div>
  );
}
