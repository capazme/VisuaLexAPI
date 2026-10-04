import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { useTour } from '../../../hooks/useTour';
import { Toast } from '../../ui/Toast';
import type { Dossier } from '../../../types';
import { DossierListView } from './DossierListView';
import { DossierDetailView } from './DossierDetailView';
import { ImportDossierModal } from './ImportDossierModal';
import { TrashPage } from './TrashPage';
import { useTrash } from './useTrash';

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

export function DossierPage() {
  const { dossiers, importDossier } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importingDossier, setImportingDossier] = useState<Dossier | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const { tryStartTour } = useTour();
  // One trash for the page: its count on the list, a dossier's own entries, the «Cestino».
  const trash = useTrash();

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  // selectedDossierId lives in the URL so browser back/forward restores the
  // list vs detail view naturally. `?dossier=<id>` opens detail, absent shows list.
  const selectedDossierId = searchParams.get('dossier');
  const setSelectedDossierId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('dossier', id);
    else next.delete('dossier');
    setSearchParams(next);
  };

  useEffect(() => {
    tryStartTour('dossier');
  }, [tryStartTour]);

  // Syncs URL param `?import=` into internal state AND clears the external
  // signal in the same transaction — the justified case for silencing
  // set-state-in-effect (see CLAUDE.md gotcha #11).
  useEffect(() => {
    const importData = searchParams.get('import');
    if (!importData) return;
    try {
      const decoded = atob(decodeURIComponent(importData));
      const dossier = JSON.parse(decoded) as Dossier;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL→state sync: reads `?import=` and immediately clears it below so the effect won't re-fire
      setImportingDossier(dossier);
    } catch (e) {
      console.error('Failed to parse import data:', e);
      setToast({ message: 'Link di importazione non valido', type: 'error' });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleConfirmImport = async () => {
    if (!importingDossier) return;
    const snapshot = importingDossier;
    setImportingDossier(null);
    const newId = await importDossier(snapshot);
    if (newId) {
      setSelectedDossierId(newId);
      showToast('Dossier importato', 'success');
    } else {
      showToast('Impossibile importare il dossier: errore server', 'error');
    }
  };

  const selectedDossier = dossiers.find((d) => d.id === selectedDossierId) ?? null;
  const showTrash = searchParams.get('trash') === '1';
  const setShowTrash = (on: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (on) next.set('trash', '1'); else next.delete('trash');
    setSearchParams(next);
  };

  return (
    <>
      {showTrash ? (
        <TrashPage trash={trash} onBack={() => setShowTrash(false)} showToast={showToast} />
      ) : selectedDossier ? (
        <DossierDetailView
          dossier={selectedDossier}
          onBack={() => setSelectedDossierId(null)}
          showToast={showToast}
          trash={trash}
        />
      ) : (
        <DossierListView
          onSelect={(id) => setSelectedDossierId(id)}
          showToast={showToast}
          trashCount={trash.entries?.length ?? 0}
          onOpenTrash={() => setShowTrash(true)}
        />
      )}

      {importingDossier && (
        <ImportDossierModal
          dossier={importingDossier}
          onClose={() => setImportingDossier(null)}
          onConfirm={handleConfirmImport}
        />
      )}

      <Toast
        message={toast?.message ?? ''}
        type={toast?.type ?? 'info'}
        isVisible={toast !== null}
        onClose={() => setToast(null)}
      />
    </>
  );
}
