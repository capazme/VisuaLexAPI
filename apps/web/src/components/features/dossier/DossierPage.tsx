import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { useTour } from '../../../hooks/useTour';
import { Toast } from '../../ui/Toast';
import { DossierListView } from './DossierListView';
import { DossierDetailView } from './DossierDetailView';
import { ImportDossierModal } from './ImportDossierModal';
import { TrashPage } from './TrashPage';
import { useTrash } from './useTrash';
import { importReport, importToastType, validateImportedDossier, type ImportCheck } from './dossierUtils';

type ToastState = { message: string; type: 'success' | 'error' | 'info' | 'warning' } | null;

export function DossierPage() {
  const { dossiers, importDossier } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importing, setImporting] = useState<ImportCheck | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const { tryStartTour } = useTour();
  // One trash for the page: its count on the list, a dossier's own entries, the «Cestino».
  const trash = useTrash();

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
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
  // signal in the same transaction (see CLAUDE.md gotcha #11).
  useEffect(() => {
    const importData = searchParams.get('import');
    if (!importData) return;
    try {
      const decoded = atob(decodeURIComponent(importData));
      // A share link is untrusted: its decision items are checked, and what cannot be imported is listed.
      const check = validateImportedDossier(JSON.parse(decoded));
      if (!check) throw new Error('not a dossier');
      setImporting(check);
    } catch (e) {
      console.error('Failed to parse import data:', e);
      setToast({ message: 'Link di importazione non valido', type: 'error' });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleConfirmImport = async () => {
    if (!importing) return;
    const { dossier, discarded } = importing;
    setImporting(null);
    const outcome = await importDossier(dossier);
    if (!outcome) {
      showToast('Impossibile importare il dossier: errore server', 'error');
      return;
    }
    setSelectedDossierId(outcome.id);
    const lost = outcome.failed + discarded.length;
    showToast(importReport(outcome.imported, lost), importToastType(outcome.imported, lost));
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

      {importing && (
        <ImportDossierModal
          dossier={importing.dossier}
          discarded={importing.discarded}
          onClose={() => setImporting(null)}
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
