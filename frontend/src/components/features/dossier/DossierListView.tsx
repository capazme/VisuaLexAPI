import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Folder,
  FolderPlus,
  ChevronRight,
  Search,
  Tag,
  Star,
  MoreHorizontal,
  Edit2,
  Trash2,
  ExternalLink,
  Upload,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { DossierModal } from '../../ui/DossierModal';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { EmptyState } from '../../ui/EmptyState';
import { formatTimestampLong, computeNormaGroups, computeStatusBreakdown, STATUS_CONFIG, type NormaGroup } from './dossierUtils';
import { EditDossierModal } from './EditDossierModal';
import { ImportDossierModal } from './ImportDossierModal';
import { OpenOnDashboardPicker } from './OpenOnDashboardPicker';
import type { Dossier } from '../../../types';

type ToastType = 'success' | 'error' | 'info';

interface Props {
  onSelect: (dossierId: string) => void;
  showToast: (message: string, type?: ToastType) => void;
}

type SortBy = 'date' | 'name' | 'items';

export function DossierListView({ onSelect, showToast }: Props) {
  const { dossiers, deleteDossier, updateDossier, triggerSearch, triggerMultiSearch, importDossier, addWorkspaceTab } = useAppStore();
  const navigate = useNavigate();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('date');

  // Per-card action menu. Stores dossier id of the menu that's currently open.
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const menuWrapperRef = useRef<HTMLDivElement>(null);
  const [editingDossier, setEditingDossier] = useState<Dossier | null>(null);
  const [deletingDossier, setDeletingDossier] = useState<Dossier | null>(null);
  const [openPickerGroups, setOpenPickerGroups] = useState<{ dossier: Dossier; groups: NormaGroup[] } | null>(null);
  const [importingDossier, setImportingDossier] = useState<Dossier | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeMenuId) return;
    const onDown = (e: MouseEvent) => {
      if (menuWrapperRef.current && !menuWrapperRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenuId(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [activeMenuId]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    dossiers.forEach((d) => d.tags?.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [dossiers]);

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
          return item.data?.toLowerCase?.().includes(q);
        })
      );
    }

    if (selectedTag) {
      result = result.filter((d) => d.tags?.includes(selectedTag));
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
  }, [dossiers, searchQuery, selectedTag, sortBy]);

  // Open-on-dashboard: 0 norms → noop, 1 norm → direct, >1 → picker modal.
  const handleQuickOpen = (dossier: Dossier) => {
    setActiveMenuId(null);
    const groups = computeNormaGroups(dossier.items);
    if (groups.length === 0) {
      showToast('Questo dossier non contiene articoli da aprire', 'info');
      return;
    }
    if (groups.length === 1) {
      openGroupOnDashboard(dossier, groups[0]);
      return;
    }
    setOpenPickerGroups({ dossier, groups });
  };

  const openGroupOnDashboard = (dossier: Dossier, group: NormaGroup) => {
    // Pre-create the tab so we never merge into an orphan with the same label
    // (workspaceTabs is persisted in localStorage — stale tabs can linger).
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

  const openAllGroupsOnDashboard = (dossier: Dossier, groups: NormaGroup[]) => {
    if (groups.length === 0) return;
    // Pre-create the empty dossier tab and thread its id to every search so
    // SearchPanel's direct-merge path writes them all into the same tab.
    const tabId = addWorkspaceTab(dossier.title, undefined, undefined, { isCustom: true });
    const paramsList = groups.map((g) => ({
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

  const handleUpdateDossier = (title: string, description: string, tags: string[]) => {
    if (editingDossier) {
      updateDossier(editingDossier.id, { title, description, tags });
      showToast('Dossier aggiornato', 'success');
    }
  };

  const handleConfirmDelete = () => {
    if (deletingDossier) {
      const title = deletingDossier.title;
      deleteDossier(deletingDossier.id);
      setDeletingDossier(null);
      showToast(`Dossier "${title}" eliminato`, 'success');
    }
  };

  // JSON file import: opens the same preview modal used by share-link imports.
  const triggerFileImport = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be picked again
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Dossier;
      if (!parsed || typeof parsed !== 'object' || !parsed.title || !Array.isArray(parsed.items)) {
        throw new Error('Struttura non riconosciuta');
      }
      setImportingDossier(parsed);
    } catch (err) {
      console.error('JSON import failed:', err);
      showToast(`File JSON non valido${err instanceof Error && err.message ? `: ${err.message}` : ''}`, 'error');
    }
  };

  const handleConfirmJsonImport = () => {
    if (importingDossier) {
      const newId = importDossier(importingDossier);
      setImportingDossier(null);
      showToast('Dossier importato', 'success');
      onSelect(newId);
    }
  };

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-6">
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">I tuoi Dossier</h2>
        <div className="flex gap-2">
          <button
            onClick={triggerFileImport}
            className="flex-1 md:flex-none bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-3 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title="Importa da file JSON"
            aria-label="Importa dossier da file JSON"
          >
            <Upload size={18} /> Importa
          </button>
          <button
            id="tour-dossier-create"
            onClick={() => setIsModalOpen(true)}
            className="flex-1 md:flex-none dossier-create-button bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <FolderPlus size={20} /> Nuovo Dossier
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
      />

      <div className="mb-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div id="tour-dossier-search" className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca nei dossier..."
              className="w-full pl-10 pr-4 py-3 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>
          <select
            id="tour-dossier-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="px-4 py-3 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="date">Ordina per data</option>
            <option value="name">Ordina per nome</option>
            <option value="items">Ordina per elementi</option>
          </select>
        </div>

        {allTags.length > 0 && (
          <div id="tour-dossier-filters" className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            <button
              onClick={() => setSelectedTag(null)}
              aria-pressed={!selectedTag}
              className={cn(
                'px-4 py-2 md:px-3 md:py-1 rounded-full text-sm transition-colors whitespace-nowrap min-h-[44px] md:min-h-0 flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                !selectedTag
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700',
              )}
            >
              Tutti
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                aria-pressed={selectedTag === tag}
                className={cn(
                  'px-4 py-2 md:px-3 md:py-1 rounded-full text-sm transition-colors flex items-center gap-1 whitespace-nowrap min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  selectedTag === tag
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700',
                )}
              >
                <Tag size={14} />
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {filteredDossiers.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              variant="dossier"
              title={searchQuery || selectedTag ? 'Nessun risultato' : 'Nessun dossier creato'}
              description={
                searchQuery || selectedTag
                  ? 'Prova a modificare i filtri di ricerca.'
                  : 'I dossier ti permettono di organizzare articoli per tema, progetto o caso. Crea il tuo primo dossier per iniziare.'
              }
              action={
                !(searchQuery || selectedTag) && (
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg inline-flex items-center gap-2 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    <FolderPlus size={18} />
                    Crea il tuo primo dossier
                  </button>
                )
              }
            />
          </div>
        ) : (
          filteredDossiers.map((dossier, idx) => {
            const isMenuOpen = activeMenuId === dossier.id;
            const hasNormaItems = dossier.items.some((i) => i.type === 'norma');
            const statusBreakdown = computeStatusBreakdown(dossier.items);
            return (
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
                className="dossier-card bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 md:p-5 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer group relative active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
              >
                <div className="flex justify-between items-start mb-3 md:mb-4 gap-2">
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Folder className="text-blue-500 group-hover:scale-110 transition-transform" size={28} />
                    {dossier.isPinned && (
                      <Star size={14} className="text-yellow-500 fill-yellow-500" aria-label="Preferito" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs px-2 py-1 rounded-full whitespace-nowrap">
                      {dossier.items.length} elementi
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleQuickOpen(dossier); }}
                      disabled={!hasNormaItems}
                      title={hasNormaItems ? 'Apri su Dashboard' : 'Nessun articolo da aprire'}
                      aria-label={`Apri ${dossier.title} su Dashboard`}
                      className={cn(
                        'p-1.5 rounded text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                        // Desktop: hover/focus-within reveal, mobile: always visible.
                        'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 max-md:opacity-100',
                        isMenuOpen && 'md:opacity-100',
                      )}
                    >
                      <ExternalLink size={16} />
                    </button>
                    <div
                      ref={isMenuOpen ? menuWrapperRef : undefined}
                      className="relative"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(isMenuOpen ? null : dossier.id);
                        }}
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        aria-label={`Azioni su ${dossier.title}`}
                        className={cn(
                          'p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                          isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 md:opacity-0',
                          // Mobile: always visible so it's tappable
                          'md:opacity-0 max-md:opacity-100',
                        )}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {isMenuOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => handleQuickOpen(dossier)}
                            className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700"
                          >
                            <ExternalLink size={16} className="text-indigo-500" />
                            Apri su Dashboard
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setActiveMenuId(null); setEditingDossier(dossier); }}
                            className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700"
                          >
                            <Edit2 size={16} className="text-slate-500" />
                            Rinomina / Modifica
                          </button>
                          <div className="border-t border-slate-200 dark:border-slate-700 my-1" aria-hidden />
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setActiveMenuId(null); setDeletingDossier(dossier); }}
                            className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 min-h-[44px] md:min-h-0 focus-visible:outline-none focus-visible:bg-red-50 dark:focus-visible:bg-red-900/20"
                          >
                            <Trash2 size={16} />
                            Elimina
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <h3 className="font-bold text-base md:text-lg text-slate-900 dark:text-white mb-1 group-hover:text-blue-600 transition-colors line-clamp-2">
                  {dossier.title}
                </h3>
                <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[2.5em]">
                  {dossier.description || 'Nessuna descrizione'}
                </p>
                {dossier.tags && dossier.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 md:mt-3">
                    {dossier.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded truncate max-w-[100px]">
                        {tag}
                      </span>
                    ))}
                    {dossier.tags.length > 3 && (
                      <span className="text-xs text-slate-400">+{dossier.tags.length - 3}</span>
                    )}
                  </div>
                )}
                {statusBreakdown.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 md:mt-3" aria-label="Riepilogo stati">
                    {statusBreakdown.map(({ status, count }) => {
                      const cfg = STATUS_CONFIG[status];
                      const Icon = cfg.icon;
                      return (
                        <span
                          key={status}
                          title={`${count} ${cfg.label.toLowerCase()}`}
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
                            cfg.bg, cfg.color,
                          )}
                        >
                          <Icon size={11} className="flex-shrink-0" />
                          {count}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
                  <span className="text-xs text-slate-400">{formatTimestampLong(dossier.createdAt)}</span>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all flex-shrink-0" />
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

      {deletingDossier && (
        <ConfirmDialog
          open
          variant="danger"
          title="Eliminare questo dossier?"
          message={`"${deletingDossier.title}" verrà rimosso. Gli articoli originali salvati nei segnalibri o in altri dossier non saranno toccati.`}
          confirmLabel="Elimina"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingDossier(null)}
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

      {importingDossier && (
        <ImportDossierModal
          dossier={importingDossier}
          onClose={() => setImportingDossier(null)}
          onConfirm={handleConfirmJsonImport}
        />
      )}
    </div>
  );
}
