import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Upload, Sparkles } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { Environment, EnvironmentCategory } from '../../../types';
import {
  ENVIRONMENT_CATEGORIES,
  exportEnvironmentToFile,
  createEnvironmentShareLink,
  parseEnvironmentFromFile,
  parseEnvironmentFromBase64,
  type EnvironmentSelection,
} from '../../../utils/environmentUtils';
import { exampleEnvironments } from '../../../data/exampleEnvironments';
import { useTour } from '../../../hooks/useTour';
import { Toast } from '../../ui/Toast';
import { EmptyState } from '../../ui/EmptyState';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { EnvironmentCard } from './EnvironmentCard';
import { CreateEnvironmentModal } from './CreateEnvironmentModal';
import { EditEnvironmentModal } from './EditEnvironmentModal';
import { ImportPreviewModal } from './ImportPreviewModal';
import { ApplyEnvironmentModal } from './ApplyEnvironmentModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { EnvironmentDetailModal } from './EnvironmentDetailModal';

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
  // Guard for replace-mode: it deletes existing dossiers server-side, which
  // is irreversible. Held here until the user confirms in a second step.
  const [replaceConfirm, setReplaceConfirm] = useState<Environment | null>(null);
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

  // Handle import from URL parameter. Reads `?import=` and immediately
  // clears it in the same effect, so the set-state-in-effect disable is
  // the same URL→state sync pattern used in DossierPage — see CLAUDE.md
  // gotcha #11.
  useEffect(() => {
    const importData = searchParams.get('import');
    if (importData) {
      const result = parseEnvironmentFromBase64(importData);
      if (result.success) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- URL→state sync: reads `?import=` and clears it below so the effect won't re-fire
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

  const handleConfirmImport = async (selection: EnvironmentSelection, mode: 'merge' | 'replace') => {
    if (!importingEnv) return;
    const snapshot = importingEnv;
    setImportingEnv(null);
    try {
      await importEnvironmentPartial(snapshot, selection, mode);
      const modeText = mode === 'merge' ? 'unito' : 'importato';
      showToast(`Ambiente "${snapshot.name}" ${modeText} con successo`, 'success');
    } catch (err) {
      console.error('importEnvironmentPartial failed:', err);
      showToast(`Errore durante l'import di "${snapshot.name}"`, 'error');
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

  const runApply = async (env: Environment, mode: 'replace' | 'merge') => {
    try {
      await applyEnvironment(env.id, mode);
      const modeText = mode === 'merge' ? 'unito' : 'applicato';
      showToast(`Ambiente "${env.name}" ${modeText} con successo`, 'success');
    } catch (err) {
      console.error('applyEnvironment failed:', err);
      showToast(`Errore durante l'applicazione di "${env.name}"`, 'error');
    }
  };

  const handleApply = (env: Environment, mode: 'replace' | 'merge') => {
    setApplyModalEnv(null);
    if (mode === 'replace') {
      // Route replace through a ConfirmDialog — the op deletes existing
      // dossiers server-side (irreversible).
      setReplaceConfirm(env);
      return;
    }
    void runApply(env, 'merge');
  };

  const handleDelete = async (id: string) => {
    setDeleteConfirmId(null);
    try {
      await deleteEnvironment(id);
    } catch (err) {
      console.error('deleteEnvironment failed:', err);
      showToast('Errore durante l\'eliminazione dell\'ambiente', 'error');
    }
  };

  const handleLoadExamples = async () => {
    // Each example maps to a createEnvironment round-trip — run them
    // sequentially so a run stays within sensible rate-limit territory
    // and the counter in the success toast matches what's actually on
    // the server.
    let imported = 0;
    for (const env of exampleEnvironments) {
      const exists = environments.some(e => e.name === env.name);
      if (exists) continue;
      const newId = await importEnvironment(env);
      if (newId) imported++;
    }
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
              onRefresh={async () => {
                try {
                  await refreshEnvironmentFromCurrent(env.id);
                  showToast(`"${env.name}" aggiornato con lo stato corrente`, 'success');
                } catch (err) {
                  console.error('refreshEnvironmentFromCurrent failed:', err);
                  showToast(`Errore durante l'aggiornamento di "${env.name}"`, 'error');
                }
              }}
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
        onCreate={async (name, selection, options) => {
          setIsCreateModalOpen(false);
          const newId = selection
            ? await createEnvironmentWithSelection(name, selection, options)
            : await createEnvironment(name, { ...options, fromCurrent: false });
          if (newId) {
            showToast(`Ambiente "${name}" creato con successo`, 'success');
          } else {
            showToast(`Errore durante la creazione di "${name}"`, 'error');
          }
        }}
      />

      {/* Edit Modal */}
      {editingEnv && (
        <EditEnvironmentModal
          environment={editingEnv}
          onClose={() => setEditingEnv(null)}
          onSave={async (updates) => {
            const envId = editingEnv.id;
            const envName = editingEnv.name;
            setEditingEnv(null);
            try {
              await updateEnvironment(envId, updates);
            } catch (err) {
              console.error('updateEnvironment failed:', err);
              showToast(`Errore durante l'aggiornamento di "${envName}"`, 'error');
            }
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

      {/* Replace-mode guard: delete of server-side dossiers is irreversible */}
      <ConfirmDialog
        open={replaceConfirm !== null}
        variant="danger"
        title={replaceConfirm ? `Sostituire tutto con "${replaceConfirm.name}"?` : ''}
        message="Tutti i tuoi dossier, annotazioni ed evidenziazioni attuali verranno eliminati definitivamente dal server prima di applicare l'ambiente. Questa azione non è reversibile."
        confirmLabel="Sì, sostituisci"
        onConfirm={() => {
          const env = replaceConfirm;
          setReplaceConfirm(null);
          if (env) void runApply(env, 'replace');
        }}
        onCancel={() => setReplaceConfirm(null)}
      />


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
