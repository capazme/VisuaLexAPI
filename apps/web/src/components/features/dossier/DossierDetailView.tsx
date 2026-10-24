import { useState, useMemo, useEffect, useCallback } from 'react';
import {
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
import { appStore, useAppStore } from '../../../store/useAppStore';
import { EmptyState } from '../../ui/EmptyState';
import type { Dossier, DossierItem, DossierKind } from '../../../types';
import {
  formatTimestampLong, computeNormaGroups, decisionCitationOf, encodeDossierShare, searchParamsFromNorma, shareableDossier, type NormaGroup,
} from './dossierUtils';
import { countsLine, dossierItemOrder, layoutDossier, type ActBlock } from './dossierLayout';
import { deleteDossierWithUndo } from './deleteDossierWithUndo';
import { showUndoToast } from '../../../hooks/useUndoableAction';
import { removeItemsWithUndo } from './removeItemsWithUndo';
import { DossierActBlock } from './DossierActBlock';
import { DossierNotesSection } from './DossierNotesSection';
import { DossierDecisionsSection } from './DossierDecisionsSection';
import { buildPdfBlocks, countMarksUnavailable, countUnavailable, loadDossierDecisions, loadDossierTexts, pdfCountsLine, writeDossierPdf } from './dossierPdf';
import { loadPdfMarks } from './dossierPdfMarks';
import { DossierPdfDialog, type DossierPdfOptions } from './DossierPdfDialog';
import { lastActTitle, resolveBlockUrn } from './useActDetails';
import { fetchActRubriche } from '../../../utils/actStructureCache';
import { MenuButton } from '../../ui/MenuButton';
import { DossierRecentlyRemoved } from './DossierRecentlyRemoved';
import { DossierTasksPanel } from '../planner/DossierTasksPanel';
import type { useTrash } from './useTrash';
import { EditDossierModal } from './EditDossierModal';
import { kindLabel } from './dossierKinds';
import { DossierForumActions } from './DossierForumActions';
import { MoveToDossierModal } from './MoveToDossierModal';
import { TreeNavigatorModal } from './TreeNavigatorModal';
import { OpenOnDashboardPicker } from './OpenOnDashboardPicker';
import { searchesIntoOnePractice } from './openInPractice';
import { AddNoteModal } from './AddNoteModal';
import { saveBlob } from '../../../utils/saveBlob';
import { dossierService, type DossierSnapshotApi } from '../../../services/dossierService';
import { tagLabel } from '../../../utils/tagLabel';
import { cn } from '../../../lib/utils';
import { PageFrame } from '../../layout/PageFrame';
import { sectionOfDossierKind } from '../../../features/sections/useSection';
import { FOCUS_RING } from '../studia/progress/tokens';
import { COLUMN_HEADING, COLUMN_SCROLLS, HEADER_BUTTON, HEADER_ICON_BUTTON, HEADER_PRIMARY } from './dossierStyles';
import { FIELD, ICON_BUTTON } from '../planner/plannerStyles';
import { CitedNormsContext, useCitedNorms } from './useCitedNorms';
import { CitedNormChoice } from './CitedNormChoice';

type ToastType = 'success' | 'error' | 'info';

interface Props {
  dossier: Dossier;
  onBack: () => void;
  showToast: (message: string, type?: ToastType) => void;
  /** The page's trash: this dossier's entries show at the bottom. */
  trash?: ReturnType<typeof useTrash>;
}

/** Above this many articles an import from the act's index waits for the notification's «Annulla» (K1a). */
const BULK_IMPORT_WAIT = 100;

export function DossierDetailView({ dossier, onBack, showToast, trash }: Props) {
  const {
    dossiers,
    updateDossier,
    toggleDossierPin,
    setDossierItemOrder,
    updateDossierItemStatus,
    moveToDossier,
    triggerSearch,
    triggerMultiSearch,
    addToDossier,
    addNoteToDossier,
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
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [openPickerGroups, setOpenPickerGroups] = useState<NormaGroup[] | null>(null);
  // The note being written: about the dossier (no article), or about one article.
  const [noteTarget, setNoteTarget] = useState<{ aboutItemId?: string; heading: string } | null>(null);
  const [snapshots, setSnapshots] = useState<DossierSnapshotApi[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);

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
    if (!q) return dossier.items;
    const matches = (item: DossierItem) => {
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
      // A decision is found by its citation as the page shows it (source convention, Q9).
      if (item.type === 'sentenza') return decisionCitationOf(item.data).toLowerCase().includes(q);
      return typeof item.data === 'string' && item.data.toLowerCase().includes(q);
    };
    // An article and the notes about it are found together: a note found keeps
    // its article on screen, an article found keeps its notes.
    const found = new Set(dossier.items.filter(matches).map((i) => i.id));
    dossier.items.forEach((i) => {
      if (i.type === 'note' && i.aboutItemId && found.has(i.id)) found.add(i.aboutItemId);
    });
    dossier.items.forEach((i) => {
      if (i.type === 'note' && i.aboutItemId && found.has(i.aboutItemId)) found.add(i.id);
    });
    return dossier.items.filter((i) => found.has(i.id));
  }, [dossier.items, itemSearchQuery]);

  const hasFilter = itemSearchQuery.trim().length > 0;
  // The page's sections: notes first, then one block per act (spec §1-2).
  const layout = useMemo(() => layoutDossier(visibleItems), [visibleItems]);
  const fullLayout = useMemo(() => layoutDossier(dossier.items), [dossier.items]);
  const fullBlocks = useMemo(() => new Map(fullLayout.acts.map((a) => [a.key, a])), [fullLayout]);
  // What a screen reader hears while an act is dragged: its heading, never its key.
  const dragAnnouncements = useMemo(() => {
    const heading = (id: string | number) => fullBlocks.get(String(id))?.heading ?? '';
    return {
      onDragStart: ({ active }: { active: { id: string | number } }) => `Spostamento di ${heading(active.id)} iniziato.`,
      onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        over ? `${heading(active.id)} sopra ${heading(over.id)}.` : `${heading(active.id)} fuori dall'elenco degli atti.`,
      onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        over ? `${heading(active.id)} spostato al posto di ${heading(over.id)}.` : `${heading(active.id)} lasciato dov'era.`,
      onDragCancel: ({ active }: { active: { id: string | number } }) => `Spostamento di ${heading(active.id)} annullato.`,
    };
  }, [fullBlocks]);
  // What it holds, in one line, as the list's card says it (S7c).
  const dossierCounts = countsLine(dossier.items);
  const visibleArticleIds = useMemo(() => layout.acts.flatMap((a) => a.articles.map((i) => i.id)), [layout]);

  const toggleExpanded = (id: string) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // A norm a decision cites, when the dossier holds it, opens in the norms' column (D7d). Stable callbacks: the
  // context's value, and every decision's reader with it, changes only with the dossier.
  const unfoldAct = useCallback((key: string) => setFoldedActs((prev) => {
    if (!prev.has(key)) return prev;
    const next = new Set(prev);
    next.delete(key);
    return next;
  }), []);
  const expand = useCallback((id: string) => setExpandedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  const clearSearch = useCallback(() => setItemSearchQuery(''), []);
  const cited = useCitedNorms({ items: dossier.items, visibleItems, acts: fullLayout.acts, unfoldAct, expand, clearSearch });
  const toggleFolded = (key: string) => setFoldedActs((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // "Espandi tutto" opens every block and every article, a decision open staying open (D7a: never all the decisions,
  // each a request to its court's source); "Comprimi tutto" closes every row, the decisions too — the only thing it
  // offers in a dossier of decisions alone, once one is open.
  const visibleDecisionIds = layout.decisions.map((item) => item.id);
  const allExpanded = visibleArticleIds.length > 0
    ? visibleArticleIds.every((id) => expandedIds.has(id))
    : visibleDecisionIds.some((id) => expandedIds.has(id));
  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setFoldedActs(new Set());
      setExpandedIds((prev) => new Set([...prev, ...visibleArticleIds]));
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

  // The articles and the decisions on screen: notes carry no checkbox, so selecting "all" must not take them.
  const selectAllItems = () => {
    setSelectedItems(new Set([...visibleArticleIds, ...visibleDecisionIds]));
  };

  const clearSelection = () => setSelectedItems(new Set());

  // Removing goes to the trash for 30 days, with «Annulla» for 5 s (question 181); the page's trash is
  // read again so «Rimossi di recente» and «Cestino» count it.
  const trashChanged = trash ? () => void trash.reload() : undefined;

  const handleRemoveSingle = (item: DossierItem) => {
    removeItemsWithUndo(dossier.id, [item.id], 'Elemento rimosso', trashChanged);
  };

  // No confirmation: the entries go to the trash and the notification's «Annulla» puts them back (K1a).
  const deleteSelection = () => {
    if (selectedItems.size === 0) return;
    const ids = dossier.items.filter((i) => selectedItems.has(i.id)).map((i) => i.id);
    clearSelection();
    if (ids.length === 0) return;
    removeItemsWithUndo(dossier.id, ids, ids.length === 1 ? 'Elemento rimosso' : `${ids.length} elementi rimossi`, trashChanged);
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

  // Queue one search per norma-group (one act's, or the dossier's). The practice is created up front
  // and its id passed as `targetPracticeId`, so results never leak into a pre-existing practice with the
  // same label (gotcha 15). One practice holds them all, and `everyGroup` (the whole dossier opened)
  // brings its decisions too (spec §5.1, T17).
  const openGroupsOnDashboard = (groups: NormaGroup[], everyGroup = false) => {
    if (groups.length === 0) return;
    const paramsList = searchesIntoOnePractice(dossier, groups, everyGroup);
    navigate('/');
    triggerMultiSearch(paramsList);
  };

  const hasDecisions = fullLayout.decisions.length > 0;
  const handleOpenAllOnDashboard = () => {
    // Decisions alone (D7a): one practice holding them, no search to run.
    if (normaGroups.length === 0) {
      if (!hasDecisions) return;
      searchesIntoOnePractice(dossier, [], true);
      navigate('/');
      return;
    }
    if (normaGroups.length === 1) {
      openGroupsOnDashboard(normaGroups, true);
      return;
    }
    setOpenPickerGroups(normaGroups);
  };

  // All the act's articles, as one trash entry behind one undo toast.
  const handleRemoveAct = (block: ActBlock) => {
    const ids = block.articles.map((item) => item.id).filter((id) => dossier.items.some((i) => i.id === id));
    if (ids.length === 0) return;
    removeItemsWithUndo(dossier.id, ids, ids.length === 1 ? 'Articolo rimosso' : `${ids.length} articoli rimossi`, trashChanged);
  };

  const exportDossierJSON = () => {
    const data = JSON.stringify(shareableDossier(dossier), null, 2);
    saveBlob(new Blob([data], { type: 'application/json' }), `${dossier.title.replace(/[^a-z0-9]/gi, '_')}.json`);
  };

  const copyShareLink = async () => {
    let shareUrl: string;
    try {
      shareUrl = `${window.location.origin}/dossier?import=${encodeDossierShare(dossier)}`;
    } catch (e) {
      console.error('Failed to build share link:', e);
      showToast('Impossibile creare il link di condivisione di questo dossier. Puoi esportarlo in JSON.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link di condivisione copiato negli appunti', 'success');
    } catch {
      showToast('Impossibile copiare il link', 'error');
    }
  };

  // Every note of a dossier takes the notes route, the one Claude's notes take too.
  const handleAddNote = async (text: string): Promise<boolean> => {
    if (!noteTarget) return false;
    const saved = await addNoteToDossier(dossier.id, text, noteTarget.aboutItemId);
    if (saved) showToast(noteTarget.aboutItemId ? "Nota aggiunta all'articolo" : 'Nota aggiunta al dossier', 'success');
    return saved;
  };

  const handleTreeImport = (
    articles: { numero: string; urn?: string }[],
    normInfo: { tipo_atto: string; data: string; numero_atto: string },
  ) => {
    // Many articles at once («seleziona tutti» on a code is most often a slip, and floods the dossier): no question
    // first, but nothing written until the notification's time is out — «Annulla» leaves the dossier as it was (K1a).
    if (articles.length > BULK_IMPORT_WAIT) {
      // Nothing is written yet: leaving the page (or reloading it) would lose the import, so the browser asks first.
      // The notification's time stops while the tab is hidden, so the import waits for the user to come back.
      const warn = (event: BeforeUnloadEvent) => event.preventDefault();
      window.addEventListener('beforeunload', warn);
      void showUndoToast({ action: () => undefined, undo: () => {}, message: `${articles.length} articoli verranno importati nel dossier` }).then((stands) => {
        window.removeEventListener('beforeunload', warn);
        if (!stands) return;
        // The dossier deleted meanwhile (it is in the trash): nothing to write into.
        if (!appStore.getState().dossiers.some((d) => d.id === dossier.id)) {
          appStore.getState().pushSyncError(`Nessun articolo importato: il dossier «${dossier.title}» non c’è più.`);
          return;
        }
        importArticles(articles, normInfo);
      });
      return;
    }
    importArticles(articles, normInfo);
  };

  const importArticles = (
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
  // every text, fetched like the reader's (spec §9), then the chosen decisions. Titles come from the
  // session cache the act blocks already filled. `options` is what the export dialog asked for.
  const handleExportPdf = async ({ excerpts, decisionIds }: DossierPdfOptions) => {
    if (pdfProgress) return;
    setPdfProgress({ done: 0, total: 0 });
    try {
      const chosen = new Set(decisionIds);
      // Texts and decisions load side by side; one count covers both for the dialog.
      const counts = { texts: { done: 0, total: 0 }, decisions: { done: 0, total: 0 } };
      const report = () => setPdfProgress({
        done: counts.texts.done + counts.decisions.done,
        total: counts.texts.total + counts.decisions.total,
      });
      const [texts, decisions, marks] = await Promise.all([
        loadDossierTexts(dossier.items, (done, total) => { counts.texts = { done, total }; report(); }),
        loadDossierDecisions(dossier.items, chosen, (done, total) => { counts.decisions = { done, total }; report(); }),
        loadPdfMarks(dossier.items, { articles: excerpts, decisionIds: chosen }),
      ]);
      const titles = new Map<string, string | null>();
      await Promise.all(fullLayout.acts.map(async (block) => {
        if (block.isCode) return;
        // The same act as the block on screen, resolved when no item has a URN.
        const answer = await resolveBlockUrn(block)
          .then((urn) => fetchActRubriche(urn))
          .catch((err: unknown) => {
            console.error('PDF: act title unavailable for', block.heading, err);
            return null;
          });
        // A source that fails now keeps the title the block shows.
        titles.set(block.key, answer?.title?.trim() || lastActTitle(block.key));
      }));
      const blocks = buildPdfBlocks(dossier.items, texts, titles, { excerpts, marks, decisions });

      const doc = await writeDossierPdf(
        { title: dossier.title, description: dossier.description, tags: dossier.tags, countsLine: pdfCountsLine(dossier.items, chosen), exportedOn: new Date().toLocaleDateString('it-IT') },
        blocks,
      );
      doc.save(`${dossier.title.replace(/[^a-z0-9]/gi, '_')}.pdf`);
      setPdfDialogOpen(false);
      const missing = countUnavailable(blocks);
      const unmarked = countMarksUnavailable(blocks);
      const gaps = [
        ...(missing > 0 ? [missing === 1 ? '1 testo non disponibile' : `${missing} testi non disponibili`] : []),
        ...(unmarked > 0 ? [unmarked === 1 ? 'evidenziazioni e note di 1 testo non disponibili' : `evidenziazioni e note di ${unmarked} testi non disponibili`] : []),
      ];
      if (gaps.length > 0) showToast(`PDF salvato: ${gaps.join('; ')}`, 'info');
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

  const handleUpdateDossier = (title: string, description: string, tags: string[], kind: DossierKind) => {
    if (editingDossier) {
      updateDossier(editingDossier.id, { title, description, tags, kind });
    }
  };

  const hasNormaItems = dossier.items.some((i) => i.type === 'norma');
  const twoColumns = layout.acts.length > 0 && layout.decisions.length > 0;

  // The acts, in the order dragged; the decisions, in stored order (D7a: each column its own).
  const actsList = (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleActDragEnd}
      accessibility={{
        announcements: dragAnnouncements,
        screenReaderInstructions: { draggable: "Per spostare l'atto premi Spazio, poi le frecce su e giù, e di nuovo Spazio per lasciarlo; Esc annulla." },
      }}
    >
      <SortableContext items={layout.acts.map((a) => a.key)} strategy={verticalListSortingStrategy}>
        <div className="space-y-3">
          {layout.acts.map((block) => (
            <DossierActBlock
              key={block.key}
              block={block}
              // Under «Norme» when the decisions stand beside the acts.
              headingLevel={twoColumns ? 3 : 2}
              act={fullBlocks.get(block.key) ?? block}
              dragDisabled={hasFilter}
              isFolded={foldedActs.has(block.key)}
              onToggleFold={() => toggleFolded(block.key)}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpanded}
              selectedIds={selectedItems}
              showCheckbox={showBulkActions}
              onToggleSelect={toggleItemSelection}
              // The whole act, even while the search shows only some of its articles.
              onOpenAct={() => openGroupsOnDashboard((fullBlocks.get(block.key) ?? block).groups)}
              onAddArticles={() => setTreeNavigatorAct({
                tipo_atto: block.articles[0].data.tipo_atto,
                numero_atto: block.articles[0].data.numero_atto || '',
                data: block.articles[0].data.data || '',
              })}
              onRemoveAct={() => handleRemoveAct(fullBlocks.get(block.key) ?? block)}
              onOpenItem={openItemOnDashboard}
              onRemoveItem={handleRemoveSingle}
              onToggleImportant={(item) => updateDossierItemStatus(dossier.id, item.id, item.status === 'important' ? 'unread' : 'important')}
              showToast={showToast}
              attachedNotes={layout.attached}
              onAddNote={(item) => setNoteTarget({
                aboutItemId: item.id,
                heading: `Nota su ${item.citation ?? (item.type === 'norma' ? `art. ${item.data.numero_articolo}` : 'questo articolo')}`,
              })}
              onRemoveNote={handleRemoveSingle}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
  const decisionsList = (
    <DossierDecisionsSection
      decisions={layout.decisions}
      expandedIds={expandedIds}
      onToggleExpand={toggleExpanded}
      selectedIds={selectedItems}
      showCheckbox={showBulkActions}
      onToggleSelect={toggleItemSelection}
      onRemove={handleRemoveSingle}
      onToggleImportant={(item) => updateDossierItemStatus(dossier.id, item.id, item.status === 'important' ? 'unread' : 'important')}
    />
  );

  // The header's actions in one row (D3), each 44 px as the planner's controls (S7c). A label never wraps inside its
  // button (D3b): when the window is narrow the row wraps, as a row. Only on the buttons: their menus wrap their items.
  const rowPrimary = cn(HEADER_PRIMARY, 'whitespace-nowrap');
  const rowButton = cn(HEADER_BUTTON, 'whitespace-nowrap');
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleOpenAllOnDashboard}
        disabled={!hasNormaItems && !hasDecisions}
        className={rowPrimary}
      >
        <ExternalLink size={16} aria-hidden />
        <span>Apri tutto<span className="hidden sm:inline"> su Dashboard</span></span>
      </button>
      <MenuButton
        label="Aggiungi"
        align="left"
        triggerClassName={rowButton}
        items={[
          { label: 'Articoli da una norma', icon: TreeDeciduous, onSelect: () => setTreeNavigatorAct(null) },
          { label: 'Nota', icon: StickyNote, onSelect: () => setNoteTarget({ heading: 'Aggiungi una nota al dossier' }) },
          { label: 'Cerca un articolo', icon: Search, onSelect: () => navigate('/') },
        ]}
      >
        <Plus size={16} aria-hidden />
        <span className="hidden sm:inline">Aggiungi</span>
      </MenuButton>
      <MenuButton
        label="Esporta"
        align="left"
        triggerClassName={rowButton}
        items={[
          { label: 'PDF', icon: Download, onSelect: () => setPdfDialogOpen(true), disabled: !!pdfProgress },
          { label: 'Copia link di condivisione', icon: Share2, onSelect: () => void copyShareLink() },
          { label: 'JSON', icon: FileJson, onSelect: exportDossierJSON },
          { label: snapshotBusy ? 'Salvo lo snapshot…' : 'Salva snapshot', icon: History, onSelect: () => void handleCreateSnapshot(), disabled: snapshotBusy },
        ]}
      >
        <Download size={16} aria-hidden />
        <span className="hidden sm:inline">Esporta</span>
      </MenuButton>
      <DossierForumActions dossier={dossier} showToast={showToast} buttonClassName={rowButton} />
      <MenuButton
        label="Altre azioni"
        triggerClassName={HEADER_ICON_BUTTON}
        items={[
          { label: 'Modifica', icon: Edit2, onSelect: () => setEditingDossier(dossier) },
          { label: dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti', icon: Star, onSelect: () => toggleDossierPin(dossier.id) },
          { label: showBulkActions ? 'Annulla selezione' : 'Seleziona elementi', icon: CheckSquare, onSelect: () => { setShowBulkActions((v) => !v); clearSelection(); } },
          { label: 'Elimina dossier', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => {
            // No confirmation: the dossier goes to the trash and the notification's «Annulla» restores it (K1a).
            deleteDossierWithUndo(dossier, trashChanged);
            onBack();
          } },
        ]}
      >
        <MoreHorizontal size={18} />
      </MenuButton>
    </div>
  );

  return (
    <div className="animate-in slide-in-from-right-10 duration-200">
      {/* The way back, one control at every width (S7c), over the frame. */}
      <button
        type="button"
        onClick={onBack}
        className={cn('-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100', FOCUS_RING)}
      >
        <ArrowLeft size={18} aria-hidden /> Torna ai Dossier
      </button>

      {/* In the sections' frame (W2, S7c): the dossier's name as the title, in the reader's serif and with no icon,
          wrapping at the column's width; its section's phrase over it; the description under it; then the tags, the
          line of the facts, and the actions as one row under them, at every width — beside it, a long name was
          squeezed into a narrow column (seen at 1366 px). */}
      <PageFrame
        // A name of one long word (a file's, an address) wraps too, as a task's title does: never a page wider than a phone.
        title={<span className="[overflow-wrap:anywhere]">{dossier.title}</span>}
        kicker={sectionOfDossierKind(dossier.kind)}
        line={dossier.description || undefined}
      >
        <div>
        <div className="-mt-3 mb-6 space-y-2 border-b border-slate-200 pb-4 dark:border-slate-800">
          {dossier.tags && dossier.tags.length > 0 && (
            <ul aria-label="Etichette" className="flex flex-wrap gap-1.5">
              {dossier.tags.map((tag) => (
                <li key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {tagLabel(tag)}
                </li>
              ))}
            </ul>
          )}
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600 dark:text-slate-400">
            {dossier.isPinned && (
              <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300">
                <Star size={14} aria-hidden className="fill-current" /> Tra i preferiti
                <span aria-hidden className="text-slate-400">·</span>
              </span>
            )}
            <span>{kindLabel(dossier.kind)} · creato il {formatTimestampLong(dossier.createdAt)} · {dossierCounts}{snapshots.length > 0 ? ` · ${snapshots.length} snapshot` : ''}</span>
            {dossier.sourceSuggestionId && <AttributionChip author={dossier.originalAuthor} />}
          </p>
          <div className="pt-2">{actions}</div>
        </div>

        {/* The dossier's tasks (the planner, wave 1), before its entries. */}
        <DossierTasksPanel dossierId={dossier.id} />

        {dossier.items.length > 0 && (
          <div className="mb-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
              <input
                type="text"
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                placeholder="Cerca in questo dossier..."
                aria-label="Cerca negli elementi del dossier"
                className={cn(FIELD, 'pl-9 pr-11')}
              />
              {itemSearchQuery && (
                <button
                  type="button"
                  onClick={() => setItemSearchQuery('')}
                  aria-label="Azzera ricerca"
                  className={cn(ICON_BUTTON, 'absolute right-0 top-1/2 -translate-y-1/2')}
                >
                  <X size={16} aria-hidden />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={toggleExpandAll}
              // Decisions alone: nothing to open, only open ones to close.
              disabled={visibleArticleIds.length === 0 && !allExpanded}
              className={cn(HEADER_BUTTON, 'justify-center whitespace-nowrap disabled:opacity-40')}
              aria-pressed={allExpanded}
            >
              {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              {allExpanded ? 'Comprimi tutto' : 'Espandi tutto'}
            </button>
          </div>
        )}

        {showBulkActions && dossier.items.length > 0 && (
          <div className="mb-4 flex flex-col items-stretch gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={selectAllItems} className={cn('min-h-[44px] rounded px-2 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300', FOCUS_RING)}>
                Seleziona tutti
              </button>
              <span className="text-sm text-slate-600 dark:text-slate-400">{selectedItems.size} selezionati</span>
              <button
                onClick={() => { setShowBulkActions(false); clearSelection(); }}
                className={cn('min-h-[44px] rounded px-2 text-sm text-slate-700 hover:underline dark:text-slate-300', FOCUS_RING)}
              >
                Annulla selezione
              </button>
            </div>
            {selectedItems.size > 0 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setMoveToModalOpen(true)} className={cn(HEADER_BUTTON, 'flex-1 justify-center md:flex-none')}>
                  <FolderInput size={16} />
                  <span className="md:inline">Sposta</span>
                </button>
                <button onClick={deleteSelection} className={cn('inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg bg-red-50 px-3 text-sm font-medium text-red-700 hover:bg-red-100 md:flex-none dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60', FOCUS_RING)}>
                  <Trash2 size={16} />
                  <span className="md:inline">Elimina</span>
                </button>
              </div>
            )}
          </div>
        )}

        {hasFilter && layout.acts.length > 1 && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
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
                    <button onClick={() => navigate('/')} className={cn(HEADER_PRIMARY, 'justify-center')}>
                      <Search size={18} />
                      Cerca articoli
                    </button>
                    <button onClick={() => setTreeNavigatorAct(null)} className={cn(HEADER_BUTTON, 'justify-center')}>
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
                    className={cn(HEADER_BUTTON, 'justify-center')}
                  >
                    <X size={18} />
                    Azzera filtri
                  </button>
                }
              />
            </div>
          ) : (
            <>
              <DossierNotesSection notes={layout.notes} onRemove={handleRemoveSingle} />
              {/* Acts and decisions both (D7a): two columns from lg, «Norme» | «Giurisprudenza», a rule between them;
                  below lg the norms, then the decisions. One kind alone takes the width, untitled as before. The same
                  elements either way, only their classes changing, so a search that leaves one kind remounts nothing
                  (an open article keeps its text). From lg each column scrolls on its own, as tall as the window
                  (D7d): a decision stays where it is read while a norm it cites opens beside it, and the other way. */}
              <CitedNormsContext.Provider value={cited.citedNorms}>
                <div className={cn('flex flex-col gap-4', twoColumns && 'gap-6 lg:grid lg:grid-cols-2 lg:gap-0')}>
                  {/* Hidden, still mounted, while no act is on screen: no empty block and no gap over the decisions. */}
                  <section
                    ref={cited.columnRef}
                    aria-labelledby={twoColumns ? 'dossier-norms-heading' : undefined}
                    className={cn('min-w-0', twoColumns && cn('lg:pr-5', COLUMN_SCROLLS), layout.acts.length === 0 && 'hidden')}
                  >
                    {twoColumns && <h2 id="dossier-norms-heading" className={COLUMN_HEADING}>Norme</h2>}
                    {actsList}
                  </section>
                  <div className={cn('min-w-0 empty:hidden', twoColumns && cn('border-slate-200 lg:border-l lg:pl-5 dark:border-slate-800', COLUMN_SCROLLS))}>{decisionsList}</div>
                </div>
              </CitedNormsContext.Provider>
            </>
          )}
        </div>

        {trash && (
          <DossierRecentlyRemoved
            entries={(trash.entries ?? []).filter((e) => e.kind === 'DOSSIER_ITEMS' && e.dossierId === dossier.id)}
            dossiers={dossiers}
            onRestore={trash.restore}
            onPurge={trash.purge}
            showToast={showToast}
          />
        )}

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

        {cited.choice && (
          <CitedNormChoice
            key={cited.choice.link.dataset.cacheKey ?? cited.choice.citation.article}
            citation={cited.choice.citation}
            link={cited.choice.link}
            onClose={cited.closeChoice}
            onOpenOnDashboard={cited.openOnDashboard}
            showToast={showToast}
          />
        )}

        {noteTarget && (
          <AddNoteModal
            heading={noteTarget.heading}
            confirmLabel={noteTarget.aboutItemId ? "Aggiungi all'articolo" : 'Aggiungi al dossier'}
            onClose={() => setNoteTarget(null)}
            onSave={handleAddNote}
          />
        )}

        <DossierPdfDialog
          isOpen={pdfDialogOpen}
          onClose={() => setPdfDialogOpen(false)}
          decisions={fullLayout.decisions}
          progress={pdfProgress}
          onExport={(options) => void handleExportPdf(options)}
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
              openGroupsOnDashboard(normaGroups, true);
            }}
            onClose={() => setOpenPickerGroups(null)}
          />
        )}
        </div>
      </PageFrame>
    </div>
  );
}
