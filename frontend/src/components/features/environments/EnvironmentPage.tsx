import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Download, Link2, Trash2, Play, RefreshCw,
  FileJson, Upload, X, Check, AlertTriangle, FolderOpen, Star,
  FileText, Pencil, MoreHorizontal, Sparkles
} from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { Environment, EnvironmentCategory } from '../../../types';
import {
  ENVIRONMENT_CATEGORIES,
  exportEnvironmentToFile,
  createEnvironmentShareLink,
  parseEnvironmentFromFile,
  parseEnvironmentFromBase64,
  getEnvironmentStats,
  canShareAsLink,
  createFullSelection,
  createEmptySelection,
  countSelectedItems,
  isAllSelected,
  type EnvironmentSelection,
} from '../../../utils/environmentUtils';
import { EnvironmentContentViewer } from './EnvironmentContentViewer';
import { exampleEnvironments } from '../../../data/exampleEnvironments';
import { useTour } from '../../../hooks/useTour';
import { Toast } from '../../ui/Toast';
import { EmptyState } from '../../ui/EmptyState';

export function EnvironmentPage() {
  const {
    environments,
    dossiers,
    quickNorms,
    customAliases,
    annotations,
    highlights,
    createEnvironment,
    createEnvironmentWithSelection,
    updateEnvironment,
    deleteEnvironment,
    importEnvironment,
    importEnvironmentPartial,
    applyEnvironment,
    refreshEnvironmentFromCurrent,
  } = useAppStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<EnvironmentCategory | 'all'>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [importingEnv, setImportingEnv] = useState<Environment | null>(null);
  const [applyModalEnv, setApplyModalEnv] = useState<Environment | null>(null);
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null);
  const [detailEnv, setDetailEnv] = useState<Environment | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { tryStartTour } = useTour();

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
  };

  // Start environments tour on first visit
  useEffect(() => {
    tryStartTour('environments');
  }, [tryStartTour]);

  // Handle import from URL parameter
  useEffect(() => {
    const importData = searchParams.get('import');
    if (importData) {
      const result = parseEnvironmentFromBase64(importData);
      if (result.success) {
        setImportingEnv(result.data);
      } else {
        showToast(result.error || 'Errore durante l\'import', 'error');
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Filter environments
  const filteredEnvironments = environments.filter(env => {
    const matchesSearch = !searchQuery ||
      env.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      env.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || env.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Handlers
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await parseEnvironmentFromFile(file);
    if (result.success) {
      setImportingEnv(result.data);
    } else {
      showToast(result.error || 'Errore durante la lettura del file', 'error');
    }
    e.target.value = '';
  };

  const handleConfirmImport = (selection: EnvironmentSelection, mode: 'merge' | 'replace') => {
    if (importingEnv) {
      importEnvironmentPartial(importingEnv, selection, mode);
      const modeText = mode === 'merge' ? 'unito' : 'importato';
      showToast(`Ambiente "${importingEnv.name}" ${modeText} con successo`, 'success');
      setImportingEnv(null);
    }
  };

  const handleExportJSON = (env: Environment) => {
    exportEnvironmentToFile(env);
  };

  const handleShareLink = async (env: Environment) => {
    const link = createEnvironmentShareLink(env);
    if (link) {
      await navigator.clipboard.writeText(link);
      showToast('Link copiato negli appunti', 'success');
    } else {
      showToast('Ambiente troppo grande per condivisione via link. Usa l\'export JSON.', 'error');
    }
  };

  const handleApply = (env: Environment, mode: 'replace' | 'merge') => {
    applyEnvironment(env.id, mode);
    const modeText = mode === 'merge' ? 'unito' : 'applicato';
    showToast(`Ambiente "${env.name}" ${modeText} con successo`, 'success');
    setApplyModalEnv(null);
  };

  const handleDelete = (id: string) => {
    deleteEnvironment(id);
    setDeleteConfirmId(null);
  };

  const handleLoadExamples = () => {
    let imported = 0;
    exampleEnvironments.forEach((env) => {
      // Check if an environment with same name already exists
      const exists = environments.some(e => e.name === env.name);
      if (!exists) {
        importEnvironment(env);
        imported++;
      }
    });
    if (imported > 0) {
      showToast(`${imported} ambienti di esempio caricati con successo`, 'success');
    } else {
      showToast('Tutti gli ambienti di esempio sono già presenti', 'info');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">I tuoi Ambienti</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={handleLoadExamples}
            className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 md:px-4 py-2.5 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors flex-1 sm:flex-none min-h-[44px]"
            title="Carica ambienti di esempio (GDPR, DORA, AI Act, Consumatori)"
          >
            <Sparkles size={18} />
            <span className="hidden sm:inline">Esempi</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 md:px-4 py-2.5 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors flex-1 sm:flex-none min-h-[44px]"
          >
            <Upload size={18} />
            <span className="hidden sm:inline">Importa</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            id="tour-env-create"
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 md:px-4 py-2.5 md:py-2 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm flex-1 sm:flex-none min-h-[44px]"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Nuovo Ambiente</span>
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="mb-6 space-y-3 md:space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:gap-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cerca negli ambienti..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>
          <select
            id="tour-env-categories"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as EnvironmentCategory | 'all')}
            className="px-4 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-[44px]"
          >
            <option value="all">Tutte le categorie</option>
            {Object.entries(ENVIRONMENT_CATEGORIES).map(([key, { label, icon }]) => (
              <option key={key} value={key}>{icon} {label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Environment Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {filteredEnvironments.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              variant="environment"
              title={searchQuery || categoryFilter !== 'all' ? "Nessun risultato" : "Nessun ambiente"}
              description={
                searchQuery || categoryFilter !== 'all'
                  ? "Prova a modificare i filtri di ricerca."
                  : "Gli ambienti ti permettono di salvare e condividere configurazioni di dossier, ricerche frequenti e annotazioni."
              }
              action={
                !(searchQuery || categoryFilter !== 'all') && (
                  <>
                    <button
                      onClick={handleLoadExamples}
                      className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-5 py-2.5 rounded-lg inline-flex items-center justify-center gap-2 transition-colors min-h-[44px]"
                    >
                      <Sparkles size={18} />
                      Carica Esempi
                    </button>
                    <button
                      onClick={() => setIsCreateModalOpen(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg inline-flex items-center justify-center gap-2 transition-colors min-h-[44px]"
                    >
                      <Plus size={18} />
                      Crea Ambiente
                    </button>
                  </>
                )
              }
            />
            {!(searchQuery || categoryFilter !== 'all') && (
              <p className="text-xs md:text-sm text-slate-400 dark:text-slate-500 text-center -mt-4">
                Gli esempi includono: GDPR, DORA, AI Act, Diritto dei Consumatori
              </p>
            )}
          </div>
        ) : (
          filteredEnvironments.map((env, idx) => (
            <EnvironmentCard
              key={env.id}
              environment={env}
              isFirst={idx === 0}
              onApply={() => setApplyModalEnv(env)}
              onViewDetail={() => setDetailEnv(env)}
              onEdit={() => setEditingEnv(env)}
              onExportJSON={() => handleExportJSON(env)}
              onShareLink={() => handleShareLink(env)}
              onRefresh={() => refreshEnvironmentFromCurrent(env.id)}
              onDelete={() => setDeleteConfirmId(env.id)}
            />
          ))
        )}
      </div>

      {/* Create Modal */}
      <CreateEnvironmentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        currentState={{ dossiers, quickNorms, customAliases, annotations, highlights }}
        onCreate={(name, selection, options) => {
          if (selection) {
            createEnvironmentWithSelection(name, selection, options);
          } else {
            createEnvironment(name, { ...options, fromCurrent: false });
          }
          setIsCreateModalOpen(false);
          showToast(`Ambiente "${name}" creato con successo`, 'success');
        }}
      />

      {/* Edit Modal */}
      {editingEnv && (
        <EditEnvironmentModal
          environment={editingEnv}
          onClose={() => setEditingEnv(null)}
          onSave={(updates) => {
            updateEnvironment(editingEnv.id, updates);
            setEditingEnv(null);
          }}
        />
      )}

      {/* Import Preview Modal */}
      {importingEnv && (
        <ImportPreviewModal
          environment={importingEnv}
          onClose={() => setImportingEnv(null)}
          onConfirm={handleConfirmImport}
        />
      )}

      {/* Apply Modal */}
      {applyModalEnv && (
        <ApplyEnvironmentModal
          environment={applyModalEnv}
          onClose={() => setApplyModalEnv(null)}
          onApply={handleApply}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <DeleteConfirmModal
          onClose={() => setDeleteConfirmId(null)}
          onConfirm={() => handleDelete(deleteConfirmId)}
        />
      )}

      {/* Detail Modal */}
      {detailEnv && (
        <EnvironmentDetailModal
          environment={detailEnv}
          onClose={() => setDetailEnv(null)}
          onApply={() => setApplyModalEnv(detailEnv)}
          onEdit={() => setEditingEnv(detailEnv)}
          onExportJSON={() => handleExportJSON(detailEnv)}
          onShareLink={() => handleShareLink(detailEnv)}
          onDelete={() => setDeleteConfirmId(detailEnv.id)}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <Toast
          message={toastMessage.text}
          type={toastMessage.type}
          isVisible={!!toastMessage}
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  );
}

// ============ Sub-Components ============

interface EnvironmentCardProps {
  environment: Environment;
  isFirst?: boolean;
  onApply: () => void;
  onViewDetail: () => void;
  onEdit: () => void;
  onExportJSON: () => void;
  onShareLink: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}

function EnvironmentCard({
  environment,
  isFirst,
  onApply,
  onViewDetail,
  onEdit,
  onExportJSON,
  onShareLink,
  onRefresh,
  onDelete,
}: EnvironmentCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const stats = getEnvironmentStats(environment);
  const category = environment.category ? ENVIRONMENT_CATEGORIES[environment.category] : null;
  const canShare = canShareAsLink(environment);

  return (
    <div
      id={isFirst ? 'tour-env-card' : undefined}
      className="dossier-card group bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition-colors overflow-hidden cursor-pointer"
      onClick={onViewDetail}
    >
      {/* Category Banner */}
      {category && (
        <div
          className="h-1"
          style={{ backgroundColor: category.color }}
        />
      )}

      <div className="p-4 md:p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
            <div
              className="w-10 h-10 md:w-10 md:h-10 flex-shrink-0 rounded-lg flex items-center justify-center text-base md:text-lg"
              style={{ backgroundColor: `${category?.color || '#6B7280'}15` }}
            >
              {category?.icon || '📁'}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm md:text-base text-slate-900 dark:text-white line-clamp-1">
                {environment.name}
              </h3>
              {category && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {category.label}
                </span>
              )}
            </div>
          </div>

          {/* Menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="p-2 md:p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md md:opacity-0 md:group-hover:opacity-100 transition-opacity min-h-[44px] md:min-h-0 flex items-center justify-center"
              aria-label="Menu azioni"
            >
              <MoreHorizontal size={18} className="text-slate-500" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 md:w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-20">
                  <button
                    onClick={() => { onEdit(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                  >
                    <Pencil size={16} /> Modifica
                  </button>
                  <button
                    onClick={() => { onExportJSON(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                  >
                    <Download size={16} /> Esporta JSON
                  </button>
                  {canShare && (
                    <button
                      onClick={() => { onShareLink(); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                    >
                      <Link2 size={16} /> Copia Link
                    </button>
                  )}
                  <button
                    onClick={() => { onRefresh(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                  >
                    <RefreshCw size={16} /> Aggiorna da stato corrente
                  </button>
                  <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-left"
                  >
                    <Trash2 size={16} /> Elimina
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {environment.description && (
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">
            {environment.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex flex-wrap gap-2 md:gap-3 mb-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <FolderOpen size={14} /> {stats.dossiers} dossier
          </span>
          <span className="flex items-center gap-1">
            <Star size={14} /> {stats.quickNorms} preferiti
          </span>
          {stats.annotations > 0 && (
            <span className="flex items-center gap-1">
              <FileText size={14} /> {stats.annotations} note
            </span>
          )}
        </div>

        {/* Apply Button */}
        <button
          id={isFirst ? 'tour-env-apply' : undefined}
          onClick={(e) => { e.stopPropagation(); onApply(); }}
          className="w-full flex items-center justify-center gap-2 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium min-h-[44px]"
        >
          <Play size={16} />
          Applica
        </button>
      </div>
    </div>
  );
}

// ============ Modal Components ============

function CreateEnvironmentModal({
  isOpen,
  onClose,
  onCreate,
  currentState,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, selection: EnvironmentSelection | null, options: { description?: string; author?: string; version?: string; category?: EnvironmentCategory }) => void;
  currentState: {
    dossiers: any[];
    quickNorms: any[];
    customAliases: any[];
    annotations: any[];
    highlights: any[];
  };
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [version, setVersion] = useState('');
  const [category, setCategory] = useState<EnvironmentCategory>('other');
  const [includeContent, setIncludeContent] = useState(true);

  // Create environment representation of current state
  const currentAsEnv = {
    dossiers: currentState.dossiers,
    quickNorms: currentState.quickNorms,
    customAliases: currentState.customAliases,
    annotations: currentState.annotations,
    highlights: currentState.highlights,
  };

  const [selection, setSelection] = useState<EnvironmentSelection>(() => createFullSelection(currentAsEnv));

  // Update selection when includeContent changes
  const toggleIncludeContent = (include: boolean) => {
    setIncludeContent(include);
    if (include) {
      setSelection(createFullSelection(currentAsEnv));
    } else {
      setSelection(createEmptySelection());
    }
  };

  if (!isOpen) return null;

  const selectedCount = countSelectedItems(selection);
  const allSelected = isAllSelected(currentAsEnv, selection);
  const hasContent = currentState.dossiers.length > 0 ||
    currentState.quickNorms.length > 0 ||
    currentState.customAliases.length > 0 ||
    currentState.annotations.length > 0 ||
    currentState.highlights.length > 0;

  const handleSubmit = () => {
    if (!name.trim()) return;
    const selectionToUse = includeContent && selectedCount > 0 ? selection : null;
    onCreate(name.trim(), selectionToUse, {
      description: description.trim() || undefined,
      author: author.trim() || undefined,
      version: version.trim() || undefined,
      category
    });
    setName('');
    setDescription('');
    setAuthor('');
    setVersion('');
    setCategory('other');
    setIncludeContent(true);
    setSelection(createFullSelection(currentAsEnv));
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelection(createEmptySelection());
    } else {
      setSelection(createFullSelection(currentAsEnv));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-white">Nuovo Ambiente</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="es. DPO Compliance"
                className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Autore</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="es. Mario Rossi"
                className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Versione</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="es. 1.0"
                className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrizione</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione opzionale..."
              rows={2}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
            >
              {Object.entries(ENVIRONMENT_CATEGORIES).map(([key, { label, icon }]) => (
                <option key={key} value={key}>{icon} {label}</option>
              ))}
            </select>
          </div>

          {/* Content Selection */}
          {hasContent && (
            <>
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={includeContent}
                    onChange={(e) => toggleIncludeContent(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Includi contenuto dallo stato corrente
                  </span>
                </label>

                {includeContent && (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer mb-3 ml-6">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        Seleziona tutto
                      </span>
                    </label>

                    <EnvironmentContentViewer
                      environment={currentAsEnv}
                      selectable
                      selection={selection}
                      onSelectionChange={setSelection}
                      maxHeight="200px"
                      compact
                    />
                  </>
                )}
              </div>
            </>
          )}

          {!hasContent && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Non hai ancora dossier, QuickNorms o annotazioni. L'ambiente verra' creato vuoto.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            Annulla
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed min-h-[44px]"
          >
            Crea {includeContent && selectedCount > 0 && `(${selectedCount} elementi)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditEnvironmentModal({
  environment,
  onClose,
  onSave,
}: {
  environment: Environment;
  onClose: () => void;
  onSave: (updates: Partial<Environment>) => void;
}) {
  const [name, setName] = useState(environment.name);
  const [description, setDescription] = useState(environment.description || '');
  const [category, setCategory] = useState<EnvironmentCategory>(environment.category || 'other');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-white">Modifica Ambiente</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrizione</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}
              className="w-full px-3 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
            >
              {Object.entries(ENVIRONMENT_CATEGORIES).map(([key, { label, icon }]) => (
                <option key={key} value={key}>{icon} {label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            Annulla
          </button>
          <button
            onClick={() => onSave({ name, description: description || undefined, category })}
            disabled={!name.trim()}
            className="flex-1 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors min-h-[44px]"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportPreviewModal({
  environment,
  onClose,
  onConfirm,
}: {
  environment: Environment;
  onClose: () => void;
  onConfirm: (selection: EnvironmentSelection, mode: 'merge' | 'replace') => void;
}) {
  const [selection, setSelection] = useState<EnvironmentSelection>(() => createFullSelection(environment));
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const category = environment.category ? ENVIRONMENT_CATEGORIES[environment.category] : null;
  const selectedCount = countSelectedItems(selection);
  const allSelected = isAllSelected(environment, selection);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelection(createEmptySelection());
    } else {
      setSelection(createFullSelection(environment));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileJson className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base md:text-lg font-semibold text-slate-900 dark:text-white">Importa Ambiente</h2>
              <p className="text-xs text-slate-500">Seleziona cosa importare</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center flex-shrink-0"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-4">
          {/* Environment Header */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base md:text-lg">{category?.icon || '📁'}</span>
              <h3 className="font-medium text-sm md:text-base text-slate-900 dark:text-white">{environment.name}</h3>
            </div>
            {environment.description && (
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-2">{environment.description}</p>
            )}
            {(environment.author || environment.version) && (
              <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                {environment.author && <span>Autore: {environment.author}</span>}
                {environment.version && <span>v{environment.version}</span>}
              </div>
            )}
          </div>

          {/* Select All Toggle */}
          <label className="flex items-center gap-2 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Seleziona tutto
            </span>
          </label>

          {/* Content Viewer with Selection */}
          <EnvironmentContentViewer
            environment={environment}
            selectable
            selection={selection}
            onSelectionChange={setSelection}
            maxHeight="250px"
          />

          {/* Import Mode */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
              Modalita' Import
            </label>
            <div className="flex gap-3">
              <label className={`
                flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                ${importMode === 'merge'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }
              `}>
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="w-4 h-4 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">Unisci</span>
                  <p className="text-xs text-slate-500">Aggiunge ai dati esistenti</p>
                </div>
              </label>

              <label className={`
                flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                ${importMode === 'replace'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }
              `}>
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="w-4 h-4 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">Sostituisci</span>
                  <p className="text-xs text-slate-500">Rimpiazza i dati attuali</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 md:py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            Annulla
          </button>
          <button
            onClick={() => onConfirm(selection, importMode)}
            disabled={selectedCount === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed min-h-[44px]"
          >
            <Check size={18} />
            Importa {selectedCount > 0 && `(${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApplyEnvironmentModal({
  environment,
  onClose,
  onApply,
}: {
  environment: Environment;
  onClose: () => void;
  onApply: (env: Environment, mode: 'replace' | 'merge') => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Applica "{environment.name}"
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Come vuoi applicare questo ambiente?
          </p>

          <button
            onClick={() => onApply(environment, 'merge')}
            className="w-full p-4 text-left bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                <Plus className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <span className="font-medium text-slate-900 dark:text-white">Unisci</span>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Aggiunge al contenuto esistente, salta duplicati
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onApply(environment, 'replace')}
            className="w-full p-4 text-left bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <span className="font-medium text-slate-900 dark:text-white">Sostituisci</span>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Sostituisce tutto il contenuto attuale
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 text-center">
        <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Elimina Ambiente?</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Questa azione non può essere annullata.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Elimina
          </button>
        </div>
      </div>
    </div>
  );
}

function EnvironmentDetailModal({
  environment,
  onClose,
  onApply,
  onEdit,
  onExportJSON,
  onShareLink,
  onDelete,
}: {
  environment: Environment;
  onClose: () => void;
  onApply: () => void;
  onEdit: () => void;
  onExportJSON: () => void;
  onShareLink: () => void;
  onDelete: () => void;
}) {
  const category = environment.category ? ENVIRONMENT_CATEGORIES[environment.category] : null;
  const canShare = canShareAsLink(environment);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="w-12 h-12 flex-shrink-0 rounded-lg flex items-center justify-center text-xl"
              style={{ backgroundColor: `${category?.color || '#6B7280'}15` }}
            >
              {category?.icon || '📁'}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white line-clamp-1">
                {environment.name}
              </h2>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                {category && <span>{category.label}</span>}
                {environment.author && <span>• {environment.author}</span>}
                {environment.version && <span>• v{environment.version}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center flex-shrink-0"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        {/* Description */}
        {environment.description && (
          <div className="px-4 md:px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {environment.description}
            </p>
          </div>
        )}

        {/* Content Viewer */}
        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          <EnvironmentContentViewer
            environment={environment}
            maxHeight="350px"
          />
        </div>

        {/* Actions */}
        <div className="px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => { onDelete(); onClose(); }}
                className="px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={16} />
                <span className="hidden sm:inline">Elimina</span>
              </button>
              <button
                onClick={() => { onEdit(); onClose(); }}
                className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Pencil size={16} />
                <span className="hidden sm:inline">Modifica</span>
              </button>
              <button
                onClick={onExportJSON}
                className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Download size={16} />
                <span className="hidden sm:inline">Esporta</span>
              </button>
              {canShare && (
                <button
                  onClick={onShareLink}
                  className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Link2 size={16} />
                  <span className="hidden sm:inline">Link</span>
                </button>
              )}
            </div>
            <button
              onClick={() => { onApply(); onClose(); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Play size={16} />
              Applica
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
