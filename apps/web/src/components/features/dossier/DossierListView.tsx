import { useState, useMemo, useEffect, useRef } from 'react';
import {
  FolderPlus,
  Search,
  Star,
  MoreHorizontal,
  Edit2,
  Trash2,
  ExternalLink,
  Upload,
  BookOpen,
  Plus,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { DossierModal } from '../../ui/DossierModal';
import { EmptyState } from '../../ui/EmptyState';
import { MenuButton } from '../../ui/MenuButton';
import {
  formatTimestampLong, computeNormaGroups, computeItemCounts, decisionCitationOf, importReport, importToastType, searchParamsFromGroup,
  tabLabelForGroup, validateImportedDossier, type ImportCheck, type NormaGroup,
} from './dossierUtils';
import { EditDossierModal } from './EditDossierModal';
import { ImportDossierModal } from './ImportDossierModal';
import { OpenOnDashboardPicker } from './OpenOnDashboardPicker';
import { searchesIntoOnePractice } from './openInPractice';
import type { Dossier, DossierKind } from '../../../types';
import { AttributionChip } from '../bulletin/AttributionChip';
import { useDossierKind } from '../../../features/sections/useSection';
import { kindLabel } from './dossierKinds';
import { actsSummary, countsParts, layoutDossier } from './dossierLayout';
import { ICON_BUTTON } from '../planner/plannerStyles';
import { HEADER_BUTTON, HEADER_PRIMARY } from './dossierStyles';
import { DossierMark } from './DossierMark';
import { FOCUS_RING } from '../studia/progress/tokens';
import { deleteDossierWithUndo } from './deleteDossierWithUndo';
import { hasTagCategory, tagCategories, tagLabel } from '../../../utils/tagLabel';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { DOSSIER_PAGE } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Props {
  onSelect: (dossierId: string) => void;
  showToast: (message: string, type?: ToastType) => void;
  /** Entries in the trash; the «Cestino» link shows only when there are some. */
  trashCount?: number;
  onOpenTrash?: () => void;
  /** The trash changed here (a dossier deleted or put back): read it again for its count. */
  onTrashChanged?: () => void;
}

type SortBy = 'date' | 'name' | 'items';

// The list's two menus (order, category): one look, 44 px on a phone, where they share a row half and half.
const LIST_MENU = 'flex-1 min-w-0 px-3 md:px-4 py-3 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

export function DossierListView({ onSelect, showToast, trashCount = 0, onOpenTrash, onTrashChanged }: Props) {
  const { dossiers, updateDossier, triggerSearch, triggerMultiSearch, importDossier } = useAppStore();
  const navigate = useNavigate();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // The category chosen in the menu: its key (the tag folded to lower case), one at a time.
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // The section's kind (sections spec S7): Opus lists the dossiers di lavoro, Gymnasium those di studio.
  const sectionKind = useDossierKind();
  // An option's text has no breakpoint: on a phone the half-width menu says «Tutte», which
  // «Tutte le categorie» did not fit beside the arrow at 390 px.
  const isDesktop = useIsDesktop();
  const [sortBy, setSortBy] = useState<SortBy>('date');

  const [editingDossier, setEditingDossier] = useState<Dossier | null>(null);
  const [openPickerGroups, setOpenPickerGroups] = useState<{ dossier: Dossier; groups: NormaGroup[] } | null>(null);
  const [importing, setImporting] = useState<ImportCheck | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The categories of the dossiers this section lists, so none of them filters to an empty list.
  const categories = useMemo(() => tagCategories(
    dossiers
      .filter((d) => !sectionKind || (d.kind ?? 'lavoro') === sectionKind)
      .flatMap((d) => d.tags ?? []),
  ), [dossiers, sectionKind]);
  // A category whose last dossier went (deleted, retagged, another section) is dropped, so the menu shows
  // «Tutte le categorie» and the filter does not come back on its own with the category.
  const selectedCategory = categories.find((c) => c.key === selectedTag) ?? null;
  if (selectedTag !== null && selectedCategory === null) setSelectedTag(null);

  const filteredDossiers = useMemo(() => {
    let result = [...dossiers];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((d) =>
        d.title.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.items.some((item) => {
          if (item.type === 'norma') {
            return item.data.tipo_atto?.toLowerCase().includes(q) ||
                   item.data.numero_articolo?.includes(q);
          }
          if (item.type === 'sentenza') return decisionCitationOf(item.data).toLowerCase().includes(q);
          return item.data?.toLowerCase?.().includes(q);
        })
      );
    }

    if (selectedCategory) {
      result = result.filter((d) => hasTagCategory(d.tags, selectedCategory));
    }

    if (sectionKind) {
      result = result.filter((d) => (d.kind ?? 'lavoro') === sectionKind);
    }

    result.sort((a, b) => {
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
  }, [dossiers, searchQuery, selectedCategory, sectionKind, sortBy]);

  // Open-on-dashboard: 0 norms → noop, 1 norm → direct, >1 → picker modal.
  const handleQuickOpen = (dossier: Dossier) => {
    const groups = computeNormaGroups(dossier.items);
    if (groups.length === 0) {
      showToast('Questo dossier non contiene articoli da aprire', 'info');
      return;
    }
    if (groups.length === 1) {
      // A dossier of one group is opened whole, its decisions too, as from its page (spec §5.1,
      // T17); the picker's single group below brings none.
      openAllGroupsOnDashboard(dossier, groups);
      return;
    }
    setOpenPickerGroups({ dossier, groups });
  };

  const openGroupOnDashboard = (dossier: Dossier, group: NormaGroup) => {
    // Pre-create the practice so we never merge into an orphan with the same label (gotcha 15): one
    // practice named after the dossier, active; one group picked brings no decision.
    const tabLabel = tabLabelForGroup(dossier.title, group);
    const tabId = appStore.getState().createPractice(dossier.title, { custom: true, activate: true });
    navigate('/');
    triggerSearch({ ...searchParamsFromGroup(group), tabLabel, targetPracticeId: tabId });
  };

  const openAllGroupsOnDashboard = (dossier: Dossier, groups: NormaGroup[]) => {
    if (groups.length === 0) return;
    // Create the practice up front and thread its id to the searches so SearchPanel's direct-merge
    // path writes every group into it: ONE practice for every group, and the dossier's decisions,
    // unread (T17).
    const paramsList = searchesIntoOnePractice(dossier, groups, true);
    navigate('/');
    triggerMultiSearch(paramsList);
  };

  const handleUpdateDossier = (title: string, description: string, tags: string[], kind: DossierKind) => {
    if (editingDossier) {
      updateDossier(editingDossier.id, { title, description, tags, kind });
      showToast('Dossier aggiornato', 'success');
    }
  };


  // JSON file import: opens the same preview modal used by share-link imports.
  const triggerFileImport = () => fileInputRef.current?.click();

  // Page-scoped keyboard shortcuts:
  //  n → open new-dossier modal
  //  / → focus the filter input
  //  i → trigger JSON file picker
  // Ignored while typing in a form field or when any overlay is open, so they
  // don't fire under modals where a stray keystroke would be confusing.
  useEffect(() => {
    const hasOverlay =
      isModalOpen ||
      editingDossier !== null ||
      importing !== null ||
      openPickerGroups !== null;

    const onKey = (e: KeyboardEvent) => {
      if (hasOverlay) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable
      );
      if (isTyping) return;

      if (e.key === 'n') {
        e.preventDefault();
        setIsModalOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'i') {
        e.preventDefault();
        triggerFileImport();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isModalOpen, editingDossier, importing, openPickerGroups]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be picked again
    if (!file) return;
    try {
      const text = await file.text();
      // A file is untrusted: its decision items are checked, and what cannot be imported is listed.
      const check = validateImportedDossier(JSON.parse(text));
      if (!check) {
        throw new Error('Struttura non riconosciuta');
      }
      setImporting(check);
    } catch (err) {
      console.error('JSON import failed:', err);
      showToast(`File JSON non valido${err instanceof Error && err.message ? `: ${err.message}` : ''}`, 'error');
    }
  };

  const handleConfirmJsonImport = async () => {
    if (!importing) return;
    const { dossier, discarded } = importing;
    setImporting(null);
    const outcome = await importDossier(dossier);
    if (!outcome) {
      showToast('Impossibile importare il dossier: errore server', 'error');
      return;
    }
    const lost = outcome.failed + discarded.length;
    showToast(importReport(outcome.imported, lost), importToastType(outcome.imported, lost));
    onSelect(outcome.id);
  };

  return (
    <PageFrame
      // The page's name (L-37), its section's phrase over it: the kind listed is the section's, Gymnasium's study
      // dossiers, Opus's work ones (every dossier with Gymnasium off).
      title={DOSSIER_PAGE}
      kicker={sectionKind === 'studio' ? 'gymnasium' : 'opus'}
      // The same element from one kind to the other: the switcher's focus lands on it for Opus and for Gymnasium.
      section={sectionKind === 'studio' ? 'gymnasium' : 'opus'}
      className="animate-in fade-in duration-200"
      // On a phone the title keeps its row with «⋯» (Importa, Cestino) and «+» beside it (M1); from md the three buttons.
      actionBeside={!isDesktop}
      action={isDesktop ? (
        <>
          {trashCount > 0 && onOpenTrash && (
            <button
              type="button"
              onClick={onOpenTrash}
              className="flex-1 md:flex-none bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-3 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <Trash2 size={18} aria-hidden /> Cestino ({trashCount})
            </button>
          )}
          <button
            onClick={triggerFileImport}
            className="flex-1 md:flex-none bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-3 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            title="Importa da file JSON (i)"
            aria-label="Importa dossier da file JSON"
            aria-keyshortcuts="i"
          >
            <Upload size={18} /> Importa
          </button>
          <button
            id="tour-dossier-create"
            onClick={() => setIsModalOpen(true)}
            className="flex-1 md:flex-none dossier-create-button bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            title="Nuovo Dossier (n)"
            aria-keyshortcuts="n"
          >
            <FolderPlus size={20} /> Nuovo Dossier
          </button>
        </>
      ) : (
        <>
          <MenuButton
            label="Altre azioni sui dossier"
            items={[
              { label: 'Importa da file JSON', icon: Upload, onSelect: triggerFileImport },
              ...(trashCount > 0 && onOpenTrash ? [{ label: `Cestino (${trashCount})`, icon: Trash2, onSelect: onOpenTrash }] : []),
            ]}
            triggerClassName="h-11 w-11 justify-center border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <MoreHorizontal size={20} aria-hidden />
          </MenuButton>
          <button
            id="tour-dossier-create"
            onClick={() => setIsModalOpen(true)}
            aria-label="Nuovo dossier"
            className="dossier-create-button inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <Plus size={22} aria-hidden />
          </button>
        </>
      )}
    >

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
      />

      {/* The search, then the two menus: one row on a computer; on a phone the search on its own row and the
          menus side by side under it, half each (D1). */}
      <div className="flex flex-col md:flex-row gap-3 md:gap-4">
        <div id="tour-dossier-search" className="relative flex-1 min-w-0 md:min-w-[14rem]">
          <Search size={18} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca nei dossier…"
            aria-label="Cerca nei dossier"
            aria-keyshortcuts="/"
            className="w-full pl-10 pr-4 py-3 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div className="flex gap-3 md:gap-4">
          <select
            id="tour-dossier-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Ordina i dossier"
            className={cn(LIST_MENU, 'md:flex-none')}
          >
            <option value="date">Ordina per data</option>
            <option value="name">Ordina per nome</option>
            <option value="items">Ordina per elementi</option>
          </select>
          {categories.length > 0 && (
            <select
              id="tour-dossier-filters"
              value={selectedCategory?.key ?? ''}
              onChange={(e) => setSelectedTag(e.target.value || null)}
              aria-label="Filtra per categoria"
              className={cn(LIST_MENU, 'md:flex-none md:max-w-[16rem]')}
            >
              <option value="">{isDesktop ? 'Tutte le categorie' : 'Tutte'}</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>{category.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {filteredDossiers.length === 0 ? (
          searchQuery || selectedCategory ? (
            <div className="col-span-full">
              <EmptyState variant="dossier" title="Nessun risultato" description="Prova a modificare i filtri di ricerca." />
            </div>
          ) : (
            // No dossier yet: an empty state composed for the page (S7c), as the empty Community's — line art in the
            // section's hue, what a dossier is for, and the two ways to begin.
            <section aria-labelledby="dossier-list-empty" className="col-span-full mx-auto flex w-full max-w-lg flex-col items-center px-2 py-10 text-center md:py-16">
              <DossierMark hue={sectionKind === 'studio' ? 'var(--vlx-section-gymnasium)' : 'var(--vlx-section-opus)'} />
              <h2 id="dossier-list-empty" className="mt-6 font-serif text-2xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
                {sectionKind ? `Nessun ${kindLabel(sectionKind).toLowerCase()}` : 'Nessun dossier creato'}
              </h2>
              <p className="mt-3 text-slate-700 dark:text-slate-300">
                Un dossier raccoglie le norme, le sentenze e le note di una pratica o di un tema di studio.
              </p>
              <p className="mt-2 text-slate-600 dark:text-slate-400">Crea il primo, o parti da un dossier di studio pronto.</p>
              <div className="mt-8 flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button type="button" onClick={() => setIsModalOpen(true)} className={cn(HEADER_PRIMARY, 'justify-center sm:whitespace-nowrap')}>
                  <FolderPlus size={18} aria-hidden />
                  Crea il tuo primo dossier
                </button>
                {/* The ready-made study dossiers sit in the Forum (spec 2026-10-13-environments-into-forum, D12). */}
                <button type="button" onClick={() => navigate('/forum')} className={cn(HEADER_BUTTON, 'justify-center sm:whitespace-nowrap')}>
                  <BookOpen size={18} aria-hidden />
                  Dossier di studio pronti
                </button>
              </div>
            </section>
          )
        ) : (
          filteredDossiers.map((dossier, idx) => {
            const hasNormaItems = dossier.items.some((i) => i.type === 'norma');
            const counts = computeItemCounts(dossier.items);
            // The acts it holds, named as the dossier names them (spec §10).
            const acts = actsSummary(layoutDossier(dossier.items));
            return (
              // A card (S7c): the name in the reader's serif and its two actions, the description, the acts it holds, what
              // it holds in one line, the date; 44 px controls, always there, as the planner's.
              <div
                key={dossier.id}
                id={idx === 0 ? 'tour-dossier-card' : undefined}
                role="button"
                tabIndex={0}
                aria-label={`Apri dossier ${dossier.title}`}
                onClick={() => onSelect(dossier.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(dossier.id);
                  }
                }}
                className={cn(
                  'dossier-card group relative flex cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-4 transition-[border-color,scale] hover:border-slate-400 active:scale-[0.98] md:p-5 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500',
                  FOCUS_RING,
                )}
              >
                <div className="flex items-start gap-2">
                  <h2 className="min-w-0 flex-1 break-words pt-2 font-serif text-lg font-medium leading-snug tracking-tight text-slate-900 line-clamp-2 md:text-xl dark:text-slate-50">
                    {dossier.title}
                  </h2>
                  <div id={idx === 0 ? 'tour-dossier-card-actions' : undefined} className="-mr-2 -mt-1 flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleQuickOpen(dossier); }}
                      disabled={!hasNormaItems}
                      title={hasNormaItems ? 'Apri su Dashboard' : 'Nessun articolo da aprire'}
                      aria-label={`Apri ${dossier.title} su Dashboard`}
                      className={cn(ICON_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent')}
                    >
                      <ExternalLink size={16} aria-hidden />
                    </button>
                    <MenuButton
                      label={`Azioni su ${dossier.title}`}
                      triggerClassName={ICON_BUTTON}
                      items={[
                        { label: 'Apri su Dashboard', icon: ExternalLink, onSelect: () => handleQuickOpen(dossier), disabled: !hasNormaItems },
                        { label: 'Rinomina / Modifica', icon: Edit2, onSelect: () => setEditingDossier(dossier) },
                        { label: 'Elimina', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => deleteDossierWithUndo(dossier, onTrashChanged) },
                      ]}
                    >
                      <MoreHorizontal size={18} />
                    </MenuButton>
                  </div>
                </div>
                {(dossier.isPinned || dossier.kind === 'studio' || dossier.published?.isActive || dossier.sourceSuggestionId) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {dossier.isPinned && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
                        <Star size={12} aria-hidden className="fill-current" /> Preferito
                      </span>
                    )}
                    {dossier.kind === 'studio' && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                        Di studio
                      </span>
                    )}
                    {dossier.published?.isActive && (
                      <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
                        Pubblicato nel Forum
                      </span>
                    )}
                    {dossier.sourceSuggestionId && <AttributionChip author={dossier.originalAuthor} />}
                  </div>
                )}
                {/* No placeholder for a missing description: an empty line says nothing (spec §5.3.3). */}
                {dossier.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{dossier.description}</p>
                )}
                {dossier.tags && dossier.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {dossier.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="max-w-[10rem] truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {tagLabel(tag)}
                      </span>
                    ))}
                    {dossier.tags.length > 3 && (
                      <span className="text-xs text-slate-600 dark:text-slate-400">+{dossier.tags.length - 3}</span>
                    )}
                  </div>
                )}
                {acts && <p className="mt-3 line-clamp-2 text-sm text-slate-800 dark:text-slate-200">{acts}</p>}
                {/* What it holds, in one line, and the date, at the card's foot. */}
                <div className="mt-auto pt-3">
                  <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600 dark:text-slate-400">
                    {countsParts(dossier.items).map((part, index) => (
                      <span key={part} className="whitespace-nowrap">
                        {index > 0 && <span aria-hidden>· </span>}
                        {part}
                      </span>
                    ))}
                    {counts.important > 0 && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-amber-800 dark:text-amber-300">
                        <span aria-hidden>·</span>
                        <Star size={12} aria-hidden className="fill-current" />
                        {counts.important}
                        <span className="sr-only">{counts.important === 1 ? ' importante' : ' importanti'}</span>
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Creato il {formatTimestampLong(dossier.createdAt)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <DossierModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {editingDossier && (
        <EditDossierModal
          dossier={editingDossier}
          onClose={() => setEditingDossier(null)}
          onSave={handleUpdateDossier}
        />
      )}

      {openPickerGroups && (
        <OpenOnDashboardPicker
          groups={openPickerGroups.groups}
          onPick={(group) => {
            const ctx = openPickerGroups;
            setOpenPickerGroups(null);
            openGroupOnDashboard(ctx.dossier, group);
          }}
          onPickAll={() => {
            const ctx = openPickerGroups;
            setOpenPickerGroups(null);
            openAllGroupsOnDashboard(ctx.dossier, ctx.groups);
          }}
          onClose={() => setOpenPickerGroups(null)}
        />
      )}

      {importing && (
        <ImportDossierModal
          dossier={importing.dossier}
          discarded={importing.discarded}
          onClose={() => setImporting(null)}
          onConfirm={handleConfirmJsonImport}
        />
      )}
    </PageFrame>
  );
}
