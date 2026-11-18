import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { loadAssistantFeatures } from '../../../store/assistantProposals';
import { CurrentDossierContext } from './currentDossier';
import {
  Trash2,
  Download,
  Search,
  Edit2,
  Share2,
  FileJson,
  TreeDeciduous,
  Star,
  StickyNote,
  Plus,
  MoreHorizontal,
  History,
} from 'lucide-react';
import { AttributionChip } from '../bulletin/AttributionChip';
import { useNavigate } from 'react-router-dom';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { EmptyState } from '../../ui/EmptyState';
import type { Dossier, DossierItem, DossierKind } from '../../../types';
import {
  formatTimestampLong, encodeDossierShare, shareableDossier,
} from './dossierUtils';
import { countsLine, layoutDossier } from './dossierLayout';
import { deleteDossierWithUndo } from './deleteDossierWithUndo';
import { showUndoToast } from '../../../hooks/useUndoableAction';
import { removeItemsWithUndo } from './removeItemsWithUndo';
import { DossierNotesSection } from './DossierNotesSection';
import { buildPdfBlocks, countMarksUnavailable, countUnavailable, loadDossierDecisions, loadDossierTexts, pdfCountsLine, writeDossierPdf } from './dossierPdf';
import { loadPdfMarks } from './dossierPdfMarks';
import { DossierPdfDialog, type DossierPdfOptions } from './DossierPdfDialog';
import { lastActTitle, resolveBlockUrn } from './useActDetails';
import { fetchActRubriche } from '../../../utils/actStructureCache';
import { MenuButton } from '../../ui/MenuButton';
import { DossierRecentlyRemoved } from './DossierRecentlyRemoved';
import { DossierAttiPanel } from '../atti/DossierAttiPanel';
import { DossierReadingView } from './DossierReadingView';
import { FontiToolbar } from './FontiToolbar';
import { FontiToolsContext, matchesQuery, type FontiTools } from '../practice/fontiTools';
import { removeFromDossierAndTable } from '../practice/inDossier';
import { DossierTasksPanel } from '../planner/DossierTasksPanel';
import { DeadlineCard } from '../../../features/deadlines/DeadlineCard';
import { SegmentedTabs } from '../../ui/SegmentedTabs';
import { scrollParentOf } from '../practice/practiceView';

