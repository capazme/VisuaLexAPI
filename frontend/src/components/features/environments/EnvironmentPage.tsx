import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Plus, Search, Download, Link2, Trash2, Play, RefreshCw,
  FileJson, Upload, X, Check, AlertTriangle, FolderOpen, Star,
  FileText, Pencil, MoreHorizontal
} from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import type { Environment, EnvironmentCategory } from '../../../types';
import {
  ENVIRONMENT_CATEGORIES,
  exportEnvironmentToFile,
  createEnvironmentShareLink,
  parseEnvironmentFromFile,
  parseEnvironmentFromBase64,
  getEnvironmentStats,
  canShareAsLink,
} from '../../../utils/environmentUtils';

export function EnvironmentPage() {
  const {
    environments,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    importEnvironment,
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle import from URL parameter
  useEffect(() => {
    const importData = searchParams.get('import');
    if (importData) {
      const result = parseEnvironmentFromBase64(importData);
      if (result.success) {
        setImportingEnv(result.data);
      } else {
        alert(result.error);
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
      alert(result.error);
    }
    e.target.value = '';
  };

  const handleConfirmImport = () => {
    if (importingEnv) {
      importEnvironment(importingEnv);
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
      alert('Link copiato negli appunti!');
    } else {
      alert('Ambiente troppo grande per condivisione via link. Usa l\'export JSON.');
    }
  };

  const handleApply = (env: Environment, mode: 'replace' | 'merge') => {
    applyEnvironment(env.id, mode);
    setApplyModalEnv(null);
  };

  const handleDelete = (id: string) => {
    deleteEnvironment(id);
    setDeleteConfirmId(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">I tuoi Ambienti</h2>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
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
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Nuovo Ambiente</span>
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Cerca negli ambienti..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as EnvironmentCategory | 'all')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">Tutte le categorie</option>
            {Object.entries(ENVIRONMENT_CATEGORIES).map(([key, { label, icon }]) => (
              <option key={key} value={key}>{icon} {label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Environment Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEnvironments.length === 0 ? (
          <div className="col-span-full text-center py-20">
            <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Globe size={40} className="text-gray-400" />
            </div>
            {searchQuery || categoryFilter !== 'all' ? (
              <>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Nessun risultato</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Prova a modificare i filtri di ricerca.</p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Nessun ambiente</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Crea il tuo primo ambiente per salvare dossier e ricerche frequenti.</p>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2 transition-colors"
                >
                  <Plus size={18} />
                  Crea Ambiente
                </button>
              </>
            )}
          </div>
        ) : (
          filteredEnvironments.map((env) => (
            <EnvironmentCard
              key={env.id}
              environment={env}
              onApply={() => setApplyModalEnv(env)}
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
        onCreate={(name, options) => {
          createEnvironment(name, options);
          setIsCreateModalOpen(false);
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
    </div>
  );
}

// ============ Sub-Components ============

interface EnvironmentCardProps {
  environment: Environment;
  onApply: () => void;
  onEdit: () => void;
  onExportJSON: () => void;
  onShareLink: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}

function EnvironmentCard({
  environment,
  onApply,
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
    <div className="dossier-card group bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition-colors overflow-hidden">
      {/* Category Banner */}
      {category && (
        <div
          className="h-1"
          style={{ backgroundColor: category.color }}
        />
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
              style={{ backgroundColor: `${category?.color || '#6B7280'}15` }}
            >
              {category?.icon || '📁'}
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white line-clamp-1">
                {environment.name}
              </h3>
              {category && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {category.label}
                </span>
              )}
            </div>
          </div>

          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal size={18} className="text-gray-500" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-20">
                  <button
                    onClick={() => { onEdit(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Pencil size={16} /> Modifica
                  </button>
                  <button
                    onClick={() => { onExportJSON(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Download size={16} /> Esporta JSON
                  </button>
                  {canShare && (
                    <button
                      onClick={() => { onShareLink(); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <Link2 size={16} /> Copia Link
                    </button>
                  )}
                  <button
                    onClick={() => { onRefresh(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <RefreshCw size={16} /> Aggiorna da stato corrente
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
            {environment.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-500 dark:text-gray-400">
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
          onClick={onApply}
          className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
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
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, options: { description?: string; category?: EnvironmentCategory; fromCurrent?: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<EnvironmentCategory>('other');
  const [fromCurrent, setFromCurrent] = useState(true);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), { description: description.trim() || undefined, category, fromCurrent });
    setName('');
    setDescription('');
    setCategory('other');
    setFromCurrent(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Nuovo Ambiente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="es. DPO Compliance"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrizione</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione opzionale..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {Object.entries(ENVIRONMENT_CATEGORIES).map(([key, { label, icon }]) => (
                <option key={key} value={key}>{icon} {label}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={fromCurrent}
              onChange={(e) => setFromCurrent(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900 dark:text-white text-sm">Includi stato corrente</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Copia dossier, preferiti e annotazioni attuali
              </p>
            </div>
          </label>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            Crea
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
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Modifica Ambiente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrizione</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EnvironmentCategory)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {Object.entries(ENVIRONMENT_CATEGORIES).map(([key, { label, icon }]) => (
                <option key={key} value={key}>{icon} {label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={() => onSave({ name, description: description || undefined, category })}
            disabled={!name.trim()}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
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
  onConfirm: () => void;
}) {
  const stats = getEnvironmentStats(environment);
  const category = environment.category ? ENVIRONMENT_CATEGORIES[environment.category] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <FileJson className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Importa Ambiente</h2>
              <p className="text-xs text-gray-500">Anteprima contenuto</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{category?.icon || '📁'}</span>
              <h3 className="font-medium text-gray-900 dark:text-white">{environment.name}</h3>
            </div>
            {environment.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{environment.description}</p>
            )}
            <div className="flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>{stats.dossiers} dossier</span>
              <span>{stats.quickNorms} preferiti</span>
              <span>{stats.annotations} annotazioni</span>
            </div>
          </div>

          {environment.author && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Autore: {environment.author}
            </p>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Check size={18} />
            Importa
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
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6"
      >
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          Applica "{environment.name}"
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Come vuoi applicare questo ambiente?
        </p>

        <div className="space-y-3">
          <button
            onClick={() => onApply(environment, 'merge')}
            className="w-full p-4 text-left bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-xl transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                <Plus className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <span className="font-medium text-gray-900 dark:text-white">Unisci</span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Aggiunge al contenuto esistente, salta duplicati
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onApply(environment, 'replace')}
            className="w-full p-4 text-left bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-xl transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <span className="font-medium text-gray-900 dark:text-white">Sostituisci</span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Sostituisce tutto il contenuto attuale
                </p>
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-4 py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        >
          Annulla
        </button>
      </motion.div>
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
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 text-center"
      >
        <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Elimina Ambiente?</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Questa azione non può essere annullata.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors"
          >
            Elimina
          </button>
        </div>
      </motion.div>
    </div>
  );
}
