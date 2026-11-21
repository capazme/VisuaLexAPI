import { Fragment, useState, useMemo, useEffect, useRef } from 'react';
import {
  FolderPlus,
  Search,
  Star,
  MoreHorizontal,
  Edit2,
  Trash2,
  Upload,
  BookOpen,
  Plus,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { DossierModal } from '../../ui/DossierModal';
import { EmptyState } from '../../ui/EmptyState';
import { MenuButton } from '../../ui/MenuButton';
import {
  formatTimestampLong, computeItemCounts, decodeDossierShare, decisionCitationOf, validateImportedDossier,
} from './dossierUtils';
import { EditDossierPanel } from './EditDossierPanel';
import { ImportDossierPanel, type ImportRequest } from './ImportDossierPanel';
import type { Dossier, DossierKind } from '../../../types';
import { AttributionChip } from '../bulletin/AttributionChip';
import { sectionOfDossierKind, useDossierKind } from '../../../features/sections/useSection';
import { kindLabel } from './dossierKinds';
import { actsSummary, countsParts, layoutDossier } from './dossierLayout';
import { HEADER_ICON_BUTTON } from './dossierStyles';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { SegmentedTabs } from '../../ui/SegmentedTabs';
import { Card } from '../../ui/Card';
import { buttonClassName } from '../../ui/buttonStyles';
import { FOCUS_RING } from '../studia/progress/tokens';
import { DossierRows } from './DossierRows';
import { SORT_OPTIONS, DEFAULT_DIR, sortDossiers, readListPrefs, writeListPrefs, type ListMode, type ListPrefs, type SortKey, type SortDir } from './dossierSort';
import { deleteDossierWithUndo } from './deleteDossierWithUndo';
import { hasTagCategory, tagCategories, tagLabel } from '../../../utils/tagLabel';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { DOSSIER_PAGE } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { CARD_GRID_COLUMNS } from '../../layout/frame';
import { Illustration } from '../../ui/Illustration';
import { Arrive } from '../../ui/Arrive';
import { DossierListSkeleton } from '../../ui/Skeleton';

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

const VIEW_CHOICES: { id: ListMode; label: string }[] = [
  { id: 'schede', label: 'Schede' },
  { id: 'lista', label: 'Lista' },
];

export function DossierListView({ onSelect, showToast, trashCount = 0, onOpenTrash, onTrashChanged }: Props) {
  const { dossiers, updateDossier } = useAppStore();
  const isLoadingData = useAppStore((s) => s.isLoadingData);
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
  // The view and the order are remembered per browser (try/catch inside): the default is the cards, latest touched first.
  const [prefs, setPrefs] = useState<ListPrefs>(readListPrefs);
  const updatePrefs = (next: Partial<ListPrefs>) => setPrefs((p) => { const n = { ...p, ...next }; writeListPrefs(n); return n; });
  const { mode, sort: sortBy, dir: sortDir } = prefs;

  const [editingDossier, setEditingDossier] = useState<Dossier | null>(null);
  const [importing, setImporting] = useState<ImportRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // A share link's `?import=` opens the import at the top of the list (LC107): synced into state and the external
  // signal cleared in the same transaction (see CLAUDE.md gotcha #11).
  useEffect(() => {
    const importData = searchParams.get('import');
    if (!importData) return;
    try {
      const decoded = decodeDossierShare(decodeURIComponent(importData));
      // A share link is untrusted: its decision items are checked, and what cannot be imported is listed.
      const check = validateImportedDossier(JSON.parse(decoded));
      if (!check) throw new Error('not a dossier');
      setImporting({ ...check, fromLink: true });
    } catch (e) {
      console.error('Failed to parse import data:', e);
      showToast('Link di importazione non valido', 'error');
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, showToast]);

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

    result = sortDossiers(result, sortBy, sortDir);

    return result;
  }, [dossiers, searchQuery, selectedCategory, sectionKind, sortBy, sortDir]);

  const handleUpdateDossier = (title: string, description: string, tags: string[], kind: DossierKind) => {
    if (editingDossier) {
      updateDossier(editingDossier.id, { title, description, tags, kind });
      showToast('Pratica aggiornata', 'success');
    }
  };


  // JSON file import: opens the same preview as a share link's.
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
      importing !== null;

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
  }, [isModalOpen, editingDossier, importing]);

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

  return (
    <PageFrame
      // The page's name (L-37), its section's phrase over it: the kind listed is the section's, Gymnasium's study
      // dossiers, Opus's work ones (every dossier with Gymnasium off).
      title={DOSSIER_PAGE}
      kicker={sectionOfDossierKind(sectionKind)}
      // The same element from one kind to the other: the switcher's focus lands on it for Opus and for Gymnasium.
      section={sectionOfDossierKind(sectionKind)}
      // On a phone the title keeps its row with «⋯» (Importa, Cestino) and «+» beside it (M1); from md the three buttons.
      actionBeside={!isDesktop}
      action={isDesktop ? (
        <>
          {trashCount > 0 && onOpenTrash && (
            <Button type="button" variant="secondary" onClick={onOpenTrash} icon={<Trash2 size={16} aria-hidden />}>
              Cestino ({trashCount})
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={triggerFileImport}
            title="Importa da file JSON (i)"
            aria-label="Importa una pratica da file JSON"
            aria-keyshortcuts="i"
            icon={<Upload size={16} aria-hidden />}
          >
            Importa
          </Button>
          <Button
            id="tour-dossier-create"
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="dossier-create-button"
            title="Nuova pratica (n)"
            aria-keyshortcuts="n"
            icon={<FolderPlus size={16} aria-hidden />}
          >
            Nuova pratica
          </Button>
        </>
      ) : (
        <>
          <MenuButton
            label="Altre azioni sulle pratiche"
            items={[
              { label: 'Importa da file JSON', icon: Upload, onSelect: triggerFileImport },
              ...(trashCount > 0 && onOpenTrash ? [{ label: `Cestino (${trashCount})`, icon: Trash2, onSelect: onOpenTrash }] : []),
            ]}
            triggerClassName={HEADER_ICON_BUTTON}
          >
            <MoreHorizontal size={20} aria-hidden />
          </MenuButton>
          <IconButton
            id="tour-dossier-create"
            variant="primary"
            size="lg"
            onClick={() => setIsModalOpen(true)}
            aria-label="Nuova pratica"
            className="dossier-create-button"
            icon={<Plus aria-hidden />}
          />
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

      {/* «Modifica» and «Importa» open here, at the top of the list, in the page (LC107, L-73). */}
      <EditDossierPanel dossier={editingDossier} onClose={() => setEditingDossier(null)} onSave={handleUpdateDossier} />
      <ImportDossierPanel
        check={importing}
        onClose={() => setImporting(null)}
        onOpen={(id) => { setImporting(null); onSelect(id); }}
        showToast={showToast}
      />

      {/* The search, then the two menus: one row on a computer; on a phone the search on its own row and the
          menus side by side under it, half each (D1). */}
      <div className="flex flex-col md:flex-row gap-3 md:gap-4">
        <div id="tour-dossier-search" className="flex-1 min-w-0 md:min-w-[14rem]">
          <Input
            ref={searchInputRef}
            type="text"
            icon={<Search size={16} aria-hidden />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca nelle pratiche…"
            aria-label="Cerca nelle pratiche"
            aria-keyshortcuts="/"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:gap-4">
          <div className="min-w-[10rem] flex-1 md:max-w-[14rem] md:flex-none">
            <Select
              id="tour-dossier-sort"
              value={sortBy}
              onChange={(e) => { const key = e.target.value as SortKey; updatePrefs({ sort: key, dir: DEFAULT_DIR[key] }); }}
              aria-label="Ordina le pratiche"
            >
              {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </div>
          {categories.length > 0 && (
            <div className="min-w-[8rem] flex-1 md:max-w-[16rem] md:flex-none">
              <Select
                id="tour-dossier-filters"
                value={selectedCategory?.key ?? ''}
                onChange={(e) => setSelectedTag(e.target.value || null)}
                aria-label="Filtra per categoria"
              >
                <option value="">{isDesktop ? 'Tutte le categorie' : 'Tutte'}</option>
                {categories.map((category) => (
                  <option key={category.key} value={category.key}>{category.label}</option>
                ))}
              </Select>
            </div>
          )}
          <SegmentedTabs label="Vista delle pratiche" tabs={VIEW_CHOICES} value={mode} onChange={(m) => updatePrefs({ mode: m })} size="sm" className="shrink-0" />
        </div>
      </div>

      {/* A grid of cards of at least 20rem (U1 §7), as many as the frame holds: one on a phone, two at 768 px, three at
          1366 px with the sidebar, four at 1920, seven at 2560 in full screen. */}
      {/* Read again after «Riprova»: not empty yet, only not read. The cards' own grid held meanwhile, and their entrance
          (LC98, LC120). */}
      <Arrive
        loading={isLoadingData && filteredDossiers.length === 0 && !searchQuery && !selectedCategory}
        placeholder={<><p role="status" className="sr-only">Apro le pratiche…</p><DossierListSkeleton /></>}
      >
      {mode === 'lista' && filteredDossiers.length > 0 ? (
        <DossierRows
          dossiers={filteredDossiers}
          isDesktop={isDesktop}
          sort={sortBy}
          dir={sortDir}
          onSort={(key: SortKey, dir: SortDir) => updatePrefs({ sort: key, dir })}
          onSelect={onSelect}
          onEdit={setEditingDossier}
          onTrashChanged={onTrashChanged}
        />
      ) : (
      <div className={cn('grid gap-4 md:gap-6', CARD_GRID_COLUMNS)}>
        {filteredDossiers.length === 0 ? (
          searchQuery || selectedCategory ? (
            <div className="col-span-full">
              <EmptyState variant="dossier" title="Nessun risultato" description="Prova a modificare i filtri di ricerca." />
            </div>
          ) : (
            // No dossier yet (S7c): what a dossier is for and the two ways to begin; no drawing since LC21.
            <section aria-labelledby="dossier-list-empty" className="col-span-full mx-auto flex w-full max-w-lg flex-col items-center px-2 py-10 text-center md:py-16">
              {/* LC35: the empty folder, an engraving. */}
              <Illustration name="dossier-vuoti" className="mb-5 h-28 w-28" />
              <h2 id="dossier-list-empty" className="font-serif text-[22px] font-normal leading-tight text-slate-900 dark:text-slate-50">
                {sectionKind ? `Nessuna ${kindLabel(sectionKind).toLowerCase()}` : 'Nessuna pratica creata'}
              </h2>
              <p className="mt-3 text-slate-700 dark:text-slate-300">
                Qui compariranno le tue pratiche.
              </p>
              <div className="mt-8 flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button type="button" onClick={() => setIsModalOpen(true)} className="sm:whitespace-nowrap" icon={<FolderPlus size={16} aria-hidden />}>
                  Crea la tua prima pratica
                </Button>
                {/* The ready-made study dossiers sit in the Forum (spec 2026-10-13-environments-into-forum, D12), after the
                    community's dossiers since S7a: the address takes the reader to their strip. */}
                <Button type="button" variant="secondary" onClick={() => navigate('/forum#pronti')} className="sm:whitespace-nowrap" icon={<BookOpen size={16} aria-hidden />}>
                  Pronti da LexCraft
                </Button>
              </div>
            </section>
          )
        ) : (
          filteredDossiers.map((dossier, idx) => {
            const counts = computeItemCounts(dossier.items);
            // The acts it holds, named as the dossier names them (spec §10).
            const acts = actsSummary(layoutDossier(dossier.items));
            return (
              // A card (S7c): the name in the reader's serif and its two actions, the description, the acts it holds, what
              // it holds in one line, the date; 44 px controls, always there, as the planner's.
              <Card
                hover
                key={dossier.id}
                id={idx === 0 ? 'tour-dossier-card' : undefined}
                role="button"
                tabIndex={0}
                aria-label={`Apri la pratica ${dossier.title}`}
                onClick={() => onSelect(dossier.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(dossier.id);
                  }
                }}
                className={cn(
                  // `Card hover` (LC106): the box at 8 px, no shadow, the border darker and a lift of 1 px on a fine
                  // pointer, in `TRANSITION`'s time; the press brings it back down.
                  'dossier-card group relative flex flex-col p-4 active:scale-[0.98] motion-reduce:active:scale-100 md:p-5',
                  '[@media(hover:hover)_and_(pointer:fine)]:active:translate-y-0',
                  FOCUS_RING,
                )}
              >
                <div className="flex items-start gap-2">
                  <h2 className="min-w-0 flex-1 break-words pt-2 font-serif text-lg font-medium leading-snug tracking-tight text-slate-900 line-clamp-2 md:text-xl dark:text-slate-50">
                    {dossier.title}
                  </h2>
                  <div id={idx === 0 ? 'tour-dossier-card-actions' : undefined} className="-mr-2 -mt-1 flex shrink-0 items-center">
                    <MenuButton
                      label={`Azioni su ${dossier.title}`}
                      // `IconButton size="lg"`'s look: 44 px at every width, as the planner's.
                      triggerClassName={cn(buttonClassName('quiet', 'lg'), 'min-w-11 px-0')}
                      items={[
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
                  <p className="mt-2 line-clamp-2 break-words text-sm text-slate-600 dark:text-slate-400">{dossier.description}</p>
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
                      // «·» and its spaces are in the text, for a screen reader and a copy; the line's gap draws them.
                      <Fragment key={part}>
                        {index > 0 && ' · '}
                        <span className="whitespace-nowrap">{part}</span>
                      </Fragment>
                    ))}
                    {counts.important > 0 && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-amber-800 dark:text-amber-300">
                        {' · '}
                        <Star size={12} aria-hidden className="fill-current" />
                        {counts.important}
                        <span className="sr-only">{counts.important === 1 ? ' importante' : ' importanti'}</span>
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Creata il {formatTimestampLong(dossier.createdAt)}</p>
                </div>
              </Card>
            );
          })
        )}
      </div>
      )}
      </Arrive>

      <DossierModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </PageFrame>
  );
}