const VIEW_PANEL = 'dossier-view';
type DossierView = 'fonti' | 'atti' | 'compiti';
import type { useTrash } from './useTrash';
import { EditDossierModal } from './EditDossierModal';
import { kindLabel } from './dossierKinds';
import { DossierForumActions } from './DossierForumActions';
import { TreeNavigatorModal } from './TreeNavigatorModal';
import { AddNoteModal } from './AddNoteModal';
import { saveBlob } from '../../../utils/saveBlob';
import { dossierService, type DossierSnapshotApi } from '../../../services/dossierService';
import { tagLabel } from '../../../utils/tagLabel';
import { cn } from '../../../lib/utils';
import { PageFrame } from '../../layout/PageFrame';
import { sectionOfDossierKind } from '../../../features/sections/useSection';
import { HEADER_BUTTON, HEADER_ICON_BUTTON } from './dossierStyles';
import { Button } from '../../ui/Button';
import { BackLink } from '../../ui/BackLink';

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
    moveToDossier,
    addToDossier,
    addNoteToDossier,
  } = useAppStore();
  const navigate = useNavigate();

  // The view shown (LC21): the sources, or the dossier's tasks.
  // `?vista=atti`: the way back from an act lands on the dossier's acts.
  const viewTop = useRef<HTMLDivElement>(null);
  /** A new view starts under the tabs: scrolled past them, the scroller goes back to where they stick; above, it stays. */
  const chooseView = (next: DossierView) => {
    const mark = viewTop.current;
    const scroller = mark ? scrollParentOf(mark) : null;
    const stuckAt = mark && scroller ? mark.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : null;
    setView(next);
    if (scroller && stuckAt !== null && scroller.scrollTop > stuckAt) scroller.scrollTop = stuckAt;
  };
  // `?vista=atti` opens on the acts; `?vista=lettura` (LC54), the reading, is «Fonti» now (LC86).
  const [view, setView] = useState<DossierView>(() => (new URLSearchParams(window.location.search).get('vista') === 'atti' ? 'atti' : 'fonti'));
  const [attiCount, setAttiCount] = useState<number | null>(null);
  const [editingDossier, setEditingDossier] = useState<Dossier | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  // undefined = closed; null = open on a blank form; an act = open on that act's index.
  const [treeNavigatorAct, setTreeNavigatorAct] = useState<{ tipo_atto: string; numero_atto: string; data: string } | null | undefined>(undefined);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  // The note being written: about the dossier (no article), or about one article.
  const [noteTarget, setNoteTarget] = useState<{ aboutItemId?: string; heading: string } | null>(null);
  const [snapshots, setSnapshots] = useState<DossierSnapshotApi[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);

  // D7b: the flag again as the page mounts (it may have been switched since the app started); no polling.
  useEffect(() => { void loadAssistantFeatures(); }, []);

  // Hydrate the snapshot list, or the "• N snapshot" counter reads 0 after a
  // reload even when rows exist. Logged on failure, never hidden (gotcha 18).
  useEffect(() => {
    let cancelled = false;
    dossierService.getSnapshots(dossier.id)
      .then(list => { if (!cancelled) setSnapshots(list); })
      .catch(err => console.error('Failed to load dossier snapshots:', err));
    return () => { cancelled = true; };
  }, [dossier.id]);

  const fullLayout = useMemo(() => layoutDossier(dossier.items), [dossier.items]);
  // What it holds, in one line, as the list's card says it (S7c).
  const dossierCounts = countsLine(dossier.items);

  // «Fonti»'s filter and selection (LC88), handed to the reading's rows through `FontiToolsContext`.
  const query = itemSearchQuery.trim().toLowerCase();
  const shownNotes = useMemo(
    () => fullLayout.notes.filter((note) => matchesQuery(query, note.data)),
    [fullLayout.notes, query],
  );
  // One rule for every count (LC88): the dossier's entries, as the tab «Fonti» and the header count them; «N di M» is
  // the entries the filter shows of all of them. A row only on the table («Non nella pratica») counts for nothing.
  const [shownByGroup, setShownByGroup] = useState<Record<string, string[]>>({});
  const reportRows = useCallback((group: string, ids: string[]) => setShownByGroup((prev) => (
    (prev[group] ?? []).join('|') === ids.join('|') ? prev : { ...prev, [group]: ids }
  )), []);
  const shownRows = new Set([...Object.values(shownByGroup).flat(), ...shownNotes.map((n) => n.id)])
    .size;
  const totalRows = dossier.items.length;
  const clearFilter = useCallback(() => setItemSearchQuery(''), []);
  const filterRef = useRef<HTMLInputElement>(null);
  const toggleSelection = useCallback((ids: string[]) => setSelectedItems((prev) => {
    const next = new Set(prev);
    if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    return next;
  }), []);
  const fontiTools = useMemo<FontiTools>(() => ({
    query, selecting, selected: selectedItems, toggle: toggleSelection, report: reportRows, clear: clearFilter,
  }), [query, selecting, selectedItems, toggleSelection, reportRows, clearFilter]);
  // A gesture that reveals a row (a cited norm, a reference, the act's arrows or structure) must find it drawn: the
  // filter that would hide it is emptied, as the old list's search was.
  useEffect(() => appStore.subscribe((state, prev) => {
    const reveal = state.pendingReveal;
    if (!reveal || reveal === prev.pendingReveal) return;
    if (state.practices.some((p) => p.id === reveal.practiceId && p.dossierId === dossier.id)) setItemSearchQuery('');
  }), [dossier.id]);
  const stopSelecting = () => {
    setSelecting(false);
    setSelectedItems(new Set());
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
    // Their rows leave the table too once «Annulla» is out of time (LC88).
    removeFromDossierAndTable(dossier.id, ids, ids.length === 1 ? 'Elemento rimosso' : `${ids.length} elementi rimossi`, trashChanged);
  };

  const handleMoveToDossier = (targetDossierId: string) => {
    const ids = dossier.items.filter((i) => selectedItems.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    const target = dossiers.find((d) => d.id === targetDossierId);
    moveToDossier(dossier.id, targetDossierId, ids);
    clearSelection();
    showToast(`${ids.length === 1 ? '1 elemento spostato' : `${ids.length} elementi spostati`} in «${target?.title ?? "un'altra pratica"}»`, 'success');
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
      showToast('Impossibile creare il link di condivisione di questa pratica. Puoi esportarla in JSON.', 'error');
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
    if (saved) showToast(noteTarget.aboutItemId ? "Nota aggiunta all'articolo" : 'Nota aggiunta alla pratica', 'success');
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
      void showUndoToast({ action: () => undefined, undo: () => {}, message: `${articles.length} articoli verranno importati nella pratica` }).then((stands) => {
        window.removeEventListener('beforeunload', warn);
        if (!stands) return;
        // The dossier deleted meanwhile (it is in the trash): nothing to write into.
        if (!appStore.getState().dossiers.some((d) => d.id === dossier.id)) {
          appStore.getState().pushSyncError(`Nessun articolo importato: la pratica «${dossier.title}» non c’è più.`);
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
          ? '1 articolo importato nella pratica'
          : `${articles.length} articoli importati nella pratica`,
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
      showToast('Impossibile creare il PDF della pratica', 'error');
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
      showToast('Impossibile salvare lo snapshot della pratica', 'error');
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleUpdateDossier = (title: string, description: string, tags: string[], kind: DossierKind) => {
    if (editingDossier) {
      updateDossier(editingDossier.id, { title, description, tags, kind });
    }
  };

  // The header's actions in one row (D3), with `Button`'s heights (LC106). A label never wraps inside its
  // button (D3b): when the window is narrow the row wraps, as a row. Only on the buttons: their menus wrap their items.
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <MenuButton
        label="Aggiungi"
        align="left"
        triggerClassName={HEADER_BUTTON}
        items={[
          { label: 'Articoli da una norma', icon: TreeDeciduous, onSelect: () => setTreeNavigatorAct(null) },
          { label: 'Nota', icon: StickyNote, onSelect: () => setNoteTarget({ heading: 'Aggiungi una nota alla pratica' }) },
          { label: 'Cerca un articolo', icon: Search, onSelect: () => navigate('/') },
        ]}
      >
        <Plus size={16} aria-hidden />
        <span className="hidden sm:inline">Aggiungi</span>
      </MenuButton>
      <MenuButton
        label="Esporta"
        align="left"
        triggerClassName={HEADER_BUTTON}
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
      <DossierForumActions dossier={dossier} showToast={showToast} buttonClassName={HEADER_BUTTON} />
      <MenuButton
        label="Altre azioni"
        triggerClassName={HEADER_ICON_BUTTON}
        items={[
          { label: 'Modifica', icon: Edit2, onSelect: () => setEditingDossier(dossier) },
          { label: dossier.isPinned ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti', icon: Star, onSelect: () => toggleDossierPin(dossier.id) },
          { label: 'Elimina la pratica', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => {
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

  const emptyDossier = (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-[8px] border-2 border-dashed border-slate-200 dark:border-slate-700">
      <EmptyState
        variant="dossier"
        title="Pratica vuota"
        description="Aggiungi articoli dai risultati di ricerca o importa da una norma."
        action={
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button icon={<Search size={18} aria-hidden />} onClick={() => navigate('/')}>Cerca articoli</Button>
            <Button variant="secondary" icon={<TreeDeciduous size={18} aria-hidden />} onClick={() => setTreeNavigatorAct(null)}>
              Importa da norma
            </Button>
          </div>
        }
      />
    </div>
  );
  const recentlyRemoved = trash && (
    <DossierRecentlyRemoved
      entries={(trash.entries ?? []).filter((e) => e.kind === 'DOSSIER_ITEMS' && e.dossierId === dossier.id)}
      dossiers={dossiers}
      onRestore={trash.restore}
      onPurge={trash.purge}
      showToast={showToast}
    />
  );

  return (
    // The dossier its entries' readers ask the server about (D7b's proposals).
    <CurrentDossierContext.Provider value={dossier.id}>
    <div>
      {/* The way back (S7c), over the frame, below lg; from lg the top bar's path is the way back (LC21). No entrance: a
          page opened tens of times a day does not slide in. */}
      <BackLink onBack={onBack} className="mb-2 lg:hidden" />

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
            <span>{kindLabel(dossier.kind)} · creata il {formatTimestampLong(dossier.createdAt)} · {dossierCounts}{snapshots.length > 0 ? ` · ${snapshots.length} snapshot` : ''}</span>
            {dossier.sourceSuggestionId && <AttributionChip author={dossier.originalAuthor} />}
          </p>
          <div className="pt-2">{actions}</div>
        </div>

        {/* LC21: the dossier's views as tabs, as the prototype: «Fonti» (its norms, decisions and notes), «Atti» (Luca, 15-11) and «Compiti».
            Both stay mounted, the other hidden, so a selection or a task being written survives the switch. */}
        {/* LC27 (Luca, 15 Nov): the tabs stay at the top while the view scrolls, and a change of view starts the new
            one right under them, in place — no jump to the page's top, no scrolling to it. */}
        <div ref={viewTop} aria-hidden />
        {/* In «Fonti» the act's own head sticks at the top while reading (#529, Papiniano): the tabs scroll away there,
            or the two sticky heads overlap and the tabs vanish under it. */}
        <div className={cn('-mx-2 mb-6 bg-slate-50 px-2 py-2 dark:bg-slate-950', view !== 'fonti' && 'sticky top-0 z-10')}>
        <SegmentedTabs
          tabs={[
            { id: 'fonti', label: 'Fonti', extra: <span className="relative font-mono text-xs text-slate-500 dark:text-slate-400">{dossier.items.length}</span> },
            { id: 'atti', label: 'Atti', extra: attiCount === null ? undefined : <span className="relative font-mono text-xs text-slate-500 dark:text-slate-400">{attiCount}</span> },
            { id: 'compiti', label: 'Compiti' },
          ]}
          value={view}
          onChange={chooseView}
          label="Viste della pratica"
          panelId={VIEW_PANEL}
          className="w-fit max-w-full"
          // The tabs whole on a 390 px phone (LC54): less padding below `sm`.
          tabClassName="gap-1.5 px-2.5 sm:gap-2 sm:px-4"
        />
        </div>
        <div id={VIEW_PANEL} role="tabpanel" aria-labelledby={`${VIEW_PANEL}-tab-${view}`} className="min-h-[calc(100dvh-8rem)]">
        <div hidden={view !== 'compiti'}>
          {dossier.kind !== 'studio' && <DeadlineCard dossierId={dossier.id} />}
          <DossierTasksPanel dossierId={dossier.id} />
        </div>
        <div hidden={view !== 'atti'}>
          <DossierAttiPanel dossierId={dossier.id} onCount={setAttiCount} />
        </div>
        {/* «Fonti» (LC86): the reading — each act a block, each article a closed row that opens in place —, then the
            dossier's own notes, then what was removed lately. Kept mounted while another tab is shown: its open rows
            and its reading stay as they were. */}
        <div
          hidden={view !== 'fonti'}
          // Esc ends the selection, wherever the focus is in «Fonti», unless something in it took the key first.
          onKeyDown={(e) => { if (e.key === 'Escape' && selecting && !e.defaultPrevented) stopSelecting(); }}
        >
          {dossier.items.length === 0 ? emptyDossier : (
            <FontiToolsContext.Provider value={fontiTools}>
              <FontiToolbar
                dossierId={dossier.id}
                active={view === 'fonti'}
                query={itemSearchQuery}
                onQuery={setItemSearchQuery}
                shown={shownRows}
                total={totalRows}
                selecting={selecting}
                onSelecting={(on) => (on ? setSelecting(true) : stopSelecting())}
                selectedCount={dossier.items.filter((i) => selectedItems.has(i.id)).length}
                onMove={handleMoveToDossier}
                onRemove={deleteSelection}
                inputRef={filterRef}
              />
              <div className="space-y-6">
                <DossierReadingView dossier={dossier} showToast={showToast} onTrashChanged={trashChanged} />
                <DossierNotesSection notes={shownNotes} onRemove={handleRemoveSingle} />
              </div>
            </FontiToolsContext.Provider>
          )}
          {trash && recentlyRemoved}
        </div>
        </div>

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

        {noteTarget && (
          <AddNoteModal
            heading={noteTarget.heading}
            confirmLabel={noteTarget.aboutItemId ? "Aggiungi all'articolo" : 'Aggiungi alla pratica'}
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

        </div>
      </PageFrame>
    </div>
    </CurrentDossierContext.Provider>
  );
}
